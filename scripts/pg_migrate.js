#!/usr/bin/env node
/**
 * Impor berkas JSON di data/ ke PostgreSQL (tabel documents).
 *   DATABASE_URL=postgres://localhost/kefir_clinic_dev node scripts/pg_migrate.js [--dry-run] [--verify] [--only=prefix/]
 * Aman diulang: dokumen di-upsert; berkas di disk tidak diubah/dihapus.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { handlers: RELATIONAL } = require('../db/relational');

const DATA = path.join(__dirname, '..', 'data');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7);

function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsonl?$/i.test(e.name) && !/\.bak-/.test(e.name) && !e.name.startsWith('.')) out.push(p);
  });
  return out;
}

// jsonb tidak mempertahankan urutan key → bandingkan secara kanonik
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL belum diisi'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  // Skema dikelola Prisma (prisma/migrations). Jalankan dulu: npx prisma migrate deploy
  const has = await pool.query("SELECT to_regclass('public.documents') AS t, to_regclass('public.bhp_standards') AS b");
  if (!has.rows[0].t || !has.rows[0].b) {
    console.error('Tabel belum ada. Jalankan dulu: npx prisma migrate deploy   (npm run db:deploy)');
    await pool.end(); process.exit(1);
  }

  const files = walk(DATA).filter(f => !only || path.relative(DATA, f).split(path.sep).join('/').startsWith(only));
  let ok = 0, text = 0, bytes = 0, bad = [], relational = [];
  for (const f of files) {
    const key = path.relative(DATA, f).split(path.sep).join('/');
    const body = fs.readFileSync(f, 'utf8');
    let json = null;
    if (key.endsWith('.json')) {
      if (body.includes('\\u0000')) { bad.push(key + ' (mengandung \\u0000, disimpan sebagai teks)'); }
      else { try { JSON.parse(body); json = body; } catch (e) { bad.push(key); } }
    }
    bytes += Buffer.byteLength(body);
    if (json === null) text++;
    if (flag('dry-run')) { ok++; continue; }
    if (RELATIONAL[key]) {   // masuk tabel relasional (bukan documents)
      await RELATIONAL[key].save(pool, body);
      await pool.query('DELETE FROM documents WHERE path = $1', [key]);
      relational.push(key);
      ok++;
      continue;
    }
    const mtime = fs.statSync(f).mtime;
    await pool.query(
      `INSERT INTO documents (path, kind, body_json, body_text, size_bytes, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       ON CONFLICT (path) DO UPDATE SET kind = EXCLUDED.kind, body_json = EXCLUDED.body_json,
         body_text = EXCLUDED.body_text, size_bytes = EXCLUDED.size_bytes, updated_at = EXCLUDED.updated_at`,
      [key, json !== null ? 'json' : 'text', json, json !== null ? null : body, Buffer.byteLength(body), mtime]);
    ok++;
  }
  console.log(`${flag('dry-run') ? '[dry-run] ' : ''}dokumen: ${ok}/${files.length} | non-JSON/teks: ${text} | ${(bytes / 1048576).toFixed(1)} MB`);
  if (relational.length) console.log('tabel relasional:', relational.join(', '));
  if (bad.length) console.log('JSON tidak valid (disimpan sebagai teks):', bad.join(', '));

  if (flag('verify') && !flag('dry-run')) {
    let diff = 0, missing = 0;
    for (const f of files) {
      const key = path.relative(DATA, f).split(path.sep).join('/');
      if (RELATIONAL[key]) {
        const loaded = await RELATIONAL[key].load(pool);
        const disk = JSON.parse(fs.readFileSync(f, 'utf8'));
        const empty = Array.isArray(disk) ? !disk.length : (disk && typeof disk === 'object' && !Object.keys(disk).length);
        // canon mempertahankan urutan array → urutan baris ikut diverifikasi
        const same = loaded ? JSON.stringify(canon(JSON.parse(loaded.text))) === JSON.stringify(canon(disk)) : empty;
        if (!same) { diff++; console.log('  ! beda isi (relasional):', key); }
        continue;
      }
      const r = await pool.query('SELECT kind, body_json, body_text FROM documents WHERE path = $1', [key]);
      if (!r.rows.length) { missing++; console.log('  ! hilang di DB:', key); continue; }
      const disk = fs.readFileSync(f, 'utf8');
      const same = r.rows[0].kind === 'json'
        ? JSON.stringify(canon(r.rows[0].body_json)) === JSON.stringify(canon(JSON.parse(disk)))
        : r.rows[0].body_text === disk;
      if (!same) { diff++; console.log('  ! beda isi:', key); }
    }
    console.log(`verifikasi: ${files.length - diff - missing} identik, ${diff} beda, ${missing} hilang`);
    if (diff || missing) process.exitCode = 2;
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
