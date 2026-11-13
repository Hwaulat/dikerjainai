// ═════════════════════════════════════════════════════════════════
// HARGA PROMO & BOTTOM DARI SPREADSHEET MARKETING
//
// Halaman "Harga Promo & Bottom" tidak bisa diubah dari aplikasi. Harga normal,
// bottom (kolom "Harga Terendah"), harga promo, dan paket dibaca dari spreadsheet
// "Planning <Bulan>" milik tim marketing (data/price_sheet_sources.json), lalu
// disimpan ke data/google_sheets_db/price_sheets.json.
//
// Kolom BV (modal per tindakan; di spreadsheet Profit = Harga Promo − BV — bukan hanya BHP) dibaca untuk rekomendasi penjualan dari stok, tapi hanya
// dikirim ke role owner/finance. Kolom Profit tidak dibaca.
// Kekeliruan di spreadsheet (periode bulan lain, treatment dobel, promo lebih
// mahal dari harga normal, dst.) dicatat sebagai `issues` dan tampil sebagai
// ikon alert di halaman.
// ═════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const https = require('https');
let ExcelJS = null;
try {
  ExcelJS = require('exceljs');
} catch (e) {
  // Optional dependency if running in lean environment
}

const SOURCES_FILE = path.join(__dirname, 'data', 'price_sheet_sources.json');
const OUT_FILE = path.join(__dirname, 'data', 'google_sheets_db', 'price_sheets.json');

const BULAN = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
const BULAN_PENDEK = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];

const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => normName(s).replace(/ /g, '-');

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('').trim();
    if ('result' in v) return cellText(v.result);
    if (v.text) return String(v.text).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}
function cellNum(v) {
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v ?? '').replace(/rp/i, '').replace(/[.,](?=\d{3}\b)/g, '').replace(/\s/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

// Rentang tanggal dalam bulan sumber, mis. "20 s.d 31 Oktober 2026" / "14–20 Oktober 2026".
function findRange(text, monthIdx, year) {
  const m = new RegExp(`(\\d{1,2})\\s*(?:-|–|s\\.?\\s*d\\.?|sampai|hingga)\\s*(\\d{1,2})\\s+(?:${BULAN[monthIdx]}|${BULAN_PENDEK[monthIdx]})\\b(?:\\s+(\\d{4}))?`, 'i').exec(text || '');
  if (!m) return null;
  const y = Number(m[3] || year);
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(y, monthIdx + 1, 0).getDate();
  const a = Math.min(Number(m[1]), last), b = Math.min(Number(m[2]), last);
  if (!a || !b || a > b) return null;
  return { start: `${y}-${pad(monthIdx + 1)}-${pad(a)}`, end: `${y}-${pad(monthIdx + 1)}-${pad(b)}` };
}
const mentionsMonth = (text, idx) => new RegExp(`\\b(${BULAN[idx]}|${BULAN_PENDEK[idx]})\\b`, 'i').test(text || '');
const otherMonths = (text, idx) => BULAN.filter((b, i) => i !== idx && new RegExp(`\\b${b}\\b`, 'i').test(text || ''));

// Grid nilai sel (0-based). Sel gabungan (merged) hanya berisi nilai di sel kiri-atasnya —
// ExcelJS mengulang nilai sel induk ke semua sel dalam rentang gabungan, yang membuat
// satu paket terbaca berkali-kali. Ukuran dibatasi: beberapa sheet berdimensi sampai kolom XFD.
const MAX_ROWS = 800, MAX_COLS = 80;
function sheetGrid(ws) {
  const raw = ws.getSheetValues();   // array 1-based, sparse
  const rows = [];
  let maxCol = 0;
  for (let r = 1; r < Math.min(raw.length, MAX_ROWS + 1); r++) {
    const vals = Array.isArray(raw[r]) ? raw[r].slice(1, MAX_COLS + 1) : [];
    maxCol = Math.max(maxCol, vals.length);
    rows.push(vals);
  }
  rows.forEach(v => { while (v.length < maxCol) v.push(null); });
  const toIdx = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]) - 1, c - 1]; };
  (ws.model && ws.model.merges || []).forEach(rng => {
    const [a, b] = String(rng).split(':');
    if (!a || !b) return;
    const [r1, c1] = toIdx(a), [r2, c2] = toIdx(b);
    for (let r = r1; r <= Math.min(r2, rows.length - 1); r++)
      for (let c = c1; c <= Math.min(c2, maxCol - 1); c++)
        if ((r !== r1 || c !== c1) && rows[r]) rows[r][c] = null;
  });
  return rows;
}
const colName = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

// ── Tabel harga per treatment (Treatment / Menu + Harga Normal + Harga Promo)
function findTreatmentTables(grid) {
  const tables = [];
  grid.forEach((row, r) => {
    row.forEach((v, c) => {
      const t = cellText(v).toLowerCase();
      if (t !== 'treatment' && t !== 'menu') return;
      // batas kanan tabel: header "Concern"/"Treatment" berikutnya
      let end = row.length;
      for (let k = c + 1; k < row.length; k++) {
        const h = cellText(row[k]).toLowerCase();
        if (h === 'treatment' || h === 'menu' || (h === 'concern' && k > c + 1)) { end = k; break; }
      }
      const find = (re, from = c + 1, to = end) => { for (let k = from; k < to; k++) if (re.test(cellText(row[k]).toLowerCase())) return k; return -1; };
      const normal = find(/^(harga )?normal$/);
      // "Total Harga Promo" bisa berisi total gabungan add-on, jadi harga per item didahulukan.
      let promo = find(/^(harga promo|promo)$/);
      if (promo < 0) promo = find(/^harga setelah disc$/);
      if (promo < 0) promo = find(/^total harga promo$/);
      if (normal < 0 || promo < 0) return;
      tables.push({
        headerRow: r, col: c,
        normal, promo,
        bottom: find(/terendah/),
        // BV = modal per tindakan (lebih besar dari BHP saja). Disimpan di server, hanya ditampilkan ke owner/finance.
        bv: find(/^(bv|bv final|hpp)$/),
        benefit: find(/^(benn?efit|get product)$/),
        status: (() => { for (let k = Math.max(0, c - 3); k < c; k++) if (/status promo/.test(cellText(row[k]).toLowerCase())) return k; return -1; })(),
        title: (() => { for (let k = r - 1; k >= Math.max(0, r - 2); k--) { const t2 = cellText(grid[k][c - 2] || grid[k][c] || grid[k][Math.max(0, c - 2)]); if (t2) return t2; } return ''; })(),
      });
    });
  });
  return tables;
}

// ── Tabel paket (Nama Paket + Isi Paket + Harga Paket)
function findBundleTables(grid) {
  const tables = [];
  grid.forEach((row, r) => {
    row.forEach((v, c) => {
      if (cellText(v).toLowerCase() !== 'nama paket') return;
      const hdr = row.map(x => cellText(x).toLowerCase());
      const isi = hdr.indexOf('isi paket', c);
      if (isi < 0) return;
      // Kolom "Harga Normal" pertama = harga per isi paket, yang terakhir = total paket.
      const normals = [];
      hdr.forEach((h, k) => { if (k > isi && /^(total )?harga normal$/.test(h)) normals.push(k); });
      const normal = normals.length ? normals[normals.length - 1] : -1;
      const itemNormal = normals.length > 1 ? normals[0] : -1;
      let promo = hdr.indexOf('harga paket', c);
      if (promo < 0) promo = hdr.indexOf('harga promo', c);
      if (promo < 0) return;
      const find = (re) => hdr.findIndex((h, k) => k > c && re.test(h));
      // BV / Total BV / Profit sengaja tidak dibaca.
      tables.push({ headerRow: r, col: c, isi, normal, promo, itemNormal,
        category: find(/^kategori$/), bottom: find(/^(harga )?terendah$/), afterDisc: find(/^harga setelah disc$/) });
    });
  });
  return tables;
}

function parseWorksheet(ws, source, monthIdx, year) {
  const grid = sheetGrid(ws);
  const issues = [];
  const at = (r, c) => `${ws.name}!${colName(c)}${r + 1}`;

  // Metadata: baris Campaign / Periode / Offer di kolom A, syarat (SK) di kolom berjudul "SK"
  let skCol = -1;
  for (let r = 0; r < Math.min(3, grid.length) && skCol < 0; r++) grid[r].forEach((v, c) => { if (skCol < 0 && cellText(v).toUpperCase() === 'SK') skCol = c; });
  const metaRow = (label) => grid.findIndex((row, r) => r < 12 && cellText(row[0]).toLowerCase() === label);
  const rowCampaign = metaRow('campaign'), rowPeriode = metaRow('periode'), rowOffer = metaRow('offer');
  const lastMetaCol = skCol > 0 ? skCol : 4;
  const campCols = [];
  if (rowCampaign >= 0) for (let c = 1; c < lastMetaCol; c++) if (cellText(grid[rowCampaign][c])) campCols.push(c);
  const terms = [];
  // Baris syarat berurutan di bawah judul "SK"; berhenti di baris kosong pertama supaya isi tabel
  // di kolom yang sama (mis. kolom "Harga Normal") tidak ikut terbaca sebagai syarat.
  if (skCol >= 0) for (let r = 1; r < Math.min(grid.length, 14); r++) {
    const t = cellText(grid[r][skCol]);
    if (t) terms.push(t); else if (terms.length) break;
  }
  const termsRight = [];   // "TERMS & CONDITIONS" (mis. voucher Buy Now Glow Later)
  grid.slice(0, 3).forEach(row => row.forEach((v, c) => { if (/terms\s*&\s*conditions/i.test(cellText(v))) for (let r = 1; r < Math.min(grid.length, 20); r++) { const t = cellText(grid[r][c]); if (t) termsRight.push(t); } }));
  const titleText = [ws.name, cellText(grid[0] && grid[0][0])].join(' ');

  // Pilih kolom campaign untuk bulan sumber
  let campCol = campCols.find(c => rowPeriode >= 0 && mentionsMonth(cellText(grid[rowPeriode][c]), monthIdx));
  const periodeText = (c) => (rowPeriode >= 0 && c !== undefined ? cellText(grid[rowPeriode][c]) : '');
  const allText = [titleText, ...terms, ...termsRight, ...campCols.map(c => cellText(grid[rowCampaign][c])), ...campCols.map(periodeText)].join(' \n ');

  // Tab yang ditandai "paket_saja" di price_sheet_sources.json: tabel harga satuannya tidak dipakai
  // (mis. GLOW DEALS = promo paket; tabel satuan di tab itu sisa campaign lama).
  const bundlesOnly = (source.paket_saja || []).includes(ws.name);
  const tables = bundlesOnly ? [] : findTreatmentTables(grid);
  if (bundlesOnly) issues.push({ lvl: 'info', text: `Tab ini hanya dibaca sebagai paket bundling; tabel harga satuan di tab ini tidak dipakai (diatur di price_sheet_sources.json).` });
  const bundleTables = findBundleTables(grid);
  const hasStatusAktif = tables.some(t => t.status >= 0);
  if (campCol === undefined && !mentionsMonth(allText, monthIdx) && !hasStatusAktif) {
    return { skipped: true, reason: `periodenya bukan ${BULAN[monthIdx]} (${[...new Set([periodeText(campCols[0]), ...terms.filter(t => /berlaku/i.test(t))].filter(Boolean))].join(' / ') || 'tanpa periode'})` };
  }
  if (!tables.length && !bundleTables.length) return { skipped: true, reason: 'tidak ada tabel harga' };
  if (campCol === undefined) campCol = campCols[0];

  const pad = (n) => String(n).padStart(2, '0');
  const whole = { start: `${year}-${pad(monthIdx + 1)}-01`, end: `${year}-${pad(monthIdx + 1)}-${pad(new Date(year, monthIdx + 1, 0).getDate())}` };
  let period = findRange(periodeText(campCol), monthIdx, year)
    || findRange([...termsRight, ...terms].join(' \n '), monthIdx, year);
  const fullMonthRe = new RegExp(`(selama|sepanjang|seluruh)\\s+bulan\\s+(${BULAN[monthIdx]}|${BULAN_PENDEK[monthIdx]})\\b`, 'i');
  if (!period && fullMonthRe.test([periodeText(campCol), ...terms, ...termsRight, titleText].join(' \n '))) period = whole;
  if (!period) {
    period = whole;
    if (!hasStatusAktif) issues.push({ lvl: 'warn', text: `Periode tidak tertulis jelas untuk ${BULAN[monthIdx]}; dianggap berlaku sebulan penuh (${whole.start} s.d. ${whole.end}).` });
  }
  if (campCol !== undefined && rowPeriode >= 0) {
    const pt = periodeText(campCol);
    const om = otherMonths(pt, monthIdx);
    if (pt && om.length && !mentionsMonth(pt, monthIdx)) issues.push({ lvl: 'warn', text: `Sel Periode (${at(rowPeriode, campCol)}) tertulis "${pt}", bukan ${BULAN[monthIdx]}.` });
  }
  terms.forEach(t => { const om = otherMonths(t, monthIdx); if (om.length && /berlaku/i.test(t) && !mentionsMonth(t, monthIdx)) issues.push({ lvl: 'warn', text: `Syarat tertulis "${t}" — menyebut bulan ${om.join('/')}, bukan ${BULAN[monthIdx]}.` }); });

  const name = (campCol !== undefined && rowCampaign >= 0 ? cellText(grid[rowCampaign][campCol]) : '') || cellText(grid[0][0]) || ws.name;
  const audience = hasStatusAktif ? 'new' : 'all';
  if (audience === 'new' && campCol === undefined) issues.push({ lvl: 'info', text: 'Promo khusus pasien baru; tidak ditampilkan sebagai promo umum di Patient 360°.' });

  // Item per treatment
  const items = [];
  const seen = {};
  tables.forEach(t => {
    const tt = cellText(grid[t.headerRow - 1] && grid[t.headerRow - 1][t.col - 2 >= 0 ? t.col - 2 : t.col]) || '';
    const tableTitle = cellText((grid[t.headerRow - 1] || [])[Math.max(0, t.col - 2)]) || tt;
    const om = otherMonths(tableTitle, monthIdx);
    if (tableTitle && om.length) issues.push({ lvl: 'warn', text: `Judul tabel di ${at(t.headerRow - 1, Math.max(0, t.col - 2))} masih "${tableTitle}". Pastikan harganya sudah untuk ${BULAN[monthIdx]}.` });
    let blank = 0;
    for (let r = t.headerRow + 1; r < grid.length; r++) {
      const nm = cellText(grid[r][t.col]);
      if (!nm) { if (++blank >= 2) break; continue; }
      blank = 0;
      if (/^(treatment|menu|concern)$/i.test(nm)) break;
      if (t.status >= 0 && !/aktif/i.test(cellText(grid[r][t.status]))) continue;
      const normal = cellNum(grid[r][t.normal]);
      const promo = cellNum(grid[r][t.promo]);
      const bottom = t.bottom >= 0 ? cellNum(grid[r][t.bottom]) : null;
      const bv = t.bv >= 0 ? cellNum(grid[r][t.bv]) : null;
      const benefit = t.benefit >= 0 ? cellText(grid[r][t.benefit]) : '';
      if (!promo && !normal) continue;
      const cell = at(r, t.col);
      if (promo && normal && (promo > normal || (promo === normal && !benefit))) issues.push({ lvl: 'bad', text: `${nm}: harga promo ${rp(promo)} tidak lebih murah dari harga normal ${rp(normal)} (${cell}).` });
      if (promo && bottom && promo < bottom) issues.push({ lvl: 'warn', text: `${nm}: harga promo ${rp(promo)} di bawah harga terendah ${rp(bottom)} (${cell}).` });
      const k = normName(nm);
      if (seen[k]) {
        if (seen[k].promo !== promo) issues.push({ lvl: 'bad', text: `${nm} tercantum lebih dari sekali dengan harga promo berbeda (${rp(seen[k].promo)} di ${seen[k].cell}, ${rp(promo)} di ${cell}). Yang dipakai ${rp(Math.min(seen[k].promo || Infinity, promo || Infinity))}.` });
        if (promo && (!seen[k].promo || promo < seen[k].promo)) Object.assign(seen[k], { promo, cell });
        continue;
      }
      seen[k] = { name: nm, normal, promo, bottom, bv, benefit, cell };
      items.push(seen[k]);
    }
  });

  // Paket
  const bundles = [];
  bundleTables.forEach(t => {
    let cur = null, blank = 0;
    for (let r = t.headerRow + 1; r < grid.length; r++) {
      const nm = cellText(grid[r][t.col]), isi = cellText(grid[r][t.isi]);
      if (!nm && !isi) { if (++blank >= 1) break; continue; }
      blank = 0;
      if (/^nama paket$/i.test(nm)) break;
      const item = isi ? {
        name: isi,
        category: t.category >= 0 ? cellText(grid[r][t.category]) : '',
        normal: t.itemNormal >= 0 ? cellNum(grid[r][t.itemNormal]) : null,
        bottom: t.bottom >= 0 ? cellNum(grid[r][t.bottom]) : null,
        price: t.afterDisc >= 0 ? cellNum(grid[r][t.afterDisc]) : null,   // alokasi harga paket untuk isi ini
      } : null;
      if (nm) {
        cur = { name: nm.replace(/^\d+\.\s*/, '').trim(), contents: isi ? [isi] : [], items: item ? [item] : [], normal: t.normal >= 0 ? cellNum(grid[r][t.normal]) : null, promo: cellNum(grid[r][t.promo]), cell: at(r, t.col) };
        bundles.push(cur);
      } else if (cur && isi) { cur.contents.push(isi); cur.items.push(item); }
    }
  });
  bundles.forEach(b => {
    const sum = (k) => b.items.every(x => x[k]) ? b.items.reduce((a, x) => a + x[k], 0) : null;
    if (!b.normal) b.normal = sum('normal');
    b.bottom_total = sum('bottom');
    if (b.promo && b.normal && b.promo >= b.normal) issues.push({ lvl: 'bad', text: `Paket ${b.name}: harga paket ${rp(b.promo)} tidak lebih murah dari harga normal ${rp(b.normal)} (${b.cell}).` });
    if (b.promo && b.bottom_total && b.promo < b.bottom_total) issues.push({ lvl: 'warn', text: `Paket ${b.name}: harga paket ${rp(b.promo)} di bawah total harga terendah isinya ${rp(b.bottom_total)} (${b.cell}).` });
  });

  return {
    skipped: false,
    campaign: {
      id: `sheet-${source.month}-${slug(ws.name)}`,
      name, sheet: ws.name, audience,
      start: period.start, end: period.end,
      offer: rowOffer >= 0 ? cellText(grid[rowOffer][1]) : '',
      terms: [...terms, ...termsRight].map(t => t.replace(/[.\s]+$/, '')).join(' · '),
      source_url: `https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}`,
      source_title: source.title,
      items: items.map(({ cell, ...x }) => x),
      bundles: bundles.map(({ cell, ...x }) => x),
      issues,
    },
  };
}
const rp = (n) => (n === null || n === undefined) ? '-' : 'Rp ' + Number(n).toLocaleString('id-ID');

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} — spreadsheet belum dibagikan "siapa saja yang punya link"?`)); }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout 30 detik')));
    req.on('error', reject);
  });
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }

let _running = null;
async function syncPriceSheets() {
  if (_running) return _running;
  _running = (async () => {
    const cfg = readJson(SOURCES_FILE, { sources: [] });
    const prev = readJson(OUT_FILE, { sources: [] });
    const out = { fetched_at: new Date().toISOString(), sources: [] };
    for (const src of (cfg.sources || [])) {
      const [y, m] = String(src.month || '').split('-').map(Number);
      const entry = { month: src.month, title: src.title, spreadsheet_id: src.spreadsheet_id, url: `https://docs.google.com/spreadsheets/d/${src.spreadsheet_id}` };
      try {
        if (!y || !m) throw new Error('bulan sumber harus format YYYY-MM');
        const url = `https://docs.google.com/spreadsheets/d/${src.spreadsheet_id}/export?format=xlsx`;
        // Gangguan jaringan sesaat (ECONNRESET/timeout) dicoba ulang sekali; HTTP 4xx tidak.
        const buf = await download(url).catch(e => /^HTTP 4/.test(e.message) ? Promise.reject(e)
          : new Promise(r => setTimeout(r, 3000)).then(() => download(url)));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        entry.campaigns = []; entry.skipped = [];
        wb.worksheets.forEach(ws => {
          const r = parseWorksheet(ws, src, m - 1, y);
          if (r.skipped) entry.skipped.push({ sheet: ws.name, reason: r.reason });
          else entry.campaigns.push(r.campaign);
        });
        entry.ok = true;
        entry.synced_at = out.fetched_at;
      } catch (e) {
        // Gagal unduh/baca: pakai hasil terakhir yang berhasil supaya harga tidak hilang.
        const old = (prev.sources || []).find(s => s.spreadsheet_id === src.spreadsheet_id && s.ok !== false) || (prev.sources || []).find(s => s.spreadsheet_id === src.spreadsheet_id);
        Object.assign(entry, old ? { campaigns: old.campaigns || [], skipped: old.skipped || [], synced_at: old.synced_at } : { campaigns: [], skipped: [] });
        entry.ok = false;
        entry.error = e.message;
      }
      out.sources.push(entry);
    }
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    const tmp = OUT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
    fs.renameSync(tmp, OUT_FILE);
    return out;
  })();
  try { return await _running; } finally { _running = null; }
}

function getPriceSheetData() {
  return readJson(OUT_FILE, { fetched_at: null, sources: [] });
}

module.exports = { syncPriceSheets, getPriceSheetData, normName, parseWorksheet };
