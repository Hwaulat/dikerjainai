'use strict';
/**
 * Penyimpanan PostgreSQL untuk berkas JSON di data/.
 *
 * Kode aplikasi membaca/menulis data/*.json lewat fs (sinkron) di ratusan tempat.
 * Modul ini memasang lapisan transparan di fs untuk berkas .json/.jsonl di bawah
 * data/ sehingga PostgreSQL menjadi penyimpanan utamanya:
 *
 *   - init()  : memuat semua dokumen dari PostgreSQL ke memori (sekali, saat boot)
 *   - baca    : dari memori; bila berkas di disk LEBIH BARU (mis. ditulis sync.py),
 *               disk dipakai lalu disalin ke PostgreSQL
 *   - tulis   : ke disk (seperti biasa) DAN ke memori, lalu ke PostgreSQL (write-behind)
 *
 * Aktif hanya bila STORAGE_BACKEND=postgres dan DATABASE_URL terisi. Selain itu,
 * tidak ada yang berubah (tetap berkas JSON).
 */
const fs = require('fs');
const path = require('path');
const { handlers: RELATIONAL } = require('./db/relational');

const DATA_ROOT = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ENABLED = String(process.env.STORAGE_BACKEND || '').toLowerCase() === 'postgres' && !!process.env.DATABASE_URL;
// Berkas hasil sync (besar, dibuat ulang) tidak perlu riwayat perubahan
const SYNC_DIRS = new Set(['neosoft_db', 'google_sheets_db', 'google_maps_db', 'marketing_db', 'operational_db']);
const HISTORY_MAX_BYTES = 2 * 1024 * 1024;
const FLUSH_MS = 400;

const orig = {
  readFileSync: fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  existsSync: fs.existsSync.bind(fs),
  statSync: fs.statSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
};

let pool = null;
let ready = false;
const mirror = new Map();      // key -> { text, mtimeMs }
const pending = new Map();     // key -> text (menunggu ditulis ke PostgreSQL)
let flushTimer = null;
let flushing = false;
const stats = { loaded: 0, writes: 0, ingested: 0, errors: 0 };

function enabled() { return ENABLED; }
function isReady() { return ready; }

// Kunci dokumen: path relatif terhadap data/ (selalu '/'), hanya .json/.jsonl di dalam data/
function keyOf(p) {
  if (typeof p !== 'string') return null;
  const abs = path.resolve(p);
  if (abs !== DATA_ROOT && !abs.startsWith(DATA_ROOT + path.sep)) return null;
  if (!/\.jsonl?$/i.test(abs) || /\.bak-/.test(abs) || path.basename(abs).startsWith('.')) return null;
  return path.relative(DATA_ROOT, abs).split(path.sep).join('/');
}
const absOf = (key) => path.join(DATA_ROOT, ...key.split('/'));
const textOf = (data) => (typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data));

function rowParams(key, text) {
  let json = null;
  // JSONB tidak bisa menyimpan \u0000 → dokumen seperti itu disimpan apa adanya sebagai teks
  if (key.endsWith('.json') && !text.includes('\\u0000')) { try { JSON.parse(text); json = text; } catch (e) { json = null; } }
  return json !== null
    ? [key, 'json', json, null, Buffer.byteLength(text)]
    : [key, 'text', null, text, Buffer.byteLength(text)];
}

async function flush() {
  if (flushing || !pool || !pending.size) return;
  flushing = true;
  const batch = [...pending.entries()];
  batch.forEach(([k]) => pending.delete(k));
  for (const [key, text] of batch) {
    try {
      const prm = rowParams(key, text);
      if (RELATIONAL[key]) {   // disimpan di tabel relasional, bukan di documents
        await RELATIONAL[key].save(pool, text);
        if (prm[4] <= HISTORY_MAX_BYTES) await pool.query('INSERT INTO document_history (path, body_json, body_text) VALUES ($1, $2::jsonb, $3)', [key, prm[2], prm[3]]);
        stats.writes++;
        continue;
      }
      await pool.query(
        `INSERT INTO documents (path, kind, body_json, body_text, size_bytes, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, now())
         ON CONFLICT (path) DO UPDATE SET kind = EXCLUDED.kind, body_json = EXCLUDED.body_json,
           body_text = EXCLUDED.body_text, size_bytes = EXCLUDED.size_bytes, updated_at = now()`, prm);
      if (!SYNC_DIRS.has(key.split('/')[0]) && prm[4] <= HISTORY_MAX_BYTES) {
        await pool.query('INSERT INTO document_history (path, body_json, body_text) VALUES ($1, $2::jsonb, $3)', [key, prm[2], prm[3]]);
      }
      stats.writes++;
    } catch (e) {
      stats.errors++;
      console.error('[pg_store] gagal menyimpan', key, e.message);
      if (!pending.has(key)) pending.set(key, text);   // coba lagi
    }
  }
  flushing = false;
  if (pending.size) schedule();
}
function schedule() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}
function queue(key, text) { pending.set(key, text); schedule(); }

// Muat semua dokumen ke memori
async function init() {
  if (!ENABLED) return { enabled: false };
  if (ready) return { enabled: true, ...stats };
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const t0 = Date.now();
  const res = await pool.query('SELECT path, kind, body_json::text AS j, body_text, extract(epoch from updated_at) * 1000 AS ms FROM documents');
  res.rows.forEach(r => {
    mirror.set(r.path, { text: r.kind === 'json' ? r.j : r.body_text, mtimeMs: Number(r.ms) });
  });
  for (const [key, h] of Object.entries(RELATIONAL)) {
    const r = await h.load(pool);
    if (r) mirror.set(key, r);       // tabel relasional menjadi sumber kebenaran
    else mirror.delete(key);          // belum ada di tabel: dokumen lama (bila ada) diimpor lewat disk/migrasi
  }
  stats.loaded = res.rows.length;
  ready = true;
  install();
  const onExit = () => { try { if (pending.size) { /* flush best-effort */ } } catch (e) {} };
  process.on('beforeExit', onExit);
  console.log(`[pg_store] PostgreSQL aktif: ${stats.loaded} dokumen dimuat (${Date.now() - t0} ms)`);
  return { enabled: true, ...stats };
}

async function close() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  while (pending.size || flushing) { await flush(); await new Promise(r => setTimeout(r, 20)); }
  if (pool) { await pool.end(); pool = null; }
}

// Bila berkas di disk lebih baru dari memori (ditulis sync.py dsb.), ambil dari disk.
function refreshFromDisk(key, p) {
  let st;
  try { st = orig.statSync(p); } catch (e) { return mirror.get(key) || null; }
  const m = mirror.get(key);
  if (m && st.mtimeMs <= m.mtimeMs + 2) return m;   // toleransi pembulatan ms
  let text;
  try { text = orig.readFileSync(p, 'utf8'); } catch (e) { return m || null; }
  if (m && m.text === text) { m.mtimeMs = st.mtimeMs; return m; }
  const next = { text, mtimeMs: st.mtimeMs };
  mirror.set(key, next);
  queue(key, text);
  stats.ingested++;
  return next;
}

function install() {
  fs.readFileSync = function (p, opts) {
    const key = ready ? keyOf(p) : null;
    if (!key) return orig.readFileSync(p, opts);
    const m = refreshFromDisk(key, p);
    if (!m) return orig.readFileSync(p, opts);
    const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
    return enc ? m.text : Buffer.from(m.text, 'utf8');
  };
  fs.writeFileSync = function (p, data, opts) {
    const key = ready ? keyOf(p) : null;
    const r = orig.writeFileSync(p, data, opts);
    if (key) {
      const text = textOf(data);
      mirror.set(key, { text, mtimeMs: Date.now() });
      queue(key, text);
    }
    return r;
  };
  fs.existsSync = function (p) {
    if (orig.existsSync(p)) return true;
    const key = ready ? keyOf(p) : null;
    return !!(key && mirror.has(key));
  };
  fs.statSync = function (p, opts) {
    try { return orig.statSync(p, opts); } catch (e) {
      const key = ready ? keyOf(p) : null;
      const m = key && mirror.get(key);
      if (!m) throw e;
      return { mtimeMs: m.mtimeMs, mtime: new Date(m.mtimeMs), size: Buffer.byteLength(m.text), isFile: () => true, isDirectory: () => false };
    }
  };
  fs.readdirSync = function (dir, opts) {
    let out;
    try { out = orig.readdirSync(dir, opts); } catch (e) { out = null; }
    if (!ready || (opts && typeof opts === 'object' && opts.withFileTypes)) { if (out === null) throw new Error('ENOENT: ' + dir); return out; }
    const abs = path.resolve(String(dir));
    if (abs !== DATA_ROOT && !abs.startsWith(DATA_ROOT + path.sep)) { if (out === null) return orig.readdirSync(dir, opts); return out; }
    const rel = path.relative(DATA_ROOT, abs).split(path.sep).join('/');
    const prefix = rel ? rel + '/' : '';
    const names = new Set(out || []);
    let any = out !== null;
    mirror.forEach((_, k) => {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) { names.add(k.slice(prefix.length)); any = true; }
    });
    if (!any) return orig.readdirSync(dir, opts);   // lempar error asli
    return [...names];
  };
}

module.exports = { enabled, isReady, init, close, flush, keyOf, absOf, rowParams, stats, DATA_ROOT, _mirror: mirror };
