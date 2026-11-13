/**
 * KEFIR CLINIC — Pembuat dokumen (Excel & PDF) untuk AI Assistant.
 *
 * Isi dokumen SELALU berasal dari hasil tool data (bukan teks yang ditulis
 * LLM), jadi angka di file sama persis dengan data klinik. Hasil tool yang
 * berbentuk JSON bebas diratakan menjadi tabel: setiap array objek jadi satu
 * tabel/sheet, nilai tunggal masuk ke tabel "Ringkasan".
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const DOCS_DIR = path.join(__dirname, 'data', 'generated_docs');
const MAX_ROWS_PER_TABLE = 5000;
const KEEP_DAYS = 7;
const BRAND_GREEN = '0B7A5C';

// ---------------------------------------------------------------------------
// JSON bebas → daftar tabel { name, columns, rows }
// ---------------------------------------------------------------------------
// Label kolom dalam bahasa Indonesia untuk field yang sering muncul.
const LABELS = {
  customer_name: 'Pasien', patient_name: 'Pasien', pasien: 'Pasien', customer_phone: 'Telepon', patient_phone: 'Telepon',
  customer_code: 'Kode Pasien', doctor_name: 'Dokter', therapist_name: 'Terapis', paymode: 'Metode Bayar',
  total: 'Total', discount: 'Diskon', remaining: 'Sisa Tagihan', status: 'Status', outlet: 'Cabang', branch: 'Cabang',
  inv_code: 'No. Invoice', inv_date: 'Tanggal Invoice', items_count: 'Jumlah Item',
  unredeemed_balance: 'Saldo Belum Dipakai', void_invoice: 'Void', backdated: 'Dicatat Belakangan',
  recorded_date: 'Tanggal Dicatat', subtotal_items: 'Subtotal Item', product_name: 'Produk', product_code: 'Kode Produk',
  qty: 'Qty', price: 'Harga', subtotal: 'Subtotal', items: 'Item', phone: 'Telepon', name: 'Nama'
};

function humanize(key) {
  const k = String(key);
  if (LABELS[k]) return LABELS[k];
  return k
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'Ya';
  if (v === false) return 'Tidak';
  if (v === 'NONE') return '-';
  if (Array.isArray(v)) {
    return v.map(x => (x && typeof x === 'object') ? Object.values(x).join(' ') : String(x)).join(', ');
  }
  if (typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => `${humanize(k)}: ${cellValue(x)}`).join('; ');
  }
  return v;
}

// Rapikan satu objek: pakai versi terformat (x_fmt / x_formatted) menggantikan
// nilai mentah x, dan buang ID internal. Nama kunci tetap nama dasar (x).
function tidyObject(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'id' || /_id$/.test(k)) continue;
    const base = k.replace(/_(fmt|formatted)$/, '');
    if (base !== k) { out[base] = v; continue; }
    if (`${k}_fmt` in o || `${k}_formatted` in o) continue;
    out[k] = v;
  }
  return out;
}

function flattenToTables(data, rootName = 'Data') {
  const tables = [];
  const summary = [];

  function walk(node, name, depth) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length === 0) return;
      const objects = node.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(tidyObject);
      if (objects.length) {
        const cols = [];
        objects.slice(0, 200).forEach(o => Object.keys(o).forEach(k => { if (!k.startsWith('_') && !cols.includes(k)) cols.push(k); }));
        tables.push({
          name,
          columns: cols,
          rows: objects.slice(0, MAX_ROWS_PER_TABLE).map(o => cols.map(c => cellValue(o[c]))),
          truncated: objects.length > MAX_ROWS_PER_TABLE ? objects.length : 0
        });
      } else {
        tables.push({ name, columns: ['Nilai'], rows: node.slice(0, MAX_ROWS_PER_TABLE).map(x => [cellValue(x)]) });
      }
      return;
    }
    if (typeof node === 'object') {
      Object.entries(tidyObject(node)).forEach(([k, v]) => {
        if (k.startsWith('_') && k !== '_catatan_akses') return;
        const childName = depth === 0 ? humanize(k) : `${name} · ${humanize(k)}`;
        if (v && typeof v === 'object') walk(v, childName, depth + 1);
        else summary.push([depth === 0 ? humanize(k) : `${name} · ${humanize(k)}`, cellValue(v)]);
      });
      return;
    }
    summary.push([name, cellValue(node)]);
  }

  walk(data, rootName, 0);
  if (summary.length) tables.unshift({ name: 'Ringkasan', columns: ['Keterangan', 'Nilai'], rows: summary });
  return tables;
}

// ---------------------------------------------------------------------------
// Penyimpanan
// ---------------------------------------------------------------------------
function safeFileName(title, ext) {
  const base = String(title || 'Dokumen KEFIR')
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'Dokumen_KEFIR';
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16).replace(/[-: ]/g, '');
  return `${base}_${stamp}.${ext}`;
}

function cleanupOld() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(DOCS_DIR)) {
      const p = path.join(DOCS_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) { /* folder belum ada */ }
}

function saveDocument(buffer, meta) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  cleanupOld();
  const id = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(DOCS_DIR, `${id}.bin`), buffer);
  fs.writeFileSync(path.join(DOCS_DIR, `${id}.json`), JSON.stringify({ ...meta, id, size: buffer.length, created_at: new Date().toISOString() }));
  return id;
}

function loadDocument(id) {
  if (!/^[a-f0-9]{24}$/.test(String(id || ''))) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, `${id}.json`), 'utf8'));
    const buffer = fs.readFileSync(path.join(DOCS_DIR, `${id}.bin`));
    return { meta, buffer };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
async function buildExcel(title, tables, subtitle) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KEFIR AI';
  wb.created = new Date();
  const used = new Set();

  tables.forEach(t => {
    let sheetName = t.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Data';
    let n = 2;
    while (used.has(sheetName.toLowerCase())) sheetName = `${sheetName.slice(0, 28)} ${n++}`;
    used.add(sheetName.toLowerCase());
    const ws = wb.addWorksheet(sheetName);

    ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF' + BRAND_GREEN } };
    ws.addRow([subtitle]).font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    ws.addRow([]);
    const header = ws.addRow(t.columns.map(humanize));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND_GREEN } };
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    t.rows.forEach(r => ws.addRow(r));
    if (t.truncated) ws.addRow([`Ditampilkan ${MAX_ROWS_PER_TABLE} dari ${t.truncated} baris.`]).font = { italic: true };

    ws.views = [{ state: 'frozen', ySplit: 4 }];
    t.columns.forEach((c, i) => {
      const longest = Math.max(humanize(c).length, ...t.rows.slice(0, 300).map(r => String(r[i] ?? '').length));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
      ws.getColumn(i + 1).alignment = { vertical: 'top', wrapText: longest > 60 };
    });
  });

  if (!tables.length) wb.addWorksheet('Data').addRow(['Tidak ada data untuk permintaan ini.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
// Font bawaan PDF hanya mendukung Latin-1 — emoji & simbol lain dibuang.
const latin1 = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '').trim();

function buildPdf(title, tables, subtitle) {
  return new Promise((resolve) => {
    const wide = tables.some(t => t.columns.length > 5);
    const doc = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margin: 36, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const left = doc.page.margins.left;
    const usable = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    doc.fillColor('#' + BRAND_GREEN).font('Helvetica-Bold').fontSize(16).text('KEFIR Derma Clinic', left);
    doc.fillColor('#1D2820').font('Helvetica-Bold').fontSize(13).text(latin1(title));
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(latin1(subtitle));
    doc.moveDown(0.8);

    const MAX_COLS = wide ? 9 : 6;
    tables.forEach(t => {
      const cols = t.columns.slice(0, MAX_COLS);
      const rows = t.rows.slice(0, 400);
      if (doc.y > bottom() - 60) doc.addPage();
      doc.fillColor('#1D2820').font('Helvetica-Bold').fontSize(11).text(latin1(t.name), left);
      doc.moveDown(0.3);

      const width = usable();
      const lens = cols.map((c, i) => Math.max(humanize(c).length, ...rows.slice(0, 80).map(r => Math.min(40, String(r[i] ?? '').length))));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      const colW = lens.map(l => Math.max(45, (l / total) * width));
      const scale = width / colW.reduce((a, b) => a + b, 0);
      for (let i = 0; i < colW.length; i++) colW[i] *= scale;

      const drawRow = (cells, isHeader) => {
        doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const heights = cells.map((c, i) => doc.heightOfString(latin1(c), { width: colW[i] - 8 }));
        const h = Math.max(...heights, 10) + 8;
        if (doc.y + h > bottom()) { doc.addPage(); if (!isHeader) drawRow(cols.map(humanize), true); }
        const y = doc.y;
        if (isHeader) doc.rect(left, y, width, h).fill('#' + BRAND_GREEN);
        else doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.4).strokeColor('#DCE3DC').stroke();
        let x = left;
        cells.forEach((c, i) => {
          doc.fillColor(isHeader ? '#FFFFFF' : '#1D2820').font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
            .text(latin1(c), x + 4, y + 4, { width: colW[i] - 8 });
          x += colW[i];
        });
        doc.y = y + h;
        doc.x = left;
      };

      drawRow(cols.map(humanize), true);
      rows.forEach(r => drawRow(r.slice(0, MAX_COLS), false));
      const notes = [];
      if (t.columns.length > MAX_COLS) notes.push(`${t.columns.length - MAX_COLS} kolom lain ada di versi Excel.`);
      if (t.rows.length > rows.length || t.truncated) notes.push(`Ditampilkan ${rows.length} dari ${t.truncated || t.rows.length} baris; versi lengkap ada di Excel.`);
      if (notes.length) doc.moveDown(0.3).fillColor('#6B7280').font('Helvetica-Oblique').fontSize(8).text(notes.join(' '), left);
      doc.moveDown(1);
    });

    if (!tables.length) doc.fillColor('#1D2820').font('Helvetica').fontSize(10).text('Tidak ada data untuk permintaan ini.');

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#9CA3AF').font('Helvetica').fontSize(7.5)
        .text(`Dibuat otomatis oleh KEFIR AI dari data Neosoft & spreadsheet klinik · Halaman ${i + 1} dari ${range.count}`,
          left, doc.page.height - doc.page.margins.bottom + 12, { width: usable(), align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// API utama
// ---------------------------------------------------------------------------
async function createDocument({ title, format, data, sourceLabel, owner, role }) {
  const fmt = format === 'pdf' ? 'pdf' : 'excel';
  const tables = flattenToTables(data, title);
  const when = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' });
  const subtitle = `Dibuat ${when} WIB · Sumber: ${sourceLabel || 'data klinik'}`;
  const buffer = fmt === 'pdf' ? await buildPdf(title, tables, subtitle) : await buildExcel(title, tables, subtitle);
  const ext = fmt === 'pdf' ? 'pdf' : 'xlsx';
  const fileName = safeFileName(title, ext);
  const mimetype = fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const id = saveDocument(buffer, { title, fileName, mimetype, format: fmt, owner: owner || null, role: role || null });
  return {
    id,
    fileName,
    mimetype,
    format: fmt,
    size: buffer.length,
    tables: tables.map(t => ({ name: t.name, rows: t.rows.length }))
  };
}

module.exports = { createDocument, loadDocument, flattenToTables };
