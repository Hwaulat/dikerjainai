// Bukti pembayaran via WhatsApp (khusus role kasir): gambar → dibaca AI vision
// (9router) → disimpan sebagai catatan, foto TIDAK disimpan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'payment_proofs.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; }
}
function writeAll(rows) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, FILE);
}

const ANALYZE_PROMPT = `Kamu asisten KEFIR Derma Clinic yang melihat sebuah gambar kiriman staf.
Tentukan gambar itu apa. Balas HANYA JSON valid tanpa teks lain:
{"tipe":"bukti_pembayaran" | "lainnya",
 "ringkasan":"1-2 kalimat Bahasa Indonesia: gambar ini apa dan isinya apa",
 "jawaban":"jawaban atas permintaan/pertanyaan pengguna soal gambar ini (Bahasa Indonesia, ringkas); null jika tidak ada permintaan",
 "pembayaran": null ATAU bila tipe=bukti_pembayaran (struk EDC, bukti transfer m-banking, QRIS, kwitansi tunai):
   {"jenis":"transfer|qris|edc|tunai|lainnya",
    "nominal":angka rupiah tanpa titik/koma (null jika tidak terbaca),
    "tanggal":"YYYY-MM-DD" (null jika tidak ada),
    "jam":"HH:MM" (null jika tidak ada),
    "bank":"nama bank/aplikasi/penerbit kartu atau null",
    "referensi":"nomor referensi/approval/RRN/trace atau null",
    "pengirim":"nama pengirim/pemegang kartu atau null",
    "penerima":"nama penerima/merchant atau null",
    "keyakinan":"tinggi|sedang|rendah"}}
Jangan menebak angka; jika tidak terbaca isi null dan turunkan keyakinan.`;

function imageMessage(buffer, mimetype, text) {
  return { role: 'user', content: [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${mimetype || 'image/jpeg'};base64,${buffer.toString('base64')}` } }
  ] };
}

// Satu panggilan vision: klasifikasi gambar + (jika bukti bayar) ekstraksi data.
async function analyzeImage(buffer, mimetype, question, forcePayment, callLLM, meta = {}) {
  const hint = [
    question ? `Permintaan pengguna: "${question}"` : 'Tidak ada permintaan khusus; cukup jelaskan gambarnya.',
    forcePayment ? 'Pengguna menandai gambar ini sebagai BUKTI PEMBAYARAN (#payment); isi bagian "pembayaran" sebisanya.' : ''
  ].filter(Boolean).join('\n');
  const done = await callLLM([imageMessage(buffer, mimetype, ANALYZE_PROMPT + '\n\n' + hint)], null, 0.1, 900,
    { purpose: 'image_analyze', channel: 'whatsapp', ...meta });
  const txt = String(done?.choices?.[0]?.message?.content || '');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return done ? { tipe: 'lainnya', ringkasan: txt.trim().slice(0, 800), jawaban: null, pembayaran: null } : null;
  try {
    const j = JSON.parse(m[0]);
    if (forcePayment && !j.pembayaran) j.pembayaran = { keyakinan: 'rendah' };
    if (j.tipe === 'bukti_pembayaran' && !j.pembayaran) j.pembayaran = { keyakinan: 'rendah' };
    return j;
  } catch (e) { return null; }
}

// ---- Konfirmasi tertunda (di memori, kedaluwarsa 30 menit) ----
const PENDING_TTL = 30 * 60 * 1000;
const pending = new Map(); // sender -> [{seq, parsed, hash, branch, caption, senderName, at}]
function addPending(sender, item) {
  const now = Date.now();
  const list = (pending.get(sender) || []).filter(x => now - x.at < PENDING_TTL);
  const seq = (list.reduce((a, x) => Math.max(a, x.seq), 0)) + 1;
  const it = { ...item, seq, at: now };
  list.push(it); pending.set(sender, list);
  return it;
}
function getPending(sender) {
  const now = Date.now();
  const list = (pending.get(sender) || []).filter(x => now - x.at < PENDING_TTL);
  pending.set(sender, list);
  return list;
}
function removePending(sender, seqs) {
  pending.set(sender, getPending(sender).filter(x => !seqs.includes(x.seq)));
}

function branchFromText(t) {
  if (/pondok\s*kopi|\bpk\b/i.test(t || '')) return 'Pondok Kopi';
  if (/depok/i.test(t || '')) return 'Depok';
  return null;
}

// Simpan; kembalikan {record} atau {duplicate}
function saveProof({ parsed, hash, sender, senderName, branch, caption }) {
  const rows = readAll();
  const dupe = rows.find(r => r.status !== 'batal' && (r.hash === hash ||
    (parsed.referensi && r.referensi && r.referensi === parsed.referensi && r.nominal === parsed.nominal)));
  if (dupe) return { duplicate: dupe };
  const nominal = parsed.nominal == null ? null : Math.round(Number(parsed.nominal)) || null;
  const rec = {
    id: 'BP' + String(rows.length + 1).padStart(4, '0'),
    created_at: new Date().toISOString(),
    hash, sender, sender_name: senderName, branch: branch || null,
    jenis: parsed.jenis || 'lainnya', nominal,
    tanggal: parsed.tanggal || null, jam: parsed.jam || null,
    bank: parsed.bank || null, referensi: parsed.referensi || null,
    pengirim: parsed.pengirim || null, penerima: parsed.penerima || null,
    keyakinan: parsed.keyakinan || null,
    caption: String(caption || '').slice(0, 200),
    status: 'tercatat',
    sheet_status: 'belum_dikirim'
  };
  rows.push(rec);
  writeAll(rows);
  return { record: rec };
}

// Kirim ke spreadsheet; hasilnya disimpan di catatan (sheet_status).
// Database lokal (payment_proofs.json) tetap jadi sumber utama & pencegah duplikat.
async function syncToSheet(id, statusLabel) {
  const sheet = require('./sheet_writer');
  const r = readAll().find(x => x.id === id);
  if (!r) return { ok: false };
  const res = await sheet.appendRecord(r, statusLabel);
  const fresh = readAll();
  const f = fresh.find(x => x.id === id);
  if (f) {
    if (statusLabel === 'BATAL') f.sheet_void = res.ok ? 'terkirim' : (res.reason || 'gagal');
    else f.sheet_status = res.ok ? 'tersimpan' : (res.reason || 'gagal');
    if (!res.ok && res.error) f.sheet_error = res.error;
    writeAll(fresh);
  }
  return res;
}

// Kirim ulang catatan yang belum masuk spreadsheet (mis. setelah konfigurasi diisi).
async function retryUnsynced() {
  const todo = readAll().filter(r => r.status === 'tercatat' && r.sheet_status !== 'tersimpan');
  let n = 0;
  for (const r of todo) { const x = await syncToSheet(r.id); if (x.ok) n++; else if (x.reason === 'belum_tersambung') break; }
  return n;
}

function voidProof(id, sender) {
  const rows = readAll();
  const r = rows.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!r) return { error: 'ID tidak ditemukan' };
  if (r.sender !== sender) return { error: 'Hanya pengirim asli yang bisa membatalkan' };
  r.status = 'batal';
  writeAll(rows);
  return { record: r };
}

function listProofs({ date, branch } = {}) {
  return readAll().filter(r => r.status !== 'batal'
    && (!date || (r.tanggal || r.created_at.slice(0, 10)) === date)
    && (!branch || r.branch === branch));
}

const rp = n => n == null ? '-' : 'Rp ' + Number(n).toLocaleString('id-ID');

module.exports = { syncToSheet, retryUnsynced, analyzeImage, addPending, getPending, removePending, saveProof, voidProof, listProofs, branchFromText, imageMessage, rp, hashBuffer: b => crypto.createHash('sha256').update(b).digest('hex') };
