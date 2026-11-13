/**
 * KEFIR — Foto Before/After (Pemeriksaan Fisik Neosoft).
 *
 * Neosoft TIDAK menyediakan foto lewat API resmi. Foto tersimpan di object
 * storage Neosoft dengan nama yang bisa dibentuk dari data yang SUDAH
 * tersinkron (id pemeriksaan, id pasien, waktu unggah):
 *   .../physical_exam/physicalexamination_<n>_<peId>_<custId>_<unix>.jpg
 * File di storage itu publik — bisa diunduh tanpa login. Karena ini foto
 * wajah pasien (data medis), KEFIR mengunduhnya ke server (data/pe_photos,
 * gitignored) lalu HANYA menyajikannya ke user yang sudah login. URL publik
 * Neosoft tidak pernah dikirim ke browser.
 *
 * ⚠️ Lapor ke Neosoft: file foto pasien bisa diakses tanpa autentikasi dan
 * nama filenya mudah ditebak. Minta dibuat privat / pakai URL bertanda-tangan.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'pe_photos');
const MANIFEST_FILE = path.join(CACHE_DIR, '_manifest.json');
const STORAGE_BASE = 'https://s3-jak01.storageraya.com/cube/kefirdermaclinic/physical_exam/';
const MAX_PHOTOS = 8;          // sudut foto per sesi (depan/kiri/kanan dll)
const TS_OFFSETS = [0, -1, 1, -2, 2, -3, 3]; // jam unggah bisa meleset 1-3 detik

function loadManifest() { try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (e) { return {}; } }
let _manifest = loadManifest();
function saveManifest() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(MANIFEST_FILE + '.tmp', JSON.stringify(_manifest)); fs.renameSync(MANIFEST_FILE + '.tmp', MANIFEST_FILE); } catch (e) { /* cache opsional */ }
}

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const fileName = (n, peId, custId, ts) => `physicalexamination_${n}_${peId}_${custId}_${ts}.jpg`;
const localName = (peId, n) => `pe_${peId}_${n}.jpg`;

async function head(url) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; } }
async function download(url, dest) {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return true;
  } catch (e) { return false; }
}

/**
 * Pastikan foto 1 pemeriksaan sudah ada di cache lokal.
 * Return { count, cached } — count = jumlah foto, tanpa membuka URL ke browser.
 * Hasil (termasuk "tidak ada foto") disimpan di manifest agar tidak diprobe ulang.
 */
async function ensureExamPhotos(exam, { refresh = false } = {}) {
  const peId = exam.id, custId = exam.customer_id;
  const key = String(peId);
  if (!refresh && _manifest[key]) return { count: _manifest[key].count, cached: true, checked_at: _manifest[key].at };
  const base = unix(exam.created_at || exam.examination_date);
  // Cari offset waktu yang benar lewat foto pertama
  let ts = null;
  for (const off of TS_OFFSETS) { if (await head(STORAGE_BASE + fileName(1, peId, custId, base + off))) { ts = base + off; break; } }
  let count = 0;
  if (ts != null) {
    for (let n = 1; n <= MAX_PHOTOS; n++) {
      const ok = await download(STORAGE_BASE + fileName(n, peId, custId, ts), path.join(CACHE_DIR, localName(peId, n)));
      if (!ok) break;
      count = n;
    }
  }
  _manifest[key] = { count, ts, at: new Date().toISOString() };
  saveManifest();
  return { count, cached: false, checked_at: _manifest[key].at };
}

// Path file lokal untuk disajikan route (null kalau belum/di luar jangkauan)
function localPhotoPath(peId, n) {
  if (!/^\d+$/.test(String(peId)) || !/^\d+$/.test(String(n))) return null;
  const p = path.join(CACHE_DIR, localName(peId, n));
  return fs.existsSync(p) ? p : null;
}
const manifestFor = (peId) => _manifest[String(peId)] || null;

module.exports = { ensureExamPhotos, localPhotoPath, manifestFor, CACHE_DIR };
