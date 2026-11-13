// Tulis catatan bukti pembayaran kasir ke Google Sheets (Sheets REST API,
// auth service account via JWT RS256 — tanpa dependensi tambahan).
// Spreadsheet: "Log Bukti Pembayaran Kasir KEFIR" (tab "Bukti Pembayaran" + tab "Rekap").
// Baris BATAL memakai nominal negatif supaya rekap otomatis netto.
// Konfigurasi: data/payment_sheet_config.json (gitignored)
//   { "spreadsheet_id": "...", "sheet_name": "Bukti Pembayaran",
//     "service_account_file": "/path/service-account.json" }
// atau env PAYMENT_SHEET_ID / PAYMENT_SHEET_NAME / GOOGLE_APPLICATION_CREDENTIALS.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, 'data', 'payment_sheet_config.json');
const HEADER = ['ID', 'Dicatat (WIB)', 'Tanggal Bayar', 'Jam', 'Cabang', 'Sumber', 'Bank/Aplikasi', 'Nominal', 'Referensi', 'Pengirim/Pemegang Kartu', 'Penerima/Merchant', 'Kasir', 'Status'];
const SOURCE_LABEL = { edc: 'EDC', qris: 'QRIS', transfer: 'Transfer', tunai: 'Tunai', lainnya: 'Lainnya' };

function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
  const cfg = {
    spreadsheet_id: process.env.PAYMENT_SHEET_ID || c.spreadsheet_id,
    sheet_name: process.env.PAYMENT_SHEET_NAME || c.sheet_name || 'Bukti Pembayaran',
    service_account_file: process.env.GOOGLE_APPLICATION_CREDENTIALS || c.service_account_file
  };
  return cfg.spreadsheet_id && cfg.service_account_file ? cfg : null;
}

function isConfigured() { return !!loadConfig(); }

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: 20000 }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(ch).toString('utf8'); let j = null;
        try { j = JSON.parse(txt); } catch (e) {}
        res.statusCode >= 200 && res.statusCode < 300 ? resolve(j || {}) : reject(new Error(`HTTP ${res.statusCode}: ${(j && j.error && (j.error.message || j.error)) || txt.slice(0, 200)}`));
      });
    });
    r.on('error', reject); r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body); r.end();
  });
}

let tokenCache = { token: null, exp: 0 };
async function getToken(cfg) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const sa = JSON.parse(fs.readFileSync(cfg.service_account_file, 'utf8'));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`;
  const j = await req('POST', 'https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

const wib = iso => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
function toRow(r, statusLabel) {
  return [r.id, wib(r.created_at), r.tanggal || '', r.jam || '', r.branch || '', SOURCE_LABEL[r.jenis] || r.jenis || '',
    r.bank || '', r.nominal == null ? '' : (statusLabel === 'BATAL' ? -r.nominal : r.nominal), r.referensi || '', r.pengirim || '', r.penerima || '', r.sender_name || '', statusLabel || 'Tercatat'];
}

let headerEnsured = false;
async function appendRecord(rec, statusLabel) {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, reason: 'belum_tersambung' };
  try {
    const token = await getToken(cfg);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheet_id)}/values/`;
    const tab = encodeURIComponent(cfg.sheet_name);
    if (!headerEnsured) {
      const cur = await req('GET', `${base}${tab}!A1:A1`, auth);
      if (!cur.values || !cur.values.length) {
        const b = JSON.stringify({ values: [HEADER] });
        await req('PUT', `${base}${tab}!A1:M1?valueInputOption=RAW`, { ...auth, 'Content-Length': Buffer.byteLength(b) }, b);
      }
      headerEnsured = true;
    }
    const b = JSON.stringify({ values: [toRow(rec, statusLabel)] });
    await req('POST', `${base}${tab}!A:M:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { ...auth, 'Content-Length': Buffer.byteLength(b) }, b);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'gagal', error: e.message };
  }
}

module.exports = { appendRecord, isConfigured, HEADER, toRow, CONFIG_FILE };
