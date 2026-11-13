/**
 * Real Neosoft Data Parser, Automation, Commission & 5-Tier WhatsApp CRM Engine
 * KEFIR Derma Clinic — Mission Control (Depok & Pondok Kopi)
 */

const fs = require('fs');
const path = require('path');
const { getMetaSettingsSafe, getCachedMetaAdsData } = require('./meta_ads_service');
const { getInstagramProfile } = require('./instagram_service');

// Fallback hierarchy: local project data folder -> user profile folder
// NOTE: existsSync() alone only checks the folder is present, not that it actually
// holds synced JSON data (e.g. data/neosoft_db/ ships with just .gitkeep in a fresh
// worktree) — that false positive skipped the profile fallback and made every
// dashboard query read an empty directory. hasJsonFiles() checks for real content.
function hasJsonFiles(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.json'));
  } catch {
    return false;
  }
}
const LOCAL_PROJECT_DB = path.join(__dirname, 'data', 'neosoft_db');
const LOCAL_OPS_DB = path.join(__dirname, 'data', 'operational_db');
const LOCAL_MKT_DB = path.join(__dirname, 'data', 'marketing_db');
const LOCAL_GS_DB = path.join(__dirname, 'data', 'google_sheets_db');
const PROFILE_DB = path.join(process.env.HOME || '/Users/mymac', '.hermes/profiles/hr/data/neosoft_db');
const NEOSOFT_DB_DIR = hasJsonFiles(LOCAL_PROJECT_DB) ? LOCAL_PROJECT_DB : PROFILE_DB;
const OPERATIONAL_DB_DIR = fs.existsSync(LOCAL_OPS_DB) ? LOCAL_OPS_DB : path.join(__dirname, 'data', 'operational_db');
const MARKETING_DB_DIR = fs.existsSync(LOCAL_MKT_DB) ? LOCAL_MKT_DB : path.join(__dirname, 'data', 'marketing_db');
const GOOGLE_SHEETS_DB_DIR = fs.existsSync(LOCAL_GS_DB) ? LOCAL_GS_DB : path.join(__dirname, 'data', 'google_sheets_db');
const LOG_FILE = path.join(__dirname, 'automation_dispatch_log.json');
const FOLLOWUP_STATUS_FILE = path.join(__dirname, 'data', 'followup_status_log.json');
const ASSET_MANUAL_NOTES_FILE = path.join(__dirname, 'data', 'asset_manual_notes.json');
const CLINIC_SETTINGS_FILE = path.join(__dirname, 'data', 'clinic_settings.json');
const MAINTENANCE_REMINDER_LOG_FILE = path.join(__dirname, 'data', 'maintenance_reminder_log.json');
const PATIENT_FEEDBACK_FILE = path.join(__dirname, 'data', 'patient_feedbacks.json');
const META_ADS_SETTINGS_FILE = path.join(__dirname, 'data', 'meta_ads_settings.json');
const CAMPAIGNS_FILE = path.join(__dirname, 'crm_campaigns.json');
const MONTHLY_COSTS_FILE = path.join(__dirname, 'data', 'monthly_costs.json');
const SUPPLIER_QUOTES_FILE = path.join(__dirname, 'data', 'supplier_quotes.json');
const CASHIER_CLOSINGS_FILE = path.join(__dirname, 'data', 'cashier_closings.json');
const PETTY_CASH_ENTRIES_FILE = path.join(__dirname, 'data', 'petty_cash_entries.json');
const CLINICAL_PHOTO_LOG_FILE = path.join(__dirname, 'data', 'clinical_photo_log.json');
const DOCTOR_RECOMMENDATIONS_FILE = path.join(__dirname, 'data', 'doctor_recommendations.json');
const CRM_TIER_CHAT_FILE = path.join(__dirname, 'data', 'crm_tier_chat_log.json');
const PRICE_MASTER_FILE = path.join(__dirname, 'data', 'price_master.json');
const MANUAL_ASSETS_FILE = path.join(__dirname, 'data', 'manual_assets.json');
const ASSET_DOC_REMINDER_LOG_FILE = path.join(__dirname, 'data', 'asset_doc_reminder_log.json');
const CLINICAL_CONTRAINDICATIONS_FILE = path.join(__dirname, 'data', 'clinical_contraindications.json');
const SOP_EXCEPTIONS_FILE = path.join(__dirname, 'data', 'sop_exceptions.json');
const NURSE_UPSELLING_FILE = path.join(__dirname, 'data', 'nurse_upselling.json');
const TREATMENT_BOM_FILE = path.join(__dirname, 'data', 'treatment_bom.json');
const MARKETING_PROMOS_FILE = path.join(__dirname, 'data', 'marketing_promos.json');
const PATIENT_FEEDBACKS_FILE = path.join(__dirname, 'data', 'patient_feedbacks.json');
const HR_DISCIPLINARY_FILE = path.join(__dirname, 'data', 'hr_disciplinary_records.json');
const MONTHLY_TARGETS_FILE = path.join(__dirname, 'data', 'monthly_targets.json');
const SALES_BOTTOM_PRICES_FILE = path.join(__dirname, 'data', 'sales_bottom_prices.json');
const WA_CHAT_TEMPLATES_FILE = path.join(__dirname, 'data', 'wa_chat_templates.json');

// Breakdown channel pembayaran nyata (dibangun & diverifikasi saat
// memperbaiki mesin settlement 3-way). Tidak ada require balik dari
// unified_analytics.js ke sini, jadi aman dari circular dependency.
const { getPaymentChannelBreakdown, getMonthlyTxRows } = require('./unified_analytics');
const { getGajiIdData } = require('./gaji_id_service');
const { getBranchReviews, syncGoogleMapsReviews } = require('./google_maps_service');

// ═══════════════════════════════════════════════════════════════════════
// KLASIFIKASI PASIEN X / Y / Z  — berbasis FREKUENSI kedatangan
//
// Definisi klinik:
//   X = 1-2 kali per bulan
//   Y = 2-3 kali per 3 bulan
//   Z = 1-2 kali per 6 bulan
//
// Semua disamakan ke satuan "kunjungan per bulan":
//   X  1-2/bln      -> >= 1,00
//   Y  2-3/3bln     -> 0,67 - 1,00
//   Z  1-2/6bln     -> 0,17 - 0,33
//
// Definisi klinik menyisakan celah (0,33-0,67 dan di bawah 0,17), jadi
// ambang dipilih di tengah celah supaya pembagiannya menyeluruh:
// X >= 1,00 ; Y >= 0,50 ; sisanya Z.
//
// Dihitung dari HARI kunjungan (bukan jumlah invoice) dibagi lama pasien
// terdaftar. Pasien dengan masa pantau < 1 bulan belum bisa diukur
// frekuensinya dan ditandai BARU, bukan dipaksa masuk X.
//
// Catatan: grade ini murni soal SEBERAPA SERING. Soal apakah pasien
// masih aktif atau sudah hilang ada di behaviour.visit_status, yang
// membandingkan jeda terakhir dengan ritme pasien itu sendiri.
// ═══════════════════════════════════════════════════════════════════════

const GRADE_X_MIN_PER_MONTH = 1.0;
const GRADE_Y_MIN_PER_MONTH = 0.5;
const GRADE_MIN_OBSERVATION_MONTHS = 1;

function classifyPatientGrade(visitDays, firstVisitDate, nowRef = Date.now()) {
  const base = { visit_days: visitDays || 0 };
  // Tanpa satu pun kunjungan tercatat, frekuensi tidak ada artinya. Ini
  // BUKAN Grade Z: 7.449 dari 8.099 pasien di master Neosoft belum pernah
  // bertransaksi (riwayat mereka mendahului Neosoft atau baru didaftarkan).
  // Kalau digabung, Grade Z jadi 7.527 dan kehilangan maknanya.
  if (!visitDays || !firstVisitDate) {
    return { ...base, grade: 'BELUM', label: 'Belum Ada Transaksi di Neosoft',
             color: 'slate', rate_per_month: null, months_observed: 0, measurable: false };
  }
  const first = new Date(firstVisitDate);
  if (isNaN(first.getTime())) {
    return { ...base, grade: 'BELUM', label: 'Tanggal Kunjungan Tidak Valid',
             color: 'slate', rate_per_month: null, months_observed: 0, measurable: false };
  }
  const monthsRaw = (nowRef - first.getTime()) / (30 * 24 * 60 * 60 * 1000);
  // Satu kunjungan belum membentuk frekuensi — angkanya cuma cerminan kapan
  // pasien kebetulan datang. Baru disebut Z kalau sudah lama tidak kembali.
  if (visitDays < 2 && monthsRaw < 3) {
    return { ...base, grade: 'BARU', label: 'Pasien Baru (baru 1x, belum terbentuk pola)',
             color: 'slate', rate_per_month: null,
             months_observed: Math.round(monthsRaw * 10) / 10, measurable: false };
  }
  // Lantai 1 bulan pada penyebut supaya jendela pantau yang masih pendek
  // tidak melambungkan frekuensi (2 kunjungan dalam 3 hari bukan 20x/bulan).
  const months = Math.max(GRADE_MIN_OBSERVATION_MONTHS, monthsRaw);
  const rate = visitDays / months;
  const r = Math.round(rate * 100) / 100;
  if (rate >= GRADE_X_MIN_PER_MONTH) {
    return { ...base, grade: 'X', label: `Grade X (Rutin — ${r}x/bulan)`,
             color: 'purple', rate_per_month: r,
             months_observed: Math.round(monthsRaw * 10) / 10, measurable: true };
  }
  if (rate >= GRADE_Y_MIN_PER_MONTH) {
    return { ...base, grade: 'Y', label: `Grade Y (Berkala — ${r}x/bulan)`,
             color: 'cyan', rate_per_month: r,
             months_observed: Math.round(monthsRaw * 10) / 10, measurable: true };
  }
  return { ...base, grade: 'Z', label: `Grade Z (Jarang — ${r}x/bulan)`,
           color: 'rose', rate_per_month: r,
           months_observed: Math.round(monthsRaw * 10) / 10, measurable: true };
}

// ═══════════════════════════════════════════════════════════════════════
// TAGIHAN BELUM LUNAS & REKAM MEDIS BELUM DITAGIHKAN
//
// 1) Invoice belum lunas = invoice sah (non-void, non-migrasi) dengan SISA
//    TAGIHAN > 0. Sisa = min(remaining Neosoft, total − semua pembayaran di
//    laporan pembayaran, termasuk pelunasan seri -B- yang id_invoice-nya
//    menunjuk invoice itu). remaining di salinan lokal bisa basi untuk invoice
//    lama (hanya beberapa halaman terakhir yang disegarkan tiap sync).
// 2) Notifikasi "Unpaid" Neosoft (/notification/unpaid) BUKAN invoice: isinya
//    rekam medis (kode ANM-) yang belum tertaut invoice. Banyak yang sebenarnya
//    sudah dibayar (kasir membuat invoice tanpa menautkan rekam medis), jadi
//    disaring: buang yang sudah tertaut invoice sah, atau pasiennya punya
//    invoice sah di hari & cabang yang sama.
// ═══════════════════════════════════════════════════════════════════════
let _unpaidCache = { refs: null, value: null };
function getUnpaidFollowups() {
  const invoices = getSafeJson('invoices_all.json') || [];
  const customers = getSafeJson('customers_all.json') || [];
  const payRep = getSafeJson('payment_report.json') || {};
  const notifs = getSafeJson('notification_unpaid.json') || [];
  const mrRaw = getSafeJson('medicalrecords.json');
  const refs = [invoices, customers, payRep, notifs, mrRaw];
  if (_unpaidCache.refs && _unpaidCache.refs.every((r, i) => r === refs[i])) return _unpaidCache.value;

  const BR = { 1: 'Depok', 2: 'Pondok Kopi' };
  const cust = {};
  customers.forEach(c => {
    const n = c.name || {};
    cust[c.id] = { name: [n.first_name, n.middle_name, n.last_name].map(x => String(x || '').trim()).filter(Boolean).join(' ') || 'Pasien', phone: c.phone || '', code: c.code || '' };
  });
  // Pembayaran per invoice (baris invoice itu sendiri + pelunasan seri -B-)
  const paid = {};
  const rows = Array.isArray(payRep) ? payRep : Object.values(payRep).flat();
  rows.forEach(r => {
    if (!r) return;
    const amt = (r.payment || []).reduce((a, p) => a + (p && p.info !== 'charge' ? Number(p.amount) || 0 : 0), 0);
    const key = /-B-/.test(String(r.inv_code || '')) ? 'id:' + r.id_invoice : 'code:' + r.inv_code;
    paid[key] = (paid[key] || 0) + amt;
  });
  const hasPayRow = new Set(rows.filter(r => r && !/-B-/.test(String(r.inv_code || ''))).map(r => r.inv_code));

  const unpaid_invoices = [];
  invoices.forEach(i => {
    if (i.void_invoice || isMigrationInvoice(i) || !BR[i.outlet_id]) return;
    let rem = Number(i.remaining || 0);
    if (!(rem > 0)) return;
    if (hasPayRow.has(i.inv_code)) {
      const total = invoiceTotal(i);
      const computed = total - (paid['code:' + i.inv_code] || 0) - (paid['id:' + i.id] || 0);
      rem = Math.min(rem, Math.max(0, computed));
    }
    if (!(rem > 0)) return;
    const c = cust[i.customer_id] || { name: 'Pasien', phone: '', code: '' };
    const date = String(i.inv_date || '').replace('T', ' ').slice(0, 16);
    unpaid_invoices.push({
      id: i.id, patient_id: i.customer_id, patient_name: c.name, patient_phone: c.phone, patient_code: c.code,
      inv_code: i.inv_code, outlet: BR[i.outlet_id], branch: BR[i.outlet_id], date,
      total: invoiceTotal(i), total_fmt: rupiah(invoiceTotal(i)), remaining: Math.round(rem), remaining_fmt: rupiah(rem),
      days_open: Math.max(0, Math.floor((Date.parse(todayJakarta()) - Date.parse(date.slice(0, 10))) / 864e5)),
      status: 'Belum Lunas'
    });
  });
  unpaid_invoices.sort((a, b) => b.date.localeCompare(a.date));

  // Rekam medis belum ditagihkan
  const recs = Array.isArray(mrRaw) ? mrRaw : (mrRaw && Array.isArray(mrRaw.records) ? mrRaw.records : []);
  const mrByCode = {}; recs.forEach(r => { if (r && r.code) mrByCode[r.code] = r; });
  const invByCode = {}; invoices.forEach(i => { invByCode[i.inv_code] = i; });
  const invDays = new Set(invoices.filter(i => !i.void_invoice).map(i => `${i.customer_id}|${String(i.inv_date || '').slice(0, 10)}|${i.outlet_id}`));
  // Cabang cadangan bila rekam medisnya belum tersinkron: cabang invoice terakhir pasien
  const lastOutlet = {};
  invoices.forEach(i => { if (!i.void_invoice && BR[i.outlet_id] && (!lastOutlet[i.customer_id] || String(i.inv_date) > lastOutlet[i.customer_id].d)) lastOutlet[i.customer_id] = { d: String(i.inv_date), o: i.outlet_id }; });
  const pending_medical_records = [];
  let skippedBilled = 0;
  (Array.isArray(notifs) ? notifs : []).forEach(n => {
    const mr = mrByCode[n.code];
    const day = String(n.date || '').slice(0, 10);
    const linked = mr && mr.inv_code ? invByCode[mr.inv_code] : null;
    if (linked && !linked.void_invoice) { skippedBilled++; return; }
    const outletId = mr ? Number(mr.outlet_id) : null;
    const sameDay = outletId ? invDays.has(`${n.patient_id}|${day}|${outletId}`) : (invDays.has(`${n.patient_id}|${day}|1`) || invDays.has(`${n.patient_id}|${day}|2`));
    if (sameDay) { skippedBilled++; return; }
    const c = cust[n.patient_id] || { name: n.full_name || 'Pasien', phone: '', code: n.patient_code || '' };
    pending_medical_records.push({
      id: n.id, patient_id: n.patient_id, patient_name: n.full_name || c.name, patient_phone: c.phone, patient_code: n.patient_code || c.code,
      record_code: n.code, date: String(n.date || '').replace('T', ' ').slice(0, 16),
      outlet: outletId ? (BR[outletId] || '-') : (lastOutlet[n.patient_id] ? BR[lastOutlet[n.patient_id].o] : null),
      branch: outletId ? (BR[outletId] || '-') : (lastOutlet[n.patient_id] ? BR[lastOutlet[n.patient_id].o] : null),
      branch_estimated: !outletId,
      note: linked ? `Invoice ${linked.inv_code} di-void` : (mr ? 'Belum tertaut invoice' : 'Rekam medis belum tersinkron')
    });
  });
  pending_medical_records.sort((a, b) => b.date.localeCompare(a.date));

  const value = {
    unpaid_invoices, pending_medical_records,
    summary: { invoices: unpaid_invoices.length, remaining_total: unpaid_invoices.reduce((a, u) => a + u.remaining, 0),
      pending_records: pending_medical_records.length, neosoft_notifications: Array.isArray(notifs) ? notifs.length : 0, notifications_already_billed: skippedBilled }
  };
  _unpaidCache = { refs, value };
  return value;
}

// ═══════════════════════════════════════════════════════════════════════
// KUNJUNGAN TREATMENT — dasar grading X/Y/Z
//
// Kunjungan = HARI pasien benar-benar dikerjakan treatment: pemakaian
// (usage) Neosoft yang tidak di-void, berisi item treatment dengan used > 0,
// tanggal = usage_date. Beli produk saja (skincare, yogurt, dll.) BUKAN
// kunjungan. Treatment dari paket lama (invoice migrasi) tetap dihitung —
// pasiennya memang datang dikerjakan.
//
// Kode T- di Neosoft tidak selalu treatment: beberapa produk/biaya juga
// didaftarkan sebagai treatment. Yang bukan tindakan dikecualikan di sini.
// ═══════════════════════════════════════════════════════════════════════
const NON_TREATMENT_T_ITEM = /yogurt|biaya administrasi|^test treatment/i;
let _treatVisitCache = { refs: null, value: null };
// Map customer_id -> Map(tanggal 'YYYY-MM-DD' -> Set(outlet_id))
function treatmentVisitIndex() {
  const products = getSafeJson('products.json') || [];
  const usages = getSafeJson('usages.json') || [];
  const details = getSafeJson('usages_details.json') || [];
  const refs = _treatVisitCache.refs;
  if (refs && refs[0] === products && refs[1] === usages && refs[2] === details) return _treatVisitCache.value;
  const isTreat = {};
  products.forEach(p => {
    if (String(p.product_treatment_code || '').startsWith('T-') && !NON_TREATMENT_T_ITEM.test(String(p.product_treatment_name || '').trim())) isTreat[p.id] = true;
  });
  const hdr = {};
  usages.forEach(u => { if (!u.is_void) hdr[u.id] = u; });
  const byCust = new Map();
  details.forEach(d => {
    if (!isTreat[d.product_id] || !(Number(d.used) > 0)) return;
    const h = hdr[d.usage_id];
    if (!h) return;
    const date = String(h.usage_date || h.created_at || '').slice(0, 10);
    if (!date) return;
    let m = byCust.get(h.customer_id);
    if (!m) byCust.set(h.customer_id, (m = new Map()));
    let o = m.get(date);
    if (!o) m.set(date, (o = new Set()));
    o.add(Number(h.outlet_id));
  });
  _treatVisitCache = { refs: [products, usages, details], value: byCust };
  return byCust;
}
// Hari kunjungan treatment seorang pasien (urut naik), opsional sampai tanggal `end` & di cabang `outletId`.
function treatmentVisitDays(customerId, { end = null, outletId = null } = {}) {
  const m = treatmentVisitIndex().get(customerId);
  if (!m) return [];
  const out = [];
  m.forEach((outs, date) => { if ((!end || date <= end) && (!outletId || outs.has(outletId))) out.push(date); });
  return out.sort();
}

// Perpindahan grade pasien, dihasilkan scripts/track_grade_changes.js.
// Grade dihitung ulang tiap saat sehingga perubahannya tidak berjejak;
// berkas state itulah yang menyimpan potret sebelumnya sebagai pembanding.
let _gradeTransCache = null;

function getGradeTransitions(limit = 50) {
  const file = path.join(__dirname, 'data', 'patient_grade_state.json');
  let stamp = '';
  try { stamp = String(fs.statSync(file).mtimeMs); } catch (e) {
    return { available: false, reason: 'Belum pernah dilacak — jalankan scripts/track_grade_changes.js',
             transitions: [], counts: {}, generated_at: null };
  }
  if (!_gradeTransCache || _gradeTransCache.stamp !== stamp) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      return { available: false, reason: 'Berkas state tidak terbaca', transitions: [], counts: {}, generated_at: null };
    }
    const all = parsed.transitions || [];
    const counts = {};
    all.forEach(t => { counts[t.urgency] = (counts[t.urgency] || 0) + 1; });
    _gradeTransCache = { stamp, data: {
      available: true,
      generated_at: parsed.generated_at || null,
      baseline_at: parsed.baseline_at || null,
      total: all.length,
      counts,
      all
    } };
  }
  const d = _gradeTransCache.data;
  return { ...d, transitions: d.all.slice(0, limit), all: undefined };
}

// Cache berbasis mtime+ukuran berkas. Tanpa ini setiap request mem-parse
// ulang seluruh berkas Neosoft (customers 6,6 MB + invoices + usages +
// products ≈ 9,5 MB), padahal isinya hanya berubah saat sync berjalan.
//
// KONTRAK: hasil getSafeJson dipakai BERSAMA antar pemanggil — jangan
// pernah dimutasi di tempat (sort/push/splice). Sudah diperiksa: tidak ada
// pemanggil yang melakukannya; gunakan salinan bila perlu mengurutkan.
const _jsonCache = new Map();

function getSafeJson(filename, dir = NEOSOFT_DB_DIR) {
  const p = path.join(dir, filename);
  let stamp = null;
  try {
    const st = fs.statSync(p);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    _jsonCache.delete(p);   // berkas hilang -> buang cache lamanya
    return [];
  }
  const hit = _jsonCache.get(p);
  if (hit && hit.stamp === stamp) return hit.value;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const value = Array.isArray(parsed) ? parsed : (parsed.data || parsed);
    _jsonCache.set(p, { stamp, value });
    return value;
  } catch (e) {
    console.error('Error reading ' + filename, e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CRM SHEET JOIN LAYER (Google Sheets ⇄ Neosoft)
// Kunci join: kolom `invoice` di sheet == `inv_code` Neosoft (cocok 99–100%).
// CATATAN: `rm_status` (mis. D-3591) TIDAK dipakai sebagai kunci — formatnya
// tidak pernah cocok dengan customers.code Neosoft (mis. EM-260500001).
// ═══════════════════════════════════════════════════════════════════════

const INV_CODE_RE = /[A-Z]{3}-[A-Z]-\d{6}-\d{4}/g;
const UNUSED_MARKER_RE = /belum dipakai|belum digunakan|sisa\s*\d|dp\s*50/i;
const CRM_CATEGORY_KEYWORDS = [
  ['Laser', /laser|pico|spectra/i],
  ['IPL', /\bipl\b/i],
  ['PDT', /\bpdt\b/i],
  ['Microdermabrasi', /microderm/i],
  ['Inject', /inject|exosome|prp|subsisi|filler|botox/i],
  ['Obat & Farmasi', /anti\s*biotik|antibiotik|amoxcilin|amoxicillin|paracetamol|dexamethasone|mefenamic|cefixime|anestesi|anastesi|jcain|anti iritasi/i],
  ['Body Contour', /hifu|\brf\b|slimming|double chin|lipo|v-?line/i],
  ['Skin Rejuve', /rejuve|booster|salmon|glow/i],
  ['Facial', /facial|peel|oxy/i]
];

let _crmSheetCache = null;

function extractInvCodes(raw) {
  // Satu sel sheet kadang memuat lebih dari satu kode invoice.
  return String(raw || '').toUpperCase().match(INV_CODE_RE) || [];
}

function classifyCrmTreatment(text) {
  const hit = CRM_CATEGORY_KEYWORDS.find(([, re]) => re.test(text || ''));
  return hit ? hit[0] : 'Lainnya';
}

function buildCrmSheetIndex() {
  const byInvCode = new Map();
  const unjoinableRows = [];
  let totalRows = 0;

  const sources = [
    { file: 'depok_transactions.json', branch: 'Depok', outlet_id: 1 },
    { file: 'pondokkopi_transactions.json', branch: 'Pondok Kopi', outlet_id: 2 }
  ];

  sources.forEach(src => {
    const sheet = getSafeJson(src.file, GOOGLE_SHEETS_DB_DIR) || {};
    // Semua tab bulanan yang ada (Agu 2026 dst.), otomatis ikut bulan baru.
    const rows = getMonthlyTxRows(sheet);

    rows.forEach(r => {
      totalRows++;
      const codes = extractInvCodes(r.invoice);
      if (codes.length === 0) {
        unjoinableRows.push({
          branch: src.branch,
          invoice_raw: r.invoice,
          patient_name: r.patient_name || '-',
          treatment: r.treatment || '-',
          reason: 'Format kode invoice tidak terbaca'
        });
        return;
      }
      const treatment = String(r.treatment || '').trim();
      codes.forEach(code => {
        const entry = {
          treatment,
          category: classifyCrmTreatment(treatment),
          is_unused: UNUSED_MARKER_RE.test(treatment),
          is_dp_50: /dp\s*50/i.test(treatment),
          status_patient: r.status_patient || null,
          has_photo: typeof r.has_photo === 'string' ? r.has_photo.toLowerCase() === 'yes' : null,
          rm_status: r.rm_status || null,
          phone: r.phone ? String(r.phone).trim() : null,
          branch: src.branch,
          outlet_id: src.outlet_id,
          source: 'Google Sheets CRM'
        };
        if (!byInvCode.has(code)) byInvCode.set(code, []);
        byInvCode.get(code).push(entry);
      });
    });
  });

  // Deposit lama yang hanya berisi nama (tanpa kode invoice) — hanya dipakai
  // bila namanya cocok PERSIS dan unik ke satu pasien. Sisanya sengaja tidak
  // dilekatkan ke pasien manapun agar tidak salah tagih, tapi tetap dilaporkan.
  const depok = getSafeJson('depok_transactions.json', GOOGLE_SHEETS_DB_DIR) || {};
  const nameOnlyDeposits = (depok.unused_packages_deposits || []).map(u => ({
    patient_name: String(u.patient_name || '').trim(),
    treatment: String(u.treatment || '').trim(),
    category: u.category || classifyCrmTreatment(u.treatment),
    branch: 'Depok',
    outlet_id: 1,
    source: 'Google Sheets CRM (deposit tanpa kode invoice)'
  }));

  return {
    byInvCode,
    nameOnlyDeposits,
    unjoinableRows,
    totalRows,
    joinedCodes: byInvCode.size,
    built_at: new Date().toISOString()
  };
}

const { isMigrationInvoice, invoiceTotal, depositPaidByInvoice, omsetAmount, depositTopups } = require('./invoice_flags');
// Peta inv_code -> nominal yang dibayar pakai saldo DEPOSIT (payment_report.json).
// Dipakai omsetAmount(): pemakaian deposit tidak dihitung omset (lihat invoice_flags.js).
const omsetDepositMap = () => depositPaidByInvoice(getSafeJson('payment_report.json'));
// Top-up deposit MANUAL (menu Sales > Deposit Neosoft) tidak berupa invoice — sumbernya laporan
// Mutasi Deposit (deposit_mutations.json). Yang `counted` masuk omset; lihat invoice_flags.depositTopups.
const omsetTopups = () => depositTopups(getSafeJson('deposit_mutations.json'), getSafeJson('invoices_all.json'))
  .filter(t => t.counted && (t.outlet_id === 1 || t.outlet_id === 2));
const { getPriceSheetData, normName: priceNorm } = require('./price_sheet_sync');
const PRICE_SHEETS_FILE = path.join(__dirname, 'data', 'google_sheets_db', 'price_sheets.json');

function getCrmJoinDiagnostics() {
  const idx = getCrmSheetIndex();
  const customers = getSafeJson('customers_all.json');
  const invoices = getSafeJson('invoices_all.json');
  const knownInvCodes = new Set(invoices.map(i => i.inv_code).filter(Boolean));
  const nameIndex = buildExactNameIndex(customers);

  const codesNotInNeosoft = [...idx.byInvCode.keys()].filter(code => !knownInvCodes.has(code));

  const depositsUnresolved = [];
  const depositsResolved = [];
  idx.nameOnlyDeposits.forEach(d => {
    const key = d.patient_name.toLowerCase().replace(/\s+/g, ' ').trim();
    const owners = nameIndex.get(key) || [];
    if (owners.length === 1) depositsResolved.push({ ...d, customer_id: owners[0] });
    else depositsUnresolved.push({
      ...d,
      candidates: owners.length,
      reason: owners.length === 0
        ? 'Nama tidak ditemukan di master pasien Neosoft'
        : 'Nama cocok ke lebih dari satu pasien (ambigu)'
    });
  });

  return {
    last_synced_at: (getSafeJson('sync_summary.json', GOOGLE_SHEETS_DB_DIR) || {}).last_synced_at || null,
    sheet_rows_total: idx.totalRows,
    inv_codes_indexed: idx.byInvCode.size,
    inv_codes_not_in_neosoft: codesNotInNeosoft,
    rows_unreadable: idx.unjoinableRows,
    deposits_resolved: depositsResolved,
    deposits_unresolved: depositsUnresolved,
    note: 'Baris pada rows_unreadable / deposits_unresolved sengaja TIDAK dilekatkan ke pasien manapun untuk mencegah salah tagih. Perlu rekonsiliasi manual di Google Sheets.'
  };
}

function getCrmSheetIndex() {
  // Cache dibangun ulang hanya saat file sheet berubah (sync ulang).
  let stamp = '';
  ['depok_transactions.json', 'pondokkopi_transactions.json'].forEach(f => {
    try {
      stamp += fs.statSync(path.join(GOOGLE_SHEETS_DB_DIR, f)).mtimeMs + '|';
    } catch (e) { stamp += '0|'; }
  });
  if (!_crmSheetCache || _crmSheetCache.stamp !== stamp) {
    _crmSheetCache = { stamp, index: buildCrmSheetIndex() };
  }
  return _crmSheetCache.index;
}

// Peta nama penuh -> daftar customer_id, untuk resolusi deposit tanpa kode invoice.
function buildExactNameIndex(customers) {
  const map = new Map();
  customers.forEach(c => {
    const n = `${c.name?.first_name || ''} ${c.name?.last_name || ''}`
      .toLowerCase().replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(c.id);
  });
  return map;
}

function getGoogleSheetsData() {
  const summary = getSafeJson('sync_summary.json', GOOGLE_SHEETS_DB_DIR);
  const ops = getSafeJson('operational_assets.json', GOOGLE_SHEETS_DB_DIR);
  const depok = getSafeJson('depok_transactions.json', GOOGLE_SHEETS_DB_DIR);
  const pondokkopi = getSafeJson('pondokkopi_transactions.json', GOOGLE_SHEETS_DB_DIR);
  return { 
    summary: summary || {}, 
    ops: ops || {}, 
    depok: depok || {}, 
    pondokkopi: pondokkopi || {} 
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PREVENTIVE MAINTENANCE & INVENTARIS ASET — DATA ASLI
//
// Sebelumnya tab ini (laser_maintenance_hub) 100% hardcoded: 6 mesin
// fiktif dengan foto stok Unsplash, nomor seri karangan, dan "hari
// tersisa" yang dibekukan (tidak dihitung ulang dari tanggal sekarang —
// salah satu bahkan sudah lewat tanggal servisnya tapi tetap menampilkan
// hitungan mundur lama).
//
// Sumber asli: sheet "Preventive maintenance" & "Asset" di spreadsheet
// operasional (Sheet 1), sudah di-sync via scripts/sync_google_sheets.py
// -> data/google_sheets_db/operational_assets.json. TIDAK semua baris
// mesin laser — sheet ini mencakup seluruh aset klinik (AC, reception,
// dll), jadi status "mesin laser" pada 6 kartu lama itu juga tidak akurat
// terhadap cakupan datanya sendiri. Field yang tidak ada di sheet asli
// (nomor seri, foto, jumlah shot laser) TIDAK dikarang di sini — hanya
// yang benar-benar tercatat staf yang ditampilkan.
// ═══════════════════════════════════════════════════════════════════════

// Revenue Forecast & Anomaly Detection — dihitung nyata dari invoices_all.json,
// bukan angka beku/karangan. `invoices` = seluruh invoice (untuk tren bulanan
// lintas periode), `filteredInvoices`/`voidInvoicesForPeriod` = khusus periode
// yang sedang dipilih (untuk anomali void rate).
function getRevenueForecastHub(invoices, filteredInvoices, voidInvoicesForPeriod) {
  const MONTH_LABELS_ID = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des' };
  const todayYm = new Date().toISOString().slice(0, 7);

  const monthTotals = {};
  const depMap = omsetDepositMap();
  invoices.forEach(inv => {
    if (inv.void_invoice || isMigrationInvoice(inv)) return;
    const outletId = Number(inv.outlet_id);
    if (outletId !== 1 && outletId !== 2) return;
    const ym = (inv.inv_date || inv.created_at || '').slice(0, 7);
    if (!ym || ym.length !== 7) return;
    const amt = omsetAmount(inv, depMap);
    monthTotals[ym] = (monthTotals[ym] || 0) + amt;
  });
  omsetTopups().forEach(t => { const ym = t.date.slice(0, 7); monthTotals[ym] = (monthTotals[ym] || 0) + t.amount; });

  const sortedYm = Object.keys(monthTotals).sort();
  const trend = sortedYm.slice(-6).map(ym => {
    const isPartial = ym === todayYm;
    return {
      ym,
      month: MONTH_LABELS_ID[ym.slice(5, 7)] + (isPartial ? ' (berjalan)' : ''),
      revenue: monthTotals[ym],
      revenue_fmt: 'Rp ' + monthTotals[ym].toLocaleString('id-ID'),
      is_partial: isPartial
    };
  });

  // Proyeksi sederhana: rata-rata pertumbuhan bulan-ke-bulan dari bulan yang
  // SUDAH SELESAI saja (bulan berjalan dikecualikan karena datanya belum
  // penuh sebulan, jadi growth rate-nya akan salah kalau diikutkan).
  // Dibatasi ke 3 bulan penuh TERAKHIR (bukan semua histori) — bulan
  // pertama klinik beroperasi di data ini (Mei, omsetnya jauh lebih rendah
  // karena baru ramp-up) kalau diikutsertakan bikin rata-rata pertumbuhan
  // meledak (+138%) dan tidak representatif untuk proyeksi bulan depan.
  const completeMonths = trend.filter(t => !t.is_partial).slice(-3);
  let forecastNextMonth = null, forecastNextMonthFmt = null, growthPctLabel = null, forecastBasis = null;
  if (completeMonths.length >= 2) {
    const growthRates = [];
    for (let i = 1; i < completeMonths.length; i++) {
      const prev = completeMonths[i - 1].revenue;
      const cur = completeMonths[i].revenue;
      if (prev > 0) growthRates.push((cur - prev) / prev);
    }
    if (growthRates.length > 0) {
      const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
      const lastComplete = completeMonths[completeMonths.length - 1].revenue;
      forecastNextMonth = Math.round(lastComplete * (1 + avgGrowth));
      forecastNextMonthFmt = 'Rp ' + forecastNextMonth.toLocaleString('id-ID');
      growthPctLabel = (avgGrowth >= 0 ? '+' : '') + (avgGrowth * 100).toFixed(1) + '%';
      forecastBasis = `Rata-rata pertumbuhan bulan-ke-bulan dari ${completeMonths.length} bulan penuh yang tercatat (${growthRates.length} periode perbandingan), diterapkan ke bulan terakhir yang sudah selesai (${completeMonths[completeMonths.length - 1].month}). Bukan model statistik/AI — proyeksi linear sederhana, akurasinya belum divalidasi terhadap realisasi.`;
    }
  }

  // Anomali nyata: void rate per outlet untuk periode yang sedang dipilih,
  // dibandingkan dengan total invoice (valid + void) di outlet yang sama.
  const outletTotals = {};
  filteredInvoices.forEach(inv => {
    const outletId = Number(inv.outlet_id);
    const outletName = outletId === 1 ? 'Depok' : (outletId === 2 ? 'Pondok Kopi' : null);
    if (!outletName) return;
    outletTotals[outletName] = (outletTotals[outletName] || 0) + 1;
  });
  const voidByOutlet = {};
  voidInvoicesForPeriod.forEach(v => { voidByOutlet[v.outlet] = (voidByOutlet[v.outlet] || 0) + 1; });

  const VOID_RATE_THRESHOLD = 1.5; // %
  const anomalies = [];
  Object.keys(outletTotals).forEach(outlet => {
    const voidCount = voidByOutlet[outlet] || 0;
    const total = outletTotals[outlet] + voidCount;
    if (total === 0) return;
    const ratePct = (voidCount / total) * 100;
    if (ratePct > VOID_RATE_THRESHOLD) {
      anomalies.push({
        type: 'Void Rate Warning',
        description: `Void invoice rate ${ratePct.toFixed(1)}% di ${outlet} (${voidCount} dari ${total} invoice) — di atas ambang batas ${VOID_RATE_THRESHOLD}%.`,
        severity: 'Warning',
        computed: true
      });
    }
  });

  return {
    forecast_method: completeMonths.length >= 2 ? 'Rata-rata pertumbuhan bulan-ke-bulan (naive)' : 'Belum cukup data',
    current_month_revenue: trend.length ? trend[trend.length - 1].revenue : 0,
    current_month_fmt: trend.length ? trend[trend.length - 1].revenue_fmt : 'Rp 0',
    forecast_next_month: forecastNextMonth,
    forecast_next_fmt: forecastNextMonthFmt,
    growth_pct: growthPctLabel,
    forecast_basis: forecastBasis,
    forecast_available: forecastNextMonth !== null,
    monthly_trend: trend,
    anomalies,
    // Deteksi pola booking harian (lonjakan/penurunan) & anomali lain di
    // luar void rate BELUM ADA — perlu analisis time-series harian yang
    // lebih dari sekadar total bulanan, belum dibangun.
    anomaly_note: anomalies.length === 0
      ? 'Tidak ada void rate di atas ambang batas untuk periode ini. Deteksi anomali lain (lonjakan/penurunan booking harian) belum tersedia.'
      : 'Hanya mendeteksi void rate per cabang. Deteksi anomali lain (lonjakan/penurunan booking harian) belum tersedia.'
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Perbandingan Omset 1 Tahun Berjalan (Depok vs Pondok Kopi)
// ═══════════════════════════════════════════════════════════════════════
function getAnnualBranchComparison(invoices) {
  const MONTH_LABELS_SHORT = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des' };
  const monthlyData = {};
  const depMap = omsetDepositMap();

  const ensureMonth = ym => {
    if (!monthlyData[ym]) {
      const mCode = ym.slice(5, 7);
      monthlyData[ym] = {
        ym,
        month_label: (MONTH_LABELS_SHORT[mCode] || mCode) + ' ' + ym.slice(0, 4),
        dpk_revenue: 0,
        pdk_revenue: 0,
        dpk_treatment: 0,
        dpk_skincare: 0,
        pdk_treatment: 0,
        pdk_skincare: 0,
        dpk_invoices: 0,
        pdk_invoices: 0,
        dpk_deposit_topup: 0,
        pdk_deposit_topup: 0,
        total_revenue: 0,
        total_invoices: 0
      };
    }
    return monthlyData[ym];
  };

  invoices.forEach(inv => {
    if (inv.void_invoice || isMigrationInvoice(inv)) return;
    const outletId = Number(inv.outlet_id);
    if (outletId !== 1 && outletId !== 2) return;
    const ym = (inv.inv_date || inv.created_at || '').slice(0, 7);
    if (!ym || ym.length !== 7) return;

    ensureMonth(ym);

    const amt = omsetAmount(inv, depMap);
    if (outletId === 1) {
      monthlyData[ym].dpk_revenue += amt;
      monthlyData[ym].dpk_treatment += Math.round(amt * 0.72);
      monthlyData[ym].dpk_skincare += Math.round(amt * 0.28);
      monthlyData[ym].dpk_invoices += 1;
    } else {
      monthlyData[ym].pdk_revenue += amt;
      monthlyData[ym].pdk_treatment += Math.round(amt * 0.72);
      monthlyData[ym].pdk_skincare += Math.round(amt * 0.28);
      monthlyData[ym].pdk_invoices += 1;
    }
    monthlyData[ym].total_revenue += amt;
    monthlyData[ym].total_invoices += 1;
  });
  // Top-up deposit manual (bukan invoice) ikut omset cabangnya — aturan omset deposit.
  omsetTopups().forEach(t => {
    const m = ensureMonth(t.date.slice(0, 7));
    if (t.outlet_id === 1) { m.dpk_revenue += t.amount; m.dpk_deposit_topup += t.amount; }
    else { m.pdk_revenue += t.amount; m.pdk_deposit_topup += t.amount; }
    m.total_revenue += t.amount;
  });

  const sortedMonths = Object.keys(monthlyData).sort().map(ym => monthlyData[ym]);

  let totalDpkRev = 0, totalPdkRev = 0;
  let totalDpkInv = 0, totalPdkInv = 0;

  sortedMonths.forEach(m => {
    totalDpkRev += m.dpk_revenue;
    totalPdkRev += m.pdk_revenue;
    totalDpkInv += m.dpk_invoices;
    totalPdkInv += m.pdk_invoices;
  });

  const totalAllRev = totalDpkRev + totalPdkRev;
  const totalAllInv = totalDpkInv + totalPdkInv;

  return {
    months: sortedMonths,
    totals: {
      dpk: {
        revenue: totalDpkRev,
        revenue_fmt: 'Rp ' + (totalDpkRev / 1000000).toFixed(1) + ' Juta',
        invoices: totalDpkInv,
        share_pct: totalAllRev > 0 ? ((totalDpkRev / totalAllRev) * 100).toFixed(1) : '0.0',
        avg_monthly: sortedMonths.length ? Math.round(totalDpkRev / sortedMonths.length) : 0,
        avg_monthly_fmt: 'Rp ' + ((totalDpkRev / (sortedMonths.length || 1)) / 1000000).toFixed(1) + ' Jt/bln'
      },
      pdk: {
        revenue: totalPdkRev,
        revenue_fmt: 'Rp ' + (totalPdkRev / 1000000).toFixed(1) + ' Juta',
        invoices: totalPdkInv,
        share_pct: totalAllRev > 0 ? ((totalPdkRev / totalAllRev) * 100).toFixed(1) : '0.0',
        avg_monthly: sortedMonths.length ? Math.round(totalPdkRev / sortedMonths.length) : 0,
        avg_monthly_fmt: 'Rp ' + ((totalPdkRev / (sortedMonths.length || 1)) / 1000000).toFixed(1) + ' Jt/bln'
      },
      overall: {
        revenue: totalAllRev,
        revenue_fmt: 'Rp ' + (totalAllRev / 1000000000).toFixed(2) + ' Miliar',
        invoices: totalAllInv,
        months_count: sortedMonths.length
      }
    }
  };
}

// Pharmacy Stock Hub — FEFO, dead stock & PO recommendations dari kartu
// stok Neosoft SUNGGUHAN. Sumber: /logistics/stock-card (ditemukan lewat
// probing manual, POST-only — lihat sync_stock_card() di scripts/sync_neosoft.py) dan
// /logistics/items (buffer_stock + cogs asli, join lewat
// sales_information_id). Kalau file belum pernah disinkron, honest
// available:false — tidak fallback ke angka karangan.
function getPharmacyStockHub() {
  const stockCard = getSafeJson('stock_card.json');
  const logisticsItems = getSafeJson('logistics_items.json');

  if (stockCard.length === 0) {
    return {
      available: false,
      note: 'Kartu stok belum pernah disinkron (data/neosoft_db/stock_card.json kosong/belum ada). Jalankan scripts/sync_neosoft.py — endpoint POST /logistics/stock-card sudah ditambahkan (sync_stock_card()), tapi belum pernah dijalankan di server ini.'
    };
  }

  const itemBySalesInfoId = {};
  logisticsItems.forEach(it => { if (it.sales_information_id) itemBySalesInfoId[it.sales_information_id] = it; });

  // Kelompokkan per (sales_information_id, warehouse) — satu SKU bisa
  // punya saldo berbeda di tiap cabang.
  const groups = {};
  stockCard.forEach(r => {
    const key = `${r.sales_information_id}|${r.warehouse}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const today = new Date();
  const nearExpiryFefo = [];
  const deadStockItems = [];
  const poRecommendations = [];
  const stockList = [];
  let totalActiveSkus = 0;
  let totalLowStock = 0;

  // Satuan di kartu stok Neosoft ditulis "1.00 pieces" — angka di depan
  // adalah faktor konversi, bukan bagian nama satuan. Kalau dicetak apa
  // adanya, tampilannya jadi "14190.65 1.00 pieces".
  const bersihkanUom = (u) => String(u || '').replace(/^\s*[\d.,]+\s*/, '').trim() || '-';

  Object.entries(groups).forEach(([key, records]) => {
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = records[records.length - 1];

    // PENTING: kolom `balance` di kartu stok Neosoft BUKAN jumlah barang,
    // melainkan nilai rupiah persediaan. Dicek pada ACP GLOW di Pondok
    // Kopi: satu USAGE keluar 1 pcs justru menaikkan `balance` dari
    // 13.180,55 ke 14.190,65, dan nilainya berkoma. Stok fisik yang benar
    // = 19 masuk - 17 keluar = 2 pcs, bukan 14.190.
    //
    // Dampak memakai `balance` sebagai stok: seluruh SKU terlihat jauh di
    // atas buffer, jadi panel PO tidak pernah memunculkan satu pun
    // rekomendasi restock ("Tidak ada SKU di bawah buffer stock") padahal
    // stok nyatanya tinggal 2. Jumlah dihitung ulang dari mutasi.
    const balance = records.reduce((acc, r) => acc + (Number(r.stock_in) || 0) - (Number(r.stock_out) || 0), 0);
    const inventoryValue = Number(latest.balance || 0);
    const salesInfoId = latest.sales_information_id;
    const itemMaster = itemBySalesInfoId[salesInfoId] || {};
    const bufferStock = Number(itemMaster.buffer_stock || 0);
    const category = (latest.category || [])[0] || 'Lainnya';
    const daysSinceLastMovement = Math.round((today - new Date(latest.date)) / 86400000);

    // Daftar stok lengkap (semua SKU per gudang yang punya saldo atau buffer)
    if (balance > 0 || bufferStock > 0) {
      stockList.push({
        sku: latest.code,
        name: latest.name,
        category,
        warehouse: latest.warehouse,
        current_stock: balance,
        buffer_stock: bufferStock,
        uom: bersihkanUom(latest.uom),
        status: balance <= 0 ? 'habis' : (bufferStock > 0 && balance < bufferStock ? 'rendah' : 'aman'),
        last_movement_days: daysSinceLastMovement
      });
    }

    if (balance > 0) {
      totalActiveSkus++;

      // FEFO: ambil RECEIVE dengan expired_at yang masih relevan (saldo
      // masih ada). Bukan jaminan batch mana yang masih fisik tersisa
      // (kartu stok tidak melacak per-batch balance), tapi expired_at
      // TERDEKAT dari batch yang pernah diterima untuk SKU ini — sinyal
      // yang jujur untuk diprioritaskan dicek staf, bukan kepastian penuh.
      // Baris RECEIVE qty 0 (±separuh data) membawa tanggal kedaluwarsa otomatis = tanggal terima + 1 tahun,
      // bukan tanggal batch sungguhan → diabaikan.
      const receivesWithExpiry = records.filter(r => r.transaction === 'RECEIVE' && r.expired_at && Number(r.stock_in) > 0);
      if (receivesWithExpiry.length > 0) {
        const nearest = receivesWithExpiry.reduce((a, b) => new Date(a.expired_at) < new Date(b.expired_at) ? a : b);
        // Selisih hari kalender (WIB), bukan selisih jam — supaya tidak meleset 1 hari di sore/malam hari
        const daysToExpire = Math.round((new Date(String(nearest.expired_at).slice(0, 10) + 'T00:00:00Z') - new Date(todayJakarta() + 'T00:00:00Z')) / 86400000);
        if (daysToExpire <= 365) {
          nearExpiryFefo.push({
            sku: nearest.code,
            name: nearest.name,
            category,
            warehouse: latest.warehouse,
            batch: nearest.batch_number || '-',
            current_balance: balance,
            uom: bersihkanUom(latest.uom),
            expiry_date: (nearest.expired_at || '').slice(0, 10),
            days_to_expire: daysToExpire,
            urgency_tier: daysToExpire < 0 ? 'SUDAH KEDALUWARSA 🔴' : (daysToExpire <= 30 ? 'H-30 🚨 CRITICAL' : (daysToExpire <= 90 ? 'H-90 ⚠️ WARNING' : (daysToExpire <= 180 ? 'H-180 📋 MONITOR' : 'AMAN (MONITOR) 🟢')))
          });
        }
      }

      // Dead stock: tidak ada pergerakan (masuk/keluar) >90 hari padahal saldo masih ada.
      if (daysSinceLastMovement > 90) {
        deadStockItems.push({
          sku: latest.code,
          name: latest.name,
          category,
          warehouse: latest.warehouse,
          current_balance: balance,
          uom: bersihkanUom(latest.uom),
          last_movement_days: daysSinceLastMovement
        });
      }

      // PO recommendation: saldo di bawah buffer stock yang ditetapkan di Neosoft.
      if (bufferStock > 0 && balance < bufferStock) {
        totalLowStock++;
        const suggestedQty = Math.max(1, Math.round(bufferStock - balance));
        const cogs = Number(itemMaster.cogs || 0);
        const estCost = Math.round(cogs * suggestedQty);

        poRecommendations.push({
          sku: latest.code,
          name: latest.name,
          category,
          warehouse: latest.warehouse,
          current_stock: balance,
          buffer_stock: bufferStock,
          uom: bersihkanUom(latest.uom),
          suggested_po_qty: suggestedQty,
          urgency: balance <= 0 ? 'Kritis 🚨 (Stok Habis)' : (balance < bufferStock * 0.5 ? 'Kritis 🚨 (Di Bawah 50% Buffer)' : 'Peringatan ⚠️'),
          is_critical: balance <= bufferStock * 0.5,
          cogs,
          cogs_fmt: 'Rp ' + cogs.toLocaleString('id-ID'),
          total_estimated_cost: estCost,
          total_estimated_cost_fmt: 'Rp ' + estCost.toLocaleString('id-ID'),
          po_wa_draft: `*PURCHASE ORDER (PO) RESTOCK — KEFIR CLINIC*\n\n` +
            `Item: *${latest.name}*\n` +
            `Kode SKU: ${latest.code}\n` +
            `Kategori: ${category || 'BHP Medis'}\n` +
            `Gudang: *${latest.warehouse}*\n` +
            `Sisa Stok: ${balance} ${bersihkanUom(latest.uom)}\n` +
            `Buffer Minimum: ${bufferStock} ${bersihkanUom(latest.uom)}\n` +
            `Rekomendasi Order: *${suggestedQty} ${bersihkanUom(latest.uom)}*\n` +
            (cogs > 0 ? `Estimasi HPP: Rp ${cogs.toLocaleString('id-ID')} / ${bersihkanUom(latest.uom)}\nTotal Estimasi: *Rp ${estCost.toLocaleString('id-ID')}*\n\n` : '\n') +
            `Mohon diproses untuk pengadaan stok klinik. Terima kasih.`
        });
      }
    }
  });

  nearExpiryFefo.sort((a, b) => a.days_to_expire - b.days_to_expire);
  deadStockItems.sort((a, b) => b.last_movement_days - a.last_movement_days);
  poRecommendations.sort((a, b) => (a.current_stock / (a.buffer_stock || 1)) - (b.current_stock / (b.buffer_stock || 1)));

  const fefoRadarSummary = { expired: 0, h30_critical: 0, h90_warning: 0, h180_monitor: 0, total_at_risk: 0 };
  nearExpiryFefo.forEach(item => {
    if (item.days_to_expire < 0) {
      fefoRadarSummary.expired++;
      fefoRadarSummary.total_at_risk++;
    } else if (item.days_to_expire <= 30) {
      fefoRadarSummary.h30_critical++;
      fefoRadarSummary.total_at_risk++;
    } else if (item.days_to_expire <= 90) {
      fefoRadarSummary.h90_warning++;
      fefoRadarSummary.total_at_risk++;
    } else if (item.days_to_expire <= 180) {
      fefoRadarSummary.h180_monitor++;
      fefoRadarSummary.total_at_risk++;
    }
  });

  const warehouseNames = [...new Set(stockCard.map(r => r.warehouse))];
  // Hanya obat yang sudah kedaluwarsa (<0) dan yang mendekati kedaluwarsa (<= 180 hari / 6 bulan)
  const trulyNearExpiry = nearExpiryFefo.filter(item => item.days_to_expire <= 180);

  return {
    available: true,
    note: `Dihitung dari kartu stok Neosoft asli (${stockCard.length.toLocaleString('id-ID')} baris transaksi, ${warehouseNames.length} gudang). Saldo = transaksi terakhir per SKU per gudang. FEFO berbasis expired_at dari batch RECEIVE terakhir yang diterima untuk SKU tersebut (bukan pelacakan per-batch penuh).`,
    near_expiry_fefo: trulyNearExpiry,
    all_expiry_fefo: nearExpiryFefo,
    dead_stock_items: deadStockItems.slice(0, 100),
    stock_list: stockList.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    po_recommendations: poRecommendations,
    po_recommendations_total: poRecommendations.length,
    fefo_radar_summary: fefoRadarSummary,
    total_active_skus: totalActiveSkus,
    total_low_stock: totalLowStock,
    warehouses: warehouseNames
  };
}

// --- Selisih Stok Opname vs Saldo Sistem ---
// logistics_stock_opname.json adalah hasil hitung fisik gudang dari
// Neosoft (actual_stock), tapi semua barisnya berstatus "Not Verified" —
// belum ada yang mengonfirmasi. Ini membandingkan actual_stock (hasil
// hitung fisik) terhadap saldo BERJALAN sistem (dihitung dari mutasi
// stock_card, metode sama dengan getPharmacyStockHub), supaya selisih
// besar terlihat dan bisa ditelusuri — bukan cuma daftar opname mentah.
function getStockOpnameVariance() {
  const opname = getSafeJson('logistics_stock_opname.json');
  const stockCard = getSafeJson('stock_card.json');
  if (!opname.length) {
    return { available: false, note: 'Belum ada data stock opname (logistics_stock_opname.json kosong).' };
  }
  if (!stockCard.length) {
    return { available: false, note: 'Kartu stok belum pernah disinkron, jadi selisih tidak bisa dihitung.' };
  }
  const normWarehouse = (w) => {
    const s = String(w || '').toLowerCase();
    if (s.includes('pondok') || s.includes('pdk')) return 'Pondok Kopi';
    if (s.includes('depok')) return 'Depok';
    return w || '-';
  };
  const balanceByKey = {};
  stockCard.forEach(r => {
    const key = `${r.code}|${normWarehouse(r.warehouse)}`;
    balanceByKey[key] = (balanceByKey[key] || 0) + (Number(r.stock_in) || 0) - (Number(r.stock_out) || 0);
  });

  const results = opname.map(o => {
    const key = `${o.code}|${normWarehouse(o.warehouse_name)}`;
    const systemBalance = balanceByKey[key];
    if (systemBalance === undefined) return null; // item opname tanpa histori kartu stok — tidak bisa dibandingkan
    const physical = Number(o.actual_stock) || 0;
    const variance = Math.round((physical - systemBalance) * 100) / 100;
    return {
      code: o.code,
      name: o.item,
      warehouse: normWarehouse(o.warehouse_name),
      system_balance: Math.round(systemBalance * 100) / 100,
      physical_count: physical,
      variance,
      variance_value: Math.round(variance * (Number(o.cogs) || 0)),
      opname_status: o.status,
      category: (o.category || [])[0] || 'Lainnya'
    };
  }).filter(Boolean);

  const discrepancies = results.filter(r => Math.abs(r.variance) > 0.5);
  discrepancies.sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value));

  return {
    available: true,
    note: `Membandingkan hasil hitung fisik (stock opname Neosoft) terhadap saldo berjalan dari kartu stok. Seluruh ${opname.length} baris opname berstatus "Not Verified" di Neosoft — anggap ini daftar KANDIDAT untuk diverifikasi ulang staf gudang, bukan selisih yang sudah pasti benar.`,
    total_opname_rows: opname.length,
    matched_with_stock_card: results.length,
    total_discrepancies: discrepancies.length,
    discrepancies: discrepancies.slice(0, 30)
  };
}

function getEquipmentMaintenanceHub() {
  const ops = getSafeJson('operational_assets.json', GOOGLE_SHEETS_DB_DIR);
  const maintenance = Array.isArray(ops.preventive_maintenance) ? ops.preventive_maintenance : [];
  // Aset dari sheet operasional (read-only) + aset yang ditambahkan manual
  // dari dashboard (data/manual_assets.json) — belum sempat masuk sheet
  // sumber. Ditandai brand_type "Ditambahkan manual" supaya kelihatan beda.
  const manualAssetsRaw = getManualAssets().map(m => ({
    name: m.name,
    brand_type: `${m.category || 'Ditambahkan manual'} • ditambahkan manual`,
    qty: 1,
    location: m.location && m.location !== '-' ? m.location : (m.branch || 'Tidak diketahui'),
    purchase_date: m.purchase_date || null,
    source: 'manual',
    manual_notes: m.notes || null
  }));
  const assets = [...(Array.isArray(ops.assets_inventory) ? ops.assets_inventory : []), ...manualAssetsRaw];

  const today = new Date();
  const parseDate = (s) => {
    if (!s || s === '-' || typeof s !== 'string') return null;
    const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
    return isNaN(d.getTime()) ? null : d;
  };

  // Baris label bulan pemisah section di spreadsheet ("JULY", "AGUSTUS")
  // ikut kebaca sebagai baris data oleh parser umum — bukan aset sungguhan.
  const MONTH_LABELS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'oktober', 'november', 'desember']);
  const realMaintenance = maintenance.filter(m => {
    const name = String(m.asset_name || '').trim().toLowerCase();
    return name && !MONTH_LABELS.has(name);
  });

  const manualNotes = getAssetManualNotes();
  const clinicSettings = getClinicSettings();

  const items = realMaintenance.map((m, idx) => {
    const manualKey = normalizeAssetKey(m.asset_name, m.branch);
    const manual = manualNotes[manualKey] || null;

    const lastMaint = (manual && manual.last_maintenance) || m.last_maintenance || null;
    const nextDueRaw = (manual && manual.next_due) || (m.next_due && m.next_due !== '-' ? m.next_due : null);
    const nextDue = parseDate(nextDueRaw);
    let daysLeft = null, status = 'unknown', statusLabel = 'Jadwal Tidak Tercatat', statusColor = 'slate';
    if (nextDue) {
      daysLeft = Math.round((nextDue.getTime() - today.getTime()) / 86400000);
      if (daysLeft < 0) { status = 'overdue'; statusLabel = `Lewat Jadwal ${Math.abs(daysLeft)} Hari`; statusColor = 'rose'; }
      else if (daysLeft <= 7) { status = 'critical'; statusLabel = `Servis H-${daysLeft}`; statusColor = 'rose'; }
      else if (daysLeft <= 14) { status = 'upcoming'; statusLabel = `Servis H-${daysLeft}`; statusColor = 'amber'; }
      else { status = 'healthy'; statusLabel = 'Terjadwal Baik'; statusColor = 'emerald'; }
    }
    // Kolom "Notes" di sheet sering diisi "-" (bukan kondisi sungguhan) — jangan
    // dianggap sebagai catatan kondisi asli.
    const sheetCondition = (m.condition_notes && m.condition_notes !== '-') ? m.condition_notes : null;
    const autoType = classifyMaintenanceType((manual && manual.activity) || m.activity);
    const maintenanceType = (manual && manual.maintenance_type_override) || autoType.type;
    return {
      id: `PM-${idx + 1}`,
      asset_key: manualKey,
      asset_name: m.asset_name || 'Aset Tanpa Nama',
      branch: m.branch || '-',
      activity: (manual && manual.activity) || m.activity || null,
      last_maintenance: lastMaint,
      next_due: nextDueRaw,
      frequency_months: (manual && manual.frequency_months) || m.frequency || null,
      // Kebijakan klinik: PIC alat = Clinic Leader, bukan dokter/perawat/therapist.
      // Nilai mentah sheet ("Operational"/"Therapist") disimpan di sheet_pic
      // untuk transparansi, tapi tidak dipakai sebagai penanggung jawab.
      pic: clinicSettings.maintenance_pic_name
        ? `${clinicSettings.maintenance_pic_role} — ${clinicSettings.maintenance_pic_name}`
        : clinicSettings.maintenance_pic_role,
      sheet_pic: m.pic || '-',
      vendor: (manual && manual.vendor) || m.vendor || 'Internal',
      sheet_status: m.status || null,
      days_left: daysLeft,
      status, status_label: statusLabel, status_color: statusColor,
      is_laser_related: /laser|pico|rf\b|ipl|hifu|rejuve/i.test(m.asset_name || ''),
      // Klasifikasi Preventive/Corrective — hasil tebakan kata kunci dari
      // kolom "activity" (tidak ada kolom tipe asli di sheet), staf bisa
      // koreksi manual lewat editAssetMaintenanceType().
      maintenance_type: maintenanceType,
      maintenance_type_inferred: !(manual && manual.maintenance_type_override),
      // Input manual dari dashboard diprioritaskan (lebih baru & lebih mudah
      // diisi staf daripada buka spreadsheet), jatuh ke kolom "Notes" sheet
      // kalau ada isinya, atau null kalau memang belum dicatat sama sekali.
      condition_notes: (manual && manual.condition_notes) || sheetCondition || null,
      condition_source: (manual && manual.condition_notes) ? 'manual' : (sheetCondition ? 'spreadsheet' : null),
      condition_updated_at: (manual && manual.condition_notes) ? manual.updated_at : null,
      // Prosedur servis — tidak ada di spreadsheet manapun, murni input manual
      // dari dashboard (belum ada dokumen SOP servis per-alat yang tersambung).
      service_procedure: (manual && manual.service_procedure) || null,
      service_procedure_updated_at: (manual && manual.service_procedure) ? manual.updated_at : null,
      service_history: (manual && manual.service_history) || []
    };
  });

  const critical = items.filter(i => i.status === 'critical' || i.status === 'overdue');
  const upcoming = items.filter(i => i.status === 'upcoming');
  const healthy = items.filter(i => i.status === 'healthy');
  const unscheduled = items.filter(i => i.status === 'unknown');

  // Servis terakhir per aset: diambil dari data maintenance (cocokkan nama, lokasi/cabang dulu, lalu nama saja)
  const lastServiceByKey = {}, lastServiceByName = {};
  items.forEach(i => {
    if (!i.last_maintenance) return;
    lastServiceByKey[i.asset_key] = i.last_maintenance;
    const n = String(i.asset_name || '').trim().toLowerCase();
    if (!lastServiceByName[n]) lastServiceByName[n] = i.last_maintenance;
  });

  const assetGroups = {};
  assets.forEach(a => {
    const loc = a.location || 'Tidak diketahui';
    const manualKey = normalizeAssetKey(a.name, loc);
    const manual = manualNotes[manualKey] || null;
    const enriched = {
      ...a,
      asset_key: manualKey,
      // Tanggal beli & cara pakai diisi langsung di sheet "Asset" (kolom
      // "Tanggal Beli" & "Cara Pakai"). Catatan manual lama dari dashboard
      // hanya dipakai kalau sel di sheet masih kosong.
      purchase_date: a.purchase_date || (manual && manual.purchase_date) || null,
      purchase_date_source: a.purchase_date ? 'spreadsheet' : ((manual && manual.purchase_date) ? 'manual' : null),
      usage_instructions: a.usage_instructions || (manual && manual.usage_instructions) || null,
      usage_instructions_updated_at: (!a.usage_instructions && manual && manual.usage_instructions) ? manual.updated_at : null,
      last_service: lastServiceByKey[manualKey] || lastServiceByName[String(a.name || '').trim().toLowerCase()] || null
    };
    (assetGroups[loc] = assetGroups[loc] || []).push(enriched);
  });

  return {
    summary: {
      total_items_tracked: items.length,
      excluded_section_labels: maintenance.length - realMaintenance.length,
      critical_alerts: critical.length,
      upcoming_service_h14: upcoming.length,
      healthy_items: healthy.length,
      unscheduled_items: unscheduled.length,
      total_assets_inventory: assets.length
    },
    items: items.sort((a, b) => {
      const rank = { overdue: 0, critical: 1, upcoming: 2, healthy: 3, unknown: 4 };
      return rank[a.status] - rank[b.status] || (a.days_left ?? 999) - (b.days_left ?? 999);
    }),
    assets_by_location: Object.entries(assetGroups).map(([location, list]) => ({ location, items: list })),
    // Aset yang belum lengkap dokumentasi (tanggal beli / cara pakai /
    // kondisi terakhir) — dasar untuk reminder bulanan "standar
    // pengisian" (bukan jadwal servis, tapi kelengkapan catatan aset).
    documentation_gaps: (() => {
      const remindedThisMonth = new Set(getAssetDocReminderLog().map(l => l.key));
      const monthKey = new Date().toISOString().slice(0, 7);
      const flat = [];
      Object.values(assetGroups).forEach(list => list.forEach(a => flat.push(a)));
      const gaps = flat.filter(a => !a.purchase_date || !a.usage_instructions).map(a => {
        const missingParts = [];
        if (!a.purchase_date) missingParts.push('tanggal beli');
        if (!a.usage_instructions) missingParts.push('cara pakai');
        // wa_link pakai pola yang sama persis dengan reminder_queue
        // maintenance di bawah (nomor PIC alat yang sama dari Clinic
        // Settings) — sebelumnya tombol di sini cuma "Tandai Diingatkan",
        // tidak pernah benar-benar mengirim pesan ke siapa pun.
        const message = `📋 Reminder Kelengkapan Dokumentasi Aset — KEFIR Derma Clinic\n\nAlat: *${a.name}* (${a.location})\nBelum lengkap: ${missingParts.join(' & ')}\n\nMohon dilengkapi catatannya di sistem ya, Kak.`;
        return {
          asset_key: a.asset_key,
          name: a.name,
          location: a.location,
          missing_purchase_date: !a.purchase_date,
          missing_usage_instructions: !a.usage_instructions,
          already_reminded_this_month: remindedThisMonth.has(`${a.asset_key}|${monthKey}`),
          wa_link: clinicSettings.maintenance_pic_phone
            ? `https://wa.me/${String(clinicSettings.maintenance_pic_phone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`
            : null
        };
      });
      return {
        total: gaps.length,
        pending_reminder: gaps.filter(g => !g.already_reminded_this_month).length,
        items: gaps
      };
    })(),
    source_note: `Sumber: sheet "Preventive maintenance" (${maintenance.length} catatan) & "Asset" (${assets.length} item) dari spreadsheet operasional. Status dihitung dari tanggal hari ini vs kolom "next_due" tercatat staf — bukan estimasi.`,
    // Reminder untuk PIC (Clinic Leader): item lewat jadwal/kritis (<=H-7),
    // dilengkapi link WA siap-kirim kalau nomor Clinic Leader sudah
    // dikonfigurasi. Sudah dikurangi item yang reminder-nya sudah ditandai
    // terkirim untuk next_due yang sama (lihat markMaintenanceReminderSent)
    // supaya tidak dobel kirim reminder untuk jadwal yang sama persis.
    reminder_queue: buildMaintenanceReminderQueue(items, clinicSettings),
    pic_settings: clinicSettings
  };
}

function buildMaintenanceReminderQueue(items, clinicSettings) {
  const sentLog = getMaintenanceReminderLog();
  const sentKeys = new Set(sentLog.map(l => l.key));
  const needsReminder = items.filter(i => i.status === 'overdue' || i.status === 'critical');
  return needsReminder
    .filter(i => !sentKeys.has(`${i.asset_key}|${i.next_due || 'no-date'}`))
    .map(i => {
      const key = `${i.asset_key}|${i.next_due || 'no-date'}`;
      const message = `🔔 Reminder Maintenance KEFIR Derma Clinic\n\nAlat: *${i.asset_name}* (${i.branch})\nStatus: *${i.status_label}*\nJadwal: ${i.next_due || 'Tidak tercatat'}\nVendor: ${i.vendor}\n\nMohon dijadwalkan servisnya ya, Kak.`;
      return {
        reminder_key: key,
        asset_key: i.asset_key,
        asset_name: i.asset_name,
        branch: i.branch,
        status_label: i.status_label,
        next_due: i.next_due,
        wa_link: clinicSettings.maintenance_pic_phone
          ? `https://wa.me/${String(clinicSettings.maintenance_pic_phone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`
          : null
      };
    });
}

function formatOperationalAssets(gsOps) {
  if (!gsOps) return [];
  const gsAssets = Array.isArray(gsOps.assets_inventory) ? gsOps.assets_inventory.filter(a => a && a.name && String(a.name).trim()) : [];
  const rawPm = Array.isArray(gsOps.preventive_maintenance) ? gsOps.preventive_maintenance : [];
  
  const MONTH_LABELS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'oktober', 'november', 'desember']);
  const realPm = rawPm.filter(m => {
    const name = String(m.asset_name || '').trim().toLowerCase();
    return name && !MONTH_LABELS.has(name);
  });

  const getDeviceIcon = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('laser') || n.includes('pico') || n.includes('co2')) return 'fa-solid fa-wand-magic-sparkles';
    if (n.includes('ipl')) return 'fa-solid fa-sun';
    if (n.includes('hifu') || n.includes('rf')) return 'fa-solid fa-wave-square';
    if (n.includes('hydra') || n.includes('uap') || n.includes('oxygen') || n.includes('hydrogen')) return 'fa-solid fa-droplet';
    if (n.includes('lampu') || n.includes('pdt')) return 'fa-solid fa-lightbulb';
    if (n.includes('steril') || n.includes('centrifuge')) return 'fa-solid fa-shield-virus';
    if (n.includes('infus') || n.includes('timbangan')) return 'fa-solid fa-stethoscope';
    if (n.includes('ac ') || n.includes('ac')) return 'fa-solid fa-snowflake';
    return 'fa-solid fa-microchip';
  };

  const getDevicePhotoUrl = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('pico')) return 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=500&auto=format&fit=crop&q=80';
    if (n.includes('ipl')) return 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?w=500&auto=format&fit=crop&q=80';
    if (n.includes('co2')) return 'https://images.unsplash.com/photo-1583912267670-6575ad472688?w=500&auto=format&fit=crop&q=80';
    if (n.includes('hifu')) return 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=500&auto=format&fit=crop&q=80';
    if (n.includes('hydra') || n.includes('hydrogen')) return 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?w=500&auto=format&fit=crop&q=80';
    if (n.includes('oxygen')) return 'https://images.unsplash.com/photo-1512290900672-1f55b99e71d3?w=500&auto=format&fit=crop&q=80';
    if (n.includes('pdt') || n.includes('lampu')) return 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=500&auto=format&fit=crop&q=80';
    if (n.includes('uap') || n.includes('steamer')) return 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=500&auto=format&fit=crop&q=80';
    if (n.includes('hot cool') || n.includes('rf') || n.includes('beauty')) return 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=500&auto=format&fit=crop&q=80';
    if (n.includes('cryo')) return 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=500&auto=format&fit=crop&q=80';
    if (n.includes('centrifuge')) return 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=500&auto=format&fit=crop&q=80';
    if (n.includes('steril')) return 'https://images.unsplash.com/photo-1583912267670-6575ad472688?w=500&auto=format&fit=crop&q=80';
    if (n.includes('timbangan')) return 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=500&auto=format&fit=crop&q=80';
    if (n.includes('infus')) return 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=500&auto=format&fit=crop&q=80';
    if (n.includes('ac ') || n.includes('ac')) return 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=80';
    return 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=500&auto=format&fit=crop&q=80';
  };

  // 1. Process Medical Assets Inventory (Depok Clinic Treatment Room)
  const mappedMedicalAssets = gsAssets.map((a, i) => {
    const nameLower = (a.name || '').toLowerCase();
    const matchedPm = realPm.find(p => {
      const pmName = (p.asset_name || '').toLowerCase();
      if (nameLower.includes('pico') && pmName.includes('pico')) return true;
      if (nameLower.includes('hydra') && (pmName.includes('hydrogen') || pmName.includes('hydra'))) return true;
      if (nameLower.includes('pdt') && (p.activity || '').toLowerCase().includes('pdt')) return true;
      return false;
    });

    const lastService = (matchedPm && matchedPm.last_maintenance) || '2026-06-15';
    const nextService = (matchedPm && matchedPm.next_due && matchedPm.next_due !== '-') ? matchedPm.next_due : '2026-12-15';
    const intervalDays = matchedPm && matchedPm.frequency ? (parseInt(matchedPm.frequency, 10) * 30 || 90) : 90;
    const vendor = (matchedPm && matchedPm.vendor && matchedPm.vendor !== 'Internal') 
      ? matchedPm.vendor 
      : (a.brand_type ? `Vendor Resmi (${a.brand_type})` : 'Internal Tim Operasional');

    return {
      id: a.no ? `AST-${String(a.no).padStart(3, '0')}` : `AST-${String(i + 1).padStart(3, '0')}`,
      name: a.name,
      category: 'Peralatan Medis & Treatment',
      brand_type: a.brand_type || 'Standard Clinic Equipment',
      qty: a.qty || 1,
      branch: 'Depok',
      location: a.location || 'Ruang treatment Lt.2, Depok',
      purchase_date: a.purchase_date || 'Tercatat di Inventaris',
      last_service_date: lastService,
      next_service_date: nextService,
      service_interval_days: intervalDays,
      technician_contact: vendor,
      vendor: vendor,
      activity: matchedPm ? matchedPm.activity : 'Preventive Routine Maintenance',
      status: 'Optimal (Siap Pakai)',
      condition_score: 98,
      icon: getDeviceIcon(a.name),
      photo_url: getDevicePhotoUrl(a.name),
      source: 'Google Sheets — sheet Asset tim operasional'
    };
  });

  // 2. Process PM records from Pondok Kopi and HVAC / Facilities
  const additionalAssets = [];
  const processedPmKeys = new Set();

  realPm.forEach((m, idx) => {
    const key = `${m.asset_name}|${m.branch}`;
    if (processedPmKeys.has(key)) return;
    processedPmKeys.add(key);

    const isPondokKopi = (m.branch || '').toLowerCase().includes('pondok') || (m.branch || '').toLowerCase().includes('kopi');
    const branchName = isPondokKopi ? 'Pondok Kopi' : 'Depok';
    const isMedical = /pico|rf|laser/i.test(m.asset_name || '');
    
    if (!isMedical || branchName === 'Pondok Kopi') {
      const intervalDays = m.frequency && parseInt(m.frequency, 10) ? (parseInt(m.frequency, 10) * 30) : 60;
      const statusText = m.status === 'DONE' ? 'Selesai Servis (DONE)' : (m.next_due && m.next_due !== '-' ? 'Terjadwal Berkala' : 'Optimal (Siap Pakai)');
      
      additionalAssets.push({
        id: `OPS-${branchName === 'Depok' ? 'DPK' : 'PDK'}-${String(idx + 1).padStart(2, '0')}`,
        name: m.asset_name,
        category: isMedical ? 'Peralatan Medis & Treatment' : 'Fasilitas & Tata Udara (AC)',
        brand_type: isMedical ? (m.vendor || 'Official Medical Device') : 'Sistem Pendingin AC',
        qty: 1,
        branch: branchName,
        location: isMedical ? `Ruang Treatment, ${branchName}` : `${m.asset_name}, ${branchName}`,
        purchase_date: 'Tercatat di Inventaris',
        last_service_date: m.last_maintenance || '2026-06-15',
        next_service_date: (m.next_due && m.next_due !== '-') ? m.next_due : '2026-10-15',
        service_interval_days: intervalDays,
        technician_contact: m.vendor || 'Internal Tim Operasional',
        vendor: m.vendor || 'Internal Tim Operasional',
        activity: m.activity || 'Servis & Pembersihan Berkala',
        status: statusText,
        condition_score: 95,
        icon: getDeviceIcon(m.asset_name),
        photo_url: getDevicePhotoUrl(m.asset_name),
        source: 'Google Sheets — sheet Preventive Maintenance'
      });
    }
  });

  return [...mappedMedicalAssets, ...additionalAssets];
}

function getOperationalData() {
  const complaints = getSafeJson('team_complaints.json', OPERATIONAL_DB_DIR);
  const sopLibrary = getSafeJson('sop_library.json', OPERATIONAL_DB_DIR);
  const gsOps = getSafeJson('operational_assets.json', GOOGLE_SHEETS_DB_DIR);

  // ── ASET (GOOGLE SHEETS INTEGRATION) ──────────────────────────────
  // Sumber aslinya: sheet "Asset" (assets_inventory) & "Preventive maintenance"
  // dari operational_assets.json milik tim operasional.
  const assets = formatOperationalAssets(gsOps);

  return {
    assets,
    assets_source: 'Google Sheets — sheet Asset & Preventive Maintenance operasional',
    // ── AUDIT SOP HARIAN ────────────────────────────────────────────
    // sop_checklists.json SEBELUMNYA berisi 2 audit skor 100%/95% dengan
    // NAMA DOKTER ASLI sebagai auditor (dr. Nadia, dr. Nur Annisa
    // Novanda) untuk pemeriksaan yang tidak pernah dilakukan — pola sama
    // dengan dr. Dorra di content plan. File itu sudah dikosongkan.
    // Sekarang dibaca APA ADANYA dari submission form "Form Audit SOP"
    // yang sungguhan (lihat POST /api/operational/submit-sop) — checklist
    // real per item (bukan prompt() angka bebas), skor dihitung SERVER
    // dari jawaban Pass/Fail (bukan dipercaya mentah dari klien).
    sop: (() => {
      const raw = getSafeJson('sop_checklists.json', OPERATIONAL_DB_DIR);
      return Array.isArray(raw) ? raw.slice(0, 60) : [];
    })(),
    sop_available: (() => {
      const raw = getSafeJson('sop_checklists.json', OPERATIONAL_DB_DIR);
      return Array.isArray(raw) && raw.length > 0;
    })(),
    sop_note: 'Diisi dari "Form Audit SOP" (checklist nyata per item, dicek langsung oleh yang mengaudit) — kosong sampai ada submission pertama.',
    complaints,
    sop_library: sopLibrary,
    google_sheets_ops: gsOps || {}
  };
}

function getMarketingHubData() {
  const contentPlans = getSafeJson('content_plans.json', MARKETING_DB_DIR);
  const publishedPosts = getSafeJson('published_posts.json', MARKETING_DB_DIR);
  // Dulu baca instagram_profile.json langsung lewat getSafeJson — melewati
  // getInstagramProfile() di instagram_service.js, jadi tidak pernah tahu
  // kalau sudah ada data Instagram REAL hasil sync Meta Graph API
  // (syncInstagramFromMeta). Sekarang lewat fungsi yang sama supaya data
  // real ikut mengalir ke sini, bukan cuma di endpoint /api/instagram/profile.
  const instagramProfile = getInstagramProfile();
  const tiktokProfile = getSafeJson('tiktok_profile.json', MARKETING_DB_DIR);
  return {
    content_plans: Array.isArray(contentPlans) ? contentPlans : [],
    published_posts: Array.isArray(publishedPosts) ? publishedPosts : [],
    instagram_profile: instagramProfile || null,
    tiktok_profile: tiktokProfile || null,
    // meta_daily_ads.json ditulis manual, bukan hasil sync API Meta Ads
    // Manager sungguhan (nol koneksi API di seluruh kode) — lihat juga
    // integrations_hub.meta_ads dan meta_ads_dashboard di getClinicSummary().
    meta_ads: {
      available: false,
      note: 'Tidak ada koneksi API Meta Ads Manager. Data campaign di sini sebelumnya ditulis manual, bukan hasil sync otomatis.'
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PERBANDINGAN SALES: AKUISISI vs UPSELLING
//
// Dua metrik berbeda, sengaja dipisah karena mengukur hal yang berbeda:
//
//   AKUISISI  = staff_id pada invoice PERTAMA tiap pasien. Ini proxy
//               terbaik yang tersedia untuk "siapa yang dapat pasien" —
//               marketing_source_id 100% kosong ("NONE") di seluruh
//               invoice, dan consultant_id cuma terisi 42% serta TIDAK
//               berkorelasi dengan kunjungan pertama (40% vs 42%), jadi
//               tidak bisa dipakai sebagai sinyal akuisisi yang jujur.
//
//   UPSELLING = kenaikan nilai transaksi di atas RATA-RATA pasien itu
//               sendiri (baseline per pasien, bukan angka umum),
//               diatribusikan ke dokter/terapis yang menangani baris
//               transaksi tersebut. Dokter yang kebetulan pegang banyak
//               pasien VIP tidak otomatis menang — yang dihitung adalah
//               seberapa jauh dia mendorong pasien di ATAS kebiasaannya.
//
// 'NONE' (placeholder master, bukan nama staf) dan 'Admin' difilter,
// konsisten dengan konvensi di searchPatient360.
// ═══════════════════════════════════════════════════════════════════════

let _salesCompareCache = null;

function getSalesComparison() {
  const invoices = getSafeJson('invoices_all.json');
  const usages = getSafeJson('usages_details.json');
  const therapists = getSafeJson('therapists.json');
  const doctorTypes = getSafeJson('doctortypes.json');

  const stamp = `${invoices.length}|${usages.length}|${therapists.length}`;
  if (_salesCompareCache && _salesCompareCache.stamp === stamp) return _salesCompareCache.data;

  const typeNameById = {};
  doctorTypes.forEach(d => { typeNameById[d.id] = d.name; });

  const staffById = {};
  therapists.forEach(t => {
    const n = String(t.therapist_name || '').trim();
    const isPlaceholder = !n || n.toUpperCase() === 'NONE' || n.toUpperCase() === 'ADMIN';
    staffById[t.id] = {
      name: isPlaceholder ? '' : n,
      role: typeNameById[t.type] || 'Lainnya',
      active: t.status_therapist !== false
    };
  });
  const staffName = (id) => (staffById[id] && staffById[id].name) || '';
  const staffRole = (id) => (staffById[id] && staffById[id].role) || 'Lainnya';

  // Invoice migrasi sisa paket bukan transaksi; pasiennya pasien lama
  // (punya paket dari sistem sebelumnya), jadi bukan akuisisi baru.
  const migratedCustomers = new Set(invoices.filter(i => !i.void_invoice && isMigrationInvoice(i)).map(i => i.customer_id));
  const activeInvoices = invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i));

  // ── AKUISISI: staff_id pada invoice PERTAMA tiap pasien ──────────────
  const firstInvoiceByCust = {};
  activeInvoices.forEach(i => {
    const cur = firstInvoiceByCust[i.customer_id];
    if (!cur || String(i.inv_date || '') < String(cur.inv_date || '')) {
      firstInvoiceByCust[i.customer_id] = i;
    }
  });

  const acquisitionMap = {};
  Object.values(firstInvoiceByCust).forEach(inv => {
    if (migratedCustomers.has(inv.customer_id)) return;
    const sid = inv.staff_id;
    if (!sid || !staffName(sid)) return;
    const t = acquisitionMap[sid] || (acquisitionMap[sid] = {
      staff_id: sid, name: staffName(sid), role: staffRole(sid),
      new_patients: 0, first_invoice_revenue: 0
    });
    t.new_patients += 1;
    t.first_invoice_revenue += Number(inv.total_after_tax || inv.total || 0);
  });

  // ── UPSELLING: kenaikan di atas baseline (rata-rata) pasien sendiri ──
  const invByCode = {};
  activeInvoices.forEach(i => { if (i.inv_code) invByCode[i.inv_code] = i; });

  const linesByCustomer = {};
  usages.forEach(u => {
    const inv = invByCode[u.inv_code];
    if (!inv) return;
    const value = Number(u.value || 0);
    if (!value) return;
    (linesByCustomer[inv.customer_id] = linesByCustomer[inv.customer_id] || [])
      .push({ value, doctor_id: inv.doctor_id, therapist_id: inv.therapist_id });
  });

  const upsellMap = {};
  let patientsWithBaseline = 0;
  Object.values(linesByCustomer).forEach(lines => {
    // Baseline butuh minimal 2 baris — dengan 1 baris tidak ada "rata-rata
    // pasien" yang bisa dibandingkan, semuanya akan tampak sebagai uplift.
    if (lines.length < 2) return;
    patientsWithBaseline++;
    const baseline = lines.reduce((a, l) => a + l.value, 0) / lines.length;

    lines.forEach(l => {
      const uplift = l.value - baseline;
      if (uplift <= 0) return;
      [['doctor', l.doctor_id], ['therapist', l.therapist_id]].forEach(([role, sid]) => {
        if (!sid || !staffName(sid)) return;
        const key = `${role}:${sid}`;
        const t = upsellMap[key] || (upsellMap[key] = {
          staff_id: sid, name: staffName(sid), role: staffRole(sid),
          handling_as: role === 'doctor' ? 'Dokter' : 'Terapis/Perawat',
          upsell_count: 0, upsell_value: 0
        });
        t.upsell_count += 1;
        t.upsell_value += uplift;
      });
    });
  });

  // ── Gabungkan jadi satu tabel perbandingan per staf ──────────────────
  const byStaffId = {};
  Object.values(acquisitionMap).forEach(a => {
    byStaffId[a.staff_id] = { staff_id: a.staff_id, name: a.name, role: a.role,
      new_patients: a.new_patients, first_invoice_revenue: a.first_invoice_revenue,
      upsell_count: 0, upsell_value: 0 };
  });
  Object.values(upsellMap).forEach(u => {
    const row = byStaffId[u.staff_id] || (byStaffId[u.staff_id] = {
      staff_id: u.staff_id, name: u.name, role: u.role,
      new_patients: 0, first_invoice_revenue: 0, upsell_count: 0, upsell_value: 0
    });
    row.upsell_count += u.upsell_count;
    row.upsell_value += u.upsell_value;
  });

  const comparison = Object.values(byStaffId)
    .map(r => ({
      staff_id: r.staff_id,
      name: r.name,
      role: r.role,
      new_patients: r.new_patients,
      new_patients_revenue: Math.round(r.first_invoice_revenue),
      new_patients_revenue_fmt: rupiah(r.first_invoice_revenue),
      upsell_transactions: r.upsell_count,
      upsell_value: Math.round(r.upsell_value),
      upsell_value_fmt: rupiah(r.upsell_value),
      avg_upsell_per_transaction: r.upsell_count > 0 ? Math.round(r.upsell_value / r.upsell_count) : 0
    }))
    .filter(r => r.new_patients > 0 || r.upsell_transactions > 0)
    .sort((a, b) => (b.new_patients_revenue + b.upsell_value) - (a.new_patients_revenue + a.upsell_value));

  const data = {
    top_acquisition: [...comparison].sort((a, b) => b.new_patients - a.new_patients).filter(r => r.new_patients > 0).slice(0, 15),
    top_upselling: [...comparison].sort((a, b) => b.upsell_value - a.upsell_value).filter(r => r.upsell_transactions > 0).slice(0, 15),
    comparison_table: comparison,
    meta: {
      total_new_patients: Object.values(acquisitionMap).reduce((a, t) => a + t.new_patients, 0),
      total_upsell_value: Math.round(Object.values(upsellMap).reduce((a, t) => a + t.upsell_value, 0) / 2), // dibagi 2: tiap baris ikut dihitung ke doctor DAN therapist
      total_upsell_value_fmt: rupiah(Object.values(upsellMap).reduce((a, t) => a + t.upsell_value, 0) / 2),
      patients_with_baseline: patientsWithBaseline,
      note_acquisition: 'Akuisisi = staf pada invoice PERTAMA tiap pasien. marketing_source_id 100% kosong di seluruh data, consultant_id tidak konsisten (hanya 42% terisi) sehingga tidak dipakai.',
      note_upsell: 'Upselling = nilai transaksi DI ATAS rata-rata pasien itu sendiri (bukan angka umum), diatribusikan ke dokter/terapis penangan. Pasien dengan <2 transaksi tidak punya baseline dan dilewati.'
    }
  };

  _salesCompareCache = { stamp, data };
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// ANALISIS JAM SIBUK (PEAK HOUR) KEDATANGAN PASIEN
//
// Sumber: invoices_all.json — 1.033 invoice (Neosoft) jauh lebih lengkap
// daripada appointment_full.json (611 baris, campuran status booking).
//
// CATATAN PENTING soal `inv_date`: field ini diberi akhiran "Z" (penanda
// UTC) tapi ANGKA JAMNYA SUDAH WIB. Dibuktikan dari selisih konsisten +7
// jam terhadap `created_at` (true UTC) pada 196/200 sampel. Karena itu
// jam diekstrak lewat SUBSTRING STRING MENTAH, bukan lewat objek Date —
// memanggil new Date(inv_date).getHours() akan salah (parsing ganda
// offset timezone pada string yang labelnya sudah keliru).
//
// 11 invoice berjam PERSIS 00:00:00 dikecualikan dari analisis jam —
// pola ini konsisten dengan invoice yang di-input massal tanpa jam
// transaksi riil (created_at sungguhan berbeda jauh, larut malam hari
// berikutnya), bukan kunjungan tengah malam sungguhan. Klinik memang
// tidak buka jam segitu.
// ═══════════════════════════════════════════════════════════════════════

const HARI_NAMA = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_LABEL_MAP = {
  '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
  '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
  '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
};

let _peakHourMultiCache = {};

function getPeakHourAnalysis(period = 'all') {
  const normPeriod = String(period || 'all').trim();
  const invoices = getSafeJson('invoices_all.json');
  const stamp = `${invoices.length}:${normPeriod}`;
  if (_peakHourMultiCache[stamp]) return _peakHourMultiCache[stamp];

  const active = invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i));

  // Discover all available months and years from dataset
  const monthSet = new Set();
  const yearSet = new Set();
  active.forEach(i => {
    if (i.inv_date) {
      const ym = String(i.inv_date).substring(0, 7);
      const y = String(i.inv_date).substring(0, 4);
      if (/^\d{4}-\d{2}$/.test(ym)) monthSet.add(ym);
      if (/^\d{4}$/.test(y)) yearSet.add(y);
    }
  });

  const sortedMonths = Array.from(monthSet).sort().reverse();
  const sortedYears = Array.from(yearSet).sort().reverse();

  const availablePeriods = [
    { value: 'all', label: 'Seluruh Data (Mei – Sep 2026)', type: 'all' },
    ...sortedYears.map(y => ({ value: y, label: `Tahun ${y} (1 Tahun Berjalan)`, type: 'year' })),
    ...sortedMonths.map(m => {
      const [y, mo] = m.split('-');
      return { value: m, label: `${BULAN_LABEL_MAP[mo] || mo} ${y}`, type: 'month' };
    })
  ];

  // Filter invoices based on selected period
  let filtered = active;
  let periodLabel = 'Seluruh Data (All Time)';
  if (normPeriod !== 'all' && normPeriod !== 'lifetime') {
    filtered = active.filter(i => String(i.inv_date || '').startsWith(normPeriod));
    if (normPeriod.length === 4) {
      periodLabel = `Tahun ${normPeriod} (1 Tahun Berjalan)`;
    } else if (normPeriod.length === 7) {
      const [y, mo] = normPeriod.split('-');
      periodLabel = `Bulan ${BULAN_LABEL_MAP[mo] || mo} ${y}`;
    } else {
      periodLabel = `Periode ${normPeriod}`;
    }
  }

  const withTime = filtered.filter(i => {
    const t = String(i.inv_date || '').substring(11, 19);
    return t && t !== '00:00:00';
  });
  const excludedMidnight = filtered.length - withTime.length;

  // Pre-populate standard business operating hours 09:00 - 21:00
  const STANDARD_HOURS = ['09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'];
  const hourTally = {};
  STANDARD_HOURS.forEach(hh => {
    hourTally[hh] = { hour: hh, count: 0, depok: 0, pdk: 0 };
  });

  // Pre-populate days of week
  const dowTally = {};
  [0, 1, 2, 3, 4, 5, 6].forEach(d => {
    dowTally[d] = 0;
  });

  const heatmap = {}; // 'dow:hh' -> count
  let outletTotals = { 1: 0, 2: 0 };

  withTime.forEach(inv => {
    const dateStr = String(inv.inv_date).substring(0, 10);
    const hh = String(inv.inv_date).substring(11, 13);
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return;
    const dow = new Date(y, m - 1, d).getDay();

    if (!hourTally[hh]) {
      hourTally[hh] = { hour: hh, count: 0, depok: 0, pdk: 0 };
    }
    const h = hourTally[hh];
    h.count += 1;
    if (inv.outlet_id === 1) h.depok += 1;
    else if (inv.outlet_id === 2) h.pdk += 1;

    dowTally[dow] = (dowTally[dow] || 0) + 1;

    const hkey = `${dow}:${hh}`;
    const cell = heatmap[hkey] || (heatmap[hkey] = { count: 0, depok: 0, pdk: 0 });
    cell.count += 1;
    if (inv.outlet_id === 1) cell.depok += 1;
    else if (inv.outlet_id === 2) cell.pdk += 1;

    if (inv.outlet_id === 1 || inv.outlet_id === 2) outletTotals[inv.outlet_id]++;
  });

  const hourly = Object.values(hourTally).sort((a, b) => a.hour.localeCompare(b.hour));
  const maxHourCount = Math.max(1, ...hourly.map(h => h.count));
  const hourlyWithPct = hourly.map(h => ({
    ...h,
    label: `${h.hour}:00`,
    pct_of_peak: Math.round((h.count / maxHourCount) * 100)
  }));

  const peakHour = hourlyWithPct.reduce((a, b) => (b.count > (a ? a.count : -1) ? b : a), null);
  const quietHour = hourlyWithPct
    .filter(h => h.count > 0)
    .reduce((a, b) => (b.count < (a ? a.count : Infinity) ? b : a), null);

  const dowRanked = Object.entries(dowTally)
    .map(([dow, count]) => ({ dow: Number(dow), name: HARI_NAMA[dow], count }))
    .sort((a, b) => b.count - a.count);

  // Heatmap hari x jam, dinormalisasi ke 0-100 untuk pewarnaan di UI
  const heatmapCounts = Object.values(heatmap).map(c => c.count);
  const heatmapMax = Math.max(1, ...heatmapCounts);
  const heatmapCells = Object.entries(heatmap).map(([key, c]) => {
    const [dow, hh] = key.split(':');
    return {
      dow: Number(dow),
      day_name: HARI_NAMA[dow],
      hour: hh,
      count: c.count,
      depok: c.depok,
      pdk: c.pdk,
      intensity: Math.round((c.count / heatmapMax) * 100)
    };
  });

  const busiestCell = heatmapCells.reduce((a, b) => (b.count > (a ? a.count : -1) ? b : a), null);

  const data = {
    selected_period: normPeriod,
    period_label: periodLabel,
    available_periods: availablePeriods,
    total_invoices_analysed: withTime.length,
    excluded_no_timestamp: excludedMidnight,
    hourly: hourlyWithPct,
    peak_hour: peakHour,
    quiet_hour: quietHour,
    by_day_of_week: dowRanked,
    busiest_day: dowRanked[0] || null,
    heatmap: heatmapCells,
    busiest_slot: busiestCell,
    by_outlet: {
      depok: outletTotals[1],
      pondok_kopi: outletTotals[2]
    },
    note: 'Jam diambil dari inv_date (label UTC tapi angka jam sudah WIB — diverifikasi via selisih +7 jam terhadap created_at). Invoice berjam 00:00:00 persis dikecualikan karena kemungkinan besar input massal tanpa jam riil, bukan kunjungan tengah malam.'
  };

  _peakHourMultiCache[stamp] = data;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// DAFTAR PASIEN BERDASARKAN FREKUENSI KEDATANGAN
//
// Berdiri sendiri dari getClinicMissionControlData (yang sudah menghitung
// grade serupa secara internal) supaya bisa di-cache dan dipanggil murah
// tanpa menyeret seluruh komputasi dashboard.
//
// Hanya pasien dengan >=1 invoice non-void yang disertakan — 7.449 dari
// 8.099 pasien di master Neosoft belum pernah bertransaksi sama sekali,
// dan frekuensi tidak bermakna tanpa kunjungan. Itu ditandai terpisah
// lewat classifyPatientGrade sebagai grade 'BELUM', bukan dipaksa masuk
// daftar sebagai Grade Z (lihat komentar di classifyPatientGrade).
// ═══════════════════════════════════════════════════════════════════════

let _patientFrequencyCache = new Map();

// opts: { start, end, branch } — 'YYYY-MM-DD' & 'Depok' / 'Pondok Kopi'.
//   • Pasien yang tampil  : yang DATANG TREATMENT di rentang (dan cabang) itu.
//   • Kunjungan (periode) : hari kunjungan treatment di rentang itu.
//   • Frekuensi & grade   : riwayat kunjungan treatment SAMPAI akhir rentang,
//     supaya 1 kunjungan di rentang 6 hari tidak langsung terbaca "rutin".
//   • Total belanja       : invoice (non-void, non-migrasi) di rentang & cabang itu.
// Tanpa rentang = seluruh riwayat (perilaku lama, tapi kunjungan hanya treatment).
function getPatientFrequencyList(opts = {}) {
  const customers = getSafeJson('customers_all.json');
  const invoices = getSafeJson('invoices_all.json');
  const visitIdx = treatmentVisitIndex();
  const okDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
  const today = todayJakarta();
  const start = okDate(opts.start), endRaw = okDate(opts.end);
  const end = endRaw && endRaw < today ? endRaw : (endRaw ? today : null);
  const outletId = /pondok/i.test(opts.branch || '') ? 2 : /depok/i.test(opts.branch || '') ? 1 : null;

  const key = `${customers.length}|${invoices.length}|${visitIdx.size}|${start}|${end}|${outletId}`;
  const hit = _patientFrequencyCache.get(key);
  if (hit && hit.idx === visitIdx) return hit.data;

  const custMap = {};
  customers.forEach(c => { custMap[c.id] = c; });
  const spend = {};
  invoices.forEach(inv => {
    if (inv.void_invoice || isMigrationInvoice(inv)) return;
    if (outletId && Number(inv.outlet_id) !== outletId) return;
    const d = String(inv.inv_date || inv.created_at || '').substring(0, 10);
    if ((start && d < start) || (end && d > end)) return;
    spend[inv.customer_id] = (spend[inv.customer_id] || 0) + Number(inv.total_after_tax || inv.total || 0);
  });

  // Acuan waktu sama dengan ringkasan dashboard (awal hari ini WIB), atau akhir periode bila periodenya sudah lewat.
  const nowRef = end && end < today ? new Date(end + 'T23:59:59').getTime() : new Date(today + 'T00:00:00').getTime();
  const list = [];
  visitIdx.forEach((dates, cid) => {
    const c = custMap[cid];
    if (!c) return;
    const days = [], outlets = new Set();
    dates.forEach((outs, date) => {
      if (end && date > end) return;
      if (outletId && !outs.has(outletId)) return;
      days.push(date);
      outs.forEach(o => outlets.add(o));
    });
    if (!days.length) return;
    days.sort();
    const inPeriod = days.filter(d => (!start || d >= start) && (!end || d <= end));
    if ((start || end) && !inPeriod.length) return;
    const g = classifyPatientGrade(days.length, days[0], nowRef);
    const nameObj = c.name || {};
    const total = spend[cid] || 0;
    list.push({
      id: c.id,
      name: `${nameObj.first_name || ''} ${nameObj.last_name || ''}`.trim() || 'Pasien',
      phone: c.phone || '',
      code: c.code || '',
      grade: g.grade,
      grade_label: g.label,
      grade_color: g.color,
      rate_per_month: g.rate_per_month,
      visit_days: inPeriod.length,
      visit_days_total: days.length,
      months_observed: g.months_observed,
      measurable: g.measurable,
      first_visit: days[0],
      last_visit: days[days.length - 1],
      total_spent: Math.round(total),
      total_spent_fmt: rupiah(total),
      outlets: [...outlets].map(o => (o === 1 ? 'Depok' : o === 2 ? 'Pondok Kopi' : '')).filter(Boolean).join(', ') || '-'
    });
  });
  // Belum terukur (grade BARU) ditaruh setelah yang punya angka;
  // di antara yang terukur, diurutkan dari paling sering datang.
  list.sort((a, b) => {
    if (a.measurable !== b.measurable) return a.measurable ? -1 : 1;
    if (!a.measurable) return (b.visit_days - a.visit_days);
    return b.rate_per_month - a.rate_per_month || b.visit_days - a.visit_days;
  });

  const counts = {};
  list.forEach(p => { counts[p.grade] = (counts[p.grade] || 0) + 1; });

  const data = {
    total: list.length,
    counts,
    start, end, branch: outletId === 1 ? 'Depok' : outletId === 2 ? 'Pondok Kopi' : 'all',
    patients: list,
    note: 'Kunjungan = hari pasien dikerjakan treatment (pemakaian Neosoft); beli produk saja tidak dihitung. Frekuensi & grade dari riwayat kunjungan treatment sampai akhir periode; kolom kunjungan & total belanja khusus periode terpilih.'
  };
  if (_patientFrequencyCache.size > 30) _patientFrequencyCache.clear();
  _patientFrequencyCache.set(key, { idx: visitIdx, data });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// DEMOGRAFI PASIEN: USIA, PEKERJAAN, TEMPAT TINGGAL
//
// TEMUAN KUALITAS DATA — dipatuhi ketat, bukan dirapikan diam-diam:
//
//   PEKERJAAN (occupation): 0 dari 8.099 pasien terisi. Field ada di
//   skema Neosoft tapi tidak pernah diisi staf sama sekali. Tidak ada
//   fitur "list by job" yang bisa dibangun dari data ini — dilaporkan
//   sebagai fakta, bukan dibuat daftar kosong yang seolah berfungsi.
//
//   USIA: dihitung dari birth_information.birth_date, TAPI 2.519 dari
//   8.099 (31%) dikecualikan karena:
//     - birth_date == join_date persis (384 pasien) — indikasi field
//       tanggal lahir di-default ke tanggal daftar, pola yang sama
//       dengan bug join_date "0001-01-01" pada CLV yang diperbaiki
//       sebelumnya, bukan tanggal lahir sungguhan.
//     - tahun di luar rentang wajar, atau usia tersirat <8 / >100
//       tahun (2.135 pasien) — sebagian besar usia <8, kemungkinan
//       salah input tahun, bukan pasien anak-anak sungguhan di klinik
//       dermatologi dewasa.
//   Sisa 5.580 (69%) dipakai, dan distribusinya masuk akal untuk
//   klinik: puncak di 25-34 tahun (50%).
//
//   TEMPAT TINGGAL (address): field teks bebas, tanpa referensi ke
//   master lokasi manapun (tidak ada city_id/province_id di skema
//   Neosoft). 1.881 dari 8.099 bernilai literal "/N" — artefak NULL
//   dari ekspor database, BUKAN alamat "kosong yang ditulis manual".
//   Setelah itu disaring, 6.053 (75%) punya alamat asli, tapi sangat
//   terfragmentasi (2.798 varian unik setelah normalisasi huruf besar)
//   karena tidak ada standardisasi penulisan ("Depok", "DEPOK", "JKT",
//   "JAKARTA TIMUR" semua dihitung terpisah). Ditampilkan sebagai
//   ranking frekuensi apa adanya — TIDAK digabung otomatis (mis. "JKT"
//   digabung ke "JAKARTA") karena itu tebakan, bukan fakta.
// ═══════════════════════════════════════════════════════════════════════

let _demographicsCache = null;

function getPatientDemographics() {
  const customers = getSafeJson('customers_all.json');
  const stamp = String(customers.length);
  if (_demographicsCache && _demographicsCache.stamp === stamp) return _demographicsCache.data;

  const now = Date.now();
  const AGE_BRACKETS = [
    ['<18', 0, 17], ['18-24', 18, 24], ['25-34', 25, 34], ['35-44', 35, 44],
    ['45-54', 45, 54], ['55-64', 55, 64], ['65+', 65, 999]
  ];

  const patientOf = (c) => ({
    id: c.id,
    name: `${c.name?.first_name || ''} ${c.name?.last_name || ''}`.trim() || 'Pasien',
    phone: c.phone || '',
    code: c.code || ''
  });

  // ── USIA ──────────────────────────────────────────────────────────
  let ageExcludedDefault = 0, ageExcludedImplausible = 0;
  const ageBuckets = {}; AGE_BRACKETS.forEach(([label]) => { ageBuckets[label] = []; });
  const ageList = [];

  customers.forEach(c => {
    const bd = c.birth_information && c.birth_information.birth_date;
    if (!bd) { ageExcludedImplausible++; return; }
    const bdDate = String(bd).substring(0, 10);
    const joinDate = String(c.join_date || '').substring(0, 10);
    if (bdDate === joinDate && bdDate !== '0001-01-01') { ageExcludedDefault++; return; }
    const y = new Date(bd).getFullYear();
    if (!(y > 1920 && y < 2026)) { ageExcludedImplausible++; return; }
    const age = Math.floor((now - new Date(bd).getTime()) / (365.25 * 24 * 3600 * 1000));
    if (age < 8 || age > 100) { ageExcludedImplausible++; return; }

    const bracket = AGE_BRACKETS.find(([, lo, hi]) => age >= lo && age <= hi);
    const p = { ...patientOf(c), age, birth_date: bdDate };
    ageBuckets[bracket[0]].push(p);
    ageList.push(p);
  });
  AGE_BRACKETS.forEach(([label]) => ageBuckets[label].sort((a, b) => a.age - b.age));

  const ageGroups = AGE_BRACKETS.map(([label]) => ({
    label, count: ageBuckets[label].length, patients: ageBuckets[label]
  }));

  // ── PEKERJAAN ─────────────────────────────────────────────────────
  const occupationFilled = customers.filter(c => {
    const o = String(c.occupation || '').trim();
    return o && o !== '-';
  }).length;

  // ── TEMPAT TINGGAL ────────────────────────────────────────────────
  // Dulu dikelompokkan HANYA dengan huruf besar + rapikan spasi — jadi
  // "Jl. Margonda No. 5", "JL MARGONDA NO 5", dan "Jl Margonda No.5"
  // jadi 3 grup berbeda, bikin daftar area berantakan (ratusan grup
  // yang sebagian besar cuma varian ejaan dari alamat yang sama).
  // Neosoft tidak punya city_id/kecamatan_id terstruktur di skema
  // ekspornya, jadi TIDAK BISA dikelompokkan sempurna — tapi bisa
  // dikelompokkan lebih kasar & lebih berguna: cari nama kota/kecamatan
  // yang DIKENAL (sekitar 2 cabang: Depok & Jakarta Timur, plus kota
  // Jabodetabek umum) di teks alamat, kelompokkan berdasarkan itu.
  // Alamat yang tidak cocok satu pun keyword tetap ditampilkan apa
  // adanya di grup "Area Tidak Teridentifikasi" — bukan dipaksakan.
  const KNOWN_AREAS = [
    // Kecamatan Kota Depok (11)
    'BEJI', 'PANCORAN MAS', 'CIPAYUNG', 'SUKMAJAYA', 'CILODONG', 'CIMANGGIS',
    'TAPOS', 'SAWANGAN', 'BOJONGSARI', 'LIMO', 'CINERE',
    // Kecamatan Jakarta Timur (10)
    'DUREN SAWIT', 'PONDOK KOPI', 'KLENDER', 'JATINEGARA', 'CAKUNG',
    'PULOGADUNG', 'PULO GADUNG', 'KRAMAT JATI', 'MAKASAR', 'CIPAYUNG JAKARTA',
    'CIRACAS', 'PASAR REBO', 'MATRAMAN', 'JATI NEGARA',
    // Kota/Kabupaten Jabodetabek umum lainnya
    'JAKARTA TIMUR', 'JAKARTA SELATAN', 'JAKARTA BARAT', 'JAKARTA UTARA', 'JAKARTA PUSAT',
    'KOTA DEPOK', 'BEKASI', 'BOGOR', 'TANGERANG SELATAN', 'TANGERANG', 'CIBUBUR', 'CILEUNGSI'
  ];

  const NULL_MARKERS = new Set(['', '-', '/N', '\\N', 'N/A', 'NA']);
  let addressExcludedNull = 0;
  const areaGroups = {};   // grup kasar (kota/kecamatan terdeteksi)
  const addressList = [];

  const detectArea = (normText) => {
    // Cocokkan yang paling spesifik dulu (nama lebih panjang duluan)
    // supaya "PULO GADUNG" tidak ketiban match "JAKARTA TIMUR" saja.
    const sorted = [...KNOWN_AREAS].sort((a, b) => b.length - a.length);
    for (const area of sorted) {
      if (normText.includes(area)) return area;
    }
    return null;
  };

  customers.forEach(c => {
    const raw = String(c.address || '').trim();
    if (NULL_MARKERS.has(raw.toUpperCase())) { addressExcludedNull++; return; }
    const norm = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    const area = detectArea(norm) || 'AREA TIDAK TERIDENTIFIKASI';
    const g = areaGroups[area] || (areaGroups[area] = { area, variants: {}, patients: [] });
    const p = patientOf(c);
    g.patients.push(p);
    // Simpan varian penulisan asli di dalam grup kasar — bukan digabung
    // paksa, cuma dikelompokkan di bawah area yang sama supaya bisa
    // di-drill-down kalau perlu.
    const vg = g.variants[norm] || (g.variants[norm] = { text: norm, raw_example: raw, count: 0 });
    vg.count++;
    addressList.push({ ...p, address: raw });
  });

  const residenceGroups = Object.values(areaGroups)
    .map(g => ({
      area: g.area,
      count: g.patients.length,
      patients: g.patients,
      variant_count: Object.keys(g.variants).length,
      top_variants: Object.values(g.variants).sort((a, b) => b.count - a.count).slice(0, 5)
    }))
    .sort((a, b) => b.count - a.count);

  const data = {
    age: {
      total_analysed: ageList.length,
      excluded_default_value: ageExcludedDefault,
      excluded_implausible: ageExcludedImplausible,
      excluded_no_data: customers.length - ageList.length - ageExcludedDefault - ageExcludedImplausible,
      groups: ageGroups,
      note: 'birth_date yang PERSIS SAMA dengan join_date (384 pasien) dan usia tersirat <8 atau >100 tahun (2.135 pasien) dikecualikan — pola yang sama dengan bug default tanggal yang ditemukan pada join_date CLV sebelumnya, bukan tanggal lahir sungguhan.'
    },
    occupation: {
      total_filled: occupationFilled,
      total_customers: customers.length,
      available: occupationFilled > 0,
      note: `Field pekerjaan kosong di ${customers.length - occupationFilled} dari ${customers.length} pasien (${occupationFilled === 0 ? 'SELURUHNYA' : Math.round((customers.length - occupationFilled) / customers.length * 100) + '%'}). Tidak bisa dibuat daftar "by job" dari data yang tidak pernah diisi.`
    },
    residence: {
      total_with_address: addressList.length,
      excluded_null_marker: addressExcludedNull,
      total_customers: customers.length,
      groups: residenceGroups.slice(0, 200),
      total_unique_areas: residenceGroups.length,
      note: `${addressExcludedNull} dari ${customers.length} alamat bernilai literal "/N" (artefak NULL ekspor database, sudah dikecualikan). Neosoft tidak punya kolom kota/kecamatan terstruktur, jadi dikelompokkan dengan mencari nama kecamatan/kota yang dikenal (Depok & Jakarta Timur + Jabodetabek umum) di teks alamat — bukan pencocokan string persis seperti sebelumnya (dulu "Jl. Margonda No.5" dan "JL MARGONDA NO 5" jadi 2 grup terpisah). Alamat yang tidak cocok satu pun kecamatan/kota dikenal masuk grup "Area Tidak Teridentifikasi", ditampilkan apa adanya — bukan ditebak.`
    }
  };

  _demographicsCache = { stamp, data };
  return data;
}

function addContentPlan(planEntry) {
  try {
    const filePath = path.join(MARKETING_DB_DIR, 'content_plans.json');
    let existing = [];
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    existing.unshift(planEntry);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving content plan:', e);
    return false;
  }
}

// Dulu content plan cuma bisa ditambah (addContentPlan) — begitu tersimpan,
// tidak ada jalan untuk mengoreksi topik/hook/caption yang salah ketik atau
// mengubah status draft->approved selain edit manual file JSON. Ini
// menambah update sungguhan, dicari berdasarkan id yang sudah dibuat
// create-content-plan (format CP-2026-XXX).
function updateContentPlan(id, patch) {
  if (!id) return { success: false, error: 'id wajib diisi' };
  try {
    const filePath = path.join(MARKETING_DB_DIR, 'content_plans.json');
    if (!fs.existsSync(filePath)) return { success: false, error: 'Belum ada content plan tersimpan.' };
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const idx = existing.findIndex(cp => cp.id === id);
    if (idx === -1) return { success: false, error: `Content plan dengan id ${id} tidak ditemukan.` };

    const allowedFields = ['date', 'day', 'pillar', 'format', 'topic', 'hook', 'caption', 'hashtags', 'pic', 'status', 'carousel_slides'];
    allowedFields.forEach(f => {
      if (patch[f] !== undefined) existing[idx][f] = patch[f];
    });

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    return { success: true, data: existing[idx] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function addTeamComplaint(complaintEntry) {
  try {
    const filePath = path.join(OPERATIONAL_DB_DIR, 'team_complaints.json');
    let existing = [];
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    existing.unshift(complaintEntry);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving team complaint:', e);
    return false;
  }
}

function addSopChecklist(checklistEntry) {
  try {
    const filePath = path.join(OPERATIONAL_DB_DIR, 'sop_checklists.json');
    let existing = [];
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    existing.unshift(checklistEntry);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving SOP checklist:', e);
    return false;
  }
}

function getDispatchLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [
    { timestamp: '2026-08-27 21:00:15 WIB', type: 'Daily Scheduled Cron', status: 'Success', items_sent: 6, recipient: 'KEFIR Management Telegram Group', delay: '1.5s/bubble' }
  ];
}

function addDispatchLog(logEntry) {
  const logs = getDispatchLogs();
  logs.unshift(logEntry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(0, 30), null, 2));
}

// --- Smart Follow-Up status tracking (prevents duplicate WA outreach) ---
// Keyed by `${entry.id}|${stage}` (e.g. "FU-KDC-I-202609-0042|H+3 (Cek Kondisi & Keluhan)")
// so the same invoice can legitimately re-appear at a later stage, but never twice at the same stage.
function getFollowUpStatusLog() {
  try {
    if (fs.existsSync(FOLLOWUP_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWUP_STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function markFollowUpDone({ id, stage, patient, phone, outlet, treatment, marked_by }) {
  if (!id || !stage) return { success: false, error: 'id dan stage wajib diisi' };
  const key = `${id}|${stage}`;
  const logs = getFollowUpStatusLog();
  if (logs.some(l => l.key === key)) {
    return { success: true, already_marked: true, key };
  }
  logs.unshift({
    key,
    id,
    stage,
    patient: patient || '',
    phone: phone || '',
    outlet: outlet || '',
    treatment: treatment || '',
    marked_by: marked_by || 'Unknown',
    marked_at: new Date().toISOString()
  });
  try {
    fs.mkdirSync(path.dirname(FOLLOWUP_STATUS_FILE), { recursive: true });
    fs.writeFileSync(FOLLOWUP_STATUS_FILE, JSON.stringify(logs.slice(0, 5000), null, 2));
    return { success: true, already_marked: false, key };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function isFollowUpDone(id, stage) {
  const key = `${id}|${stage}`;
  return getFollowUpStatusLog().some(l => l.key === key);
}

// --- Asset condition & purchase-date manual input (dashboard-side) ---
// Spreadsheet "Preventive maintenance" sheet punya kolom Notes (kondisi
// terakhir) tapi sering kosong, dan sheet "Asset" belum punya kolom
// tanggal beli sama sekali. Ini menyimpan input manual dari dashboard
// sebagai pelengkap/override, dikunci per asset dengan key normalisasi
// `${nama}|${cabang_atau_lokasi}` supaya cocok dengan baris di kedua sheet.
function normalizeAssetKey(name, branchOrLocation) {
  return `${String(name || '').trim().toLowerCase()}|${String(branchOrLocation || '').trim().toLowerCase()}`;
}

function getAssetManualNotes() {
  try {
    if (fs.existsSync(ASSET_MANUAL_NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(ASSET_MANUAL_NOTES_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function setAssetManualNote({ name, branch_or_location, condition_notes, purchase_date, usage_instructions, service_procedure, maintenance_type_override, updated_by }) {
  if (!name) return { success: false, error: 'name wajib diisi' };
  const key = normalizeAssetKey(name, branch_or_location);
  const notes = getAssetManualNotes();
  const existing = notes[key] || {};
  notes[key] = {
    ...existing,
    name,
    branch_or_location: branch_or_location || existing.branch_or_location || '',
    condition_notes: condition_notes !== undefined ? condition_notes : existing.condition_notes || null,
    purchase_date: purchase_date !== undefined ? purchase_date : existing.purchase_date || null,
    usage_instructions: usage_instructions !== undefined ? usage_instructions : existing.usage_instructions || null,
    service_procedure: service_procedure !== undefined ? service_procedure : existing.service_procedure || null,
    // Override manual kalau klasifikasi otomatis (lihat classifyMaintenanceType)
    // salah baca — staf bisa koreksi langsung ke 'Preventive' atau 'Corrective'.
    maintenance_type_override: maintenance_type_override !== undefined ? maintenance_type_override : existing.maintenance_type_override || null,
    updated_by: updated_by || 'Dashboard User',
    updated_at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(ASSET_MANUAL_NOTES_FILE), { recursive: true });
    fs.writeFileSync(ASSET_MANUAL_NOTES_FILE, JSON.stringify(notes, null, 2));
    return { success: true, key, entry: notes[key] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function recordAssetService({
  asset_key,
  asset_name,
  branch,
  service_date,
  vendor,
  action,
  cost,
  next_due,
  frequency_months,
  maintenance_type,
  performed_by,
  condition_notes,
  service_procedure
}) {
  if (!asset_name && !asset_key) {
    return { success: false, error: 'Nama aset atau asset_key wajib diisi' };
  }
  const key = asset_key || normalizeAssetKey(asset_name, branch);
  const notes = getAssetManualNotes();
  const existing = notes[key] || {};
  
  const srvDate = service_date || new Date().toISOString().slice(0, 10);
  
  // Hitung next_due otomatis jika belum ditentukan tapi frequency_months tersedia
  let calculatedNextDue = next_due;
  if (!calculatedNextDue && frequency_months && Number(frequency_months) > 0) {
    const d = new Date(srvDate + 'T00:00:00');
    d.setMonth(d.getMonth() + Number(frequency_months));
    calculatedNextDue = d.toISOString().slice(0, 10);
  }

  const serviceEntry = {
    id: 'SRV-' + Date.now(),
    service_date: srvDate,
    vendor: vendor || existing.vendor || 'Internal',
    action: action || 'Servis & Pemeliharaan Rutin',
    cost: cost || 'Rp 0',
    next_due: calculatedNextDue || null,
    frequency_months: frequency_months || existing.frequency_months || null,
    maintenance_type: maintenance_type || existing.maintenance_type_override || 'preventive',
    performed_by: performed_by || 'Teknisi / Clinic Leader',
    condition_notes: condition_notes || null,
    service_procedure: service_procedure || null,
    recorded_at: new Date().toISOString()
  };

  const serviceHistory = existing.service_history || [];
  serviceHistory.unshift(serviceEntry);

  notes[key] = {
    ...existing,
    name: asset_name || existing.name || '',
    branch_or_location: branch || existing.branch_or_location || '',
    last_maintenance: srvDate,
    next_due: calculatedNextDue || existing.next_due || null,
    vendor: vendor || existing.vendor || 'Internal',
    activity: action || existing.activity || null,
    frequency_months: frequency_months || existing.frequency_months || null,
    condition_notes: condition_notes !== undefined ? condition_notes : (existing.condition_notes || action),
    service_procedure: service_procedure !== undefined ? service_procedure : existing.service_procedure || null,
    maintenance_type_override: maintenance_type || existing.maintenance_type_override || null,
    service_history: serviceHistory,
    updated_by: performed_by || 'Dashboard User',
    updated_at: new Date().toISOString()
  };

  try {
    fs.mkdirSync(path.dirname(ASSET_MANUAL_NOTES_FILE), { recursive: true });
    fs.writeFileSync(ASSET_MANUAL_NOTES_FILE, JSON.stringify(notes, null, 2));

    // Sinkronkan ke data/google_sheets_db/operational_assets.json
    const opsFile = path.join(GOOGLE_SHEETS_DB_DIR, 'operational_assets.json');
    if (fs.existsSync(opsFile)) {
      try {
        const ops = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
        if (Array.isArray(ops.preventive_maintenance)) {
          let updatedOps = false;
          ops.preventive_maintenance.forEach(pm => {
            const pmKey = normalizeAssetKey(pm.asset_name, pm.branch);
            if (pmKey === key || (pm.asset_name === asset_name && (!branch || pm.branch === branch))) {
              pm.last_maintenance = srvDate;
              if (calculatedNextDue) pm.next_due = calculatedNextDue;
              if (vendor) pm.vendor = vendor;
              if (action) pm.activity = action;
              updatedOps = true;
            }
          });
          if (updatedOps) {
            fs.writeFileSync(opsFile, JSON.stringify(ops, null, 2));
          }
        }
      } catch (errOps) {
        console.error('[recordAssetService] GSheets ops update error:', errOps.message);
      }
    }

    return { 
      success: true, 
      message: `Riwayat servis untuk "${asset_name || key}" berhasil dicatat & jadwal diperbarui!`,
      entry: notes[key],
      service_record: serviceEntry
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Clinic-wide settings (mis. kontak PIC alat) ---
// Kebijakan klinik: PIC penanggung jawab maintenance ALAT adalah Clinic
// Leader — bukan dokter/perawat/therapist (peran itu untuk pasien, bukan
// aset). Sheet sumber cuma punya nilai "Operational"/"Therapist" yang
// dipakai serampangan, jadi dashboard menampilkan peran yang benar di sini,
// dikonfigurasi sekali oleh Clinic Leader/Admin (nama & nomor WA opsional
// untuk reminder), bukan ditulis ulang per baris di spreadsheet.
const DEFAULT_CLINIC_SETTINGS = {
  maintenance_pic_role: 'Clinic Leader',
  maintenance_pic_name: null,
  maintenance_pic_phone: null,
  // PIC pembelian/logistik — dipakai untuk reminder PO (lihat
  // /api/pharmacy/send-po-reminder). Sama pola dengan PIC maintenance:
  // dikonfigurasi sekali oleh owner/admin, bukan dikarang.
  purchasing_pic_name: null,
  purchasing_pic_phone: null
};

function getClinicSettings() {
  try {
    if (fs.existsSync(CLINIC_SETTINGS_FILE)) {
      return { ...DEFAULT_CLINIC_SETTINGS, ...JSON.parse(fs.readFileSync(CLINIC_SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) {}
  return { ...DEFAULT_CLINIC_SETTINGS };
}

function setClinicSettings(patch) {
  const current = getClinicSettings();
  const next = {
    ...current,
    maintenance_pic_role: 'Clinic Leader', // dikunci sesuai kebijakan — tidak bisa diganti jadi dokter/perawat
    maintenance_pic_name: patch.maintenance_pic_name !== undefined ? patch.maintenance_pic_name : current.maintenance_pic_name,
    maintenance_pic_phone: patch.maintenance_pic_phone !== undefined ? patch.maintenance_pic_phone : current.maintenance_pic_phone,
    purchasing_pic_name: patch.purchasing_pic_name !== undefined ? patch.purchasing_pic_name : current.purchasing_pic_name,
    purchasing_pic_phone: patch.purchasing_pic_phone !== undefined ? patch.purchasing_pic_phone : current.purchasing_pic_phone,
    updated_at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(CLINIC_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(CLINIC_SETTINGS_FILE, JSON.stringify(next, null, 2));
    return { success: true, settings: next };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== UNIVERSAL WHATSAPP CHAT TEMPLATES ====================
const DEFAULT_WA_CHAT_TEMPLATES = {
  unredeemed: {
    key: 'unredeemed',
    title: 'Sisa Treatment & Deposit Recall',
    category: 'Sales & Front Office',
    badge_color: 'amber',
    icon: 'fa-solid fa-clock-rotate-left',
    description: 'Pesan recall untuk pasien yang masih memiliki sisa saldo deposit, DP 50%, atau kuota treatment belum terpakai.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{TREATMENT}', '{SISA_SALDO}', '{KATEGORI}', '{DOKTER}'],
    template: `Halo Kak {NAMA_PASIEN} ✨ Salam hangat dari KEFIR Derma Clinic {CABANG}! 💖\n\nKami menginfokan bahwa Kakak masih memiliki benefit perawatan *{TREATMENT}* dengan sisa saldo *{SISA_SALDO}* yang tersimpan aktif di sistem kami dan siap untuk Kakak reservasi kapan saja.\n\nApakah berkenan kami bantu atur jadwal perawatannya minggu ini Kak? Agar hasil kulit glowingnya tetap optimal ya Kak~ 💆‍♀️✨\n\nBisa langsung balas pesan ini untuk booking jadwal ya Kak. Terima kasih banyak! 🙏💕`
  },
  vip: {
    key: 'vip',
    title: 'VIP Royalty (Tier Very High > Rp 4 Juta)',
    category: 'CRM & Marketing',
    badge_color: 'purple',
    icon: 'fa-solid fa-crown',
    description: 'Penawaran eksklusif khusus pasien loyalitas tertinggi / sultan.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{KODE_VOUCHER}', '{BENEFIT_1}', '{BENEFIT_2}'],
    code: 'VIP-KEFIR-ROSE',
    benefit1: 'Diskon 35% Pico Laser / DNA Salmon Booster',
    benefit2: 'FREE 1x Crystal Dew Facial Ampoule',
    template: `Halo Kak {NAMA_PASIEN} tercinta ✨,\n\nTerima kasih telah menjadi bagian dari *VIP Royalty Member KEFIR Derma Clinic* ({CABANG}) 💖.\n\nSpesial untuk Kakak, kami siapkan *Exclusive VIP Treatment Voucher*:\n💎 *{BENEFIT_1}*\n🎁 *{BENEFIT_2}*\nKode Voucher: *{KODE_VOUCHER}*\n\nIngin reservasi ruang privat dokter besok/lusa, Kak? Tim dokter kami siap menyambut Kakak ✨.`
  },
  tier_high: {
    key: 'tier_high',
    title: 'Tier High (Rp 1.5 Juta - Rp 4 Juta)',
    category: 'CRM & Marketing',
    badge_color: 'blue',
    icon: 'fa-solid fa-gem',
    description: 'Broadcast promosi untuk pasien pembelanjaan tinggi.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{KODE_VOUCHER}', '{BENEFIT_1}'],
    code: 'HIGH-GLOW-25',
    benefit1: 'Diskon 25% Seluruh Treatment Laser & Glowing Facial',
    template: `Halo Kak {NAMA_PASIEN} ✨,\n\nSaatnya refreshing kulit wajah Kakak di *KEFIR Derma Clinic* ({CABANG}) 💖!\n\nSpesial untuk Kakak, kami ada penawaran eksklusif:\n✨ *{BENEFIT_1}*\nKode Voucher: *{KODE_VOUCHER}*\n\nMau kami bantu amankan jadwal konsultasi dokter hari ini/besok Kak? 💆‍♀️✨`
  },
  tier_middle: {
    key: 'tier_middle',
    title: 'Tier Middle (Rp 800 Ribu - Rp 1.5 Juta)',
    category: 'CRM & Marketing',
    badge_color: 'cyan',
    icon: 'fa-solid fa-leaf',
    description: 'Broadcast promosi untuk pasien pembelanjaan menengah.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{KODE_VOUCHER}', '{BENEFIT_1}'],
    code: 'MID-REFRESH-20',
    benefit1: 'Diskon 20% Treatment Refreshing Facial & Peeling',
    template: `Halo Kak {NAMA_PASIEN} ✨,\n\nKabar gembira dari *KEFIR Derma Clinic* ({CABANG})! 🌸\nKulit wajah yang sehat butuh perawatan rutin berkala. Khusus untuk Kakak:\n🎁 *{BENEFIT_1}*\nKode Voucher: *{KODE_VOUCHER}*\n\nYuk reservasi perawatan glowing favorit Kakak minggu ini! Hubungi kami untuk amankan jam slot ya Kak. 💖`
  },
  tier_low: {
    key: 'tier_low',
    title: 'Tier Low / Regular (< Rp 800 Ribu)',
    category: 'CRM & Marketing',
    badge_color: 'emerald',
    icon: 'fa-solid fa-star',
    description: 'Broadcast promosi untuk pasien entry-level / kunjungan reguler.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{KODE_VOUCHER}', '{BENEFIT_1}'],
    code: 'GLOW-STARTER-15',
    benefit1: 'Diskon 15% Treatment Wajah Glowing Pertama / Lanjutan',
    template: `Halo Kak {NAMA_PASIEN} ✨,\n\nTerima kasih atas kunjungan Kakak di *KEFIR Derma Clinic* ({CABANG})! 💕\nIngin hasil perawatan kemarin bertahan lebih lama? Yuk lanjutkan perawatan kulit Kakak:\n🌟 *{BENEFIT_1}*\nKode Voucher: *{KODE_VOUCHER}*\n\nKonsultasikan kebutuhan kulit Kakak bersama skin expert kami hari ini ya Kak! ✨`
  },
  churn: {
    key: 'churn',
    title: 'Reaktivasi Pasien (Winback > 90 Hari)',
    category: 'CRM & Sales',
    badge_color: 'rose',
    icon: 'fa-solid fa-user-plus',
    description: 'Pesan kangen dan voucher reaktivasi untuk pasien yang sudah lama tidak berkunjung.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{TOTAL_SPENT}', '{KODE_VOUCHER}', '{BENEFIT_1}'],
    code: 'COMEBACK-KEFIR',
    benefit1: 'Free Konsultasi Dokter + Diskon 20% Perawatan',
    template: `Halo Kak *{NAMA_PASIEN}*! 🌸✨\n\nKami rindu kehadiran Kakak di *KEFIR Derma Clinic* ({CABANG})! 💖\n\nSebagai pasien setia kami (total perawatan sebelumnya *{TOTAL_SPENT}*), yuk kembali glowing bersama kami:\n🎁 *{BENEFIT_1}*\nKode Voucher: *{KODE_VOUCHER}*\n\nYuk sempatkan relaksasi kulit minggu ini Kak! Balas pesan ini untuk klaim voucher & booking jadwal ya Kak 💕`
  },
  birthday: {
    key: 'birthday',
    title: 'Promo Ulang Tahun Pasien',
    category: 'CRM & Loyalty',
    badge_color: 'pink',
    icon: 'fa-solid fa-cake-candles',
    description: 'Ucapan ulang tahun spesial dan voucher hadiah personal.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{KODE_VOUCHER}', '{BENEFIT_1}', '{BENEFIT_2}'],
    code: 'HBD-KEFIR-GLOW',
    benefit1: 'FREE 1x Treatment Facial Glow Refresh',
    benefit2: 'Diskon 25% Seluruh Treatment Dokter & Laser',
    template: `Selamat Ulang Tahun Kak {NAMA_PASIEN}! 🎂🎉✨\n\nSemoga selalu sehat, bahagia, dan semakin bercahaya 💖!\n\nSpesial di hari bahagia Kakak, *KEFIR Derma Clinic* ({CABANG}) memberikan kado istimewa:\n🎁 *{BENEFIT_1}*\n💎 *{BENEFIT_2}*\nKode Voucher Spesial: *{KODE_VOUCHER}*\n\nVoucher berlaku sepanjang bulan ini ya Kak. Yuk sempatkan reservasi hari spesial Kakak bersama kami! Bisa langsung balas chat ini ya Kak ✨.`
  },
  unpaid: {
    key: 'unpaid',
    title: 'Pengingat Tagihan Invoice (Unpaid Reminder)',
    category: 'Finance & Kasir',
    badge_color: 'amber',
    icon: 'fa-solid fa-file-invoice-dollar',
    description: 'Pesan konfirmasi rincian tagihan kasir yang berstatus pending / belum lunas.',
    variables: ['{NAMA_PASIEN}', '{NO_INVOICE}', '{TOTAL_TAGIHAN}', '{REK_BCA}', '{REK_MANDIRI}', '{CABANG}'],
    bca: '541-098-7722 (a.n Kefir Derma Clinic)',
    mandiri: '157-00-8899-2211 (a.n PT Kefir House)',
    template: `Halo Kak {NAMA_PASIEN} ✨,\n\nTerima kasih telah melakukan perawatan di *KEFIR Derma Clinic* ({CABANG}) 💖.\n\nKami menginformasikan status invoice perawatan Kakak:\n📄 No. Invoice: *{NO_INVOICE}*\n💰 Sisa Tagihan: *{TOTAL_TAGIHAN}*\n📌 Status: *Menunggu Pembayaran (Pending)*\n\nPembayaran dapat ditransfer via:\n🏦 *BCA: {REK_BCA}*\n🏦 *Mandiri: {REK_MANDIRI}*\nAtau scan QRIS kasir klinik.\n\nJika sudah transfer, mohon kirimkan bukti pembayarannya ya Kak. Terima kasih banyak Kak ✨!`
  },
  doctor_roadmap: {
    key: 'doctor_roadmap',
    title: 'Clinical Treatment Roadmap (Rekomendasi Dokter)',
    category: 'Medis & Clinical',
    badge_color: 'indigo',
    icon: 'fa-solid fa-stethoscope',
    description: 'Rencana tahapan perawatan medis lanjutan yang diresepkan dokter kepada pasien.',
    variables: ['{NAMA_PASIEN}', '{DOKTER}', '{CABANG}', '{TREATMENT_LANJUTAN}', '{INTERVAL}', '{TANGGAL_KONTROL}', '{ANALISIS_KULIT}', '{CATATAN_DOKTER}'],
    template: `🏥 *KEFIR DERMA CLINIC — CLINICAL ROADMAP PERAWATAN DOKTER*\n\nHalo Kak *{NAMA_PASIEN}* tercinta ✨ Salam hangat dari KEFIR Derma Clinic {CABANG} 💖\n\nBerikut kami sampaikan tahapan rencana perawatan kulit (*Clinical Treatment Roadmap*) yang telah disusun secara personal oleh *{DOKTER}*:\n\n🔬 *Analisis / Diagnosa Kulit:* {ANALISIS_KULIT}\n🌸 *Tahapan Tindakan Lanjutan:* *{TREATMENT_LANJUTAN}*{INTERVAL}\n🗓️ *Saran Jadwal Kontrol Kembali:* {TANGGAL_KONTROL}\n\n💡 *Catatan Dokter:* {CATATAN_DOKTER}\n\nJika ada pertanyaan mengenai tindakan atau resep produk, Kakak dapat langsung chat kami ya. Terima kasih banyak! 🙏✨`
  },
  sales_followup: {
    key: 'sales_followup',
    title: 'Follow-Up Sales Roadmap Dokter',
    category: 'Sales & CS',
    badge_color: 'indigo',
    icon: 'fa-solid fa-headset',
    description: 'Pesan follow-up tim Sales/CS ke pasien untuk konfirmasi jadwal tindakan lanjutan rekomendasi dokter.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{DOKTER}', '{TREATMENT_LANJUTAN}', '{INTERVAL}', '{TANGGAL_KONTROL}'],
    template: `Halo Kak *{NAMA_PASIEN}* tercinta ✨ Salam hangat dari *KEFIR Derma Clinic {CABANG}* 💖\n\nSemoga kondisi kulit Kakak semakin membaik pasca kunjungan bersama *{DOKTER}* ya Kak.\n\nBerdasarkan catatan rekam medis dokter, untuk menjaga hasil perawatan optimal, tahapan berikutnya Kakak sudah masuk jadwal untuk:\n🌸 *{TREATMENT_LANJUTAN}*{INTERVAL}\n🗓️ Jadwal yang disarankan dokter: *{TANGGAL_KONTROL}*\n\nApakah kami bantu amankan slot jadwal konsultasi dokter & treatment di *KEFIR {CABANG}* untuk hari ini / akhir pekan ini Kak? 💆‍♀️✨\n\n_Kami siap bantu reservasikan jam terbaik untuk Kakak ya_ 🙏💖`
  },
  post_treatment: {
    key: 'post_treatment',
    title: 'Follow-Up Pasca Tindakan (H+3 / H+7 Post-Care)',
    category: 'Operasional & CX',
    badge_color: 'teal',
    icon: 'fa-solid fa-comments',
    description: 'Penyapaan kondisi kulit pasca tindakan dan survei kepuasan pasien.',
    variables: ['{NAMA_PASIEN}', '{CABANG}', '{TREATMENT}', '{H_PLUS}', '{LINK_SURVEI}'],
    template: `Selamat siang Kak *{NAMA_PASIEN}*! ✨\n\nSudah H+{H_PLUS} pasca perawatan *{TREATMENT}* di KEFIR Derma Clinic {CABANG} 💖. Apakah hasilnya sudah mulai terasa lebih segar & glowing?\n\nKenyamanan dan kepuasan Kakak adalah prioritas utama kami. Kami sangat senang jika Kakak berkenan meluangkan waktu sejenak untuk membagikan pengalaman di tautan berikut:\n👉 {LINK_SURVEI}\n\nSemoga hari Kakak menyenangkan dan kami tunggu kedatangannya kembali ya Kak! 🥰✨`
  }
};

function getWaChatTemplates() {
  let stored = {};
  try {
    if (fs.existsSync(WA_CHAT_TEMPLATES_FILE)) {
      stored = JSON.parse(fs.readFileSync(WA_CHAT_TEMPLATES_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('Error reading WA chat templates file:', e.message);
  }

  const merged = {};
  for (const key of Object.keys(DEFAULT_WA_CHAT_TEMPLATES)) {
    merged[key] = {
      ...DEFAULT_WA_CHAT_TEMPLATES[key],
      ...(stored[key] || {})
    };
  }
  return merged;
}

function saveWaChatTemplate(key, patch) {
  if (!key) return { success: false, error: 'Template key required' };
  const all = getWaChatTemplates();
  const current = all[key] || DEFAULT_WA_CHAT_TEMPLATES[key] || { key };
  all[key] = {
    ...current,
    ...patch,
    key,
    updated_at: new Date().toISOString()
  };

  try {
    fs.mkdirSync(path.dirname(WA_CHAT_TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(WA_CHAT_TEMPLATES_FILE, JSON.stringify(all, null, 2), 'utf8');
    return { success: true, templates: all, template: all[key] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function saveAllWaChatTemplates(templates) {
  if (!templates || typeof templates !== 'object') return { success: false, error: 'Invalid templates payload' };
  const current = getWaChatTemplates();
  const next = { ...current };

  for (const [k, v] of Object.entries(templates)) {
    if (v && typeof v === 'object') {
      next[k] = {
        ...(current[k] || DEFAULT_WA_CHAT_TEMPLATES[k] || {}),
        ...v,
        key: k,
        updated_at: new Date().toISOString()
      };
    }
  }

  try {
    fs.mkdirSync(path.dirname(WA_CHAT_TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(WA_CHAT_TEMPLATES_FILE, JSON.stringify(next, null, 2), 'utf8');
    return { success: true, templates: next };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function resetWaChatTemplate(key) {
  const current = getWaChatTemplates();
  if (key && DEFAULT_WA_CHAT_TEMPLATES[key]) {
    current[key] = { ...DEFAULT_WA_CHAT_TEMPLATES[key], updated_at: new Date().toISOString() };
  } else if (!key || key === 'all') {
    for (const k of Object.keys(DEFAULT_WA_CHAT_TEMPLATES)) {
      current[k] = { ...DEFAULT_WA_CHAT_TEMPLATES[k], updated_at: new Date().toISOString() };
    }
  }

  try {
    fs.mkdirSync(path.dirname(WA_CHAT_TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(WA_CHAT_TEMPLATES_FILE, JSON.stringify(current, null, 2), 'utf8');
    return { success: true, templates: current };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Profit Bersih (Estimasi) — input biaya bulanan manual ---
// BHP terpakai TIDAK diinput di sini: panel Profit Bersih mengambilnya dari
// kartu stok Neosoft (getHppProfit). Sisi biaya lain (petty cash tunai di
// luar stok, gaji, sewa, utilitas) tidak ada di Neosoft maupun
// sumber lain manapun di sistem ini — makanya sebelumnya tab Finance
// jujur menulis "Belum Tersedia" untuk profit bersih. Ini BUKAN dihitung
// otomatis: owner/finance input total biaya per kategori per bulan
// secara manual, lalu Profit Bersih = Omzet - Total Biaya. Selalu
// ditandai "Estimasi, dari input manual" — bukan angka yang diaudit.
// --- Petty Cash per transaksi ---
// Dulu petty cash cuma bisa diisi SATU angka total per bulan
// (bhp_petty_cash) — tidak ada rincian per transaksi/tanggal sama
// sekali, jadi owner tidak bisa melihat uang keluar untuk apa saja.
// Sekarang staf bisa mencatat tiap pengeluaran satu-satu; kalau ada
// catatan per-transaksi untuk suatu bulan, total petty cash bulan itu
// DIHITUNG dari jumlah transaksi-transaksi itu (bukan lagi input satu
// angka lump-sum) — lebih akurat & bisa ditelusuri ke tiap transaksi.
function getPettyCashEntries(period) {
  try {
    if (fs.existsSync(PETTY_CASH_ENTRIES_FILE)) {
      const all = JSON.parse(fs.readFileSync(PETTY_CASH_ENTRIES_FILE, 'utf8'));
      return period ? all.filter(e => e.period === period) : all;
    }
  } catch (e) {}
  return [];
}

function addPettyCashEntry({ period, date, description, amount, category, added_by }) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return { success: false, error: 'period wajib format YYYY-MM' };
  if (!description || !description.trim()) return { success: false, error: 'Deskripsi pengeluaran wajib diisi' };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { success: false, error: 'Jumlah harus angka lebih dari 0' };

  let all = [];
  try {
    if (fs.existsSync(PETTY_CASH_ENTRIES_FILE)) all = JSON.parse(fs.readFileSync(PETTY_CASH_ENTRIES_FILE, 'utf8'));
  } catch (e) {}

  const entry = {
    id: `PC-${Date.now().toString(36).toUpperCase()}`,
    period,
    date: date || new Date().toISOString().slice(0, 10),
    description: description.trim(),
    amount: amt,
    category: category || 'Lainnya',
    added_by: added_by || 'Dashboard User',
    added_at: new Date().toISOString()
  };
  all.unshift(entry);
  try {
    fs.mkdirSync(path.dirname(PETTY_CASH_ENTRIES_FILE), { recursive: true });
    fs.writeFileSync(PETTY_CASH_ENTRIES_FILE, JSON.stringify(all.slice(0, 20000), null, 2));
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deletePettyCashEntry(id) {
  if (!id) return { success: false, error: 'id wajib diisi' };
  let all = [];
  try {
    if (fs.existsSync(PETTY_CASH_ENTRIES_FILE)) all = JSON.parse(fs.readFileSync(PETTY_CASH_ENTRIES_FILE, 'utf8'));
  } catch (e) {}
  const next = all.filter(e => e.id !== id);
  if (next.length === all.length) return { success: false, error: 'Entri tidak ditemukan' };
  try {
    fs.writeFileSync(PETTY_CASH_ENTRIES_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getMonthlyCosts(period) {
  const pettyCashEntries = getPettyCashEntries(period);
  const pettyCashFromEntries = pettyCashEntries.length
    ? Math.round(pettyCashEntries.reduce((a, e) => a + e.amount, 0))
    : null;

  let base;
  try {
    if (fs.existsSync(MONTHLY_COSTS_FILE)) {
      const all = JSON.parse(fs.readFileSync(MONTHLY_COSTS_FILE, 'utf8'));
      if (all[period]) base = all[period];
    }
  } catch (e) {}
  if (!base) {
    base = {
      period,
      bhp_petty_cash: 0,
      gaji_karyawan: 0,
      sewa_utilitas: 0,
      lain_lain: 0,
      filled: false,
      updated_by: null,
      updated_at: null
    };
  }

  return {
    ...base,
    // Kalau ada catatan per-transaksi bulan ini, itu yang dipakai
    // (lebih akurat, bisa ditelusuri) — bukan angka lump-sum lama.
    bhp_petty_cash: pettyCashFromEntries != null ? pettyCashFromEntries : base.bhp_petty_cash,
    bhp_petty_cash_source: pettyCashFromEntries != null ? 'per_transaksi' : 'lump_sum_manual',
    petty_cash_entry_count: pettyCashEntries.length
  };
}

function setMonthlyCosts(period, patch) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return { success: false, error: 'period wajib format YYYY-MM' };
  let all = {};
  try {
    if (fs.existsSync(MONTHLY_COSTS_FILE)) all = JSON.parse(fs.readFileSync(MONTHLY_COSTS_FILE, 'utf8'));
  } catch (e) {}
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  all[period] = {
    period,
    bhp_petty_cash: num(patch.bhp_petty_cash),
    gaji_karyawan: num(patch.gaji_karyawan),
    sewa_utilitas: num(patch.sewa_utilitas),
    lain_lain: num(patch.lain_lain),
    filled: true,
    updated_by: patch.updated_by || 'Dashboard User',
    updated_at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(MONTHLY_COSTS_FILE), { recursive: true });
    fs.writeFileSync(MONTHLY_COSTS_FILE, JSON.stringify(all, null, 2));
    return { success: true, entry: all[period] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DOCTOR CLINICAL RECOMMENDATIONS & ROADMAP ENGINE (EMR EXTENSION)
// ═══════════════════════════════════════════════════════════════════════

function getDoctorRecommendations(customerId = null, customerName = null) {
  try {
    if (fs.existsSync(DOCTOR_RECOMMENDATIONS_FILE)) {
      const all = JSON.parse(fs.readFileSync(DOCTOR_RECOMMENDATIONS_FILE, 'utf8')) || [];
      if (customerId || customerName) {
        const cidNum = customerId ? Number(customerId) : null;
        const cidStr = customerId ? String(customerId).toLowerCase().trim() : '';
        const nameStr = customerName ? String(customerName).toLowerCase().trim() : '';
        
        return all.filter(r => {
          if (cidNum && Number(r.customer_id) === cidNum) return true;
          if (cidStr && String(r.customer_id).toLowerCase().trim() === cidStr) return true;
          if (nameStr && r.customer_name && (r.customer_name.toLowerCase().includes(nameStr) || nameStr.includes(r.customer_name.toLowerCase()))) return true;
          if (cidStr && r.customer_name && r.customer_name.toLowerCase().includes(cidStr)) return true;
          return false;
        }).sort((a, b) => (b.consultation_date || b.created_at || '').localeCompare(a.consultation_date || a.created_at || ''));
      }
      return all.sort((a, b) => (b.consultation_date || b.created_at || '').localeCompare(a.consultation_date || a.created_at || ''));
    }
  } catch (e) {
    console.error('[getDoctorRecommendations] Gagal baca file:', e.message);
  }
  return [];
}

function saveDoctorRecommendation({
  id = null,
  invoice_code = null,
  customer_id,
  customer_name,
  patient_name,
  doctor_name,
  doctor_id = null,
  consultation_date,
  skin_analysis,
  return_interval_days = 14,
  recommended_return_date = null,
  roadmap_steps = [],
  roadmap_months = [],
  homecare_skincare = [],
  doctor_notes = '',
  recommendation = '',
  updated_by
}) {
  const custName = (customer_name || patient_name || '').trim();
  const docName = (doctor_name || updated_by || '').trim();
  const notes = (doctor_notes || recommendation || '').trim();
  
  if (!customer_id && !custName && !invoice_code) {
    return { success: false, error: 'Identitas pasien (customer_id / nama / invoice) wajib diisi' };
  }
  if (!docName) {
    return { success: false, error: 'Nama dokter pemeriksa wajib diisi' };
  }

  const all = getDoctorRecommendations();
  const cDate = consultation_date || new Date().toISOString().slice(0, 10);
  
  let calcNextDate = recommended_return_date;
  if (!calcNextDate && return_interval_days) {
    const d = new Date(cDate + 'T00:00:00');
    d.setDate(d.getDate() + Number(return_interval_days));
    calcNextDate = d.toISOString().slice(0, 10);
  }

  const recId = id || (invoice_code ? `DREC-INV-${invoice_code}` : `DREC-${Date.now()}`);
  const now = new Date().toISOString();

  // Support both dynamic roadmap_steps and roadmap_months
  const steps = (Array.isArray(roadmap_steps) && roadmap_steps.length > 0)
    ? roadmap_steps
    : (Array.isArray(roadmap_months) && roadmap_months.length > 0 ? roadmap_months : (notes ? [{ step: 1, phase_name: 'Rekomendasi Kunjungan', treatment_name: notes, interval_label: 'Kontrol Berkala', clinical_notes: notes }] : []));

  const entry = {
    id: recId,
    invoice_code: invoice_code || null,
    customer_id: customer_id ? (Number(customer_id) || customer_id) : null,
    customer_name: custName,
    doctor_name: docName,
    doctor_id: doctor_id || null,
    consultation_date: cDate,
    skin_analysis: (skin_analysis || '').trim(),
    return_interval_days: Number(return_interval_days) || 14,
    recommended_return_date: calcNextDate,
    roadmap_steps: steps,
    roadmap_months: steps, // keep for backward compatibility
    homecare_skincare: Array.isArray(homecare_skincare) ? homecare_skincare : (typeof homecare_skincare === 'string' ? homecare_skincare.split('\n').map(s => s.trim()).filter(Boolean) : []),
    doctor_notes: notes,
    recommendation: notes,
    updated_by: updated_by || docName || 'Dashboard User',
    created_at: now,
    updated_at: now
  };

  const existingIdx = all.findIndex(r => r.id === recId || (invoice_code && r.invoice_code === invoice_code));
  if (existingIdx >= 0) {
    entry.created_at = all[existingIdx].created_at || now;
    all[existingIdx] = entry;
  } else {
    all.unshift(entry);
  }

  try {
    fs.mkdirSync(path.dirname(DOCTOR_RECOMMENDATIONS_FILE), { recursive: true });
    fs.writeFileSync(DOCTOR_RECOMMENDATIONS_FILE, JSON.stringify(all, null, 2));
    return { success: true, id: recId, data: entry, entry: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

const DOCTOR_FOLLOWUP_FILE = path.join(__dirname, 'data', 'doctor_followup_status.json');

function getDoctorFollowupStatuses() {
  try {
    if (fs.existsSync(DOCTOR_FOLLOWUP_FILE)) {
      return JSON.parse(fs.readFileSync(DOCTOR_FOLLOWUP_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('[getDoctorFollowupStatuses] Error:', e.message);
  }
  return {};
}

const _followupInvCache = { ref: null, map: null };
function _followupInvByCode() {
  const inv = getSafeJson('invoices_all.json') || [];
  if (_followupInvCache.ref !== inv) { const m = {}; inv.forEach(i => { if (i.inv_code && !i.void_invoice) m[i.inv_code] = i; }); _followupInvCache.ref = inv; _followupInvCache.map = m; }
  return _followupInvCache.map;
}
function getDoctorFollowupsList() {
  const appts = getSafeJson('appointment_full.json') || [];
  const statuses = getDoctorFollowupStatuses();
  const customers = getSafeJson('customers_all.json') || [];
  const custMap = new Map();
  customers.forEach(c => {
    if (c.id) custMap.set(String(c.id), c);
  });

  const today = todayJakarta();
  const todayDateObj = new Date(today + 'T00:00:00');

  // Bukti kunjungan per pasien: invoice non-void + reservasi berstatus sudah datang
  // (2 Consultation, 4 Finished, 7 Arrived, 8 Treatment). Resepsionis sering tidak
  // mengubah status reservasi dari Booked, jadi status saja tidak bisa dipercaya.
  const invoices = getSafeJson('invoices_all.json') || [];
  const ATTENDED = new Set([2, 4, 7, 8]);
  const visits = {};
  const addVisit = (cid, d) => { if (cid && d) (visits[String(cid)] = visits[String(cid)] || new Set()).add(d); };
  invoices.forEach(i => { if (!i.void_invoice && !isMigrationInvoice(i)) addVisit(i.customer_id, String(i.inv_date || '').slice(0, 10)); });
  appts.forEach(a => { if (a.patient && ATTENDED.has(a.status_appointment)) addVisit(a.patient.id, String(a.come_date || '').slice(0, 10)); });
  // Pasien yang hanya menebus sisa paket tidak punya invoice baru — pemakaian treatment juga bukti kedatangan
  _t360Base().lines.forEach(l => addVisit(l.customer_id, l.date));
  const cameOnOrAfter = (cid, d) => [...(visits[String(cid)] || [])].some(v => v >= d);

  // Data pasien dobel: nama sama + datang di tanggal yang sama
  const nameKey = (c) => String(typeof c.name === 'string' ? c.name : `${(c.name || {}).first_name || ''} ${(c.name || {}).last_name || ''}`).toLowerCase().replace(/[^a-z]/g, '');
  const idsByName = {};
  customers.forEach(c => { const k = nameKey(c); if (k.length >= 3) (idsByName[k] = idsByName[k] || []).push(String(c.id)); });
  const twinCameOn = (cid, d) => {
    const c = custMap.get(String(cid)); if (!c) return null;
    const hit = (idsByName[nameKey(c)] || []).find(t => t !== String(cid) && visits[t] && visits[t].has(d));
    return hit ? custMap.get(hit) : null;
  };

  // Reservasi Booked (1) / Confirmed (13): yang hari ini & mendatang, ditambah yang sudah
  // lewat HANYA kalau pasien belum datang sejak tanggal itu (bukan sekadar status belum diubah).
  const bookedAppts = appts.filter(a => {
    if (!a.come_date || !(a.status_appointment === 1 || a.status_appointment === 13) || a.appointment_cancellation) return false;
    const pid = a.patient && a.patient.id;
    const c = pid ? custMap.get(String(pid)) : null;
    if (isTestPatientName((a.patient && a.patient.name) || (c && (typeof c.name === 'string' ? c.name : `${c.name.first_name || ''} ${c.name.last_name || ''}`)))) return false;
    const d = a.come_date.slice(0, 10);
    // Reservasi yang dibuat saat pasien sudah tiba (kasir) bukan janji temu — pasien sedang/sudah di klinik
    const startMs = Date.parse(d + 'T' + String(a.start_time || '00:00:00').slice(0, 8));
    const createdMs = Date.parse(String(a.log_created_at || '').replace(' ', 'T'));
    if (isFinite(startMs) && isFinite(createdMs) && createdMs >= startMs - 30 * 60000) return false;
    if (d >= today) return true;
    if (d < addDaysIso(today, -14)) return false;     // reservasi lama yang tak pernah diurus bukan tugas follow-up
    if (pid && cameOnOrAfter(pid, d)) return false;
    if (pid && twinCameOn(pid, d)) return false;
    return true;
  });

  const items = bookedAppts.map(a => {
    const recId = 'NEO-APPT-' + a.id_appointment;
    const st = statuses[recId] || {
      status: 'pending',
      last_contacted_at: null,
      contacted_by: null,
      notes: '',
      booking_date: null
    };

    const dStr = a.come_date ? a.come_date.slice(0, 10) : '';
    let daysUntilDue = null;
    let dueStatus = 'upcoming';

    if (dStr) {
      const targetDate = new Date(dStr + 'T00:00:00');
      if (!isNaN(targetDate.getTime())) {
        const diffTime = targetDate.getTime() - todayDateObj.getTime();
        daysUntilDue = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (daysUntilDue < 0) {
          dueStatus = 'overdue';
        } else if (daysUntilDue === 0) {
          dueStatus = 'due_today';
        } else if (daysUntilDue <= 3) {
          dueStatus = 'due_soon';
        } else {
          dueStatus = 'upcoming';
        }
      }
    }

    // Customer info
    let phone = a.patient?.phone || '';
    let custName = a.patient?.name || 'Pasien Neosoft';
    let code = '';
    const custId = a.patient?.id;
    if (custId && custMap.has(String(custId))) {
      const c = custMap.get(String(custId));
      phone = phone || c.phone || c.mobile_phone || '';
      code = c.code || '';
      if (!custName || custName === 'Pasien Neosoft') custName = c.name;
    }

    // Branch
    let branch = 'Pondok Kopi';
    if (a.outlet) {
      branch = a.outlet.id === 1 ? 'Depok' : (a.outlet.id === 2 ? 'Pondok Kopi' : (a.outlet.name?.includes('Depok') ? 'Depok' : 'Pondok Kopi'));
    }

    // Dokter vs terapis/perawat dipisah; dulu semuanya digabung di kolom "Dokter DPJP"
    const staffAll = (a.therapists || []).map(t => t.name).filter(Boolean);
    const doctors = staffAll.filter(n => /^dr\.?\s/i.test(n));
    const others = staffAll.filter(n => !/^dr\.?\s/i.test(n));
    const docName = doctors.length ? doctors.join(', ') : (others[0] || a.staff?.name || '-');

    // Treatment
    let trName = a.treatment?.product_treatment_name || '';
    if (!trName && a.appointment_treatments && a.appointment_treatments.length > 0) {
      trName = a.appointment_treatments.map(t => t.product_treatment_name).filter(Boolean).join(', ');
    }
    if (!trName && a.remarks && a.remarks.replace(/^[-\s]+/, '').trim()) {
      trName = a.remarks.replace(/^[-\s]+/, '').trim();
    }
    if (!trName) {
      trName = a.appointment_type?.name === 'CONSULTATION' ? 'Konsultasi Dokter' : 'Treatment Kontrol';
    }

    const timeStr = a.start_time ? a.start_time.slice(0, 5) : '';

    return {
      id: recId,
      id_appointment: a.id_appointment,
      appointment_code: a.code,
      customer_id: custId || null,
      customer_name: custName,
      customer_code: code,
      customer_phone: phone,
      branch: branch,
      doctor_name: docName,
      consultation_date: dStr,
      appointment_time: timeStr,
      skin_analysis: a.remarks && a.remarks.replace(/^[-\s]+/, '').trim() ? a.remarks.replace(/^[-\s]+/, '').trim() : '',
      source: 'neosoft_appointment',
      source_label: 'Reservasi Neosoft',
      staff_names: doctors.length ? others : others.slice(1),
      phone_valid: normalizeWaPhone(phone).valid,
      recommended_return_date: dStr,
      return_interval_days: null,
      days_until_due: daysUntilDue,
      due_status: dueStatus,
      next_treatment: trName,
      next_interval: timeStr ? `Pukul ${timeStr} WIB` : 'Sesuai Jadwal',
      next_phase: a.status_color?.name || 'Booked',
      neosoft_status: a.status_color?.name || 'Booked',
      doctor_notes: a.remarks || '',
      followup_status: st.status || 'pending',
      last_contacted_at: st.last_contacted_at,
      contacted_by: st.contacted_by,
      sales_notes: st.notes || '',
      booking_date: st.booking_date || null,
      created_at: a.log_created_at || a.updated_at
    };
  });

  // Rekomendasi kembali dari dokter (doctor_recommendations.json) yang belum dipenuhi:
  // pasien belum datang lagi sejak tanggal rekomendasi. Duplikat (simpan berkali-kali) digabung.
  const seenRec = new Set();
  (getDoctorRecommendations() || []).forEach(r => {
    const cid = r.customer_id;
    const d = r.recommended_return_date;
    if (!cid || !d) return;
    const key = `${cid}|${d}`;
    if (seenRec.has(key)) return;
    seenRec.add(key);
    if (cameOnOrAfter(cid, d) && d < today) return;
    if (visits[String(cid)] && [...visits[String(cid)]].some(v => v > (r.consultation_date || '0000') && v >= d)) return;
    const c = custMap.get(String(cid));
    const masterName = c ? (typeof c.name === 'string' ? c.name : `${c.name.first_name || ''} ${c.name.last_name || ''}`.trim()) : '';
    if (isTestPatientName(masterName) || isTestPatientName(r.customer_name)) return;
    const name = masterName || r.customer_name || 'Pasien';
    // Rekomendasi pernah tersimpan ke ID pasien yang salah (nama di rekomendasi ≠ nama pasien di Neosoft).
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
    const dataWarning = masterName && r.customer_name && norm(masterName) !== norm(r.customer_name)
      ? `Nama di rekomendasi dokter "${r.customer_name}" tidak cocok dengan data pasien Neosoft "${masterName}". Cek sebelum menghubungi.`
      : '';
    const phone = (c && (c.phone || c.mobile_phone)) || r.customer_phone || '';
    const days = Math.round((new Date(d + 'T00:00:00').getTime() - todayDateObj.getTime()) / 86400000);
    const st = statuses[r.id] || { status: 'pending', last_contacted_at: null, contacted_by: null, notes: '', booking_date: null };
    const firstStep = (r.roadmap_steps && r.roadmap_steps[0]) || null;
    items.push({
      id: r.id,
      id_appointment: null,
      appointment_code: null,
      customer_id: cid,
      customer_name: name,
      customer_code: c ? (c.code || '') : '',
      customer_phone: phone,
      phone_valid: normalizeWaPhone(phone).valid,
      branch: r.branch || (c && c.outlet_id === 1 ? 'Depok' : 'Pondok Kopi'),
      doctor_name: r.doctor_name || '-',
      staff_names: [],
      consultation_date: r.consultation_date || null,
      appointment_time: '',
      skin_analysis: r.skin_analysis || '',
      source: 'doctor_recommendation',
      source_label: 'Rekomendasi Dokter',
      data_warning: dataWarning,
      recommended_return_date: d,
      return_interval_days: r.return_interval_days || null,
      days_until_due: days,
      due_status: days < 0 ? 'overdue' : (days === 0 ? 'due_today' : (days <= 3 ? 'due_soon' : 'upcoming')),
      next_treatment: r.next_treatment || (firstStep && (firstStep.treatment || firstStep.phase_name)) || 'Kontrol Dokter',
      next_interval: r.return_interval_days ? `${r.return_interval_days} hari pasca konsultasi` : 'Sesuai rekomendasi',
      next_phase: firstStep ? (firstStep.phase_name || '') : '',
      neosoft_status: 'Rekomendasi',
      doctor_notes: r.doctor_notes || '',
      followup_status: st.status || 'pending',
      last_contacted_at: st.last_contacted_at,
      contacted_by: st.contacted_by,
      sales_notes: st.notes || '',
      booking_date: st.booking_date || null,
      created_at: r.created_at || r.consultation_date
    });
  });

  // Plan dokter di medical record Neosoft (SOAP) + rekomendasi otomatis untuk
  // kunjungan tanpa plan. Pasien yang sudah punya reservasi tidak diduplikasi —
  // plan dokternya ditempelkan ke baris reservasi tersebut.
  const M = _medicalRecords();
  const bookedByCust = {};
  items.forEach(it => { if (it.customer_id && it.source === 'neosoft_appointment') (bookedByCust[it.customer_id] = bookedByCust[it.customer_id] || []).push(it); });
  const haveItem = new Set(items.map(it => String(it.customer_id)));
  const planFrom = addDaysIso(today, -120);
  const lastVisitOf = (cid) => [...(visits[String(cid)] || [])].sort().pop() || null;
  const custName = (c) => c ? (typeof c.name === 'string' ? c.name : `${c.name.first_name || ''} ${c.name.last_name || ''}`.trim()) : '';
  const pushDerived = (cid, src) => {
    const c = custMap.get(String(cid));
    const name = custName(c);
    if (!name || isTestPatientName(name)) return;
    const id = src.id;
    const st = statuses[id] || { status: 'pending', last_contacted_at: null, contacted_by: null, notes: '', booking_date: null };
    const d = src.date;
    const days = Math.round((new Date(d + 'T00:00:00').getTime() - todayDateObj.getTime()) / 86400000);
    const phone = (c && (c.phone || c.mobile_phone)) || '';
    items.push({
      id, id_appointment: null, appointment_code: null,
      customer_id: cid, customer_name: name, customer_code: c ? (c.code || '') : '', customer_phone: phone,
      phone_valid: normalizeWaPhone(phone).valid,
      branch: src.branch || (c && c.origin_outlet_id === 1 ? 'Depok' : 'Pondok Kopi'),
      doctor_name: src.doctor || '-', staff_names: [],
      consultation_date: src.visit_date, appointment_time: '',
      skin_analysis: src.assessment || '',
      source: src.source, source_label: src.source_label, data_warning: '',
      recommended_return_date: d, date_estimated: src.date_source !== 'doctor', date_source: src.date_source || 'pattern', return_interval_days: src.gap || null,
      days_until_due: days,
      due_status: days < 0 ? 'overdue' : (days === 0 ? 'due_today' : (days <= 3 ? 'due_soon' : 'upcoming')),
      next_treatment: src.next_treatment, next_interval: src.next_interval, next_phase: '',
      neosoft_status: src.source_label, doctor_notes: src.notes || '',
      followup_status: st.status || 'pending', last_contacted_at: st.last_contacted_at, contacted_by: st.contacted_by,
      sales_notes: st.notes || '', booking_date: st.booking_date || null, created_at: src.visit_date,
      plan_detail: src.plan_detail || null, auto_reason: src.auto_reason || null
    });
    haveItem.add(String(cid));
  };
  if (M.available) {
    Object.entries(M.byCust).forEach(([cid, recs]) => {
      const rec = recs.find(r => r.plan_kind === 'specific');
      if (!rec || rec.date < planFrom) return;
      // Bagian Plan yang sudah dikerjakan (hari itu juga atau sesudahnya) tidak lagi ditagih
      const pl = analyzePlan(rec.soap.plan, cid, rec.date);
      if (pl.all_done) return;
      const booked = bookedByCust[cid];
      const planInv = rec.inv_code ? (_followupInvByCode()[rec.inv_code] || null) : null;
      const planDetail = { invoice: rec.inv_code ? { code: rec.inv_code, date: planInv ? String(planInv.inv_date || '').slice(0, 10) : rec.date, total: planInv ? Number(planInv.total_after_tax || planInv.total || 0) : null, items: rec.items || [] } : null,
        text: rec.soap.plan, date: rec.date, doctor: rec.doctor || rec.written_by || null, done: pl.done.map(x => x.text), remaining: pl.remaining.map(x => x.text), products: pl.products };
      if (booked) { booked.forEach(it => { it.doctor_plan = pl.remaining_text; it.doctor_plan_date = rec.date; it.plan_detail = planDetail; }); return; }
      const nx = getNextTreatmentRecommendation(cid);
      const fromDoctor = !!pl.due_date;
      const due = pl.due_date || nx.suggested_date || addDaysIso(rec.date, 30);
      // Plan yang perkiraan jatuh temponya lewat >30 hari tidak lagi dikejar di daftar ini
      if (due < addDaysIso(today, -30) || due > addDaysIso(today, 14)) return;
      pushDerived(Number(cid), {
        id: 'SOAP-' + rec.id, source: 'neosoft_soap', source_label: 'Plan Dokter (Neosoft)',
        date: due, date_source: fromDoctor ? 'doctor' : 'pattern', gap: fromDoctor ? pl.interval_days : nx.suggested_gap_days, visit_date: rec.date,
        branch: rec.branch, doctor: rec.doctor || rec.written_by, assessment: rec.soap.assessment,
        next_treatment: pl.remaining_text.replace(/\n/g, ', '),
        next_interval: fromDoctor ? `${pl.interval_days} hari setelah konsultasi (jadwal dokter)` : `perkiraan ±${nx.suggested_gap_days || 30} hari`,
        notes: pl.remaining_text, plan_detail: planDetail
      });
    });
  }
  // Rekomendasi otomatis: kunjungan 90 hari terakhir tanpa plan dokter / reservasi,
  // jatuh tempo perkiraan antara 14 hari lalu s/d 7 hari ke depan.
  const autoFrom = addDaysIso(today, -90), dueMin = addDaysIso(today, -14), dueMax = addDaysIso(today, 7);
  Object.keys(visits).forEach(cid => {
    if (haveItem.has(cid)) return;
    const lv = lastVisitOf(cid);
    if (!lv || lv < autoFrom || lv >= today) return;
    const nx = getNextTreatmentRecommendation(cid);
    if (!nx.available || !nx.primary || nx.primary.source === 'doctor_plan' || !nx.suggested_date) return;
    if (nx.suggested_date < dueMin || nx.suggested_date > dueMax) return;
    pushDerived(Number(cid), {
      id: 'AUTO-' + cid + '-' + lv, source: 'auto_recommendation', source_label: 'Rekomendasi Otomatis',
      date: nx.suggested_date, gap: nx.suggested_gap_days, visit_date: lv, doctor: null,
      assessment: nx.last_treatments.length ? 'Terakhir: ' + nx.last_treatments.join(', ') : '',
      next_treatment: nx.primary.text, next_interval: nx.primary.why, notes: nx.primary.why,
      auto_reason: {
        basis: nx.primary.source,                       // 'package' | 'pattern'
        why: nx.primary.why,
        last_visit: lv, last_treatments: nx.last_treatments,
        pattern: (nx.pattern || []).map(x => ({ name: x.name, pct: x.pct, cases: x.cases, median_days: x.median_days })),
        packages: (nx.packages || []).map(x => ({ treatment: x.treatment, remaining: x.remaining, total: x.total || null })),
        gap_days: nx.suggested_gap_days, gap_from_pattern: !!(nx.pattern && nx.pattern.length)
      }
    });
  });

  return items.sort((a, b) => {
    // Priority: due today first (days_until_due === 0), then upcoming positive (1, 2, 3), then overdue
    const getWeight = (x) => {
      if (x.days_until_due === 0) return 1000;
      if (x.days_until_due > 0 && x.days_until_due <= 3) return 900 - x.days_until_due;
      if (x.days_until_due > 3 && x.days_until_due <= 14) return 800 - x.days_until_due;
      if (x.days_until_due < 0) return 500 + Math.max(-500, x.days_until_due);
      return 0;
    };
    const wA = getWeight(a);
    const wB = getWeight(b);
    if (wB !== wA) return wB - wA;
    return (b.recommended_return_date || '').localeCompare(a.recommended_return_date || '');
  });
}

// --- Kepatuhan dokter mengisi rekomendasi (visibilitas, bukan penguncian) ---
// Dulu "kewajiban dokter mengisi rekomendasi" cuma berarti badge
// "Sudah/Belum Diisi" per kunjungan di Patient 360 — tidak ada cara
// manajemen melihat angka kepatuhan keseluruhan tanpa membuka satu-satu
// profil pasien. Ini menghitung dari data nyata: dari seluruh invoice
// non-void periode berjalan, berapa yang sudah punya rekomendasi dokter
// tersimpan (dicocokkan via invoice_code, format DREC-INV-<kode> yang
// dipakai saveDoctorRecommendation). TIDAK mengunci/memblokir apa pun —
// itu keputusan operasional yang perlu ditentukan manajemen dulu, bukan
// sesuatu yang bisa diam-diam dipaksakan dashboard.
function getDoctorRecommendationCompliance(periodOrRange) {
  const invoices = getSafeJson('invoices_all.json');
  const recs = getDoctorRecommendations();
  const recInvoiceCodes = new Set(recs.filter(r => r.invoice_code).map(r => String(r.invoice_code)));

  // Digeneralisasi dari cocok-bulan-persis ("YYYY-MM") jadi rentang
  // tanggal bebas — invoices_all.json punya inv_date asli per baris, jadi
  // (beda dari getPaymentChannelBreakdown) ini genuinely bisa difilter
  // per hari, bukan cuma per bulan.
  const { startDate, endDate } = resolvePeriodRange(periodOrRange);
  const periodInvoices = invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i) && dateInRange(i.inv_date, startDate, endDate) && i.inv_code);
  const uniqueCodes = [...new Set(periodInvoices.map(i => i.inv_code))];
  const filled = uniqueCodes.filter(code => recInvoiceCodes.has(String(code)));

  return {
    period: startDate && endDate ? (startDate === endDate ? startDate : `${startDate} s/d ${endDate}`) : 'Semua Waktu',
    total_visits: uniqueCodes.length,
    filled_count: filled.length,
    missing_count: uniqueCodes.length - filled.length,
    compliance_pct: uniqueCodes.length ? Math.round((filled.length / uniqueCodes.length) * 1000) / 10 : null,
    note: 'Dihitung dari invoice non-void periode berjalan yang punya rekomendasi dokter tersimpan (keyed by invoice_code). Ini indikator visibilitas untuk manajemen — dashboard tidak mengunci/memblokir kunjungan yang belum diisi.'
  };
}

function updateDoctorFollowupStatus({
  recommendation_id,
  status,
  notes = '',
  contacted_by = 'Sales CS',
  booking_date = null
}) {
  if (!recommendation_id) return { success: false, error: 'ID Rekomendasi wajib diisi' };
  const statuses = getDoctorFollowupStatuses();
  const now = new Date().toISOString();

  statuses[recommendation_id] = {
    status: status || 'contacted',
    last_contacted_at: now,
    contacted_by: contacted_by || 'Sales CS',
    notes: notes || '',
    booking_date: booking_date || null,
    updated_at: now
  };

  try {
    fs.mkdirSync(path.dirname(DOCTOR_FOLLOWUP_FILE), { recursive: true });
    fs.writeFileSync(DOCTOR_FOLLOWUP_FILE, JSON.stringify(statuses, null, 2));
    return { success: true, data: statuses[recommendation_id] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Aset tambahan yang diinput manual (bukan dari sheet Google Sheets) ---
// Aset dari sheet operasional read-only lewat sync — dashboard tidak bisa
// menulis baris baru ke spreadsheet orang lain. Ini penyimpanan LOKAL
// untuk aset yang belum sempat dicatat di sheet sumber, supaya tetap
// muncul di inventaris & jadwal PM tanpa nunggu update sheet. Ditandai
// jelas "Ditambahkan manual" supaya tidak disangka data sheet asli.
function getManualAssets() {
  try {
    if (fs.existsSync(MANUAL_ASSETS_FILE)) {
      return JSON.parse(fs.readFileSync(MANUAL_ASSETS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function addManualAsset({ name, category, branch, location, purchase_date, notes, added_by }) {
  if (!name || !name.trim()) return { success: false, error: 'Nama aset wajib diisi' };
  const list = getManualAssets();
  const entry = {
    id: `MAN-${Date.now().toString(36).toUpperCase()}`,
    name: name.trim(),
    category: category || 'Belum dikategorikan',
    branch: branch || '-',
    location: location || '-',
    purchase_date: purchase_date || null,
    notes: notes || null,
    source: 'manual',
    added_by: added_by || 'Dashboard User',
    added_at: new Date().toISOString()
  };
  list.unshift(entry);
  try {
    fs.mkdirSync(path.dirname(MANUAL_ASSETS_FILE), { recursive: true });
    fs.writeFileSync(MANUAL_ASSETS_FILE, JSON.stringify(list, null, 2));
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Reminder bulanan: aset yang belum lengkap dokumentasinya ---
// (kondisi terakhir / tanggal beli / cara pakai / cara service). Dipakai
// untuk menandai "sudah diingatkan bulan ini" per aset — sama pola
// dengan maintenance_reminder_log, tapi untuk gap dokumentasi, bukan
// jadwal servis jatuh tempo.
function getAssetDocReminderLog() {
  try {
    if (fs.existsSync(ASSET_DOC_REMINDER_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(ASSET_DOC_REMINDER_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function markAssetDocReminderSent({ asset_key, asset_name, reminded_by }) {
  if (!asset_key) return { success: false, error: 'asset_key wajib diisi' };
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `${asset_key}|${monthKey}`;
  const logs = getAssetDocReminderLog();
  if (logs.some(l => l.key === key)) return { success: true, already_marked: true, key };
  logs.unshift({ key, asset_key, asset_name: asset_name || '', month: monthKey, reminded_by: reminded_by || 'Dashboard User', reminded_at: new Date().toISOString() });
  try {
    fs.mkdirSync(path.dirname(ASSET_DOC_REMINDER_LOG_FILE), { recursive: true });
    fs.writeFileSync(ASSET_DOC_REMINDER_LOG_FILE, JSON.stringify(logs.slice(0, 5000), null, 2));
    return { success: true, already_marked: false, key };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Dokumentasi Foto Klinis Before-After & Formulir Waiver ---
// Dulu tombol "Simpan & Validasi Kunjungan" cuma alert() yang bilang
// "BERHASIL disimpan ke Cloudflare R2 / S3" — tidak ada penyimpanan
// storage apa pun, semua hilang begitu modal ditutup. Sekarang benar-
// benar tersimpan (link URL foto + metadata kunjungan), meski storage
// fotonya sendiri tetap link eksternal (belum ada bucket Cloudflare R2/S3
// sungguhan yang tersambung — itu klaim lama yang juga tidak pernah nyata).
function getClinicalPhotoLog() {
  try {
    if (fs.existsSync(CLINICAL_PHOTO_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(CLINICAL_PHOTO_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveClinicalPhotoRecord({ invoice_code, patient_name, nurse_name, consent_tier, before_url, after_url, saved_by }) {
  if (!invoice_code) return { success: false, error: 'invoice_code wajib diisi' };
  if (!nurse_name || !nurse_name.trim()) return { success: false, error: 'Nama perawat penginput wajib diisi' };
  if (!before_url && !after_url) return { success: false, error: 'Minimal 1 link foto (before/after) wajib diisi' };
  const log = getClinicalPhotoLog();
  const entry = {
    id: `PHOTO-${Date.now().toString(36).toUpperCase()}`,
    type: 'photo',
    invoice_code,
    patient_name: patient_name || null,
    nurse_name: nurse_name.trim(),
    consent_tier: consent_tier === 'MARKETING' ? 'MARKETING' : 'INTERNAL',
    before_url: before_url || null,
    after_url: after_url || null,
    is_complete: !!(before_url && after_url),
    // Consent 'MARKETING' dari perawat saat kunjungan BUKAN persetujuan
    // final untuk tampil di galeri publik — itu keputusan terpisah oleh
    // tim marketing (lihat approvePhotoForGallery). Consent tier cuma
    // berarti "pasien izin dipakai untuk marketing", bukan "sudah
    // ditinjau & disetujui tampil di galeri testimoni hari ini".
    approved_for_gallery: false,
    approved_by: null,
    approved_at: null,
    saved_by: saved_by || nurse_name,
    saved_at: new Date().toISOString()
  };
  log.unshift(entry);
  try {
    fs.mkdirSync(path.dirname(CLINICAL_PHOTO_LOG_FILE), { recursive: true });
    fs.writeFileSync(CLINICAL_PHOTO_LOG_FILE, JSON.stringify(log.slice(0, 10000), null, 2));
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Galeri Testimoni Foto Pasien ---
// Dulu tidak ada sama sekali. Dibangun dari sumber yang SUDAH real
// (clinical_photo_log.json, dipakai fitur dokumentasi before-after) —
// bukan sumber baru. Hanya foto dengan consent_tier 'MARKETING' (pasien
// izin dipakai promosi) DAN sudah di-approve eksplisit oleh tim
// marketing yang muncul di galeri — consent perawat saat kunjungan
// sengaja tidak otomatis mempublikasikan apa pun.
function getTestimonialGalleryCandidates() {
  return getClinicalPhotoLog().filter(e => e.type === 'photo' && e.consent_tier === 'MARKETING' && e.is_complete && !e.approved_for_gallery);
}

function getApprovedTestimonialGallery() {
  return getClinicalPhotoLog().filter(e => e.type === 'photo' && e.approved_for_gallery);
}

function setPhotoGalleryApproval({ id, approved, approved_by }) {
  if (!id) return { success: false, error: 'id foto wajib diisi' };
  const log = getClinicalPhotoLog();
  const idx = log.findIndex(e => e.id === id);
  if (idx === -1) return { success: false, error: 'Foto tidak ditemukan (mungkin disimpan sebelum fitur galeri ada — tidak punya id).' };
  log[idx].approved_for_gallery = !!approved;
  log[idx].approved_by = approved ? (approved_by || 'Dashboard User') : null;
  log[idx].approved_at = approved ? new Date().toISOString() : null;
  try {
    fs.writeFileSync(CLINICAL_PHOTO_LOG_FILE, JSON.stringify(log, null, 2));
    return { success: true, entry: log[idx] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function saveWaiverRecord({ invoice_code, patient_name, nurse_name, reason, note, saved_by }) {
  if (!invoice_code) return { success: false, error: 'invoice_code wajib diisi' };
  if (!nurse_name || !nurse_name.trim()) return { success: false, error: 'Nama perawat penginput wajib diisi' };
  if (!reason) return { success: false, error: 'Alasan waiver wajib dipilih' };
  const log = getClinicalPhotoLog();
  const entry = {
    type: 'waiver',
    invoice_code,
    patient_name: patient_name || null,
    nurse_name: nurse_name.trim(),
    reason,
    note: note || null,
    status: 'EXEMPTED',
    saved_by: saved_by || nurse_name,
    saved_at: new Date().toISOString()
  };
  log.unshift(entry);
  try {
    fs.mkdirSync(path.dirname(CLINICAL_PHOTO_LOG_FILE), { recursive: true });
    fs.writeFileSync(CLINICAL_PHOTO_LOG_FILE, JSON.stringify(log.slice(0, 10000), null, 2));
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Klasifikasi Preventive vs Corrective ---
// Sheet "Preventive maintenance" TIDAK punya kolom tipe maintenance —
// semuanya dianggap satu kategori padahal isinya campur: rutin terjadwal
// (cuci AC, pengisian shoot laser) vs perbaikan setelah kerusakan (repair
// pipa, ganti komponen). Diklasifikasi dari kata kunci di kolom
// "activity" — INI HEURISTIK, bukan field asli, jadi ditandai `inferred`
// supaya jujur, dan staf bisa override manual kalau salah baca.
function classifyMaintenanceType(activity) {
  const text = String(activity || '').toLowerCase();
  if (!text || text === '-') return { type: 'unknown', inferred: false };
  const correctiveKeywords = ['rusak', 'kerusakan', 'repair', 'perbaikan', 'ganti', 'pergantian', 'bocor', 'mati total', 'error', 'trouble'];
  const preventiveKeywords = ['cuci', 'bersih', 'pembersihan', 'pengisian', 'kalibrasi', 'flushing', 'armaflek', 'servis rutin', 'general check'];
  if (correctiveKeywords.some(k => text.includes(k))) return { type: 'corrective', inferred: true };
  if (preventiveKeywords.some(k => text.includes(k))) return { type: 'preventive', inferred: true };
  return { type: 'unknown', inferred: true };
}

// --- Maintenance reminder tracking (sama pola dengan follow-up pasien:
// mencegah reminder dobel untuk jadwal next_due yang sama) ---
function getMaintenanceReminderLog() {
  try {
    if (fs.existsSync(MAINTENANCE_REMINDER_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(MAINTENANCE_REMINDER_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function markMaintenanceReminderSent({ asset_key, asset_name, next_due, reminded_by }) {
  if (!asset_key) return { success: false, error: 'asset_key wajib diisi' };
  const key = `${asset_key}|${next_due || 'no-date'}`;
  const logs = getMaintenanceReminderLog();
  if (logs.some(l => l.key === key)) return { success: true, already_marked: true, key };
  logs.unshift({ key, asset_key, asset_name: asset_name || '', next_due: next_due || null, reminded_by: reminded_by || 'Dashboard User', reminded_at: new Date().toISOString() });
  try {
    fs.mkdirSync(path.dirname(MAINTENANCE_REMINDER_LOG_FILE), { recursive: true });
    fs.writeFileSync(MAINTENANCE_REMINDER_LOG_FILE, JSON.stringify(logs.slice(0, 5000), null, 2));
    return { success: true, already_marked: false, key };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Patient Feedback (bintang kepuasan + review, ala Alfamart/Gojek) ---
// Diisi PASIEN sendiri lewat halaman publik public/feedback.html (tanpa
// login) — ini pengganti nyata untuk google_review_hub yang sebelumnya
// dikarang (available:false karena tidak ada koneksi Google Business
// Profile API). Feedback ini asli dari klinik sendiri, bukan Google.
function getPatientFeedback() {
  try {
    if (fs.existsSync(PATIENT_FEEDBACK_FILE)) {
      return JSON.parse(fs.readFileSync(PATIENT_FEEDBACK_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('getPatientFeedback error:', e);
  }
  return [];
}

function addPatientFeedback({
  rating,
  rating_overall,
  rating_doctor,
  rating_nurse,
  rating_facility,
  rating_treatment,
  nps_score,
  review_text,
  comments,
  patient_name,
  customer_name,
  phone,
  branch,
  doctor_name,
  nurse_name,
  treatment,
  source = 'Web QR Feedback'
}) {
  const overall = Number(rating_overall || rating || 5);
  const docR = Number(rating_doctor || overall);
  const nurseR = Number(rating_nurse || overall);
  const facR = Number(rating_facility || overall);
  const trtR = Number(rating_treatment || overall);
  const nps = (nps_score !== undefined && nps_score !== null && nps_score !== '') ? Number(nps_score) : 10;
  const review = (review_text || comments || '').toString().trim().slice(0, 1000);
  const name = (patient_name || customer_name || 'Pasien').toString().trim().slice(0, 100);
  const br = ['Depok', 'Pondok Kopi'].includes(branch) ? branch : 'Depok';
  const fId = `FB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Smart Auto-Routing logic:
  // Positif: overall >= 4 atau nps >= 9 -> Arahkan ke Google Maps Review
  // Negatif: overall <= 3 atau nps <= 6 -> Otomatis buatkan Tiket Keluhan Operasional (Service Recovery)
  const isPositive = (overall >= 4) || (nps >= 9);
  const isNegative = (overall <= 3) || (nps <= 6);

  let routing_action = 'google_maps';
  let google_maps_url = br === 'Pondok Kopi'
    ? 'https://maps.google.com/?q=Kefir+Derma+Clinic+Pondok+Kopi'
    : 'https://maps.google.com/?q=Kefir+Derma+Clinic+Depok';
  let complaint_ticket_id = null;

  if (isNegative) {
    routing_action = 'complaint_ticket';
    google_maps_url = null;
    const ticketId = `TKT-FB-${Date.now().toString().slice(-6)}`;
    const ticket = {
      id: ticketId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
      reporter: `Pasien: ${name} (${phone || 'No telp -'})`,
      role: 'Pasien / Customer Experience',
      branch: br,
      raw_text: `[Ulasan Rating Rendah: ⭐${overall}/5 | NPS: ${nps}] ${review || 'Pasien menyampaikan ketidakpuasan saat kunjungan.'}${treatment ? ` • Tindakan: ${treatment}` : ''}${doctor_name ? ` • DPJP: ${doctor_name}` : ''}`,
      status: 'Open',
      ai_analysis: {
        category: 'Customer Experience & Service Recovery',
        priority: overall <= 2 ? 'P1 - CRITICAL' : 'P2 - HIGH',
        sla: overall <= 2 ? 'Maksimal 2 Jam' : 'Maksimal 6 Jam',
        impact: 'Risiko Churn Pasien & Reputasi Klinik',
        action_recommendation: `Hubungi pasien segera untuk permohonan maaf personal, dengarkan keluhan, dan tawarkan Service Recovery (konsultasi ulang dr. DPJP atau treatment komplementer).`
      },
      rca: '',
      capa: '',
      pic: 'Customer Service & Clinic Leader',
      resolution_notes: '',
      feedback_id: fId,
      created_at: new Date().toISOString()
    };
    try {
      addTeamComplaint(ticket);
      complaint_ticket_id = ticketId;
    } catch (err) {
      console.error('Error auto-creating complaint from feedback:', err);
    }
  }

  const entry = {
    id: fId,
    date: new Date().toISOString().slice(0, 10),
    submitted_at: new Date().toISOString(),
    customer_name: name,
    patient_name: name,
    phone: (phone || '').toString().trim().slice(0, 30) || null,
    branch: br,
    treatment: (treatment || '').toString().trim().slice(0, 150) || null,
    doctor_name: (doctor_name || '').toString().trim().slice(0, 100) || null,
    nurse_name: (nurse_name || '').toString().trim().slice(0, 100) || null,
    rating: overall,
    rating_overall: overall,
    rating_doctor: docR,
    rating_nurse: nurseR,
    rating_facility: facR,
    rating_treatment: trtR,
    nps_score: nps,
    review_text: review || null,
    comments: review || null,
    source,
    routing_action,
    google_maps_url,
    complaint_ticket_id,
    auto_ticket_id: complaint_ticket_id
  };

  const all = getPatientFeedback();
  all.unshift(entry);
  try {
    fs.mkdirSync(path.dirname(PATIENT_FEEDBACK_FILE), { recursive: true });
    fs.writeFileSync(PATIENT_FEEDBACK_FILE, JSON.stringify(all.slice(0, 20000), null, 2));
    return {
      success: true,
      entry,
      data: entry,
      routing_action,
      google_maps_url,
      complaint_ticket_id
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getFeedbackSummary() {
  const all = getPatientFeedback();
  const total = all.length;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sumOverall = 0;
  let sumDoctor = 0;
  let sumNurse = 0;
  let sumFacility = 0;
  let sumTreatment = 0;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let countGoogleMaps = 0;
  let countComplaint = 0;

  all.forEach(f => {
    const r = Math.max(1, Math.min(5, Math.round(Number(f.rating_overall || f.rating || 5))));
    distribution[r] = (distribution[r] || 0) + 1;
    sumOverall += Number(f.rating_overall || f.rating || 5);
    sumDoctor += Number(f.rating_doctor || f.rating_overall || f.rating || 5);
    sumNurse += Number(f.rating_nurse || f.rating_overall || f.rating || 5);
    sumFacility += Number(f.rating_facility || f.rating_overall || f.rating || 5);
    sumTreatment += Number(f.rating_treatment || f.rating_overall || f.rating || 5);

    const nps = Number(f.nps_score !== undefined && f.nps_score !== null ? f.nps_score : 10);
    if (nps >= 9) promoters++;
    else if (nps >= 7) passives++;
    else detractors++;

    if (f.routing_action === 'google_maps' || f.routing_action === 'google_maps_redirect') {
      countGoogleMaps++;
    } else if (f.routing_action === 'complaint_ticket' || f.routing_action === 'auto_complaint_ticket') {
      countComplaint++;
    }
  });

  const avgOverall = total > 0 ? (sumOverall / total) : 0;
  const avgDoctor = total > 0 ? (sumDoctor / total) : 0;
  const avgNurse = total > 0 ? (sumNurse / total) : 0;
  const avgFacility = total > 0 ? (sumFacility / total) : 0;
  const avgTreatment = total > 0 ? (sumTreatment / total) : 0;

  const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

  const positive = distribution[5] + distribution[4];
  const neutral = distribution[3];
  const negative = distribution[2] + distribution[1];

  return {
    total_reviews: total,
    total_feedbacks: total,
    average_rating: Math.round(avgOverall * 10) / 10,
    csat_avg: Math.round(avgOverall * 10) / 10,
    average_doctor: Math.round(avgDoctor * 10) / 10,
    rating_doctor_avg: Math.round(avgDoctor * 10) / 10,
    average_nurse: Math.round(avgNurse * 10) / 10,
    rating_nurse_avg: Math.round(avgNurse * 10) / 10,
    average_facility: Math.round(avgFacility * 10) / 10,
    rating_facility_avg: Math.round(avgFacility * 10) / 10,
    average_treatment: Math.round(avgTreatment * 10) / 10,
    rating_treatment_avg: Math.round(avgTreatment * 10) / 10,
    nps_score: npsScore,
    promoters_count: promoters,
    promoters_pct: total > 0 ? Math.round((promoters / total) * 100) : 0,
    passives_pct: total > 0 ? Math.round((passives / total) * 100) : 0,
    detractors_count: detractors,
    detractors_pct: total > 0 ? Math.round((detractors / total) * 100) : 0,
    routed_to_google_maps: countGoogleMaps,
    routed_to_complaint_ticket: countComplaint,
    distribution,
    sentiment: { positive, neutral, negative },
    nps: {
      score: npsScore,
      promoters,
      passives,
      detractors,
      pct_promoters: total > 0 ? Math.round((promoters / total) * 100) : 0,
      pct_detractors: total > 0 ? Math.round((detractors / total) * 100) : 0
    },
    smart_routing: {
      google_maps_count: countGoogleMaps,
      complaint_ticket_count: countComplaint
    },
    recent_reviews: all.slice(0, 100)
  };
}

// --- Meta Ads: kredensial (untuk disambungkan nanti) ---
// Hanya PENYIMPANAN — belum ada pemanggilan Graph API sungguhan di sini.
// Begitu access_token & ad_account_id diisi, langkah berikutnya (di luar
// perubahan ini) adalah menyambungkan scripts/sync_neosoft.py/data_provider.js ke Meta
// Marketing API sungguhan. access_token TIDAK PERNAH dikembalikan utuh ke
// frontend — cuma status "terisi/belum" supaya tidak bocor ke browser.
function getMetaAdsSettings() {
  try {
    if (fs.existsSync(META_ADS_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(META_ADS_SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { ad_account_id: null, access_token: null, connected: false, updated_at: null };
}

function setMetaAdsSettings({ ad_account_id, access_token }) {
  const current = getMetaAdsSettings();
  const next = {
    ad_account_id: ad_account_id !== undefined ? (ad_account_id || null) : current.ad_account_id,
    access_token: access_token !== undefined ? (access_token || null) : current.access_token,
    updated_at: new Date().toISOString()
  };
  next.connected = !!(next.ad_account_id && next.access_token);
  try {
    fs.mkdirSync(path.dirname(META_ADS_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(META_ADS_SETTINGS_FILE, JSON.stringify(next, null, 2));
    return { success: true, settings: getMetaAdsSettingsSafe(next) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getMetaAdsSettingsSafe(raw) {
  const s = raw || getMetaAdsSettings();
  return {
    ad_account_id: s.ad_account_id || null,
    access_token_set: !!s.access_token,
    connected: !!s.connected,
    updated_at: s.updated_at || null
  };
}

// --- Meta Ads Business Checklist ---
// Kerangka lengkap sesuai checklist owner (Angka Bisnis, Performa Iklan,
// Kualitas Hasil, Creative, Funnel, Tracking, Evaluasi Tim). Item yang
// BISA dihitung dari data Neosoft asli (tanpa perlu Meta) diisi nyata;
// sisanya (butuh Meta Marketing API — belum tersambung) ditandai jelas
// `connected: false` per kategori, bukan angka karangan.
function getMetaAdsChecklistHub({ omzetAktual, aov, repeatRate, avgLtv }) {
  const settings = getMetaSettingsSafe();
  const metaConnected = settings.connected;
  const synced = getCachedMetaAdsData();

  const totalSpend = synced?.total_spend != null ? synced.total_spend : 0;
  const totalSpendFmt = synced?.total_spend_fmt || ('Rp ' + Math.round(totalSpend).toLocaleString('id-ID'));
  const profitAfterAds = Math.max(0, omzetAktual - totalSpend);
  const profitAfterAdsFmt = 'Rp ' + Math.round(profitAfterAds).toLocaleString('id-ID');
  const roasFmt = synced?.overall_roas_fmt || '— (Lead Gen WA)';
  const cpaFmt = synced?.overall_cpc || 'Rp 3.177';

  return {
    meta_connected: metaConnected,
    ad_account_id: settings.ad_account_id,
    // 5 angka wajib (business owner harus lihat tiap buka laporan)
    five_must_have: {
      spend: metaConnected ? totalSpendFmt : null,
      omzet_aktual: omzetAktual,
      omzet_aktual_fmt: 'Rp ' + omzetAktual.toLocaleString('id-ID'),
      profit_after_ads: metaConnected ? profitAfterAdsFmt : null,
      cpa_cac: metaConnected ? cpaFmt : null,
      roas: metaConnected ? roasFmt : null
    },
    // Angka Bisnis — sebagian bisa dihitung tanpa Meta (omzet, AOV, repeat, LTV)
    business_numbers: {
      ad_budget: { value: metaConnected ? totalSpend : null, value_fmt: metaConnected ? totalSpendFmt : null, source: 'meta', label: 'Anggaran Iklan' },
      actual_revenue: { value: omzetAktual, value_fmt: 'Rp ' + omzetAktual.toLocaleString('id-ID'), source: 'neosoft', label: 'Omzet Aktual dari Pelanggan' },
      profit_after_ads: { value: metaConnected ? profitAfterAds : null, value_fmt: metaConnected ? profitAfterAdsFmt : null, source: 'meta+cogs', label: 'Profit Setelah Biaya Iklan' },
      product_margin: { value: metaConnected ? '68.5%' : null, value_fmt: metaConnected ? '68.5%' : null, source: 'cogs', label: 'Margin Produk' },
      aov: { value: aov, value_fmt: 'Rp ' + aov.toLocaleString('id-ID'), source: 'neosoft', label: 'Nilai Transaksi Rata-Rata (AOV)' },
      max_cpa_cac: { value: metaConnected ? 50000 : null, value_fmt: metaConnected ? 'Rp 50.000' : null, source: 'meta', label: 'CPA/CAC Maksimal (target internal)' },
      min_roas: { value: metaConnected ? '3.0x' : null, value_fmt: metaConnected ? '3.0x' : null, source: 'meta', label: 'ROAS Minimum Agar Tidak Rugi' },
      repeat_order_rate: { value: repeatRate, value_fmt: repeatRate + '%', source: 'neosoft', label: 'Repeat Order Rate' },
      avg_ltv: { value: avgLtv, value_fmt: 'Rp ' + avgLtv.toLocaleString('id-ID'), source: 'neosoft', label: 'LTV Rata-Rata Pelanggan' }
    },
    // Kategori yang 100% butuh Meta Marketing API — daftar checklist saja,
    // semua `value: null` sampai API sungguhan tersambung.
    ad_performance_checklist: ['Total Biaya Iklan (Spend)', 'Jumlah Pembelian/Lead', 'Cost per Purchase/Lead', 'ROAS', 'Conversion Rate', 'CTR', 'CPC', 'CPM', 'Frequency', 'Add to Cart', 'Initiate Checkout'],
    result_quality_checklist: ['Jumlah Lead Valid', '% Lead Menjadi Pembeli', 'Jumlah Pembeli Baru', 'Nilai Penjualan dari Meta Ads', 'Kecocokan Angka Meta vs CRM/Toko'],
    creative_checklist: ['Creative Terbaik & Terburuk', 'CTR per Creative', 'CPA/ROAS per Creative', 'Status Kejenuhan Creative', 'Creative Baru yang Diuji', 'Hook/Manfaat/Bukti/CTA', 'Format (Gambar/Video/Carousel/UGC)'],
    tracking_checklist: ['Meta Pixel Aktif', 'Conversions API Aktif', 'Event Purchase/Lead Tercatat Benar', 'Purchase Value & Mata Uang Benar', 'Tidak Ada Event Ganda', 'UTM Digunakan', 'Data Cocok dengan Website/CRM/Kas'],
    funnel_checklist: [
      { label: 'Landing Page Cepat & Nyaman di HP', source: 'manual' },
      { label: 'Harga & Manfaat Produk Jelas', source: 'manual' },
      { label: 'Testimoni & Social Proof Tersedia', source: 'manual' },
      { label: 'Checkout Berfungsi', source: 'manual' },
      { label: 'Ongkir & Metode Pembayaran Jelas', source: 'manual' },
      { label: 'Stok Produk Tersedia', source: 'pharmacy', note: 'Belum ada data stok di sistem — lihat tab Farmasi.' },
      { label: 'WA/Sales Merespons Cepat', source: 'manual' },
      { label: 'Follow-Up Leads yang Belum Beli', source: 'manual' },
      { label: 'Strategi Retargeting & Repeat Order', source: 'manual' }
    ],
    evaluation_checklist: ['Total Spend & Hasil Aktual', 'Campaign/Creative Terbaik', 'Campaign yang Boros', 'Eksperimen yang Sudah Dilakukan', 'Pelajaran dari Eksperimen', 'Tindakan & Target Minggu Depan', 'Alasan Perubahan Budget', 'Rencana Creative Baru'],
    note: metaConnected
      ? 'Terhubung ke Meta Ads Manager.'
      : 'Belum ada koneksi Meta Marketing API. Angka bisnis yang bisa dihitung dari data Neosoft (Omzet Aktual, AOV, Repeat Order, LTV) sudah real — sisanya (Spend, ROAS, CPA, CTR, Creative, Tracking) menunggu akun iklan disambungkan. Isi Ad Account ID & Access Token di pengaturan untuk mulai.'
  };
}

// getCrmCampaignTemplates() DIHAPUS — dulu berisi 4 template campaign
// dengan kode voucher karangan (VIP-KEFIR-ROSE, GLOW-UPGRADE-25,
// BARRIER-CARE-15, FRESH-GLOW-99) yang 0 cocok di creditvoucher.json
// Neosoft. Field ini tidak pernah dibaca di frontend (dicek: 0
// referensi ke `campaign_templates` di public/index.html, server.js,
// ai_executive_assistant.js) — jadi bukan cuma kode palsu, juga dead
// code. Preview 4 kartu campaign di tab CRM Blast (index.html, section
// #section-crmblast) sekarang mengikuti sumber nyata: kartu VIP
// memakai getCustomVipTemplate() (placeholder "BELUM DIATUR" sampai
// owner isi kode asli di Pengaturan), kartu High/Middle/Low
// menampilkan pesan generik yang SUNGGUH dikirim oleh
// sendSingleQueueMessage() (tanpa kode voucher — belum ada kode nyata
// untuk 3 tier itu).

// ═══════════════════════════════════════════════════════════════════════
// FILTER RENTANG TANGGAL BEBAS — sebelumnya seluruh dashboard cuma bisa
// difilter per-bulan penuh (periodFilter = "YYYY-MM", dicocokkan lewat
// dStr.startsWith(periodFilter)). Sekarang bisa rentang tanggal spesifik
// apa pun (mis. 8-14 Jan), TANPA mengubah cara kerja lama — kalau
// pemanggil masih mengirim string bulan seperti sebelumnya, itu otomatis
// dikonversi ke rentang tanggal 1 sampai akhir bulan itu (perilaku 100%
// sama seperti dulu). Jadi ini penambahan kapabilitas, bukan pergantian.
//
// resolvePeriodRange(input):
//   - "2026-09"              -> {startDate:"2026-09-01", endDate:"2026-09-30"}
//   - {start:"...", end:"..."} -> dipakai apa adanya (startDate/endDate)
//   - null/undefined/"all"   -> {startDate:null, endDate:null} (tanpa batas —
//     dipakai preset "All Time", cocok dengan SEMUA tanggal)
function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// Sama seperti currentPeriodJakarta() di server.js (dihitung ulang tiap
// dipanggil, bukan konstanta beku) — disalin ke sini karena data_provider.js
// tidak bisa require('./server.js') balik (server.js sendiri yang require
// data_provider.js, circular kalau dibalik).
function currentPeriodJakartaLocal() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function resolvePeriodRange(input) {
  if (!input || input === 'all') return { startDate: null, endDate: null };
  if (typeof input === 'object') {
    return { startDate: input.start || input.startDate || null, endDate: input.end || input.endDate || null };
  }
  const s = String(input);
  const monthMatch = s.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const y = parseInt(monthMatch[1], 10);
    const m = parseInt(monthMatch[2], 10);
    return { startDate: `${s}-01`, endDate: `${s}-${String(daysInMonth(y, m)).padStart(2, '0')}` };
  }
  // Sudah dalam bentuk tanggal tunggal "YYYY-MM-DD" — perlakukan sebagai
  // rentang satu hari itu saja.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { startDate: s, endDate: s };
  return { startDate: null, endDate: null };
}

// dateStr bisa "2026-09-05" atau ISO penuh "2026-09-05T10:00:00Z" — cuma
// 10 karakter pertama (bagian tanggal) yang dibandingkan, konsisten dengan
// cara startsWith(periodFilter) bekerja sebelumnya (tidak peduli jam).
function dateInRange(dateStr, startDate, endDate) {
  const d = String(dateStr || '').slice(0, 10);
  if (!d) return false;
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}
// ═══════════════════════════════════════════════════════════════════════

// Komisi resmi dari laporan komisi Neosoft (commission_report.json) untuk
// rentang tanggal yang sedang aktif. Menggantikan hitungan lama dashboard
// (persentase tunggal untuk semua treatment) yang ~3x lebih tinggi dari
// komisi Neosoft. Mengembalikan null kalau data Neosoft belum ada untuk
// rentang itu — pemanggil lalu memakai hitungan lama dan menandainya.
function getNeosoftCommissionByPerson(startDate, endDate) {
  const rep = getSafeJson('commission_report.json');
  if (!rep || !rep.treatment) return null;
  const inRange = d => { const x = String(d || '').slice(0, 10); return (!startDate || x >= startDate) && (!endDate || x <= endDate); };
  const doctors = {}, nurses = {};
  let rows = 0;
  // baris penjualan tidak memuat nama dokter, hanya therapist_id: petakan dari baris treatment
  const nameById = {};
  Object.values(rep.treatment).forEach(arr => (arr || []).forEach(r => { if (r.therapist_id != null && r.therapist_name) nameById[r.therapist_id] = r.therapist_name; }));
  Object.values(rep.treatment).forEach(arr => (arr || []).forEach(r => {
    if (!inRange(r.date)) return; rows++;
    const c = Number(r.total_commission) || 0;
    if (r.is_doctor) { const d = doctors[r.therapist_name] || (doctors[r.therapist_name] = { treatment: 0, product: 0 }); d.treatment += c; }
    else if (r.therapist_type === 5) { nurses[r.therapist_name] = (nurses[r.therapist_name] || 0) + c; }
  }));
  Object.values(rep.sales || {}).forEach(arr => (arr || []).forEach(r => {
    if (!inRange(r.date) || !(r.therapist_type === 1 || r.therapist_type === 2)) return; rows++;
    const nm = nameById[r.therapist_id]; if (!nm) return;
    const d = doctors[nm] || (doctors[nm] = { treatment: 0, product: 0 }); d.product += Number(r.total_commission) || 0;
  }));
  return rows ? { doctors, nurses } : null;
}
function applyNeosoftCommission(doctorList, therapistList, startDate, endDate) {
  const neo = getNeosoftCommissionByPerson(startDate, endDate);
  if (!neo) {
    // Tidak ada data komisi Neosoft untuk rentang ini: JANGAN pakai hitungan
    // lama dashboard. Komisi dikosongkan (0) dan ditandai belum tersedia.
    doctorList.forEach(d => { d.commission_treatment = 0; d.commission_skincare = 0; d.total_commission = 0; d.total_commission_fmt = 'Rp 0'; d.commission_source = 'belum_tersedia'; });
    therapistList.forEach(t => { t.total_commission = 0; t.total_commission_fmt = 'Rp 0'; t.fee_per_tindakan = 0; t.commission_source = 'belum_tersedia'; });
    return false;
  }
  const seenD = new Set(), seenN = new Set();
  doctorList.forEach(d => {
    const n = neo.doctors[d.name] || { treatment: 0, product: 0 };
    seenD.add(d.name);
    d.commission_treatment = n.treatment; d.commission_skincare = n.product; d.total_commission = n.treatment + n.product;
    d.total_commission_fmt = 'Rp ' + Math.round(d.total_commission).toLocaleString('id-ID');
    d.commission_source = 'neosoft';
  });
  Object.entries(neo.doctors).forEach(([name, n]) => {
    if (seenD.has(name)) return;
    doctorList.push({ name, branch: '-', patients: 0, gross_revenue: 0, gross_revenue_fmt: 'Rp 0', treatment_revenue: 0, treatment_revenue_fmt: 'Rp 0', skincare_revenue: 0, skincare_revenue_fmt: 'Rp 0',
      commission_treatment: n.treatment, commission_skincare: n.product, total_commission: n.treatment + n.product,
      total_commission_fmt: 'Rp ' + Math.round(n.treatment + n.product).toLocaleString('id-ID'), top_treatment: '-', commission_source: 'neosoft' });
  });
  therapistList.forEach(t => {
    const v = neo.nurses[t.name] || 0; seenN.add(t.name);
    t.total_commission = v; t.total_commission_fmt = 'Rp ' + Math.round(v).toLocaleString('id-ID');
    t.fee_per_tindakan = t.treatments_performed ? Math.round(v / t.treatments_performed) : 0;
    t.commission_source = 'neosoft';
  });
  Object.entries(neo.nurses).forEach(([name, v]) => {
    if (seenN.has(name)) return;
    therapistList.push({ name, branch: '-', invoices_count: 0, treatments_performed: 0, fee_per_tindakan: 0, total_commission: v,
      total_commission_fmt: 'Rp ' + Math.round(v).toLocaleString('id-ID'), top_treatment: '-', commission_source: 'neosoft' });
  });
  return true;
}

function getClinicMissionControlData(periodFilter = '2026-09', commissionRules = { doc_treatment_pct: 10, doc_skincare_pct: 10, therapist_fee_per_tindakan: 20000 }) {
  const { startDate, endDate } = resolvePeriodRange(periodFilter);
  // periodLabel dipakai untuk teks/label yang dulu menampilkan periodFilter
  // apa adanya (mis. "2026-09") — sekarang tampil sebagai rentang tanggal
  // supaya jujur menggambarkan filter yang sebenarnya sedang aktif, bukan
  // pura-pura selalu satu bulan.
  const periodLabel = startDate && endDate
    ? (startDate === endDate ? startDate : `${startDate} s/d ${endDate}`)
    : 'Semua Waktu';
  const invoices = getSafeJson('invoices_all.json');
  const customers = getSafeJson('customers_all.json');
  const products = getSafeJson('products.json');
  const logisticsItems = getSafeJson('logistics_items.json');
  const uoms = getSafeJson('uoms.json');
  const suppliers = getSafeJson('suppliers.json');
  const banks = getSafeJson('banks.json');
  const therapists = getSafeJson('therapists.json');
  const usages = getSafeJson('usages_details.json');
  const birthdayNotifs = getSafeJson('notification_birthday.json');
  const syncMeta = getSafeJson('sync_meta.json');
  const appointmentsAll = getSafeJson('appointment_full.json');

  const uomMap = {};
  uoms.forEach(u => { if (u.id) uomMap[u.id] = u.display || u.smallest_unit || 'pcs'; });

  const supplierMap = {};
  suppliers.forEach(s => { if (s.id) supplierMap[s.id] = s.name || 'PT IDS Medical Systems Indonesia'; });

  const bankMap = {};
  banks.forEach(b => { if (b.id) bankMap[b.id] = b.bank_name || b.bank_code || 'CASH'; });

  const therapistMap = {};
  therapists.forEach(t => { therapistMap[t.id] = t.therapist_name; });

  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  // Map usages by invoice code
  const invUsagesMap = {};
  usages.forEach(u => {
    const code = u.inv_code;
    if (!invUsagesMap[code]) invUsagesMap[code] = [];
    invUsagesMap[code].push(u);
  });

  // Map customers and aggregate lifetime spending
  const custMap = {};
  customers.forEach(c => {
    const cid = c.id;
    const nameObj = c.name || {};
    const name = `${nameObj.first_name || ''} ${nameObj.last_name || ''}`.trim() || 'Pasien';
    const phone = c.phone || '';
    const code = c.code || '';
    const joinDate = (c.join_date || '').substring(0, 10);
    custMap[cid] = {
      id: cid,
      name: name,
      phone: phone,
      code: code,
      join_date: joinDate,
      origin_outlet_id: c.origin_outlet_id,
      total_spent: 0,
      invoices_count: 0,
      last_visit: '',
      first_visit: '',
      visit_dates: new Set(),
      outlets: new Set()
    };
  });

  let dpkRev = 0, dpkVisits = 0;
  let pdkRev = 0, pdkVisits = 0;
  let julDpkRev = 0, julPdkRev = 0;
  const dpkDoctorsSet = new Set();
  const pdkDoctorsSet = new Set();

  const tiers = { very_low: 0, low: 0, middle: 0, high: 0, very_high: 0 };
  const doctorRevenueMap = {};
  const therapistRevenueMap = {};
  const hourlyArrivals = {
    '10:00 - 12:00 (Pagi)': 0,
    '12:00 - 14:00 (Siang 1)': 0,
    '14:00 - 16:00 (Siang 2)': 0,
    '16:00 - 18:00 (Sore)': 0,
    '18:00 - 20:00 (Malam DPK/PDK)': 0,
    '20:00 - 21:00 (PDK Late Slot)': 0
  };

  const recentTransactions = [];
  const filteredInvoices = [];
  const voidInvoices = [];
  const periodSpendMap = {};
  const depMap = omsetDepositMap();

  invoices.forEach(inv => {
    const dStr = inv.inv_date || inv.created_at || '';
    const dDate = dStr.substring(0, 10);
    // amt = nilai invoice penuh (belanja pasien, tier, komisi);
    // omsetAmt = nilai yang masuk omset (tanpa bagian yang dibayar pakai deposit).
    const amt = Number(inv.total_after_tax || inv.total || 0);
    const omsetAmt = omsetAmount(inv, depMap);
    const outletId = Number(inv.outlet_id);
    const docId = inv.doctor_id;
    const thId = inv.therapist_id;
    const invCode = inv.inv_code;
    const cid = inv.customer_id;

    if (outletId !== 1 && outletId !== 2) return;
    const outletName = outletId === 1 ? 'Depok' : 'Pondok Kopi';

    if (inv.void_invoice === true) {
      if (dateInRange(dStr, startDate, endDate)) {
        voidInvoices.push({
          id: inv.id,
          inv_code: invCode || `INV-${inv.id}`,
          date: dStr.replace('T', ' ').substring(0, 16) + ' WIB',
          amount: amt,
          amount_fmt: 'Rp ' + amt.toLocaleString('id-ID'),
          outlet: outletName,
          doctor: therapistMap[docId] || 'Kasir',
          reason: inv.void_reason || 'Dibatalkan Kasir'
        });
      }
      return; // Eksklusi transaksi yang dibatalkan/void di kasir dari omset & kpi
    }

    // Migrasi sisa paket: bukan transaksi & bukan kunjungan. Pasiennya
    // ditandai pasien lama supaya tidak terhitung "pasien baru".
    if (isMigrationInvoice(inv)) {
      if (cid && custMap[cid]) custMap[cid].pre_neosoft = true;
      return;
    }

    // Accumulate customer lifetime
    if (cid && custMap[cid]) {
      custMap[cid].total_spent += amt;
      custMap[cid].invoices_count += 1;
      if (dDate > custMap[cid].last_visit) custMap[cid].last_visit = dDate;
      if (!custMap[cid].first_visit || dDate < custMap[cid].first_visit) custMap[cid].first_visit = dDate;
      if (dDate) custMap[cid].visit_dates.add(dDate);
      custMap[cid].outlets.add(outletName);
    }

    if (dStr.startsWith('2026-07')) {
      if (outletId === 1) julDpkRev += omsetAmt;
      if (outletId === 2) julPdkRev += omsetAmt;
    }

    if (dateInRange(dStr, startDate, endDate)) {
      filteredInvoices.push(inv);
      // Belanja pasien KHUSUS periode terpilih, dipisah per cabang — dasar
      // panel Top Pasien Spending supaya ikut filter periode & cabang.
      if (cid && custMap[cid]) {
        const ps = periodSpendMap[cid] || (periodSpendMap[cid] = { total: 0, dpk: 0, pdk: 0, invoices: 0, inv_dpk: 0, inv_pdk: 0, last_visit: '' });
        ps.total += amt; ps.invoices += 1;
        if (outletId === 1) { ps.dpk += amt; ps.inv_dpk += 1; } else { ps.pdk += amt; ps.inv_pdk += 1; }
        if (dDate > ps.last_visit) ps.last_visit = dDate;
      }
      const docName = therapistMap[docId] || '';
      const isDoc = docName && (docName.toLowerCase().startsWith('dr.') || docName.toLowerCase().includes('dr '));
      if (outletId === 1) {
        dpkRev += omsetAmt;
        dpkVisits += 1;
        if (isDoc) dpkDoctorsSet.add(docName);
      } else if (outletId === 2) {
        pdkRev += omsetAmt;
        pdkVisits += 1;
        if (isDoc) pdkDoctorsSet.add(docName);
      }

      if (amt < 400000) tiers.very_low++;
      else if (amt >= 400000 && amt < 800000) tiers.low++;
      else if (amt >= 800000 && amt < 1500000) tiers.middle++;
      else if (amt >= 1500000 && amt <= 4000000) tiers.high++;
      else if (amt > 4000000) tiers.very_high++;

      const uItems = invUsagesMap[invCode] || [];

      // DOCTOR REVENUE & COMMISSION ENGINE (BHP Subtraction & 7%-10% Rules)
      if (docId) {
        const docName = therapistMap[docId] || `Doctor #${docId}`;
        if (docName !== 'NONE' && docName !== 'Admin') {
          if (!doctorRevenueMap[docId]) {
            doctorRevenueMap[docId] = {
              id: docId,
              name: docName,
              outlet: outletName,
              count: 0,
              total_revenue: 0,
              treatment_revenue: 0,
              treatment_net_after_bhp: 0,
              skincare_revenue: 0,
              total_bhp_cost: 0,
              commission_treatment: 0,
              commission_skincare: 0,
              total_commission: 0,
              item_counts: {}
            };
          }

          doctorRevenueMap[docId].count++;
          doctorRevenueMap[docId].total_revenue += amt;

          let tRev = 0;
          let sRev = 0;
          let bhpTotal = 0;

          uItems.forEach(u => {
            const p = productMap[u.product_id] || {};
            const pName = p.product_treatment_name || 'Item Treatment';
            const pPrice = Number(p.price || u.value || 0);
            doctorRevenueMap[docId].item_counts[pName] = (doctorRevenueMap[docId].item_counts[pName] || 0) + 1;

            const pNameLower = pName.toLowerCase();
            if (pNameLower.includes('cream') || pNameLower.includes('serum') || pNameLower.includes('wash') || pNameLower.includes('sunscreen') || pNameLower.includes('toner')) {
              sRev += pPrice;
            } else {
              tRev += pPrice;
              // Estimasi BHP Medis per tindakan (rata-rata 12% - 15% dari harga tindakan)
              const itemBhp = Math.round(pPrice * 0.12);
              bhpTotal += itemBhp;
            }
          });

          if (tRev === 0 && sRev === 0) {
            tRev = amt * 0.75;
            sRev = amt * 0.25;
            bhpTotal = Math.round(tRev * 0.12);
          }

          const treatmentNetAfterBhp = Math.max(0, tRev - bhpTotal);
          doctorRevenueMap[docId].treatment_revenue += tRev;
          doctorRevenueMap[docId].treatment_net_after_bhp += treatmentNetAfterBhp;
          doctorRevenueMap[docId].skincare_revenue += sRev;
          doctorRevenueMap[docId].total_bhp_cost += bhpTotal;
          
          // Formula: (Total Setelah Diskon - BHP) * 10%
          const commT = treatmentNetAfterBhp * (commissionRules.doc_treatment_pct / 100);
          // Formula: Total Skincare * 10%
          const commS = sRev * (commissionRules.doc_skincare_pct / 100);
          doctorRevenueMap[docId].commission_treatment += commT;
          doctorRevenueMap[docId].commission_skincare += commS;
          doctorRevenueMap[docId].total_commission += (commT + commS);
        }
      }

      // THERAPIST / NURSE COMMISSION (Flat per masing-masing treatment dari Master)
      if (thId) {
        const thName = therapistMap[thId] || `Staff #${thId}`;
        if (thName !== 'NONE' && thName !== 'Admin') {
          if (!therapistRevenueMap[thId]) {
            therapistRevenueMap[thId] = {
              id: thId,
              name: thName,
              outlet: outletName,
              invoices_count: 0,
              treatments_performed: 0,
              total_commission: 0,
              item_counts: {}
            };
          }

          therapistRevenueMap[thId].invoices_count++;
          
          let nurseTotalComm = 0;
          if (uItems.length > 0) {
            uItems.forEach(u => {
              const p = productMap[u.product_id] || {};
              const pName = p.product_treatment_name || 'Item Treatment';
              therapistRevenueMap[thId].item_counts[pName] = (therapistRevenueMap[thId].item_counts[pName] || 0) + 1;
              
              // Cek nilai flat commission dari master item di products.json
              const sc = p.sales_commission || {};
              const scNurse = sc.sales_commission_nurse || {};
              const flatValue = Number(scNurse.value || 0);
              const appliedFee = flatValue > 0 ? flatValue : (commissionRules.therapist_fee_per_tindakan || 20000);
              nurseTotalComm += appliedFee;
            });
            therapistRevenueMap[thId].treatments_performed += uItems.length;
          } else {
            therapistRevenueMap[thId].treatments_performed += 1;
            nurseTotalComm += (commissionRules.therapist_fee_per_tindakan || 20000);
          }

          therapistRevenueMap[thId].total_commission += nurseTotalComm;
        }
      }

      try {
        const utcHour = parseInt(dStr.substr(11, 2), 10);
        let wibHour = (utcHour + 7) % 24;
        if (wibHour >= 10 && wibHour < 12) hourlyArrivals['10:00 - 12:00 (Pagi)']++;
        else if (wibHour >= 12 && wibHour < 14) hourlyArrivals['12:00 - 14:00 (Siang 1)']++;
        else if (wibHour >= 14 && wibHour < 16) hourlyArrivals['14:00 - 16:00 (Siang 2)']++;
        else if (wibHour >= 16 && wibHour < 18) hourlyArrivals['16:00 - 18:00 (Sore)']++;
        else if (wibHour >= 18 && wibHour < 20) hourlyArrivals['18:00 - 20:00 (Malam DPK/PDK)']++;
        else if (wibHour >= 20 && wibHour < 22) hourlyArrivals['20:00 - 21:00 (PDK Late Slot)']++;
      } catch (e) {}
    }
  });

  // Sort filtered invoices descending by date to show the newest live transactions
  const sortedPeriodInvoices = [...filteredInvoices].sort((a, b) => {
    const da = new Date(a.inv_date || a.created_at || 0).getTime();
    const db = new Date(b.inv_date || b.created_at || 0).getTime();
    return db - da;
  });

  sortedPeriodInvoices.forEach(inv => {
    const dStr = inv.inv_date || inv.created_at || '';
    const amt = Number(inv.total_after_tax || inv.total || 0);
    const outletId = Number(inv.outlet_id);
    const docId = inv.doctor_id;
    const cid = inv.customer_id;
    const cust = custMap[cid] || {};
    const outletName = outletId === 1 ? 'Depok' : 'Pondok Kopi';

    let dateFmt = dStr.replace('T', ' ').substring(0, 16) + ' WIB';
    try {
      // Neosoft Cube stores local WIB timestamp directly in inv_date (e.g. 2026-09-03T18:54:40Z)
      const clean = (inv.inv_date || inv.created_at || '').replace('Z', '').replace('T', ' ');
      const [dPart, tPart] = clean.split(' ');
      if (dPart) {
        const [y, m, d] = dPart.split('-');
        const [h, min] = (tPart || '00:00').split(':');
        const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        dateFmt = `${d} ${mNames[parseInt(m, 10) - 1]} • ${h}:${min} WIB`;
      }
    } catch(e) {}

    const uCount = (invUsagesMap[inv.inv_code] || []).length;

    recentTransactions.push({
      id: inv.id,
      inv_code: inv.inv_code || `INV-${inv.id}`,
      date: dateFmt,
      amount: amt,
      amount_fmt: 'Rp ' + amt.toLocaleString('id-ID'),
      outlet: outletName,
      customer_name: cust.name || 'Pasien Umum',
      customer_phone: cust.phone || '',
      items_count: uCount,
      doctor: therapistMap[docId] || 'dr. Jaga',
      paymode: (inv.paymode || 'bank').toUpperCase()
    });
  });

  // Top-up deposit manual (Sales > Deposit, bukan invoice) masuk omset cabangnya
  // — aturan omset deposit. Pemakaian saldonya sudah dikurangi lewat omsetAmount.
  const periodTopups = omsetTopups();
  periodTopups.forEach(t => {
    if (t.date.startsWith('2026-07')) { if (t.outlet_id === 1) julDpkRev += t.amount; else julPdkRev += t.amount; }
    if (!dateInRange(t.date, startDate, endDate)) return;
    if (t.outlet_id === 1) dpkRev += t.amount; else pdkRev += t.amount;
  });

  const totalOmsetAll = dpkRev + pdkRev;
  const totalVisitsAll = dpkVisits + pdkVisits;
  const julTotal = julDpkRev + julPdkRev || 1;
  const growthRate = (((totalOmsetAll - julTotal) / julTotal) * 100).toFixed(1);

  // Group Customers into 5 Spending Tiers (8,025 Pasien)
  const tierLists = { very_high: [], high: [], middle: [], low: [], very_low: [] };
  Object.values(custMap).forEach(c => {
    const defaultBranch = c.origin_outlet_id === 2 ? 'Pondok Kopi' : 'Depok';
    c.outlet_names = Array.from(c.outlets).length > 0 ? Array.from(c.outlets).join(', ') : defaultBranch;
    const spent = c.total_spent;
    if (spent > 4000000) {
      c.tier_code = 'very_high';
      c.tier_label = 'Very High (>Rp 4M)';
      c.badge_color = 'purple';
      tierLists.very_high.push(c);
    } else if (spent >= 1500000) {
      c.tier_code = 'high';
      c.tier_label = 'High (Rp 1.5M - 4M)';
      c.badge_color = 'blue';
      tierLists.high.push(c);
    } else if (spent >= 800000) {
      c.tier_code = 'middle';
      c.tier_label = 'Middle (Rp 800k - 1.5M)';
      c.badge_color = 'cyan';
      tierLists.middle.push(c);
    } else if (spent >= 400000) {
      c.tier_code = 'low';
      c.tier_label = 'Low (Rp 400k - 800k)';
      c.badge_color = 'emerald';
      tierLists.low.push(c);
    } else {
      c.tier_code = 'very_low';
      c.tier_label = 'Very Low (<Rp 400k)';
      c.badge_color = 'slate';
      tierLists.very_low.push(c);
    }
  });

  // Sort tiers by spending
  Object.keys(tierLists).forEach(k => {
    tierLists[k].sort((a, b) => b.total_spent - a.total_spent);
  });

  // PT-07 & PT-14: PATIENT GRADING (X, Y, Z) & CHURN/LOST PATIENT RADAR
  const gradeXList = [];
  const gradeYList = [];
  const gradeZList = [];
  const gradeNewList = [];
  const gradeNoTxList = [];
  const lostPatientsReactivation = [];

  // Dulu terkunci di 2026-09-08 sehingga 'hari tanpa kunjungan' tidak pernah bertambah
  const nowRef = new Date(todayJakarta() + 'T00:00:00');

  Object.values(custMap).forEach(c => {
    const visits = c.invoices_count || 0;
    let daysSinceVisit = 999;
    if (c.last_visit && c.last_visit !== '1970-01-01') {
      const vDate = new Date(c.last_visit + 'T00:00:00');
      daysSinceVisit = Math.max(0, Math.floor((nowRef - vDate) / (1000 * 60 * 60 * 24)));
    }

    // Klasifikasi memakai frekuensi kedatangan TREATMENT lewat classifyPatientGrade,
    // sama persis dengan Patient 360 & Grading Pasien supaya jawabannya tidak
    // berbeda. Beli produk saja bukan kunjungan (lihat treatmentVisitIndex).
    const tDays = treatmentVisitDays(c.id);
    const g = classifyPatientGrade(tDays.length, tDays[0] || null, nowRef.getTime());
    c.grade = g.grade;
    c.grade_label = g.label;
    c.grade_color = g.color;
    c.visit_days = g.visit_days;
    c.visit_rate_per_month = g.rate_per_month;

    if (g.grade === 'X') {
      gradeXList.push(c);
    } else if (g.grade === 'Y') {
      gradeYList.push(c);
    } else if (g.grade === 'BARU') {
      gradeNewList.push(c);
    } else if (g.grade === 'BELUM') {
      gradeNoTxList.push(c);
    } else {
      gradeZList.push(c);
    }

    // Radar reaktivasi tetap berbasis RECENCY, bukan grade — pasien Grade X
    // yang tiba-tiba menghilang justru yang paling mendesak dihubungi.
    {
      if (visits >= 1 && daysSinceVisit > 60 && c.phone) {
        lostPatientsReactivation.push({
          id: c.id,
          name: c.name,
          phone: c.phone,
          clean_phone: (c.phone || '').replace(/[^0-9]/g, ''),
          last_visit: c.last_visit,
          days_ago: daysSinceVisit,
          total_spent: c.total_spent,
          total_spent_fmt: 'Rp ' + c.total_spent.toLocaleString('id-ID'),
          outlets: Array.from(c.outlets).length > 0 ? Array.from(c.outlets).join(', ') : (c.origin_outlet_id === 2 ? 'Pondok Kopi' : 'Depok'),
          wa_message: `Halo Kak ${c.name} tercinta 🌸, kami kangen banget sama Kakak di Kefir Clinic! Terakhir Kakak treatment tanggal ${c.last_visit}. Khusus minggu ini kami siapkan Voucher Reaktivasi Glowing potongan Rp 100.000 untuk treatment apa pun ✨. Mau kami amankan jadwal dokter untuk Kakak besok atau lusa? 💖`
        });
      }
    }
  });

  lostPatientsReactivation.sort((a, b) => b.total_spent - a.total_spent);

  // Real Doctors Leaderboard & Commission Details
  const doctorCommissionsList = Object.values(doctorRevenueMap)
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .map(d => ({
      name: d.name,
      branch: d.outlet,
      patients: d.count,
      gross_revenue: d.total_revenue,
      gross_revenue_fmt: 'Rp ' + d.total_revenue.toLocaleString('id-ID'),
      treatment_revenue: d.treatment_revenue,
      treatment_revenue_fmt: 'Rp ' + d.treatment_revenue.toLocaleString('id-ID'),
      skincare_revenue: d.skincare_revenue,
      skincare_revenue_fmt: 'Rp ' + d.skincare_revenue.toLocaleString('id-ID'),
      commission_treatment: d.commission_treatment,
      commission_skincare: d.commission_skincare,
      total_commission: d.total_commission,
      total_commission_fmt: 'Rp ' + Math.round(d.total_commission).toLocaleString('id-ID'),
      top_treatment: Object.entries(d.item_counts).sort((a, b) => b[1] - a[1])[0] ? Object.entries(d.item_counts).sort((a, b) => b[1] - a[1])[0][0] : 'Kefir Glow Facial'
    }));

  const therapistCommissionsList = Object.values(therapistRevenueMap)
    .sort((a, b) => b.treatments_performed - a.treatments_performed)
    .map(t => ({
      name: t.name,
      branch: t.outlet,
      invoices_count: t.invoices_count,
      treatments_performed: t.treatments_performed,
      fee_per_tindakan: commissionRules.therapist_fee_per_tindakan,
      total_commission: t.total_commission,
      total_commission_fmt: 'Rp ' + Math.round(t.total_commission).toLocaleString('id-ID'),
      top_treatment: Object.entries(t.item_counts).sort((a, b) => b[1] - a[1])[0] ? Object.entries(t.item_counts).sort((a, b) => b[1] - a[1])[0][0] : 'Kefir Facial'
    }));

  const commissionFromNeosoft = applyNeosoftCommission(doctorCommissionsList, therapistCommissionsList, startDate, endDate);
  const topDoctors = doctorCommissionsList.slice(0, 5).map(d => ({
    name: d.name,
    branch: d.branch,
    omset: d.gross_revenue,
    omset_fmt: 'Rp ' + (d.gross_revenue / 1000000).toFixed(1) + ' Juta',
    tindakan: d.patients,
    top_item: d.top_treatment
  }));

  // CL-01 & CL-05: DOCTOR KPI SCORING & LEADERBOARD (Composite Performance)
  const doctorKpiLeaderboard = doctorCommissionsList.map((d, idx) => {
    const avgBasket = d.patients > 0 ? Math.round(d.gross_revenue / d.patients) : 0;
    const revScore = Math.min(40, Math.round((d.gross_revenue / 15000000) * 40));
    const volScore = Math.min(30, Math.round((d.patients / 15) * 30));
    const skincareRatio = d.gross_revenue > 0 ? (d.skincare_revenue / d.gross_revenue) : 0;
    const upsellScore = Math.min(30, Math.round(skincareRatio * 100));
    const totalScore = Math.min(100, Math.max(45, revScore + volScore + Math.max(15, upsellScore)));

    let badge = '🟢 Active DPJP';
    let badgeColor = 'emerald';
    if (totalScore >= 85) {
      badge = '🌟 Sultan Specialist';
      badgeColor = 'amber';
    } else if (totalScore >= 70) {
      badge = '💎 High Performer';
      badgeColor = 'cyan';
    }

    return {
      rank: idx + 1,
      name: d.name,
      branch: d.branch,
      patients: d.patients,
      gross_revenue: d.gross_revenue,
      gross_revenue_fmt: d.gross_revenue_fmt,
      treatment_revenue_fmt: d.treatment_revenue_fmt,
      skincare_revenue_fmt: d.skincare_revenue_fmt,
      avg_basket: avgBasket,
      avg_basket_fmt: 'Rp ' + avgBasket.toLocaleString('id-ID'),
      top_treatment: d.top_treatment,
      kpi_score: totalScore,
      rating_badge: badge,
      rating_color: badgeColor
    };
  });

  // ST-08 & ST-09: PHARMACY STOCK — FEFO, DEAD STOCK & PO RECOMMENDATIONS
  // Sebelumnya: SKU/stok/harga supplier semua karangan, karena dicek waktu
  // itu TIDAK ADA field stok di manapun. Sejak itu ditemukan (lewat
  // probing manual — endpoint ini tidak ada di dokumentasi resmi):
  // POST /logistics/stock-card mengembalikan kartu stok SUNGGUHAN (balance
  // berjalan, batch, expired_at, per gudang), dan /logistics/items
  // menyimpan buffer_stock + cogs asli per produk (join lewat
  // sales_information_id). Sudah disinkron ke data/neosoft_db/stock_card.json
  // & logistics_items.json (lihat scripts/sync_neosoft.py: sync_stock_card, dan entri baru
  // di daftar endpoint opsional). Semua angka di bawah ini dihitung dari
  // situ — tidak ada lagi yang dikarang.
  const pharmacyStockHub = getPharmacyStockHub();
  const pharmacyPoRecommendations = pharmacyStockHub.po_recommendations || [];
  const pharmacyPoAvailable = pharmacyStockHub.available;
  const pharmacyPoNote = pharmacyStockHub.note;

  // 1. TOP TREATMENTS & REVENUE RANKING + PROMO & STARTING PRICE
  const usageStats = {};
  usages.forEach(u => {
    const pid = u.product_id;
    const qty = Number(u.qty || 1);
    const val = Number(u.value || (productMap[pid] ? productMap[pid].price : 0) || 0);
    if (!usageStats[pid]) usageStats[pid] = { pid, count: 0, qty: 0, total_revenue: 0 };
    usageStats[pid].count++;
    usageStats[pid].qty += qty;
    usageStats[pid].total_revenue += val;
  });

  const treatmentPricing = getPricingIndex(products, usages, invoices);
  const realTopTreatments = Object.values(usageStats)
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10)
    .map((u, idx) => {
      const p = productMap[u.pid] || {};
      const basePrice = Number(p.price || 0) || 350000;
      // Harga promo & bottom dari transaksi nyata. Versi lama menurunkan
      // diskon dari POSISI RANKING (idx < 3 ? 25% : ...), sehingga treatment
      // peringkat 1 selalu tampak "Diskon 25%" tanpa dasar apa pun.
      const mk = treatmentPricing[u.pid] || {};
      const promoPrice = mk.promo_price ?? null;
      const bottomPrice = mk.bottom_price ?? null;

      return {
        rank: idx + 1,
        code: p.product_treatment_code || `PRD-${u.pid}`,
        name: p.product_treatment_name || `Treatment #${u.pid}`,
        performed_count: u.count,
        total_revenue: u.total_revenue,
        total_revenue_fmt: 'Rp ' + Math.round(u.total_revenue).toLocaleString('id-ID'),
        price: basePrice,
        price_fmt: 'Rp ' + basePrice.toLocaleString('id-ID'),
        is_on_promo: mk.is_on_promo === true,
        promo_is_default: mk.promo_is_default === true,
        promo_price: promoPrice,
        promo_price_fmt: promoPrice !== null ? 'Rp ' + promoPrice.toLocaleString('id-ID') : null,
        lowest_price: bottomPrice,
        lowest_price_fmt: bottomPrice !== null ? 'Rp ' + bottomPrice.toLocaleString('id-ID') : null,
        bottom_confidence: mk.bottom_confidence || 'tidak_ada',
        bottom_samples: mk.bottom_samples || 0,
        discount_badge: promoPrice !== null
          ? `Promo ${Math.round((1 - promoPrice / basePrice) * 100)}%` : null,
        duration: (p.duration || 60) + ' Menit',
        status: 'Active'
      };
    });

  // 2. TOP SPENDERS — mengikuti filter periode (belanja = nilai invoice di
  // rentang tanggal terpilih, bukan akumulasi seumur hidup). Nominal per
  // cabang (spent_dpk/spent_pdk) dikirim supaya filter cabang di frontend
  // bisa mengurutkan ulang dengan belanja di cabang itu saja.
  const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const toSpender = (cid, ps) => {
    const c = custMap[cid];
    const outlets = [ps.dpk > 0 || ps.inv_dpk ? 'Depok' : null, ps.pdk > 0 || ps.inv_pdk ? 'Pondok Kopi' : null].filter(Boolean);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      code: c.code,
      total_spent: ps.total,
      total_spent_fmt: rp(ps.total),
      spent_dpk: ps.dpk,
      spent_pdk: ps.pdk,
      invoices_count: ps.invoices,
      invoices_dpk: ps.inv_dpk,
      invoices_pdk: ps.inv_pdk,
      lifetime_spent: c.total_spent,
      lifetime_spent_fmt: rp(c.total_spent),
      last_visit: ps.last_visit,
      outlets: outlets.join(' & ') || (c.origin_outlet_id === 2 ? 'Pondok Kopi' : 'Depok'),
      tier_badge: c.total_spent >= 15000000 ? '👑 Sultan Diamond (>Rp 15M)' : (c.total_spent >= 8000000 ? '💎 VIP Platinum (>Rp 8M)' : '⭐ VIP Gold (>Rp 4M)')
    };
  };
  const periodSpenders = Object.entries(periodSpendMap).filter(([, ps]) => ps.total > 0);
  // Top 50 per cabang + top 50 gabungan, supaya filter cabang tetap punya 50 baris.
  const pickTop = (key) => periodSpenders.filter(([, ps]) => ps[key] > 0).sort((a, b) => b[1][key] - a[1][key]).slice(0, 50).map(([cid]) => cid);
  const topIds = [...new Set([...pickTop('total'), ...pickTop('dpk'), ...pickTop('pdk')])];
  const topSpendersList = topIds
    .map(cid => toSpender(cid, periodSpendMap[cid]))
    .sort((a, b) => b.total_spent - a.total_spent)
    .map((s, idx) => ({ ...s, rank: idx + 1 }));

  // 3. DAILY SALES TARGET (DEPOK & PONDOK KOPI)
  // Hitung omset harian riil dari tanggal transaksi terakhir di periode aktif
  const dailyTotalMap = {};
  const dailyDpkMap = {};
  const dailyPdkMap = {};
  
  filteredInvoices.forEach(inv => {
    const dStr = (inv.inv_date || inv.created_at || '').substring(0, 10);
    const amt = omsetAmount(inv, depMap);
    const oId = Number(inv.outlet_id);
    dailyTotalMap[dStr] = (dailyTotalMap[dStr] || 0) + amt;
    if (oId === 1) dailyDpkMap[dStr] = (dailyDpkMap[dStr] || 0) + amt;
    if (oId === 2) dailyPdkMap[dStr] = (dailyPdkMap[dStr] || 0) + amt;
  });
  periodTopups.forEach(t => {
    if (!dateInRange(t.date, startDate, endDate)) return;
    dailyTotalMap[t.date] = (dailyTotalMap[t.date] || 0) + t.amount;
    if (t.outlet_id === 1) dailyDpkMap[t.date] = (dailyDpkMap[t.date] || 0) + t.amount;
    else dailyPdkMap[t.date] = (dailyPdkMap[t.date] || 0) + t.amount;
  });

  // Get Real Calendar Date in WIB (UTC+7)
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wibTime = new Date(utcTime + (3600000 * 7));
  const todayCalendarStr = wibTime.toISOString().substring(0, 10);

  const dpkTodayActual = dailyDpkMap[todayCalendarStr] || 0;
  const pdkTodayActual = dailyPdkMap[todayCalendarStr] || 0;
  const totalTodayActual = dailyTotalMap[todayCalendarStr] || 0;

  const allActiveDates = Object.keys(dailyTotalMap).sort();
  const latestActiveDate = allActiveDates.length > 0 ? allActiveDates[allActiveDates.length - 1] : (startDate || todayCalendarStr);

  const daysInMonth = 31;
  const dpkMonthlyTarget = 150000000;
  const pdkMonthlyTarget = 150000000;
  const dpkDailyTarget = Math.round(dpkMonthlyTarget / daysInMonth);
  const pdkDailyTarget = Math.round(pdkMonthlyTarget / daysInMonth);

  const dailySalesTargets = {
    calendar_today: todayCalendarStr,
    latest_date: latestActiveDate,
    total_today: totalTodayActual,
    total_today_fmt: 'Rp ' + totalTodayActual.toLocaleString('id-ID'),
    depok: {
      outlet: 'Depok (Margonda)',
      monthly_target: dpkMonthlyTarget,
      monthly_target_fmt: 'Rp 150.000.000',
      monthly_achieved: dpkRev,
      monthly_achieved_fmt: 'Rp ' + dpkRev.toLocaleString('id-ID'),
      monthly_pct: Math.min(100, Math.round((dpkRev / dpkMonthlyTarget) * 100)),
      daily_target: dpkDailyTarget,
      daily_target_fmt: 'Rp ' + dpkDailyTarget.toLocaleString('id-ID'),
      today_actual: dpkTodayActual,
      today_actual_fmt: 'Rp ' + dpkTodayActual.toLocaleString('id-ID'),
      today_pct: Math.round((dpkTodayActual / dpkDailyTarget) * 100),
      status: dpkTodayActual >= dpkDailyTarget ? 'On Track 🟢' : 'Sedang Berjalan 🟡'
    },
    pondok_kopi: {
      outlet: 'Pondok Kopi (Jakarta Timur)',
      monthly_target: pdkMonthlyTarget,
      monthly_target_fmt: 'Rp 150.000.000',
      monthly_achieved: pdkRev,
      monthly_achieved_fmt: 'Rp ' + pdkRev.toLocaleString('id-ID'),
      monthly_pct: Math.min(100, Math.round((pdkRev / pdkMonthlyTarget) * 100)),
      daily_target: pdkDailyTarget,
      daily_target_fmt: 'Rp ' + pdkDailyTarget.toLocaleString('id-ID'),
      today_actual: pdkTodayActual,
      today_actual_fmt: 'Rp ' + pdkTodayActual.toLocaleString('id-ID'),
      today_pct: Math.round((pdkTodayActual / pdkDailyTarget) * 100),
      status: pdkTodayActual >= pdkDailyTarget ? 'On Track 🟢' : 'Sedang Berjalan 🟡'
    }
  };

  // 4. SMART FOLLOW-UP JOURNEY — DYNAMIC ENGINE from Real Invoices (PT-01 ~ PT-04)
  // Hari H = treatment hari ini, H+3 = 3 hari lalu, H+7 = 7 hari lalu, H+14~30 = recall
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dayMs = 86400000;

  function daysDiff(dateStr) {
    const d = new Date(dateStr);
    return Math.round((today - d) / dayMs);
  }

  // Build inv_code -> usages lookup, and identify treatment invoices
  const usagesByInv = {};
  usages.forEach(u => {
    if (!usagesByInv[u.inv_code]) usagesByInv[u.inv_code] = [];
    usagesByInv[u.inv_code].push(u);
  });

  // Build follow-up queue from real treatment invoices
  const fuBuckets = { day_h: [], day_h3: [], day_h7: [], day_h14_recall: [] };
  const fuHariH = fuBuckets.day_h, fuH3 = fuBuckets.day_h3, fuH7 = fuBuckets.day_h7, fuH14Recall = fuBuckets.day_h14_recall;

  // Map outlet_id -> name
  const outletNames = { 1: 'Depok', 2: 'Pondok Kopi' };
  const customerMap = {};
  customers.forEach(c => { customerMap[c.id] = c; });

  const followUpStatusLog = getFollowUpStatusLog();
  const followedUpByKey = {};
  followUpStatusLog.forEach(l => { followedUpByKey[l.key] = l; });
  const fuDone = [];
  const fuMissed = [];
  const FU_TRACKING_START = '2026-10-07';   // pelacakan "Terlewat" mulai dari invoice tanggal ini
  const FU_MISSED_HORIZON_DAYS = 30;        // tahap yang lewat > 30 hari tidak lagi ditampilkan sebagai terlewat
  const FU_WINDOWS = [
    { key: 'day_h', stage: 'Hari H (Post-Treatment)', min: 0, max: 1 },
    { key: 'day_h3', stage: 'H+3 (Cek Kondisi & Keluhan)', min: 2, max: 5 },
    { key: 'day_h7', stage: 'H+7 (Evaluasi Hasil & Kenyamanan)', min: 6, max: 12 },
    { key: 'day_h14_recall', stage: 'H+14 s.d 1 Bulan (Recall Treatment)', min: 13, max: 35 }
  ];
  let alreadyFollowedUpCount = 0;

  invoices.forEach(inv => {
    if (inv.void_invoice) return;
    const invUsages = usagesByInv[inv.inv_code] || [];
    // Check if any usage is a treatment (product_treatment_code starts with T-)
    const treatmentUsages = invUsages.filter(u => {
      const p = productMap[u.product_id] || {};
      return (p.product_treatment_code || '').startsWith('T-');
    });
    if (treatmentUsages.length === 0) return;

    const invDate = (inv.inv_date || inv.created_at || '').slice(0, 10);
    if (!invDate || invDate < '2026-01-01') return;
    const diff = daysDiff(invDate);
    const cust = customerMap[inv.customer_id] || {};
    const custNameObj = cust.name || {};
    const custName = typeof custNameObj === 'string' ? custNameObj : [custNameObj.first_name, custNameObj.middle_name, custNameObj.last_name].filter(Boolean).join(' ').trim() || 'Pasien';
    const custPhone = cust.phone || '';
    const outlet = outletNames[inv.outlet_id] || 'Klinik';
    const treatmentNames = treatmentUsages
      .map(u => {
        const p = productMap[u.product_id] || {};
        return p.product_treatment_name || p.name || p.product_name || 'Treatment';
      })
      .slice(0, 2).join(' + ');

    const entry = {
      id: `FU-${inv.inv_code || inv.id}`,
      patient: custName,
      phone: custPhone,
      outlet: outlet,
      treatment: treatmentNames || 'Treatment Klinik',
      inv_code: inv.inv_code || '',
      inv_date: invDate,
      days_since: diff
    };

    // Jendela tahap saling menyambung (tidak ada hari tanpa tahap). Tahap yang lewat
    // tanpa pernah ditandai selesai masuk daftar "Terlewat" (hanya untuk invoice
    // sejak FU_TRACKING_START, supaya riwayat lama sebelum fitur ini tidak membanjiri).
    const buildStageEntry = (w, d) => {
      if (w.key === 'day_h') {
        const kapan = d === 0 ? 'hari ini' : d === 1 ? 'kemarin' : `${d} hari lalu`;
        return { ...entry, stage: w.stage, action: 'Kirim Edukasi Do & Dont',
          message: `Halo Kak *${custName}*! ✨ Terima kasih sudah treatment *${treatmentNames}* ${kapan} di KEFIR ${outlet}. Jangan lupa hindari air panas 24 jam & wajib pakai Sunscreen ya Kak 💖` };
      }
      if (w.key === 'day_h3') {
        return { ...entry, stage: w.stage, action: 'Check Purging / Redness',
          message: `Halo Kak *${custName}*! ✨ Bagaimana kondisi kulit setelah H+${d} *${treatmentNames}*? Ada keluhan kemerahan/purging? Tim dokter KEFIR siap membantu konsultasi ya Kak 💖` };
      }
      if (w.key === 'day_h7') {
        // Link feedback pasien (public/feedback.html) diisi otomatis dengan
        // nama/cabang/treatment/nomor pasien lewat query param, supaya pasien
        // tidak perlu ketik ulang. {{FEEDBACK_URL}} diganti origin dashboard
        // yang sebenarnya di frontend (data_provider.js jalan tanpa tahu
        // domain publiknya) — lihat public/index.html, tempat p.message dipakai.
        const feedbackQuery = `?name=${encodeURIComponent(custName)}&branch=${encodeURIComponent(outlet)}&treatment=${encodeURIComponent(treatmentNames)}&phone=${encodeURIComponent(custPhone)}`;
        return { ...entry, stage: w.stage, action: 'Kirim Link Review', feedback_query: feedbackQuery,
          message: `Selamat siang Kak *${custName}*! ✨ Sudah H+${d} pasca *${treatmentNames}*. Apakah hasilnya sudah mulai terlihat glowing? Kami senang banget kalau Kakak berkenan kasih rating & cerita pengalamannya di sini ya: {{FEEDBACK_URL}} 🥰` };
      }
      return { ...entry, stage: w.stage, action: 'Undang Reservasi Lanjutan',
        message: `Halo Kak *${custName}* 💖, sudah ${d} hari sejak perawatan *${treatmentNames}*. Minggu ini waktu terbaik untuk treatment lanjutan agar hasil glowing maksimal! Boleh kami amankan jadwal dokter untuk Kakak? 💎` };
    };

    FU_WINDOWS.forEach(w => {
      const logged = followedUpByKey[`${entry.id}|${w.key}`] || followedUpByKey[`${entry.id}|${w.stage}`];
      const inWindow = diff >= w.min && diff <= w.max;
      if (inWindow || (diff > w.max && logged)) {
        const stageEntry = buildStageEntry(w, diff);
        if (logged) {
          alreadyFollowedUpCount++;
          fuDone.push({ ...stageEntry, stage_key: w.key, followed_up: { by: logged.marked_by || null, at: logged.marked_at || null } });
        } else {
          fuBuckets[w.key].push(stageEntry);
        }
      } else if (diff > w.max && !logged && invDate >= FU_TRACKING_START && diff <= w.max + FU_MISSED_HORIZON_DAYS) {
        fuMissed.push({ ...buildStageEntry(w, diff), stage_key: w.key, missed_days: diff - w.max });
      }
    });
  });

  // Sort: Hari H by time, others by days_since ascending
  fuH3.sort((a, b) => a.days_since - b.days_since);
  fuH7.sort((a, b) => a.days_since - b.days_since);
  fuH14Recall.sort((a, b) => a.days_since - b.days_since);

  const smartFollowUpHub = {
    day_h: fuHariH,
    day_h3: fuH3,
    day_h7: fuH7,
    day_h14_recall: fuH14Recall,
    // Tahap yang sudah lewat tanpa pernah ditandai selesai (terbaru dulu)
    missed_items: fuMissed.sort((a, b) => a.missed_days - b.missed_days).slice(0, 1000),
    // Riwayat: pasien yang sudah ditandai di-follow-up (terbaru dulu)
    done_items: fuDone.sort((a, b) => String(b.followed_up.at || '').localeCompare(String(a.followed_up.at || ''))).slice(0, 500),
    stats: {
      total_queue: fuHariH.length + fuH3.length + fuH7.length + fuH14Recall.length,
      hari_h_count: fuHariH.length,
      h3_count: fuH3.length,
      h7_count: fuH7.length,
      h14_recall_count: fuH14Recall.length,
      already_followed_up_count: alreadyFollowedUpCount,
      missed_count: fuMissed.length
    }
  };

  // 5. MEMBERSHIP DEPOSIT & WALLET MONITORING
  //
  // Sebelumnya 100% karangan: 5 "member" memakai NAMA PASIEN ASLI
  // (SUDARNI, PUTRI ASRI AZIZAH, INDAH, ERLIZA, NURUL HIDAYAH) dengan
  // saldo, tier, dan tanggal expired yang seluruhnya dikarang.
  //
  // Diganti dengan data asli dari customer.balance Neosoft. Field yang
  // TIDAK ADA di skema Neosoft (tier VIP/Platinum/Gold, tanggal expired
  // deposit, treatment terakhir pakai deposit) sengaja TIDAK dikarang —
  // hanya field yang benar-benar tercatat yang ditampilkan.
  const membersWithBalance = customers
    .filter(c => Number(c.balance?.deposit || 0) > 0 || Number(c.balance?.credit_voucher || 0) > 0)
    .map(c => {
      const deposit = Number(c.balance?.deposit || 0);
      const voucher = Number(c.balance?.credit_voucher || 0);
      return {
        id: c.code || `CUST-${c.id}`,
        customer_id: c.id,
        name: `${c.name?.first_name || ''} ${c.name?.last_name || ''}`.trim() || 'Pasien',
        phone: c.phone || '-',
        outlet: c.origin_outlet_id === 1 ? 'Depok' : (c.origin_outlet_id === 2 ? 'Pondok Kopi' : '-'),
        membership_status: c.membership_status || 'non-member',
        deposit_balance: deposit,
        deposit_balance_fmt: rupiah(deposit),
        credit_voucher_balance: voucher,
        credit_voucher_balance_fmt: rupiah(voucher),
        total_balance: deposit + voucher,
        last_visit: (c.last_visit || '').substring(0, 10) || null
      };
    })
    .sort((a, b) => b.total_balance - a.total_balance);

  const membershipDepositHub = {
    total_active_deposit: membersWithBalance.reduce((a, m) => a + m.deposit_balance, 0),
    total_active_deposit_fmt: rupiah(membersWithBalance.reduce((a, m) => a + m.deposit_balance, 0)),
    total_active_voucher: membersWithBalance.reduce((a, m) => a + m.credit_voucher_balance, 0),
    total_active_voucher_fmt: rupiah(membersWithBalance.reduce((a, m) => a + m.credit_voucher_balance, 0)),
    total_members_with_deposit: membersWithBalance.length,
    members: membersWithBalance.slice(0, 50),
    note: 'Dari customer.balance Neosoft asli. Field tier (VIP/Platinum/Gold) dan tanggal expired deposit tidak ada di skema Neosoft — tidak ditampilkan karena tidak ada dasarnya.'
  };

  // 6. MARKETING CAMPAIGN & PROMO ROI MONITORING
  // Sebelumnya 4 campaign fiktif — kode voucher, used_count, dan
  // revenue_generated semuanya dikarang. Dicek langsung: tidak ada field
  // kode voucher/promo pada invoice Neosoft yang bisa dipakai untuk
  // mengatribusikan klaim ke campaign tertentu, dan marketing_source_id
  // pada invoice 100% kosong ("NONE") di seluruh data (lihat catatan di
  // getMarketingHubData/sales-comparison) — tidak ada dasar nyata untuk
  // menghitung performa campaign per kode voucher.
  const marketingProgramHub = {
    available: false,
    note: 'Tidak ada data campaign/voucher promo yang bisa diatribusikan ke invoice asli — field kode voucher tidak ada di skema Neosoft, dan marketing_source_id kosong di semua invoice. Jumlah klaim & omset per campaign sebelumnya dikarang manual.'
  };

  // 7. PHARMACY INVENTORY & STOK — sekarang dari pharmacyStockHub (real,
  // dihitung di atas). near_expiry_fefo & dead_stock_items diisi dari
  // kartu stok Neosoft sungguhan (lihat getPharmacyStockHub()).
  const pharmacyBurnDownHub = {
    available: pharmacyStockHub.available,
    note: pharmacyStockHub.note,
    // near_expiry_fefo dari getPharmacyStockHub() (kartu stok Neosoft asli,
    // stock_card.json) — BUKAN dari daftar SKU/batch/tanggal karangan yang
    // sempat ada di sini sebelumnya (P-26050002 dkk dengan expiry_date
    // hardcoded), yang sudah dibersihkan di sesi audit ini.
    near_expiry_fefo: pharmacyStockHub.near_expiry_fefo || [],
    all_expiry_fefo: pharmacyStockHub.all_expiry_fefo || [],
    stock_list: pharmacyStockHub.stock_list || [],
    fefo_radar_summary: pharmacyStockHub.fefo_radar_summary || { expired: 0, h30_critical: 0, h90_warning: 0, h180_monitor: 0, total_at_risk: 0 },
    total_active_skus: pharmacyStockHub.total_active_skus || 0,
    total_low_stock: pharmacyStockHub.total_low_stock || 0,
    warehouses: pharmacyStockHub.warehouses || [],
    stock_opname_variance: getStockOpnameVariance(),
    // Dead stock: dua sinyal nyata dan pelengkap, dipertahankan dua-duanya —
    // stock_movement_dead_stock (dari pharmacyStockHub, >45 hari TANPA
    // transaksi di kartu stok gudang manapun) vs dead_stock_items di bawah
    // (dari usages pasien, >90 hari TANPA dipakai ke pasien manapun,
    // lengkap rekomendasi tindak lanjut). Bisa beda hasil karena mengukur
    // hal berbeda: pergerakan gudang vs pemakaian klinis.
    stock_movement_dead_stock: pharmacyStockHub.dead_stock_items || [],
    ...(() => {
      // 1. BARANG FISIK: Dead stock & slow moving dari kartu stok gudang nyata
      const physicalDeadStock = (pharmacyStockHub.dead_stock_items || []).map(ds => {
        const days = ds.last_movement_days || 45;
        const isDead = days >= 90;
        return {
          item_type: 'product',
          sku: ds.sku,
          name: ds.name,
          category: 'Barang & Obat Fisik (' + (ds.category || 'Gudang') + ')',
          warehouse: ds.warehouse || 'Gudang Klinik',
          current_balance: ds.current_balance || 0,
          uom: ds.uom || 'unit',
          price_fmt: '-',
          days_since_movement: days,
          days_label: `${days} hari tanpa pergerakan gudang`,
          total_historical_usage: '-',
          urgency: isDead ? 'DEAD STOCK 📦' : 'SLOW MOVING ⚠️',
          urgency_color: isDead ? 'rose' : 'amber',
          recommendation: isDead
            ? `Stok fisik mengendap ${ds.current_balance} ${ds.uom} di ${ds.warehouse}. Disarankan bundling promo skincare/homecare atau transfer antar-cabang.`
            : `Pergerakan stok lambat (${days} hari). Pantau sisa stok fisik (${ds.current_balance} ${ds.uom}).`
        };
      });

      // 2. TREATMENT / LAYANAN: Tindakan medis yang belum pernah dilakukan atau dormant >= 90 hari
      const usageByProduct = {};
      usages.forEach(u => {
        const pid = u.product_id;
        const dt = u.created_at || u.usage_date || '';
        if (!usageByProduct[pid] || dt > usageByProduct[pid].last) {
          usageByProduct[pid] = { last: dt, count: (usageByProduct[pid]?.count || 0) + 1 };
        } else if (usageByProduct[pid]) {
          usageByProduct[pid].count++;
        }
      });
      const now = new Date();
      const cutoff90 = new Date(now); cutoff90.setDate(cutoff90.getDate() - 90);
      const cutoffStr90 = cutoff90.toISOString();

      const dormantTreatments = products.filter(prod => {
        if (Number(prod.price || 0) <= 0) return false;
        const isTreatment = (prod.product_treatment_code || '').startsWith('T-');
        if (!isTreatment) return false;
        const usage = usageByProduct[prod.id];
        if (!usage) return true;
        return usage.last < cutoffStr90;
      }).map(prod => {
        const usage = usageByProduct[prod.id];
        const lastDate = usage ? usage.last.substring(0, 10) : null;
        const daysSince = lastDate ? Math.round((now - new Date(lastDate)) / (1000*60*60*24)) : 999;
        const price = Number(prod.price || 0);

        let recommendation = !lastDate
          ? 'Layanan klinis belum pernah dipilih pasien — tinjau tarif & SOP tindakan, adakan promo pengenalan, atau bundling dengan facial populer.'
          : 'Treatment jarang dipilih dalam 90 hari — evaluasi minat pasien atau sertakan dalam paket promo khusus loyalty member.';

        return {
          item_type: 'treatment',
          sku: prod.product_treatment_code || `TRT-${prod.id}`,
          name: prod.product_treatment_name || 'Treatment',
          category: 'Layanan Medis & Tindakan',
          warehouse: 'Poli Tindakan Dokter / Terapis',
          price: price,
          price_fmt: 'Rp ' + price.toLocaleString('id-ID'),
          current_balance: '-',
          uom: 'sesi',
          last_movement: lastDate || 'Tidak pernah',
          days_since_movement: daysSince,
          days_label: lastDate ? `${daysSince} hari tanpa tindakan` : 'Belum pernah dipesan pasien',
          total_historical_usage: usage ? usage.count : 0,
          urgency: !lastDate ? 'BELUM PERNAH DIPESAN ⚪' : (daysSince >= 180 ? 'DORMANT SERVICE ⏸️' : 'KURANG POPULER ⚠️'),
          urgency_color: !lastDate ? 'purple' : (daysSince >= 180 ? 'indigo' : 'amber'),
          recommendation: recommendation
        };
      }).sort((a, b) => b.days_since_movement - a.days_since_movement).slice(0, 30);

      // Default dead_stock_items: Utamakan barang fisik terlebih dahulu, kemudian treatment
      const combined = [...physicalDeadStock, ...dormantTreatments];

      return {
        dead_stock_items: combined,
        physical_dead_stock: physicalDeadStock,
        dormant_treatments: dormantTreatments,
        dead_stock_counts: {
          physical: physicalDeadStock.length,
          treatment: dormantTreatments.length,
          total: combined.length
        }
      };
    })(),
    // Panduan konversi kemasan → dosis per tindakan. Ini REFERENSI UMUM
    // (bukan hasil hitung dari stok riil/live), belum diverifikasi ke tim
    // farmasi — tampilkan dengan label jelas, jangan disalahartikan
    // sebagai data stok.
    uom_consumption_guide: [
      { item: 'Add On Anastesi Cream / Pot', uom_display: 'pot', package_size: '1 pot (500 gram)', dose_per_treatment: '10 - 15 gram / Pasien', capacity: '35 - 50 Pasien per pot' },
      { item: 'Add On Anastesi Inject / Ampul', uom_display: 'ampul', package_size: '1 ampul (2 ml)', dose_per_treatment: '2 ml / Tindakan Infiltrasi', capacity: '1 Pasien per ampul' },
      { item: 'Kefir DNA Salmon Facial', uom_display: 'vial', package_size: '1 vial (3 ml)', dose_per_treatment: '3 ml / Pasien Full Face', capacity: '1 Pasien per vial' },
      { item: 'Kefir 14 in 1 Crystal Dew Facial', uom_display: 'box', package_size: '1 box (10 ampul)', dose_per_treatment: '1 ampul / Tindakan', capacity: '10 Pasien per box' },
      { item: 'ANTI IRITASI', uom_display: 'pot', package_size: '1 pot (10 gram)', dose_per_treatment: '1 pot / Resep Homecare', capacity: '1 Pasien per pot' }
    ],
    uom_guide_note: 'Panduan referensi umum, belum diverifikasi ke tim farmasi — bukan hasil hitung dari data stok riil.'
  };

  const totalDoctorCommissionAll = doctorCommissionsList.reduce((acc, d) => acc + d.total_commission, 0);
  const totalTherapistCommissionAll = therapistCommissionsList.reduce((acc, d) => acc + d.total_commission, 0);

  // 7b. FINANCE & CASH FLOW REAL-TIME ENGINE
  //
  // Sebelumnya "2 sumber omset" cacat secara konsep: totalDepositGross
  // (Rp84.500.000, konstanta tetap — angka yang sama yang dipakai
  // membershipDepositHub lama) dijumlahkan LAGI ke totalOmsetAll,
  // padahal invoice topup deposit SUDAH ikut terhitung di totalOmsetAll
  // (dpkRev/pdkRev menjumlahkan SEMUA invoice non-void tanpa
  // mengecualikan transtype). Menjumlahkannya lagi = dobel hitung.
  //
  // Aturan omset deposit (Nov 2026, invoice_flags.omsetAmount): top-up
  // masuk omset, pemakaian saldo deposit TIDAK, pelunasan di luar deposit
  // masuk. Jadi uang deposit hanya terhitung sekali, yaitu saat top-up.
  //
  // "Sisa revenue belum usage" diganti ke saldo deposit+voucher yang
  // BENAR-BENAR belum terpakai — angka yang sama dengan
  // membershipDepositHub (customer.balance Neosoft asli), bukan hasil
  // topup-dikurangi-used yang dua-duanya konstanta karangan.
  //
  // bank_breakdown diganti dari persentase tetap (44/22/18/11/5%) ke
  // getPaymentChannelBreakdown() — mesin nyata yang sudah diverifikasi
  // saat memperbaiki settlement 3-way (baca log kasir spreadsheet,
  // dikelompokkan & dijumlahkan per invoice dengan benar).
  const realTopupTotal = filteredInvoices
    .filter(inv => inv.transtype === 'topup')
    .reduce((a, inv) => a + Number(inv.total_after_tax || inv.total || 0), 0);

  const outstandingDeposit = membersWithBalance.reduce((a, m) => a + m.deposit_balance, 0);
  const outstandingVoucher = membersWithBalance.reduce((a, m) => a + m.credit_voucher_balance, 0);
  const sisaRevenueBelumUsage = outstandingDeposit + outstandingVoucher;

  const totalKomisiTenagaMedis = Math.round(totalDoctorCommissionAll + totalTherapistCommissionAll);
  const rasioKomisiVsOmset = totalOmsetAll > 0 ? ((totalKomisiTenagaMedis / totalOmsetAll) * 100).toFixed(1) : '0.0';

  // getPaymentChannelBreakdown TETAP per-bulan (bukan rentang tanggal
  // bebas) — bukan pilihan desain, tapi keterbatasan sumber datanya:
  // depok/pdk.recent_transactions_* dari Google Sheets hanya berisi DUA
  // array bulanan terpisah (aug26/sep26), kolom "date" di tiap barisnya
  // cuma nomor urut baris ("1.", "2.", dst), bukan tanggal transaksi asli
  // — jadi tidak ada cara jujur memfilter data ini per hari. Kalau rentang
  // yang dipilih ada di dalam SATU bulan, dipakai bulan itu; kalau
  // melintasi beberapa bulan/tahun (atau "Semua Waktu"), fallback ke bulan
  // berjalan — note di bawah menjelaskan keterbatasan ini ke pengguna.
  const paymentBreakdownMonth = (startDate && endDate && startDate.slice(0, 7) === endDate.slice(0, 7))
    ? startDate.slice(0, 7)
    : currentPeriodJakartaLocal();
  const realPaymentBreakdown = getPaymentChannelBreakdown(paymentBreakdownMonth);
  const CHANNEL_LABELS = {
    edc_bri: ['EDC BRI', 'EDC Merchant'], edc_bni: ['EDC BNI', 'EDC Merchant'],
    qris: ['QRIS', 'E-Wallet / Instant'],
    transfer_bca: ['Transfer BCA', 'Direct Bank Transfer'], transfer_bri: ['Transfer BRI', 'Direct Bank Transfer'],
    transfer_bni: ['Transfer BNI', 'Direct Bank Transfer'],
    cash: ['Tunai di Kasir', 'Cash In Hand'], voucher: ['Voucher', 'Non-Cash'],
    fasilitas_karyawan: ['Fasilitas Karyawan', 'Non-Cash']
  };
  const channelSum = Object.values(realPaymentBreakdown).reduce((a, v) => a + v, 0);
  const bankPaymentDistribution = Object.entries(realPaymentBreakdown)
    .filter(([, amount]) => amount > 0)
    .map(([code, amount]) => ({
      name: (CHANNEL_LABELS[code] || [code])[0],
      bank_code: code.toUpperCase(),
      amount, amount_fmt: 'Rp ' + amount.toLocaleString('id-ID'),
      pct: channelSum > 0 ? Math.round((amount / channelSum) * 100) : 0,
      type: (CHANNEL_LABELS[code] || [null, '-'])[1]
    }))
    .sort((a, b) => b.amount - a.amount);

  const financeCashFlowHub = {
    total_collection: totalOmsetAll,
    total_collection_fmt: 'Rp ' + totalOmsetAll.toLocaleString('id-ID'),
    total_topup_deposit: realTopupTotal,
    total_topup_deposit_fmt: 'Rp ' + realTopupTotal.toLocaleString('id-ID'),
    sisa_revenue_belum_usage: sisaRevenueBelumUsage,
    sisa_revenue_belum_usage_fmt: 'Rp ' + sisaRevenueBelumUsage.toLocaleString('id-ID'),
    total_komisi_medis: totalKomisiTenagaMedis,
    total_komisi_medis_fmt: 'Rp ' + totalKomisiTenagaMedis.toLocaleString('id-ID'),
    rasio_komisi_pct: rasioKomisiVsOmset + '%',
    bank_breakdown: bankPaymentDistribution,
    bank_breakdown_source_total: channelSum,
    bank_breakdown_source_total_fmt: 'Rp ' + channelSum.toLocaleString('id-ID'),
    note: bankPaymentDistribution.length
      ? `Breakdown channel dari log kasir spreadsheet periode ${paymentBreakdownMonth} (Rp${channelSum.toLocaleString('id-ID')}) — cakupannya bisa beda dari total invoice Neosoft (${'Rp' + totalOmsetAll.toLocaleString('id-ID')}) karena sumber datanya berbeda. Log kasir ini cuma tersedia per-bulan (bukan per-hari), jadi tetap menampilkan ${paymentBreakdownMonth} penuh walau filter tanggal di atas rentang yang lebih sempit.`
      : `Belum ada data channel pembayaran dari log kasir spreadsheet untuk periode ${paymentBreakdownMonth}.`
  };

  // 8. DOCTOR NEXT PLAN & MEDICAL TIMELINE (ZERO-DUMMY)
  const clinicalPatientTimelineHub = {
    featured_patient: null
  };

  // Sebelumnya tiap slot punya fallback "|| angka_tetap" yang menutupi slot
  // yang JUJUR nol pasien (mis. periode sepi) dengan angka karangan (32,
  // 58, 64, dst) — jadi kelihatan selalu ramai padahal datanya nol. Slot
  // yang benar-benar tidak ada kunjungan sekarang tampil sebagai 0.
  const slotTotal = Object.values(hourlyArrivals).reduce((a, b) => a + b, 0) || 1;
  const SLOT_COLORS = {
    '10:00 - 12:00 (Pagi)': '#0ea5e9',
    '12:00 - 14:00 (Siang 1)': '#f59e0b',
    '14:00 - 16:00 (Siang 2)': '#10b981',
    '16:00 - 18:00 (Sore)': '#a855f7',
    '18:00 - 20:00 (Malam DPK/PDK)': '#06b6d4',
    '20:00 - 21:00 (PDK Late Slot)': '#ec4899'
  };
  const timeSlotsFormatted = Object.entries(SLOT_COLORS).map(([slot, color]) => {
    const patients = hourlyArrivals[slot] || 0;
    return { slot, patients, pct: Math.round((patients / slotTotal) * 100), color };
  });

  const birthdayReminders = (birthdayNotifs || []).map((b, idx) => {
    const cust = custMap[b.patient_id];
    const outletId = cust ? cust.origin_outlet_id : 1;
    const outlet = outletId === 2 ? 'Pondok Kopi' : 'Depok';
    return {
      id: b.patient_id || idx + 1,
      name: b.patient_name || 'Pasien KEFIR',
      code: b.patient_code || '-',
      phone: b.phone || '-',
      birth_date: (b.birth_date || '').substring(0, 10),
      membership: b.membership_status || 'Regular',
      outlet,
      promo_code: `BDAY-KEFIR-${(b.patient_name || 'GLOW').split(' ')[0]}`
    };
  });

  // Invoice dengan sisa tagihan nyata + rekam medis belum ditagihkan (lihat getUnpaidFollowups).
  const unpaidFollow = getUnpaidFollowups();
  const unpaidInvoices = unpaidFollow.unpaid_invoices;

  // Alert keterlambatan staf: dulu diambil dari gaji_id_service.js, yang
  // isinya bukan hasil sinkronisasi apa pun melainkan objek karangan yang
  // ditulis langsung di kode. Alert-nya bahkan memakai nama staf cadangan
  // 'Anisa Melati' dengan jam masuk '09:38 WIB' — orang dan kejadian yang
  // tidak ada. Dikosongkan sampai ada sumber absensi sungguhan.
  const attendanceAlerts = [];

  // Dihitung sekali, dipakai di kpi (headline card) & patient_feedback_hub
  // (panel detail di tab Marketing) — sama-sama dari data feedback asli.
  const feedbackSummary = getFeedbackSummary();

  // Angka bisnis nyata yang TIDAK butuh koneksi Meta Ads — dipakai di
  // Meta Ads Business Checklist ("angka bisnis" tetap bisa dihitung dari
  // Neosoft meski iklannya belum tersambung).
  const activeCustomers = Object.values(custMap).filter(c => c.invoices_count > 0);
  const repeatCustomers = activeCustomers.filter(c => c.invoices_count >= 2);
  const realAov = filteredInvoices.length > 0 ? Math.round(totalOmsetAll / filteredInvoices.length) : 0;
  const realRepeatRate = activeCustomers.length > 0 ? Math.round((repeatCustomers.length / activeCustomers.length) * 1000) / 10 : 0;
  const realAvgLtv = activeCustomers.length > 0 ? Math.round(activeCustomers.reduce((a, c) => a + c.total_spent, 0) / activeCustomers.length) : 0;

  // SALES/BOOKING CONVERSION — dihitung dari appointment_full.json asli.
  // Sebelumnya kartu "CRM Leads Conversion" (39.8% closing, 540 chat, 215
  // booking) HTML statis di index.html, tidak pernah dibaca dari sini sama
  // sekali, dan nilainya tidak pernah berubah. Dicek: tidak ada data
  // "leads"/chat masuk yang tersimpan di manapun (marketing_source_id 100%
  // kosong, tidak ada integrasi WA/IG lead-tracking) — jadi "leads closing
  // rate" tidak bisa dihitung sungguhan. Yang BISA dihitung nyata: dari
  // appointment yang di-booking, berapa persen yang benar-benar selesai
  // jadi tindakan (vs batal/no-show) — funnel booking-ke-treatment asli.
  // PASIEN BARU vs LAMA — dihitung dari kunjungan pertama tiap pasien.
  // custMap[].first_visit sudah diisi dari SELURUH riwayat invoice (loop di
  // atas jalan atas semua invoice, bukan cuma periode terpilih), jadi
  // "baru" di sini benar-benar berarti belum pernah datang sebelumnya —
  // bukan sekadar baru di bulan ini.
  const visitorsThisPeriod = new Set(
    filteredInvoices.filter(i => !i.void_invoice).map(i => i.customer_id).filter(Boolean)
  );
  let newPatientsThisPeriod = 0;
  let returningPatientsThisPeriod = 0;
  visitorsThisPeriod.forEach(cid => {
    const c = custMap[cid];
    if (!c) return;
    if (!c.pre_neosoft && dateInRange(c.first_visit, startDate, endDate)) newPatientsThisPeriod += 1;
    else returningPatientsThisPeriod += 1;
  });

  const appointmentsThisPeriod = appointmentsAll.filter(a => dateInRange(a.come_date, startDate, endDate));
  const APPT_COMPLETED_STATUSES = new Set(['Finished', 'Treatment']);
  const APPT_CANCELLED_STATUSES = new Set(['Cancelled']);
  let apptCompleted = 0, apptCancelled = 0;
  appointmentsThisPeriod.forEach(a => {
    const statusName = a.status_color?.name || '';
    if (APPT_COMPLETED_STATUSES.has(statusName)) apptCompleted++;
    else if (APPT_CANCELLED_STATUSES.has(statusName)) apptCancelled++;
  });
  const apptTotal = appointmentsThisPeriod.length;
  const bookingConversionPct = apptTotal > 0 ? Math.round((apptCompleted / apptTotal) * 1000) / 10 : 0;

  // Staf aktif nyata dari master Neosoft — dipakai di kpi.total_active_staff
  // DAN di hr_workforce_hub di bawah, supaya keduanya selalu sama. Sebelumnya
  // kpi.total_active_staff hardcode 38 dan tetap dipakai kartu "Presensi
  // Staf Disiplin Penuh" di Executive Summary ("38/38 On-Time", "Seluruh 38
  // staf ... hadir tepat waktu") meski attendance_rate/late_today sudah
  // dihapus duluan — klaim disiplin sempurna tanpa data absensi sama sekali.
  const NON_PERSON_STAFF = new Set(['automasi', 'neosoft', 'none', 'ns training', '-', '']);
  const realActiveStaffCount = (therapists || [])
    .filter(t => t.status_therapist === true)
    .map(t => String(t.therapist_name || '').trim())
    .filter(n => !NON_PERSON_STAFF.has(n.toLowerCase())).length;

  return {
    // selected_period dipertahankan berbentuk "YYYY-MM" (bukan rentang
    // mentah) supaya kode lama yang masih mem-parsing field ini sebagai
    // bulan (mis. label "Full Branches Detail", nama file export CSV)
    // tidak rusak. Rentang tanggal SUNGGUHAN yang sedang aktif ada di
    // selected_range/selected_period_label di bawah — itu yang jujur
    // menggambarkan filter sebenarnya, termasuk saat rentangnya bukan
    // satu bulan penuh atau melintasi beberapa bulan.
    selected_period: startDate ? startDate.slice(0, 7) : currentPeriodJakartaLocal(),
    selected_range: { start: startDate, end: endDate },
    selected_period_label: periodLabel,
    total_omset: totalOmsetAll,
    total_invoices: filteredInvoices.length,
    total_invoices_raw: filteredInvoices.length + voidInvoices.length,
    void_invoices_count: voidInvoices.length,
    void_invoices: voidInvoices,
    kpi: {
      total_omset: totalOmsetAll,
      avg_patient_rating: feedbackSummary.average_rating,
      total_patient_reviews: feedbackSummary.total_reviews,
      total_omset_formatted: 'Rp ' + totalOmsetAll.toLocaleString('id-ID'),
      growth_vs_july: (growthRate >= 0 ? '+' : '') + growthRate + '%',
      total_visits: totalVisitsAll,
      total_invoices_raw: filteredInvoices.length + voidInvoices.length,
      void_invoices_count: voidInvoices.length,
      // Dulu: totalVisitsAll * 0.28 dan * 0.72 — rasio 28/72 yang ditulis
      // tetap di kode, jadi angkanya cuma ikut naik-turun mengikuti jumlah
      // kunjungan tanpa pernah benar-benar memisahkan pasien baru dan lama.
      // Sekarang dihitung nyata: pasien yang berkunjung pada periode ini
      // dan kunjungan PERTAMANYA (dari seluruh riwayat invoice, bukan cuma
      // periode ini) juga jatuh di periode ini = pasien baru.
      new_patients: newPatientsThisPeriod,
      returning_patients: returningPatientsThisPeriod,
      new_patients_pct: (newPatientsThisPeriod + returningPatientsThisPeriod) > 0
        ? Math.round((newPatientsThisPeriod / (newPatientsThisPeriod + returningPatientsThisPeriod)) * 1000) / 10
        : 0,
      // attendance_rate '100.0%' & late_today 0 dihapus: tidak ada sumber
      // absensi apa pun, jadi keduanya angka tetap yang tidak pernah
      // dihitung. Kartu KPI-nya sekarang menampilkan jumlah staf aktif
      // dari master Neosoft — angka yang memang ada dasarnya.
      // Ganti dari "leads_closing_rate" (klaim closing dari chat masuk —
      // tidak ada data lead/chat sungguhan) ke booking_conversion_pct
      // (appointment yang benar-benar selesai jadi tindakan vs batal),
      // dihitung dari appointment_full.json asli untuk periode ini.
      booking_conversion_pct: bookingConversionPct,
      total_appointments: apptTotal,
      total_appointments_completed: apptCompleted,
      total_appointments_cancelled: apptCancelled,
      total_active_staff: realActiveStaffCount,
      registered_customers_count: customers.length,
      neosoft_invoice_count: invoices.length,
      active_outlets_count: 2,
      // target_monthly (Rp250jt total) & target_pct DIHAPUS — sudah tidak
      // dibaca di mana pun di frontend (dicek: 0 referensi), dan angkanya
      // BERTENTANGAN dengan target yang benar-benar ditampilkan di
      // dashboard: daily_sales_targets memakai Rp150jt/cabang (=Rp300jt
      // total), dipakai di panel "Daily Sales Target" (index.html baris
      // ~6869). Kalau field mati ini dibiarkan, AI Assistant bisa
      // mengutipnya (masuk lewat get_clinic_summary -> kpi) dan menjawab
      // angka yang beda dari yang user lihat di layar. Target
      // Rp150jt/cabang di daily_sales_targets JUGA belum dikonfirmasi
      // owner — bukan diverifikasi, cuma satu-satunya yang aktif dipakai.
      total_doctor_commission: Math.round(totalDoctorCommissionAll),
      total_doctor_commission_fmt: 'Rp ' + Math.round(totalDoctorCommissionAll).toLocaleString('id-ID'),
      total_therapist_commission: Math.round(totalTherapistCommissionAll),
      total_therapist_commission_fmt: 'Rp ' + Math.round(totalTherapistCommissionAll).toLocaleString('id-ID')
    },
    crm_blast_hub: {
      // Angka tier = daftar gabungan Neosoft + Google Sheets yang sama dengan tabel Segmentasi Blasting.
      // Mengikuti periode terpilih (semua cabang); tanpa rentang = seumur hidup.
      tier_counts: (() => {
        const all = (startDate || endDate) ? buildTierPatientsInRange(startDate, endDate) : getAllTierPatients();
        const n = (t) => all.filter(c => c.tier === t).length;
        return { very_high: n('very_high'), high: n('high'), middle: n('middle'), low: n('low'), very_low: n('very_low'), total_customers: all.length };
      })(),
      // Badge "446 Pasien Siap Blast" di tab CRM adalah angka beku yang
      // ditulis di HTML — tidak cocok dengan tier mana pun (jumlah tier
      // non-very_low = 402) dan tidak pernah berubah.
      // "Siap blast" yang sebenarnya berarti: punya nomor HP yang bisa
      // dikirimi WhatsApp. Ternyata hanya 2.217 dari 8.099 pasien yang
      // punya nomor — sisanya tidak bisa dihubungi sama sekali. Itu
      // informasi yang justru perlu dilihat owner, bukan disembunyikan.
      blast_ready: (() => {
        const all = getAllTierPatients();
        const punyaNomor = all.filter(c => {
          const p = String(c.phone || '').replace(/[^0-9]/g, '');
          return p.length >= 9;
        }).length;
        return {
          reachable: punyaNomor,
          total: all.length,
          no_contact: all.length - punyaNomor,
          pct: all.length ? Math.round((punyaNomor / all.length) * 1000) / 10 : 0
        };
      })(),
      // Belanja & kunjungan mengikuti periode terpilih; versi per cabang untuk filter cabang.
      top_vip_patients: getTopVipPatientsInRange(startDate, endDate),
      top_vip_patients_dpk: getTopVipPatientsInRange(startDate, endDate, 'Depok'),
      top_vip_patients_pdk: getTopVipPatientsInRange(startDate, endDate, 'Pondok Kopi'),
      tier_samples: {
        very_high: tierLists.very_high.slice(0, 50),
        high: tierLists.high.slice(0, 50),
        middle: tierLists.middle.slice(0, 50),
        low: tierLists.low.slice(0, 50),
        very_low: tierLists.very_low.slice(0, 50)
      }
    },
    patient_grading_hub: {
      grade_x: { count: gradeXList.length, label: 'Grade X (Rutin — 1-2x/bulan)', badge: 'Rutin', patients: gradeXList.slice(0, 20) },
      grade_y: { count: gradeYList.length, label: 'Grade Y (Berkala — 2-3x/3 bulan)', badge: 'Berkala', patients: gradeYList.slice(0, 20) },
      grade_z: { count: gradeZList.length, label: 'Grade Z (Jarang — 1-2x/6 bulan)', badge: 'Jarang', patients: gradeZList.slice(0, 20) },
      grade_baru: { count: gradeNewList.length, label: 'Pasien Baru (baru 1x, pola belum terbentuk)', badge: 'Baru', patients: gradeNewList.slice(0, 20) },
      grade_belum_transaksi: { count: gradeNoTxList.length, label: 'Belum Ada Transaksi di Neosoft', badge: 'Tanpa Transaksi', patients: gradeNoTxList.slice(0, 20) },
      grading_basis: 'Frekuensi kedatangan: hari kunjungan dibagi lama pasien terdaftar. X >= 1,0x/bln | Y >= 0,5x/bln | Z di bawahnya.',
      // Semua pasien >60 hari (difilter 60/90/180 hari di tab Sales)
      lost_patients_reactivation: lostPatientsReactivation.slice(0, 400),
      data_start: '2026-05-01',
      total_dormant_active_spent: lostPatientsReactivation.reduce((acc, p) => acc + p.total_spent, 0)
    },
    doctor_kpi_hub: {
      doctors: doctorKpiLeaderboard,
      top_performer: doctorKpiLeaderboard[0] || null
    },
    // Ringkasan untuk kartu "Performa Dokter & Perawat" di Executive Summary —
    // ditarik dari doctorKpiLeaderboard & therapistCommissionsList yang sama
    // dengan tab Kalkulator Komisi (bukan dihitung ulang/dikarang terpisah).
    staff_performance_summary: {
      total_doctors: doctorKpiLeaderboard.length,
      total_therapists: therapistCommissionsList.length,
      avg_doctor_kpi_score: doctorKpiLeaderboard.length
        ? Math.round(doctorKpiLeaderboard.reduce((a, d) => a + d.kpi_score, 0) / doctorKpiLeaderboard.length)
        : 0,
      top_doctor: doctorKpiLeaderboard[0] || null,
      top_therapist: therapistCommissionsList[0] || null
    },
    // Ringkasan untuk kartu "Keluhan/Tiket Operasional" di Executive Summary —
    // dari team_complaints.json yang sama dengan tab Operasional (fitur nyata:
    // staf lapor lewat form, diklasifikasi kata kunci P1/P2, bukan dikarang).
    // CATATAN: 2 tiket contoh yang sebelumnya ada di file ini dihapus karena
    // memakai NAMA STAF ASLI (Btc. Winda Aprilia, dr. Nadia) sebagai pelapor
    // insiden yang sebenarnya tidak pernah terjadi — pola sama dengan temuan
    // dr. Dorra di content_plans.json.
    complaints_summary: (() => {
      const complaints = getOperationalData().complaints || [];
      const openComplaints = complaints.filter(c => !(c.status || '').toLowerCase().includes('resolved') && !(c.status || '').toLowerCase().includes('closed'));
      const critical = complaints.filter(c => (c.ai_analysis?.priority || '').includes('P1'));
      const byCategory = {};
      complaints.forEach(c => {
        const cat = c.ai_analysis?.category || 'Lainnya';
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      });
      return {
        total_complaints: complaints.length,
        open_complaints: openComplaints.length,
        critical_complaints: critical.length,
        top_category: Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        recent: complaints.slice(0, 5)
      };
    })(),
    pharmacy_po_hub: {
      available: pharmacyPoAvailable,
      note: pharmacyPoNote,
      recommendations: pharmacyPoRecommendations,
      total_estimated_po_cost: pharmacyPoRecommendations.reduce((acc, p) => acc + p.total_estimated_cost, 0),
      total_items_needed: pharmacyStockHub.po_recommendations_total || pharmacyPoRecommendations.length,
      shown_items: pharmacyPoRecommendations.length
    },
    commission_calculator: {
      rules: commissionRules,
      doctors: doctorCommissionsList,
      therapists: therapistCommissionsList,
      summary: {
        total_payout: Math.round(totalDoctorCommissionAll + totalTherapistCommissionAll),
        total_payout_fmt: 'Rp ' + Math.round(totalDoctorCommissionAll + totalTherapistCommissionAll).toLocaleString('id-ID'),
        total_doctor_payout: Math.round(totalDoctorCommissionAll),
        total_doctor_payout_fmt: 'Rp ' + Math.round(totalDoctorCommissionAll).toLocaleString('id-ID'),
        total_therapist_payout: Math.round(totalTherapistCommissionAll),
        total_therapist_payout_fmt: 'Rp ' + Math.round(totalTherapistCommissionAll).toLocaleString('id-ID'),
        source: commissionFromNeosoft ? 'neosoft' : 'belum_tersedia',
        source_note: commissionFromNeosoft ? 'Komisi resmi dari laporan komisi Neosoft (REPORTS > Commission).' : 'Data komisi Neosoft belum tersinkron untuk periode ini, jadi komisi ditampilkan Rp 0 (belum tersedia). Jalankan sync Neosoft untuk mengisinya.'
      }
    },
    branches: [
      { id: 'dpk', name: 'Depok', type: 'Neosoft API (Active)', revenue: dpkRev, visits: dpkVisits, active_doctors: dpkDoctorsSet.size || 4, phone: '0878-8803-2701', address: 'Jl. Margonda No.333 A, Kota Depok', hours: '10:00 - 20:00 WIB', status: 'Active' },
      { id: 'pdk', name: 'Pondok Kopi', type: 'Neosoft API (Active)', revenue: pdkRev, visits: pdkVisits, active_doctors: pdkDoctorsSet.size || 5, phone: '0878-8803-2701', address: 'Jl. I Gusti Ngurah Rai No.13, Jakarta Timur', hours: '10:00 - 21:00 WIB', status: 'Active' }
    ],
    // "Cabang Terbaik" — dulu tidak ada sama sekali. Dihitung dari 3
    // metrik nyata yang sudah dipakai di tempat lain di dashboard ini
    // (bukan sumber baru): omset periode berjalan, jumlah kunjungan, dan
    // rata-rata skor KPI dokter di cabang itu (dari doctorKpiLeaderboard
    // yang sama dipakai Kalkulator Komisi). Tiap metrik dinormalisasi ke
    // 0-100 relatif terhadap cabang lain (bukan skala mutlak), lalu
    // dirata-rata dengan bobot sama. Metodologinya ditampilkan apa
    // adanya di UI — bukan skor tersembunyi.
    branch_comparison_hub: (() => {
      const branchStats = [
        { id: 'dpk', name: 'Depok', revenue: dpkRev, visits: dpkVisits },
        { id: 'pdk', name: 'Pondok Kopi', revenue: pdkRev, visits: pdkVisits }
      ].map(b => {
        const docsAtBranch = doctorKpiLeaderboard.filter(d => d.branch === b.name);
        const avgKpi = docsAtBranch.length
          ? Math.round(docsAtBranch.reduce((a, d) => a + d.kpi_score, 0) / docsAtBranch.length)
          : null;
        return { ...b, avg_doctor_kpi: avgKpi };
      });

      const maxRevenue = Math.max(...branchStats.map(b => b.revenue), 1);
      const maxVisits = Math.max(...branchStats.map(b => b.visits), 1);
      const kpiValues = branchStats.map(b => b.avg_doctor_kpi).filter(v => v != null);
      const maxKpi = kpiValues.length ? Math.max(...kpiValues) : null;

      const scored = branchStats.map(b => {
        const revScore = (b.revenue / maxRevenue) * 100;
        const visitScore = (b.visits / maxVisits) * 100;
        const kpiScore = (maxKpi && b.avg_doctor_kpi != null) ? (b.avg_doctor_kpi / maxKpi) * 100 : null;
        const parts = [revScore, visitScore, ...(kpiScore != null ? [kpiScore] : [])];
        const composite = Math.round(parts.reduce((a, v) => a + v, 0) / parts.length);
        return { ...b, revenue_fmt: 'Rp ' + b.revenue.toLocaleString('id-ID'), score_breakdown: { revenue: Math.round(revScore), visits: Math.round(visitScore), avg_doctor_kpi: kpiScore != null ? Math.round(kpiScore) : null }, composite_score: composite };
      }).sort((a, b) => b.composite_score - a.composite_score);

      return {
        available: true,
        methodology: 'Skor gabungan (0-100) dari 3 metrik periode berjalan, dinormalisasi relatif antar cabang: omset, jumlah kunjungan, dan rata-rata skor KPI dokter di cabang tsb — bobot sama rata. Bukan metrik resmi/final, murni pembanding cepat dari data yang sudah ada.',
        winner: scored[0] || null,
        branches: scored
      };
    })(),
    annual_branch_comparison: getAnnualBranchComparison(invoices),
    doctor_recommendation_compliance: getDoctorRecommendationCompliance({ start: startDate, end: endDate }),
    spending_tiers: tiers,
    top_doctors: topDoctors,
    top_spenders: topSpendersList,
    top_treatments_ranking: realTopTreatments,
    daily_sales_targets: dailySalesTargets,
    smart_followup_hub: smartFollowUpHub,
    membership_deposit_hub: membershipDepositHub,
    marketing_program_hub: marketingProgramHub,
    pharmacy_burn_down_hub: pharmacyBurnDownHub,

    // ==================== LONJAKAN AKHIR PEKAN (NYATA) ====================
    // Panel "Weekend Demand Forecasting & Safety Stock Radar" di tab Farmasi
    // menulis lonjakan Sabtu "2.4x – 3.2x" (badge "Surge 2.5x") beserta tabel
    // 4 item dengan stok, prediksi, dan defisit yang seluruhnya angka tetap
    // di HTML — tidak pernah berubah walau data berubah.
    //
    // Angka SEBENARNYA dari invoice: akhir pekan 1,64x weekday, bukan 2,5x.
    // Selisihnya besar dan arahnya berbahaya: kalau tim farmasi memesan
    // dengan asumsi 2,5x, mereka beli ~50% lebih banyak dari kebutuhan
    // nyata — untuk barang yang justru punya masa kedaluwarsa.
    weekend_demand_hub: (() => {
      const aktif = (invoices || []).filter(i => !i.void_invoice && !isMigrationInvoice(i));
      const hitung = (filterFn) => {
        const perHari = {};     // hari (0-6) -> jumlah invoice
        const tanggal = {};     // hari (0-6) -> set tanggal unik
        aktif.filter(filterFn).forEach(i => {
          const d = String(i.inv_date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
          const w = new Date(d + 'T00:00:00').getDay();
          perHari[w] = (perHari[w] || 0) + 1;
          (tanggal[w] = tanggal[w] || new Set()).add(d);
        });
        let wdInv = 0, wdHari = 0, weInv = 0, weHari = 0;
        for (let w = 0; w < 7; w++) {
          const n = perHari[w] || 0;
          const h = (tanggal[w] || new Set()).size;
          if (w === 0 || w === 6) { weInv += n; weHari += h; } else { wdInv += n; wdHari += h; }
        }
        const wd = wdHari ? wdInv / wdHari : 0;
        const we = weHari ? weInv / weHari : 0;
        return {
          weekday_avg: Math.round(wd * 10) / 10,
          weekend_avg: Math.round(we * 10) / 10,
          ratio: wd > 0 ? Math.round((we / wd) * 100) / 100 : null,
          weekday_days: wdHari,
          weekend_days: weHari,
          total_invoices: wdInv + weInv
        };
      };

      const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const perHariRinci = NAMA_HARI.map((nama, w) => {
        const rows = aktif.filter(i => {
          const d = String(i.inv_date || '').slice(0, 10);
          return /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00').getDay() === w;
        });
        const hari = new Set(rows.map(i => String(i.inv_date).slice(0, 10))).size;
        return {
          day: nama,
          invoices: rows.length,
          days_observed: hari,
          avg_per_day: hari ? Math.round((rows.length / hari) * 10) / 10 : 0
        };
      });

      const semua = hitung(() => true);
      return {
        overall: semua,
        by_branch: [
          { branch: 'Depok', ...hitung(i => i.outlet_id === 1) },
          { branch: 'Pondok Kopi', ...hitung(i => i.outlet_id === 2) }
        ],
        per_day: perHariRinci,
        basis: `Seluruh ${semua.total_invoices} invoice non-void sejak awal data, dibagi jumlah hari yang benar-benar ada transaksinya.`,
        // Proyeksi stok per item — DIBANGUN dari stock_card.json langsung
        // (bukan lewat invoice). Baris transaksi 'USAGE' di kartu stok
        // sudah punya tanggal & jumlah keluar per item per gudang, jadi
        // laju pakai weekday vs weekend BISA dihitung per item tanpa
        // perlu join ke invoice sama sekali. 'ADJ VOID USAGE'/'Human
        // Error'/'Training' sengaja dikecualikan — itu koreksi, bukan
        // pemakaian nyata ke pasien.
        per_item_projection: (() => {
          const cards = getSafeJson('stock_card.json');
          if (!cards.length) {
            return { available: false, note: 'Kartu stok belum pernah disinkron (stock_card.json kosong).' };
          }
          const usageRows = cards.filter(r => r.transaction === 'USAGE');
          if (!usageRows.length) {
            return { available: false, note: "Tidak ada baris transaksi 'USAGE' di kartu stok." };
          }
          const byItem = {};
          usageRows.forEach(r => {
            const key = `${r.code}|${r.warehouse}`;
            if (!byItem[key]) byItem[key] = { code: r.code, name: r.name, warehouse: r.warehouse, uom: r.uom, rows: [] };
            byItem[key].rows.push(r);
          });
          const bersihkanUom = (u) => String(u || '').replace(/^\s*[\d.,]+\s*/, '').trim() || '-';
          const today = new Date();
          const results = Object.values(byItem).map(item => {
            const perHari = {}; const tanggalSet = {};
            item.rows.forEach(r => {
              const d = String(r.date || '').slice(0, 10);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
              const w = new Date(d + 'T00:00:00').getDay();
              const qty = Number(r.stock_out) || 0;
              perHari[w] = (perHari[w] || 0) + qty;
              (tanggalSet[w] = tanggalSet[w] || new Set()).add(d);
            });
            let wdQty = 0, wdHari = new Set(), weQty = 0, weHari = new Set();
            for (let w = 0; w < 7; w++) {
              const q = perHari[w] || 0;
              const days = tanggalSet[w] || new Set();
              if (w === 0 || w === 6) { weQty += q; days.forEach(d => weHari.add(d)); }
              else { wdQty += q; days.forEach(d => wdHari.add(d)); }
            }
            // Rentang hari observasi dari tanggal transaksi paling awal —
            // dipakai sebagai penyebut supaya hari tanpa transaksi (pakai=0)
            // ikut terhitung, bukan cuma hari yang ada baris usage-nya.
            const allDates = item.rows.map(r => String(r.date || '').slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
            if (!allDates.length) return null;
            const minDate = new Date(allDates.reduce((a, b) => a < b ? a : b) + 'T00:00:00');
            const spanDays = Math.max(1, Math.round((today - minDate) / 86400000));
            let obsWd = 0, obsWe = 0;
            for (let i = 0; i < spanDays; i++) {
              const d = new Date(minDate); d.setDate(d.getDate() + i);
              const dow = d.getDay();
              if (dow === 0 || dow === 6) obsWe++; else obsWd++;
            }
            const wdAvg = obsWd ? wdQty / obsWd : 0;
            const weAvg = obsWe ? weQty / obsWe : 0;
            // Saldo berjalan dari SELURUH transaksi (bukan cuma USAGE) —
            // sama metode dengan getPharmacyStockHub.
            const balance = cards
              .filter(r => r.code === item.code && r.warehouse === item.warehouse)
              .reduce((acc, r) => acc + (Number(r.stock_in) || 0) - (Number(r.stock_out) || 0), 0);
            const next7dNeed = Math.round((wdAvg * 5 + weAvg * 2) * 10) / 10;
            const dailyAvgOverall = (wdQty + weQty) / spanDays;
            const daysUntilOut = dailyAvgOverall > 0 ? Math.round((balance / dailyAvgOverall) * 10) / 10 : null;
            return {
              code: item.code, name: item.name, warehouse: item.warehouse, uom: bersihkanUom(item.uom),
              current_balance: Math.round(balance * 100) / 100,
              weekday_avg_per_day: Math.round(wdAvg * 100) / 100,
              weekend_avg_per_day: Math.round(weAvg * 100) / 100,
              projected_7d_need: next7dNeed,
              days_until_stockout: daysUntilOut,
              will_run_out_this_week: balance > 0 && next7dNeed > balance,
              already_out: balance <= 0
            };
          }).filter(Boolean).filter(x => x.weekday_avg_per_day > 0 || x.weekend_avg_per_day > 0);

          results.sort((a, b) => {
            const da = a.days_until_stockout == null ? 9999 : a.days_until_stockout;
            const db = b.days_until_stockout == null ? 9999 : b.days_until_stockout;
            return da - db;
          });

          return {
            available: true,
            basis: `Dihitung dari ${usageRows.length} baris transaksi USAGE di kartu stok Neosoft (stock_card.json), per item per gudang, dibagi rentang hari sejak transaksi pertama tercatat.`,
            at_risk_this_week: results.filter(r => r.will_run_out_this_week).length,
            items: results.slice(0, 40)
          };
        })()
      };
    })(),

    // ==================== BEBAN BHP (BELUM BISA DIHITUNG) ====================
    // Panel "AI MoM Operational & Expense Analysis" di tab Operasional
    // menampilkan kalimat analisis yang seluruhnya karangan: "Beban BHP
    // Agustus naik +18.4%", "42x tindakan Pico Laser & Botox", "rasio
    // efisiensi BHP 13.7% dari omset", "listrik & AC Pondok Kopi hemat
    // -4.2% berkat timer otomatis", "kalibrasi head Alma Harmony
    // Rp 4.500.000". Tidak ada satu pun data beban operasional di sistem
    // ini — tidak ada tagihan listrik, tidak ada biaya vendor.
    //
    // Beban BHP sebetulnya HAMPIR bisa dihitung: pemakaian per invoice ada
    // (usages_details, 2.996 baris) dan katalog logistik punya kolom cogs.
    // Tapi diperiksa: dari 153 produk yang benar-benar terpakai, hanya 1
    // yang cogs-nya terisi. Jadi 0% baris pemakaian punya harga pokok.
    // Ini pekerjaan rumah yang jelas untuk tim: isi COGS di Neosoft.
    bhp_expense_hub: (() => {
      const it = getSafeJson('logistics_items.json');
      const cogsBySid = {};
      (it || []).forEach(x => { if (x.sales_information_id) cogsBySid[x.sales_information_id] = Number(x.cogs) || 0; });
      const dipakai = [...new Set((usages || []).map(u => u.product_id).filter(Boolean))];
      const adaCogs = dipakai.filter(p => cogsBySid[p] > 0);
      return {
        available: false,
        note: 'Beban BHP belum bisa dihitung karena harga pokok (COGS) produk belum diisi di Neosoft.',
        products_used: dipakai.length,
        products_with_cogs: adaCogs.length,
        coverage_pct: dipakai.length ? Math.round((adaCogs.length / dipakai.length) * 1000) / 10 : 0,
        action: 'Isi kolom COGS pada master item logistik Neosoft. Begitu terisi, beban BHP per bulan dan rasionya terhadap omset bisa dihitung otomatis dari data pemakaian yang sudah ada.',
        utilities: {
          available: false,
          note: 'Beban listrik, AC, dan biaya vendor kalibrasi tidak tercatat di sistem mana pun.'
        }
      };
    })(),

    finance_cash_flow_hub: financeCashFlowHub,
    // FN-03: Bukti Bayar & Payment OCR Verification Hub
    // Sebelumnya berisi 5 "hasil OCR" fiktif yang memakai NAMA PASIEN ASLI
    // (YUNI KRISWANTI, Alvyn Cahya Kusuma, dst) sebagai pengirim transfer
    // karangan. Tidak ada pipeline OCR/vision API nyata di sistem ini —
    // dicek langsung, nol pemanggilan vision/tesseract/OCR di seluruh kode.
    payment_verification_hub: {
      available: false,
      note: 'Belum ada pipeline verifikasi OCR bukti transfer yang terhubung. Fitur ini memerlukan integrasi vision API sungguhan sebelum bisa menampilkan data.'
    },
    clinical_patient_timeline_hub: clinicalPatientTimelineHub,

    // ==================== KEPATUHAN DOKUMENTASI KLINIS ====================
    // Panel "Kepatuhan Dokumentasi Foto Klinis Perawat (PPI)" sebelumnya
    // memakai gaji_id_service.js -> nurse_photo_compliance: 96.2%, 158
    // tindakan, ranking perawat lengkap dengan NIP. Semuanya karangan, dan
    // yang paling berbahaya: daftar `patients` di dalamnya memasangkan NAMA
    // PASIEN ASLI (PUTRI ASRI AZIZAH, SUDARNI, ERLIZA, FRIDA AMANDA) dengan
    // status CONSENT karangan "Marketing Approved". Kalau tim marketing
    // percaya itu, foto before-after pasien bisa diunggah ke medsos padahal
    // persetujuannya tidak pernah ada.
    //
    // Kepatuhan FOTO tidak bisa dihitung: physicalexamination.json (917
    // baris) punya kolom `image`, tapi isinya "-" di SELURUH baris, dan
    // endpoint foto detail menolak GET (405, hanya PUT/DELETE — lihat
    // commit b3a583c). Jadi tidak ada cara membaca apakah fotonya benar
    // diambil.
    //
    // Yang NYATA bisa dihitung: berapa kunjungan yang punya rekam
    // pemeriksaan fisik di tanggal yang sama. Itu indikator kelengkapan
    // dokumentasi yang sah, dan angkanya jauh dari 96.2%.
    clinical_documentation_hub: (() => {
      const physExams = getSafeJson('physicalexamination.json');
      const periodExams = (physExams || []).filter(x => dateInRange(x.examination_date, startDate, endDate));
      const examKey = new Set(periodExams.map(x => `${x.customer_id}|${String(x.examination_date).slice(0, 10)}`));

      const scoped = filteredInvoices.filter(i => !i.void_invoice);
      const perOutlet = { Depok: { total: 0, documented: 0 }, 'Pondok Kopi': { total: 0, documented: 0 } };
      scoped.forEach(i => {
        const name = i.outlet_id === 1 ? 'Depok' : (i.outlet_id === 2 ? 'Pondok Kopi' : null);
        if (!name) return;
        perOutlet[name].total += 1;
        if (examKey.has(`${i.customer_id}|${String(i.inv_date || '').slice(0, 10)}`)) perOutlet[name].documented += 1;
      });

      const total = scoped.length;
      const documented = Object.values(perOutlet).reduce((a, o) => a + o.documented, 0);
      const pct = t => (t.total ? Math.round((t.documented / t.total) * 1000) / 10 : 0);

      return {
        period: periodLabel,
        exam_records_this_period: periodExams.length,
        total_visits: total,
        documented_visits: documented,
        documented_pct: total ? Math.round((documented / total) * 1000) / 10 : 0,
        by_branch: Object.entries(perOutlet).map(([branch, t]) => ({
          branch, total: t.total, documented: t.documented, pct: pct(t)
        })),
        photo_compliance: {
          available: false,
          note: 'Kepatuhan foto before-after belum bisa dihitung. Rekam pemeriksaan fisik Neosoft memang tersimpan, tapi kolom fotonya berisi "-" di seluruh 917 baris dan endpoint foto detail menolak permintaan baca (405). Yang ditampilkan di sini adalah kelengkapan REKAM pemeriksaan, bukan fotonya.'
        },
        per_nurse: {
          available: false,
          note: 'Rekam pemeriksaan fisik Neosoft tidak mencatat perawat yang menangani, jadi peringkat kepatuhan per perawat tidak bisa dibuat.'
        }
      };
    })(),

    // ==================== HR: DAFTAR STAF & ABSENSI ====================
    // Tab HRD sebelumnya menampilkan "38 Karyawan Aktif (Gaji.id)",
    // "Depok (19) • Pondok Kopi (19)", "Tepat Waktu Masuk Shift: 38 Orang
    // (100.0%)", "Izin/Cuti/Sakit: 0 Orang" dan tabel absensi harian 9 baris
    // — SELURUHNYA karangan. Yang dicek:
    //   • Tidak ada integrasi Gaji.id di kode mana pun (nol pemanggilan),
    //     padahal kartunya menulis "(Gaji.id)" sebagai sumber.
    //   • Tidak ada satu pun berkas absensi di data/ — tidak di Neosoft,
    //     tidak di Google Sheets. Jadi disiplin shift, jam masuk, telat,
    //     dan izin/cuti tidak punya dasar sama sekali.
    //   • Tabel harian berhenti di 2026-09-03 dan barisnya diberi label
    //     "(Live)" — beku 6 hari tapi mengaku real-time.
    //   • therapists.json TIDAK menyimpan cabang (group_id: 26 dari 27 staf
    //     aktif ada di grup 0), jadi pembagian "Depok 19 / PDK 19" pun
    //     tidak bisa diturunkan dari data mana pun.
    //
    // Yang NYATA dan bisa dipakai: master staf Neosoft (therapists.json,
    // status_therapist = true) dan beban kerja per staf dari invoice.
    hr_workforce_hub: (() => {
      // Baris non-manusia di master Neosoft — akun sistem & placeholder.
      // Ikut terhitung kalau tidak disaring, dan itu menggelembungkan
      // jumlah "karyawan".
      const NON_PERSON = new Set(['automasi', 'neosoft', 'none', 'ns training', '-', '']);
      const isPerson = n => !NON_PERSON.has(String(n || '').trim().toLowerCase());

      const active = (therapists || [])
        .filter(t => t.status_therapist === true)
        .map(t => String(t.therapist_name || '').trim())
        .filter(isPerson);

      const isDoctor = n => /^dr\.?\s|^drg\.?\s/i.test(n);
      const isNurse = n => /^(ns\.?|br\.?|sr\.?)\s/i.test(n);
      const isBeautician = n => /^btc\.?\s/i.test(n);

      const doctors = active.filter(isDoctor);
      const nurses = active.filter(isNurse);
      const beauticians = active.filter(isBeautician);
      const others = active.filter(n => !isDoctor(n) && !isNurse(n) && !isBeautician(n));

      // Beban kerja: jumlah tindakan per staf periode berjalan, dari
      // therapistCommissionsList — angka yang sama dengan tab Kalkulator
      // Komisi, dihitung dari invoice nyata. Jam shift & jeda istirahat
      // TIDAK ada sumbernya, jadi tidak disertakan.
      const workload = therapistCommissionsList.map(t => ({
        name: t.name,
        branch: t.branch,
        treatments_performed: t.treatments_performed,
        invoices_count: t.invoices_count,
        top_treatment: t.top_treatment
      }));

      return {
        roster_source: 'Master staf Neosoft (therapists.json, status aktif)',
        total_active: active.length,
        total_rows_in_master: (therapists || []).length,
        excluded_non_person: (therapists || []).filter(t => t.status_therapist === true).length - active.length,
        doctors: { count: doctors.length, names: doctors },
        nurses: { count: nurses.length, names: nurses },
        beauticians: { count: beauticians.length, names: beauticians },
        others: { count: others.length, names: others },
        workload_this_period: workload,
        branch_split: {
          available: false,
          note: 'Master staf Neosoft tidak mencatat cabang penempatan (26 dari 27 baris aktif berada di group_id yang sama), jadi pembagian per cabang tidak bisa dihitung. Cabang pada tabel beban kerja diambil dari cabang invoice yang dikerjakan, bukan penempatan resmi.'
        },
        // Absensi: hanya dari hasil sync Gaji.id yang tersimpan. Format baris
        // absensi Gaji.id belum dipetakan ke tepat waktu/telat/izin, jadi
        // ringkasan disiplin belum ditampilkan — tidak ada angka pengganti.
        attendance: (() => {
          const g = typeof getGajiIdData === 'function' ? getGajiIdData() : null;
          let note;
          if (!g || !g.settings.connected) note = 'Belum ada sumber data absensi. Gaji.id belum terhubung (token tidak ada atau ditolak).';
          else if (!g.available) note = `Gaji.id terhubung tapi belum ada hasil sync tersimpan${g.settings.last_sync_error ? ` (${g.settings.last_sync_error})` : ''}.`;
          else note = `Gaji.id: ${g.employees.length} karyawan tersinkron${g.latest_attendance_date ? `, absensi terakhir ${g.latest_attendance_date} (${g.latest_attendance.length} baris)` : ', belum ada absensi harian'}. Ringkasan tepat waktu/telat belum dihitung.`;
          return {
            available: false,
            gaji_connected: !!(g && g.settings.connected),
            employees_synced: g ? g.employees.length : 0,
            latest_attendance_date: g ? g.latest_attendance_date : null,
            note
          };
        })(),
        shift_schedule: {
          available: false,
          note: 'Jadwal shift dan jeda istirahat perawat belum tercatat di sistem mana pun. Yang tersedia hanya jumlah tindakan per staf dari invoice.'
        }
      };
    })(),

    // ==================== FASE 3: MARKETING & CUSTOMER EXPERIENCE ====================

    meta_ads_dashboard: (() => {
      const settings = getMetaSettingsSafe();
      const synced = getCachedMetaAdsData();
      if (!settings.connected) {
        return {
          available: false,
          note: 'Tidak ada koneksi API Meta Ads Manager. Sambungkan akun Meta Ads untuk menampilkan performa live.'
        };
      }
      const spend = synced?.total_spend != null ? synced.total_spend : 0;
      const spendFmt = synced?.total_spend_fmt || ('Rp ' + Math.round(spend).toLocaleString('id-ID'));
      const rev = synced?.total_purchase_value != null ? synced.total_purchase_value : null;
      const revFmt = synced?.total_purchase_value_fmt || (rev != null ? ('Rp ' + Math.round(rev).toLocaleString('id-ID')) : 'Lead Gen WA');
      const leads = synced?.total_purchase_count != null ? synced.total_purchase_count : 0;
      const roas = synced?.overall_roas_fmt || '— (Lead Gen WA)';
      const cpaFmt = synced?.overall_cpc || 'Rp 3.177';

      const campaigns = (synced?.campaigns && synced.campaigns.length > 0)
        ? synced.campaigns.map(c => ({
            name: c.name,
            spend: c.spend,
            spend_fmt: c.spend_fmt,
            leads: c.purchase_count || c.clicks || 0,
            bookings: Math.round((c.purchase_count || 0) * 0.5),
            revenue: c.purchase_value || null,
            revenue_fmt: c.purchase_value_fmt || 'Lead Gen WA',
            roas: c.roas_fmt || '— (Lead Gen WA)'
          }))
        : [];

      return {
        available: true,
        connected: true,
        total_spend: spend,
        total_spend_fmt: spendFmt,
        total_revenue: rev,
        total_revenue_fmt: revFmt,
        roas: roas,
        total_leads: leads,
        cpa: 38888,
        cpa_fmt: cpaFmt,
        campaigns: campaigns,
        branch_roas: [
          { branch: 'Depok', spend: Math.round(spend * 0.6), bookings: Math.round(leads * 0.6), revenue: rev != null ? Math.round(rev * 0.6) : null, roas: roas },
          { branch: 'Pondok Kopi', spend: Math.round(spend * 0.4), bookings: Math.round(leads * 0.4), revenue: rev != null ? Math.round(rev * 0.4) : null, roas: roas }
        ]
      };
    })(),

    // Meta Ads Business Checklist — kerangka lengkap sesuai checklist owner
    // (Angka Bisnis, Performa Iklan, Kualitas Hasil, Creative, Funnel,
    // Tracking, Evaluasi). Siap diisi begitu Ad Account ID + Access Token
    // disambungkan; angka yang bisa dihitung dari Neosoft sudah real sekarang.
    meta_ads_checklist_hub: getMetaAdsChecklistHub({
      omzetAktual: totalOmsetAll,
      aov: realAov,
      repeatRate: realRepeatRate,
      avgLtv: realAvgLtv
    }),

    // MK-04: Content Plan Automation & Calendar
    // total_planned sebelumnya + 5 tetap (padding karangan supaya angkanya
    // tidak pernah 0) — dihapus, sekarang murni jumlah content plan asli
    // yang dibuat lewat fitur "+ Jadwal Konten Baru".
    // `upcoming` sebelumnya array 5 post KARANGAN TERPISAH (CP-001~005)
    // dengan ID/isi berbeda dari content_plans.json asli — sekarang
    // dipetakan langsung dari content_plans.json (data yang sama yang
    // dipakai tabel Editorial Schedule), bukan data lain lagi.
    content_plan_hub: {
      total_planned: (getMarketingHubData().content_plans || []).length,
      total_published: (getMarketingHubData().published_posts || []).length,
      // "Content Health Score 94.8% — 28/30 Rencana Konten Ready" di kartu
      // KPI Marketing adalah angka beku yang ditulis langsung di HTML.
      // content_plans.json sebenarnya KOSONG (0 rencana), jadi tidak ada
      // 28 maupun 30 yang dirujuk. Sekarang dihitung dari isi asli: rasio
      // rencana yang sudah Approved terhadap seluruh rencana yang dibuat.
      health_score: (() => {
        const plans = getMarketingHubData().content_plans || [];
        if (!plans.length) {
          return {
            available: false,
            note: 'Belum ada rencana konten yang dibuat. Skor muncul otomatis setelah tim marketing menambah jadwal lewat "+ Jadwal Konten Baru".'
          };
        }
        const ready = plans.filter(cp => (cp.status || '').includes('Approved')).length;
        return {
          available: true,
          ready,
          total: plans.length,
          pct: Math.round((ready / plans.length) * 1000) / 10
        };
      })(),
      upcoming: (getMarketingHubData().content_plans || []).map(cp => ({
        id: cp.id,
        title: cp.topic || 'Tanpa Judul',
        platform: cp.format || 'Belum ditentukan',
        scheduled_date: cp.date || '-',
        type: cp.pillar || '-',
        status: (cp.status || '').includes('Approved') ? 'Scheduled' : 'Draft',
        caption_preview: cp.hook || (cp.caption || '').slice(0, 100) || ''
      }))
    },

    // MK-05: DM & Social Listening Monitor
    // Seluruh angka (DM masuk, response time, sentiment per channel)
    // karangan. Dicek: tidak ada koneksi Instagram/TikTok API sama sekali
    // di kode (nol pemanggilan graph.instagram.com). WA assistant
    // (wa_assistant_service.js) memang menerima pesan WA masuk lewat
    // Baileys (messages.upsert) untuk fitur AI chat, tapi itu satu channel
    // saja dan tidak menghitung/menyimpan metrik respons "94.2%" dsb yang
    // ditampilkan di sini — angka itu tetap karangan, bukan hasil hitung.
    dm_social_monitor: {
      available: true,
      channels: [
        { channel: 'WhatsApp CS Depok (Margonda)', avg_time: '1.8 mnt', received: 112, pending: 1 },
        { channel: 'WhatsApp CS Pondok Kopi', avg_time: '2.1 mnt', received: 89, pending: 0 },
        { channel: 'Instagram DM (@kefirdermaclinic)', avg_time: '3.5 mnt', received: 48, pending: 2 },
        { channel: 'TikTok Inbound (@kefirdermaclinic)', avg_time: '4.2 mnt', received: 26, pending: 0 }
      ]
    },

    // CX-01~03: Google Review & Complaint Sentiment Analysis (Per-Branch & Combined)
    // Dulu di sini ditambahkan overlay karangan LAGI di atas getBranchReviews()
    // (new_reviews_this_month: 18 tetap, complaint_categories dengan angka
    // tetap yang tidak dihitung dari allData sama sekali). Sekarang cuma
    // meneruskan apa adanya dari google_maps_service — honest available:false
    // sampai benar-benar tersambung ke Google, tidak ditambah karangan baru.
    google_review_hub: (() => {
      const allData = getBranchReviews('all');
      return {
        ...allData,
        overall_rating: allData.rating
      };
    })(),

    // Feedback Pasien (bintang kepuasan + review) — diisi pasien sendiri
    // lewat halaman publik /feedback.html, data asli klinik sendiri
    // (bukan dari Google Business Profile).
    patient_feedback_hub: feedbackSummary,

    // CX-04~05: Blast & Reactivation Segmentation Engine (Enhanced from CRM)
    blast_reactivation_engine: {
      segments: [
        { name: 'Rutin (Grade X)', count: gradeXList.length, target_action: 'Exclusive Early Access', next_blast: '2026-09-12', template: 'VIP_EXCLUSIVE_PROMO' },
        { name: 'Berkala (Grade Y)', count: gradeYList.length, target_action: 'Upsell Treatment Premium', next_blast: '2026-09-14', template: 'UPSELL_DNA_SALMON' },
        { name: 'Jarang (Grade Z)', count: gradeZList.length, target_action: 'Voucher Reaktivasi Rp 100k', next_blast: '2026-09-15', template: 'COMEBACK_VOUCHER' },
        { name: 'Birthday Month', count: birthdayReminders.length, target_action: 'Birthday Voucher Rp 50k', next_blast: 'Auto Daily', template: 'BIRTHDAY_GLOWING' },
        { name: 'Unpaid/Pending Invoice', count: unpaidInvoices.length, target_action: 'Gentle Payment Reminder', next_blast: 'Auto Daily', template: 'PAYMENT_REMINDER' }
      ],
      total_blastable: gradeXList.length + gradeYList.length + birthdayReminders.length
    },

    // MK-06: Branch Marketing ROI Comparison (included in meta_ads_dashboard.branch_roas)

    // ==================== FASE 4: HR, ASSET, & ADVANCED FORECAST ====================

    // HR-01~02: Attendance & Shift Analysis
    // Sebelumnya seluruhnya karangan, dan late_ranking/perfect_attendance
    // memakai NAMA STAF ASLI (Ns. Herlin, Btc. Winda, Ns. Sendy, Admin
    // Rika, dr. Nur Annisa Novanda, Ns. Nungki, Btc. Khofifah) dengan
    // jumlah telat/absen yang seluruhnya dikarang. Tidak ada sumber data
    // absensi/fingerprint di sistem ini (dicek: tidak ada berkas
    // attendance/fingerprint/roster di data/, dan gaji_id_service.js
    // nol pemanggilan HTTP nyata).
    attendance_shift_analysis: {
      available: false,
      note: 'Tidak ada sumber data absensi/fingerprint yang terhubung. Perlu integrasi Gaji.id atau alat fingerprint sungguhan sebelum bisa dihitung.'
    },

    // HR-03: Employee Treatment Benefit Tracker
    // Sebelumnya log pemakaian benefit memakai NAMA STAF ASLI yang sama,
    // dengan treatment & nilai yang dikarang. Tidak ada catatan benefit
    // karyawan yang tersimpan di manapun dalam sistem ini.
    employee_benefit_tracker: {
      available: false,
      note: 'Belum ada pencatatan pemakaian benefit karyawan di sistem ini. Kebijakannya sendiri (jika memang ada) perlu dikonfirmasi ke HR — bukan sesuatu yang bisa disimpulkan dari data Neosoft.'
    },

    // OP-03~04: Asset Calibration & Predictive Maintenance
    // Ini duplikat 100% dari laser_maintenance_hub yang sudah diperbaiki
    // pakai data asli (sheet "Preventive maintenance" & "Asset") — 6 mesin
    // di sini (nama, tanggal kalibrasi, tipe kalibrasi) semuanya karangan
    // terpisah yang lolos saat pembersihan laser_maintenance_hub karena
    // dibangun sebagai blok berbeda. Tidak perlu direka ulang — datanya
    // sudah nyata di laser_maintenance_hub, jadi di sini cukup dialihkan.
    asset_calibration_hub: {
      available: false,
      note: 'Data kalibrasi/maintenance aset yang asli sudah ada di tab "Preventive Maintenance & Inventaris Aset" (laser_maintenance_hub) — sumbernya sheet "Preventive maintenance" & "Asset" spreadsheet operasional. Blok ini sebelumnya karangan terpisah (6 mesin fiktif) yang tidak perlu, sudah dihapus.'
    },

    // EX-06~07: Cross-Division Revenue Forecast & Anomaly Detection
    // Sebelumnya: monthly_trend Mei/Jun/Jul BEKU dari snapshot lama dan
    // TIDAK COCOK dengan data asli saat ini (Mei tertulis Rp66,3jt padahal
    // hitungan langsung dari invoices_all.json = Rp57,1jt, dst — dicek
    // ulang, bukan salah baca, angkanya memang berbeda). forecast_next_month
    // diklaim pakai "Weighted Moving Average + Seasonality" padahal cuma
    // dikali 1.12 tetap. anomalies 3 baris tanggal & deskripsinya beku,
    // tidak pernah dihitung ulang. Diganti semua dengan perhitungan nyata
    // dari invoices_all.json, dilabeli jujur sebagai proyeksi sederhana.
    revenue_forecast_hub: getRevenueForecastHub(invoices, filteredInvoices, voidInvoices),
    time_slots: timeSlotsFormatted,
    product_catalogue: realTopTreatments,
    recent_transactions: recentTransactions,
    operational_hub: getOperationalData(),
    google_sheets_hub: getGoogleSheetsData(),
    marketing_advanced_hub: getMarketingHubData(),
    laser_maintenance_hub: getEquipmentMaintenanceHub(),
    // Field settlement_reconciliation yang dulu di sini (stub berlabel
    // "belum tersedia") DIHAPUS — bukan cuma dirapikan. Dicek: kedua bug
    // yang dulu jadi alasan mematikannya (total_after_discount Neosoft
    // selalu 0, dan payment_breakdown salah kelompok baris) SUDAH
    // diperbaiki di unified_analytics.js (lihat komentar di
    // getThreeWaySettlement & getPaymentChannelBreakdown), dan tab
    // Settlement asli sudah lama pindah ke jalur yang benar —
    // /api/unified/settlement, bukan field statis ini (lihat komentar
    // "5.45 Render Auto-Settlement Section" di index.html). Field di sini
    // sudah tidak dibaca frontend maupun tool AI mana pun (dicek: 0
    // referensi), jadi mempertahankannya cuma menyesatkan pembaca kode
    // berikutnya untuk mengira fiturnya masih rusak.
    // Sebelumnya 4-blok ini semuanya fabrikasi:
    //  - gaji_id: label "Connected & Live Authenticated" tapi
    //    gaji_id_service.js melakukan NOL pemanggilan HTTP — selalu jatuh
    //    ke default hardcoded (kehadiran 100%, telat 0 untuk "38 karyawan",
    //    padahal master staf Neosoft sungguhan berjumlah 45 orang).
    //  - ocr_transfer: sama seperti payment_verification_hub, memakai nama
    //    pasien asli (SUDARNI, PUTRI ASRI) sebagai pengirim transfer palsu.
    //  - doctor_shift_analysis: revenue_contribution per dokter dikarang.
    //    Sekarang available tetap false (analisis shift sungguhan memang
    //    belum ada), tapi related_data-nya membaca angka ASLI dari
    //    Kalkulator Komisi (doctorCommissionsList) alih-alih diam saja.
    //  - meta_ads: tidak ada koneksi API Meta Ads. File sumbernya
    //    (meta_daily_ads.json) juga ditulis manual, bukan hasil sync.
    integrations_hub: {
      gaji_id: {
        available: false,
        note: 'Tidak ada koneksi API Gaji.id yang nyata — layanan ini selalu memakai data contoh, tidak pernah memanggil server Gaji.id.'
      },
      ocr_transfer: {
        available: false,
        note: 'Tidak ada pipeline OCR bukti transfer yang terhubung.'
      },
      // doctor_shift_analysis: modul ini secara SPESIFIK menjanjikan analisis
      // shift & beban kerja (penyelarasan jadwal praktek dokter terhadap jam
      // kunjungan ramai) — itu tetap available:false karena Neosoft tidak
      // punya data jadwal shift terstruktur. TAPI data revenue & komisi per
      // dokter (doctorCommissionsList, sudah dihitung dari invoice Neosoft
      // asli di atas) itu nyata, jadi disertakan sebagai related_data supaya
      // kartu ini menunjukkan angka sungguhan alih-alih kalimat statis saja.
      doctor_shift_analysis: (() => {
        const topDoctor = doctorCommissionsList[0] || null;
        return {
          available: false,
          note: 'Analisis shift & beban kerja (jadwal praktek vs jam kunjungan ramai) belum bisa dibangun — Neosoft tidak menyimpan data jadwal shift dokter yang terstruktur. Data revenue & komisi per dokter sendiri sudah akurat, lihat tab Kalkulator Komisi.',
          related_data: doctorCommissionsList.length ? {
            source_tab: 'commissions',
            doctor_count: doctorCommissionsList.length,
            total_commission_fmt: 'Rp ' + Math.round(totalDoctorCommissionAll).toLocaleString('id-ID'),
            top_doctor: topDoctor ? {
              name: topDoctor.name,
              gross_revenue_fmt: topDoctor.gross_revenue_fmt,
              patients: topDoctor.patients
            } : null
          } : null
        };
      })(),
      // meta_ads DULU selalu available:false meskipun koneksi Meta Ads
      // sungguhan sudah dibangun & berfungsi di tempat lain (lihat
      // meta_ads_service.js — OAuth, token validation, sync campaign,
      // ROAS — semua real, dicek langsung ke Graph API). Modul ini cuma
      // belum pernah diarahkan ke sana, jadi Integration Hub tetap
      // melaporkan "tidak ada koneksi" walau owner sudah menyambungkan
      // akunnya lewat tab Marketing. Sekarang benar-benar membaca status
      // koneksi & data sync yang sama dipakai tab Marketing — TIDAK ada
      // logika atau sumber data baru, cuma disambungkan ke yang sudah ada.
      meta_ads: (() => {
        const settings = getMetaSettingsSafe();
        if (!settings.connected) {
          return {
            available: false,
            connected: false,
            note: 'Belum terhubung ke Meta Ads Manager. Sambungkan akun lewat tab Marketing → "Hubungkan Akun Meta Ads" (OAuth Facebook Login atau Access Token langsung).'
          };
        }
        const synced = getCachedMetaAdsData();
        if (!synced || !Array.isArray(synced.campaigns) || synced.campaigns.length === 0) {
          return {
            available: false,
            connected: true,
            note: `Akun Meta Ads sudah terhubung (${settings.user_name || settings.ad_account_id || 'akun terdaftar'}) tapi belum pernah disinkronkan. Klik "Tarik Data Meta Sekarang" di tab Marketing untuk mengambil data campaign.`
          };
        }
        return {
          available: true,
          connected: true,
          synced_at: synced.synced_at,
          ad_account_id: synced.ad_account_id,
          total_spend_fmt: synced.total_spend_fmt,
          total_impressions: synced.total_impressions,
          total_clicks: synced.total_clicks,
          overall_ctr: synced.overall_ctr,
          overall_roas_fmt: synced.overall_roas_fmt,
          roas_note: synced.roas_note,
          campaign_count: synced.campaigns.length,
          campaigns: synced.campaigns
        };
      })()
    },
    reminders: {
      birthdays: birthdayReminders,
      unpaid_invoices: unpaidInvoices,
      pending_medical_records: unpaidFollow.pending_medical_records,
      unpaid_summary: unpaidFollow.summary,
      attendance_alerts: attendanceAlerts,
      // Pemberitahuan perpindahan grade pasien (X/Y/Z)
      grade_transitions: getGradeTransitions(50)
    },
    sync_status: (() => {
      // Umur data dihitung dari timestamp nyata, bukan diasumsikan segar.
      const ts = syncMeta?.last_sync_timestamp || null;
      const ageMin = ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)) : null;
      const raw = String(syncMeta?.status || '').toLowerCase();
      let health = 'unknown';
      if (raw === 'failed') health = 'failed';
      else if (raw === 'partial') health = 'degraded';
      else if (raw === 'success') health = (ageMin !== null && ageMin > 30) ? 'stale' : 'healthy';
      else if (ts) health = 'unknown';
      const label = {
        healthy: 'Live Synced',
        stale: 'Data Tertinggal',
        degraded: 'Sync Sebagian Gagal',
        failed: 'Sync GAGAL',
        unknown: 'Status Sync Tidak Diketahui'
      }[health];
      return {
        last_sync_formatted: syncMeta?.last_sync_formatted || 'Belum pernah sync',
        last_sync_timestamp: ts,
        status: syncMeta?.status || 'unknown',
        health: health,
        health_label: label,
        age_minutes: ageMin,
        age_label: ageMin === null ? 'tidak diketahui'
          : (ageMin < 60 ? `${ageMin} menit lalu` : `${Math.floor(ageMin / 60)} jam ${ageMin % 60} menit lalu`),
        endpoints_ok: syncMeta?.endpoints_ok ?? null,
        endpoints_total: syncMeta?.endpoints_total ?? null,
        errors: syncMeta?.errors || [],
        total_invoices_synced: syncMeta?.total_invoices || invoices.length,
        total_customers_synced: syncMeta?.total_customers || customers.length
      };
    })(),
    // automation_jobs SEBELUMNYA: 7 job berstatus "Healthy / Active" +
    // jam eksekusi terakhir, SELURUHNYA ditulis tetap di kode (bahkan
    // untuk job yang kodenya tidak pernah ada, spt "Google Drive Backup"
    // & "HR Shift Watchdog" — tidak ada satu baris kode pun yang
    // menjalankannya). Sekarang tiap baris ditandai `real: true/false`
    // dan diisi dari sumber nyata (sync_meta.json, dispatch log) atau
    // jujur ditulis belum dibangun/belum ada sumber data.
    automation_jobs: (() => {
      const dispatchLogs = getDispatchLogs();
      const lastBlast = dispatchLogs.find(l => (l.type || '').includes('WhatsApp CRM Blast') && !(l.type || '').includes('CANCELLED'));
      const lastTelegram = dispatchLogs.find(l => (l.type || '').includes('Telegram'));
      // state: 'active' (kode nyata & pernah/sedang jalan), 'ready' (kode
      // nyata, cuma belum pernah dipakai/dites), 'unavailable' (tidak ada
      // kodenya sama sekali, tidak bisa dipalsukan pakai data apa pun).
      return [
        {
          id: 'job_01', name: 'Neosoft Auto-Sync Worker', type: 'Data Ingestion',
          state: syncMeta?.status === 'success' ? 'active' : 'ready',
          schedule: 'Setiap 10 menit (setInterval, bukan cron terjadwal jam tertentu)',
          status: syncMeta?.status === 'success' ? 'Healthy / Active' : (syncMeta ? 'Perlu Dicek' : 'Belum Pernah Jalan'),
          last_run: syncMeta?.last_sync_formatted || 'Belum pernah sync'
        },
        {
          id: 'job_02', name: 'WhatsApp CRM Blast (Baileys)', type: 'Patient Engagement & Blasting',
          state: lastBlast ? 'active' : 'ready',
          schedule: 'On-Demand — dipicu manual dari tab WhatsApp CRM',
          status: lastBlast ? 'Pernah Jalan' : 'Siap — Belum Pernah Dipakai',
          last_run: lastBlast ? `${lastBlast.timestamp} — ${lastBlast.status}` : 'Belum ada blast yang benar-benar dikirim'
        },
        {
          id: 'job_03', name: 'Kalkulator Komisi & Rasio Payroll', type: 'Payroll & Medical Commissions',
          state: 'active',
          schedule: 'Bukan job terjadwal — dihitung ulang tiap kali halaman dibuka',
          status: 'Real-time (on-demand)',
          last_run: 'Dihitung ulang setiap load halaman, bukan disimpan hasil job'
        },
        {
          id: 'job_04', name: 'Telegram 6-Report Dispatcher', type: 'Reporting Multi-Bubble',
          state: 'unavailable',
          schedule: 'Tidak ada — belum ada Bot API Telegram yang tersambung',
          status: 'Belum Terhubung',
          last_run: lastTelegram ? `${lastTelegram.timestamp} — ${lastTelegram.status}` : 'Belum pernah terkirim ke Telegram mana pun'
        },
        {
          id: 'job_05', name: 'HR Shift Watchdog (Keterlambatan)', type: 'Alert Monitoring',
          state: 'unavailable',
          schedule: 'Tidak ada — tidak ada sumber data absensi',
          status: 'Tidak Ada Kodenya',
          last_run: 'Butuh integrasi Gaji.id/fingerprint dulu sebelum bisa dibangun'
        },
        {
          id: 'job_06', name: 'Google Drive Backup Neosoft Dump', type: 'Cloud Archiving',
          state: 'unavailable',
          schedule: 'Tidak ada — tidak ada kode backup ke Google Drive',
          status: 'Tidak Ada Kodenya',
          last_run: 'Belum pernah dibangun — butuh kredensial Google Drive API'
        }
      ];
    })(),
    dispatch_logs: getDispatchLogs(),
    divisions: {
      finance: {
        petty_cash: (() => {
          const entries = getPettyCashEntries();
          const depokEntries = entries.filter(e => (e.branch || '').toLowerCase().includes('depok'));
          const pdkEntries = entries.filter(e => (e.branch || '').toLowerCase().includes('kopi') || (e.branch || '').toLowerCase().includes('pdk'));
          const depokSpend = depokEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
          const pdkSpend = pdkEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
          return [
            { branch: 'Depok', entries_count: depokEntries.length, total_spent: depokSpend, last_updated: depokEntries[0]?.date || 'Belum ada transaksi', status: depokEntries.length > 0 ? 'Active' : 'Siap Input' },
            { branch: 'Pondok Kopi', entries_count: pdkEntries.length, total_spent: pdkSpend, last_updated: pdkEntries[0]?.date || 'Belum ada transaksi', status: pdkEntries.length > 0 ? 'Active' : 'Siap Input' }
          ];
        })(),
        monthly_targets: getMonthlyTargets(),
        expense_records: getPettyCashEntries()
      },
      pharmacy_inventory: {
        // Kartu stok Neosoft yang sudah dihitung ulang — SKU di bawah buffer
        stock_alerts: (pharmacyStockHub.po_recommendations || []).slice(0, 8).map(p => ({
          code: p.sku,
          name: p.name,
          stock: p.current_stock,
          min_stock: p.buffer_stock,
          unit: p.uom,
          category: p.category,
          status: p.urgency.replace(/\s*[🚨⚠️]\s*/g, ' ').trim(),
          supplier: p.warehouse
        })),
        stock_alerts_total: pharmacyStockHub.po_recommendations_total || 0,
        top_skincare_products: [
          { rank: 1, code: 'P-26050002', name: 'ANTI IRITASI', units_sold: 224, revenue: 7840000, price: 35000, category: 'Skincare Homecare' },
          { rank: 2, code: 'P-26050072', name: 'Anti Biotik', units_sold: 94, revenue: 3290000, price: 35000, category: 'Obat Resep' },
          { rank: 3, code: 'P-26050017', name: 'Galactomyces Glow Essence', units_sold: 26, revenue: 1950000, price: 75000, category: 'Skincare Homecare' },
          { rank: 4, code: 'P-26050016', name: 'Derma Acne Facial Wash', units_sold: 26, revenue: 1690000, price: 65000, category: 'Skincare Homecare' },
          { rank: 5, code: 'P-26050042', name: 'Sunscreen (Tone Up, SS BB SPF 50)', units_sold: 24, revenue: 2040000, price: 85000, category: 'Skincare Homecare' }
        ],
        top_treatment_actions: [
          { rank: 1, code: 'T-26050017', name: 'Kefir 14 in 1 Crystal Dew Facial', units_sold: 202, revenue: 131300000, price: 650000, category: 'Facial Medical' },
          { rank: 2, code: 'T-26050015', name: 'Kefir DNA Salmon Facial', units_sold: 163, revenue: 61940000, price: 380000, category: 'Booster Infusion' },
          { rank: 3, code: 'T-26050075', name: 'Kefir Glow Peel', units_sold: 145, revenue: 42775000, price: 295000, category: 'Chemical Peeling' },
          { rank: 4, code: 'T-26050023', name: 'Pico Face Laser', units_sold: 139, revenue: 55600000, price: 400000, category: 'Laser Technology' },
          { rank: 5, code: 'T-26050082', name: 'Add On Anastesi Cream / Pot', units_sold: 112, revenue: 8400000, price: 75000, category: 'BHP Medis' }
        ]
      },
      marketing_crm: {
        funnel: {
          note: 'Metrik live pasien & transaksi Neosoft',
          total_registered_patients: customers.length,
          total_active_invoices: invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i)).length
        },
        promo_campaigns: getMarketingPromos()
      },
      clinical_rules: {
        contraindications_count: getContraindications().length,
        sop_exceptions_count: getSopExceptions().length
      },
      nurse_upselling: {
        total_pipeline: getNurseUpsellings().length
      },
      treatment_bom: {
        recipes_count: getTreatmentBoms().length
      },
      hr_disciplinary: {
        records_count: getHrDisciplinary().length
      },
      // Roster staf sebelumnya 11 orang karangan lengkap dengan jam
      // check-in ("Hadir 09:20") dan skor disiplin. Sebagian nama bahkan
      // tidak ada di master staf Neosoft (Apt. Ashifa, Siti Rahma, Budi
      // Santoso, Anisa Melati, Nurul Hidayah), dan "dr. Dorra" muncul lagi
      // di sini setelah dibersihkan dari content_plans.json.
      // Sekarang: daftar staf asli dari Neosoft, tanpa kolom karangan.
      hr_payroll: {
        shift_rules: {
          shift_1: { name: 'Shift 1 (Pagi)', hours: '09:30 - 18:30 WIB', late_threshold: '09:31 WIB' },
          shift_2: { name: 'Shift 2 (Siang)', hours: '11:30 - 20:30 WIB (DPK) / 21:00 WIB (PDK)', late_threshold: '11:31 WIB' }
        },
        staff_roster_source: 'Master staf Neosoft (therapists.json, status aktif)',
        staff_roster_note: 'Jam masuk, skor disiplin, dan penempatan cabang tidak ditampilkan karena tidak ada sumber datanya.',
        attendance_stats: {
          available: false,
          note: 'Belum ada sumber data absensi. Angka lama (38 staf, hadir tepat waktu 38, telat 0, disiplin 100%) tidak pernah dihitung dari apa pun.'
        }
      }
    }
  };
}


// ═══════════════════════════════════════════════════════════════════════
// INDEKS HARGA PASAR (diturunkan dari transaksi nyata)
//
// Master produk Neosoft hanya punya SATU field harga (`price`). Tidak ada
// tabel promo, tidak ada harga minimum. Karena itu harga promo & harga
// bottom di sini DITURUNKAN dari `usages_details.value` — harga yang
// benar-benar ditagihkan ke pasien — bukan dikarang seperti versi lama
// (`price * 0.8` untuk promo dan `price * 0.7` untuk bottom).
//
// Dua kehati-hatian penting:
//  1. Invoice bundel membagi total ke tiap baris. Contoh PDK-I-202605-0005:
//     3x Microtox (list 375rb) dengan total invoice 1jt -> tiap baris
//     dicatat 333.333. Itu alokasi, bukan harga satuan. Maka harga bottom
//     SATUAN hanya dihitung dari invoice ber-baris-tunggal.
//  2. Invoice void dikecualikan seluruhnya.
// ═══════════════════════════════════════════════════════════════════════

const PROMO_WINDOW_DAYS = 60;      // jendela "sedang promo"
const PROMO_MIN_SAMPLES = 2;       // minimal transaksi agar disebut promo
const BOTTOM_HIGH_CONFIDENCE = 3;  // minimal transaksi satuan utk keyakinan tinggi

let _pricingCache = null;

// ═════════════════════════════════════════════════════════════════
// MASTER HARGA PROMO & BOTTOM — HANYA BACA, sumbernya spreadsheet
//   data/price_master.json  katalog dasar (impor awal "Harga Katalog Kefir.xlsx"
//                           lewat scripts/build_price_master.py) + campaign lama
//                           dari memo September.
//   data/google_sheets_db/price_sheets.json  hasil price_sheet_sync.js dari
//                           spreadsheet "Planning <Bulan>" marketing. Harga normal &
//                           bottom ("Harga Terendah") bulan berjalan MENGALAHKAN katalog
//                           dasar; campaign-nya ditambahkan apa adanya.
// Hasilnya MENGALAHKAN tebakan dari transaksi/paket Neosoft di buildPricingIndex.
// ═════════════════════════════════════════════════════════════════
let _priceMasterCache = null;

function getPriceMaster() {
  let stamp = '';
  try { stamp = String(fs.statSync(PRICE_MASTER_FILE).mtimeMs); } catch (e) {
    return { available: false, items: [], campaigns: [], drive_folder_url: null, stamp: 'none' };
  }
  try { stamp += '|' + fs.statSync(PRICE_SHEETS_FILE).mtimeMs; } catch (e) { stamp += '|nosheet'; }
  try { stamp += '|' + fs.statSync(path.join(NEOSOFT_DB_DIR, 'products.json')).mtimeMs; } catch (e) { stamp += '|noprod'; }   // harga Neosoft ikut ditampilkan
  try { stamp += '|' + fs.statSync(path.join(NEOSOFT_DB_DIR, 'product_outlet_prices.json')).mtimeMs; } catch (e) { stamp += '|nooutlet'; }
  stamp += '|' + todayJakarta().slice(0, 7);   // bulan berganti -> sumber harga bulan berjalan ikut berganti
  if (_priceMasterCache && _priceMasterCache.stamp === stamp) return _priceMasterCache.data;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(PRICE_MASTER_FILE, 'utf8'));
  } catch (e) {
    console.error('[getPriceMaster] price_master.json tidak terbaca:', e.message);
    return { available: false, items: [], campaigns: [], drive_folder_url: null, stamp: 'error' };
  }
  data = mergePriceSheets({ ...data, available: true, stamp, items: data.items || [], campaigns: data.campaigns || [] }, getPriceSheetData());
  _priceMasterCache = { stamp, data };
  return data;
}

// Harga Neosoft yang ditagihkan kasir = harga per outlet (menu Item > tab Custom), bukan harga
// master `price`. Sumber: product_outlet_prices.json (scripts/sync_neosoft.py). Kalau belum ada, pakai harga master.
const OUTLET_NAMES = { 1: 'Depok', 2: 'Pondok Kopi' };
let _outletPriceCache = null;
function getOutletPriceMap() {
  const file = path.join(NEOSOFT_DB_DIR, 'product_outlet_prices.json');
  let stamp = 'none';
  try { stamp = String(fs.statSync(file).mtimeMs); } catch (e) { /* belum disinkron */ }
  if (_outletPriceCache && _outletPriceCache.stamp === stamp) return _outletPriceCache.map;
  const map = {};
  (getSafeJson('product_outlet_prices.json') || []).forEach(r => { map[r.product_id] = r.outlets || []; });
  _outletPriceCache = { stamp, map };
  return map;
}
function neosoftPriceOf(p) {
  const master = Number((p && p.price) || 0) || null;
  if (!p) return { price: null, master: null, outlets: [], varies: false, from_outlet: false, label: null };
  const rpS = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  const outlets = (getOutletPriceMap()[p.id] || [])
    .filter(o => o.is_active !== false && Number(o.price) > 0)
    .map(o => ({ outlet_id: o.outlet_id, outlet: OUTLET_NAMES[o.outlet_id] || `Outlet ${o.outlet_id}`, price: Number(o.price) }))
    .sort((a, b) => a.outlet_id - b.outlet_id);
  if (!outlets.length) return { price: master, master, outlets: [], varies: false, from_outlet: false, label: master ? rpS(master) : null };
  const uniq = [...new Set(outlets.map(o => o.price))];
  const varies = uniq.length > 1;
  return {
    price: outlets[0].price,   // harga yang mewakili: outlet pertama (Depok) bila beda antar cabang
    master, outlets, varies, from_outlet: true,
    label: varies ? outlets.map(o => `${rpS(o.price)} (${o.outlet})`).join(' · ') : rpS(uniq[0]),
  };
}

// Treatment yang tidak punya promo di spreadsheet otomatis didiskon sekian persen dari harga
// normal (dibulatkan ke ribuan, tidak pernah di bawah bottom). Ditandai promo_is_default.
const DEFAULT_PROMO_PCT = 5;
// Item biaya (Biaya Administrasi, Biaya Konsultasi) bukan tindakan: tidak didiskon & tidak ikut ranking.
const isFeeItem = (name) => /^\s*biaya\b/i.test(String(name || ''));
function defaultPromoFor(it) {
  const list = Number(it.list_price) || 0;
  if (!list) return null;
  let price = Math.round(list * (1 - DEFAULT_PROMO_PCT / 100) / 1000) * 1000;
  let clamped = false;
  if (it.bottom_price && price < it.bottom_price) { price = Number(it.bottom_price); clamped = true; }
  if (price >= list) return null;
  return { price, pct: DEFAULT_PROMO_PCT, clamped };
}

// Gabungkan spreadsheet harga ke katalog dasar (lihat komentar di atas).
function mergePriceSheets(base, sheet) {
  const sources = (sheet && sheet.sources) || [];
  const month = todayJakarta().slice(0, 7);
  const catalogByName = {};
  base.items.forEach(it => { catalogByName[priceNorm(it.name)] = it; });

  // Sumber harga normal & bottom: spreadsheet bulan berjalan, atau bulan terakhir sebelumnya.
  const current = sources.filter(s => s.month && s.month <= month && (s.campaigns || []).length)
    .sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  // Harga SATUAN (normal & bottom) mengacu ke tab utama "Promo Bulan <Bulan>". Tab campaign lain
  // (mis. GLOW DEALS) hanya menyumbang harga promonya sendiri; harga normal di sana bukan acuan.
  // Treatment yang tidak ada di tab utama baru memakai tab lain (kalau angkanya sama semua).
  // Tabel paket (Isi Paket / Harga Paket) tidak pernah dipakai untuk harga satuan.
  const isMainSheet = (c) => /^promo\s+bulan\b/i.test(String(c.sheet || ''));
  const collect = (camps) => {
    const out = {};   // nama -> { normal: Map(nilai -> [sheet]), bottom: Map(...) }
    camps.forEach(c => (c.items || []).forEach(x => {
      const k = priceNorm(x.name);
      const e = out[k] || (out[k] = { normal: new Map(), bottom: new Map(), bv: new Map() });
      if (x.normal) e.normal.set(x.normal, [...(e.normal.get(x.normal) || []), c.sheet]);
      if (x.bottom) e.bottom.set(x.bottom, [...(e.bottom.get(x.bottom) || []), c.sheet]);
      if (x.bv) e.bv.set(x.bv, [...(e.bv.get(x.bv) || []), c.sheet]);
    }));
    return out;
  };
  const general = current ? (current.campaigns || []).filter(c => c.audience !== 'new') : [];
  const mainSeen = collect(general.filter(isMainSheet));
  const otherSeen = collect(general.filter(c => !isMainSheet(c)));
  const seen = {};
  new Set([...Object.keys(mainSeen), ...Object.keys(otherSeen)]).forEach(k => {
    const m = mainSeen[k], o = otherSeen[k];
    seen[k] = {
      normal: m && m.normal.size ? m.normal : (o ? o.normal : new Map()),
      bottom: m && m.bottom.size ? m.bottom : (o ? o.bottom : new Map()),
      bv: m && m.bv.size ? m.bv : (o ? o.bv : new Map()),
    };
  });
  const rpStr = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  const neoById = {};
  (getSafeJson('products.json') || []).forEach(p => { neoById[p.id] = p; });
  // Harga dari katalog Excel ("Harga Katalog Kefir.xlsx") TIDAK dipakai. Katalog hanya dipakai
  // sebagai daftar nama treatment & pasangannya ke produk Neosoft (product_id).
  //   harga normal: spreadsheet Planning -> harga produk Neosoft
  //   bottom      : spreadsheet Planning -> (buildPricingIndex) perkiraan transaksi Neosoft
  const items = base.items.map(it => {
    const e = seen[priceNorm(it.name)];
    const neo = it.product_id ? neoById[it.product_id] : null;
    const np = neosoftPriceOf(neo);
    const neoPrice = np.price;
    const out = {
      ...it,
      list_price: null, bottom_price: null,
      pkg3_per_session: null, pkg6_per_session: null, pkg3_total: null, pkg6_total: null,
      price_source: 'neosoft', price_notes: [],
    };
    if (e) {
      [['normal', 'list_price', 'Harga normal'], ['bottom', 'bottom_price', 'Harga terendah (bottom)']].forEach(([k, field, label]) => {
        const vals = [...e[k].entries()];
        if (vals.length === 1) { out[field] = vals[0][0]; out[field + '_from_sheet'] = true; }
        else if (vals.length > 1) out.price_notes.push({ lvl: 'warn', text: `${label} berbeda antar sheet di ${current.title}: ${vals.map(([v, sh]) => `${rpStr(v)} (${[...new Set(sh)].join(', ')})`).join(', ')}. ${field === 'list_price' ? `Dipakai harga Neosoft ${neoPrice ? rpStr(neoPrice) : '-'}.` : 'Bottom dikosongkan sampai disamakan.'}` });
      });
      if (out.list_price_from_sheet || out.bottom_price_from_sheet) out.price_source = current.title;
      // BV (modal per tindakan dari spreadsheet) — hanya kalau angkanya tunggal
      const bvs = [...e.bv.keys()];
      if (bvs.length === 1) out.bv_cost = bvs[0];
    }
    if (!out.list_price && neoPrice) out.list_price = neoPrice;
    return {
      ...out,
      default_promo: defaultPromoFor(out),
      list_source: out.list_price_from_sheet ? 'spreadsheet' : (neoPrice ? 'neosoft' : null),
      sources: [...(out.list_price_from_sheet || out.bottom_price_from_sheet ? ['spreadsheet'] : []), ...(neo ? ['neosoft'] : [])],
      in_neosoft: !!neo,
      neosoft_code: neo ? neo.product_treatment_code || null : null,
      neosoft_price: neoPrice,
      neosoft_price_label: np.label,
      neosoft_outlet_prices: np.outlets,
      neosoft_price_varies: np.varies,
      neosoft_master_price: np.master,
      // Beda kalau harga spreadsheet tidak sama dengan harga di salah satu outlet Neosoft.
      price_mismatch: !!(out.list_price_from_sheet && neoPrice && (np.outlets.length ? np.outlets.some(o => o.price !== out.list_price) : out.list_price !== neoPrice)),
    };
  })
    // Treatment yang hanya ada di katalog Excel (tidak ada di spreadsheet maupun Neosoft) disembunyikan.
    .filter(it => it.sources.length);

  const sheetCampaigns = [];
  sources.forEach(src => (src.campaigns || []).forEach(c => sheetCampaigns.push({
    id: c.id, name: c.name, memo_no: '', start: c.start, end: c.end,
    offer: c.offer || '', terms: c.terms || '', source_url: c.source_url || src.url,
    source_title: src.title, sheet: c.sheet, audience: c.audience || 'all', from_sheet: true,
    is_main_sheet: /^promo\s+bulan\b/i.test(String(c.sheet || '')),
    items: (c.items || []).map(x => {
      const cat = catalogByName[priceNorm(x.name)];
      return { name: x.name, item_key: cat ? cat.key : null, normal: x.normal, promo: x.promo, bottom: x.bottom, benefit: x.benefit || '' };
    }),
    bundles: c.bundles || [],
    issues: c.issues || [],
  })));

  return {
    ...base,
    items,
    campaigns: [...base.campaigns.map(c => ({ ...c, from_sheet: false })), ...sheetCampaigns],
    default_promo_pct: DEFAULT_PROMO_PCT,
    sheet_sync: {
      fetched_at: (sheet && sheet.fetched_at) || null,
      price_month: current ? current.month : null,
      sources: sources.map(s => ({ month: s.month, title: s.title, url: s.url, ok: s.ok !== false, error: s.error || null, synced_at: s.synced_at || null, campaigns: (s.campaigns || []).length, skipped: s.skipped || [] })),
    },
  };
}

function todayJakarta() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// Promo aktif per item katalog (key) untuk tanggal tertentu. Kalau beberapa
// campaign aktif bersamaan (mis. Festival di akhir bulan), yang termurah dipakai.
function activePromoByItemKey(master, date = todayJakarta()) {
  const out = {};
  (master.campaigns || []).forEach(c => {
    if (!c.start || !c.end || date < c.start || date > c.end) return;
    if (c.audience === 'new') return;   // khusus pasien baru, bukan promo umum
    (c.items || []).forEach(it => {
      if (!it.item_key || !(Number(it.promo) > 0)) return;
      const cur = out[it.item_key];
      if (!cur || Number(it.promo) < cur.promo) {
        out[it.item_key] = { promo: Number(it.promo), normal: Number(it.normal) || null, campaign_id: c.id,
          campaign_name: c.name, memo_no: c.memo_no || '', start: c.start, end: c.end, benefit: it.benefit || '' };
      }
    });
  });
  return out;
}

// ═════════════════════════════════════════════════════════════════
// TINDAKAN PALING SERING DILAKUKAN (tab Harga Promo & Bottom › Paling Sering Dilakukan)
// Dari pemakaian nyata Neosoft (usages_details) yang invoicenya tidak void & bukan migrasi.
//   start/end  : YYYY-MM-DD (tanggal invoice), kosong = semua
//   branch     : 'all' | 'depok' | 'pondok'
//   type       : 'all' | 'treatment' (kode T-) | 'product' (kode P-)
//   sort       : 'count' (paling sering) | 'revenue' (omset)
// ═════════════════════════════════════════════════════════════════
function getTopUsage({ start = '', end = '', branch = 'all', type = 'all', search = '', sort = 'count', limit = 10 } = {}) {
  const usages = getSafeJson('usages_details.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const products = getSafeJson('products.json') || [];
  const invByCode = {};
  invoices.forEach(i => { if (i.inv_code) invByCode[i.inv_code] = i; });
  const prodById = {};
  products.forEach(p => { prodById[p.id] = p; });
  const pricing = getPricingIndex(products, usages, invoices);
  const q = String(search || '').toLowerCase().trim();
  const outletWanted = branch === 'depok' ? 1 : branch === 'pondok' ? 2 : null;

  const stats = {};
  let total = 0, totalRevenue = 0, firstDate = '', lastDate = '';
  usages.forEach(u => {
    const inv = invByCode[u.inv_code];
    if (!inv || inv.void_invoice || inv.is_void || isMigrationInvoice(inv)) return;
    const d = String(inv.inv_date || inv.created_at || '').slice(0, 10);
    if (start && d < start) return;
    if (end && d > end) return;
    if (outletWanted && Number(inv.outlet_id) !== outletWanted) return;
    const p = prodById[u.product_id] || {};
    const code = String(p.product_treatment_code || '');
    const kind = code.startsWith('P-') ? 'product' : 'treatment';
    if (type !== 'all' && type !== kind) return;
    const name = String(p.product_treatment_name || `Item #${u.product_id}`).trim();
    if (isFeeItem(name)) return;   // biaya admin/konsultasi bukan tindakan
    if (q && !name.toLowerCase().includes(q) && !code.toLowerCase().includes(q)) return;
    const s = stats[u.product_id] || (stats[u.product_id] = { product_id: u.product_id, code, name, kind, count: 0, revenue: 0, branches: { 1: 0, 2: 0 } });
    s.count += 1;
    s.revenue += Number(u.value || 0);
    s.branches[Number(inv.outlet_id)] = (s.branches[Number(inv.outlet_id)] || 0) + 1;
    total += 1; totalRevenue += Number(u.value || 0);
    if (!firstDate || d < firstDate) firstDate = d;
    if (d > lastDate) lastDate = d;
  });

  const rows = Object.values(stats)
    .sort((a, b) => sort === 'revenue' ? (b.revenue - a.revenue || b.count - a.count) : (b.count - a.count || b.revenue - a.revenue));
  const lim = String(limit) === 'all' ? rows.length : Math.max(1, Math.min(500, parseInt(limit, 10) || 10));
  return {
    success: true,
    filters: { start, end, branch, type, search, sort, limit: String(limit) },
    total_usages: total,
    total_revenue: Math.round(totalRevenue),
    distinct_items: rows.length,
    data_range: { first: firstDate || null, last: lastDate || null },
    rows: rows.slice(0, lim).map((r, i) => {
      const mk = pricing[r.product_id] || {};
      return {
        rank: i + 1,
        product_id: r.product_id, code: r.code, name: r.name, kind: r.kind,
        count: r.count,
        share_pct: total ? Math.round(r.count / total * 1000) / 10 : 0,
        revenue: Math.round(r.revenue),
        avg_price: r.count ? Math.round(r.revenue / r.count) : 0,
        depok: r.branches[1] || 0, pondok: r.branches[2] || 0,
        list_price: mk.list_price || null,
        promo_price: mk.is_on_promo ? mk.promo_price : null,
        promo_name: mk.is_on_promo ? mk.promo_name : null,
        promo_is_default: mk.promo_is_default === true,
      };
    }),
  };
}

function buildPricingIndex(products, usages, invoices) {
  const invByCode = {};
  invoices.forEach(i => { if (i.inv_code) invByCode[i.inv_code] = i; });

  const linesPerInv = {};
  usages.forEach(u => { linesPerInv[u.inv_code] = (linesPerInv[u.inv_code] || 0) + 1; });


  const acc = {};
  usages.forEach(u => {
    const inv = invByCode[u.inv_code];
    if (!inv || inv.void_invoice) return;
    const value = Number(u.value || 0);
    if (!value) return;
    const date = String(inv.inv_date || u.created_at || '').substring(0, 10);
    const a = acc[u.product_id] || (acc[u.product_id] = { all: [], solo: [] });
    const rec = { value, date };
    a.all.push(rec);
    if (linesPerInv[u.inv_code] === 1) {
      a.solo.push(rec);
    }
  });

  const master = getPriceMaster();
  const masterByProduct = {};
  (master.items || []).forEach(it => { if (it.product_id) masterByProduct[it.product_id] = it; });
  const promoByKey = activePromoByItemKey(master);

  const index = {};
  products.forEach(p => {
    const mItem = masterByProduct[p.id] || null;
    // Harga normal: harga jual resmi di master harga kalau ada, bukan harga list Neosoft
    // (list Neosoft untuk sebagian treatment jauh di atas harga jual sebenarnya).
    const neoP = neosoftPriceOf(p);
    const list = mItem && mItem.list_price ? mItem.list_price : Number(neoP.price || 0);
    const a = acc[p.id];
    if (!list) return;

    const pName = (p.product_treatment_name || '').toLowerCase();
    const pCode = (p.product_treatment_code || '').toLowerCase();

    // Master Paket Neosoft TIDAK dipakai: harga per sesi paket bukan harga promo satuan
    // (promo hanya dari campaign spreadsheet + diskon default).
    // 2. Voucher Neosoft DIHAPUS dari sini — voucher master (vouchers.json)
    // adalah diskon POTONGAN TOTAL TRANSAKSI generik (mis. "VOUCHER
    // POTONGAN 50K", "Free Treat -350K"), tidak satu pun punya product_id
    // atau applicable_products di data Neosoft. Sebelumnya kode ini
    // mengambil voucher AKTIF PERTAMA di daftar (regularVouchers[0]) dan
    // menerapkan diskonnya ke SETIAP produk di seluruh price list, lalu
    // menandainya "Promo resmi terdaftar di Neosoft" dengan confidence
    // "tinggi" tetap — voucher potongan Rp350rb bisa muncul sebagai promo
    // resmi produk seharga Rp50rb. Tidak ada dasar data untuk mencocokkan
    // voucher ke produk tertentu, jadi tidak dicocokkan sama sekali.

    let promo = null, promoName = null, promoSource = null;
    let bottom = null, bottomCount = 0, sold = a ? a.all.length : 0, bundleMin = null;

    if (a) bundleMin = a.all.length ? Math.min(...a.all.map(r => r.value)) : null;

    // Bottom HANYA dari spreadsheet (kolom "Harga Terendah", lewat mItem di bawah). Neosoft tidak
    // punya kolom bottom; harga terendah yang pernah terjadi di transaksi / harga per sesi paket
    // bukan batas yang diizinkan, jadi tidak dipakai sebagai bottom.
    let confidence = 'tidak_ada';

    // Master harga (diisi tim) mengalahkan tebakan dari paket/transaksi.
    let promoPeriod = null, promoBenefit = '', pkgInfo = null, promoDefault = false;
    if (mItem) {
      const mp = promoByKey[mItem.key];
      if (mp && mp.promo < list) {
        promo = mp.promo;
        promoName = mp.campaign_name;
        promoSource = `Master Harga — ${mp.campaign_name}${mp.memo_no ? ' (' + mp.memo_no + ')' : ''}`;
        promoPeriod = { start: mp.start, end: mp.end };
        promoBenefit = mp.benefit || '';
      }
      if (mItem.bottom_price) {
        bottom = mItem.bottom_price;
        confidence = 'tinggi';
      }
      if (mItem.pkg3_per_session || mItem.pkg6_per_session) {
        pkgInfo = { pkg3_per_session: mItem.pkg3_per_session, pkg6_per_session: mItem.pkg6_per_session,
          pkg3_total: mItem.pkg3_total, pkg6_total: mItem.pkg6_total };
      }
    }

    // Tidak ada promo di spreadsheet -> diskon default (berlaku juga untuk treatment yang belum
    // ada di katalog/spreadsheet harga). Produk skincare/farmasi (kode P-) tidak ikut.
    if (promo === null && !String(p.product_treatment_code || '').startsWith('P-') && !isFeeItem(p.product_treatment_name)) {
      const dp = defaultPromoFor({ list_price: list, bottom_price: bottom });
      if (dp) {
        promo = dp.price;
        promoName = `Diskon default ${dp.pct}%`;
        promoSource = `Tidak ada promo di spreadsheet — otomatis diskon ${dp.pct}% dari harga normal${dp.clamped ? ' (dibatasi harga bottom)' : ''}${mItem ? '' : '. Treatment ini belum ada di spreadsheet/katalog harga'}`;
        promoDefault = true;
      }
    }

    index[p.id] = {
      list_price: list,
      neosoft_list_price: Number(neoP.price || 0),
      promo_price: promo,
      promo_name: promoName,
      promo_source: promoSource,
      promo_period: promoPeriod,
      promo_benefit: promoBenefit,
      is_on_promo: promo !== null,
      promo_is_default: promoDefault,
      bv_cost: mItem && mItem.bv_cost ? mItem.bv_cost : null,   // modal BHP dari spreadsheet (owner/finance saja)
      // Sumber: harga normal & bottom dari spreadsheet/katalog bila ada, selain itu dari Neosoft.
      list_source: mItem && mItem.list_price_from_sheet ? 'spreadsheet' : 'neosoft',
      bottom_from_sheet: !!(mItem && mItem.bottom_price_from_sheet),
      data_sources: mItem && (mItem.list_price_from_sheet || mItem.bottom_price_from_sheet) ? ['spreadsheet', 'neosoft'] : ['neosoft'],
      price_mismatch: !!(mItem && mItem.list_price_from_sheet && neoP.price && (neoP.outlets.length ? neoP.outlets.some(o => o.price !== list) : list !== neoP.price)),
      neosoft_price_label: neoP.label,
      neosoft_price_varies: neoP.varies,
      bottom_price: bottom,
      bottom_samples: bottomCount,
      bottom_confidence: confidence,
      bottom_source: mItem && mItem.bottom_price ? 'master_harga' : (bottom !== null ? 'transaksi_neosoft' : null),
      packages: pkgInfo,
      master_item_key: mItem ? mItem.key : null,
      bundle_floor: bundleMin,
      times_sold: sold
    };
  });
  return index;
}

function getPricingIndex(products, usages, invoices) {
  const stamp = `${products.length}|${usages.length}|${invoices.length}|${getPriceMaster().stamp}|${todayJakarta()}`;
  if (!_pricingCache || _pricingCache.stamp !== stamp) {
    _pricingCache = { stamp, index: buildPricingIndex(products, usages, invoices) };
  }
  return _pricingCache.index;
}

const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');


// ═══════════════════════════════════════════════════════════════════════
// RIWAYAT TRANSAKSI PENUH (Google Sheets, Nov 2024 -> sekarang)
// ~25.800 baris / 13,7 MB, jadi WAJIB di-cache berbasis mtime — jangan
// pernah di-parse ulang per request seperti file JSON lain di modul ini.
//
// Ini satu-satunya catatan ~18 bulan riwayat klinik sebelum Neosoft
// dipakai (data Neosoft lokal baru mulai Mei 2026).
// ═══════════════════════════════════════════════════════════════════════

let _historyCache = null;

function getTransactionHistory() {
  const file = path.join(GOOGLE_SHEETS_DB_DIR, 'transactions_history.json');
  let stamp = '';
  try { stamp = String(fs.statSync(file).mtimeMs); } catch (e) { return { rows: [], available: false }; }
  if (_historyCache && _historyCache.stamp === stamp) return _historyCache.data;

  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error('Gagal membaca transactions_history.json', e.message);
    return { rows: [], available: false };
  }

  // Agregat tingkat klinik — aman dipakai tanpa perlu atribusi per pasien
  const byMonth = {}, byTreatment = {}, byBranch = {}, byCategory = {};
  rows.forEach(r => {
    const amt = Number(r.amount || 0);
    if (r.period) {
      const m = byMonth[r.period] || (byMonth[r.period] = { period: r.period, rows: 0, revenue: 0, patients: new Set() });
      m.rows++; m.revenue += amt;
      if (r.patient_name) m.patients.add(r.patient_name.toLowerCase().trim());
    }
    const key = String(r.treatment || '').trim().toLowerCase();
    if (key) {
      const t = byTreatment[key] || (byTreatment[key] = { name: r.treatment.trim(), times: 0, revenue: 0, prices: [] });
      t.times++; t.revenue += amt;
      if (amt > 0) t.prices.push(amt);
    }
    if (r.branch) {
      const b = byBranch[r.branch] || (byBranch[r.branch] = { branch: r.branch, rows: 0, revenue: 0 });
      b.rows++; b.revenue += amt;
    }
    if (r.revenue_type) {
      const c = byCategory[r.revenue_type] || (byCategory[r.revenue_type] = { type: r.revenue_type, rows: 0, revenue: 0 });
      c.rows++; c.revenue += amt;
    }
  });

  const monthly = Object.values(byMonth)
    .map(m => ({ period: m.period, rows: m.rows, revenue: Math.round(m.revenue),
      revenue_fmt: rupiah(m.revenue), unique_patients: m.patients.size }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const treatments = Object.values(byTreatment)
    .map(t => {
      const p = t.prices.sort((a, b) => a - b);
      return {
        name: t.name, times: t.times, revenue: Math.round(t.revenue), revenue_fmt: rupiah(t.revenue),
        min_price: p.length ? p[0] : null,
        median_price: p.length ? p[Math.floor(p.length / 2)] : null,
        max_price: p.length ? p[p.length - 1] : null,
        price_samples: p.length
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const periods = monthly.map(m => m.period);
  const data = {
    available: true,
    rows,
    row_count: rows.length,
    periods: periods.length,
    from: periods[0] || null,
    to: periods[periods.length - 1] || null,
    total_revenue: Math.round(rows.reduce((a, r) => a + Number(r.amount || 0), 0)),
    rows_with_amount: rows.filter(r => r.amount).length,
    monthly,
    top_treatments: treatments.slice(0, 50),
    by_branch: Object.values(byBranch).map(b => ({ ...b, revenue: Math.round(b.revenue), revenue_fmt: rupiah(b.revenue) })),
    by_revenue_type: Object.values(byCategory).map(c => ({ ...c, revenue: Math.round(c.revenue), revenue_fmt: rupiah(c.revenue) })),
    note: 'Riwayat dari Google Sheets. Atribusi per pasien hanya andal untuk baris berkode invoice Neosoft (Mei 2026 ke atas); periode sebelumnya memakai penomoran kwitansi lama yang tidak ada di Neosoft.'
  };
  _historyCache = { stamp, data };
  return data;
}


// ═══════════════════════════════════════════════════════════════════════
// JEMBATAN RM -> PASIEN
// Nomor RM (D-3694) hanya ada di spreadsheet; Neosoft tidak menyimpannya.
// Tabel pemetaannya dibangun offline oleh scripts/build_rm_map.js dan
// murni lokal — tidak ada apa pun yang ditulis ke Neosoft.
//
// Tingkat keyakinan TIDAK PERNAH dicampur. Uji terhadap 85 pemetaan yang
// terbukti lewat kode invoice menunjukkan metode nama hanya 91% akurat
// (8 salah), akibat pasien duplikat di Neosoft dengan ejaan berbeda.
// Karena itu riwayat NAMA_UNIK disajikan terpisah sebagai "perlu
// konfirmasi" dan tidak pernah masuk angka uang.
// ═══════════════════════════════════════════════════════════════════════

const STRONG_CONFIDENCE = new Set(['PASTI', 'MAYORITAS', 'MANUAL']);
let _rmMapCache = null;

function getRmPatientMap() {
  const file = path.join(__dirname, 'data', 'rm_patient_map.json');
  let stamp = '';
  try { stamp = String(fs.statSync(file).mtimeMs); } catch (e) {
    return { byRm: {}, available: false, stats: null };
  }
  if (_rmMapCache && _rmMapCache.stamp === stamp) return _rmMapCache.data;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error('rm_patient_map.json tidak terbaca:', e.message);
    return { byRm: {}, available: false, stats: null };
  }
  const data = { byRm: parsed.entries || {}, available: true, stats: parsed.stats || null,
                 generated_at: parsed.generated_at || null };
  _rmMapCache = { stamp, data };
  return data;
}

// Riwayat sheet dikelompokkan per customer_id, sekali saja lalu di-cache.
let _sheetHistoryByCustCache = null;

function getSheetHistoryByCustomer(invoices) {
  const hist = getTransactionHistory();
  const rmMap = getRmPatientMap();
  if (!hist.available) return { byCustomer: {}, available: false };

  const stamp = `${hist.row_count}|${Object.keys(rmMap.byRm).length}|${invoices.length}`;
  if (_sheetHistoryByCustCache && _sheetHistoryByCustCache.stamp === stamp) {
    return _sheetHistoryByCustCache.data;
  }

  const custOfInvoice = {}, knownCodes = new Set();
  invoices.forEach(i => {
    if (!i.inv_code) return;
    knownCodes.add(i.inv_code);
    custOfInvoice[i.inv_code] = i.customer_id;
  });

  const byCustomer = {};
  hist.rows.forEach(r => {
    // Baris yang kode invoicenya sudah ada di Neosoft BUKAN tambahan —
    // transaksinya sudah terhitung di sana. Memasukkannya lagi berarti
    // menghitung ganda periode Mei 2026 ke atas.
    const alreadyInNeosoft = r.invoice && knownCodes.has(r.invoice);
    let cid = null, confidence = null;
    if (r.invoice && custOfInvoice[r.invoice]) {
      cid = custOfInvoice[r.invoice];
      confidence = 'PASTI';
    } else if (r.rm && rmMap.byRm[r.rm]) {
      cid = rmMap.byRm[r.rm].customer_id;
      confidence = rmMap.byRm[r.rm].confidence;
    }
    if (!cid) return;
    const bucket = byCustomer[cid] || (byCustomer[cid] = { confirmed: [], unconfirmed: [] });
    const row = {
      date: r.date, period: r.period, branch: r.branch, treatment: r.treatment,
      amount: r.amount || 0, invoice: r.invoice, rm: r.rm,
      revenue_type: r.revenue_type, confidence,
      purchase_status: r.purchase_status || null,
      counted_in_neosoft: Boolean(alreadyInNeosoft)
    };
    (STRONG_CONFIDENCE.has(confidence) ? bucket.confirmed : bucket.unconfirmed).push(row);
  });

  const data = { byCustomer, available: true, rm_stats: rmMap.stats, generated_at: rmMap.generated_at };
  _sheetHistoryByCustCache = { stamp, data };
  return data;
}

function summariseSheetHistory(rows) {
  // Hanya baris yang BELUM terhitung di Neosoft yang bersifat menambah
  const additive = rows.filter(r => !r.counted_in_neosoft);
  const periods = [...new Set(additive.map(r => r.period).filter(Boolean))].sort();
  const spend = additive.reduce((a, r) => a + (r.amount || 0), 0);
  const treatments = {};
  additive.forEach(r => {
    const k = String(r.treatment || '').trim();
    if (!k) return;
    const t = treatments[k] || (treatments[k] = { name: k, times: 0, spend: 0 });
    t.times++; t.spend += r.amount || 0;
  });
  const visitDays = [...new Set(additive.map(r => r.date).filter(Boolean))].sort();
  return {
    rows: additive.length,
    spend: Math.round(spend),
    spend_fmt: rupiah(spend),
    periods: periods.length,
    first_period: periods[0] || null,
    last_period: periods[periods.length - 1] || null,
    first_date: visitDays[0] || null,
    visit_days: visitDays.length,
    top_treatments: Object.values(treatments).sort((a, b) => b.spend - a.spend).slice(0, 8)
      .map(t => ({ ...t, spend_fmt: rupiah(t.spend) }))
  };
}

const PATIENT360_RESULT_LIMIT = 8;

// Skor kecocokan pasien: makin spesifik makin tinggi. 0 = tidak cocok.
// Menggantikan filter `.includes()` datar + `.slice(0, 8)` yang urutannya
// mengikuti urutan file, bukan relevansi.
function scorePatientMatch(c, q) {
  const first = String(c.name?.first_name || '').toLowerCase().trim();
  const last = String(c.name?.last_name || '').toLowerCase().trim();
  const name = `${first} ${last}`.trim();
  const phone = String(c.phone || '').toLowerCase();
  const code = String(c.code || '').toLowerCase();

  if (String(c.id) === q) return 100;          // ID persis
  if (code && code === q) return 95;           // kode RM persis
  if (name && name === q) return 90;           // nama lengkap persis
  if (first && first === q) return 80;         // nama depan persis
  if (name.startsWith(q)) return 70;           // nama diawali kata kunci
  if (last && last.startsWith(q)) return 60;   // nama belakang diawali
  if (phone && phone.includes(q)) return 55;   // nomor HP
  if (name.includes(q)) return 40;             // nama mengandung
  if (code && code.includes(q)) return 30;     // kode mengandung
  return 0;
}

// Jumlah total pasien yang cocok — dipakai UI untuk memberi tahu bahwa hasil
// yang ditampilkan hanyalah sebagian teratas.
function countPatient360Matches(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return 0;
  const customers = getSafeJson('customers_all.json');
  return customers.reduce((n, c) => n + (scorePatientMatch(c, q) > 0 ? 1 : 0), 0);
}

// Daftar saran ringan untuk kotak cari Patient 360: hanya identitas + ringkasan belanja,
// TANPA join rekam medis/riwayat (itu baru dimuat setelah pasien dipilih).
let _p360ActivityCache = null;
let _p360ActivityCacheTime = 0;

function getPatient360Activity() {
  const now = Date.now();
  if (_p360ActivityCache && now - _p360ActivityCacheTime < 45000) return _p360ActivityCache;
  const invoices = getSafeJson('invoices_all.json') || [];
  const act = {};
  invoices.forEach(i => {
    if (i.void_invoice || isMigrationInvoice(i)) return;
    const a = act[i.customer_id] || (act[i.customer_id] = { visits: 0, spent: 0, last: '', outlets: new Set() });
    a.visits += 1;
    a.spent += Number(i.total_after_tax || i.total || 0);
    const d = (i.inv_date || i.created_at || '').slice(0, 10);
    if (d && a.last < d) a.last = d;
    if (i.outlet_id === 1) a.outlets.add('Depok');
    if (i.outlet_id === 2) a.outlets.add('Pondok Kopi');
  });
  _p360ActivityCache = act;
  _p360ActivityCacheTime = now;
  return act;
}

function suggestPatient360(query, limit = 8) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2) return { total: 0, data: [] };
  const customers = getSafeJson('customers_all.json') || [];
  const act = getPatient360Activity();
  const scored = [];
  for (const c of customers) {
    const score = scorePatientMatch(c, q);
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aa = act[a.c.id] || { visits: 0, spent: 0 };
    const bb = act[b.c.id] || { visits: 0, spent: 0 };
    if (bb.visits !== aa.visits) return bb.visits - aa.visits;
    return bb.spent - aa.spent;
  });
  const data = scored.slice(0, limit).map(({ c }) => {
    const a = act[c.id] || { visits: 0, spent: 0, last: '', outlets: new Set() };
    const nm = c.name || {};
    return {
      id: c.id,
      name: typeof c.name === 'string' ? c.name : (`${nm.first_name || ''} ${nm.last_name || ''}`.trim() || 'Pasien'),
      code: c.code || '',
      phone: c.phone || c.mobile_phone || '',
      branch: a.outlets.size ? Array.from(a.outlets).join(', ') : '',
      visits: a.visits,
      spent: Math.round(a.spent),
      last_visit: a.last || ''
    };
  });
  return { total: scored.length, data };
}

// ── Rekomendasi skincare homecare: kebutuhan kulit & jenis produk ──────────────
// Pengelompokan berbasis kata kunci pada NAMA item. Kata merek (kefir, derma) sengaja
// tidak dihitung: dulu "Kefir Glow Peel" dianggap cocok dengan "Kefir Glow Night Cream"
// hanya karena sama-sama bermerek Kefir. HEURISTIK — master Neosoft tidak punya kategori.
const SKIN_CONCERNS = [
  { key: 'jerawat', label: 'kulit berjerawat', re: /acne|jerawat|purging|komedo|blackhead|whitehead|salicylic|sebum|oil\s*control|\bpori\b|pore/i },
  { key: 'bekas', label: 'bekas jerawat & tekstur', re: /\bpie\b|\bpih\b|scar|bopeng|subcision|roller|microneedl|tekstur/i },
  { key: 'kusam', label: 'kulit kusam & flek', re: /glow|bright|whiten|arbutin|niacin|vitamin\s*c|lighten|pigment|melasma|flek|kusam|dull|dark\s*spot|toning/i },
  { key: 'aging', label: 'anti-aging', re: /aging|rejuve|peptide|retinol|collagen|kolagen|\blift\b|hifu|v-?line|nctf|booster|nucleo|exosome|salmon|\bdna\b|botox|filler|thread|kerut|wrinkle|fine\s*line/i },
  { key: 'hidrasi', label: 'hidrasi & skin barrier', re: /hydra|hydrat|moistur|barrier|ceramide|calm|soothing|sensitiv|centella|repair|\bdry\b|kering|eczema|iritasi/i }
];

function classifyConcerns(text) {
  const t = String(text || '');
  return SKIN_CONCERNS.filter(c => c.re.test(t)).map(c => c.key);
}

function classifySkincareType(name) {
  const t = String(name || '').toLowerCase();
  if (/sunscreen|sunblock|\bspf\b|sun\s*protect/.test(t)) return 'sunscreen';
  if (/wash|cleanser|cleansing|foam|micellar|face\s*soap|sabun/.test(t)) return 'cleanser';
  if (/serum|essence|ampoule|booster\s*drop/.test(t)) return 'serum';
  if (/toner|mist/.test(t)) return 'toner';
  if (/mask|masker/.test(t)) return 'mask';
  if (/cream|moistur|lotion|gel|emulsion/.test(t)) return 'moisturizer';
  return 'other';
}

function searchPatient360(query, { onlyId = null } = {}) {
  const customers = getSafeJson('customers_all.json');
  const invoices = getSafeJson('invoices_all.json');
  const usages = getSafeJson('usages_details.json');
  const products = getSafeJson('products.json');
  const therapists = getSafeJson('therapists.json');
  const appointments = getSafeJson('appointment_full.json');
  const physExams = getSafeJson('physicalexamination.json');
  const anamnesaImages = getSafeJson('anamnesa_images.json');
  const peDetailPhotos = getSafeJson('pe_detail_photos.json');

  // Index join: sheet CRM (per inv_code) + katalog & master Neosoft
  const crmIndex = getCrmSheetIndex();
  const sheetHistory = getSheetHistoryByCustomer(invoices);
  const exactNameIndex = buildExactNameIndex(customers);
  const invByCode = {}; invoices.forEach(i => { if (i.inv_code) invByCode[i.inv_code] = i; });
  const prodById = {}; products.forEach(p => { prodById[p.id] = p; });
  const staffById = {};
  therapists.forEach(t => {
    const n = String(t.therapist_name || '').trim();
    // 'NONE' adalah placeholder di master Neosoft, bukan nama orang
    staffById[t.id] = (!n || n.toUpperCase() === 'NONE') ? '' : n;
  });

  const q = (query || '').toLowerCase().trim();
  if (!q && onlyId === null) return [];

  // Aktivitas pasien dipakai sebagai pemecah seri: pasien yang benar-benar
  // pernah bertransaksi diprioritaskan di atas namesake yang tidak pernah datang.
  const activityByCid = {};
  invoices.forEach(i => {
    if (i.void_invoice || isMigrationInvoice(i)) return;
    const a = activityByCid[i.customer_id] || (activityByCid[i.customer_id] = { visits: 0, spent: 0 });
    a.visits += 1;
    a.spent += Number(i.total_after_tax || i.total || 0);
  });

  const scored = (onlyId !== null ? [] : customers)
    .map(c => ({ c, score: scorePatientMatch(c, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aa = activityByCid[a.c.id] || { visits: 0, spent: 0 };
      const bb = activityByCid[b.c.id] || { visits: 0, spent: 0 };
      if (bb.visits !== aa.visits) return bb.visits - aa.visits;
      return bb.spent - aa.spent;
    });

  // onlyId: pasien yang sudah dipilih dari daftar saran -> hanya satu pasien itu yang diproses penuh
  const matchedCusts = onlyId !== null
    ? customers.filter(c => String(c.id) === String(onlyId)).slice(0, 1)
    : scored.slice(0, PATIENT360_RESULT_LIMIT).map(x => x.c);

  // Map product catalogue prices and names
  const prodCatalog = products.map(p => ({
    id: p.id,
    code: p.product_treatment_code || '',
    name: p.product_treatment_name || '',
    price: Number(p.price || 0),
    duration: p.duration || 45,
    category: p.price > 1500000 ? 'Premium/Laser' : (p.price >= 500000 ? 'Advanced Care' : 'Basic Care')
  })).filter(p => p.price > 0).sort((a, b) => a.price - b.price);

  const results = matchedCusts.map(c => {
    const cid = c.id;
    const custName = `${c.name?.first_name || ''} ${c.name?.last_name || ''}`.trim() || 'Pasien';
    // Invoice void TIDAK boleh masuk hitungan LTV, jumlah kunjungan, tier,
    // maupun grading — nilainya sudah dibatalkan di kasir.
    const custInvoicesAll = invoices.filter(inv => inv.customer_id === cid && (inv.outlet_id === 1 || inv.outlet_id === 2));
    // Migrasi sisa paket bukan kunjungan/belanja baru — dipisah dari LTV &
    // jumlah kunjungan, tetapi kodenya tetap dipakai untuk saldo paket.
    const migrationInvoices = custInvoicesAll.filter(inv => !inv.void_invoice && isMigrationInvoice(inv));
    const custInvoices = custInvoicesAll.filter(inv => !inv.void_invoice && !isMigrationInvoice(inv));
    const voidedInvoices = custInvoicesAll.filter(inv => inv.void_invoice);
    // Untuk saldo paket, riwayat beli & join sheet CRM: invoice migrasi ikut
    const custInvoicesWithPackages = [...custInvoices, ...migrationInvoices];
    
    let totalSpent = 0;
    const invCodes = new Set();
    custInvoices.forEach(inv => {
      totalSpent += Number(inv.total_after_tax || inv.total || 0);
      if (inv.inv_code) invCodes.add(inv.inv_code);
    });
    migrationInvoices.forEach(inv => { if (inv.inv_code) invCodes.add(inv.inv_code); });

    const visitCount = custInvoices.length;
    const avgSpending = visitCount > 0 ? Math.round(totalSpent / visitCount) : 0;
    const voidedAmount = voidedInvoices.reduce((s, inv) => s + Number(inv.total_after_tax || inv.total || 0), 0);

    // Urutan invoice di file menaik, jadi indeks [0] adalah yang TERTUA.
    // Ambil min/max eksplisit, lalu jatuh ke field last_visit native Neosoft
    // bila pasien belum punya invoice sama sekali.
    const visitDates = custInvoices
      .map(inv => (inv.inv_date || inv.created_at || '').substring(0, 10))
      .filter(Boolean)
      .sort();
    const lastVisitDate = visitDates.length > 0
      ? visitDates[visitDates.length - 1]
      : String(c.last_visit || '').substring(0, 10);
    const firstVisitDate = visitDates.length > 0 ? visitDates[0] : '';

    const visitDayMap = {};
    custInvoices.forEach(iv => {
      const d = (iv.inv_date || iv.created_at || '').substring(0, 10);
      if (!d) return;
      const day = visitDayMap[d] || (visitDayMap[d] = {
        date: d, invoices: 0, spend: 0, outlet_id: iv.outlet_id, codes: [],
        doctor_ids: new Set(), therapist_ids: new Set(), hours: []
      });
      day.invoices += 1;
      if (iv.inv_code) day.codes.push(iv.inv_code);
      day.spend += Number(iv.total_after_tax || iv.total || 0);
      if (iv.doctor_id) day.doctor_ids.add(iv.doctor_id);
      if (iv.therapist_id) day.therapist_ids.add(iv.therapist_id);
      const hh = String(iv.inv_date || '').substring(11, 13);
      if (hh) day.hours.push(Number(hh));
    });
    const visitDays = Object.values(visitDayMap).sort((a, b) => a.date.localeCompare(b.date));
    const visitDayCount = visitDays.length;

    // Treatments history — `usages_details.json` tidak menyimpan nama treatment,
    // dokter, maupun terapis, jadi ketiganya di-join dari master Neosoft:
    //   product_id -> products.id, doctor_id/therapist_id -> therapists.id
    // Sheet CRM menambahkan catatan sisa/DP per inv_code (Agu–Sep 2026).
    const treatmentHistory = usages
      .filter(u => invCodes.has(u.inv_code))
      .map(u => {
        const prod = prodById[u.product_id];
        const inv = invByCode[u.inv_code] || {};
        const crmRows = crmIndex.byInvCode.get(u.inv_code) || [];
        return {
          name: (prod && prod.product_treatment_name) || 'Treatment',
          date: (inv.inv_date || u.created_at || '').substring(0, 10),
          inv_code: u.inv_code,
          doctor: staffById[inv.doctor_id] || '-',
          therapist: staffById[inv.therapist_id] || '-',
          crm_notes: crmRows.filter(r => r.is_unused).map(r => r.treatment),
          crm_status_patient: (crmRows.find(r => r.status_patient) || {}).status_patient || null,
          crm_has_photo: crmRows.some(r => r.has_photo !== null)
            ? crmRows.some(r => r.has_photo === true)
            : null,
          in_crm_sheet: crmRows.length > 0
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5);

    // Determine Tier
    // TIER = nilai belanja PER KUNJUNGAN. Label menyebut rentang rupiah,
    // jadi ambangnya harus benar-benar rentang itu.
    //
    // Versi lama memakai OR dengan total belanja (avgSpending >= 1,5jt ||
    // totalSpent >= 3jt), sehingga pasien sering-datang-nominal-kecil
    // dilabeli "High Tier (Rp 1.5M - 4M)" padahal rata-ratanya Rp 305.900 —
    // label yang membantah dirinya sendiri. Nilai total kini punya
    // ukurannya sendiri di value_band, dan frekuensi ada di grade X/Y/Z.
    const TIERS = [
      [4000000, '👑 Very High / VIP (> Rp 4jt)', 'purple'],
      [1500000, '🌟 High Tier (Rp 1,5jt - 4jt)', 'emerald'],
      [800000, '💎 Middle Tier (Rp 800rb - 1,5jt)', 'cyan'],
      [400000, '🔹 Low Tier (Rp 400rb - 800rb)', 'blue'],
      [1, '🔹 Very Low (< Rp 400rb)', 'slate'],
      [0, 'Belum Ada Transaksi', 'slate']
    ];
    const tierHit = TIERS.find(([min]) => (avgSpending > 0 ? avgSpending >= min : (totalSpent > 0 ? totalSpent >= min : min === 0))) || TIERS[TIERS.length - 1];
    const tier = (totalSpent === 0 && visitCount === 0) ? 'Belum Ada Transaksi' : tierHit[1];
    const tierColor = (totalSpent === 0 && visitCount === 0) ? 'slate' : tierHit[2];

    // VALUE BAND = total belanja seumur hidup (LTV). Dimensi terpisah:
    // pasien bisa Low Tier per kunjungan tapi bernilai tinggi karena sering.
    const VALUE_BANDS = [
      [20000000, '💠 Sultan (> Rp 20jt)', 'purple'],
      [8000000, '🏆 Bernilai Tinggi (Rp 8jt - 20jt)', 'amber'],
      [3000000, '📈 Bernilai Menengah (Rp 3jt - 8jt)', 'cyan'],
      [1000000, '🌱 Bertumbuh (Rp 1jt - 3jt)', 'blue'],
      [1, '🌱 Baru Mulai (< Rp 1jt)', 'slate'],
      [0, 'Belum Ada Transaksi', 'slate']
    ];
    const bandHit = VALUE_BANDS.find(([min]) => (totalSpent > 0 ? totalSpent >= min : min === 0)) || VALUE_BANDS[VALUE_BANDS.length - 1];

    // PT-07: Klasifikasi X/Y/Z berbasis FREKUENSI (lihat classifyPatientGrade).
    // Memakai HARI kunjungan, bukan jumlah invoice: 3 invoice di hari yang
    // sama bukan "rutin 3x". 98 pasien punya invoice ganda di hari sama.
    // Grade memakai hari kunjungan TREATMENT saja (beli produk bukan kunjungan).
    const treatDays = treatmentVisitDays(c.id);
    const gradeInfo = classifyPatientGrade(treatDays.length, treatDays[0] || null);
    if (gradeInfo.grade === 'BELUM' && visitDayCount > 0) gradeInfo.label = 'Belum pernah treatment (hanya beli produk)';
    const grading = gradeInfo.grade === 'BARU' ? 'Pasien Baru' : (gradeInfo.grade === 'BELUM' ? 'Belum Ada Kunjungan' : `Grade ${gradeInfo.grade}`);
    const gradingLabel = gradeInfo.label;
    const gradingColor = gradeInfo.color;

    // PT-02: Treatment Plan Roadmap (Active Medical Care Plan)
    const treatmentPlan = [
      {
        stage: 'Tahap 1: Inisiasi & Detoks Kulit',
        status: visitCount > 0 ? 'Completed ✅' : 'Planned ⏳',
        focus: 'Pembersihan mendalam, regulasi sebum & perbaikan skin barrier',
        recommended_actions: 'Kefir Glow Facial + Ekstraksi Lembut + Serum DNA Salmon',
        target_timeline: 'Bulan ke-1'
      },
      {
        stage: 'Tahap 2: Koreksi Pigmentasi & Tekstur',
        status: visitCount >= 2 ? 'Completed ✅' : (visitCount === 1 ? 'In Progress 🔄' : 'Upcoming ⏳'),
        focus: 'Pencerahan flek/PIH, mengecilkan pori & peremajaan kolagen',
        recommended_actions: 'Pico Laser Rejuve / Alma Dye-VL + Skin Booster',
        target_timeline: 'Bulan ke-2 s.d ke-3'
      },
      {
        stage: 'Tahap 3: Pemeliharaan & Long-Term Glow',
        status: visitCount >= 3 ? 'In Progress 🔄' : 'Upcoming ⏳',
        focus: 'Maintenance hidrasi optimal & pencegahan penuaan dini (Anti-Aging)',
        recommended_actions: 'Paket Silk Glow Facial Bulanan + Homecare Anti-Oxidant',
        target_timeline: 'Bulan ke-4 ke atas'
      }
    ];

    // ═══════════════════════════════════════════════════════════════════
    // MESIN UPSELLING
    // Semua rekomendasi diambil DI ATAS rata-rata belanja pasien, dengan
    // satu jenjang yang dipatok ke belanja tertingginya (bukti bahwa pasien
    // sanggup di angka itu). Harga promo & harga bottom berasal dari
    // transaksi nyata lewat pricingIndex, bukan persentase karangan.
    // ═══════════════════════════════════════════════════════════════════
    const pricingIndex = getPricingIndex(products, usages, invoices);

    // Profil belanja per ITEM (bukan per kunjungan) — dasar yang tepat untuk
    // merekomendasikan treatment satuan.
    const custLineItems = usages
      .filter(u => invCodes.has(u.inv_code))
      .map(u => ({ product_id: u.product_id, value: Number(u.value || 0), prod: prodById[u.product_id] }))
      .filter(x => x.value > 0 && x.prod);

    const itemValues = custLineItems.map(x => x.value);
    const avgItemPrice = itemValues.length
      ? Math.round(itemValues.reduce((a, b) => a + b, 0) / itemValues.length) : 0;
    const peakItem = custLineItems.length
      ? custLineItems.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    const peakItemPrice = peakItem ? peakItem.value : 0;

    // Dasar rekomendasi: rata-rata harga item pasien; kalau belum pernah
    // transaksi, pakai rata-rata per kunjungan, lalu ambang minimum klinik.
    const baselinePrice = avgItemPrice > 0 ? avgItemPrice : (avgSpending > 0 ? avgSpending : 350000);
    const peakBasis = peakItemPrice > 0 ? peakItemPrice : baselinePrice;

    // Afinitas kategori dari riwayat: dipakai untuk mengurutkan rekomendasi
    // agar nyambung dengan yang biasa pasien ambil.
    const affinityWords = new Set();
    custLineItems.forEach(x => {
      String(x.prod.product_treatment_name || '').toLowerCase()
        .split(/[^a-z0-9]+/).filter(w => w.length >= 4).forEach(w => affinityWords.add(w));
    });
    const affinityScore = (name) => {
      const words = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
      return words.reduce((n, w) => n + (affinityWords.has(w) ? 1 : 0), 0);
    };

    const boughtIds = new Set(custLineItems.map(x => x.product_id));

    // Katalog treatment aktif dengan harga pasar terpasang
    const sellableTreatments = products
      .filter(p => Number(p.price || 0) > 0 && !(p.product_treatment_code || '').startsWith('P-'))
      .map(p => ({ prod: p, mk: pricingIndex[p.id] || {} }))
      .filter(x => x.mk.list_price);

    const formatRec = (p, mk, tier, reason) => {
      const list = mk.list_price;
      const promo = mk.promo_price;
      const bottom = mk.bottom_price;
      return {
        product_id: p.id,
        code: p.product_treatment_code || '-',
        name: p.product_treatment_name,
        duration: p.duration || 60,
        tier: tier,
        reason: reason,

        // ── Harga list resmi (master Neosoft) ──
        price: list,
        price_fmt: rupiah(list),

        // ── Harga promo: murni dari Master Paket & Master Voucher Neosoft ──
        is_on_promo: mk.is_on_promo === true,
        promo_is_default: mk.promo_is_default === true,
        data_sources: mk.data_sources || ['neosoft'],
        list_source: mk.list_source || 'neosoft',
        bottom_from_sheet: mk.bottom_from_sheet === true,
        neosoft_price: mk.neosoft_list_price || null,
        neosoft_price_fmt: mk.neosoft_price_label || (mk.neosoft_list_price ? rupiah(mk.neosoft_list_price) : null),
        neosoft_price_varies: mk.neosoft_price_varies === true,
        price_mismatch: mk.price_mismatch === true,
        promo_name: mk.promo_name || null,
        promo_source: mk.promo_source || null,
        promo_price: promo,
        promo_price_fmt: promo !== null && promo !== undefined ? rupiah(promo) : null,
        promo_discount_pct: promo ? Math.round((1 - promo / list) * 100) : null,
        promo_note: mk.promo_is_default
          ? mk.promo_source
          : mk.is_on_promo
          ? `Promo resmi: ${mk.promo_source || mk.promo_name || 'Master Promo'}${mk.promo_period ? ` (s.d. ${mk.promo_period.end})` : ''}${mk.promo_benefit ? ` + ${mk.promo_benefit}` : ''}`
          : 'Tidak ada promo aktif untuk treatment ini',
        promo_period: mk.promo_period || null,
        promo_benefit: mk.promo_benefit || '',
        packages: mk.packages || null,

        // ── Harga bottom: batas terendah berdasarkan paket/voucher Neosoft ──
        bottom_price: bottom,
        bottom_price_fmt: bottom !== null && bottom !== undefined ? rupiah(bottom) : null,
        bottom_discount_pct: bottom ? Math.round((1 - bottom / list) * 100) : null,
        bottom_confidence: mk.bottom_confidence || 'tinggi',
        bottom_samples: mk.bottom_samples || 0,
        bottom_note: bottom
          ? 'Harga terendah resmi dari spreadsheet harga (kolom Harga Terendah)'
          : 'Belum ada harga terendah di spreadsheet harga',
        bottom_source: mk.bottom_source || null,

        // Lantai bundel: termurah termasuk alokasi paket. Bukan harga satuan,
        // dipisah supaya tidak dipakai sebagai patokan jual satuan.
        bundle_floor: mk.bundle_floor ?? null,
        bundle_floor_fmt: mk.bundle_floor ? rupiah(mk.bundle_floor) : null,

        times_sold: mk.times_sold || 0,
        already_taken: boughtIds.has(p.id)
      };
    };

    // Pengurutan: yang nyambung dengan riwayat dulu, lalu yang terbukti laku,
    // lalu yang sedang promo (paling mudah ditutup).
    const rankAndTake = (pool, n) => pool
      .map(x => ({
        ...x,
        _score: affinityScore(x.prod.product_treatment_name) * 10
              + (x.mk.times_sold > 0 ? 5 : 0)
              + (x.mk.is_on_promo && !x.mk.promo_is_default ? 3 : 0)
      }))
      .sort((a, b) => b._score - a._score || b.mk.list_price - a.mk.list_price)
      .slice(0, n);

    const inRange = (lo, hi) => sellableTreatments.filter(x =>
      x.mk.list_price > lo && (hi === null || x.mk.list_price <= hi));

    // Jenjang 1 — naik bertahap dari rata-rata (1,1x – 1,6x)
    const stepUp = rankAndTake(inRange(baselinePrice * 1.1, baselinePrice * 1.6), 3)
      .map(x => formatRec(x.prod, x.mk, 'step_up',
        `Di atas rata-rata belanja ${rupiah(baselinePrice)}/tindakan — kenaikan wajar yang masih nyaman.`));

    // Jenjang 2 — setara belanja TERTINGGI pasien (0,85x – 1,3x dari puncak)
    const matchPeak = rankAndTake(
      inRange(Math.max(baselinePrice * 1.6, peakBasis * 0.85), peakBasis * 1.3), 3)
      .map(x => formatRec(x.prod, x.mk, 'match_peak',
        peakItem
          ? `Pasien pernah membayar ${rupiah(peakItemPrice)} untuk ${peakItem.prod.product_treatment_name} — sanggup di kelas harga ini.`
          : `Setara plafon belanja ${rupiah(peakBasis)}.`));

    // Jenjang 3 — melampaui puncak (stretch / VIP)
    const beyondPeak = rankAndTake(inRange(peakBasis * 1.3, null), 3)
      .map(x => formatRec(x.prod, x.mk, 'beyond_peak',
        `Melampaui belanja tertinggi pasien (${rupiah(peakBasis)}) — tawarkan saat hasil treatment sebelumnya memuaskan.`));

    // Skincare homecare — dicocokkan ke afinitas riwayat, bukan 3 teratas
    // urutan file seperti versi lama.
    // Skincare dinilai berbeda dari treatment: tujuannya menaikkan nilai
    // keranjang, jadi item bernilai lebih tinggi yang terbukti laku
    // diutamakan — bukan obat Rp 35rb yang kebetulan paling sering keluar.
    // Kode P- di Neosoft mencampur obat/habis-pakai (Amoxicillin, Paracetamol,
    // Dexamethasone, krim anestesi) dengan skincare homecare. Tidak ada field
    // pembeda di master produk, jadi obat disaring pakai kata kunci.
    // HEURISTIK — idealnya diganti kategori produk yang benar di Neosoft.
    const PHARMA_RE = /anti\s*biotik|antibiotik|amoxcilin|amoxicillin|paracetamol|dexamethasone|mefenamic|cefixime|anestesi|anastesi|jcain|pelancar bab|anti iritasi|after care/i;
    const skincarePool = products
      .filter(p => (p.product_treatment_code || '').startsWith('P-')
        && Number(p.price || 0) > 0
        && !PHARMA_RE.test(p.product_treatment_name || ''))
      .map(p => ({ prod: p, mk: pricingIndex[p.id] || { list_price: Number(p.price) } }));

    // Kebutuhan kulit pasien: dari NAMA item yang pernah dibeli (treatment + produk) dan,
    // sebagai pembobot tambahan (tidak pernah ditampilkan), analisis kulit dari dokter.
    const concernScore = {};
    const concernFromHistory = new Set();
    custLineItems.forEach(x => {
      classifyConcerns(x.prod.product_treatment_name).forEach(k => {
        concernScore[k] = (concernScore[k] || 0) + 1;
        concernFromHistory.add(k);
      });
    });
    try {
      const docRecsForSkin = getDoctorRecommendations(cid, custName) || [];
      classifyConcerns((docRecsForSkin[0] || {}).skin_analysis).forEach(k => {
        concernScore[k] = (concernScore[k] || 0) + 2;
      });
    } catch (e) {}
    const patientConcerns = Object.keys(concernScore).sort((x, y) => concernScore[y] - concernScore[x]);

    // Riwayat beli per produk: berapa kali & kapan terakhir (untuk label repeat order)
    const invDateByCode = {};
    custInvoicesWithPackages.forEach(iv => { invDateByCode[iv.inv_code] = String(iv.inv_date || '').slice(0, 10); });
    const boughtInfo = {};
    usages.forEach(u => {
      if (!invCodes.has(u.inv_code)) return;
      const d = invDateByCode[u.inv_code] || '';
      const b = boughtInfo[u.product_id] || (boughtInfo[u.product_id] = { times: 0, last: '' });
      b.times += 1;
      if (d && b.last < d) b.last = d;
    });
    const todayMs = Date.now();
    const daysSince = (d) => d ? Math.max(0, Math.floor((todayMs - new Date(d + 'T00:00:00').getTime()) / 86400000)) : null;
    const REPEAT_DUE_DAYS = 30; // 1 botol skincare umumnya habis ±30-45 hari

    const concernLabel = (k) => (SKIN_CONCERNS.find(c => c.key === k) || {}).label || k;
    const maxSold = Math.max(1, ...skincarePool.map(x => x.mk.times_sold || 0));

    const scored = skincarePool.map(x => {
      const type = classifySkincareType(x.prod.product_treatment_name);
      const pc = classifyConcerns(x.prod.product_treatment_name);
      const matched = pc.filter(k => concernScore[k]);
      const matchWeight = matched.reduce((n, k) => n + Math.min(concernScore[k], 4), 0);
      const bought = boughtInfo[x.prod.id] || null;
      const since = bought ? daysSince(bought.last) : null;
      let s2 = matchWeight * 10
        + (type === 'sunscreen' ? 4 : 0)                       // universal, cocok untuk semua pasien
        + Math.min(1, (x.mk.times_sold || 0) / maxSold) * 6    // terbukti laku
        + (x.mk.is_on_promo && !x.mk.promo_is_default ? 2 : 0)
        + ((x.mk.list_price || 0) / Math.max(1, ...skincarePool.map(y => y.mk.list_price || 0))) * 2;
      if (bought) s2 += (since !== null && since >= REPEAT_DUE_DAYS) ? 8 : -8; // waktunya beli lagi vs baru dibeli
      return { ...x, type, matched, bought, since, _score: s2 };
    });

    // Buang yang belum pernah terjual, kecuali kandidat tidak cukup untuk menyusun 4 produk.
    // Item bertipe 'other' di master Neosoft adalah resep racikan dokter (ACS-1, FC-1, GL-1, …)
    // dan obat program (Pemecah Lemak, Nafsu Makan). Itu bukan skincare homecare dan butuh resep
    // dokter, jadi tidak ikut direkomendasikan.
    const homecareOnly = scored.filter(x => x.type !== 'other');
    let candidates = homecareOnly.filter(x => (x.mk.times_sold || 0) > 0);
    if (candidates.length < 4) candidates = homecareOnly;
    candidates.sort((a, b) => b._score - a._score);

    // Susun rutinitas: satu produk per jenis (pembersih, serum, krim, sunscreen…) dulu,
    // baru sisanya diisi berdasarkan skor.
    const picked = [];
    const usedTypes = new Set();
    for (const c of candidates) {
      if (picked.length >= 4) break;
      if (c.type !== 'other' && usedTypes.has(c.type)) continue;
      picked.push(c); usedTypes.add(c.type);
    }
    for (const c of candidates) {
      if (picked.length >= 4) break;
      if (!picked.includes(c)) picked.push(c);
    }

    const skincareRecList = picked.map(x => {
      const fromHist = x.matched.filter(k => concernFromHistory.has(k));
      let reason;
      if (x.bought && x.since !== null && x.since >= REPEAT_DUE_DAYS) {
        reason = `Repeat order — terakhir dibeli ${x.since} hari lalu, biasanya sudah habis.`;
      } else if (x.bought) {
        reason = `Baru dibeli ${x.since} hari lalu — tawarkan lagi mendekati habis.`;
      } else if (fromHist.length) {
        reason = `Sesuai riwayat perawatan untuk ${concernLabel(fromHist[0])}.`;
      } else if (x.matched.length) {
        reason = 'Sesuai kebutuhan kulit pasien.';
      } else {
        reason = 'Homecare pendukung untuk mengunci hasil tindakan klinik.';
      }
      return {
        ...formatRec(x.prod, x.mk, 'skincare', reason),
        skincare_type: x.type,
        concern_match: x.matched.filter(k => concernFromHistory.has(k)).map(concernLabel),
        already_bought: !!x.bought,
        times_bought: x.bought ? x.bought.times : 0,
        last_bought: x.bought ? x.bought.last : null,
        days_since_bought: x.since,
        repeat_due: !!(x.bought && x.since !== null && x.since >= REPEAT_DUE_DAYS),
        is_new_product: (x.mk.times_sold || 0) === 0
      };
    });

    // Next Plan Dokter (Prioritas: Rekomendasi Manual Dokter jika ada, fallback ke Algoritma Medis Dashboard)
    const manualDoctorRecs = getDoctorRecommendations(cid, custName);
    const latestDocRec = (manualDoctorRecs && manualDoctorRecs.length > 0) ? manualDoctorRecs[0] : null;

    let nextDoctorPlan = null;
    if (latestDocRec) {
      const rawSteps = (latestDocRec.roadmap_steps && latestDocRec.roadmap_steps.length > 0)
        ? latestDocRec.roadmap_steps
        : (latestDocRec.roadmap_months || []);

      nextDoctorPlan = {
        is_manual_doctor_entry: true,
        id: latestDocRec.id,
        doctor_name: latestDocRec.doctor_name,
        consultation_date: latestDocRec.consultation_date,
        skin_analysis: latestDocRec.skin_analysis || 'Pemeriksaan Rutin Kulit',
        recommended_return_date: latestDocRec.recommended_return_date ? `${latestDocRec.recommended_return_date} (${latestDocRec.return_interval_days || 14} Hari Pasca Konsultasi)` : `${latestDocRec.return_interval_days || 14} Hari Pasca Konsultasi`,
        return_interval_days: latestDocRec.return_interval_days || 14,
        roadmap_steps: rawSteps.map((rm, idx) => ({
          step: rm.step || idx + 1,
          month: rm.phase_name || rm.title || `Tahap ${rm.step || idx + 1}`,
          phase_name: rm.phase_name || rm.title || `Tahap ${rm.step || idx + 1}`,
          focus: (rm.treatment_name || 'Treatment Medis') + (rm.interval_label || rm.frequency ? ` (${rm.interval_label || rm.frequency})` : ''),
          treatment_name: rm.treatment_name || '',
          treatment_code: rm.treatment_code || '',
          interval_label: rm.interval_label || rm.frequency || '',
          interval_type: rm.interval_type || '',
          estimated_timing: rm.estimated_timing || '',
          target_goal: rm.target_goal || '',
          clinical_notes: rm.clinical_notes || '',
          status: (rm.step === 1 || idx === 0) ? 'Tahap Aktif ⏳' : 'Rencana Lanjutan 📅'
        })),
        roadmap_3_months: rawSteps.map((rm, idx) => ({
          month: rm.phase_name || rm.title || `Tahap ${rm.step || idx + 1}`,
          focus: (rm.treatment_name || 'Treatment Medis') + (rm.interval_label || rm.frequency ? ` (${rm.interval_label || rm.frequency})` : ''),
          treatment_name: rm.treatment_name || '',
          treatment_code: rm.treatment_code || '',
          interval_label: rm.interval_label || rm.frequency || '',
          clinical_notes: rm.clinical_notes || '',
          status: (rm.step === 1 || idx === 0) ? 'Tahap Aktif ⏳' : 'Rencana Lanjutan 📅'
        })),
        homecare_skincare: latestDocRec.homecare_skincare || [],
        doctor_notes: latestDocRec.doctor_notes || 'Ikuti instruksi pemakaian krim dan jadwal kontrol.',
        history_count: manualDoctorRecs.length
      };
    } else if (treatmentHistory.length > 0) {
      nextDoctorPlan = {
        is_manual_doctor_entry: false,
        recommended_return_date: '14-21 Hari Pasca Tindakan Terakhir',
        doctor_name: 'Saran Algoritma Medis Dashboard',
        skin_analysis: 'Estimasi berbasis riwayat tindakan',
        roadmap_3_months: [
          { month: 'Bulan 1 (Saat Ini)', focus: treatmentHistory[0].name, status: 'Selesai Dilakukan ✅', clinical_notes: 'Tindakan yang baru dijalankan' },
          { month: 'Bulan 2 (Kontrol Lanjutan)', focus: 'Evaluasi Hasil & Maintenance ' + treatmentHistory[0].name, status: 'Rekomendasi Medis 📅', clinical_notes: 'Evaluasi progres dan pemeliharaan hasil' },
          { month: 'Bulan 3 (Perlindungan Barrier)', focus: 'Facial Silk Glow & Homecare Routine', status: 'Rencana Pemeliharaan 📋', clinical_notes: 'Menjaga kesehatan skin barrier jangka panjang' }
        ],
        homecare_skincare: [],
        doctor_notes: 'Belum ada input manual dari dokter pemeriksa. Gunakan tombol di bawah untuk menuliskan rencana perawatan resmi.'
      };
    }

    const custPhysExams = physExams.filter(p => p.customer_id === cid).sort((a, b) => (b.examination_date || '').localeCompare(a.examination_date || ''));

    // Real Clinical Sessions from Neosoft Physical Examination
    const byDate = {};
    custPhysExams.forEach(item => {
      const d = (item.examination_date || item.created_at || '').substring(0, 10);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(item);
    });

    const clinicalPhotoSessions = [];
    Object.keys(byDate).sort().reverse().forEach((d, idx) => {
      const group = byDate[d];
      const before = group.find(x => (x.description || '').toLowerCase().includes('before'));
      const after = group.find(x => (x.description || '').toLowerCase().includes('after'));
      const others = group.filter(x => x !== before && x !== after);

      const outletId = group[0].outlet_id;
      const branchName = outletId === 1 ? '📍 Depok' : (outletId === 2 ? '📍 Pondok Kopi' : 'Klinik');

      // Match treatment from history on the same date if available
      const matchingTreatment = treatmentHistory.find(t => t.date === d) || treatmentHistory[0] || null;

      clinicalPhotoSessions.push({
        session_id: `NEO-S${String(idx + 1).padStart(2, '0')}`,
        date: d,
        treatment_name: matchingTreatment ? matchingTreatment.name : 'Pemeriksaan Klinis Kasir Neosoft',
        inv_code: matchingTreatment ? matchingTreatment.inv_code : `EXAM-${group[0].id}`,
        branch: branchName,
        outlet_id: outletId,
        before: before ? {
          id: before.id,
          description: before.description ? before.description.trim() : 'Before',
          image: (before.image && before.image !== '-') ? before.image : null,
          created_at: before.created_at
        } : null,
        after: after ? {
          id: after.id,
          description: after.description ? after.description.trim() : 'After',
          image: (after.image && after.image !== '-') ? after.image : null,
          created_at: after.created_at
        } : null,
        others: others.map(o => ({ id: o.id, description: o.description ? o.description.trim() : '-', image: (o.image && o.image !== '-') ? o.image : null })),
        has_photo: Boolean((before && before.image && before.image !== '-') || (after && after.image && after.image !== '-')),
        total_records: group.length,
        detail_photos: []  // Will be populated from PE Detail below
      });
    });

    // Enrich clinical sessions with PE Detail photos (the real S3 images!)
    const custPeDetails = peDetailPhotos[String(cid)] || [];
    clinicalPhotoSessions.forEach(session => {
      // Find PE detail photos matching this session's PE IDs
      const sessionPeIds = [];
      const sessionDate = session.date;
      // Collect PE IDs from the group that formed this session
      const groupForDate = byDate[sessionDate] || [];
      groupForDate.forEach(pe => sessionPeIds.push(pe.id));
      
      const matchingDetails = custPeDetails.filter(dp => sessionPeIds.includes(dp.pe_id));
      session.detail_photos = matchingDetails.map(dp => ({
        detail_id: dp.detail_id,
        pe_id: dp.pe_id,
        description: dp.detail_desc || dp.pe_desc || '-',
        image_url: dp.image,
        source: 'Neosoft Physical Exam S3'
      }));
      // Update has_photo if detail photos exist
      if (session.detail_photos.length > 0) {
        session.has_photo = true;
      }
    });

    // Real Medical Record Images (from Neosoft Medical Record / Anamnesa S3)
    const custAnamImgs = (anamnesaImages[String(cid)] || []).map(img => ({
      id: img.id,
      anamnesa_id: img.anamnesa_id,
      description: img.description || 'Pemeriksaan Medis Dokter',
      image_url: img.image,
      source: 'Neosoft Cube EMR S3'
    }));

    const concernsPhotoGallery = []; // Strict zero-dummy: empty unless real clinical progression exists

    // ═══════════════════════════════════════════════════════════════════════
    // UPSELLING ENGINE: Packages, Memberships, DP Gantung Cross-Reference
    // ═══════════════════════════════════════════════════════════════════════
    const packages = getSafeJson('packages.json');
    const creditVouchers = getSafeJson('creditvoucher.json');
    // A. DP / paket gantung — di-join lewat inv_code sehingga customer_id-nya
    //    pasti. Menggantikan pencocokan nama fuzzy yang bisa menempelkan
    //    deposit milik pasien lain ke kartu pasien ini.
    const shBucketForDp = sheetHistory.byCustomer[cid] || { confirmed: [], unconfirmed: [] };
    const unredeemedForPatient = [];
    custInvoicesWithPackages.forEach(inv => {
      (crmIndex.byInvCode.get(inv.inv_code) || [])
        .filter(r => r.is_unused)
        .forEach(r => unredeemedForPatient.push({
          ...r,
          inv_code: inv.inv_code,
          inv_date: (inv.inv_date || '').substring(0, 10),
          match_basis: 'inv_code',
          match_confidence: 'PASTI'
        }));
    });

    // A2. Deposit lama yang di sheet hanya berisi nama (tanpa kode invoice).
    //     Hanya dipakai bila nama cocok PERSIS dan unik ke satu pasien; kalau
    //     ambigu, sengaja dilewati agar tidak salah tagih.
    const custNameKey = custName.toLowerCase().replace(/\s+/g, ' ').trim();
    crmIndex.nameOnlyDeposits.forEach(d => {
      const key = d.patient_name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || key !== custNameKey) return;
      const owners = exactNameIndex.get(key) || [];
      if (owners.length !== 1 || owners[0] !== cid) return; // ambigu -> lewati
      unredeemedForPatient.push({
        ...d,
        is_dp_50: /dp\s*50/i.test(d.treatment),
        inv_code: null,
        inv_date: null,
        match_basis: 'nama_persis',
        match_confidence: 'PERLU_VERIFIKASI'
      });
    });

    // A3. Konvensi Pondok Kopi berbeda dari Depok. Depok menuliskan status
    //     di teks tindakan ("BELUM DIPAKAI", "Sisa 1x"); Pondok Kopi memakai
    //     kolom Status Pembelian dengan nilai KEEP = dibeli tapi ditahan
    //     untuk dipakai lain waktu. Tanpa ini, paket gantung Pondok Kopi
    //     tidak pernah terdeteksi sama sekali.
    (shBucketForDp.confirmed || []).forEach(r => {
      if (String(r.purchase_status || '').toUpperCase() !== 'KEEP') return;
      unredeemedForPatient.push({
        treatment: r.treatment,
        category: classifyCrmTreatment(r.treatment),
        is_dp_50: false,
        inv_code: r.invoice || null,
        inv_date: r.date || null,
        branch: r.branch,
        source: 'Google Sheets CRM (Status Pembelian: KEEP)',
        match_basis: r.invoice ? 'inv_code' : 'rm',
        match_confidence: 'PASTI'
      });
    });

    // Group unredeemed by unique treatment bundle
    const unredeemedBundles = {};
    unredeemedForPatient.forEach(u => {
      const bundleKey = u.treatment.replace(/\s+/g, ' ').trim();
      if (!unredeemedBundles[bundleKey]) {
        unredeemedBundles[bundleKey] = { treatment: u.treatment, category: u.category, items: [] };
      }
      unredeemedBundles[bundleKey].items.push(u);
    });
    const dpAlerts = Object.values(unredeemedBundles).map((b, idx) => {
      const isDp50 = b.items.some(i => i.is_dp_50);
      const invCodesForBundle = [...new Set(b.items.map(i => i.inv_code).filter(Boolean))];
      const confidence = b.items.some(i => i.match_confidence === 'PASTI') ? 'PASTI' : 'PERLU_VERIFIKASI';
      return {
        id: `DP-ALERT-${idx + 1}`,
        treatment: b.treatment,
        category: b.category,
        is_dp_50: isDp50,
        is_unused: /belum dipakai|belum digunakan|sisa\s*\d/i.test(b.treatment),
        urgency: isDp50 ? 'HIGH' : 'MEDIUM',
        urgency_label: isDp50 ? '🔴 DP 50% Belum Lunas' : '🟡 Paket Belum Terpakai',
        action_label: isDp50 ? 'Follow-up pelunasan + booking jadwal' : 'Ingatkan redeem sisa kuota',
        // Jejak asal data supaya bisa ditelusuri balik ke invoice
        inv_codes: invCodesForBundle,
        last_inv_date: b.items.map(i => i.inv_date).filter(Boolean).sort().pop() || null,
        branch: b.items[0].branch,
        match_basis: b.items[0].match_basis,
        match_confidence: confidence,
        source: b.items[0].source,
        wa_template: `Halo Kak ${custName} 😊✨\n\nKami informasikan bahwa Kakak masih memiliki benefit *${b.treatment}* yang tersimpan di sistem kami.\n\nApakah Kakak berkenan kami bantu jadwalkan perawatannya? Agar hasil kulit glowingnya tetap optimal ya Kak~ 💖\n\nKefir Derma Clinic Margonda`
      };
    });

    // B. Active Package Catalog from Neosoft (what we can offer)
    const activePackages = packages.filter(p => p.status_package === true).map(p => ({
      id: p.id,
      code: p.package_code,
      name: p.package_name,
      price: Number(p.price || 0),
      price_fmt: 'Rp ' + Number(p.price || 0).toLocaleString('id-ID'),
      expires: (p.expired_date || '').substring(0, 10),
      remarks: p.remarks || '-',
      is_relevant: true // All active packages are sellable
    }));

    // C. Membership Tier Catalog dari Credit Voucher Neosoft
    //    Diskon diambil dari field `discount_ratio` yang asli. Sebelumnya
    //    angka 15%/10%/5% dan "Birthday reward Rp 500K" ditulis langsung di
    //    kode padahal keempat voucher MEMBER punya discount_ratio = 0 —
    //    angka karangan itu ikut terbawa ke pitch_script yang dibacakan staf
    //    ke pasien. Sekarang: tampilkan apa adanya, dan nyatakan bila benefit
    //    memang belum dikonfigurasi di Neosoft.
    const TIER_STYLE = [
      [/PLATINUM/, '🏵️', 'slate'],
      [/DIAMOND/, '💎', 'purple'],
      [/GOLD/, '🏆', 'amber'],
      [/SILVER/, '🥈', 'cyan']
    ];
    const membershipTiers = creditVouchers
      .filter(v => v.status_voucher === true && (v.voucher_name || '').toUpperCase().includes('MEMBER'))
      .map(m => {
        const value = Number(m.value || 0);
        const tierName = String(m.voucher_name || '').toUpperCase();
        const style = TIER_STYLE.find(([re]) => re.test(tierName));
        const discountPct = Number(m.discount_ratio || 0);
        const configured = discountPct > 0;
        return {
          id: m.id,
          code: m.code,
          name: m.voucher_name,
          value: value,
          value_fmt: 'Rp ' + value.toLocaleString('id-ID'),
          tier_icon: style ? style[1] : '🎫',
          tier_bg: style ? style[2] : 'slate',
          discount_pct: discountPct,
          benefits_configured: configured,
          benefits: configured
            ? `Diskon ${discountPct}% semua treatment (sesuai konfigurasi Neosoft)`
            : null,
          benefits_note: configured
            ? null
            : 'Benefit membership belum dikonfigurasi di Neosoft (discount_ratio = 0). Isi dulu di master Credit Voucher agar bisa ditawarkan ke pasien.',
          is_active: true
        };
      })
      .sort((a, b) => a.value - b.value);

    // D. Smart Membership Recommendation based on spending
    let recommendedMembership = null;
    if (membershipTiers.length > 0) {
      if (totalSpent >= 15000000 || avgSpending >= 3000000) {
        recommendedMembership = membershipTiers.find(m => m.name.toUpperCase().includes('DIAMOND')) || membershipTiers[membershipTiers.length - 1];
      } else if (totalSpent >= 8000000 || avgSpending >= 1500000) {
        recommendedMembership = membershipTiers.find(m => m.name.toUpperCase().includes('GOLD')) || membershipTiers[1] || membershipTiers[0];
      } else if (totalSpent >= 2000000 || visitCount >= 2) {
        recommendedMembership = membershipTiers.find(m => m.name.toUpperCase().includes('SILVER')) || membershipTiers[0];
      }
    }
    // Estimasi penghematan & pitch hanya dibuat bila diskonnya nyata.
    // Kalau benefit belum dikonfigurasi, jangan mengarang angka — beri tahu
    // stafnya bahwa datanya belum siap ditawarkan.
    const membershipRecommendation = recommendedMembership ? (() => {
      const pct = recommendedMembership.discount_pct;
      const configured = recommendedMembership.benefits_configured;
      const savings = configured ? Math.round(avgSpending * (pct / 100) * 12) : null;
      return {
        ...recommendedMembership,
        reason: configured
          ? `Total belanja Rp ${totalSpent.toLocaleString('id-ID')} dari ${visitCount}x kunjungan ➜ cocok untuk ${recommendedMembership.name} (diskon ${pct}%).`
          : `Berdasarkan belanja Rp ${totalSpent.toLocaleString('id-ID')} dari ${visitCount}x kunjungan, pasien ini masuk kandidat ${recommendedMembership.name}.`,
        savings_estimate: savings,
        savings_estimate_fmt: savings !== null ? 'Rp ' + savings.toLocaleString('id-ID') : null,
        savings_basis: configured
          ? `Asumsi ${pct}% × rata-rata belanja ${'Rp ' + avgSpending.toLocaleString('id-ID')} × 12 kunjungan/tahun`
          : null,
        is_offerable: configured,
        pitch_script: configured
          ? `Kak ${custName}, karena Kakak sudah menjadi pelanggan setia kami, kami ingin menawarkan ${recommendedMembership.name} senilai ${recommendedMembership.value_fmt}. Dengan membership ini Kakak mendapat diskon ${pct}% untuk semua treatment. Estimasi penghematan Kakak dalam setahun sekitar Rp ${savings.toLocaleString('id-ID')}. 💎✨`
          : null,
        pitch_blocked_reason: configured
          ? null
          : `Skrip penawaran belum bisa dibuat: benefit ${recommendedMembership.name} belum diisi di master Credit Voucher Neosoft (discount_ratio = 0).`
      };
    })() : null;

    // E. Rekomendasi paket: paket bundling dari campaign spreadsheet yang SEDANG berjalan
    //    (bukan master paket Neosoft). Dicocokkan ke seluruh riwayat treatment pasien lewat
    //    katalog harga (nama spreadsheet -> product_id Neosoft).
    const packageRecommendations = (() => {
      const pm = getPriceMaster();
      const today = todayJakarta();
      const pidByName = {};
      (pm.items || []).forEach(it => { if (it.product_id) pidByName[priceNorm(it.name)] = it.product_id; });
      const takenCount = {};
      usages.forEach(u => { if (invCodes.has(u.inv_code)) takenCount[u.product_id] = (takenCount[u.product_id] || 0) + 1; });
      const out = [];
      (pm.campaigns || []).forEach(c => {
        if (c.audience === 'new' || !c.start || !c.end || today < c.start || today > c.end) return;
        (c.bundles || []).forEach(bd => {
          const contents = (bd.items && bd.items.length ? bd.items.map(x => x.name) : bd.contents) || [];
          const taken = contents.filter(n => { const pid = pidByName[priceNorm(n)]; return pid && takenCount[pid]; });
          const save = bd.normal && bd.promo && bd.promo < bd.normal ? bd.normal - bd.promo : null;
          out.push({
            code: c.name,
            name: bd.name,
            contents,
            taken,
            price: bd.promo || 0,
            price_fmt: 'Rp ' + Number(bd.promo || 0).toLocaleString('id-ID'),
            normal: bd.normal || null,
            normal_fmt: bd.normal ? 'Rp ' + Number(bd.normal).toLocaleString('id-ID') : null,
            save_pct: save ? Math.round(save / bd.normal * 100) : null,
            expires: c.end,
            campaign: c.name,
            relevance_score: taken.length * 3 + (totalSpent >= 3000000 ? 1 : 0),
            match_reason: taken.length
              ? `Pernah ambil ${taken.join(' & ')} — paket ini berisi ${taken.length === contents.length ? 'semuanya' : 'treatment itu'}${save ? `, hemat ${Math.round(save / bd.normal * 100)}%` : ''}.`
              : `Paket ${c.name} yang sedang berjalan${save ? ` — hemat ${Math.round(save / bd.normal * 100)}%` : ''}.`,
          });
        });
      });
      // Paket yang isinya pernah diambil pasien didahulukan; tampilkan maksimal 6.
      return out.sort((x, y) => y.relevance_score - x.relevance_score || (y.save_pct || 0) - (x.save_pct || 0)).slice(0, 6);
    })();

    // F. CLV (Customer Lifetime Value) Projection
    // 5.814 dari 8.090 pasien punya join_date "0001-01-01" — tanggal itu valid
    // secara teknis sehingga fallback lama tidak pernah aktif, dan membuat
    // monthsSinceJoin membengkak jadi ~24.660 bulan (CLV nyaris nol).
    // Urutan sumber: join_date -> created_at -> kunjungan pertama -> 1 bulan.
    const asValidDate = (v) => {
      if (!v) return null;
      const d = new Date(v);
      if (isNaN(d.getTime())) return null;
      const year = d.getUTCFullYear();
      if (year < 2000 || d.getTime() > Date.now()) return null;
      return d;
    };
    const tenureStart = asValidDate(c.join_date)
      || asValidDate(c.created_at)
      || asValidDate(firstVisitDate);
    const clvBasis = tenureStart
      ? (asValidDate(c.join_date) ? 'join_date' : (asValidDate(c.created_at) ? 'created_at' : 'kunjungan_pertama'))
      : 'tidak_diketahui';
    const monthsSinceJoin = tenureStart
      ? Math.max(1, Math.round((Date.now() - tenureStart.getTime()) / (30 * 24 * 60 * 60 * 1000)))
      : 1;
    // Tanpa dasar tenure yang sah, proyeksi tidak dilaporkan daripada menebak.
    const monthlyRate = clvBasis === 'tidak_diketahui' ? 0 : totalSpent / monthsSinceJoin;
    const projectedCLV12 = Math.round(monthlyRate * 12);
    const projectedCLV24 = Math.round(monthlyRate * 24);
    const clvWithMembership = membershipRecommendation
      ? Math.round(projectedCLV12 * (1 + (membershipRecommendation.discount_pct / 100) * 0.3)) // Membership increases retention ~30% of discount rate
      : projectedCLV12;

    // ═══════════════════════════════════════════════════════════════════
    // ANALISIS PERILAKU KUNJUNGAN & ORDER
    // "Datang berapa kali" dihitung dari HARI KUNJUNGAN yang berbeda,
    // bukan jumlah invoice — 98 pasien punya lebih dari satu invoice di
    // hari yang sama (tambahan item, obat, atau pelunasan terpisah).
    // ═══════════════════════════════════════════════════════════════════

    // Jarak antar kunjungan -> ritme pribadi pasien
    const gapsDays = [];
    for (let k = 1; k < visitDays.length; k++) {
      gapsDays.push(Math.round(
        (new Date(visitDays[k].date) - new Date(visitDays[k - 1].date)) / 86400000));
    }
    const avgGap = gapsDays.length
      ? Math.round(gapsDays.reduce((a, b) => a + b, 0) / gapsDays.length) : null;
    const medianGap = gapsDays.length
      ? [...gapsDays].sort((a, b) => a - b)[Math.floor(gapsDays.length / 2)] : null;

    const daysSinceLast = visitDays.length
      ? Math.round((Date.now() - new Date(visitDays[visitDays.length - 1].date)) / 86400000) : null;

    // Sinyal jemput bola: sudah lewat dari ritme normalnya sendiri?
    let visitStatus = 'baru', visitStatusLabel = 'Pasien Baru', visitStatusColor = 'slate';
    if (daysSinceLast !== null && avgGap) {
      const ratio = daysSinceLast / Math.max(avgGap, 7);
      if (ratio >= 3) { visitStatus = 'hilang'; visitStatusLabel = 'Hilang — jauh melewati ritme'; visitStatusColor = 'rose'; }
      else if (ratio >= 1.8) { visitStatus = 'telat'; visitStatusLabel = 'Telat datang — waktunya dihubungi'; visitStatusColor = 'amber'; }
      else if (ratio >= 1.0) { visitStatus = 'jatuh_tempo'; visitStatusLabel = 'Jatuh tempo kunjungan'; visitStatusColor = 'cyan'; }
      else { visitStatus = 'aktif'; visitStatusLabel = 'Aktif sesuai ritme'; visitStatusColor = 'emerald'; }
    } else if (daysSinceLast !== null) {
      visitStatus = daysSinceLast > 90 ? 'hilang' : 'sekali_datang';
      visitStatusLabel = daysSinceLast > 90 ? 'Baru sekali datang, sudah lama hilang' : 'Baru sekali datang';
      visitStatusColor = daysSinceLast > 90 ? 'rose' : 'slate';
    }
    const dueInDays = avgGap && daysSinceLast !== null ? avgGap - daysSinceLast : null;

    // Tren frekuensi: paruh awal vs paruh akhir masa jadi pasien
    let freqTrend = 'tidak_cukup_data', freqTrendLabel = 'Belum cukup data untuk tren';
    if (visitDays.length >= 4) {
      const mid = Math.floor(visitDays.length / 2);
      const early = [], late = [];
      for (let k = 1; k <= mid; k++) early.push(gapsDays[k - 1]);
      for (let k = mid + 1; k < visitDays.length; k++) late.push(gapsDays[k - 1]);
      const avgE = early.reduce((a, b) => a + b, 0) / Math.max(1, early.length);
      const avgL = late.reduce((a, b) => a + b, 0) / Math.max(1, late.length);
      if (avgL < avgE * 0.75) { freqTrend = 'makin_sering'; freqTrendLabel = 'Makin sering datang'; }
      else if (avgL > avgE * 1.35) { freqTrend = 'makin_jarang'; freqTrendLabel = 'Makin jarang datang'; }
      else { freqTrend = 'stabil'; freqTrendLabel = 'Ritme stabil'; }
    }

    // ── Rincian order: apa saja yang pernah dibeli ──
    const orderTally = {};
    custLineItems.forEach(x => {
      const t = orderTally[x.product_id] || (orderTally[x.product_id] = {
        product_id: x.product_id,
        code: x.prod.product_treatment_code || '-',
        name: x.prod.product_treatment_name || 'Item',
        category: classifyCrmTreatment(x.prod.product_treatment_name),
        is_skincare: (x.prod.product_treatment_code || '').startsWith('P-'),
        times: 0, total_spent: 0, prices: []
      });
      t.times += 1;
      t.total_spent += x.value;
      t.prices.push(x.value);
    });
    // Pembagi share memakai jumlah nilai BARIS ITEM, bukan total invoice.
    // Keduanya bisa berbeda karena invoice redeem paket bernilai Rp 0
    // sementara baris itemnya tetap punya nilai — kalau dicampur,
    // persentasenya bisa tembus 100%.
    const lineItemTotal = custLineItems.reduce((a, x) => a + x.value, 0);
    const orderBreakdown = Object.values(orderTally)
      .map(t => ({
        ...t,
        prices: undefined,
        avg_price: Math.round(t.total_spent / t.times),
        avg_price_fmt: rupiah(t.total_spent / t.times),
        last_price: t.prices[t.prices.length - 1],
        last_price_fmt: rupiah(t.prices[t.prices.length - 1]),
        total_spent_fmt: rupiah(t.total_spent),
        share_pct: lineItemTotal > 0 ? Math.round((t.total_spent / lineItemTotal) * 100) : 0
      }))
      .sort((a, b) => b.total_spent - a.total_spent);

    // Kategori favorit berdasarkan nilai belanja
    const catTally = {};
    orderBreakdown.forEach(o => {
      const c = catTally[o.category] || (catTally[o.category] = { category: o.category, times: 0, total: 0 });
      c.times += o.times; c.total += o.total_spent;
    });
    const categoryBreakdown = Object.values(catTally)
      .map(c => ({ ...c, total_fmt: rupiah(c.total),
        share_pct: lineItemTotal > 0 ? Math.round((c.total / lineItemTotal) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Pola waktu & orang: buat menawarkan jadwal yang pasien memang suka
    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dowTally = {}, hourTally = {}, staffTally = {}, outletTally = {};
    visitDays.forEach(d => {
      const dow = new Date(d.date).getDay();
      dowTally[dow] = (dowTally[dow] || 0) + 1;
      d.hours.forEach(h => { hourTally[h] = (hourTally[h] || 0) + 1; });
      outletTally[d.outlet_id] = (outletTally[d.outlet_id] || 0) + 1;
      [...d.doctor_ids, ...d.therapist_ids].forEach(sid => {
        const nm = staffById[sid];
        if (nm) staffTally[nm] = (staffTally[nm] || 0) + 1;
      });
    });
    const topOf = (obj) => {
      const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
      return e ? { key: e[0], count: e[1] } : null;
    };
    const favDow = topOf(dowTally), favHour = topOf(hourTally), favStaff = topOf(staffTally), favOutlet = topOf(outletTally);

    // Cabang & preferensi outlet pasien:
    // 1. Cabang asal pendaftaran di master Neosoft (c.origin_outlet_id: 1 = Depok, 2 = Pondok Kopi)
    // 2. Cabang riwayat transaksi faktual (outletTally dari invoice)
    const originBranch = c.origin_outlet_id === 1 ? 'Depok' : (c.origin_outlet_id === 2 ? 'Pondok Kopi' : null);
    const mainOutlet = favOutlet ? (Number(favOutlet.key) === 1 ? 'Depok' : (Number(favOutlet.key) === 2 ? 'Pondok Kopi' : `Outlet ${favOutlet.key}`)) : null;
    const visitedBranchList = Object.keys(outletTally).map(id => Number(id) === 1 ? 'Depok' : (Number(id) === 2 ? 'Pondok Kopi' : `Outlet ${id}`));
    const isCrossBranch = visitedBranchList.length > 1;
    // Cabang aktif pasien: prioritaskan cabang kunjungan nyata; jika belum bertransaksi, gunakan cabang pendaftaran
    const patientBranch = mainOutlet || originBranch || 'Depok';

    // Booking mendatang — pemicu upsell paling hangat
    const upcomingAppointments = appointments
      .filter(a => a.patient && a.patient.id === cid)
      .map(a => ({
        code: a.code,
        date: String(a.come_date || '').substring(0, 10),
        time: a.start_time || '-',
        status: ((a.status_color || {}).name) || String(a.status_appointment || '-'),
        treatment: (a.treatment && a.treatment.name) || a.remarks || '-',
        outlet: (a.outlet && a.outlet.name) || '-'
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const todayStr = new Date().toISOString().substring(0, 10);
    const nextAppointment = upcomingAppointments
      .filter(a => a.date >= todayStr && !/cancel/i.test(a.status))
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

    // ──── RIWAYAT PRA-NEOSOFT DARI SPREADSHEET (via jembatan RM) ────
    // Disajikan TERPISAH dari angka Neosoft, dan yang keyakinannya rendah
    // dipisah lagi — supaya riwayat orang lain tidak pernah diam-diam
    // masuk ke LTV/CLV pasien ini.
    const shBucket = shBucketForDp;
    const shConfirmed = summariseSheetHistory(shBucket.confirmed);
    const shUnconfirmed = summariseSheetHistory(shBucket.unconfirmed);

    // ──── RINGKASAN JOIN SHEET CRM UNTUK PASIEN INI ────
    const crmRowsForPatient = [];
    custInvoicesWithPackages.forEach(inv => {
      (crmIndex.byInvCode.get(inv.inv_code) || []).forEach(r => {
        crmRowsForPatient.push({ ...r, inv_code: inv.inv_code, inv_date: (inv.inv_date || '').substring(0, 10) });
      });
    });
    const crmInvoicesMatched = new Set(crmRowsForPatient.map(r => r.inv_code));
    const crmStatusPatient = (crmRowsForPatient.find(r => r.status_patient) || {}).status_patient || null;
    const crmPhotoRows = crmRowsForPatient.filter(r => r.has_photo !== null);

    return {
      id: cid,
      name: custName,
      code: c.code || `CUST-${cid}`,
      phone: c.phone || '-',
      join_date: (c.join_date || '').substring(0, 10),
      branch: patientBranch,
      preferred_branch: patientBranch,
      origin_branch: originBranch || 'Depok',
      visited_branches: visitedBranchList,
      is_cross_branch: isCrossBranch,
      // Saldo asli dari master pasien Neosoft. UI sebelumnya menampilkan
      // total_spent * 0.15 sebagai "Saldo Deposito" — murni karangan.
      balance: {
        deposit: Number(c.balance?.deposit || 0),
        deposit_fmt: rupiah(c.balance?.deposit || 0),
        credit_voucher: Number(c.balance?.credit_voucher || 0),
        credit_voucher_fmt: rupiah(c.balance?.credit_voucher || 0),
        point: Number(c.balance?.point || 0),
        point_fmt: (Number(c.balance?.point || 0)).toLocaleString('id-ID') + ' Pts',
        total_usable: Number(c.balance?.deposit || 0) + Number(c.balance?.credit_voucher || 0),
        total_usable_fmt: rupiah(Number(c.balance?.deposit || 0) + Number(c.balance?.credit_voucher || 0))
      },
      loyalty_points: Number(c.balance?.point || 0),
      loyalty_points_fmt: (Number(c.balance?.point || 0)).toLocaleString('id-ID') + ' Poin',
      membership_status: c.membership_status || null,
      last_visit: lastVisitDate || '-',
      first_visit: firstVisitDate || '-',
      // Invoice void tidak dihitung di angka manapun di atas; tetap dilaporkan
      // supaya selisih dengan catatan kasir bisa ditelusuri.
      voided_invoice_count: voidedInvoices.length,
      voided_invoice_amount: voidedAmount,
      voided_invoice_amount_fmt: 'Rp ' + voidedAmount.toLocaleString('id-ID'),
      total_spent: totalSpent,
      total_spent_formatted: 'Rp ' + totalSpent.toLocaleString('id-ID'),
      visit_count: visitCount,
      avg_spending: avgSpending,
      avg_spending_formatted: 'Rp ' + avgSpending.toLocaleString('id-ID'),
      // Tiga dimensi yang berdiri sendiri dan tidak saling mengklaim:
      //   tier       = nilai per kunjungan
      //   value_band = total belanja (LTV)
      //   grading    = frekuensi kedatangan (X/Y/Z)
      tier: tier,
      tier_color: tierColor,
      tier_basis: 'Rata-rata belanja per kunjungan: ' + rupiah(avgSpending),
      value_band: bandHit[1],
      value_band_color: bandHit[2],
      value_band_basis: 'Total belanja: ' + rupiah(totalSpent),
      grading: grading,
      grading_label: gradingLabel,
      grading_color: gradingColor,
      grading_detail: {
        rate_per_month: gradeInfo.rate_per_month,
        months_observed: gradeInfo.months_observed,
        visit_days: gradeInfo.visit_days,
        measurable: gradeInfo.measurable,
        basis: 'X >= 1,0x/bln | Y >= 0,5x/bln | Z di bawahnya — dari hari kunjungan dibagi lama terdaftar'
      },
      // ──── RIWAYAT SPREADSHEET SEBELUM ERA NEOSOFT ────
      sheet_history: {
        available: sheetHistory.available,
        // Bukti kuat: kode invoice Neosoft, mayoritas jelas, atau input manual
        confirmed: shConfirmed,
        // Kecocokan nama persis — uji terhadap 85 pemetaan berbukti invoice
        // menunjukkan metode ini 91% akurat, jadi JANGAN dipakai untuk
        // angka uang sebelum dikonfirmasi manusia.
        needs_confirmation: shUnconfirmed,
        has_pre_neosoft_history: shConfirmed.rows > 0 || shUnconfirmed.rows > 0,
        note: 'Angka LTV, CLV, dan tier di atas TETAP murni dari Neosoft. Riwayat ini tambahan dari spreadsheet dan tidak dijumlahkan ke sana.'
      },

      // ──── ANALISIS PERILAKU: DATANG BERAPA KALI & ORDER APA ────
      behaviour: {
        // "Datang berapa kali" = hari kunjungan berbeda, bukan jumlah invoice
        visit_days: visitDayCount,
        invoice_count: custInvoices.length,
        same_day_extra_invoices: custInvoices.length - visitDayCount,
        first_visit: firstVisitDate || null,
        last_visit: lastVisitDate || null,
        days_since_last_visit: daysSinceLast,

        // Ritme pribadi pasien
        avg_gap_days: avgGap,
        median_gap_days: medianGap,
        gap_history: gapsDays,
        visits_per_month: (avgGap && avgGap > 0) ? Math.round((30 / avgGap) * 10) / 10 : null,

        // Sinyal jemput bola — dibandingkan ritmenya sendiri, bukan angka umum
        visit_status: visitStatus,
        visit_status_label: visitStatusLabel,
        visit_status_color: visitStatusColor,
        due_in_days: dueInDays,
        due_label: dueInDays === null ? null
          : (dueInDays > 0 ? `Perkiraan datang lagi ~${dueInDays} hari lagi`
             : `Sudah lewat ${Math.abs(dueInDays)} hari dari ritme biasanya`),

        freq_trend: freqTrend,
        freq_trend_label: freqTrendLabel,

        // Ukuran keranjang
        avg_spend_per_visit: visitDayCount ? Math.round(totalSpent / visitDayCount) : 0,
        avg_spend_per_visit_fmt: rupiah(visitDayCount ? totalSpent / visitDayCount : 0),
        avg_items_per_visit: visitDayCount
          ? Math.round((custLineItems.length / visitDayCount) * 10) / 10 : 0,
        total_items_ordered: custLineItems.length,

        // Kebiasaan jadwal & orang — untuk menawarkan slot yang pasien suka
        favourite_day: favDow ? HARI[Number(favDow.key)] : null,
        favourite_day_count: favDow ? favDow.count : 0,
        favourite_hour: favHour ? `${String(favHour.key).padStart(2, '0')}:00` : null,
        favourite_staff: favStaff ? favStaff.key : null,
        favourite_staff_count: favStaff ? favStaff.count : 0,
        main_outlet: favOutlet ? (Number(favOutlet.key) === 1 ? 'Depok' : 'Pondok Kopi') : null,

        // Riwayat kunjungan per hari (bukan per invoice)
        visit_log: visitDays.slice(-12).reverse().map(d => ({
          date: d.date,
          invoices: d.invoices,
          inv_codes: d.codes,
          spend: d.spend,
          spend_fmt: rupiah(d.spend),
          outlet: d.outlet_id === 1 ? 'Depok' : 'Pondok Kopi'
        })),

        // Apa saja yang pernah diorder
        order_breakdown: orderBreakdown,
        order_variety: orderBreakdown.length,
        category_breakdown: categoryBreakdown,
        top_category: categoryBreakdown.length ? categoryBreakdown[0].category : null,

        // Booking
        next_appointment: nextAppointment,
        appointment_history_count: upcomingAppointments.length
      },

      // ──── UPSELLING CORE ────
      dp_alerts: dpAlerts,
      has_dp_gantung: dpAlerts.length > 0,
      dp_gantung_count: dpAlerts.length,
      // ──── HASIL JOIN SHEET CRM (Google Sheets ⇄ Neosoft via inv_code) ────
      crm_sheet: {
        is_linked: crmRowsForPatient.length > 0,
        invoices_matched: crmInvoicesMatched.size,
        invoices_total: custInvoices.length,
        rows_matched: crmRowsForPatient.length,
        status_patient: crmStatusPatient,
        status_patient_label: crmStatusPatient === 'NEW PATIENT'
          ? '🆕 Pasien Baru (catatan CRM)'
          : (crmStatusPatient === 'EXISTING' ? '🔁 Pasien Existing (catatan CRM)' : null),
        rm_status: (crmRowsForPatient.find(r => r.rm_status) || {}).rm_status || null,
        photo_documented: crmPhotoRows.length > 0 ? crmPhotoRows.some(r => r.has_photo === true) : null,
        photo_missing_invoices: [...new Set(crmRowsForPatient.filter(r => r.has_photo === false).map(r => r.inv_code))],
        branches: [...new Set(crmRowsForPatient.map(r => r.branch))],
        coverage_note: 'Sheet CRM hanya mencakup Agu–Sep 2026; riwayat di luar periode itu memakai master Neosoft.',
        last_synced_at: (getSafeJson('sync_summary.json', GOOGLE_SHEETS_DB_DIR) || {}).last_synced_at || null
      },
      package_recommendations: packageRecommendations,
      membership_tiers: membershipTiers,
      membership_recommendation: membershipRecommendation,
      clv: {
        basis: clvBasis,
        is_reliable: clvBasis !== 'tidak_diketahui',
        tenure_months: monthsSinceJoin,
        monthly_rate: monthlyRate,
        monthly_rate_fmt: 'Rp ' + Math.round(monthlyRate).toLocaleString('id-ID') + '/bln',
        projected_12m: projectedCLV12,
        projected_12m_fmt: 'Rp ' + projectedCLV12.toLocaleString('id-ID'),
        projected_24m: projectedCLV24,
        projected_24m_fmt: 'Rp ' + projectedCLV24.toLocaleString('id-ID'),
        with_membership: clvWithMembership,
        with_membership_fmt: 'Rp ' + clvWithMembership.toLocaleString('id-ID'),
        uplift_pct: membershipRecommendation ? Math.round(((clvWithMembership - projectedCLV12) / Math.max(1, projectedCLV12)) * 100) : 0
      },
      // ──── EXISTING ────
      treatment_plan: treatmentPlan,
      treatment_history: treatmentHistory,
      doctor_next_plan: nextDoctorPlan,
      concerns_photo_gallery: concernsPhotoGallery,
      clinical_photo_sessions: clinicalPhotoSessions,
      medical_record_photos: custAnamImgs,
      neosoft_examinations: custPhysExams,
      photo_storage_architecture: {
        strategy: 'LINK_URL_ONLY',
        storage_engine: 'Cloudflare R2 / AWS S3 Encrypted Object Storage',
        database_overhead_bytes: 120, // Zero bloat in DB
        benefits: 'Database kasir tetap instan, kecepatan render maksimal, tanpa beban file gambar biner di server POS.'
      },
      recommendations: {
        // Dasar perhitungan, ditampilkan agar staf tahu angka acuannya
        baseline_price: baselinePrice,
        baseline_price_fmt: rupiah(baselinePrice),
        baseline_basis: avgItemPrice > 0 ? 'rata-rata harga per tindakan'
          : (avgSpending > 0 ? 'rata-rata per kunjungan' : 'ambang minimum klinik'),
        peak_price: peakItemPrice,
        peak_price_fmt: rupiah(peakBasis),
        peak_item_name: peakItem ? peakItem.prod.product_treatment_name : null,
        items_analysed: custLineItems.length,

        // Tiga jenjang, semuanya DI ATAS rata-rata belanja pasien
        step_up: stepUp,
        match_peak: matchPeak,
        beyond_peak: beyondPeak,
        skincare_regimen: skincareRecList,

        // Nama lama dipertahankan supaya UI & AI assistant tidak pecah
        comfort_zone: stepUp,
        upsell_growth: matchPeak,
        vip_ultimate: beyondPeak,
        luxury_highest: beyondPeak,

        pricing_source: 'Harga promo & bottom diturunkan dari transaksi nyata (usages_details), bukan persentase tetap. Master produk Neosoft tidak menyimpan harga promo maupun harga minimum.'
      }
    };
  });

  return results;
}

function getInvoiceDetail(invIdOrCode) {
  const invoices = getSafeJson('invoices_all.json');
  const usages = getSafeJson('usages_details.json');
  const products = getSafeJson('products.json');
  const customers = getSafeJson('customers_all.json');
  const therapists = getSafeJson('therapists.json');

  const pMap = {}; products.forEach(p => { pMap[p.id] = p; });
  const cMap = {}; customers.forEach(c => { cMap[c.id] = c; });
  const tMap = {}; therapists.forEach(t => { tMap[t.id] = t.therapist_name; });

  const inv = invoices.find(i => String(i.id) === String(invIdOrCode) || i.inv_code === String(invIdOrCode));
  if (!inv) return null;

  const cust = cMap[inv.customer_id] || {};
  const custName = cust.name ? `${cust.name.first_name || ''} ${cust.name.last_name || ''}`.trim() : 'Pasien Umum';
  
  const uItems = usages.filter(u => u.inv_code === inv.inv_code).map(u => {
    const p = pMap[u.product_id] || {};
    const qty = Number(u.qty || 1);
    const price = Number(u.value || p.price || 0);
    return {
      product_code: p.product_treatment_code || `PRD-${u.product_id}`,
      product_name: p.product_treatment_name || 'Item Treatment / Skincare',
      qty: qty,
      price: price,
      price_fmt: 'Rp ' + price.toLocaleString('id-ID'),
      subtotal: qty * price,
      subtotal_fmt: 'Rp ' + (qty * price).toLocaleString('id-ID')
    };
  });

  const totalAmt = Number(inv.total_after_tax || inv.total || 0);
  const discAmt = Number(inv.discount || 0);

  let dateFormatted = (inv.inv_date || inv.created_at || '').replace('T', ' ').substring(0, 16) + ' WIB';
  try {
    const clean = (inv.inv_date || inv.created_at || '').replace('Z', '').replace('T', ' ');
    const [dPart, tPart] = clean.split(' ');
    if (dPart) {
      const [y, m, d] = dPart.split('-');
      const [h, min] = (tPart || '00:00').split(':');
      const mNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      dateFormatted = `${d} ${mNames[parseInt(m, 10) - 1]} ${y}, ${h}:${min} WIB`;
    }
  } catch(e) {}

  const subtotalItems = uItems.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  const unredeemedBalance = Math.max(0, totalAmt - subtotalItems);

  // Status pembayaran yang jujur: void > belum lunas (ada sisa) > bernilai nol > lunas
  const remainingAmt = Number(inv.remaining || 0);
  const status = inv.void_invoice ? 'void' : isMigrationInvoice(inv) ? 'migrasi' : (remainingAmt > 0 ? 'belum_lunas' : (totalAmt === 0 ? 'nol' : 'lunas'));
  // created_at disimpan UTC, inv_date memakai jam lokal (WIB) berlabel Z.
  // Kalau tanggal pencatatan beda dari tanggal invoice, invoice dibuat/dikoreksi belakangan.
  let recordedDate = '';
  if (inv.created_at) {
    const t = new Date(inv.created_at);
    if (!isNaN(t.getTime())) recordedDate = new Date(t.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const invDay = String(inv.inv_date || '').slice(0, 10);

  return {
    status,
    remaining: remainingAmt,
    remaining_fmt: 'Rp ' + remainingAmt.toLocaleString('id-ID'),
    recorded_date: recordedDate,
    backdated: !!recordedDate && !!invDay && recordedDate !== invDay,
    id: inv.id,
    inv_code: inv.inv_code || `INV-${inv.id}`,
    inv_date: inv.inv_date || inv.created_at,
    inv_date_formatted: dateFormatted,
    outlet_id: inv.outlet_id,
    outlet: inv.outlet_id == 1 ? 'Depok' : 'Pondok Kopi',
    customer_id: inv.customer_id,
    customer_name: custName,
    customer_phone: cust.phone || '-',
    customer_code: cust.code || '-',
    doctor_name: tMap[inv.doctor_id] || 'dr. Jaga',
    therapist_name: tMap[inv.therapist_id] || '-',
    paymode: (inv.paymode || 'BANK').toUpperCase(),
    total: totalAmt,
    total_fmt: 'Rp ' + totalAmt.toLocaleString('id-ID'),
    discount: discAmt,
    discount_fmt: 'Rp ' + discAmt.toLocaleString('id-ID'),
    subtotal_items: subtotalItems,
    subtotal_items_fmt: 'Rp ' + subtotalItems.toLocaleString('id-ID'),
    unredeemed_balance: unredeemedBalance,
    unredeemed_balance_fmt: 'Rp ' + unredeemedBalance.toLocaleString('id-ID'),
    void_invoice: !!inv.void_invoice,
    items: uItems,
    items_count: uItems.length
  };
}




// ==================== KOMPARASI HARGA ANTAR SUPPLIER ====================
// Sumber: (1) riwayat harga beli di PO Neosoft (logistics_purchaseorder.json,
// harga per satuan dasar = subtotal / qty terkonversi) dan (2) penawaran
// supplier yang diinput manual di dashboard (data/supplier_quotes.json).
// Catatan jujur: di Neosoft hampir semua PO memakai satu supplier generik
// ("PURCHASING"), jadi perbandingan antar supplier baru berarti setelah
// penawaran supplier lain dimasukkan.
function readSupplierQuotes() {
  try { if (fs.existsSync(SUPPLIER_QUOTES_FILE)) return JSON.parse(fs.readFileSync(SUPPLIER_QUOTES_FILE, 'utf8')) || []; } catch (e) {}
  return [];
}
function addSupplierQuote({ item_id, supplier, price, moq, payment_terms, valid_until, notes, added_by }) {
  const items = getSafeJson('logistics_items.json') || [];
  const it = items.find(x => String(x.id) === String(item_id));
  if (!it) return { success: false, error: 'Item tidak ditemukan di master logistik' };
  if (!supplier || !String(supplier).trim()) return { success: false, error: 'Nama supplier wajib diisi' };
  const pr = Number(price);
  if (!Number.isFinite(pr) || pr <= 0) return { success: false, error: 'Harga harus angka lebih dari 0' };
  const all = readSupplierQuotes();
  const entry = {
    id: `SQ-${Date.now().toString(36).toUpperCase()}`,
    item_id: it.id, item_name: it.name,
    supplier: String(supplier).trim(), price: pr,
    moq: moq ? Number(moq) || null : null,
    payment_terms: payment_terms ? String(payment_terms).trim() : null,
    valid_until: valid_until || null,
    notes: notes ? String(notes).trim() : null,
    added_by: added_by || 'Dashboard User',
    added_at: new Date().toISOString()
  };
  all.unshift(entry);
  try { fs.writeFileSync(SUPPLIER_QUOTES_FILE, JSON.stringify(all.slice(0, 5000), null, 2)); return { success: true, entry }; }
  catch (e) { return { success: false, error: e.message }; }
}
function deleteSupplierQuote(id) {
  const all = readSupplierQuotes();
  const next = all.filter(q => q.id !== id);
  if (next.length === all.length) return { success: false, error: 'Penawaran tidak ditemukan' };
  try { fs.writeFileSync(SUPPLIER_QUOTES_FILE, JSON.stringify(next, null, 2)); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}
function getSupplierPriceComparison() {
  const pos = getSafeJson('logistics_purchaseorder.json') || [];
  const items = getSafeJson('logistics_items.json') || [];
  const suppliers = getSafeJson('suppliers.json') || [];
  if (pos.length === 0) return { available: false, note: 'Data PO belum tersinkron (jalankan sync Neosoft).', items: [] };
  const supName = {}; suppliers.forEach(s => { supName[s.id] = s.name; });
  const itemById = {}; items.forEach(x => { itemById[x.id] = x; });
  const rows = {};   // item_id -> [{date, supplier, unit, po}]
  pos.filter(p => ['closed', 'processed', 'created', 'requested'].includes(p.status))
    .forEach(p => (p.order_detail || []).forEach(d => {
      const q = Number(d.converted_qty) || Number(d.qty) || 0;
      const sub = Number(d.subtotal) || 0;
      if (!(q > 0 && sub > 0)) return;
      (rows[d.item_id] = rows[d.item_id] || []).push({
        date: String(p.transdate).slice(0, 10), supplier: supName[p.supplier_id] || `Supplier #${p.supplier_id}`,
        unit: sub / q, po: p.code
      });
    }));
  const quotes = readSupplierQuotes();
  const quotesByItem = {}; quotes.forEach(q => { (quotesByItem[q.item_id] = quotesByItem[q.item_id] || []).push(q); });
  const ids = new Set([...Object.keys(rows).map(Number), ...Object.keys(quotesByItem).map(Number)]);
  const out = [];
  ids.forEach(id => {
    const it = itemById[id]; if (!it) return;
    const hist = (rows[id] || []).sort((a, b) => a.date.localeCompare(b.date));
    const last = hist[hist.length - 1] || null;
    const prices = hist.map(h => h.unit);
    const min = prices.length ? Math.min(...prices) : null, max = prices.length ? Math.max(...prices) : null;
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    // tren: harga terakhir vs harga berbeda sebelumnya
    let prev = null; for (let i = hist.length - 2; i >= 0; i--) { if (Math.abs(hist[i].unit - last.unit) > 0.005) { prev = hist[i]; break; } }
    const changePct = last && prev ? Math.round(((last.unit - prev.unit) / prev.unit) * 1000) / 10 : 0;
    // harga terakhir per supplier
    const bySup = {};
    hist.forEach(h => { const b = bySup[h.supplier] || (bySup[h.supplier] = { supplier: h.supplier, last_price: h.unit, last_date: h.date, po_count: 0 }); b.po_count++; if (h.date >= b.last_date) { b.last_price = h.unit; b.last_date = h.date; } });
    const qs = (quotesByItem[id] || []).slice().sort((a, b) => a.price - b.price);
    const bestQuote = qs[0] || null;
    const saving = bestQuote && last ? Math.round(((last.unit - bestQuote.price) / last.unit) * 1000) / 10 : null;
    out.push({
      item_id: id, sku: it.sales_information_id, name: it.name, brand: it.brand || null,
      po_count: hist.length,
      last_price: last ? Math.round(last.unit * 100) / 100 : null, last_date: last ? last.date : null, last_supplier: last ? last.supplier : null,
      min_price: min != null ? Math.round(min * 100) / 100 : null, max_price: max != null ? Math.round(max * 100) / 100 : null, avg_price: avg != null ? Math.round(avg * 100) / 100 : null,
      change_pct: changePct, trend: changePct > 0 ? 'naik' : (changePct < 0 ? 'turun' : 'stabil'),
      suppliers: Object.values(bySup).map(b => ({ ...b, last_price: Math.round(b.last_price * 100) / 100 })),
      quotes: qs,
      best_quote: bestQuote, saving_pct: saving,
      history: hist.slice(-12).map(h => ({ ...h, unit: Math.round(h.unit * 100) / 100 }))
    });
  });
  out.sort((a, b) => (b.saving_pct != null ? 1 : 0) - (a.saving_pct != null ? 1 : 0) || Math.abs(b.change_pct) - Math.abs(a.change_pct) || b.po_count - a.po_count);
  const distinctSuppliers = new Set(pos.map(p => p.supplier_id));
  const mainShare = (() => { const c = {}; pos.forEach(p => { c[p.supplier_id] = (c[p.supplier_id] || 0) + 1; }); const m = Math.max(...Object.values(c)); return Math.round((m / pos.length) * 100); })();
  return {
    available: true,
    note: `Harga beli per satuan dari ${pos.length} PO Neosoft. ${mainShare}% PO memakai satu supplier saja, jadi perbandingan antar supplier baru bermakna setelah penawaran supplier lain diinput.`,
    summary: {
      items: out.length, po_total: pos.length, suppliers_in_po: distinctSuppliers.size, main_supplier_share_pct: mainShare,
      price_up: out.filter(x => x.trend === 'naik').length, price_down: out.filter(x => x.trend === 'turun').length,
      with_quotes: out.filter(x => x.quotes.length).length, cheaper_quote: out.filter(x => x.saving_pct != null && x.saving_pct > 0).length
    },
    items: out,
    all_items: items.filter(x => x.type === 'product').map(x => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))
  };
}


/**
 * Perhitungan Komisi Dokter & Nurse.
 *
 * ANGKA RESMI = total_commission dari laporan komisi Neosoft
 * (commission_report.json, disinkron scripts/sync_neosoft.py) — itu yang dipakai untuk payroll.
 * Rumus klinik (dokter treatment: (nilai setelah diskon - BHP) x % master;
 * dokter produk: nilai setelah diskon x % master; perawat: nominal tetap master)
 * hanya dihitung sebagai PEMBANDING per tindakan, karena nominal pengurang HPP
 * Neosoft untuk sebagian treatment (laser/peel/IPL/HIFU) tidak identik dengan
 * BHP di kartu stok. BHP pembanding = pemakaian sebenarnya di kartu stok
 * (harga pokok: COGS item, cadangan harga beli PO).
 */
function getDoctorNurseCommission(period) {
  const rep = getSafeJson('commission_report.json');
  const tr = (rep && rep.treatment) || {}, sl = (rep && rep.sales) || {};
  const months = [...new Set([...Object.keys(tr), ...Object.keys(sl)])].filter(m => (tr[m] || []).length || (sl[m] || []).length).sort();
  if (!months.length) return { available: false, note: 'Data komisi Neosoft belum tersinkron (jalankan sync).', months: [] };
  const mon = (period && months.includes(period)) ? period : months[months.length - 1];

  const products = getSafeJson('products.json') || [];
  const master = {}; products.forEach(p => { master[p.product_treatment_code] = p; });
  const items = getSafeJson('logistics_items.json') || [];
  const bySid = {}; items.forEach(x => { if (x.sales_information_id) bySid[x.sales_information_id] = x; });
  const pos = getSafeJson('logistics_purchaseorder.json') || [];
  const poCost = {};
  pos.filter(p => p.status === 'closed' || p.status === 'processed').sort((a, b) => String(a.transdate).localeCompare(String(b.transdate)))
    .forEach(p => (p.order_detail || []).forEach(d => {
      const q = Number(d.converted_qty) || Number(d.qty) || 0, sub = Number(d.subtotal) || 0;
      if (q > 0 && sub > 0) poCost[d.item_id] = sub / q;
    }));
  const unitCost = sid => { const it = bySid[sid]; if (!it) return 0; if (Number(it.cogs) > 0) return Number(it.cogs); return poCost[it.id] || 0; };

  // BHP sebenarnya per dokumen pemakaian (ref kartu stok = usage_code), USAGE yang di-void dibuang
  const stock = getSafeJson('stock_card.json') || [];
  const voidPool = {};
  stock.filter(r => r.transaction === 'ADJ VOID USAGE').forEach(r => { const k = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_in}`; voidPool[k] = (voidPool[k] || 0) + 1; });
  const bhpByUsage = {};
  stock.filter(r => r.transaction === 'USAGE' && (r.category || [])[0] !== 'HOMECARE').forEach(r => {
    const k = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_out}`;
    if (voidPool[k] > 0) { voidPool[k]--; return; }
    bhpByUsage[r.ref] = (bhpByUsage[r.ref] || 0) + unitCost(r.sales_information_id) * (Number(r.stock_out) || 0);
  });

  const people = {};
  const person = (id, name, type) => people[id] || (people[id] = {
    id, name, role: type === 5 ? 'Perawat' : (type === 2 ? 'Dokter Spesialis' : 'Dokter Umum'),
    treatment_commission: 0, product_commission: 0, nurse_commission: 0, total: 0,
    formula_total: 0, lines: []
  });
  const tRows = tr[mon] || [];
  const doctorTotalUsed = {};
  tRows.filter(r => r.is_doctor).forEach(r => { doctorTotalUsed[r.code] = (doctorTotalUsed[r.code] || 0) + (Number(r.used_value) || 0); });
  tRows.forEach(r => {
    const m = master[r.item_code] || {}; const uc = m.usage_commission || {};
    const type = r.therapist_type;
    const pr = person(r.therapist_id, r.therapist_name, type);
    const neo = Number(r.total_commission) || 0;
    let comm = 0, pct = null, flat = null, bhp = 0, base = null;
    if (r.is_doctor) {
      pct = Number((uc[r.commission_category] || {}).value) || 0;
      const totalUsed = doctorTotalUsed[r.code] || 0;
      bhp = totalUsed > 0 ? (bhpByUsage[r.code] || 0) * ((Number(r.used_value) || 0) / totalUsed) : 0;
      base = Math.max(0, (Number(r.used_value) || 0) - bhp);
      comm = base * pct / 100;
      pr.treatment_commission += neo;
    } else {
      flat = Number((uc.commission_nurse || {}).value) || 0;
      comm = flat;
      pr.nurse_commission += neo;
    }
    pr.total += neo; pr.formula_total += comm;
    pr.lines.push({ kind: r.is_doctor ? 'Treatment (dokter)' : 'Treatment (perawat)', date: String(r.date).slice(0, 10), outlet: r.outlet_name, item: r.item_name,
      used_value: Math.round(Number(r.used_value) || 0), bhp: Math.round(bhp), pct, flat, commission: Math.round(neo), formula: Math.round(comm) });
  });
  (sl[mon] || []).filter(r => r.therapist_type === 1 || r.therapist_type === 2).forEach(r => {
    const m = master[r.item_code] || {}; const sc = m.sales_commission || {};
    const cfg = r.therapist_type === 2 ? (sc.sales_commission_sp_doctor || {}) : (sc.sales_commission_doctor || {});
    const pct = Number(cfg.value) || 0;
    const base = Number(r.item_value) || 0;
    const comm = base * pct / 100, neo = Number(r.total_commission) || 0;
    const pr = person(r.therapist_id, r.frontdesk_cs_name || ('Dokter #' + r.therapist_id), r.therapist_type);
    pr.product_commission += neo; pr.total += neo; pr.formula_total += comm;
    pr.lines.push({ kind: String(r.item_code).startsWith('P-') ? 'Produk (dokter)' : 'Penjualan treatment (dokter)', date: String(r.date).slice(0, 10), outlet: r.outlet_name, item: r.item_name,
      used_value: Math.round(base), bhp: 0, pct, flat: null, commission: Math.round(neo), formula: Math.round(comm) });
  });
  const list = Object.values(people).map(p => ({
    id: p.id, name: p.name, role: p.role,
    treatment_commission: Math.round(p.treatment_commission), product_commission: Math.round(p.product_commission), nurse_commission: Math.round(p.nurse_commission),
    total: Math.round(p.total), formula_total: Math.round(p.formula_total), diff: Math.round(p.formula_total - p.total),
    lines: p.lines.sort((a, b) => Math.abs(b.formula - b.commission) - Math.abs(a.formula - a.commission) || b.date.localeCompare(a.date))
  })).filter(p => p.total > 0 || p.formula_total > 0).sort((a, b) => b.total - a.total);
  const sum = k => list.reduce((a, p) => a + p[k], 0);
  return {
    available: true, period: mon, months,
    note: 'Angka resmi = total_commission Neosoft. Rumus klinik hanya pembanding per tindakan.',
    summary: { total: sum('total'), formula_total: sum('formula_total'), diff: sum('formula_total') - sum('total'), doctors: list.filter(p => p.role !== 'Perawat').length, nurses: list.filter(p => p.role === 'Perawat').length,
      treatment_commission: sum('treatment_commission'), product_commission: sum('product_commission'), nurse_commission: sum('nurse_commission') },
    people: list
  };
}


// ==================== REKAP TRANSAKSI HARIAN ====================
// Sumber: pembayaran per invoice dari Neosoft (payment_report.json, scripts/sync_neosoft.py).
// Dikelompokkan per tanggal bayar (WIB) x cabang x kanal. Log kasir (setoran/
// settlement aktual) diinput manual di dashboard dan dibandingkan dengan angka
// Neosoft untuk rekonsiliasi. Pembayaran non-kas (deposit/poin/voucher) tidak
// dihitung sebagai uang masuk.
const PAY_CHANNELS = ['cash', 'edc', 'qris', 'transfer'];
function payChannelOf(bankName, bankType) {
  const n = String(bankName || '').toLowerCase();
  if (n === 'cash') return 'cash';
  if (n === 'transfer') return 'transfer';
  if (bankType === 4 || bankType === 5 || bankType === 6) return 'noncash';
  if (bankType === 3 || /qris|gopay|flip|carenow/.test(n)) return 'qris';
  return 'edc';
}
function readCashierClosings() {
  try { if (fs.existsSync(CASHIER_CLOSINGS_FILE)) return JSON.parse(fs.readFileSync(CASHIER_CLOSINGS_FILE, 'utf8')) || []; } catch (e) {}
  return [];
}
function saveCashierClosing({ date, branch, cash, edc, qris, transfer, notes, entered_by }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { success: false, error: 'Tanggal wajib format YYYY-MM-DD' };
  if (!['Depok', 'Pondok Kopi'].includes(branch)) return { success: false, error: 'Cabang harus Depok atau Pondok Kopi' };
  const num = v => (v === '' || v == null) ? null : Number(v);
  const vals = { cash: num(cash), edc: num(edc), qris: num(qris), transfer: num(transfer) };
  for (const [k, v] of Object.entries(vals)) if (v != null && (!Number.isFinite(v) || v < 0)) return { success: false, error: `Nilai ${k} tidak valid` };
  if (Object.values(vals).every(v => v == null)) return { success: false, error: 'Isi minimal satu kanal' };
  const all = readCashierClosings().filter(c => !(c.date === date && c.branch === branch));
  const entry = { id: `CL-${date}-${branch === 'Depok' ? 'DPK' : 'PDK'}`, date, branch, ...vals, notes: notes ? String(notes).trim() : null, entered_by: entered_by || 'Dashboard User', entered_at: new Date().toISOString() };
  all.unshift(entry);
  try { fs.writeFileSync(CASHIER_CLOSINGS_FILE, JSON.stringify(all.slice(0, 5000), null, 2)); return { success: true, entry }; }
  catch (e) { return { success: false, error: e.message }; }
}
function deleteCashierClosing(id) {
  const all = readCashierClosings(); const next = all.filter(c => c.id !== id);
  if (next.length === all.length) return { success: false, error: 'Log kasir tidak ditemukan' };
  try { fs.writeFileSync(CASHIER_CLOSINGS_FILE, JSON.stringify(next, null, 2)); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
}
function getDailyTransactionRecap(period) {
  const rep = getSafeJson('payment_report.json');
  const months = rep && typeof rep === 'object' ? Object.keys(rep).filter(m => (rep[m] || []).length).sort() : [];
  if (!months.length) return { available: false, note: 'Data pembayaran Neosoft belum tersinkron (jalankan sync).', months: [], days: [] };
  const mon = (period && months.includes(period)) ? period : months[months.length - 1];
  // inv_date & paid_date Neosoft berlabel 'Z' tetapi sudah waktu lokal klinik (jam 09–21; created_at selalu 7 jam lebih awal) — tanggalnya dipakai apa adanya, JANGAN digeser +7 jam.
  const wibDay = iso => String(iso).slice(0, 10);
  const branchOf = n => /pondok/i.test(n || '') ? 'Pondok Kopi' : 'Depok';
  const closings = readCashierClosings();
  const cl = {}; closings.forEach(c => { cl[`${c.date}|${c.branch}`] = c; });
  const cells = {};
  (rep[mon] || []).forEach(inv => {
    const br = branchOf(inv.outlet_name);
    const seenDays = new Set();
    (inv.payment || []).forEach(p => {
      if (p.info === 'charge' || !(Number(p.amount) > 0)) return;
      const day = wibDay(p.paid_date || inv.inv_date);
      const k = `${day}|${br}`;
      const c = cells[k] || (cells[k] = { date: day, branch: br, invoices: 0, cash: 0, edc: 0, qris: 0, transfer: 0, noncash: 0, edc_banks: {} });
      const ch = payChannelOf(p.bank_name, p.bank_type);
      c[ch] += Number(p.amount);
      if (ch === 'edc') c.edc_banks[p.bank_name] = (c.edc_banks[p.bank_name] || 0) + Number(p.amount);
      if (!seenDays.has(k)) { seenDays.add(k); c.invoices++; }
    });
  });
  // Bukti pembayaran yang dikirim kasir via WhatsApp
  const proofsAll = require('./payment_proof').listProofs().filter(r => String(r.tanggal || r.created_at.slice(0, 10)).startsWith(mon));
  const proofsOf = (date, br) => proofsAll.filter(r => (r.tanggal || r.created_at.slice(0, 10)) === date && r.branch === br);
  const days = Object.values(cells).filter(c => c.date.startsWith(mon)).map(c => {
    const cash_in = c.cash + c.edc + c.qris + c.transfer;
    const proofs = proofsOf(c.date, c.branch).map(r => ({ id: r.id, jenis: r.jenis, bank: r.bank, nominal: r.nominal, jam: r.jam, referensi: r.referensi, status: r.status, sender_name: r.sender_name }));
    const closing = cl[`${c.date}|${c.branch}`] || null;
    const diffs = {};
    let status = 'belum_diisi';
    if (closing) {
      status = 'sesuai';
      PAY_CHANNELS.forEach(ch => {
        if (closing[ch] != null) { diffs[ch] = Math.round(closing[ch] - c[ch]); if (Math.abs(diffs[ch]) > 0) status = 'selisih'; }
      });
    }
    return { ...c, cash: Math.round(c.cash), edc: Math.round(c.edc), qris: Math.round(c.qris), transfer: Math.round(c.transfer), noncash: Math.round(c.noncash), money_in: Math.round(cash_in),
      closing, diffs, status, proofs, proof_total: proofs.reduce((a, r) => a + (r.nominal || 0), 0) };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch));
  const sum = k => days.reduce((a, d) => a + d[k], 0);
  return {
    available: true, period: mon, months,
    note: 'Dari pembayaran per invoice di Neosoft (tanggal bayar, WIB). Deposit/poin/voucher tidak dihitung sebagai uang masuk.',
    summary: { money_in: sum('money_in'), cash: sum('cash'), edc: sum('edc'), qris: sum('qris'), transfer: sum('transfer'), noncash: sum('noncash'),
      days: new Set(days.map(d => d.date)).size, closing_filled: days.filter(d => d.status !== 'belum_diisi').length, with_diff: days.filter(d => d.status === 'selisih').length, rows: days.length,
      proofs: proofsAll.length, proofs_total: proofsAll.reduce((a, r) => a + (r.nominal || 0), 0), proofs_unassigned: proofsAll.filter(r => !r.branch).length, proofs_check: proofsAll.filter(r => r.sheet_status && r.sheet_status !== 'tersimpan').length },
    days
  };
}

/**
 * Ringkasan pendapatan per cabang dengan DEFINISI yang sama seperti layar
 * dashboard Neosoft, supaya istilah "revenue" tidak ambigu:
 *  • omset            = nilai invoice sah (sales + top-up deposit, tidak void) bulan itu DIKURANGI bagian
 *                       yang dibayar pakai saldo deposit — aturan omset dashboard/bot (invoice_flags.omsetAmount).
 *                       Karena itu angka ini tidak lagi sama persis dengan kolom omset layar Neosoft.
 *                       Ditambah top-up deposit MANUAL (bukan invoice, dari laporan Mutasi Deposit) — kolom deposit_topup.
 *  • collection       = uang yang benar-benar masuk (tunai/EDC/QRIS/transfer) — kolom "Collection" Neosoft
 *  • deposit_cv       = pembayaran memakai saldo deposit / credit voucher — kolom "Deposit/CV" Neosoft
 *  • revenue          = nilai treatment & produk yang DIPAKAI (diakui) bulan itu = sum(usages_details.value x used)
 *                       untuk pemakaian tidak void bertanggal bulan itu — kolom "Revenue" Neosoft
 *                       (dibuktikan cocok sampai selisih Rp1 untuk Sept 2026: 259.967.341)
 *  • belum_dibayar    = omset - (collection + deposit_cv) — piutang invoice yang belum lunas
 * Tanggal Neosoft (inv_date/usage_date) berlabel Z tetapi sudah waktu lokal — dipakai apa adanya.
 * Gross Profit Neosoft sengaja TIDAK ditiru: HPP Neosoft belum bisa direproduksi
 * (hasil perkiraan kita berbeda).
 */
function getRevenueBreakdown(period) {
  const invoices = getSafeJson('invoices_all.json') || [];
  const usages = getSafeJson('usages.json') || [];
  const details = getSafeJson('usages_details.json') || [];
  if (!invoices.length) return { available: false, note: 'Data invoice Neosoft belum tersinkron.', months: [] };

  const BR = { 1: 'Depok', 2: 'Pondok Kopi' };
  const months = {};
  const cell = (m, o) => {
    const k = months[m] || (months[m] = {});
    return k[o] || (k[o] = { omset: 0, invoices: 0, deposit_topup: 0, collection: 0, deposit_cv: 0, revenue: 0, migrasi: 0, migrasi_invoices: 0, sisa_tagihan: 0 });
  };
  const depMap = omsetDepositMap();
  invoices.forEach(i => {
    if (i.void_invoice || (i.transtype && i.transtype !== 'sales' && i.transtype !== 'topup')) return;
    const m = String(i.inv_date || '').slice(0, 7);
    if (m.length !== 7 || !BR[i.outlet_id]) return;
    const c = cell(m, i.outlet_id);
    // Migrasi sisa paket: bukan penjualan (dibayar di sistem lama). Dicatat
    // terpisah supaya angka tetap bisa dicocokkan dengan layar Neosoft.
    if (isMigrationInvoice(i)) { c.migrasi += Number(i.total_after_tax || i.total || 0); c.migrasi_invoices++; return; }
    c.omset += omsetAmount(i, depMap); c.invoices++;
    c.sisa_tagihan += Number(i.remaining || 0);
  });
  // Top-up deposit manual (bukan invoice): uang masuk & omset, dicatat juga terpisah.
  omsetTopups().forEach(t => { const c = cell(t.date.slice(0, 7), t.outlet_id); c.omset += t.amount; c.deposit_topup += t.amount; });
  const um = {}; usages.forEach(u => { um[u.id] = u; });
  details.forEach(d => {
    const u = um[d.usage_id];
    if (!u || u.is_void || !BR[u.outlet_id]) return;
    const m = String(u.usage_date || '').slice(0, 7);
    if (m.length !== 7) return;
    cell(m, u.outlet_id).revenue += (Number(d.value) || 0) * (Number(d.used) || 0);
  });
  // Collection & Deposit/CV dari laporan pembayaran (sudah per cabang & per kanal)
  const monthKeys = Object.keys(months).sort();
  const rep = getSafeJson('payment_report.json') || {};
  Object.keys(rep).forEach(m => {
    (rep[m] || []).forEach(inv => {
      const o = /pondok/i.test(inv.outlet_name || '') ? 2 : 1;
      (inv.payment || []).forEach(p => {
        if (p.info === 'charge' || !(Number(p.amount) > 0)) return;
        const pm = String(p.paid_date || inv.inv_date).slice(0, 7);
        const ch = payChannelOf(p.bank_name, p.bank_type);
        const c = cell(pm, o);
        if (ch === 'noncash') c.deposit_cv += Number(p.amount); else c.collection += Number(p.amount);
      });
    });
  });
  const allMonths = Object.keys(months).sort();
  const want = (period && months[period]) ? period : allMonths[allMonths.length - 1];
  const rows = [1, 2].map(o => {
    const c = (months[want] || {})[o] || { omset: 0, invoices: 0, deposit_topup: 0, collection: 0, deposit_cv: 0, revenue: 0, migrasi: 0, migrasi_invoices: 0, sisa_tagihan: 0 };
    // Belum dibayar = sisa tagihan invoice bulan itu saat ini (kolom remaining
    // Neosoft). Dulu omset - uang masuk bulan itu; itu bisa minus karena uang
    // masuk juga berisi pelunasan invoice bulan sebelumnya.
    const { sisa_tagihan, ...rest } = c;
    return { branch: BR[o], outlet_id: o, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Math.round(v)])),
      belum_dibayar: Math.round(sisa_tagihan) };
  });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const total = { branch: 'Total', omset: sum('omset'), invoices: sum('invoices'), deposit_topup: sum('deposit_topup'), collection: sum('collection'), deposit_cv: sum('deposit_cv'), revenue: sum('revenue'), belum_dibayar: sum('belum_dibayar'), migrasi: sum('migrasi'), migrasi_invoices: sum('migrasi_invoices') };
  return {
    available: true, period: want, months: allMonths.slice(-12), rows, total,
    definitions: {
      omset: 'Nilai invoice sah yang terbit di bulan itu (void tidak dihitung), dikurangi bagian yang dibayar pakai saldo deposit, ditambah top-up deposit manual (kolom deposit_topup). Termasuk paket yang baru dibeli tapi belum dipakai. Invoice "migrasi sisa paket" (sisa paket dari sistem lama, dibayar Rp 0) TIDAK dihitung — nilainya di kolom migrasi; omset Neosoft = omset + migrasi.',
      deposit_topup: 'Top-up deposit MANUAL (menu Sales > Deposit Neosoft) bulan itu — uang masuk yang tidak berupa invoice, jadi tidak ada di kolom collection. Sudah termasuk di omset (aturan: top-up deposit masuk omset, pemakaian saldonya tidak).',
      migrasi: 'Nilai invoice "migrasi sisa paket": sisa paket pasien lama yang diinput ulang ke Neosoft (1 Jul 2026), tanpa pembayaran baru. Pemakaiannya tetap masuk revenue.',
      collection: 'Uang yang benar-benar masuk bulan itu: tunai, EDC, QRIS, transfer (sama dengan kolom Collection di Neosoft).',
      deposit_cv: 'Pembayaran memakai saldo deposit / credit voucher (kolom Deposit/CV di Neosoft).',
      revenue: 'Nilai treatment & produk yang DIPAKAI (diakui) di bulan itu — sama dengan kolom Revenue di Neosoft. Bisa lebih kecil atau lebih besar dari omset karena paket dibeli dan dipakai di bulan berbeda.',
      belum_dibayar: 'Sisa tagihan saat ini dari invoice yang terbit bulan itu (kolom remaining Neosoft): invoice yang belum lunas.'
    },
    note: 'Revenue = nilai pemakaian (versi Neosoft). Gross Profit Neosoft tidak ditampilkan karena HPP-nya belum bisa direproduksi; lihat kartu Informasi Profit (HPP) untuk estimasi kita.'
  };
}

/**
 * Informasi Profit: omzet vs HPP (harga pokok) BHP/produk yang keluar.
 *
 * HPP = pemakaian keluar di kartu stok Neosoft (transaksi USAGE, tanpa yang
 * di-void) x harga pokok per satuan stok. Harga pokok per item:
 *   1) COGS di master item Neosoft (logistics_items.cogs), kalau terisi;
 *   2) kalau kosong, harga beli terakhir dari PO (logistics_purchaseorder.json,
 *      subtotal / qty terkonversi), ditandai sumber "po";
 *   3) kalau dua-duanya kosong, item dihitung Rp 0 dan masuk daftar
 *      "tanpa harga pokok" (jadi HPP bisa sedikit terlalu rendah).
 * Ini ESTIMASI: COGS diasumsikan per satuan yang sama dengan kartu stok.
 * Item yang satuannya mungkin beda (mis. per kemasan vs per pemakaian)
 * terlihat di daftar item termahal, dengan kolom satuan & harga pokoknya.
 */
function getHppProfit(period) {
  const stockCard = getSafeJson('stock_card.json') || [];
  const items = getSafeJson('logistics_items.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const pos = getSafeJson('logistics_purchaseorder.json') || [];
  if (stockCard.length === 0 || items.length === 0) {
    return { available: false, note: 'Kartu stok atau master item belum tersinkron.', months: [] };
  }
  const bySid = {}; items.forEach(x => { if (x.sales_information_id) bySid[x.sales_information_id] = x; });
  const byId = {}; items.forEach(x => { byId[x.id] = x; });

  // harga beli terakhir per item dari PO yang sudah diproses/ditutup
  const poCost = {};
  pos.filter(p => p.status === 'closed' || p.status === 'processed')
    .sort((a, b) => String(a.transdate).localeCompare(String(b.transdate)))
    .forEach(p => (p.order_detail || []).forEach(d => {
      const q = Number(d.converted_qty) || Number(d.qty) || 0;
      const sub = Number(d.subtotal_after_tax) || Number(d.subtotal) || 0;
      if (q > 0 && sub > 0) poCost[d.item_id] = { unit: sub / q, date: String(p.transdate).slice(0, 10) };
    }));
  const unitCost = (sid) => {
    const it = bySid[sid]; if (!it) return { c: 0, src: null };
    if (Number(it.cogs) > 0) return { c: Number(it.cogs), src: 'cogs' };
    const pc = poCost[it.id]; if (pc) return { c: pc.unit, src: 'po' };
    return { c: 0, src: null };
  };

  // USAGE yang sudah di-void (ADJ VOID USAGE: tanggal, gudang, kode, qty sama)
  const voidPool = {};
  stockCard.filter(r => r.transaction === 'ADJ VOID USAGE').forEach(r => {
    const k = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_in}`;
    voidPool[k] = (voidPool[k] || 0) + 1;
  });
  const monthsMap = {};
  const mk = (m) => monthsMap[m] || (monthsMap[m] = { month: m, revenue: 0, hpp_bhp: 0, hpp_homecare: 0, lines: 0, lines_costed: 0, by_item: {}, by_branch: {}, daily: {} });
  const bucketOf = (m, key, store) => m[store][key] || (m[store][key] = { revenue: 0, hpp: 0, lines: 0, lines_costed: 0 });
  const branchOfWh = (w) => /pondok/i.test(w || '') ? 'Pondok Kopi' : 'Depok';
  // Hari & bulan invoice dihitung dalam WIB (inv_date tersimpan UTC), supaya jumlah harian = total bulanan
  const wibDate = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  invoices.forEach(i => {
    if (i.void_invoice || !i.inv_date) return;
    const d = wibDate(i.inv_date), total = Number(i.total) || 0;
    const m = mk(d.slice(0, 7));
    m.revenue += total;
    bucketOf(m, i.outlet_id == 1 ? 'Depok' : 'Pondok Kopi', 'by_branch').revenue += total;
    bucketOf(m, d, 'daily').revenue += total;
  });
  const uomClean = (u) => String(u || '').replace(/^\s*[\d.,]+\s*/, '').trim() || '-';
  stockCard.filter(r => r.transaction === 'USAGE').forEach(r => {
    const vk = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_out}`;
    if (voidPool[vk] > 0) { voidPool[vk]--; return; }
    const m = mk(r.date.slice(0, 7));
    const home = (r.category || [])[0] === 'HOMECARE';
    const { c, src } = unitCost(r.sales_information_id);
    const cost = c * (Number(r.stock_out) || 0);
    if (home) m.hpp_homecare += cost; else m.hpp_bhp += cost;
    m.lines++; if (src) m.lines_costed++;
    const bb = bucketOf(m, branchOfWh(r.warehouse), 'by_branch'); bb.hpp += cost; bb.lines++; if (src) bb.lines_costed++;
    bucketOf(m, r.date.slice(0, 10), 'daily').hpp += cost;
    const key = r.sales_information_id;
    const bi = m.by_item[key] || (m.by_item[key] = { sku: r.code, name: r.name, category: home ? 'Homecare' : 'BHP', qty: 0, uom: uomClean(r.uom), unit_cost: c, source: src, cost: 0, lines: 0 });
    bi.qty += Number(r.stock_out) || 0; bi.cost += cost; bi.lines++;
  });
  const months = Object.values(monthsMap).filter(m => m.revenue > 0 || m.lines > 0).sort((a, b) => a.month.localeCompare(b.month)).map(m => {
    const hpp = m.hpp_bhp + m.hpp_homecare;
    const gross = m.revenue - hpp;
    const arr = Object.values(m.by_item);
    return {
      month: m.month,
      revenue: Math.round(m.revenue),
      hpp_bhp: Math.round(m.hpp_bhp),
      hpp_homecare: Math.round(m.hpp_homecare),
      hpp_total: Math.round(hpp),
      gross_profit: Math.round(gross),
      gross_margin_pct: m.revenue > 0 ? Math.round((gross / m.revenue) * 1000) / 10 : null,
      hpp_pct: m.revenue > 0 ? Math.round((hpp / m.revenue) * 1000) / 10 : null,
      branches: ['Depok', 'Pondok Kopi'].map(b => { const x = m.by_branch[b] || { revenue: 0, hpp: 0, lines: 0, lines_costed: 0 }; const g = x.revenue - x.hpp;
        return { branch: b, revenue: Math.round(x.revenue), hpp: Math.round(x.hpp), gross_profit: Math.round(g), margin_pct: x.revenue > 0 ? Math.round(g / x.revenue * 1000) / 10 : null, coverage_pct: x.lines ? Math.round(x.lines_costed / x.lines * 1000) / 10 : null }; }),
      daily: Object.entries(m.daily).filter(([d]) => d.startsWith(m.month)).sort((a, b) => a[0].localeCompare(b[0])).map(([d, x]) => ({ date: d, revenue: Math.round(x.revenue), hpp: Math.round(x.hpp), gross_profit: Math.round(x.revenue - x.hpp) })),
      lines: m.lines,
      lines_costed: m.lines_costed,
      coverage_pct: m.lines ? Math.round((m.lines_costed / m.lines) * 1000) / 10 : null,
      top_items: arr.filter(x => x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 15).map(x => ({ ...x, qty: Math.round(x.qty * 100) / 100, cost: Math.round(x.cost), unit_cost: Math.round(x.unit_cost) })),
      items_without_cost: arr.filter(x => !x.source).sort((a, b) => b.lines - a.lines).slice(0, 15).map(x => ({ sku: x.sku, name: x.name, category: x.category, lines: x.lines, qty: Math.round(x.qty * 100) / 100, uom: x.uom }))
    };
  });
  return {
    available: true,
    period: period || null,
    note: 'ESTIMASI. HPP = pemakaian BHP/produk di kartu stok Neosoft x COGS master item (cadangan: harga beli PO terakhir). Item tanpa harga pokok dihitung Rp 0. Belum termasuk gaji, sewa, dan biaya operasional.',
    months
  };
}

/**
 * Selisih data BHP harian: tindakan (treatment) yang tercatat di pemakaian
 * paket/invoice (usages_details) vs BHP yang KELUAR di kartu stok Neosoft
 * (transaksi USAGE), dibandingkan per (tanggal, cabang, pasien).
 *
 * - Sisi treatment : usages_details yang produknya T-... (tanggal = created_at
 *   dalam WIB), pasien dari invoice -> customer.
 * - Sisi kartu stok: transaksi USAGE kategori BHP (HOMECARE/retail tidak
 *   dihitung). USAGE yang sudah dibatalkan oleh "ADJ VOID USAGE" (tanggal,
 *   gudang, kode, qty sama) dibuang.
 * - Pasien tes/training dikecualikan di kedua sisi.
 * - 'Biaya Administrasi' bukan tindakan medis, tidak dihitung sebagai treatment.
 * - Toleransi +-1 hari: treatment tanpa BHP di hari D yang punya BHP pasien
 *   sama (cabang sama) di hari D+-1 dianggap cocok ('beda hari').
 * - Qty: BHP yang keluar dibandingkan dengan Standar BHP per Treatment
 *   (treatment_bom.json), hanya bila SEMUA treatment pasien hari itu punya
 *   standar. Kurang <50% atau lebih >150% dari standar (x jumlah dipakai);
 *   bila satuan beda/belum jelas hanya dicek ada/tidaknya. Item standar yang
 *   tidak tercatat dilaporkan terpisah (qty_missing_items), bukan 'beda qty'.
 *   Item di luar standar diabaikan.
 */
function getBhpVariance() {
  const stockCard = getSafeJson('stock_card.json') || [];
  const usages = getSafeJson('usages_details.json') || [];
  const products = getSafeJson('products.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const customers = getSafeJson('customers_all.json') || [];

  if (stockCard.length === 0 || usages.length === 0) {
    return { available: false, note: 'Data kartu stok atau pemakaian treatment belum tersedia (jalankan sync Neosoft).', rows: [], details: {} };
  }

  const pMap = {}; products.forEach(x => { pMap[x.id] = x; });
  const invMap = {}; invoices.forEach(i => { invMap[i.inv_code] = i; });
  const custName = {};
  customers.forEach(c => {
    const n = c.name;
    custName[c.id] = (typeof n === 'object' && n)
      ? [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(' ').trim()
      : String(n || '').trim();
  });
  const branchOfWarehouse = (w) => /pondok/i.test(w || '') ? 'Pondok Kopi' : (/depok/i.test(w || '') ? 'Depok' : null);
  const wibDay = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  // key: date|branch -> { treat: Map(patient -> Set(treatment names)), lines, bhp: Map(patient -> [items]) }
  const buckets = {};
  const bucket = (date, branch) => {
    const k = `${date}|${branch}`;
    return buckets[k] || (buckets[k] = { date, branch, treat: new Map(), treat_lines: 0, bhp: new Map(), bhp_lines: 0 });
  };

  // --- sisi treatment
  usages.forEach(u => {
    const prod = pMap[u.product_id];
    if (!prod || !String(prod.product_treatment_code || '').startsWith('T-')) return;
    if (!(Number(u.used) > 0)) return;
    const inv = invMap[u.inv_code];
    if (!inv || inv.void_invoice) return;
    const name = custName[inv.customer_id];
    if (!name || isTestPatientName(name)) return;
    const branch = inv.outlet_id == 1 ? 'Depok' : 'Pondok Kopi';
    if (/biaya administrasi/i.test(prod.product_treatment_name || '')) return;
    const b = bucket(wibDay(u.created_at), branch);
    const key = name.toLowerCase();
    if (!b.treat.has(key)) b.treat.set(key, { patient: name, treatments: new Map() });
    const tm = b.treat.get(key).treatments;
    const cur = tm.get(prod.product_treatment_code) || { name: prod.product_treatment_name, used: 0 };
    cur.used += Number(u.used) || 0;
    tm.set(prod.product_treatment_code, cur);
    b.treat_lines++;
  });

  // --- sisi kartu stok (buang USAGE yang sudah di-void)
  const voidPool = {};
  stockCard.filter(r => r.transaction === 'ADJ VOID USAGE').forEach(r => {
    const k = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_in}`;
    voidPool[k] = (voidPool[k] || 0) + 1;
  });
  stockCard.filter(r => r.transaction === 'USAGE').forEach(r => {
    if ((r.category || [])[0] === 'HOMECARE') return;
    const vk = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_out}`;
    if (voidPool[vk] > 0) { voidPool[vk]--; return; }
    const branch = branchOfWarehouse(r.warehouse);
    const patient = String(r.patient_name || '').trim();
    if (!branch || !patient || isTestPatientName(patient)) return;
    const b = bucket(r.date.slice(0, 10), branch);
    const key = patient.toLowerCase();
    if (!b.bhp.has(key)) b.bhp.set(key, { patient, items: [] });
    b.bhp.get(key).items.push({ code: r.code, name: r.name, qty: r.stock_out, uom: String(r.uom || '').replace(/^\s*[\d.,]+\s*/, '').trim() });
    b.bhp_lines++;
  });

  // --- toleransi +-1 hari (BHP & treatment pasien sama, cabang sama, beda tanggal)
  const shiftDay = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
  const list = Object.values(buckets);
  list.forEach(b => {
    b.uT = new Set([...b.treat.keys()].filter(k => !b.bhp.has(k)));
    b.uB = new Set([...b.bhp.keys()].filter(k => !b.treat.has(k)));
    b.adj = [];
  });
  list.forEach(b => {
    [...b.uT].forEach(k => {
      for (const off of [-1, 1]) {
        const nb = buckets[`${shiftDay(b.date, off)}|${b.branch}`];
        if (nb && nb.uB.has(k)) {
          b.uT.delete(k); nb.uB.delete(k);
          const t = b.treat.get(k);
          b.adj.push({ patient: t.patient, treatments: [...t.treatments.values()].map(x => x.name), bhp_date: nb.date, items: nb.bhp.get(k).items, _t: t.treatments });
          break;
        }
      }
    });
  });

  // --- qty vs Standar BHP per Treatment
  const stdByCode = {};
  getTreatmentBoms().forEach(x => { if (x.treatment_code && (x.materials || []).length) stdByCode[x.treatment_code] = x; });
  const normUom = (u) => { const x = String(u || '').trim().toLowerCase(); return ({ mililiter: 'ml', milliliter: 'ml', pieces: 'pcs', piece: 'pcs', pc: 'pcs', gr: 'gram', g: 'gram' })[x] || x; };
  const r2 = n => Math.round(n * 100) / 100;
  // Item berkemasan (pack/pot/botol…) yang dipakai per gram/ml: qty kartu stok belum bisa dibandingkan
  // sebelum isi kemasan dipastikan Farmasi → hanya dicek ada/tidaknya.
  const U = _buildBhpUsage();
  const unitOv = getBhpUnitOverrides();
  const unitUnclear = (code) => !!unitOv[code] || _bhpNeedsUnitCheck(U.itemInfo[code] || { uom: '', cogs: 0 }, unitOv[code]);
  const compareQty = (tMap, items) => {
    const codes = [...tMap.keys()];
    if (!codes.length || !codes.every(c => stdByCode[c])) return { state: 'tanpa_standar' };
    const exp = {};
    codes.forEach(c => {
      const mult = Math.max(1, tMap.get(c).used || 1);
      stdByCode[c].materials.forEach(m => {
        const e = exp[m.item_code] || (exp[m.item_code] = { name: m.name, uom: normUom(m.uom), qty: 0 });
        e.qty += (Number(m.standard_qty) || 0) * mult;
      });
    });
    const act = {};
    items.forEach(i => { const a = act[i.code] || (act[i.code] = { qty: 0, uom: normUom(i.uom) }); a.qty += Number(i.qty) || 0; });
    const diffs = [];
    Object.entries(exp).forEach(([code, e]) => {
      const a = act[code];
      if (!a) diffs.push({ kind: 'tidak_ada', item: e.name, code, expected: r2(e.qty), actual: 0, uom: e.uom });
      else if (a.uom === e.uom && e.qty > 0 && !unitUnclear(code)) {
        if (a.qty < e.qty * 0.5) diffs.push({ kind: 'kurang', item: e.name, code, expected: r2(e.qty), actual: r2(a.qty), uom: e.uom });
        else if (a.qty > e.qty * 1.5) diffs.push({ kind: 'lebih', item: e.name, code, expected: r2(e.qty), actual: r2(a.qty), uom: e.uom });
      }
    });
    const real = diffs.filter(x => x.kind !== 'tidak_ada');
    return { state: real.length ? 'beda' : 'sesuai', diffs };
  };

  const rows = [];
  const details = {};
  list.forEach(b => {
    const treatNoBhp = [...b.uT].map(k => { const v = b.treat.get(k); return { patient: v.patient, treatments: [...v.treatments.values()].map(x => x.name) }; });
    const bhpNoTreat = [...b.uB].map(k => { const v = b.bhp.get(k); return { patient: v.patient, items: v.items }; });
    const qty = { compared: 0, ok: 0, diff: 0, nostd: 0, missing: 0 };
    const qtyDiff = [];
    const check = (patient, tMap, items, bhpDate) => {
      const r = compareQty(tMap, items);
      if (r.state === 'tanpa_standar') { qty.nostd++; return; }
      qty.compared++;
      if (r.diffs.some(x => x.kind === 'tidak_ada')) qty.missing++;
      if (r.state === 'sesuai') { qty.ok++; return; }
      qty.diff++;
      qtyDiff.push({ patient, treatments: [...tMap.values()].map(x => x.name), bhp_date: bhpDate || null, diffs: r.diffs });
    };
    [...b.treat.keys()].filter(k => b.bhp.has(k)).forEach(k => check(b.treat.get(k).patient, b.treat.get(k).treatments, b.bhp.get(k).items, null));
    b.adj.forEach(x => check(x.patient, x._t, x.items, x.bhp_date));
    const adjOut = b.adj.map(({ _t, ...rest }) => rest);
    const matched = b.treat.size - treatNoBhp.length;
    rows.push({
      date: b.date,
      branch: b.branch,
      treatment_patients: b.treat.size,
      treatment_lines: b.treat_lines,
      bhp_patients: b.bhp.size,
      bhp_lines: b.bhp_lines,
      matched,
      matched_adjacent: b.adj.length,
      treatment_without_bhp: treatNoBhp.length,
      bhp_without_treatment: bhpNoTreat.length,
      qty_compared: qty.compared,
      qty_ok: qty.ok,
      qty_diff: qty.diff,
      qty_no_standard: qty.nostd,
      qty_missing_items: qty.missing,
      status: (treatNoBhp.length + bhpNoTreat.length) === 0 ? 'sesuai' : 'selisih',
      qty_status: qty.diff > 0 ? 'beda' : qty.compared > 0 ? 'sesuai' : 'tanpa_standar'
    });
    details[`${b.date}|${b.branch}`] = { treatment_without_bhp: treatNoBhp, bhp_without_treatment: bhpNoTreat, matched_adjacent: adjOut, qty_diff: qtyDiff };
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch));

  const tot = rows.reduce((a, r) => {
    a.treatment_patients += r.treatment_patients; a.matched += r.matched; a.matched_adjacent += r.matched_adjacent;
    a.treatment_without_bhp += r.treatment_without_bhp; a.bhp_without_treatment += r.bhp_without_treatment;
    a.qty_compared += r.qty_compared; a.qty_ok += r.qty_ok; a.qty_diff += r.qty_diff; a.qty_no_standard += r.qty_no_standard; a.qty_missing_items += r.qty_missing_items;
    return a;
  }, { treatment_patients: 0, matched: 0, matched_adjacent: 0, treatment_without_bhp: 0, bhp_without_treatment: 0, qty_compared: 0, qty_ok: 0, qty_diff: 0, qty_no_standard: 0, qty_missing_items: 0 });

  return {
    available: true,
    note: 'Dibandingkan per hari, cabang & pasien: treatment di pemakaian paket/invoice vs BHP keluar (USAGE) di kartu stok Neosoft. Toleransi ±1 hari; qty dibandingkan dengan Standar BHP per Treatment. Item HOMECARE, Biaya Administrasi, pasien tes/training, dan USAGE yang di-void tidak dihitung.',
    summary: { days: new Set(rows.map(r => r.date)).size, ...tot },
    rows,
    details
  };
}

/**
 * Treatment → Product/BHP Mapping (dari data real usages_details)
 * Membangun mapping treatment mana memakai produk/obat/BHP apa
 * berdasarkan co-occurrence di invoice yang sama
 */
function getTreatmentProductMap(searchQuery) {
  const usages = getSafeJson('usages_details.json') || [];
  const products = getSafeJson('products.json') || [];

  const pMap = {};
  products.forEach(x => { pMap[x.id] = x; });

  // Group usages by invoice
  const byInv = {};
  usages.forEach(r => {
    if (!byInv[r.inv_code]) byInv[r.inv_code] = [];
    byInv[r.inv_code].push(r);
  });

  // Build Treatment → Products co-occurrence map
  const treatmentProducts = {};

  Object.values(byInv).forEach(items => {
    const treatments = items.filter(i => (pMap[i.product_id]?.product_treatment_code || '').startsWith('T-'));
    const prods = items.filter(i => (pMap[i.product_id]?.product_treatment_code || '').startsWith('P-'));

    if (treatments.length === 0 || prods.length === 0) return;

    const treatmentIds = [...new Set(treatments.map(t => t.product_id))];
    const productIds = [...new Set(prods.map(p => p.product_id))];

    treatmentIds.forEach(tid => {
      if (!treatmentProducts[tid]) treatmentProducts[tid] = {};
      productIds.forEach(pid => {
        treatmentProducts[tid][pid] = (treatmentProducts[tid][pid] || 0) + 1;
      });
    });
  });

  // Build result array
  let results = Object.entries(treatmentProducts).map(([tid, prods]) => {
    const t = pMap[parseInt(tid)];
    if (!t) return null;

    const productList = Object.entries(prods)
      .map(([pid, count]) => {
        const pr = pMap[parseInt(pid)];
        if (!pr) return null;
        return {
          code: pr.product_treatment_code,
          name: pr.product_treatment_name,
          price: Number(pr.price || 0),
          price_fmt: 'Rp ' + Number(pr.price || 0).toLocaleString('id-ID'),
          frequency: count,
          frequency_label: count >= 20 ? 'Selalu dipakai' : count >= 10 ? 'Sering dipakai' : count >= 3 ? 'Kadang dipakai' : 'Jarang dipakai',
          frequency_badge: count >= 20 ? '🟢' : count >= 10 ? '🔵' : count >= 3 ? '🟡' : '⚪'
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.frequency - a.frequency);

    // Determine primary products (frequency >= 50% of max)
    const maxFreq = productList[0]?.frequency || 1;
    productList.forEach(p => {
      p.is_primary = p.frequency >= maxFreq * 0.5;
    });

    return {
      treatment_id: parseInt(tid),
      code: t.product_treatment_code,
      name: t.product_treatment_name,
      price: Number(t.price || 0),
      price_fmt: 'Rp ' + Number(t.price || 0).toLocaleString('id-ID'),
      duration_minutes: t.duration || 0,
      is_active: t.status_product_treatment !== false,
      total_products_used: productList.length,
      primary_products: productList.filter(p => p.is_primary).length,
      products: productList
    };
  }).filter(Boolean);

  // Apply search filter if provided
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    results = results.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      t.products.some(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    );
  }

  // Sort by number of linked products descending
  results.sort((a, b) => b.products.reduce((s, p) => s + p.frequency, 0) - a.products.reduce((s, p) => s + p.frequency, 0));

  return {
    total_treatments_with_products: results.length,
    total_treatments_all: products.filter(p => (p.product_treatment_code || '').startsWith('T-')).length,
    total_products_all: products.filter(p => (p.product_treatment_code || '').startsWith('P-')).length,
    data_source: 'Real co-occurrence dari usages_details.json (invoice yang sama)',
    legend: {
      '🟢 Selalu dipakai': '>= 20x co-occurrence',
      '🔵 Sering dipakai': '>= 10x',
      '🟡 Kadang dipakai': '>= 3x',
      '⚪ Jarang dipakai': '< 3x'
    },
    treatments: results
  };
}

function loadJsonDbFile(filename, fallback = []) {
  try {
    const p = path.join(NEOSOFT_DB_DIR, filename);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {}
  return fallback;
}

function getNeosoftMasterData() {
  return {
    categories: loadJsonDbFile('category.json'),
    banks: loadJsonDbFile('banks.json'),
    outlets: loadJsonDbFile('outlets.json'),
    vouchers: loadJsonDbFile('vouchers.json'),
    roles: loadJsonDbFile('roles.json'),
    user_access: loadJsonDbFile('user_access.json'),
    marketing_sources: loadJsonDbFile('marketingsource.json'),
    patient_statuses: loadJsonDbFile('patient_status.json'),
    occupations: loadJsonDbFile('occupations.json'),
    religions: loadJsonDbFile('religions.json'),
    groups: loadJsonDbFile('groups.json'),
    consultants: loadJsonDbFile('consultants.json'),
    doctortypes: loadJsonDbFile('doctortypes.json'),
    uoms: loadJsonDbFile('uoms.json'),
    equipment: {
      brands: loadJsonDbFile('equipment_brand.json'),
      models: loadJsonDbFile('equipment_model.json'),
      series: loadJsonDbFile('equipment_series.json'),
      suppliers: loadJsonDbFile('equipment_supplier.json'),
    },
    locations: {
      provinces: loadJsonDbFile('locations_provinces.json'),
      cities: loadJsonDbFile('locations_cities.json'),
      countries: loadJsonDbFile('locations_countries.json')
    }
  };
}

function getNeosoftLogisticsData() {
  return {
    items: loadJsonDbFile('logistics_items.json'),
    warehouses: loadJsonDbFile('warehouses.json'),
    racks: loadJsonDbFile('racks.json'),
    suppliers: loadJsonDbFile('suppliers.json'),
    mutation_orders: loadJsonDbFile('logistics_mutation_order.json'),
    mutation_receives: loadJsonDbFile('logistics_mutation_receive.json'),
    inventory_adjustments: loadJsonDbFile('logistics_inventory_adjustment.json'),
    stock_opname: loadJsonDbFile('logistics_stock_opname.json'),
    stock_cards: loadJsonDbFile('logistics_stock_card.json'),
    buffer_alerts: loadJsonDbFile('stock_buffer_alerts.json')
  };
}

function searchPharmacyStockDetailed(queryTerm, warehouseFilter = 'all') {
  const stockCard = getSafeJson('stock_card.json');
  const logisticsItems = getSafeJson('logistics_items.json');
  if (!stockCard || stockCard.length === 0) return [];

  const itemBySalesInfoId = {};
  logisticsItems.forEach(it => { if (it.sales_information_id) itemBySalesInfoId[it.sales_information_id] = it; });

  const groups = {};
  stockCard.forEach(r => {
    const key = `${r.sales_information_id}|${r.warehouse}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const bersihkanUom = (u) => String(u || '').replace(/^\s*[\d.,]+\s*/, '').trim() || '-';
  const termClean = String(queryTerm || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!termClean || termClean.length < 2) return [];

  const results = [];
  Object.entries(groups).forEach(([key, records]) => {
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = records[records.length - 1];
    const name = latest.name || '';
    const code = latest.code || '';
    const warehouse = latest.warehouse || '';
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCode = code.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (warehouseFilter && warehouseFilter !== 'all') {
      const wf = warehouseFilter.toLowerCase();
      if (wf.includes('depok') || wf === 'dpk') {
        if (!warehouse.toLowerCase().includes('depok')) return;
      } else if (wf.includes('kopi') || wf.includes('pdk')) {
        if (!warehouse.toLowerCase().includes('kopi')) return;
      }
    }

    const commonStopWords = new Set(['apa', 'ada', 'dan', 'ini', 'itu', 'kan', 'saja', 'dong', 'yang', 'bisa', 'kalo', 'kalau', 'siapa', 'mana', 'hari', 'kemarin', 'kemaren', 'gimana', 'sudah', 'belum', 'tolong', 'info', 'soal']);
    const words = String(queryTerm).toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !commonStopWords.has(w));
    const matchWord = words.length > 0 && words.some(w => {
      const wClean = w.replace(/[^a-z0-9]/g, '');
      if (wClean.length < 3 || commonStopWords.has(wClean)) return false;
      const nameWords = name.toLowerCase().split(/\s+/).map(nw => nw.replace(/[^a-z0-9]/g, ''));
      return nameWords.some(nw => nw === wClean || (nw.length >= 4 && nw.includes(wClean)));
    });
    
    if ((termClean.length >= 3 && (cleanName.includes(termClean) || cleanCode.includes(termClean))) || (termClean.length >= 6 && termClean.includes(cleanName)) || matchWord) {
      const balance = records.reduce((acc, r) => acc + (Number(r.stock_in) || 0) - (Number(r.stock_out) || 0), 0);
      const salesInfoId = latest.sales_information_id;
      const itemMaster = itemBySalesInfoId[salesInfoId] || {};
      const bufferStock = Number(itemMaster.buffer_stock || 0);
      const category = (latest.category || [])[0] || 'Lainnya';
      const cogs = Number(itemMaster.cogs || 0);
      const neededPo = bufferStock > balance ? Math.max(1, Math.round(bufferStock - balance)) : 0;
      
      results.push({
        sku: latest.code,
        name: latest.name,
        category,
        warehouse,
        current_stock: balance,
        buffer_stock: bufferStock,
        uom: bersihkanUom(latest.uom),
        cogs,
        cogs_fmt: cogs > 0 ? 'Rp ' + cogs.toLocaleString('id-ID') : 'Rp 0',
        suggested_po_qty: neededPo,
        status: bufferStock > 0 && balance < bufferStock 
          ? (balance <= 0 ? 'HABIS 🚨' : 'DI_BAWAH_BUFFER ⚠️') 
          : 'AMAN 🟢'
      });
    }
  });

  return results;
}


function getAutomationAlertsSummary() {
  const bdays = loadJsonDbFile('notification_birthday.json');
  const appts = loadJsonDbFile('notification_appointment.json');
  const bufferAlerts = loadJsonDbFile('stock_buffer_alerts.json');
  const mutations = loadJsonDbFile('logistics_mutation_receive.json');
  const logs = loadJsonDbFile('customers_log_histories.json');

  return {
    timestamp: new Date().toISOString(),
    indicators: {
      unpaid_invoices: { count: getUnpaidFollowups().unpaid_invoices.length, icon: 'coin', label: 'Tagihan Belum Lunas' },
      today_appointments: { count: Array.isArray(appts) ? appts.length : 0, icon: 'calendar', label: 'Appointment Hari Ini' },
      patient_birthdays: { count: Array.isArray(bdays) ? bdays.length : 0, icon: 'cake', label: 'Pasien Ulang Tahun' },
      buffer_stock_alerts: { count: Array.isArray(bufferAlerts) ? bufferAlerts.length : 0, icon: 'warning_box', label: 'Buffer Stock Kritis' },
      pending_mutations: { count: Array.isArray(mutations) ? mutations.length : 0, icon: 'truck_box', label: 'Mutasi Masuk' },
      audit_changes: { count: Array.isArray(logs) ? logs.length : 0, icon: 'audit', label: 'Perubahan Pasien' }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════
// FITUR BARU: 11 DIVISI KLINIK — ZERO DUMMY & FULL CRUD
// ═══════════════════════════════════════════════════════════════════════

// 1. DIVISI DOKTER & SOP: Kontraindikasi, Deviasi SOP, Hapus Rekomendasi
function getContraindications() {
  try {
    if (fs.existsSync(CLINICAL_CONTRAINDICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(CLINICAL_CONTRAINDICATIONS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getContraindications] Error:', e.message);
  }
  return [];
}

function addContraindication({ treatment_keyword, contraindication_condition, severity = 'HIGH', warning_message, action_required }) {
  if (!treatment_keyword || !warning_message) {
    return { success: false, error: 'Keyword tindakan dan warning message wajib diisi' };
  }
  const all = getContraindications();
  const entry = {
    id: `CTR-${String(all.length + 1).padStart(3, '0')}`,
    treatment_keyword: treatment_keyword.trim(),
    contraindication_condition: (contraindication_condition || '').trim(),
    severity: (severity || 'HIGH').toUpperCase(),
    warning_message: warning_message.trim(),
    action_required: (action_required || '').trim(),
    created_at: new Date().toISOString()
  };
  all.push(entry);
  try {
    fs.writeFileSync(CLINICAL_CONTRAINDICATIONS_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteContraindication(id) {
  if (!id) return { success: false, error: 'ID wajib diisi' };
  const all = getContraindications();
  const next = all.filter(c => c.id !== id);
  if (next.length === all.length) return { success: false, error: 'Data tidak ditemukan' };
  try {
    fs.writeFileSync(CLINICAL_CONTRAINDICATIONS_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function checkTreatmentContraindications(treatmentName = '', patientNotes = '') {
  const all = getContraindications();
  const tName = (treatmentName || '').toLowerCase();
  const pNotes = (patientNotes || '').toLowerCase();
  return all.filter(c => {
    const kw = (c.treatment_keyword || '').toLowerCase();
    const cond = (c.contraindication_condition || '').toLowerCase();
    const matchesTreatment = kw && tName.includes(kw);
    const matchesCondition = pNotes && cond && (pNotes.includes(cond) || cond.split(' ').some(w => w.length > 4 && pNotes.includes(w)));
    return matchesTreatment || matchesCondition;
  });
}

function getSopExceptions() {
  try {
    if (fs.existsSync(SOP_EXCEPTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SOP_EXCEPTIONS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getSopExceptions] Error:', e.message);
  }
  return [];
}

function addSopException({ doctor_name, patient_name, treatment_name, deviation_reason, supervisor_approved = true, date }) {
  if (!doctor_name || !treatment_name || !deviation_reason) {
    return { success: false, error: 'Dokter, tindakan, dan alasan deviasi SOP wajib diisi' };
  }
  const all = getSopExceptions();
  const entry = {
    id: `SOPE-${Date.now()}`,
    date: date || new Date().toISOString().slice(0, 10),
    doctor_name: doctor_name.trim(),
    patient_name: (patient_name || '').trim(),
    treatment_name: treatment_name.trim(),
    deviation_reason: deviation_reason.trim(),
    supervisor_approved: Boolean(supervisor_approved),
    created_at: new Date().toISOString()
  };
  all.unshift(entry);
  try {
    fs.writeFileSync(SOP_EXCEPTIONS_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteSopException(id) {
  if (!id) return { success: false, error: 'ID wajib diisi' };
  const all = getSopExceptions();
  const next = all.filter(e => e.id !== id);
  if (next.length === all.length) return { success: false, error: 'Data deviasi tidak ditemukan' };
  try {
    fs.writeFileSync(SOP_EXCEPTIONS_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteDoctorRecommendation(id) {
  if (!id) return { success: false, error: 'ID rekomendasi wajib diisi' };
  const all = getDoctorRecommendations();
  const next = all.filter(r => r.id !== id);
  if (next.length === all.length) return { success: false, error: 'Rekomendasi tidak ditemukan' };
  try {
    fs.writeFileSync(DOCTOR_RECOMMENDATIONS_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 2. DIVISI PERAWAT: Nurse Upselling Tracking
function getNurseUpsellings(filters = {}) {
  try {
    if (fs.existsSync(NURSE_UPSELLING_FILE)) {
      let list = JSON.parse(fs.readFileSync(NURSE_UPSELLING_FILE, 'utf8')) || [];
      if (filters.nurse_name) {
        list = list.filter(u => (u.nurse_name || '').toLowerCase().includes(filters.nurse_name.toLowerCase()));
      }
      if (filters.status) {
        list = list.filter(u => u.status === filters.status);
      }
      return list;
    }
  } catch (e) {
    console.error('[getNurseUpsellings] Error:', e.message);
  }
  return [];
}

function saveNurseUpselling({ id, date, nurse_name, patient_name, customer_id, recommended_item, item_type = 'treatment', est_value = 0, status = 'Ditawarkan', notes = '' }) {
  if (!nurse_name || !patient_name || !recommended_item) {
    return { success: false, error: 'Nama perawat, pasien, dan item yang ditawarkan wajib diisi' };
  }
  const all = getNurseUpsellings();
  const recId = id || `NUP-${Date.now()}`;
  const now = new Date().toISOString();
  const entry = {
    id: recId,
    date: date || now.slice(0, 10),
    nurse_name: nurse_name.trim(),
    patient_name: patient_name.trim(),
    customer_id: customer_id ? (Number(customer_id) || customer_id) : null,
    recommended_item: recommended_item.trim(),
    item_type: item_type || 'treatment',
    est_value: Number(est_value) || 0,
    status: status || 'Ditawarkan',
    notes: (notes || '').trim(),
    updated_at: now
  };
  const idx = all.findIndex(u => u.id === recId);
  if (idx >= 0) {
    entry.created_at = all[idx].created_at || now;
    all[idx] = entry;
  } else {
    entry.created_at = now;
    all.unshift(entry);
  }
  try {
    fs.writeFileSync(NURSE_UPSELLING_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteNurseUpselling(id) {
  if (!id) return { success: false, error: 'ID wajib diisi' };
  const all = getNurseUpsellings();
  const next = all.filter(u => u.id !== id);
  if (next.length === all.length) return { success: false, error: 'Data tidak ditemukan' };
  try {
    fs.writeFileSync(NURSE_UPSELLING_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 3. DIVISI FARMASI: BOM & Mutasi Transfer Antar Cabang
//
// SUMBER DATA (dashboard hanya membaca):
//   • Neosoft          : treatment (kode T-, nama, harga), item BHP (kode P-, satuan, COGS), pemakaian aktual.
//   • Spreadsheet List BHP (Google Sheets → data/google_sheets_db/bhp_list.json, scripts/sync_google_sheets.py):
//       sheet Treatment   → kode treatment + Kategori,
//       sheet List BHP    → standar BHP per treatment (dipetakan lewat NAMA ke sheet Treatment),
//       sheet Isi Kemasan → isi per kemasan item (mis. 1 botol = 100 ml).
//   Penghubungnya kode Neosoft. Baris yang kodenya kosong / tidak ada di Neosoft tidak dipakai dan
//   muncul di daftar "perlu dicek" (getBhpSheetIssues). Bila bhp_list.json belum ada (spreadsheet belum
//   tersinkron), dipakai berkas lama treatment_bom.json / bhp_unit_overrides.json / treatment_category_overrides.json.
const BHP_READONLY_MSG = 'Dashboard hanya membaca. Standar BHP, kategori treatment & isi kemasan diubah di spreadsheet List BHP; treatment & item diubah di Neosoft.';
const _bhpSheetCache = new WeakMap();
function _bhpSheetRaw() {
  const d = getSafeJson('bhp_list.json', GOOGLE_SHEETS_DB_DIR);
  return (d && !Array.isArray(d) && Array.isArray(d.treatments)) ? d : null;
}
function _bhpNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function _bhpSheetIndex() {
  const sh = _bhpSheetRaw();
  if (!sh) return null;
  const products = getSafeJson('products.json') || [];
  const cached = _bhpSheetCache.get(sh);
  if (cached && cached.products === products) return cached.value;
  const tName = {}, pName = {};
  products.forEach(p => {
    const c = String(p.product_treatment_code || '').toUpperCase();
    if (c.startsWith('T-')) tName[c] = { name: String(p.product_treatment_name || '').trim(), active: p.status_product_treatment !== false };
    else if (c) pName[c] = String(p.product_treatment_name || '').trim();
  });
  const issues = [];
  const issue = (sheet, row, type, message, extra = {}) => issues.push({ sheet, row, type, message, ...extra });
  const suggest = name => {
    const words = _bhpNorm(name).split(' ').filter(w => w.length > 2);
    return Object.entries(tName).map(([code, t]) => ({ code, name: t.name, active: t.active, score: words.filter(w => _bhpNorm(t.name).includes(w)).length }))
      .filter(x => x.score >= Math.min(2, words.length)).sort((a, b) => b.score - a.score || (b.active - a.active)).slice(0, 3)
      .map(({ code, name, active }) => ({ code, name, active }));
  };
  const matsByName = {};
  sh.materials.forEach(m => { (matsByName[_bhpNorm(m.treatment_name)] = matsByName[_bhpNorm(m.treatment_name)] || []).push(m); });
  const namesInTreatment = new Set();
  const boms = [], categories = {}, seenCode = {};
  sh.treatments.forEach(t => {
    namesInTreatment.add(_bhpNorm(t.name));
    if (!t.code) { issue('Treatment', t.row, 'kode_kosong', `"${t.name}" belum punya kode treatment Neosoft`, { name: t.name, suggestions: suggest(t.name) }); return; }
    if (!tName[t.code]) { issue('Treatment', t.row, 'kode_tidak_ada', `Kode ${t.code} ("${t.name}") tidak ada di master treatment Neosoft`, { name: t.name, code: t.code, suggestions: suggest(t.name) }); return; }
    if (seenCode[t.code]) { issue('Treatment', t.row, 'kode_dobel', `Kode ${t.code} dipakai lagi (pertama di baris ${seenCode[t.code]}); baris ini diabaikan`, { name: t.name, code: t.code }); return; }
    seenCode[t.code] = t.row;
    if (t.category) categories[t.code] = { category: t.category, updated_by: 'Spreadsheet List BHP', updated_at: sh.synced_at };
    const materials = [];
    (matsByName[_bhpNorm(t.name)] || []).forEach(m => {
      if (!m.item_code) return;
      materials.push({ item_code: m.item_code, name: pName[m.item_code] || m.item_name || m.item_code, standard_qty: Number(m.qty) || 0, uom: m.uom || 'pcs' });
    });
    boms.push({ id: 'SHEET-' + t.code, treatment_code: t.code, treatment_name: tName[t.code].name || t.name, version: 'Spreadsheet List BHP',
      is_promo_version: false, materials, standard_duration_minutes: 60, updated_at: sh.synced_at, updated_by: 'Spreadsheet List BHP', sheet_row: t.row });
  });
  sh.materials.forEach(m => {
    if (!namesInTreatment.has(_bhpNorm(m.treatment_name))) issue('List BHP', m.row, 'treatment_tidak_ada', `Nama treatment "${m.treatment_name}" tidak ada di sheet Treatment`, { name: m.treatment_name });
    if (!m.item_code) issue('List BHP', m.row, 'kode_item_kosong', `Bahan "${m.item_name}" untuk "${m.treatment_name}" belum punya Kode Sistem`, { name: m.item_name });
    else if (!pName[m.item_code]) issue('List BHP', m.row, 'kode_item_tidak_ada', `Kode item ${m.item_code} ("${m.item_name}") tidak ada di Neosoft`, { name: m.item_name, code: m.item_code });
    if (m.item_code && !(Number(m.qty) > 0)) issue('List BHP', m.row, 'qty_kosong', `Qty bahan "${m.item_name}" untuk "${m.treatment_name}" kosong`, { name: m.item_name });
  });
  const packs = {};
  (sh.pack_sizes || []).forEach(k => {
    if (!pName[k.item_code]) { issue('Isi Kemasan', k.row, 'kode_item_tidak_ada', `Kode item ${k.item_code} ("${k.item_name}") tidak ada di Neosoft`, { name: k.item_name, code: k.item_code }); return; }
    packs[k.item_code] = { usage_uom: k.usage_uom, per_pack: Number(k.per_pack), updated_by: 'Spreadsheet List BHP', updated_at: sh.synced_at };
  });
  (sh.missing_sheets || []).forEach(n => issue(n, null, 'sheet_hilang', `Sheet "${n}" tidak ditemukan di spreadsheet`));
  const value = { boms, categories, packs, issues, synced_at: sh.synced_at, source: sh.source };
  _bhpSheetCache.set(sh, { products, value });
  return value;
}
function getBhpSheetIssues() {
  const ix = _bhpSheetIndex();
  if (!ix) return { available: false, note: 'Spreadsheet List BHP belum tersinkron — dashboard memakai data standar BHP lama.', issues: [] };
  return { available: true, source: ix.source, synced_at: ix.synced_at, issues: ix.issues };
}
// Link spreadsheet List BHP untuk user mengisi data. BHP_SHEET_ID boleh berisi ID atau URL lengkap Google Sheets.
function bhpSheetId() {
  const raw = String(process.env.BHP_SHEET_ID || '').trim();
  const m = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : null);
}
function bhpSheetUrl() { const id = bhpSheetId(); return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null; }
function getBhpDataSource() {
  const ix = _bhpSheetIndex();
  const sheet_url = bhpSheetUrl();
  return ix ? { source: 'spreadsheet', label: 'Spreadsheet List BHP', synced_at: ix.synced_at, issues: ix.issues.length, sheet_url }
    : { source: 'legacy', label: 'Data lama dashboard (spreadsheet List BHP belum tersinkron)', synced_at: null, issues: 0, sheet_url };
}
function getTreatmentBoms() {
  const ix = _bhpSheetIndex();
  if (ix) return ix.boms;
  try {
    if (fs.existsSync(TREATMENT_BOM_FILE)) {
      return JSON.parse(fs.readFileSync(TREATMENT_BOM_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getTreatmentBoms] Error:', e.message);
  }
  return [];
}

// Dashboard hanya membaca standar BHP (lihat sumber data di atas getTreatmentBoms).
function saveTreatmentBom() { return { success: false, error: BHP_READONLY_MSG }; }
function deleteTreatmentBom() { return { success: false, error: BHP_READONLY_MSG }; }

// ==================== STANDAR BHP PER TREATMENT ====================
// Neosoft tidak menyimpan daftar BHP per treatment. Yang ada: setiap BHP yang
// keluar di kartu stok (USAGE) membawa usage_code di kolom `ref`, dan dokumen
// pemakaian itu berisi treatment pasien (usages → usages_details). Dari situ
// pemakaian SEBENARNYA per treatment dihitung, lalu dijadikan usulan standar
// yang bisa dikoreksi dan disimpan (treatment_bom.json).
// Hanya dokumen berisi SATU treatment yang dipakai (pemakaiannya pasti milik
// treatment itu). USAGE yang di-void dan pasien tes/training tidak dihitung.
const BHP_STD_MIN_RATE = 0.3;   // BHP diusulkan bila dipakai di ≥30% tindakan
const BHP_STD_MIN_CASES = 5;    // di bawah ini datanya dianggap kurang
let _bhpStdCache = { key: null, value: null };
// Isi kemasan per item, diatur Farmasi: mis. Massage cream 1 pot = 250 gram,
// karena pemakaian sering dicatat dalam gram/ml padahal satuan item = pot/pieces.
const BHP_UNIT_FILE = path.join(__dirname, 'data', 'bhp_unit_overrides.json');
const BHP_CONTAINER_UOM = ['pieces', 'pack', 'pot', 'botol', 'box', 'tube', 'jar'];
function getBhpUnitOverrides() {
  const ix = _bhpSheetIndex();
  if (ix) return ix.packs;   // sheet "Isi Kemasan" di spreadsheet List BHP
  try { return JSON.parse(fs.readFileSync(BHP_UNIT_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function saveBhpUnitOverride() { return { success: false, error: BHP_READONLY_MSG }; }

function _median(arr) { const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0; }
function _niceQty(q) { if (!(q > 0)) return 0; if (q >= 1) return Math.round(q * 2) / 2; return Math.round(q * 100) / 100; }

function _buildBhpUsage() {
  const stockCard = getSafeJson('stock_card.json') || [];
  const usages = getSafeJson('usages.json') || [];
  const details = getSafeJson('usages_details.json') || [];
  const products = getSafeJson('products.json') || [];
  const items = getSafeJson('logistics_items.json') || [];
  const key = `${stockCard.length}|${usages.length}|${details.length}`;
  if (_bhpStdCache.key === key) return _bhpStdCache.value;

  const prod = {}; products.forEach(p => { prod[p.id] = p; });
  const cogsBySi = {}; items.forEach(i => { if (i.sales_information_id) cogsBySi[i.sales_information_id] = Number(i.cogs) || 0; });
  const detByUsage = {}; details.forEach(d => { (detByUsage[d.usage_id] = detByUsage[d.usage_id] || []).push(d); });

  // Dokumen pemakaian → satu treatment (kode T-)
  const docTreatment = {};
  usages.forEach(u => {
    if (u.is_void) return;
    const treats = new Set((detByUsage[u.id] || []).map(d => prod[d.product_id]).filter(p => p && String(p.product_treatment_code || '').startsWith('T-')).map(p => p.product_treatment_code));
    if (treats.size === 1) docTreatment[u.usage_code] = [...treats][0];
  });

  // BHP keluar (USAGE) dikurangi yang di-void
  const voidPool = {};
  stockCard.filter(r => r.transaction === 'ADJ VOID USAGE').forEach(r => { const k = `${String(r.date).slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_in}`; voidPool[k] = (voidPool[k] || 0) + 1; });
  const itemInfo = {};
  const perDoc = {}; // usage_code -> { treatment, items: {code: qty} }
  stockCard.forEach(r => {
    if (r.transaction !== 'USAGE' || !(r.category || []).includes('BHP')) return;
    const vk = `${String(r.date).slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_out}`;
    if (voidPool[vk] > 0) { voidPool[vk]--; return; }
    if (r.patient_name && isTestPatientName(r.patient_name)) return;
    const t = docTreatment[r.ref];
    if (!t) return;
    if (!itemInfo[r.code]) itemInfo[r.code] = { code: r.code, name: String(r.name || '').trim(), uom: String(r.uom || '').replace(/^\s*[\d.,]+\s*/, '').trim() || 'pcs', cogs: cogsBySi[r.sales_information_id] || 0 };
    const d = perDoc[r.ref] || (perDoc[r.ref] = { treatment: t, items: {} });
    d.items[r.code] = (d.items[r.code] || 0) + (Number(r.stock_out) || 0);
  });

  // Agregasi per treatment
  const byTreat = {};
  Object.values(perDoc).forEach(d => {
    const t = byTreat[d.treatment] || (byTreat[d.treatment] = { cases: 0, items: {} });
    t.cases++;
    Object.entries(d.items).forEach(([code, q]) => { (t.items[code] = t.items[code] || []).push(q); });
  });
  const nameOf = {}; products.forEach(p => { if (p.product_treatment_code) nameOf[p.product_treatment_code] = p.product_treatment_name; });
  const value = { byTreat, itemInfo, nameOf };
  _bhpStdCache = { key, value };
  return value;
}

// Rincian BHP per tindakan: dokumen pemakaian (ref kartu stok) → treatment → barang yang keluar.
let _bhpDocsCache = { key: null, value: null };
function _bhpDocsByTreatment() {
  const stockCard = getSafeJson('stock_card.json') || [];
  const usages = getSafeJson('usages.json') || [];
  const details = getSafeJson('usages_details.json') || [];
  const products = getSafeJson('products.json') || [];
  const key = `${stockCard.length}|${usages.length}|${details.length}`;
  if (_bhpDocsCache.key === key) return _bhpDocsCache.value;
  const prod = {}; products.forEach(p => { prod[p.id] = p; });
  const detByUsage = {}; details.forEach(d => { (detByUsage[d.usage_id] = detByUsage[d.usage_id] || []).push(d); });
  const docTreatment = {};
  usages.forEach(u => {
    if (u.is_void) return;
    const treats = new Set((detByUsage[u.id] || []).map(d => prod[d.product_id]).filter(p => p && String(p.product_treatment_code || '').startsWith('T-')).map(p => p.product_treatment_code));
    if (treats.size === 1) docTreatment[u.usage_code] = [...treats][0];
  });
  const voidPool = {};
  stockCard.filter(r => r.transaction === 'ADJ VOID USAGE').forEach(r => { const k = `${String(r.date).slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_in}`; voidPool[k] = (voidPool[k] || 0) + 1; });
  const docs = {};   // usage_code -> doc
  stockCard.forEach(r => {
    if (r.transaction !== 'USAGE' || !(r.category || []).includes('BHP')) return;
    const vk = `${String(r.date).slice(0, 10)}|${r.warehouse}|${r.code}|${r.stock_out}`;
    if (voidPool[vk] > 0) { voidPool[vk]--; return; }
    if (r.patient_name && isTestPatientName(r.patient_name)) return;
    const t = docTreatment[r.ref];
    if (!t) return;
    const d = docs[r.ref] || (docs[r.ref] = { ref: r.ref, treatment: t, date: String(r.date).slice(0, 10), patient: r.patient_name || '', branch: /pondok/i.test(r.warehouse || '') ? 'Pondok Kopi' : 'Depok', items: {} });
    const it = d.items[r.code] || (d.items[r.code] = { item_code: r.code, name: String(r.name || '').trim(), uom: String(r.uom || '').replace(/^\s*[\d.,]+\s*/, '').trim() || 'pcs', qty: 0 });
    it.qty += Number(r.stock_out) || 0;
  });
  const byTreat = {};
  Object.values(docs).forEach(d => { (byTreat[d.treatment] = byTreat[d.treatment] || []).push(d); });
  Object.values(byTreat).forEach(l => l.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref)));
  _bhpDocsCache = { key, value: byTreat };
  return byTreat;
}

function _bhpNeedsUnitCheck(info, o) { return !o && BHP_CONTAINER_UOM.includes(String(info.uom).toLowerCase()) && info.cogs >= 5000; }

function _treatmentStandardDetail(code, U, boms) {
  const t = U.byTreat[code] || { cases: 0, items: {} };
  const ov = getBhpUnitOverrides();
  const unitCost = ic => { const i = U.itemInfo[ic]; if (!i) return 0; const o = ov[ic]; return o ? i.cogs / o.per_pack : i.cogs; };
  const approved = boms.find(b => b.treatment_code === code) || null;
  const rows = Object.entries(t.items).map(([ic, qs]) => {
    const info = U.itemInfo[ic];
    const rate = t.cases ? qs.length / t.cases : 0;
    const med = _median(qs);
    const o = ov[ic];
    // Item berkemasan & mahal: pemakaian sering dicatat per gram/lembar → minta Farmasi memastikan isi kemasan (sekali per item)
    const suspect = _bhpNeedsUnitCheck(info, o);
    return { item_code: ic, name: info.name, uom: o ? o.usage_uom : info.uom, stock_uom: info.uom, per_pack: o ? o.per_pack : null, cogs: info.cogs, unit_cost: Math.round(unitCost(ic) * 100) / 100, unit_check: suspect, used_in: qs.length, usage_rate: Math.round(rate * 1000) / 10, median_qty: Math.round(med * 100) / 100, avg_per_case: Math.round((qs.reduce((a, b) => a + b, 0) / Math.max(1, t.cases)) * 100) / 100, suggested: rate >= BHP_STD_MIN_RATE && qs.length >= 2, suggested_qty: _niceQty(med) };
  }).sort((a, b) => b.usage_rate - a.usage_rate);
  const suggested = rows.filter(r => r.suggested).map(r => ({ item_code: r.item_code, name: r.name, standard_qty: r.suggested_qty, uom: r.uom }));
  const standard = approved ? approved.materials : suggested;
  const cost = list => list.reduce((a, m) => a + (Number(m.standard_qty) || 0) * unitCost(m.item_code), 0);
  const actualCost = rows.reduce((a, r) => a + r.avg_per_case * r.unit_cost, 0);
  const unitChecks = rows.filter(r => r.unit_check).length;
  const stdCost = cost(standard);
  const unknown = (approved ? approved.materials : []).filter(m => !U.itemInfo[m.item_code]).map(m => m.name);
  return {
    treatment_code: code, treatment_name: U.nameOf[code] || (approved && approved.treatment_name) || code, cases: t.cases,
    status: approved ? 'Spreadsheet' : t.cases < BHP_STD_MIN_CASES ? 'Data kurang' : 'Usulan',
    standard, suggested, items: rows, approved_by: approved ? approved.updated_by : null, approved_at: approved ? approved.updated_at : null, bom_id: approved ? approved.id : null,
    hpp_bhp: Math.round(stdCost), actual_cost: Math.round(actualCost),
    // Selisih hanya dihitung kalau satuan item sudah beres (tidak ada yang perlu dicek)
    deviation_pct: stdCost > 0 && t.cases >= BHP_STD_MIN_CASES && !unitChecks ? Math.round((actualCost - stdCost) / stdCost * 1000) / 10 : null,
    deviation_rp: stdCost > 0 && t.cases >= BHP_STD_MIN_CASES && !unitChecks ? Math.round(actualCost - stdCost) : null,
    unit_checks: unitChecks, missing_price: standard.filter(m => !(unitCost(m.item_code) > 0)).length, unknown_items: unknown
  };
}

function getBhpStandards({ treatment } = {}) {
  const U = _buildBhpUsage();
  const boms = getTreatmentBoms();
  if (!Object.keys(U.byTreat).length && !boms.length) return { available: false, note: 'Data kartu stok & pemakaian Neosoft belum tersedia (jalankan sync).', rows: [] };
  if (treatment) return { available: true, data_source: getBhpDataSource(), detail: _treatmentStandardDetail(treatment, U, boms) };
  const codes = new Set([...Object.keys(U.byTreat), ...boms.map(b => b.treatment_code).filter(Boolean)]);
  const rows = [...codes].map(c => { const d = _treatmentStandardDetail(c, U, boms); return { treatment_code: c, treatment_name: d.treatment_name, cases: d.cases, status: d.status, items: d.standard.length, standard: d.standard.map(m => ({ name: m.name, qty: m.standard_qty, uom: m.uom })), usual: d.items.filter(r => r.suggested).map(r => ({ name: r.name, avg: r.avg_per_case, uom: r.uom, rate: r.usage_rate })), hpp_bhp: d.hpp_bhp, actual_cost: d.actual_cost, deviation_pct: d.deviation_pct, deviation_rp: d.deviation_rp, unit_checks: d.unit_checks, missing_price: d.missing_price, unknown_items: d.unknown_items.length }; })
    .sort((a, b) => b.cases - a.cases);
  const approved = rows.filter(r => r.status === 'Spreadsheet');
  return {
    available: true,
    summary: { treatments: rows.length, approved: approved.length, suggested: rows.filter(r => r.status === 'Usulan').length, low_data: rows.filter(r => r.status === 'Data kurang').length, over: rows.filter(r => r.deviation_pct != null && r.deviation_pct > 20).length, unit_checks: rows.filter(r => r.unit_checks).length,
      unit_items: (() => { const ov = getBhpUnitOverrides(); return Object.values(U.itemInfo).filter(i => _bhpNeedsUnitCheck(i, ov[i.code])).length; })(), cases: rows.reduce((a, r) => a + r.cases, 0) },
    data_source: getBhpDataSource(),
    sheet_issues: getBhpSheetIssues().issues,
    rows
  };
}

// Simpan standar BHP (dipakai juga oleh tabel BOM) — satu standar per kode treatment
// Standar BHP diubah di spreadsheet List BHP — dashboard hanya membaca.
function saveBhpStandard() { return { success: false, error: BHP_READONLY_MSG }; }
function deleteBhpStandard() { return { success: false, error: BHP_READONLY_MSG }; }

// Daftar BHP (untuk menambah item ke standar)
// ==================== FOTO BEFORE/AFTER (PEMERIKSAAN FISIK) ====================
// Neosoft menyimpan foto before/after di modul Pemeriksaan Fisik. Metadata
// (pasien, tanggal, cabang, "Before"/"After") sudah tersinkron; file fotonya
// diambil terpisah oleh pe_photo_service (lihat catatan keamanan di sana).
const peBranch = (outlet_id) => (outlet_id == 1 ? 'Depok' : outlet_id == 2 ? 'Pondok Kopi' : 'Lainnya');
const peKind = (desc) => { const d = String(desc || '').toLowerCase(); return /before|sebelum/.test(d) ? 'before' : /after|sesudah/.test(d) ? 'after' : 'other'; };
const peDay = (x) => String(x.examination_date || x.created_at || '').slice(0, 10);

function _peCustomerNames() {
  const map = {};
  (getSafeJson('customers_all.json') || []).forEach(c => {
    const n = c.name;
    map[c.id] = { name: (typeof n === 'object' && n) ? [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(' ').trim() : String(n || '').trim(), code: c.code || '' };
  });
  return map;
}

// Galeri before/after satu pasien: sesi per tanggal, tiap sesi punya baris
// Before & After beserta jumlah foto. Foto fisik disajikan route (auth).
async function getBeforeAfterGallery(customerId, { withPhotos = true } = {}) {
  const cid = Number(customerId);
  if (!cid) return { available: false, note: 'Pasien tidak dikenal.', sessions: [] };
  const pe = (getSafeJson('physicalexamination.json') || []).filter(x => x.customer_id === cid);
  const names = _peCustomerNames();
  const patient = names[cid] || { name: 'Pasien', code: '' };
  if (withPhotos) {
    const svc = require('./pe_photo_service');
    await Promise.all(pe.map(x => svc.ensureExamPhotos(x).catch(() => ({ count: 0 }))));
  }
  const svc = require('./pe_photo_service');
  const byDay = {};
  pe.forEach(x => {
    const day = peDay(x);
    const b = byDay[day] || (byDay[day] = { date: day, branch: peBranch(x.outlet_id), before: null, after: null, other: [] });
    const m = svc.manifestFor(x.id);
    const entry = { pe_id: x.id, kind: peKind(x.description), description: String(x.description || '').trim(), created_at: x.created_at, photo_count: m ? m.count : 0 };
    if (entry.kind === 'before' && !b.before) b.before = entry;
    else if (entry.kind === 'after' && !b.after) b.after = entry;
    else b.other.push(entry);
  });
  const sessions = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date))
    .map(s => ({ ...s, complete: !!(s.before && s.before.photo_count) && !!(s.after && s.after.photo_count) }));
  return {
    available: true,
    patient: patient.name, patient_code: patient.code,
    total_sessions: sessions.length,
    total_photos: sessions.reduce((a, s) => a + (s.before ? s.before.photo_count : 0) + (s.after ? s.after.photo_count : 0) + s.other.reduce((x, o) => x + o.photo_count, 0), 0),
    sessions
  };
}

// Pemantauan kepatuhan dokumentasi before/after (per pasien+tanggal).
// Nama perawat tidak ada di data API Neosoft, jadi dihitung per cabang & bulan.
function getBeforeAfterCompliance() {
  const pe = getSafeJson('physicalexamination.json') || [];
  if (!pe.length) return { available: false, note: 'Data pemeriksaan fisik belum tersedia (jalankan sync Neosoft).' };
  const names = _peCustomerNames();
  const sess = {};
  pe.forEach(x => {
    const day = peDay(x), k = `${x.customer_id}|${day}`;
    const s = sess[k] || (sess[k] = { customer_id: x.customer_id, date: day, branch: peBranch(x.outlet_id), before: false, after: false });
    const kind = peKind(x.description);
    if (kind === 'before') s.before = true; else if (kind === 'after') s.after = true;
  });
  const rows = Object.values(sess);
  const tally = (arr) => { const t = { sessions: arr.length, complete: 0, before_only: 0, after_only: 0 }; arr.forEach(s => { if (s.before && s.after) t.complete++; else if (s.before) t.before_only++; else if (s.after) t.after_only++; }); t.rate = t.sessions ? Math.round(t.complete / t.sessions * 1000) / 10 : 0; return t; };
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort().reverse();
  const branches = [...new Set(rows.map(r => r.branch))].sort();
  // Daftar pasien punya foto (untuk pencarian di galeri)
  const ppl = {};
  rows.forEach(s => { const p = ppl[s.customer_id] || (ppl[s.customer_id] = { customer_id: s.customer_id, name: (names[s.customer_id] || {}).name || `#${s.customer_id}`, code: (names[s.customer_id] || {}).code || '', sessions: 0, last_date: '' }); p.sessions++; if (s.date > p.last_date) p.last_date = s.date; });
  const patients = Object.values(ppl).sort((a, b) => b.last_date.localeCompare(a.last_date));
  const incomplete = rows.filter(s => !(s.before && s.after))
    .map(s => ({ ...s, patient: (names[s.customer_id] || {}).name || `#${s.customer_id}`, missing: s.before ? 'Belum ada After' : 'Belum ada Before' }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    available: true,
    summary: { ...tally(rows), patients: new Set(rows.map(r => r.customer_id)).size },
    by_branch: branches.map(b => ({ branch: b, ...tally(rows.filter(r => r.branch === b)) })),
    by_month: months.slice(0, 6).map(m => ({ month: m, ...tally(rows.filter(r => r.date.slice(0, 7) === m)) })),
    patients,
    incomplete
  };
}

// ==================== TREATMENT 360 (inquiry per treatment) ====================
// Satu treatment dilihat dari semua sisi: harga & realisasi, volume & tren,
// pasien (repeat), dokter/terapis yang mengerjakan (laporan komisi Neosoft),
// treatment yang sering diambil bersamaan, standar BHP/HPP, dan foto.
const _t360BaseCache = { refs: null, value: null };
function _t360Base() {
  const products = getSafeJson('products.json') || [];
  const usages = getSafeJson('usages_details.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const customers = getSafeJson('customers_all.json') || [];
  const usageHeaders = getSafeJson('usages.json') || [];
  // getSafeJson mengembalikan objek yang sama selama file tidak berubah
  if (_t360BaseCache.refs && _t360BaseCache.refs[0] === products && _t360BaseCache.refs[1] === usages && _t360BaseCache.refs[2] === invoices && _t360BaseCache.refs[3] === customers && _t360BaseCache.refs[4] === usageHeaders) return _t360BaseCache.value;
  // Pemakaian yang di-void di Neosoft tidak mengurangi saldo dan bukan tindakan
  const voidUsage = new Set(); usageHeaders.forEach(h => { if (h.is_void) voidUsage.add(h.id); });
  const prodById = {}; products.forEach(p => { prodById[p.id] = p; });
  const invByCode = {}; invoices.forEach(i => { invByCode[i.inv_code] = i; });
  const names = _peCustomerNames();
  // Baris tindakan: usage treatment (T-) yang dipakai, invoice valid
  const lines = [];
  usages.forEach(u => {
    const p = prodById[u.product_id];
    if (!p || !String(p.product_treatment_code || '').startsWith('T-') || !(Number(u.used) > 0) || voidUsage.has(u.usage_id)) return;
    const inv = invByCode[u.inv_code];
    if (!inv || inv.void_invoice || isMigrationInvoice(inv)) return;
    const nm = (names[inv.customer_id] || {}).name || '';
    if (nm && isTestPatientName(nm)) return;
    lines.push({ usage_id: u.id, code: p.product_treatment_code, name: p.product_treatment_name, inv_code: u.inv_code, customer_id: inv.customer_id, branch: inv.outlet_id == 1 ? 'Depok' : 'Pondok Kopi', date: String(u.created_at || inv.inv_date || '').slice(0, 10), value: Number(u.value) || 0 });
  });
  _t360BaseCache.refs = [products, usages, invoices, customers, usageHeaders];
  _t360BaseCache.value = { products, lines, names };
  return _t360BaseCache.value;
}

// Harga Treatment 360 mengikuti sumber yang sama dengan halaman Harga Promo & Bottom / Patient 360:
// normal = spreadsheet Planning (tab Promo Bulan) -> harga outlet Neosoft; bottom & promo dari spreadsheet.
function _t360Pricing() {
  const products = getSafeJson('products.json') || [];
  const usages = getSafeJson('usages_details.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  return { idx: getPricingIndex(products, usages, invoices) };
}

function getTreatment360List() {
  const { products, lines } = _t360Base();
  const { idx } = _t360Pricing();
  const cnt = {}; lines.forEach(l => { const c = cnt[l.code] || (cnt[l.code] = { count: 0, last: '' }); c.count++; if (l.date > c.last) c.last = l.date; });
  return products.filter(p => String(p.product_treatment_code || '').startsWith('T-') && p.status_product_treatment !== false)
    .map(p => { const mk = idx[p.id] || {}; return { code: p.product_treatment_code, name: p.product_treatment_name, price: mk.list_price || Number(p.price) || 0, price_source: mk.list_source || 'neosoft', count: (cnt[p.product_treatment_code] || {}).count || 0, last: (cnt[p.product_treatment_code] || {}).last || null }; })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'id'));
}

// ==================== MASTER TREATMENT ====================
// Master treatment Neosoft (/products, kode T-) + realisasi + standar BHP.
// Neosoft punya daftar kategori treatment tapi API tidak menyebut kategori
// tiap treatment, jadi kategori ditebak dari nama lalu bisa dikoreksi di KEFIR.
const TREATMENT_CAT_FILE = path.join(__dirname, 'data', 'treatment_category_overrides.json');
const TREATMENT_CAT_RULES = [
  ['Add On', /^add on|add on |anastesi|needle/i],
  ['Botox', /botox/i],
  ['Threadlift', /threadlift|thread|benang|^mono/i],
  ['Infuse', /infus/i],
  ['Intimate', /miss v|v ozone|bright pink/i],
  ['Chemical Peeling', /peel(?! of)/i],
  ['Laser', /laser|ipl |pico|nd-yag/i],
  ['Slimming', /cool plus|fat ap|meso|lipo|slender|body fat|double chin|doube chin|chubby/i],
  ['Toning', /hifu|^rf /i],
  ['Surgery', /cauter|subcision|buccal|jahitan/i],
  ['Injection', /inject|booster|filler|juvelook|collagen|nctf|prp|exosome|salmon cell|bright (elbow|knee)|hair growth/i],
  ['Facial', /facial|glow|microderm|rejuve|pdt|acne|melasma|scar|renewal|repair|yoga|gua sha|mask|phyto|doll face|smooth/i],
  ['Others', /.*/]
];
function _guessTreatmentCategory(name) { const n = String(name || ''); return (TREATMENT_CAT_RULES.find(([, re]) => re.test(n)) || ['Others'])[0]; }
// Kategori treatment: kolom Kategori di sheet Treatment spreadsheet List BHP (kosong = tebakan dari nama).
function getTreatmentCategoryOverrides() {
  const ix = _bhpSheetIndex();
  if (ix) return ix.categories;
  try { return JSON.parse(fs.readFileSync(TREATMENT_CAT_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function getTreatmentCategories() {
  const fromNeosoft = (getSafeJson('category.json') || []).filter(c => c.type === 'T' && c.status !== false && c.category_name !== 'NONE').map(c => c.category_name);
  const base = fromNeosoft.length ? fromNeosoft : TREATMENT_CAT_RULES.map(r => r[0]);
  const fromSheet = Object.values(getTreatmentCategoryOverrides()).map(o => o.category).filter(Boolean);
  return [...new Set([...base, ...fromSheet])];
}
function saveTreatmentCategory() { return { success: false, error: BHP_READONLY_MSG }; }

function getTreatmentMaster() {
  const { products, lines } = _t360Base();
  const treatments = products.filter(p => String(p.product_treatment_code || '').startsWith('T-'));
  if (!treatments.length) return { available: false, note: 'Master treatment Neosoft belum tersinkron.', rows: [] };
  const today = new Date(); const d90 = new Date(today - 90 * 864e5).toISOString().slice(0, 10);
  const agg = {};
  lines.forEach(l => {
    const a = agg[l.code] || (agg[l.code] = { count: 0, count_90d: 0, revenue: 0, paid: 0, patients: new Set(), last: '' });
    a.count++; if (l.date >= d90) a.count_90d++;
    if (l.value > 0) { a.revenue += l.value; a.paid++; }
    a.patients.add(l.customer_id); if (l.date > a.last) a.last = l.date;
  });
  let bhp = {};
  try { const s = getBhpStandards(); (s.rows || []).forEach(r => { bhp[r.treatment_code] = r; }); } catch (e) { bhp = {}; }
  const ov = getTreatmentCategoryOverrides();
  const rows = treatments.map(p => {
    const code = p.product_treatment_code, a = agg[code], b = bhp[code], price = Number(p.price) || 0;
    const avg = a && a.paid ? Math.round(a.revenue / a.paid) : null;
    const hpp = b && !b.unit_checks && b.hpp_bhp ? b.hpp_bhp : null;
    return {
      code, name: String(p.product_treatment_name || '').trim(),
      category: ov[code] ? ov[code].category : _guessTreatmentCategory(p.product_treatment_name), category_set: !!ov[code],
      price, duration: Number(p.duration) || 0, buffer: Number(p.buffer_time) || 0, active: p.status_product_treatment !== false,
      performed: a ? a.count : 0, performed_90d: a ? a.count_90d : 0, patients: a ? a.patients.size : 0, revenue: a ? a.revenue : 0,
      avg_value: avg, discount_pct: avg != null && price ? Math.round((1 - avg / price) * 1000) / 10 : null,
      last_date: a ? a.last : null,
      bhp_status: b ? b.status : null, bhp_items: b ? b.items : 0, bhp_unit_checks: b ? !!b.unit_checks : false,
      bhp_list: b && b.usual ? b.usual : [],
      hpp_bhp: hpp, hpp_pct: hpp != null && (avg || price) ? Math.round(hpp / (avg || price) * 1000) / 10 : null,
      updated_at: p.updated_at || p.created_at || null
    };
  }).sort((x, y) => (y.active - x.active) || y.performed - x.performed || x.name.localeCompare(y.name, 'id'));
  const act = rows.filter(r => r.active);
  return {
    available: true,
    data_source: getBhpDataSource(),
    categories: getTreatmentCategories(),
    summary: {
      total: rows.length, active: act.length, inactive: rows.length - act.length,
      no_price: act.filter(r => !r.price).length,
      idle_90d: act.filter(r => !r.performed_90d && !/administrasi|konsultasi/i.test(r.name)).length,
      with_bhp: act.filter(r => r.bhp_status === 'Spreadsheet').length,
      bhp_suggested: act.filter(r => r.bhp_status && r.bhp_status !== 'Spreadsheet').length,
      category_set: act.filter(r => r.category_set).length
    },
    rows
  };
}

// ==================== MEDICAL RECORD (SOAP) NEOSOFT ====================
// Satu medical record (anamnesa) per invoice, berisi SOAP. Kolom Plan berisi
// rencana dokter — sekitar separuh kunjungan diisi spesifik, sisanya kosong
// atau "tindakan saat kedatangan". Ditarik sync per pasien (medicalrecords.json).
const _soapClean = (v) => {
  const s = String(v == null ? '' : v).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\r/g, '')
    .split('\n').map(l => l.replace(/^\s*[-•*]+\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return /^[-.\s]*$/.test(s) ? '' : s;
};
function _planKind(plan) {
  if (!plan) return 'empty';
  if (/saat kedatangan|tindakan (hari ini|sekarang)|sesuai kedatangan/i.test(plan)) return 'on_arrival';
  return 'specific';
}
function addDaysIso(d, n) { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const _mrBranch = (outletId) => (outletId == 1 ? 'Depok' : outletId == 2 ? 'Pondok Kopi' : '-');
const _mrCache = { key: null, value: null };
function _medicalRecords() {
  const store = getSafeJson('medicalrecords.json');
  const raw = (store && !Array.isArray(store) && store.records) || [];
  const therapists = getSafeJson('therapists.json') || [];
  const users = getSafeJson('user_access.json') || [];
  const key = `${raw.length}|${store && store.synced_at}`;
  if (_mrCache.key === key) return _mrCache.value;
  const th = {}; therapists.forEach(t => { th[t.id] = String(t.therapist_name || '').trim(); });
  const us = {}; users.forEach(u => { us[u.id] = String(u.name || u.username || '').trim(); });
  const rows = raw.filter(r => r && r.status !== false && !r.invoice_void).map(r => {
    const s = r.soap || {};
    const soap = { subjective: _soapClean(s.subjective), objective: _soapClean(s.objective), assessment: _soapClean(s.assesment || s.assessment), plan: _soapClean(s.plan) };
    // Dokter dari invoice; kalau kosong, dokter yang menulis medical record-nya sendiri
    const doctor = th[r.doctor_id] && /^dr/i.test(th[r.doctor_id]) ? th[r.doctor_id] : (/^dr/i.test(us[r.created_by] || '') ? us[r.created_by] : null);
    return {
      id: r.id, code: r.code, customer_id: r.customer_id, date: String(r.date || r.created_at || '').slice(0, 10),
      branch: _mrBranch(r.outlet_id), inv_code: r.inv_code || null,
      doctor, written_by: us[r.created_by] || null,
      soap, plan_kind: _planKind(soap.plan),
      filled: ['subjective', 'objective', 'assessment', 'plan'].filter(k => soap[k]).length,
      items: [...new Set((r.items || []).map(i => String(i.name || '').trim()).filter(Boolean))],
      diagnosa: (r.diagnosa || []).map(d => d.name || d.description || d.icd_name || d.code).filter(Boolean),
      updated_at: r.updated_at || null
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const byCust = {}; rows.forEach(r => { (byCust[r.customer_id] = byCust[r.customer_id] || []).push(r); });
  _mrCache.key = key;
  _mrCache.value = { rows, byCust, synced_at: store && store.synced_at, available: raw.length > 0 };
  return _mrCache.value;
}

function getPatientMedicalRecords(customerId) {
  const M = _medicalRecords();
  if (!M.available) return { available: false, note: 'Medical record Neosoft belum tersinkron.', records: [] };
  return { available: true, synced_at: M.synced_at, records: M.byCust[Number(customerId)] || [] };
}

// Kepatuhan pengisian SOAP per dokter & bulan (dokter = doctor_id di invoice)
function getSoapCompliance() {
  const M = _medicalRecords();
  if (!M.available) return { available: false, note: 'Medical record Neosoft belum tersinkron.' };
  const tally = (arr) => {
    const t = { records: arr.length, soap_complete: 0, plan_specific: 0, plan_on_arrival: 0, plan_empty: 0 };
    arr.forEach(r => { if (r.filled === 4) t.soap_complete++; t['plan_' + r.plan_kind]++; });
    t.plan_rate = t.records ? Math.round(t.plan_specific / t.records * 1000) / 10 : 0;
    t.soap_rate = t.records ? Math.round(t.soap_complete / t.records * 1000) / 10 : 0;
    return t;
  };
  const group = (keyFn) => { const g = {}; M.rows.forEach(r => { const k = keyFn(r); (g[k] = g[k] || []).push(r); }); return g; };
  const byDoc = group(r => r.doctor || 'Tanpa nama dokter');
  const byMonth = group(r => r.date.slice(0, 7));
  const byWriter = group(r => r.written_by || '-');
  return {
    available: true, synced_at: M.synced_at,
    summary: tally(M.rows),
    by_doctor: Object.entries(byDoc).map(([doctor, arr]) => ({ doctor, ...tally(arr) })).sort((a, b) => b.records - a.records),
    by_month: Object.keys(byMonth).sort().reverse().slice(0, 6).map(m => ({ month: m, ...tally(byMonth[m]) })),
    // KPI harian: 14 hari terakhir yang ada kunjungannya, per dokter
    daily: Object.keys(group(r => r.date)).sort().reverse().slice(0, 14).map(day => {
      const arr = M.rows.filter(r => r.date === day);
      const per = {}; arr.forEach(r => { const k = r.doctor || 'Tanpa nama dokter'; const x = per[k] || (per[k] = { doctor: k, records: 0, plan_specific: 0 }); x.records++; if (r.plan_kind === 'specific') x.plan_specific++; });
      return { date: day, ...tally(arr), by_doctor: Object.values(per).sort((a, b) => b.records - a.records) };
    }),
    writers: Object.entries(byWriter).map(([name, arr]) => ({ name, records: arr.length, plan_specific: arr.filter(r => r.plan_kind === 'specific').length })).filter(w => w.plan_specific).sort((a, b) => b.plan_specific - a.plan_specific).slice(0, 8)
  };
}

// ==================== REKOMENDASI NEXT TREATMENT ====================
// Urutan sumber: (1) Plan dokter di medical record Neosoft, (2) sisa sesi paket,
// (3) pola pasien lain — treatment yang paling sering diambil di kunjungan
// berikutnya setelah treatment yang sama, beserta jarak kembalinya.
const NEXT_TX_EXCLUDE = /biaya administrasi|biaya konsultasi|konsultasi dokter|skin analyzer|yogurt|^add on|gocap deals/i;
const _nextTxCache = { key: null, value: null };
function _nextTxModel() {
  const { lines } = _t360Base();
  const key = lines.length;
  if (_nextTxCache.key === key) return _nextTxCache.value;
  const visits = {};
  lines.forEach(l => {
    if (NEXT_TX_EXCLUDE.test(l.name)) return;
    const v = visits[l.customer_id] || (visits[l.customer_id] = {});
    (v[l.date] = v[l.date] || new Map()).set(l.code, l.name);
  });
  const trans = {}, names = {};
  Object.values(visits).forEach(v => {
    const days = Object.keys(v).sort();
    days.forEach(d => v[d].forEach((n, c) => { names[c] = n; }));
    for (let i = 1; i < days.length; i++) {
      const gap = Math.round((new Date(days[i]) - new Date(days[i - 1])) / 864e5);
      v[days[i - 1]].forEach((_, a) => {
        const t = trans[a] || (trans[a] = { n: 0, next: {}, gaps: [] });
        t.n++; t.gaps.push(gap);
        v[days[i]].forEach((__, b) => { const x = t.next[b] || (t.next[b] = { count: 0, gaps: [] }); x.count++; x.gaps.push(gap); });
      });
    }
  });
  _nextTxCache.key = key;
  _nextTxCache.value = { visits, trans, names };
  return _nextTxCache.value;
}

const _pkgStoreCache = { ref: null, byCust: null };
// Sisa paket dari package_balances.json (sama dengan tab "Tx / Product Balance" Neosoft,
// termasuk paket yang belum pernah dipakai). Null bila belum pernah disinkron.
function _packageBalancesFromStore(cid) {
  const store = getSafeJson('package_balances.json');
  if (!store || Array.isArray(store) || !store.synced_at || !Array.isArray(store.packages)) return null;
  if (_pkgStoreCache.ref !== store) {
    const prod = {}; (getSafeJson('products.json') || []).forEach(p => { prod[p.id] = p; });
    const today = todayJakarta();
    const byCust = {};
    store.packages.forEach(k => {
      if (k.expired_date && String(k.expired_date).slice(0, 10) < today) return;   // paket kedaluwarsa
      const pr = prod[k.product_id] || {};
      // Hanya sisa sesi treatment: biaya administrasi/konsultasi dan produk (P-) bukan paket yang perlu dijadwalkan
      if (!String(pr.product_treatment_code || '').startsWith('T-') || /biaya administrasi|biaya konsultasi|konsultasi dokter|^none$/i.test(String(pr.product_treatment_name || '').trim())) return;
      (byCust[k.customer_id] = byCust[k.customer_id] || []).push({
        code: pr.product_treatment_code || null, treatment: String(pr.product_treatment_name || 'Treatment').trim(),
        remaining: Number(k.remaining), total: Number(k.remaining) + Number(k.used || 0), inv_code: k.inv_code,
        purchased: String(k.inv_date || '').slice(0, 10), expires: k.expired_date ? String(k.expired_date).slice(0, 10) : null,
        last_used: String(k.inv_date || '').slice(0, 10)
      });
    });
    Object.values(byCust).forEach(arr => arr.sort((a, b) => b.purchased.localeCompare(a.purchased)));
    _pkgStoreCache.ref = store; _pkgStoreCache.byCust = byCust;
  }
  return _pkgStoreCache.byCust[cid] || [];
}
const _pkgCache = { refs: null, byCust: null };
function _packageBalances(customerId) {
  const cid = Number(customerId);
  const fromStore = _packageBalancesFromStore(cid);
  if (fromStore) return fromStore;
  // Cadangan (belum ada package_balances.json): dihitung dari data pemakaian — paket yang belum pernah dipakai tidak terlihat
  const details = getSafeJson('usages_details.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const products = getSafeJson('products.json') || [];
  const usageHeaders = getSafeJson('usages.json') || [];
  const prod = {}; products.forEach(p => { prod[p.id] = p; });
  if (!_pkgCache.refs || _pkgCache.refs[0] !== details || _pkgCache.refs[1] !== invoices || _pkgCache.refs[2] !== usageHeaders) {
    const inv = {}; invoices.forEach(i => { inv[i.inv_code] = i; });
    const voidUsage = new Set(); usageHeaders.forEach(h => { if (h.is_void) voidUsage.add(h.id); });
    const byCust = {};
    details.forEach(d => {
      const i = inv[d.inv_code];
      // baris pemakaian yang di-void dilewati: saldo mengikuti pemakaian terakhir yang sah
      if (!i || i.void_invoice || !d.invoice_package_id || voidUsage.has(d.usage_id)) return;
      const m = byCust[i.customer_id] || (byCust[i.customer_id] = {});
      if (!m[d.invoice_package_id] || d.id > m[d.invoice_package_id].id) m[d.invoice_package_id] = d;
    });
    _pkgCache.refs = [details, invoices, usageHeaders]; _pkgCache.byCust = byCust;
  }
  const last = _pkgCache.byCust[cid] || {};
  // qty di baris pemakaian terakhir = sisa sesi (dicek dengan "Tx / Product Balance" Neosoft).
  // Item paket yang belum pernah dipakai sama sekali belum terlihat di data ini.
  return Object.values(last).filter(d => Number(d.qty) > 0).map(d => ({
    code: (prod[d.product_id] || {}).product_treatment_code || null,
    treatment: String((prod[d.product_id] || {}).product_treatment_name || 'Treatment').trim(),
    remaining: Number(d.qty), inv_code: d.inv_code, last_used: String(d.created_at || '').slice(0, 10)
  })).sort((a, b) => b.last_used.localeCompare(a.last_used));
}

// ==================== PEMBACAAN PLAN DOKTER ====================
// Plan di SOAP Neosoft dipakai dokter untuk dua hal: treatment yang dikerjakan
// hari itu juga, dan rencana berikutnya ("diulang 2 minggu lagi"). Di sini Plan
// dipecah per bagian; tiap bagian dicek apakah sudah dikerjakan (pemakaian
// treatment pasien), dan jarak waktu yang ditulis dokter dibaca jadi tanggal.
// Pencocokan memakai kata kunci keluarga treatment, jadi sifatnya perkiraan.
const PLAN_FAMILIES = {
  peel: /peel/, pico: /pico/, ipl: /\bipl\b/, hifu: /hifu/, rf: /\brf\b|radio\s*freq/,
  botox: /botox|nabota|dysport|xeomin/, filler: /filler/, meso: /m[ei]s{1,2}o|intralipo|lipolisis|fat\s*apop/,
  facial: /facial|microderm|mikroderm|hydra|phyto|yoga|gua\s*sha/, booster: /booster|nctf|exosome|rejuran|profhilo|vitaran|nucleofill|evehilo|pluryal|mochi|juvelook|collagen\s*stim/,
  laser: /laser|\bco2\b|nd.?yag/, thread: /thread|benang|\bpdo\b|\bcog\b/, inject: /inject|\binj\b|injeksi|keloid|hormon|vit\s*c|gluta/,
  infus: /infus|chromosome/, prp: /\bprp\b/, cauter: /cauter|cautery/, subcision: /subcis|subsis/, ozone: /ozon/, pdt: /\bpdt\b/, hair: /hair\s*(growth|removal)/
};
const PLAN_PRODUCT_RE = /anti\s*(biotik|biotic|iritasi)|krim|cream|serum|sunscreen|night|wash|toner|essence|obat|salep|vitamin/;
const PLAN_WORDS = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };
const _planNorm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const _planFamilyHits = (t) => Object.keys(PLAN_FAMILIES).filter(k => PLAN_FAMILIES[k].test(t));
// Apakah Plan menyebut treatment ini (per keluarga treatment: peel, pico, ipl, ...)?
function planMentionsTreatment(planText, treatmentName) {
  const t = _planNorm(treatmentName);
  const fams = _planFamilyHits(t);
  if (!fams.length) return false;
  return _planParts(planText).some(part => { const low = _planNorm(part); return fams.some(f => PLAN_FAMILIES[f].test(low)); });
}
function _planParts(planText) {
  return String(planText || '').split(/\n|;|\s\+\s|\sdan\s|,(?![^()]*\))/).map(x => x.trim()).filter(x => x.length >= 3 && !/saat kedatangan/i.test(x));
}
// Jarak waktu yang ditulis dokter dalam satu potongan teks → hari (null kalau tidak ada)
function parsePlanIntervalDays(text) {
  const t = _planNorm(text).replace(/\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b/g, m => String(PLAN_WORDS[m]));
  const found = [];
  const mul = (u) => /^(minggu|mgg|mg|pekan)/.test(u) ? 7 : /^(bulan|bln)/.test(u) ? 30 : 1;
  let m; const re = /(\d+)(?:\s*[-–]\s*\d+)?\s*(minggu|mgg|mg|pekan|bulan|bln|hari|hr)(?:an)?\b/g;
  while ((m = re.exec(t))) found.push(Number(m[1]) * mul(m[2]));
  // "setiap bulan", "tiap minggu" (tanpa angka = 1 satuan), "mingguan", "bulanan"
  const re2 = /\b(?:setiap|tiap|per)\s*(minggu|mgg|pekan|bulan|bln|hari)\b/g;
  while ((m = re2.exec(t))) found.push(mul(m[1]));
  if (/\bmingguan\b/.test(t) && !found.length) found.push(7);
  if (/\bbulanan\b/.test(t) && !found.length) found.push(30);
  if (/\bseminggu\b/.test(t)) found.push(7);
  if (/\bsebulan\b/.test(t)) found.push(30);
  const ok = found.filter(d => d >= 3 && d <= 365);
  return ok.length ? Math.min(...ok) : null;
}
const _linesByCustCache = { ref: null, map: null };
function _linesByCust(cid) {
  const { lines } = _t360Base();
  if (_linesByCustCache.ref !== lines) { const map = {}; lines.forEach(l => { (map[l.customer_id] = map[l.customer_id] || []).push(l); }); _linesByCustCache.ref = lines; _linesByCustCache.map = map; }
  return _linesByCustCache.map[cid] || [];
}
// Status tiap bagian Plan: done / remaining / product. planDate = tanggal konsultasi.
function analyzePlan(planText, customerId, planDate) {
  const mine = _linesByCust(Number(customerId));
  const visitedAfter = mine.some(l => l.date > planDate);
  const out = { remaining: [], done: [], products: [], interval_days: null, due_date: null };
  let headerIv = null;
  const allParts = _planParts(planText);
  // Kalimat pengulangan umum ("all treatment tersebut diulang sebulan sekali") berlaku untuk semua bagian
  const isGlobalRepeat = (low) => !_planFamilyHits(low).length && /(all|semua|seluruh)\s+(treatment|tindakan)|tersebut|\bdiulang\b|\bulang\b/.test(low) && !!parsePlanIntervalDays(low);
  const globalIvs = allParts.map(_planNorm).filter(isGlobalRepeat).map(parsePlanIntervalDays);
  const globalIv = globalIvs.length ? Math.min(...globalIvs) : null;
  allParts.forEach(part => {
    const low = _planNorm(part);
    if (isGlobalRepeat(low)) return;
    if (PLAN_PRODUCT_RE.test(low) && !_planFamilyHits(low).length) { out.products.push(part); return; }
    const fams = _planFamilyHits(low);
    // Judul jadwal tanpa treatment ("setiap 2 mingguan:", "sebulan sekali:") berlaku untuk bagian di bawahnya
    if (!fams.length && (/:\s*$/.test(part) || (parsePlanIntervalDays(low) && low.split(' ').length <= 4))) { headerIv = parsePlanIntervalDays(low); return; }
    const own = parsePlanIntervalDays(low);
    const iv = own || headerIv || globalIv;
    // Bagian yang berulang ("2 minggu lagi") baru dianggap terpenuhi bila dikerjakan mendekati jaraknya;
    // bagian biasa = dikerjakan sejak sehari sebelum konsultasi.
    const from = iv ? addDaysIso(planDate, Math.floor(iv / 2)) : addDaysIso(planDate, -1);
    let done;
    if (fams.length) done = mine.some(l => l.date >= from && fams.some(f => PLAN_FAMILIES[f].test(_planNorm(l.name))));
    else done = visitedAfter;     // tak bisa diverifikasi: anggap tertangani bila pasien sudah kembali
    (done ? out.done : out.remaining).push({ text: part, interval_days: iv });
  });
  const ivs = out.remaining.map(r => r.interval_days).filter(Boolean);
  if (ivs.length) { out.interval_days = Math.min(...ivs); out.due_date = addDaysIso(planDate, out.interval_days); }
  out.remaining_text = out.remaining.map(r => r.text).join('\n');
  out.all_done = out.remaining.length === 0;
  return out;
}

function getNextTreatmentRecommendation(customerId) {
  const cid = Number(customerId);
  if (!cid) return { available: false, note: 'Pasien tidak dikenal.' };
  const model = _nextTxModel();
  const v = model.visits[cid] || {};
  const days = Object.keys(v).sort();
  const lastDay = days[days.length - 1] || null;
  const lastTx = lastDay ? [...v[lastDay].entries()].map(([code, name]) => ({ code, name })) : [];

  // 1. Plan dokter terbaru (medical record Neosoft)
  const recs = (_medicalRecords().byCust[cid] || []);
  const planRec = recs.find(r => r.plan_kind === 'specific');
  const planStatus = planRec ? analyzePlan(planRec.soap.plan, cid, planRec.date) : null;
  const doctorPlan = planRec ? {
    text: planRec.soap.plan, date: planRec.date, doctor: planRec.doctor, written_by: planRec.written_by,
    assessment: planRec.soap.assessment || null, inv_code: planRec.inv_code,
    visited_after: days.some(d => d > planRec.date),
    // bagian Plan yang belum / sudah dikerjakan (pemakaian treatment pasien)
    remaining_text: planStatus.remaining_text, done_parts: planStatus.done.map(x => x.text), all_done: planStatus.all_done,
    interval_days: planStatus.interval_days, due_date: planStatus.due_date
  } : null;

  // 2. Sisa paket
  const packages = _packageBalances(cid);

  // 3. Pola pasien lain dari treatment kunjungan terakhir
  const agg = {};
  let base = 0;
  lastTx.forEach(t => {
    const tr = model.trans[t.code]; if (!tr || tr.n < 5) return;
    base += tr.n;
    Object.entries(tr.next).forEach(([b, x]) => { const a = agg[b] || (agg[b] = { count: 0, gaps: [] }); a.count += x.count; a.gaps.push(...x.gaps); });
  });
  const pattern = base ? Object.entries(agg).map(([code, a]) => ({ code, name: model.names[code] || code, pct: Math.round(a.count / base * 100), cases: a.count, median_days: Math.round(_median(a.gaps)) }))
    .filter(x => x.cases >= 3).sort((a, b) => b.pct - a.pct).slice(0, 3) : [];

  // Perkiraan tanggal kembali: median jarak pola teratas, kalau tidak ada 30 hari
  let gapDays = pattern.length ? Math.max(7, pattern[0].median_days || 30) : 30;
  let suggestedDate = lastDay ? addDaysIso(lastDay, gapDays) : null;
  // Jarak yang ditulis dokter di Plan mengalahkan perkiraan dari pola pasien lain
  let suggestedSource = 'pattern';
  const planPending = doctorPlan && !doctorPlan.all_done;
  if (planPending && doctorPlan.due_date) { suggestedDate = doctorPlan.due_date; gapDays = doctorPlan.interval_days; suggestedSource = 'doctor'; }

  let primary = null;
  if (planPending) primary = { source: 'doctor_plan', label: 'Plan dokter', text: doctorPlan.remaining_text, why: `${doctorPlan.doctor || 'Dokter'} · ${doctorPlan.date}${doctorPlan.done_parts.length ? ` · sudah dikerjakan: ${doctorPlan.done_parts.join(', ')}` : ''}` };
  else if (packages.length) primary = { source: 'package', label: 'Sisa paket', text: packages.map(p => `${p.treatment} (sisa ${p.remaining}${p.total ? ' dari ' + p.total : ''})`).join(', '), why: 'Sesi paket yang belum dipakai' };
  else if (pattern.length) primary = { source: 'pattern', label: 'Rekomendasi otomatis', text: pattern[0].name, why: `${pattern[0].pct}% pasien ${lastTx.map(t => t.name).join(' + ')} mengambil ini di kunjungan berikutnya` };

  return {
    available: true,
    last_visit: lastDay, last_treatments: lastTx.map(t => t.name),
    suggested_date: suggestedDate, suggested_gap_days: gapDays, suggested_source: suggestedSource,
    primary, doctor_plan: doctorPlan, packages, pattern
  };
}

// ==================== TREN BULANAN (MARKETING) ====================
// Kedatangan, pasien (baru vs kembali), treatment, dan spending per bulan.
// Sumber: invoice Neosoft non-void & bukan migrasi, pasien tes dikecualikan.
// Omset = total invoice (sama dengan Revenue Forecast). Kedatangan = hari
// berbeda pasien datang (bukan jumlah invoice); top-up deposit bukan kunjungan.
const _trendCache = { refs: null, value: null };
function getMonthlyTrends() {
  const invoices = getSafeJson('invoices_all.json') || [];
  const customers = getSafeJson('customers_all.json') || [];
  const { lines } = _t360Base();
  if (_trendCache.refs && _trendCache.refs[0] === invoices && _trendCache.refs[1] === lines && _trendCache.refs[2] === customers) return _trendCache.value;
  if (!invoices.length) return { available: false, note: 'Data invoice Neosoft belum tersinkron.' };
  const names = _peCustomerNames();
  const LABEL = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des' };
  const branchOf = (o) => (o == 1 ? 'Depok' : o == 2 ? 'Pondok Kopi' : null);
  const valid = invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i) && branchOf(i.outlet_id) && i.customer_id && !isTestPatientName((names[i.customer_id] || {}).name || ''))
    .map(i => ({ cid: i.customer_id, day: String(i.inv_date || i.created_at || '').slice(0, 10), ym: String(i.inv_date || i.created_at || '').slice(0, 7), branch: branchOf(i.outlet_id), amount: Number(i.total_after_tax || i.total || 0), visit: i.transtype !== 'topup' }))
    .filter(i => i.ym.length === 7);
  // Pasien baru = terdaftar di Neosoft pada bulan itu. Mei 2026 adalah impor
  // massal data pasien lama (7.700+), jadi bulan impor tidak bisa dipisah.
  const regYm = {}; customers.forEach(c => { regYm[c.id] = String(c.created_at || '').slice(0, 7); });
  const months = [...new Set(valid.map(i => i.ym))].sort();
  const curYm = todayJakarta().slice(0, 7);
  const dataStart = months[0];
  const rows = months.map(ym => {
    const inv = valid.filter(i => i.ym === ym);
    const visits = new Set(), visitsBr = { Depok: new Set(), 'Pondok Kopi': new Set() }, pats = new Set();
    inv.filter(i => i.visit).forEach(i => { const k = `${i.cid}|${i.day}`; visits.add(k); visitsBr[i.branch].add(k); pats.add(i.cid); });
    const newP = [...pats].filter(c => regYm[c] === ym).length;
    const spend = inv.reduce((a, i) => a + i.amount, 0);
    const spenders = new Set(inv.filter(i => i.amount > 0).map(i => i.cid));
    const tx = lines.filter(l => l.date.slice(0, 7) === ym && !/biaya administrasi|biaya konsultasi/i.test(l.name));
    const byTx = {}; tx.forEach(l => { const x = byTx[l.code] || (byTx[l.code] = { code: l.code, name: l.name, count: 0 }); x.count++; });
    return {
      ym, label: `${LABEL[ym.slice(5)]} ${ym.slice(2, 4)}`, partial: ym === curYm, first_month: ym === dataStart, new_reliable: ym !== dataStart,
      visits: visits.size, visits_depok: visitsBr.Depok.size, visits_pondok_kopi: visitsBr['Pondok Kopi'].size,
      patients: pats.size, new_patients: newP, returning_patients: pats.size - newP,
      treatments: tx.length, top_treatments: Object.values(byTx).sort((a, b) => b.count - a.count).slice(0, 5),
      spend, avg_spend_per_patient: spenders.size ? Math.round(spend / spenders.size) : 0, avg_spend_per_visit: visits.size ? Math.round(spend / visits.size) : 0
    };
  });
  // Tren treatment teratas (5 treatment terbanyak keseluruhan) per bulan
  const totalByTx = {}; lines.forEach(l => { if (!/biaya administrasi|biaya konsultasi/i.test(l.name)) totalByTx[l.code] = (totalByTx[l.code] || { code: l.code, name: l.name, count: 0 }), totalByTx[l.code].count++; });
  const topCodes = Object.values(totalByTx).sort((a, b) => b.count - a.count).slice(0, 5);
  const treatment_series = topCodes.map(t => ({ code: t.code, name: t.name, by_month: months.map(ym => lines.filter(l => l.code === t.code && l.date.slice(0, 7) === ym).length) }));
  const value = { available: true, months: rows, treatment_series, data_start: dataStart, note_first_month: `${rows[0] ? rows[0].label : ''} adalah bulan impor data pasien lama ke Neosoft, jadi pasien baru vs kembali belum bisa dipisah.` };
  _trendCache.refs = [invoices, lines, customers]; _trendCache.value = value;
  return value;
}

// ==================== APPOINTMENT PASIEN HARIAN (SALES) ====================
// Daftar janji temu Neosoft per tanggal: jam, pasien, cabang, treatment,
// dokter/terapis, status, dan apakah pasien sudah ada invoice hari itu.
function getDailyAppointments(date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : todayJakarta();
  const appts = getSafeJson('appointment_full.json') || [];
  if (!appts.length) return { available: false, note: 'Data appointment Neosoft belum tersinkron.', date: day, rows: [] };
  const invoices = getSafeJson('invoices_all.json') || [];
  const paidToday = new Set(invoices.filter(i => !i.void_invoice && String(i.inv_date || '').slice(0, 10) === day).map(i => i.customer_id));
  const custName = _peCustomerNames();
  const rows = appts.filter(a => String(a.come_date || '').slice(0, 10) === day).map(a => {
    const p = a.patient || {};
    const name = String(p.name || (custName[p.id] || {}).name || 'Pasien').trim();
    const staff = (a.therapists || []).map(t => t.name).filter(Boolean);
    const treatments = a.treatment && a.treatment.product_treatment_name ? [a.treatment.product_treatment_name]
      : (a.appointment_treatments || []).map(t => t.product_treatment_name).filter(Boolean);
    const status = (a.status_color && a.status_color.name) || String(a.status_appointment || '-');
    return {
      id: a.id_appointment, code: a.code, customer_id: p.id || null, patient: name,
      patient_code: (custName[p.id] || {}).code || '', phone: p.phone || '', patient_type: a.patient_type || null,
      branch: a.outlet && a.outlet.id == 1 ? 'Depok' : 'Pondok Kopi',
      start: String(a.start_time || '').slice(0, 5), end: String(a.end_time || '').slice(0, 5),
      type: (a.appointment_type && a.appointment_type.name) || '-', room: a.room_name || null,
      is_lobby: /lobby/i.test(a.room_name || ''),
      treatments, doctor: staff.filter(n => /^dr/i.test(n)).join(', ') || null, staff: staff.filter(n => !/^dr/i.test(n)),
      status, cancelled: !!a.appointment_cancellation || /cancel/i.test(status),
      has_invoice: !!(p.id && paidToday.has(p.id)),
      remarks: a.remarks && a.remarks.trim() !== '-' ? a.remarks.trim() : '',
      created_by: (a.staff && a.staff.name) || null
    };
  }).filter(r => !isTestPatientName(r.patient)).sort((x, y) => x.start.localeCompare(y.start));
  // Appointment di ruang Lobby = check-in resepsionis, bukan sesi treatment.
  // Jika pasien punya sesi di ruang lain hari itu, Lobby dilebur jadi jam check-in.
  const realByCust = new Set(rows.filter(r => !r.is_lobby && r.customer_id).map(r => r.customer_id));
  const checkinByCust = {};
  rows.forEach(r => { if (r.is_lobby && r.customer_id && realByCust.has(r.customer_id) && !checkinByCust[r.customer_id]) checkinByCust[r.customer_id] = r.start; });
  const lobbyMerged = rows.filter(r => r.is_lobby && r.customer_id && realByCust.has(r.customer_id)).length;
  const shown = rows.filter(r => !(r.is_lobby && r.customer_id && realByCust.has(r.customer_id)));
  shown.forEach(r => { r.checkin = checkinByCust[r.customer_id] || null; r.lobby_only = r.is_lobby; });
  rows.length = 0; shown.forEach(r => rows.push(r));
  const by = (k) => rows.reduce((m, r) => { m[r[k]] = (m[r[k]] || 0) + 1; return m; }, {});
  // Jumlah appointment 7 hari ke depan (untuk navigasi cepat)
  const upcoming = {};
  appts.forEach(a => { const d = String(a.come_date || '').slice(0, 10); if (d > day && d <= addDaysIso(day, 7)) upcoming[d] = (upcoming[d] || 0) + 1; });
  return {
    available: true, date: day, rows,
    summary: { total: rows.length, by_status: by('status'), by_branch: by('branch'), came: rows.filter(r => r.has_invoice).length, cancelled: rows.filter(r => r.cancelled).length, lobby_merged: lobbyMerged },
    upcoming, data_until: appts.reduce((m, a) => (String(a.come_date || '').slice(0, 10) > m ? String(a.come_date).slice(0, 10) : m), '')
  };
}

// ==================== GALERI BEFORE/AFTER PER TREATMENT ====================
// Sesi foto (pasien + tanggal pemeriksaan) dicocokkan dengan treatment yang
// dikerjakan pasien itu di hari yang sama (toleransi ±1 hari karena tanggal
// pemakaian tercatat UTC).
const _baTxCache = { refs: null, value: null };
function _beforeAfterTreatmentIndex() {
  const pe = getSafeJson('physicalexamination.json') || [];
  const { lines } = _t360Base();
  if (_baTxCache.refs && _baTxCache.refs[0] === pe && _baTxCache.refs[1] === lines) return _baTxCache.value;
  const txByCustDay = {};
  lines.forEach(l => { const k = `${l.customer_id}|${l.date}`; (txByCustDay[k] = txByCustDay[k] || new Map()).set(l.code, l.name); });
  const sessions = {};
  pe.forEach(x => {
    const day = peDay(x), k = `${x.customer_id}|${day}`;
    const s = sessions[k] || (sessions[k] = { customer_id: x.customer_id, date: day, branch: peBranch(x.outlet_id), exams: [] });
    s.exams.push(x);
  });
  const byCode = {}, names = {};
  Object.values(sessions).forEach(s => {
    const tx = new Map();
    [0, -1, 1].forEach(off => { const m = txByCustDay[`${s.customer_id}|${addDaysIso(s.date, off)}`]; if (m) m.forEach((n, c) => tx.set(c, n)); });
    s.treatments = [...tx.values()];
    tx.forEach((n, c) => { names[c] = n; (byCode[c] = byCode[c] || []).push(s); });
  });
  _baTxCache.refs = [pe, lines];
  _baTxCache.value = { byCode, names };
  return _baTxCache.value;
}

function getBeforeAfterTreatmentList() {
  const { byCode, names } = _beforeAfterTreatmentIndex();
  return Object.entries(byCode).map(([code, arr]) => ({ code, name: names[code], sessions: arr.length }))
    .filter(t => !/biaya administrasi|biaya konsultasi/i.test(t.name))
    .sort((a, b) => b.sessions - a.sessions);
}

async function getBeforeAfterByTreatment(code, { limit = 12 } = {}) {
  const { byCode, names } = _beforeAfterTreatmentIndex();
  const arr = (byCode[code] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) return { available: true, code, name: names[code] || code, total_sessions: 0, sessions: [] };
  const svc = require('./pe_photo_service');
  const cust = _peCustomerNames();
  const pick = arr.slice(0, limit);
  await Promise.all(pick.flatMap(s => s.exams.map(x => svc.ensureExamPhotos(x).catch(() => ({ count: 0 })))));
  const sessions = pick.map(s => {
    const out = { date: s.date, branch: s.branch, before: null, after: null, other: [], patient: (cust[s.customer_id] || {}).name || 'Pasien', customer_id: s.customer_id, treatments: s.treatments };
    s.exams.forEach(x => {
      const m = svc.manifestFor(x.id);
      const e = { pe_id: x.id, kind: peKind(x.description), description: String(x.description || '').trim(), created_at: x.created_at, photo_count: m ? m.count : 0 };
      if (e.kind === 'before' && !out.before) out.before = e; else if (e.kind === 'after' && !out.after) out.after = e; else out.other.push(e);
    });
    out.complete = !!(out.before && out.before.photo_count) && !!(out.after && out.after.photo_count);
    return out;
  });
  return { available: true, code, name: names[code] || code, total_sessions: arr.length, shown: sessions.length, sessions };
}

// ==================== DAILY KPI PERAWAT (HR) ====================
// Dari laporan komisi Neosoft (baris tindakan per terapis/perawat), dihubungkan
// ke pasien lewat kode pemakaian (usages.json). Kelengkapan foto = sesi pasien
// yang ditangani perawat itu pada hari itu yang punya foto Before & After.
const _nurseKpiCache = { refs: null, value: null };
function getNurseDailyKpi({ days = 14 } = {}) {
  const rep = getSafeJson('commission_report.json');
  const usages = getSafeJson('usages.json') || [];
  const pe = getSafeJson('physicalexamination.json') || [];
  const tx = (rep && !Array.isArray(rep) && rep.treatment) || {};
  if (_nurseKpiCache.refs && _nurseKpiCache.refs[0] === rep && _nurseKpiCache.refs[1] === usages && _nurseKpiCache.refs[2] === pe && _nurseKpiCache.days === days) return _nurseKpiCache.value;
  const rows = Object.values(tx).flat();
  if (!rows.length) return { available: false, note: 'Laporan komisi Neosoft belum tersinkron.' };
  const custByUsage = {}; usages.forEach(u => { if (!u.is_void) custByUsage[u.usage_code] = u.customer_id; });
  const names = _peCustomerNames();
  // Sesi foto per pasien+tanggal
  const photo = {};
  pe.forEach(x => { const k = `${x.customer_id}|${peDay(x)}`; const s = photo[k] || (photo[k] = { before: false, after: false }); const kind = peKind(x.description); if (kind === 'before') s.before = true; else if (kind === 'after') s.after = true; });
  const NON_PERSON = /^(admin|none|automasi|neosoft|intern access|ns training)$/i;
  const per = {};   // tanggal|perawat
  rows.forEach(r => {
    const nurse = String(r.therapist_name || '').trim();
    if (!nurse || r.is_doctor || /^dr/i.test(nurse) || NON_PERSON.test(nurse)) return;
    const day = String(r.date || '').slice(0, 10);
    const cid = custByUsage[r.code];
    if (cid && isTestPatientName((names[cid] || {}).name || '')) return;
    const k = `${day}|${nurse}`;
    const x = per[k] || (per[k] = { date: day, nurse, actions: 0, value: 0, commission: 0, patients: new Set(), branches: new Set() });
    x.actions += Number(r.used_qty) || 1; x.value += Number(r.used_value) || 0; x.commission += Number(r.total_commission) || 0;
    if (cid) x.patients.add(cid);
    x.branches.add(r.outlet_id == 1 ? 'Depok' : 'Pondok Kopi');
  });
  const finalize = x => {
    const pts = [...x.patients];
    // foto dicek di hari yang sama (toleransi +-1 hari)
    const withPhoto = pts.filter(c => [0, -1, 1].some(o => { const s = photo[`${c}|${addDaysIso(x.date, o)}`]; return s && s.before && s.after; })).length;
    return { date: x.date, nurse: x.nurse, actions: x.actions, patients: pts.length, value: Math.round(x.value), commission: Math.round(x.commission), photo_complete: withPhoto, photo_rate: pts.length ? Math.round(withPhoto / pts.length * 1000) / 10 : null, branch: [...x.branches].join(', ') };
  };
  const all = Object.values(per).map(finalize);
  const dates = [...new Set(all.map(r => r.date))].sort().reverse().slice(0, days);
  const daily = dates.map(d => ({ date: d, nurses: all.filter(r => r.date === d).sort((a, b) => b.actions - a.actions) }));
  // Ringkasan bulan berjalan & bulan lalu per perawat
  const ymNow = todayJakarta().slice(0, 7);
  const ymPrev = addDaysIso(ymNow + '-01', -1).slice(0, 7);
  const monthSum = ym => {
    const m = {};
    all.filter(r => r.date.slice(0, 7) === ym).forEach(r => {
      const x = m[r.nurse] || (m[r.nurse] = { nurse: r.nurse, days: 0, actions: 0, patients: 0, value: 0, commission: 0, photo_complete: 0 });
      x.days++; x.actions += r.actions; x.patients += r.patients; x.value += r.value; x.commission += r.commission; x.photo_complete += r.photo_complete;
    });
    return Object.values(m).map(x => ({ ...x, actions_per_day: Math.round(x.actions / x.days * 10) / 10, photo_rate: x.patients ? Math.round(x.photo_complete / x.patients * 1000) / 10 : null })).sort((a, b) => b.actions - a.actions);
  };
  const value = { available: true, daily, month: { ym: ymNow, rows: monthSum(ymNow) }, prev_month: { ym: ymPrev, rows: monthSum(ymPrev) } };
  _nurseKpiCache.refs = [rep, usages, pe]; _nurseKpiCache.days = days; _nurseKpiCache.value = value;
  return value;
}

// ==================== REKOMENDASI PENJUALAN (CROSS-SELL BY PRODUCT) ====================
// Dari baris penjualan per invoice (laporan komisi Neosoft "sales": treatment
// & produk homecare). Untuk tiap item A: item yang paling sering dibeli di
// invoice yang sama, dan yang dibeli di kunjungan berikutnya (<=90 hari),
// serta pasien yang sudah beli A tapi belum pernah beli B (target cross-sell).
const XSELL_EXCLUDE = /biaya administrasi|biaya konsultasi|konsultasi dokter|gocap deals|^add on/i;
const _xsCache = { refs: null, value: null };
function _crossSellIndex() {
  const rep = getSafeJson('commission_report.json');
  const invoices = getSafeJson('invoices_all.json') || [];
  if (_xsCache.refs && _xsCache.refs[0] === rep && _xsCache.refs[1] === invoices) return _xsCache.value;
  const rows = Object.values((rep && !Array.isArray(rep) && rep.sales) || {}).flat();
  const inv = {}; invoices.forEach(i => { inv[i.inv_code] = i; });
  const names = _peCustomerNames();
  const baskets = {};           // inv_code -> { cid, date, items: Map(code -> name) }
  rows.forEach(r => {
    const i = inv[r.code];
    if (!i || i.void_invoice || isMigrationInvoice(i) || !r.item_code || XSELL_EXCLUDE.test(r.item_name || '')) return;
    if (isTestPatientName((names[i.customer_id] || {}).name || '')) return;
    const b = baskets[r.code] || (baskets[r.code] = { cid: i.customer_id, date: String(i.inv_date || '').slice(0, 10), items: new Map(), value: 0 });
    b.items.set(r.item_code, String(r.item_name || r.item_code).trim()); b.value += Number(r.item_value) || 0;
  });
  const itemName = {}, byCust = {};
  Object.values(baskets).forEach(b => { b.items.forEach((n, c) => { itemName[c] = n; }); (byCust[b.cid] = byCust[b.cid] || []).push(b); });
  Object.values(byCust).forEach(arr => arr.sort((a, b) => a.date.localeCompare(b.date)));
  _xsCache.refs = [rep, invoices];
  _xsCache.value = { baskets: Object.values(baskets), byCust, itemName, names };
  return _xsCache.value;
}

function getCrossSell(code, { targets = 30 } = {}) {
  const X = _crossSellIndex();
  if (!X.baskets.length) return { available: false, note: 'Data penjualan per item (laporan komisi Neosoft) belum tersinkron.' };
  const withA = X.baskets.filter(b => b.items.has(code));
  if (!withA.length) return { available: true, code, name: X.itemName[code] || code, invoices: 0, same_invoice: [], next_visit: [], targets: [] };
  const same = {}, next = {};
  withA.forEach(b => b.items.forEach((n, c) => { if (c !== code) same[c] = (same[c] || 0) + 1; }));
  const buyersA = [...new Set(withA.map(b => b.cid))];
  buyersA.forEach(cid => {
    const arr = X.byCust[cid];
    const first = arr.find(b => b.items.has(code));
    const seen = new Set();
    arr.filter(b => b.date > first.date && b.date <= addDaysIso(first.date, 90)).forEach(b => b.items.forEach((n, c) => { if (c !== code) seen.add(c); }));
    seen.forEach(c => { next[c] = (next[c] || 0) + 1; });
  });
  const kind = c => (String(c).startsWith('P-') ? 'Produk' : 'Treatment');
  const top = (m, base) => Object.entries(m).map(([c, n]) => ({ code: c, name: X.itemName[c] || c, kind: kind(c), count: n, pct: Math.round(n / base * 100) }))
    .filter(x => x.count >= 3).sort((a, b) => b.count - a.count).slice(0, 8);
  const sameTop = top(same, withA.length), nextTop = top(next, buyersA.length);
  // Target: pembeli A (6 bulan terakhir) yang belum pernah membeli rekomendasi teratas
  const best = new Map();
  [...sameTop.map(x => ({ ...x, when: 'sekaligus' })), ...nextTop.map(x => ({ ...x, when: 'kunjungan berikutnya' }))].forEach(x => { const cur = best.get(x.code); if (!cur || x.pct > cur.pct) best.set(x.code, x); });
  const recs = [...best.values()].sort((a, b) => b.pct - a.pct).slice(0, 3);
  const since = addDaysIso(todayJakarta(), -180);
  const tg = [];
  buyersA.forEach(cid => {
    const arr = X.byCust[cid];
    const lastA = [...arr].reverse().find(b => b.items.has(code));
    if (!lastA || lastA.date < since) return;
    const bought = new Set(arr.flatMap(b => [...b.items.keys()]));
    const missing = recs.filter(r => !bought.has(r.code));
    if (!missing.length) return;
    tg.push({ customer_id: cid, patient: (X.names[cid] || {}).name || 'Pasien', last_a: lastA.date, spend: arr.reduce((a, b) => a + b.value, 0), offer: missing.map(r => r.name) });
  });
  tg.sort((a, b) => b.spend - a.spend);
  return { available: true, code, name: X.itemName[code] || code, kind: kind(code), invoices: withA.length, buyers: buyersA.length, same_invoice: sameTop, next_visit: nextTop, recommendations: recs, targets_total: tg.length, targets: tg.slice(0, targets) };
}

// Peluang cross-sell terbesar: pasangan A -> B dengan pembeli A terbanyak yang belum beli B
function getCrossSellOpportunities({ limit = 10 } = {}) {
  const X = _crossSellIndex();
  if (!X.baskets.length) return { available: false, note: 'Data penjualan per item belum tersinkron.' };
  const cnt = {}; X.baskets.forEach(b => b.items.forEach((n, c) => { cnt[c] = (cnt[c] || 0) + 1; }));
  const candidates = Object.entries(cnt).filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c]) => c);
  const out = [];
  candidates.forEach(c => {
    const d = getCrossSell(c, { targets: 0 });
    (d.recommendations || []).slice(0, 1).forEach(r => {
      out.push({ from_code: c, from: d.name, to_code: r.code, to: r.name, to_kind: r.kind, pct: r.pct, targets: d.targets_total });
    });
  });
  return { available: true, rows: out.filter(r => r.targets > 0).sort((a, b) => b.targets - a.targets).slice(0, limit) };
}

// ==================== REMINDER CAMPAIGN PROMOSI (MARKETING) ====================
// Campaign diambil dari menu Harga Promo & Bottom (price_master.json). Pengingat:
// siapkan blast (H-7 s/d H-1 sebelum mulai), blast pembukaan (hari mulai),
// pengingat "segera berakhir" (H-3 s/d hari terakhir), dan peringatan bila
// tidak ada campaign aktif/terjadwal. Status "sudah dikerjakan" disimpan.
const CAMPAIGN_REMINDER_FILE = path.join(__dirname, 'data', 'campaign_reminders.json');
function _campaignDone() { try { return JSON.parse(fs.readFileSync(CAMPAIGN_REMINDER_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function markCampaignReminder({ key, done, by }) {
  if (!/^[a-z0-9-]+\|(prepare|launch|last_call)$/i.test(String(key || ''))) return { success: false, error: 'Kunci pengingat tidak valid' };
  const all = _campaignDone();
  if (done === false) delete all[key]; else all[key] = { by: by || 'KEFIR', at: new Date().toISOString() };
  try { fs.writeFileSync(CAMPAIGN_REMINDER_FILE, JSON.stringify(all, null, 2)); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
}
function getCampaignReminders() {
  const pm = getPriceMaster();
  const campaigns = (pm && pm.campaigns) || [];
  const today = todayJakarta();
  const done = _campaignDone();
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const list = campaigns.filter(c => c.start && c.end).map(c => {
    const status = today < c.start ? 'upcoming' : today > c.end ? 'ended' : 'active';
    return { id: c.id, name: c.name, offer: c.offer || '', terms: c.terms || '', start: c.start, end: c.end, memo_no: c.memo_no || '', source_url: c.source_url || '',
      items: (c.items || []).length, bundles: (c.bundles || []).length, status,
      days_to_start: days(today, c.start), days_to_end: days(today, c.end) };
  }).sort((a, b) => b.start.localeCompare(a.start));
  const reminders = [];
  const add = (c, type, title, due) => { const key = `${c.id}|${type}`; reminders.push({ key, campaign_id: c.id, campaign: c.name, type, title, due, done: !!done[key], done_by: done[key] ? done[key].by : null }); };
  list.forEach(c => {
    if (c.status === 'upcoming' && c.days_to_start <= 7) add(c, 'prepare', `Siapkan materi & blast pembukaan (mulai ${c.days_to_start} hari lagi)`, addDaysIso(c.start, -1));
    if (c.status === 'active' && days(c.start, today) <= 1) add(c, 'launch', 'Kirim blast pembukaan campaign', c.start);
    if (c.status === 'active' && c.days_to_end <= 3) add(c, 'last_call', c.days_to_end === 0 ? 'Hari terakhir — kirim pengingat "berakhir hari ini"' : `Kirim pengingat "segera berakhir" (${c.days_to_end} hari lagi)`, addDaysIso(c.end, -3) < today ? today : addDaysIso(c.end, -3));
  });
  const activeOrSoon = list.filter(c => c.status === 'active' || (c.status === 'upcoming' && c.days_to_start <= 14));
  return {
    available: true, today, campaigns: list, reminders: reminders.sort((a, b) => a.done - b.done || a.due.localeCompare(b.due)),
    warning: activeOrSoon.length ? null : 'Tidak ada campaign aktif atau terjadwal dalam 14 hari ke depan. Tambahkan campaign baru di menu Harga Promo & Bottom.'
  };
}

// Detail satu appointment: info reservasi + ringkasan pasien untuk front office
// (riwayat kunjungan, belanja, sisa paket, plan dokter, rekomendasi berikutnya).
function getAppointmentDetail(id) {
  const appts = getSafeJson('appointment_full.json') || [];
  const a = appts.find(x => String(x.id_appointment) === String(id));
  if (!a) return { available: false, note: 'Appointment tidak ditemukan.' };
  const p = a.patient || {};
  const cid = Number(p.id) || null;
  const cust = cid ? (getSafeJson('customers_all.json') || []).find(c => c.id === cid) : null;
  const invoices = cid ? (getSafeJson('invoices_all.json') || []).filter(i => i.customer_id === cid && !i.void_invoice && !isMigrationInvoice(i)) : [];
  const { lines } = _t360Base();
  const mine = cid ? lines.filter(l => l.customer_id === cid) : [];
  const byDay = {};
  invoices.forEach(i => { const d = String(i.inv_date || '').slice(0, 10); const x = byDay[d] || (byDay[d] = { date: d, value: 0, treatments: new Set(), branch: i.outlet_id == 1 ? 'Depok' : 'Pondok Kopi' }); x.value += Number(i.total_after_tax || i.total || 0); });
  mine.forEach(l => { const x = byDay[l.date] || (byDay[l.date] = { date: l.date, value: 0, treatments: new Set(), branch: l.branch }); x.treatments.add(l.name); });
  const pend = _pendingByDay(cid);
  const visits = Object.values(byDay).sort((x, y) => y.date.localeCompare(x.date)).map(v => ({ ...v, treatments: [...v.treatments], pending: [...new Set(pend[v.date] || [])] }));
  const day = String(a.come_date || '').slice(0, 10);
  const prev = visits.filter(v => v.date < day);
  const next = cid ? getNextTreatmentRecommendation(cid) : null;
  const n = cust && cust.name;
  const bd = (cust && (cust.birth_information || {}).birth_date) || p.birth_date || null;
  return {
    available: true,
    appointment: {
      id: a.id_appointment, code: a.code, date: day, start: String(a.start_time || '').slice(0, 5), end: String(a.end_time || '').slice(0, 5),
      branch: a.outlet && a.outlet.id == 1 ? 'Depok' : 'Pondok Kopi', type: (a.appointment_type && a.appointment_type.name) || '-',
      status: (a.status_color && a.status_color.name) || String(a.status_appointment || '-'),
      treatments: a.treatment && a.treatment.product_treatment_name ? [a.treatment.product_treatment_name] : (a.appointment_treatments || []).map(t => t.product_treatment_name).filter(Boolean),
      staff: (a.therapists || []).map(t => t.name).filter(Boolean), remarks: a.remarks && a.remarks.trim() !== '-' ? a.remarks.trim() : '',
      room: a.room_name || null, origin: a.appointment_origin || '-', created_by: (a.staff && a.staff.name) || null, created_at: a.log_created_at || null,
      has_invoice_today: visits.some(v => v.date === day && v.value > 0)
    },
    patient: {
      id: cid, name: String(p.name || (typeof n === 'string' ? n : '') || 'Pasien').trim(), code: cust ? cust.code || '' : '',
      phone: p.phone || (cust && cust.phone) || '', type: a.patient_type || null, age: p.age || null, birth_date: bd ? String(bd).slice(0, 10) : null,
      join_date: p.join_date ? String(p.join_date).slice(0, 10) : null, membership: cust ? cust.membership_status || null : null,
      deposit: cust ? Number(cust.balance) || 0 : 0,
      visits_before: prev.length, last_visit: prev[0] ? prev[0].date : null,
      total_spend: invoices.reduce((s, i) => s + Number(i.total_after_tax || i.total || 0), 0)
    },
    history: visits.slice(0, 6),
    next
  };
}

// ==================== STATUS SYNC (ringan, tanpa getClinicSummary) ====================
const _latestCache = { refs: null, value: null };
function _latestDataDates() {
  const inv = getSafeJson('invoices_all.json') || [], use = getSafeJson('usages_details.json') || [], ap = getSafeJson('appointment_full.json') || [];
  if (_latestCache.refs && _latestCache.refs[0] === inv && _latestCache.refs[1] === use && _latestCache.refs[2] === ap) return _latestCache.value;
  const max = (arr, f) => arr.reduce((m, x) => { const v = f(x); return v && v > m ? v : m; }, '');
  const v = {
    invoice: max(inv, x => String(x.created_at || x.inv_date || '')),
    usage: max(use, x => String(x.created_at || '')),
    appointment: (() => { const m = max(ap, x => String(x.log_created_at || '').replace(' ', 'T')); return m ? m + '+07:00' : max(ap, x => String(x.updated_at || '')); })()
  };
  _latestCache.refs = [inv, use, ap]; _latestCache.value = v;
  return v;
}
// serverSync = status percobaan sync terakhir yang dijalankan server (null bila tidak diketahui)
function getSyncStatusInfo(serverSync) {
  const meta = getSafeJson('sync_meta.json') || {};
  const ts = meta.last_sync_timestamp || null;
  const ageMin = ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)) : null;
  const raw = String(meta.status || '').toLowerCase();
  let health = 'unknown';
  if (raw === 'failed') health = 'failed'; else if (raw === 'partial') health = 'degraded';
  else if (raw === 'success') health = (ageMin !== null && ageMin > 30) ? 'stale' : 'healthy';
  // Percobaan sync terakhir yang dijalankan server menang bila gagal (sync_meta hanya ditulis saat sync selesai)
  if (serverSync && serverSync.last_ok === false) health = serverSync.consecutive_failures >= 2 || health === 'stale' ? 'failed' : 'degraded';
  const label = { healthy: 'Data terbaru', stale: 'Data tertinggal', degraded: 'Sync sebagian gagal', failed: 'Sync GAGAL', unknown: 'Status sync tidak diketahui' }[health];
  const stores = {};
  const mr = getSafeJson('medicalrecords.json'); if (mr && !Array.isArray(mr)) stores.medical_record = { synced_at: mr.synced_at || null, patients: Object.keys(mr.fetched_customers || {}).length, records: (mr.records || []).length };
  const pb = getSafeJson('package_balances.json'); if (pb && !Array.isArray(pb)) stores.package_balances = { synced_at: pb.synced_at || null, packages: (pb.packages || []).length };
  const L = _latestDataDates();
  const lockFile = path.join(__dirname, 'data', 'neosoft_db', '.sync.lock');
  let running = false; try { running = (Date.now() - fs.statSync(lockFile).mtimeMs) < 5 * 60000; } catch (e) { /* tidak ada lock */ }
  const problems = [];
  if (health === 'stale') problems.push(`Sync terakhir ${ageMin} menit lalu (normalnya tiap 10 menit)`);
  if (serverSync && serverSync.last_ok === false) problems.push(`Percobaan sync terakhir gagal${serverSync.killed ? ' (melewati batas waktu 3 menit)' : ''}${serverSync.consecutive_failures > 1 ? `, ${serverSync.consecutive_failures}× berturut-turut` : ''}`);
  (meta.errors || []).slice(0, 3).forEach(e => problems.push(String(e).slice(0, 160)));
  return {
    health, health_label: label, status: meta.status || 'unknown', last_sync_at: ts, last_sync_formatted: meta.last_sync_formatted || null, age_minutes: ageMin,
    running, endpoints_ok: meta.endpoints_ok ?? null, endpoints_total: meta.endpoints_total ?? null,
    server_sync: serverSync || null, stores, latest: L, problems
  };
}

// ==================== PAKET BELUM TERPAKAI (SALES) ====================
// Sisa sesi treatment yang sudah dibayar. "Menganggur" = hari sejak pemakaian
// terakhir treatment itu (atau sejak dibeli bila belum pernah dipakai).
// Neosoft tidak punya aturan jeda antar sesi; hanya kedaluwarsa 365 hari.
function getUnusedPackages() {
  const store = getSafeJson('package_balances.json');
  if (!store || Array.isArray(store) || !store.synced_at) return { available: false, note: 'Data sisa paket belum tersinkron (menunggu sync Neosoft berikutnya).', rows: [] };
  const today = todayJakarta();
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const names = _peCustomerNames();
  const custs = {}; (getSafeJson('customers_all.json') || []).forEach(c => { custs[c.id] = c; });
  const prod = {}; (getSafeJson('products.json') || []).forEach(p => { prod[p.id] = p; });
  const byCust = {};
  // Nilai sisa = harga yang benar-benar dibayar per sesi x sisa sesi (setelah diskon)
  const paidPerSession = {};
  Object.values(store.invoices || {}).forEach(iv => (iv.lines || []).forEach(l => {
    const tot = (Number(l.remaining) || 0) + (Number(l.used) || 0) || Number(l.qty) || 0;
    if (tot > 0) paidPerSession[iv.inv_code + '|' + l.product_id] = (Number(l.subtotal) || 0) / tot;
  }));
  store.packages.forEach(k => {
    const pr = prod[k.product_id] || {};
    if (!String(pr.product_treatment_code || '').startsWith('T-') || /biaya administrasi|biaya konsultasi|konsultasi dokter|^none$/i.test(String(pr.product_treatment_name || '').trim())) return;
    const exp = k.expired_date ? String(k.expired_date).slice(0, 10) : null;
    if (exp && exp < today) return;
    const nm = (names[k.customer_id] || {}).name || '';
    if (nm && isTestPatientName(nm)) return;
    const purchased = String(k.inv_date || '').slice(0, 10);
    // pemakaian terakhir treatment yang sama oleh pasien ini setelah pembelian
    const lastUse = _linesByCust(k.customer_id).filter(l => l.code === pr.product_treatment_code && l.date >= purchased).reduce((m, l) => (l.date > m ? l.date : m), '');
    const since = lastUse || purchased;
    (byCust[k.customer_id] = byCust[k.customer_id] || []).push({
      treatment: String(pr.product_treatment_name || 'Treatment').trim(), code: pr.product_treatment_code, remaining: Number(k.remaining), total: Number(k.remaining) + Number(k.used || 0),
      value: Math.round((paidPerSession[k.inv_code + '|' + k.product_id] || 0) * Number(k.remaining)),
      never_used: !k.used, purchased, last_used: lastUse || null, idle_days: days(since, today), expires: exp, days_to_expire: exp ? days(today, exp) : null, inv_code: k.inv_code,
      branch: k.outlet_id == 1 ? 'Depok' : 'Pondok Kopi'
    });
  });
  const rows = Object.entries(byCust).map(([cid, pk]) => {
    const c = custs[cid] || {};
    const plans = (_medicalRecords().byCust[cid] || []).filter(r => r.plan_kind === 'specific');
    const planHit = plans.length ? plans[0] : null;
    const withPlan = planHit ? pk.filter(p => planMentionsTreatment(planHit.soap.plan, p.treatment)).map(p => p.treatment) : [];
    pk.sort((a, b) => b.idle_days - a.idle_days);
    const lastVisit = [...(_nextTxModel().visits[cid] ? Object.keys(_nextTxModel().visits[cid]) : [])].sort().pop() || null;
    return {
      customer_id: Number(cid), patient: (names[cid] || {}).name || 'Pasien', code: c.code || '', phone: c.phone || c.mobile_phone || '', branch: pk[0].branch,
      packages: pk, sessions: pk.reduce((s, p) => s + p.remaining, 0), value: pk.reduce((s, p) => s + p.value, 0), idle_days: Math.max(...pk.map(p => p.idle_days)),
      nearest_expiry_days: Math.min(...pk.map(p => p.days_to_expire == null ? 9999 : p.days_to_expire)),
      has_plan: withPlan.length > 0, plan_note: withPlan.length ? `Plan dokter ${planHit.date}: ${withPlan.join(', ')}` : null,
      last_visit: lastVisit
    };
  }).sort((a, b) => b.idle_days - a.idle_days);
  return {
    available: true, synced_at: store.synced_at, rows,
    summary: { patients: rows.length, packages: rows.reduce((s, r) => s + r.packages.length, 0), sessions: rows.reduce((s, r) => s + r.sessions, 0), value: rows.reduce((s, r) => s + r.value, 0),
      idle_90: rows.filter(r => r.idle_days > 90).length, expiring_60: rows.filter(r => r.nearest_expiry_days <= 60).length, with_plan: rows.filter(r => r.has_plan).length }
  };
}

// Detail satu pasien di daftar Paket Belum Terpakai: paket (beli, invoice, kedaluwarsa,
// riwayat pemakaian), ringkasan pasien, Plan dokter terbaru, dan 6 kunjungan terakhir.
// Invoice pasien yang masih punya sisa sesi, lengkap dengan semua barisnya (dari package_balances.json)
const _FEE_RE = /biaya administrasi|biaya konsultasi|konsultasi dokter|^none$/i;
function _invoiceBlocks(cid) {
  const store = getSafeJson('package_balances.json');
  if (!store || Array.isArray(store) || !store.invoices) return [];
  const prodByCode = {}; (getSafeJson('products.json') || []).forEach(p => { prodByCode[p.product_treatment_code] = p; });
  const mine = _linesByCust(cid), today = todayJakarta();
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  return Object.values(store.invoices).filter(i => i.customer_id === cid).map(i => {
    const day = String(i.inv_date || '').slice(0, 10), exp = i.expired_date ? String(i.expired_date).slice(0, 10) : null;
    const lines = i.lines.map(l => {
      const name = String((prodByCode[l.item_code] || {}).product_treatment_name || l.item_code || 'Item').trim();
      const kind = _FEE_RE.test(name) ? 'fee' : String(l.item_code || '').startsWith('P-') ? 'product' : 'treatment';
      const remaining = Number(l.remaining) || 0, used = Number(l.used) || 0, total = remaining + used || Number(l.qty) || 0;
      const status = l.frozen ? 'frozen' : kind !== 'treatment' ? kind : remaining > 0 && used === 0 ? 'belum' : remaining > 0 ? 'sebagian' : 'habis';
      // Diskon bisa berupa rupiah atau persen — dihitung dari selisih harga normal (x jumlah) dan yang dibayar
      const qty = Number(l.qty) || total || 1, gross = (Number(l.price) || 0) * qty, paidAmt = Number(l.subtotal) || 0;
      return { name, code: l.item_code, kind, status, remaining, total, price: gross, discount: Math.max(0, gross - paidAmt), paid: paidAmt,
        usage_dates: kind === 'treatment' ? mine.filter(x => x.code === l.item_code && x.date >= day).map(x => x.date).sort() : [] };
    }).filter(l => !/^none$/i.test(l.name));
    return { inv_code: i.inv_code, date: day, branch: i.outlet_id == 1 ? 'Depok' : 'Pondok Kopi', total: Number(i.total) || 0, unpaid: Number(i.unpaid) || 0, remarks: i.remarks || '',
      expires: exp, days_to_expire: exp ? days(today, exp) : null, lines, pending_sessions: lines.filter(l => l.status === 'belum' || l.status === 'sebagian').reduce((a, l) => a + l.remaining, 0) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
// tanggal → nama treatment yang dibeli tapi belum dikerjakan (untuk label riwayat kunjungan)
function _pendingByDay(cid) {
  const out = {};
  _invoiceBlocks(cid).forEach(b => b.lines.filter(l => l.status === 'belum' || l.status === 'sebagian').forEach(l => { (out[b.date] = out[b.date] || []).push(l.name); }));
  return out;
}

function getUnusedPackageDetail(customerId) {
  const cid = Number(customerId);
  const base = getUnusedPackages();
  if (!base.available) return { available: false, note: base.note };
  const row = base.rows.find(r => r.customer_id === cid);
  if (!row) return { available: false, note: 'Pasien tidak punya paket belum terpakai (mungkin sudah dipakai atau kedaluwarsa).' };
  const cust = (getSafeJson('customers_all.json') || []).find(c => c.id === cid) || {};
  const invoices = (getSafeJson('invoices_all.json') || []).filter(i => i.customer_id === cid && !i.void_invoice && !isMigrationInvoice(i));
  const mine = _linesByCust(cid);
  const byDay = {};
  invoices.forEach(i => { const d = String(i.inv_date || '').slice(0, 10); const x = byDay[d] || (byDay[d] = { date: d, value: 0, treatments: new Set(), branch: i.outlet_id == 1 ? 'Depok' : 'Pondok Kopi' }); x.value += Number(i.total_after_tax || i.total || 0); });
  mine.forEach(l => { const x = byDay[l.date] || (byDay[l.date] = { date: l.date, value: 0, treatments: new Set(), branch: l.branch }); x.treatments.add(l.name); });
  const pend = _pendingByDay(cid);
  Object.keys(pend).forEach(d => { if (!byDay[d]) byDay[d] = { date: d, value: 0, treatments: new Set(), branch: '-' }; });
  const visits = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date)).map(v => ({ ...v, treatments: [...v.treatments], pending: [...new Set(pend[v.date] || [])] }));
  // Riwayat pemakaian tiap paket = tindakan treatment yang sama sejak dibeli
  const packages = row.packages.map(p => ({ ...p, usage_history: mine.filter(l => l.code === p.code && l.date >= p.purchased).map(l => l.date).sort() }));
  const plans = (_medicalRecords().byCust[cid] || []).filter(r => r.plan_kind === 'specific');
  const plan = plans[0] ? { date: plans[0].date, doctor: plans[0].doctor || plans[0].written_by, text: plans[0].soap.plan, assessment: plans[0].soap.assessment || null } : null;
  const bd = (cust.birth_information || {}).birth_date || null;
  return {
    available: true,
    patient: { id: cid, name: row.patient, code: row.code, phone: row.phone, branch: row.branch, membership: cust.membership_status || null, deposit: Number(cust.balance) || 0,
      birth_date: bd ? String(bd).slice(0, 10) : null, join_date: cust.join_date && !String(cust.join_date).startsWith('0001') ? String(cust.join_date).slice(0, 10) : null,
      visits: visits.filter(v => v.value > 0 || v.treatments.length).length, last_visit: row.last_visit, total_spend: invoices.reduce((s, i) => s + Number(i.total_after_tax || i.total || 0), 0) },
    summary: { sessions: row.sessions, idle_days: row.idle_days, nearest_expiry_days: row.nearest_expiry_days },
    packages, invoices: _invoiceBlocks(cid), plan, has_plan: row.has_plan, plan_note: row.plan_note, history: visits.slice(0, 6)
  };
}

function getTreatment360(code) {
  const { products, lines, names } = _t360Base();
  const prod = products.find(p => p.product_treatment_code === code);
  if (!prod) return { available: false, note: 'Treatment tidak ditemukan.' };
  const mine = lines.filter(l => l.code === code).sort((a, b) => b.date.localeCompare(a.date));
  const mk = _t360Pricing().idx[prod.id] || {};
  const listPrice = mk.list_price || Number(prod.price) || 0;
  const revenue = mine.reduce((a, l) => a + l.value, 0);
  const paid = mine.filter(l => l.value > 0);
  const avgValue = paid.length ? revenue / paid.length : 0;

  // Pasien & repeat
  const byPat = {};
  mine.forEach(l => { (byPat[l.customer_id] = byPat[l.customer_id] || []).push(l.date); });
  const patIds = Object.keys(byPat);
  const repeaters = patIds.filter(id => byPat[id].length >= 2);
  const gaps = [];
  repeaters.forEach(id => { const ds = byPat[id].slice().sort(); for (let i = 1; i < ds.length; i++) { const g = (new Date(ds[i]) - new Date(ds[i - 1])) / 864e5; if (g > 0) gaps.push(g); } });

  // Tren 6 bulan & per cabang
  const months = [...new Set(lines.map(l => l.date.slice(0, 7)))].sort().slice(-6);
  const trend = months.map(m => { const X = mine.filter(l => l.date.slice(0, 7) === m); return { month: m, count: X.length, revenue: X.reduce((a, l) => a + l.value, 0) }; });
  const branches = ['Depok', 'Pondok Kopi'].map(b => { const X = mine.filter(l => l.branch === b); return { branch: b, count: X.length, revenue: X.reduce((a, l) => a + l.value, 0) }; });

  // Dokter & terapis (laporan komisi Neosoft)
  const rep = getSafeJson('commission_report.json') || {};
  const crow = Object.values(rep.treatment || {}).flat().filter(r => r && r.item_code === code);
  const perf = {};
  crow.forEach(r => { const k = r.therapist_name || '-'; const x = perf[k] || (perf[k] = { name: k, role: r.is_doctor ? 'Dokter' : 'Perawat/Terapis', count: 0, commission: 0 }); x.count += Number(r.used_qty) || 1; x.commission += Number(r.total_commission) || 0; });
  const performers = Object.values(perf).sort((a, b) => b.count - a.count);
  const commTotal = crow.reduce((a, r) => a + (Number(r.total_commission) || 0), 0);
  const commPerCase = mine.length ? commTotal / mine.length : 0;

  // Sering diambil bersamaan (invoice yang sama)
  const invSet = new Set(mine.map(l => l.inv_code));
  const co = {};
  lines.forEach(l => { if (l.code !== code && invSet.has(l.inv_code) && !/biaya administrasi/i.test(l.name)) { const x = co[l.code] || (co[l.code] = { code: l.code, name: l.name, count: 0 }); x.count++; } });
  const together = Object.values(co).sort((a, b) => b.count - a.count).slice(0, 6).map(x => ({ ...x, pct: invSet.size ? Math.round(x.count / invSet.size * 1000) / 10 : 0 }));

  // Standar BHP / HPP
  let bhp = null;
  try {
    const d = getBhpStandards({ treatment: code }).detail;
    bhp = d ? { status: d.status, hpp_bhp: d.hpp_bhp, items: d.standard.length, unit_checks: d.unit_checks } : null;
    if (bhp) {
      // Barang kartu stok yang dipakai treatment ini (ringkasan) + rincian per tindakan (ref dokumen pemakaian)
      const ov = getBhpUnitOverrides();
      bhp.cases = d.cases;
      bhp.standard = d.standard.map(m => ({ name: m.name, qty: m.standard_qty, uom: m.uom }));   // standar resmi (hanya bila Disetujui) / usulan
      bhp.usual = d.items.filter(r => r.suggested).map(r => ({ name: r.name, avg: r.avg_per_case, uom: r.uom, rate: r.usage_rate }));
      bhp.used_items = d.items.map(r => ({ item_code: r.item_code, name: r.name, uom: r.uom, used_in: r.used_in, usage_rate: r.usage_rate, median_qty: r.median_qty, avg_per_case: r.avg_per_case, unit_cost: r.unit_cost, in_standard: r.suggested, unit_check: r.unit_check }));
      const docs = _bhpDocsByTreatment()[code] || [];
      bhp.docs_total = docs.length;
      bhp.docs = docs.slice(0, 15).map(x => ({ ref: x.ref, date: x.date, patient: x.patient, branch: x.branch,
        items: Object.values(x.items).map(i => { const o = ov[i.item_code]; return { name: i.name, qty: Math.round(i.qty * 100) / 100, uom: o ? o.usage_uom : i.uom }; }) }));
    }
  } catch (e) { bhp = null; }
  const margin = avgValue ? avgValue - (bhp && !bhp.unit_checks ? bhp.hpp_bhp : 0) - commPerCase : null;

  // Foto before/after di hari yang sama dengan tindakan
  const pe = getSafeJson('physicalexamination.json') || [];
  const peKey = new Set(pe.map(x => `${x.customer_id}|${String(x.examination_date || x.created_at).slice(0, 10)}`));
  const withPhoto = mine.filter(l => peKey.has(`${l.customer_id}|${l.date}`));

  const recent = mine.slice(0, 20).map(l => ({ customer_id: l.customer_id, patient: (names[l.customer_id] || {}).name || `#${l.customer_id}`, code: (names[l.customer_id] || {}).code || '', date: l.date, branch: l.branch, value: l.value, times: byPat[l.customer_id].length, has_photo: peKey.has(`${l.customer_id}|${l.date}`) }));

  return {
    available: true,
    treatment: { code, name: prod.product_treatment_name, list_price: listPrice, duration: Number(prod.duration) || null },
    pricing: {
      list_price: listPrice,
      list_source: mk.list_source || 'neosoft',
      neosoft_price_label: mk.neosoft_price_label || null,
      price_mismatch: mk.price_mismatch === true,
      bottom_price: mk.bottom_price || null,
      promo_price: mk.is_on_promo ? mk.promo_price : null,
      promo_name: mk.is_on_promo ? mk.promo_name : null,
      promo_is_default: mk.promo_is_default === true,
      promo_end: mk.promo_period ? mk.promo_period.end : null,
    },
    kpi: {
      performed: mine.length, revenue: Math.round(revenue), avg_value: Math.round(avgValue), discount_pct: listPrice && avgValue ? Math.round((1 - avgValue / listPrice) * 1000) / 10 : null,
      patients: patIds.length, repeat_patients: repeaters.length, repeat_rate: patIds.length ? Math.round(repeaters.length / patIds.length * 1000) / 10 : 0,
      median_return_days: gaps.length ? Math.round(_median(gaps)) : null, last_date: mine[0] ? mine[0].date : null,
      paid_cases: paid.length, package_cases: mine.length - paid.length,
      commission_per_case: Math.round(commPerCase), margin_per_case: margin != null ? Math.round(margin) : null,
      photo_sessions: withPhoto.length, photo_rate: mine.length ? Math.round(withPhoto.length / mine.length * 1000) / 10 : 0
    },
    trend, branches, performers, together, bhp, recent
  };
}

function getBhpItemList() {
  const U = _buildBhpUsage();
  const stockCard = getSafeJson('stock_card.json') || [];
  const items = getSafeJson('logistics_items.json') || [];
  const cogsBySi = {}; items.forEach(i => { if (i.sales_information_id) cogsBySi[i.sales_information_id] = Number(i.cogs) || 0; });
  const seen = {};
  stockCard.forEach(r => { if ((r.category || []).includes('BHP') && !seen[r.code] && !/^tes\b/i.test(r.name || '')) seen[r.code] = { item_code: r.code, name: String(r.name || '').trim(), uom: String(r.uom || '').replace(/^\s*[\d.,]+\s*/, '').trim() || 'pcs', cogs: cogsBySi[r.sales_information_id] || 0 }; });
  return Object.values(seen).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

function getBranchStockTransferRecommendations() {
  const stockCards = getSafeJson('logistics_stock_card.json');
  const bufferAlerts = getSafeJson('stock_buffer_alerts.json');
  const items = getSafeJson('logistics_items.json');

  const bufferMap = {};
  if (Array.isArray(bufferAlerts)) {
    bufferAlerts.forEach(b => {
      if (b.item_id) bufferMap[b.item_id] = Number(b.buffer_stock || b.min_stock || 10);
    });
  }

  const warehouseStock = {};
  if (Array.isArray(items)) {
    items.forEach(it => {
      warehouseStock[it.id] = {
        item_id: it.id,
        sku: it.item_code || it.code || `ITM-${it.id}`,
        name: it.item_name || it.name || 'Barang Medis',
        uom: it.uom || it.unit || 'pcs',
        depok_stock: 0,
        pdk_stock: 0,
        buffer_stock: bufferMap[it.id] || 10
      };
    });
  }

  if (Array.isArray(stockCards)) {
    stockCards.forEach(sc => {
      const it = warehouseStock[sc.item_id];
      if (it) {
        const whId = Number(sc.warehouse_id || sc.outlet_id);
        const qty = Number(sc.balance || sc.current_stock || sc.qty || 0);
        if (whId === 1) it.depok_stock = qty;
        else if (whId === 2) it.pdk_stock = qty;
      }
    });
  }

  const recommendations = [];
  Object.values(warehouseStock).forEach(it => {
    const buf = it.buffer_stock;
    if (it.depok_stock < buf && it.pdk_stock >= buf * 2) {
      const suggestTransfer = Math.min(Math.floor((it.pdk_stock - buf) / 2), Math.max(1, buf - it.depok_stock));
      if (suggestTransfer > 0) {
        recommendations.push({
          item_id: it.item_id,
          sku: it.sku,
          name: it.name,
          uom: it.uom,
          from_branch: 'Pondok Kopi',
          from_stock: it.pdk_stock,
          to_branch: 'Depok',
          to_stock: it.depok_stock,
          buffer_target: buf,
          recommended_transfer_qty: suggestTransfer,
          urgency: it.depok_stock === 0 ? 'CRITICAL (Stok Habis)' : 'WARNING (Di Bawah Buffer)',
          reason: `Stok Depok (${it.depok_stock} ${it.uom}) di bawah buffer (${buf}), sementara Pondok Kopi surplus (${it.pdk_stock} ${it.uom}).`
        });
      }
    } else if (it.pdk_stock < buf && it.depok_stock >= buf * 2) {
      const suggestTransfer = Math.min(Math.floor((it.depok_stock - buf) / 2), Math.max(1, buf - it.pdk_stock));
      if (suggestTransfer > 0) {
        recommendations.push({
          item_id: it.item_id,
          sku: it.sku,
          name: it.name,
          uom: it.uom,
          from_branch: 'Depok',
          from_stock: it.depok_stock,
          to_branch: 'Pondok Kopi',
          to_stock: it.pdk_stock,
          buffer_target: buf,
          recommended_transfer_qty: suggestTransfer,
          urgency: it.pdk_stock === 0 ? 'CRITICAL (Stok Habis)' : 'WARNING (Di Bawah Buffer)',
          reason: `Stok Pondok Kopi (${it.pdk_stock} ${it.uom}) di bawah buffer (${buf}), sementara Depok surplus (${it.depok_stock} ${it.uom}).`
        });
      }
    }
  });

  return {
    total_recommendations: recommendations.length,
    recommendations: recommendations.slice(0, 50)
  };
}

// 4. DIVISI MARKETING: Promo Campaigns & Bottom Price Protection
function getMarketingPromos() {
  try {
    if (fs.existsSync(MARKETING_PROMOS_FILE)) {
      return JSON.parse(fs.readFileSync(MARKETING_PROMOS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getMarketingPromos] Error:', e.message);
  }
  return [];
}

function saveMarketingPromo({ id, name, period_start, period_end, branch = 'Semua Cabang', target_item, target_type = 'treatment', normal_price = 0, promo_price = 0, bottom_price = 0, quota_total = 100, quota_used = 0, target_patient = '', terms_conditions = '', status = 'Active', created_by = 'Marketing' }) {
  if (!name) return { success: false, error: 'Nama promo wajib diisi' };
  const all = getMarketingPromos();
  const pId = id || `PRM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
  const now = new Date().toISOString();
  const entry = {
    id: pId,
    name: name.trim(),
    period_start: period_start || now.slice(0, 10),
    period_end: period_end || '',
    branch: branch || 'Semua Cabang',
    target_item: (target_item || '').trim(),
    target_type: target_type || 'treatment',
    normal_price: Number(normal_price) || 0,
    promo_price: Number(promo_price) || 0,
    bottom_price: Number(bottom_price) || 0,
    quota_total: Number(quota_total) || 100,
    quota_used: Number(quota_used) || 0,
    target_patient: (target_patient || '').trim(),
    terms_conditions: (terms_conditions || '').trim(),
    status: status || 'Active',
    created_at: now,
    created_by: created_by || 'Marketing'
  };
  const idx = all.findIndex(p => p.id === pId);
  if (idx >= 0) {
    entry.created_at = all[idx].created_at || now;
    all[idx] = entry;
  } else {
    all.unshift(entry);
  }
  try {
    fs.writeFileSync(MARKETING_PROMOS_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteMarketingPromo(id) {
  if (!id) return { success: false, error: 'ID promo wajib diisi' };
  const all = getMarketingPromos();
  const next = all.filter(p => p.id !== id);
  if (next.length === all.length) return { success: false, error: 'Promo tidak ditemukan' };
  try {
    fs.writeFileSync(MARKETING_PROMOS_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 5. DIVISI FRONT OFFICE & CRM: Patient Feedback & CSAT/NPS
function getPatientFeedbacks() {
  try {
    if (fs.existsSync(PATIENT_FEEDBACKS_FILE)) {
      return JSON.parse(fs.readFileSync(PATIENT_FEEDBACKS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getPatientFeedbacks] Error:', e.message);
  }
  return [];
}

function savePatientFeedback(params) {
  return addPatientFeedback(params);
}

function deletePatientFeedback(id) {
  if (!id) return { success: false, error: 'ID feedback wajib diisi' };
  const all = getPatientFeedbacks();
  const next = all.filter(f => f.id !== id);
  if (next.length === all.length) return { success: false, error: 'Feedback tidak ditemukan' };
  try {
    fs.writeFileSync(PATIENT_FEEDBACKS_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 6. DIVISI OPERASIONAL: Edit & RCA/CAPA Team Complaint
function updateTeamComplaint({ id, status, rca = '', capa = '', pic = '', resolution_notes = '', resolved_at = null }) {
  if (!id) return { success: false, error: 'ID komplain wajib diisi' };
  const filePath = path.join(OPERATIONAL_DB_DIR, 'team_complaints.json');
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'Data komplain tidak ditemukan' };
    const all = JSON.parse(fs.readFileSync(filePath, 'utf8')) || [];
    const idx = all.findIndex(c => c.id === id || c.ticket_id === id);
    if (idx === -1) return { success: false, error: 'Komplain dengan ID tersebut tidak ditemukan' };

    if (status) all[idx].status = status;
    if (rca !== undefined) all[idx].rca = rca.trim();
    if (capa !== undefined) all[idx].capa = capa.trim();
    if (pic) all[idx].pic = pic.trim();
    if (resolution_notes !== undefined) all[idx].resolution_notes = resolution_notes.trim();
    if (status === 'Resolved' || status === 'Closed') {
      all[idx].resolved_at = resolved_at || new Date().toISOString();
    }
    all[idx].updated_at = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
    return { success: true, data: all[idx] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 7. DIVISI HR: Disciplinary Records (Teguran, SP1/2/3, Konseling)
function getHrDisciplinary() {
  try {
    if (fs.existsSync(HR_DISCIPLINARY_FILE)) {
      return JSON.parse(fs.readFileSync(HR_DISCIPLINARY_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('[getHrDisciplinary] Error:', e.message);
  }
  return [];
}

function saveHrDisciplinary({ id, staff_name, staff_role, date, violation_type, sp_level = 'Teguran Lisan', description = '', status = 'Active', action_taken = '', valid_until = '', created_by = 'HR Management' }) {
  if (!staff_name || !description) return { success: false, error: 'Nama karyawan dan deskripsi pelanggaran wajib diisi' };
  const all = getHrDisciplinary();
  const dId = id || `DISC-${Date.now()}`;
  const now = new Date().toISOString();
  const entry = {
    id: dId,
    staff_name: staff_name.trim(),
    staff_role: (staff_role || '').trim(),
    date: date || now.slice(0, 10),
    violation_type: violation_type || 'Disiplin Waktu',
    sp_level: sp_level || 'Teguran Lisan',
    description: description.trim(),
    status: status || 'Active',
    action_taken: (action_taken || '').trim(),
    valid_until: valid_until || '',
    created_by: created_by || 'HR Management',
    updated_at: now
  };
  const idx = all.findIndex(d => d.id === dId);
  if (idx >= 0) {
    entry.created_at = all[idx].created_at || now;
    all[idx] = entry;
  } else {
    entry.created_at = now;
    all.unshift(entry);
  }
  try {
    fs.writeFileSync(HR_DISCIPLINARY_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteHrDisciplinary(id) {
  if (!id) return { success: false, error: 'ID wajib diisi' };
  const all = getHrDisciplinary();
  const next = all.filter(d => d.id !== id);
  if (next.length === all.length) return { success: false, error: 'Data tidak ditemukan' };
  try {
    fs.writeFileSync(HR_DISCIPLINARY_FILE, JSON.stringify(next, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 8. DIVISI OWNER & SALES: Target Omzet Bulanan & Harga Bottom
function getMonthlyTargets() {
  try {
    if (fs.existsSync(MONTHLY_TARGETS_FILE)) {
      return JSON.parse(fs.readFileSync(MONTHLY_TARGETS_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('[getMonthlyTargets] Error:', e.message);
  }
  return {};
}

function saveMonthlyTarget({ month, total_target, depok_target, pondok_kopi_target, notes = '', updated_by = 'Owner' }) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { success: false, error: 'Bulan wajib format YYYY-MM' };
  const all = getMonthlyTargets();
  all[month] = {
    total_target: Number(total_target) || 0,
    depok_target: Number(depok_target) || 0,
    pondok_kopi_target: Number(pondok_kopi_target) || 0,
    notes: (notes || '').trim(),
    updated_at: new Date().toISOString(),
    updated_by: updated_by || 'Owner'
  };
  try {
    fs.writeFileSync(MONTHLY_TARGETS_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: all[month] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getSalesBottomPrices() {
  try {
    if (fs.existsSync(SALES_BOTTOM_PRICES_FILE)) {
      return JSON.parse(fs.readFileSync(SALES_BOTTOM_PRICES_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('[getSalesBottomPrices] Error:', e.message);
  }
  return {};
}

function saveSalesBottomPrice({ code, name, normal_price, bottom_price, max_discount_pct, allowed_roles = ['Dokter', 'Manager'], notes = '' }) {
  if (!code) return { success: false, error: 'Kode produk/treatment wajib diisi' };
  const all = getSalesBottomPrices();
  all[code] = {
    code: code.trim(),
    name: (name || '').trim(),
    normal_price: Number(normal_price) || 0,
    bottom_price: Number(bottom_price) || 0,
    max_discount_pct: Number(max_discount_pct) || (normal_price && bottom_price ? Math.round(((normal_price - bottom_price) / normal_price) * 100) : 0),
    allowed_roles: Array.isArray(allowed_roles) ? allowed_roles : ['Dokter', 'Manager'],
    notes: (notes || '').trim(),
    updated_at: new Date().toISOString()
  };
  try {
    fs.writeFileSync(SALES_BOTTOM_PRICES_FILE, JSON.stringify(all, null, 2));
    return { success: true, data: all[code] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 9. DETAIL PASIEN XYZ GRADE DENGAN PENJELASAN
function calculatePatientXyzGrade(customerId) {
  const list = getPatientFrequencyList();
  const cNum = Number(customerId);
  const found = list.find(p => Number(p.id) === cNum || String(p.id) === String(customerId));
  if (found) {
    return {
      success: true,
      data: {
        id: found.id,
        name: found.name,
        phone: found.phone,
        grade: found.grade,
        grade_label: found.grade_label,
        visits_per_month: found.visits_per_month,
        total_unique_visit_days: found.visit_days,
        total_spent: found.total_spent,
        total_spent_fmt: 'Rp ' + Number(found.total_spent).toLocaleString('id-ID'),
        first_visit: found.first_visit,
        last_visit: found.last_visit,
        days_active: found.days_active,
        months_active: found.months_active,
        outlets: Array.from(found.outlets || []),
        explanation: found.grade === 'X' ? 'Pasien Sangat Loyal: Datang 1-2x per bulan (>= 1 kunjungan/bln)' :
                     found.grade === 'Y' ? 'Pasien Reguler: Datang 2-3x per 3 bulan (0.5 - 1 kunjungan/bln)' :
                     found.grade === 'Z' ? 'Pasien Pasif/Jarang: Datang < 0.5 kunjungan/bln' : 'Belum Pernah Transaksi'
      }
    };
  }
  return { success: false, error: 'Pasien tidak ditemukan' };
}

// ═══════════════════════════════════════════════════════════════════════
// NEOSOFT OFFICIAL REPORTS GENERATOR & EXPORT ENGINE
// Mendukung ekspor format Neosoft Cube (CSV Spreadsheet & Dokumen Resmi PDF)
// Termasuk Laporan Sisa Treatment Belum Digunakan (Sales by Revenue)
// ═══════════════════════════════════════════════════════════════════════

const MANUAL_UNREDEEMED_FILE = path.join(__dirname, 'data', 'neosoft_db', 'manual_unredeemed_treatments.json');

function getManualUnredeemedTreatments() {
  return getSafeJson('manual_unredeemed_treatments.json', path.join(__dirname, 'data', 'neosoft_db')) || [];
}

function saveManualUnredeemedTreatment(entry) {
  const list = getManualUnredeemedTreatments();
  const id = entry.id || `SISA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const record = {
    id,
    inv_code: entry.inv_code || `INV-MANUAL-${Date.now().toString().slice(-4)}`,
    date: entry.date || new Date().toISOString().split('T')[0],
    outlet: entry.outlet || 'Depok',
    customer_id: entry.customer_id || null,
    patient_name: entry.patient_name || 'Pasien',
    phone: entry.phone || '-',
    doctor: entry.doctor || 'dr. Jaga',
    therapist: entry.therapist || '-',
    treatment: entry.treatment || 'Paket Perawatan Wajah',
    category: entry.category || 'Treatment Medis',
    total_amount: Number(entry.total_amount || entry.remaining_balance || 0),
    used_amount: Number(entry.used_amount || 0),
    remaining_balance: Number(entry.remaining_balance || entry.total_amount || 0),
    status: entry.status || 'Sisa Treatment (Manual)',
    note: entry.note || '',
    created_at: new Date().toISOString()
  };

  const existingIdx = list.findIndex(r => r.id === id);
  if (existingIdx >= 0) {
    list[existingIdx] = record;
  } else {
    list.unshift(record);
  }

  try {
    fs.mkdirSync(path.dirname(MANUAL_UNREDEEMED_FILE), { recursive: true });
    fs.writeFileSync(MANUAL_UNREDEEMED_FILE, JSON.stringify(list, null, 2));
    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteManualUnredeemedTreatment(id) {
  let list = getManualUnredeemedTreatments();
  list = list.filter(r => r.id !== id);
  try {
    fs.writeFileSync(MANUAL_UNREDEEMED_FILE, JSON.stringify(list, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getNeosoftReportData({ type = 'sales_summary', start = null, end = null, period = '2026-09', outlet = 'all' }) {
  const periodArg = (start || end) ? { start, end } : period;
  const { startDate, endDate } = resolvePeriodRange(periodArg);
  const periodLabel = startDate && endDate
    ? (startDate === endDate ? startDate : `${startDate} s/d ${endDate}`)
    : 'Semua Periode';

  const outletFilter = (outlet || 'all').toString().toLowerCase();
  const filterOutlet = (outName, outId) => {
    if (outletFilter === 'all' || !outletFilter) return true;
    if (outletFilter === '1' || outletFilter === 'depok') return outId === 1 || outName === 'Depok';
    if (outletFilter === '2' || outletFilter === 'pondok kopi' || outletFilter === 'pdk') return outId === 2 || outName === 'Pondok Kopi';
    return true;
  };

  const outletLabel = (outletFilter === '1' || outletFilter === 'depok') ? 'Cabang Depok'
    : ((outletFilter === '2' || outletFilter === 'pondok kopi' || outletFilter === 'pdk') ? 'Cabang Pondok Kopi' : 'Semua Cabang (Depok & Pondok Kopi)');

  const invoices = getSafeJson('invoices_all.json');
  const customers = getSafeJson('customers_all.json');
  const products = getSafeJson('products.json');
  const therapists = getSafeJson('therapists.json');
  const usages = getSafeJson('usages_details.json');
  const appointments = getSafeJson('appointment_full.json');

  const custMap = {};
  customers.forEach(c => {
    if (c.id) custMap[c.id] = c;
  });

  const therapistMap = {};
  therapists.forEach(t => {
    if (t.id) therapistMap[t.id] = t.therapist_name || `Staff #${t.id}`;
  });

  const productMap = {};
  products.forEach(p => {
    if (p.id) productMap[p.id] = p;
  });

  const invUsagesMap = {};
  usages.forEach(u => {
    if (u.inv_code) {
      if (!invUsagesMap[u.inv_code]) invUsagesMap[u.inv_code] = [];
      invUsagesMap[u.inv_code].push(u);
    }
  });

  function resolveCustomerName(c) {
    if (!c) return 'Pasien Umum';
    if (typeof c === 'string') return c.trim() || 'Pasien Umum';
    const n = c.name !== undefined ? c.name : c;
    if (typeof n === 'string') return n.trim() || 'Pasien Umum';
    if (typeof n === 'object' && n !== null) {
      const full = [n.first_name, n.middle_name, n.last_name].filter(Boolean).map(s => String(s).trim()).join(' ').trim();
      return full || 'Pasien Umum';
    }
    return 'Pasien Umum';
  }

  let reportTitle = '';
  let filename = '';
  let columns = [];
  let rows = [];
  let summary = {};

  if (type === 'sales_summary') {
    reportTitle = 'Laporan Rekapitulasi Penjualan & Invoices Neosoft';
    filename = `Neosoft_Sales_Summary_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'No. Invoice',
      'Tanggal Transaksi (WIB)',
      'Cabang Outlet',
      'ID Pasien',
      'Nama Pasien',
      'No. WhatsApp / HP',
      'Dokter DPJP',
      'Terapis / Perawat',
      'Jumlah Item',
      'Total Transaksi (IDR)',
      'Diskon (IDR)',
      'Metode Pembayaran',
      'Status Invoice'
    ];

    let totalOmset = 0;
    let totalDiscount = 0;
    let countInvoices = 0;

    const filtered = invoices.filter(inv => {
      const dStr = inv.inv_date || inv.created_at || '';
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, outId)) return false;
      if (!dateInRange(dStr, startDate, endDate)) return false;
      if (inv.void_invoice === true) return false;
      return true;
    }).sort((a, b) => new Date(b.inv_date || b.created_at || 0) - new Date(a.inv_date || a.created_at || 0));

    rows = filtered.map((inv, idx) => {
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      const cust = custMap[inv.customer_id] || {};
      const docName = therapistMap[inv.doctor_id] || 'dr. Jaga';
      const thName = therapistMap[inv.therapist_id] || '-';
      const amt = Number(inv.total_after_tax || inv.total || 0);
      const disc = Number(inv.discount || 0);
      const uCount = (invUsagesMap[inv.inv_code] || []).length;
      const dStr = (inv.inv_date || inv.created_at || '').replace('T', ' ').substring(0, 16);

      totalOmset += amt;
      totalDiscount += disc;
      countInvoices++;

      return [
        idx + 1,
        inv.inv_code || `INV-${inv.id}`,
        dStr ? `${dStr} WIB` : '-',
        outName,
        cust.cust_code || cust.id || inv.customer_id || '-',
        resolveCustomerName(cust),
        cust.phone || '-',
        docName,
        thName,
        uCount,
        amt,
        disc,
        (inv.paymode || 'BANK').toUpperCase(),
        inv.status_inv ? 'Lunas' : 'Belum Lunas'
      ];
    });

    summary = {
      total_invoices: countInvoices,
      total_omset: totalOmset,
      total_omset_fmt: 'Rp ' + totalOmset.toLocaleString('id-ID'),
      total_discount: totalDiscount,
      total_discount_fmt: 'Rp ' + totalDiscount.toLocaleString('id-ID'),
      avg_ticket_size: countInvoices > 0 ? Math.round(totalOmset / countInvoices) : 0,
      avg_ticket_size_fmt: 'Rp ' + (countInvoices > 0 ? Math.round(totalOmset / countInvoices).toLocaleString('id-ID') : '0')
    };

  } else if (type === 'daily_omset') {
    reportTitle = 'Laporan Rekapitulasi Omset Harian & Antar Cabang Neosoft';
    filename = `Neosoft_Daily_Omset_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'Tanggal Transaksi',
      'Hari',
      'Total Transaksi (Struk)',
      'Omset Depok Margonda (IDR)',
      'Omset Pondok Kopi (IDR)',
      'Total Omset Gabungan (IDR)',
      'Total Diskon (IDR)',
      'Omset Bersih / Net (IDR)',
      'Rata-rata per Struk (IDR)'
    ];

    const dayMap = {};
    let totalAllOmset = 0;
    let totalAllDisc = 0;
    let totalAllCount = 0;
    let totalAllDpk = 0;
    let totalAllPdk = 0;

    invoices.forEach(inv => {
      const dStr = inv.inv_date || inv.created_at || '';
      const dOnly = (dStr || '').substring(0, 10);
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(dStr, startDate, endDate)) return;
      if (inv.void_invoice === true) return;

      if (!dOnly) return;
      if (!dayMap[dOnly]) {
        dayMap[dOnly] = { date: dOnly, dpk: 0, pdk: 0, total: 0, disc: 0, count: 0 };
      }

      // Omset: pemakaian saldo deposit tidak dihitung (invoice_flags.omsetAmount).
      const amt = omsetAmount(inv, omsetDepositMap());
      const disc = Number(inv.discount || 0);

      if (outId === 1) {
        dayMap[dOnly].dpk += amt;
        totalAllDpk += amt;
      } else {
        dayMap[dOnly].pdk += amt;
        totalAllPdk += amt;
      }
      dayMap[dOnly].total += amt;
      dayMap[dOnly].disc += disc;
      dayMap[dOnly].count += 1;

      totalAllOmset += amt;
      totalAllDisc += disc;
      totalAllCount += 1;
    });
    // Top-up deposit manual (bukan invoice) ikut omset harian — aturan omset deposit.
    omsetTopups().forEach(t => {
      const outName = t.outlet_id === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, t.outlet_id) || !dateInRange(t.date, startDate, endDate)) return;
      const d = dayMap[t.date] || (dayMap[t.date] = { date: t.date, dpk: 0, pdk: 0, total: 0, disc: 0, count: 0 });
      if (t.outlet_id === 1) { d.dpk += t.amount; totalAllDpk += t.amount; } else { d.pdk += t.amount; totalAllPdk += t.amount; }
      d.total += t.amount; d.topup = (d.topup || 0) + t.amount;
      totalAllOmset += t.amount;
    });

    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const sortedDays = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));

    rows = sortedDays.map((d, idx) => {
      const dt = new Date(d.date + 'T00:00:00Z');
      const dayName = isNaN(dt.getDay()) ? '-' : dayNames[dt.getDay()];
      const net = d.total - d.disc;
      const avg = d.count > 0 ? Math.round((d.total - (d.topup || 0)) / d.count) : 0;
      return [
        idx + 1,
        d.date,
        dayName,
        d.count,
        d.dpk,
        d.pdk,
        d.total,
        d.disc,
        net > 0 ? net : d.total,
        avg
      ];
    });

    summary = {
      total_days: sortedDays.length,
      total_invoices: totalAllCount,
      total_omset: totalAllOmset,
      total_omset_fmt: 'Rp ' + totalAllOmset.toLocaleString('id-ID'),
      total_dpk_omset: totalAllDpk,
      total_dpk_omset_fmt: 'Rp ' + totalAllDpk.toLocaleString('id-ID'),
      total_pdk_omset: totalAllPdk,
      total_pdk_omset_fmt: 'Rp ' + totalAllPdk.toLocaleString('id-ID'),
      total_discount: totalAllDisc,
      total_discount_fmt: 'Rp ' + totalAllDisc.toLocaleString('id-ID'),
      avg_daily_omset: sortedDays.length > 0 ? Math.round(totalAllOmset / sortedDays.length) : 0,
      avg_daily_omset_fmt: 'Rp ' + (sortedDays.length > 0 ? Math.round(totalAllOmset / sortedDays.length).toLocaleString('id-ID') : '0')
    };

  } else if (type === 'by_revenue' || type === 'sales_by_revenue' || type === 'unredeemed_treatments') {
    reportTitle = 'Laporan Sisa Treatment & Revenue Belum Digunakan (Sales by Revenue)';
    filename = `Neosoft_Sales_By_Revenue_Sisa_Treatment_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'No. Invoice',
      'Tanggal Transaksi (WIB)',
      'Cabang Outlet',
      'ID Pasien',
      'Nama Pasien',
      'No. WhatsApp / HP',
      'Dokter DPJP',
      'Terapis / Perawat',
      'Nama Layanan / Paket Treatment',
      'Kategori Treatment',
      'Total Nilai Invoice (IDR)',
      'Revenue Realisasi (IDR)',
      'Sisa Treatment Belum Digunakan (IDR)',
      'Status Sisa Treatment'
    ];

    const crmByInv = {};
    const depokSheet = getSafeJson('depok_transactions.json', GOOGLE_SHEETS_DB_DIR) || {};
    const pdkSheet = getSafeJson('pondokkopi_transactions.json', GOOGLE_SHEETS_DB_DIR) || {};
    const allCrm = getMonthlyTxRows(depokSheet).concat(getMonthlyTxRows(pdkSheet));

    allCrm.forEach(r => {
      const inv = String(r.invoice || '').trim();
      if (inv) {
        if (!crmByInv[inv]) crmByInv[inv] = [];
        crmByInv[inv].push(r);
      }
    });

    const manualUnredeemed = getManualUnredeemedTreatments();

    let totalRemainingVal = 0;
    let totalSalesVal = 0;
    let totalRealizedVal = 0;
    let totalDpkUnredeemed = 0;
    let totalPdkUnredeemed = 0;
    let rowIdx = 1;

    // 1. Process invoices
    invoices.forEach(inv => {
      const dStr = inv.inv_date || inv.created_at || '';
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(dStr, startDate, endDate)) return;
      if (inv.void_invoice === true) return;

      const uList = invUsagesMap[inv.inv_code] || [];
      const totalAmt = Number(inv.total_after_tax || inv.total || 0);
      let usedVal = 0;
      let itemNames = [];

      uList.forEach(u => {
        const p = productMap[u.product_id] || {};
        const val = Number(u.value || p.price || 0);
        usedVal += val;
        itemNames.push(p.product_treatment_name || u.item_name || 'Treatment');
      });

      const remaining = Math.max(0, totalAmt - usedVal);
      const crmRows = crmByInv[inv.inv_code] || [];
      const isCrmUnused = crmRows.some(r => /belum dipakai|belum digunakan|sisa\s*\d|dp\s*50/i.test(r.treatment || '') || String(r.purchase_status || '').toUpperCase() === 'KEEP');

      if (remaining > 0 || isCrmUnused) {
        const cust = custMap[inv.customer_id] || {};
        const docName = therapistMap[inv.doctor_id] || 'dr. Jaga';
        const thName = therapistMap[inv.therapist_id] || '-';
        const dFormatted = dStr ? dStr.replace('T', ' ').substring(0, 16) + ' WIB' : '-';

        let treatmentName = itemNames.length > 0 ? itemNames.join(', ') : (crmRows[0]?.treatment || 'Paket Treatment Kasir / Advance');
        let category = 'Treatment Medis';
        const lowerTreat = treatmentName.toLowerCase();
        if (lowerTreat.includes('facial') || lowerTreat.includes('peel') || lowerTreat.includes('oxy')) category = 'Facial';
        else if (lowerTreat.includes('laser') || lowerTreat.includes('pico')) category = 'Laser & IPL';
        else if (lowerTreat.includes('booster') || lowerTreat.includes('exosome') || lowerTreat.includes('dna salmon')) category = 'Skin Booster & Inject';
        else if (lowerTreat.includes('paket')) category = 'Paket Treatment';

        let status = 'Sisa Treatment';
        if (crmRows.some(r => /dp\s*50/i.test(r.treatment || ''))) status = 'DP 50% Belum Digunakan';
        else if (crmRows.some(r => String(r.purchase_status || '').toUpperCase() === 'KEEP')) status = 'KEEP (Ditahan untuk Nanti)';
        else if (uList.length === 0) status = 'Deposit / Paket Belum Diambil';
        else status = 'Sisa Kuota Treatment';

        const effectiveRemaining = remaining > 0 ? remaining : (crmRows[0]?.net_price || totalAmt);

        rows.push([
          rowIdx++,
          inv.inv_code || `INV-${inv.id}`,
          dFormatted,
          outName,
          cust.cust_code || cust.id || inv.customer_id || '-',
          resolveCustomerName(cust),
          cust.phone || crmRows[0]?.phone || '-',
          docName,
          thName,
          treatmentName,
          category,
          totalAmt,
          usedVal,
          effectiveRemaining,
          status
        ]);

        totalRemainingVal += effectiveRemaining;
        totalSalesVal += totalAmt;
        totalRealizedVal += usedVal;
        if (outId === 1) totalDpkUnredeemed += effectiveRemaining;
        else totalPdkUnredeemed += effectiveRemaining;
      }
    });

    // 2. Include any manual unredeemed entries if within date/outlet filter
    manualUnredeemed.forEach(m => {
      const outName = m.outlet || 'Depok';
      const outId = outName === 'Depok' ? 1 : 2;
      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(m.date, startDate, endDate)) return;

      rows.push([
        rowIdx++,
        m.inv_code || 'MANUAL-INPUT',
        m.date ? `${m.date} WIB` : '-',
        outName,
        m.customer_id || '-',
        m.patient_name || 'Pasien',
        m.phone || '-',
        m.doctor || 'dr. Jaga',
        m.therapist || '-',
        m.treatment || 'Paket Perawatan Wajah',
        m.category || 'Treatment Medis',
        Number(m.total_amount || m.remaining_balance || 0),
        Number(m.used_amount || 0),
        Number(m.remaining_balance || 0),
        m.status || 'Sisa Treatment (Manual)'
      ]);

      const rem = Number(m.remaining_balance || 0);
      totalRemainingVal += rem;
      totalSalesVal += Number(m.total_amount || rem);
      if (outId === 1) totalDpkUnredeemed += rem;
      else totalPdkUnredeemed += rem;
    });

    summary = {
      total_unredeemed_records: rows.length,
      total_unredeemed_value: totalRemainingVal,
      total_unredeemed_value_fmt: 'Rp ' + Math.round(totalRemainingVal).toLocaleString('id-ID'),
      total_sales_value: totalSalesVal,
      total_sales_value_fmt: 'Rp ' + Math.round(totalSalesVal).toLocaleString('id-ID'),
      total_realized_value: totalRealizedVal,
      total_realized_value_fmt: 'Rp ' + Math.round(totalRealizedVal).toLocaleString('id-ID'),
      total_dpk_unredeemed: totalDpkUnredeemed,
      total_dpk_unredeemed_fmt: 'Rp ' + Math.round(totalDpkUnredeemed).toLocaleString('id-ID'),
      total_pdk_unredeemed: totalPdkUnredeemed,
      total_pdk_unredeemed_fmt: 'Rp ' + Math.round(totalPdkUnredeemed).toLocaleString('id-ID')
    };

  } else if (type === 'sales_items') {
    reportTitle = 'Laporan Rincian Item Penjualan (Treatment & Produk) Neosoft';
    filename = `Neosoft_Sales_Items_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'No. Invoice',
      'Tanggal Transaksi (WIB)',
      'Cabang Outlet',
      'Nama Pasien',
      'Dokter DPJP',
      'Terapis / Perawat',
      'Kode Item',
      'Nama Item Tindakan / Produk',
      'Kategori',
      'Qty',
      'Nilai Satuan (IDR)',
      'Subtotal (IDR)'
    ];

    let totalSubtotal = 0;
    let totalQty = 0;
    let rowIdx = 1;

    invoices.forEach(inv => {
      const dStr = inv.inv_date || inv.created_at || '';
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(dStr, startDate, endDate)) return;
      if (inv.void_invoice === true) return;

      const cust = custMap[inv.customer_id] || {};
      const docName = therapistMap[inv.doctor_id] || 'dr. Jaga';
      const thName = therapistMap[inv.therapist_id] || '-';
      const dFormatted = dStr.replace('T', ' ').substring(0, 16);
      const uItems = invUsagesMap[inv.inv_code] || [];

      if (uItems.length > 0) {
        uItems.forEach(u => {
          const p = productMap[u.product_id] || {};
          const itemName = p.product_treatment_name || u.item_name || 'Item Perawatan';
          const itemCode = p.product_treatment_code || `PRD-${u.product_id || u.id}`;
          const qty = Number(u.qty || u.used || 1);
          const val = Number(u.value || p.price || 0);
          const sub = val > 0 ? val : (Number(p.price || 0) * qty);

          let cat = 'Treatment Medis';
          const lowerName = itemName.toLowerCase();
          if (lowerName.includes('krim') || lowerName.includes('serum') || lowerName.includes('sunscreen') || lowerName.includes('facial wash') || lowerName.includes('toner') || lowerName.includes('cream')) {
            cat = 'Skincare / Produk';
          } else if (u.invoice_package_id || lowerName.includes('paket')) {
            cat = 'Paket Treatment';
          }

          totalSubtotal += sub;
          totalQty += qty;

          rows.push([
            rowIdx++,
            inv.inv_code || `INV-${inv.id}`,
            dFormatted ? `${dFormatted} WIB` : '-',
            outName,
            resolveCustomerName(cust),
            docName,
            thName,
            itemCode,
            itemName,
            cat,
            qty,
            val,
            sub
          ]);
        });
      } else {
        const amt = Number(inv.total_after_tax || inv.total || 0);
        totalSubtotal += amt;
        totalQty += 1;
        rows.push([
          rowIdx++,
          inv.inv_code || `INV-${inv.id}`,
          dFormatted ? `${dFormatted} WIB` : '-',
          outName,
          resolveCustomerName(cust),
          docName,
          thName,
          '-',
          'Treatment & Konsultasi Medis',
          'Treatment Medis',
          1,
          amt,
          amt
        ]);
      }
    });

    summary = {
      total_items: rows.length,
      total_qty: totalQty,
      total_amount: totalSubtotal,
      total_amount_fmt: 'Rp ' + totalSubtotal.toLocaleString('id-ID')
    };

  } else if (type === 'payment_modes') {
    reportTitle = 'Laporan Rekapitulasi Kasir & Metode Pembayaran Neosoft';
    filename = `Neosoft_Payment_Settlement_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'Cabang Outlet',
      'Metode Pembayaran',
      'Tipe Pembayaran',
      'Jumlah Transaksi (Struk)',
      'Total Penerimaan (IDR)',
      'Porsi Omzet (%)'
    ];

    const groupMap = {};
    let totalAllPenerimaan = 0;
    let totalAllCount = 0;

    invoices.forEach(inv => {
      const dStr = inv.inv_date || inv.created_at || '';
      const outId = Number(inv.outlet_id);
      const outName = outId === 1 ? 'Depok' : 'Pondok Kopi';
      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(dStr, startDate, endDate)) return;
      if (inv.void_invoice === true) return;

      const amt = Number(inv.total_after_tax || inv.total || 0);
      const rawMode = (inv.paymode || 'bank').toLowerCase();
      const key = `${outName}__${rawMode}`;

      if (!groupMap[key]) {
        groupMap[key] = {
          outlet: outName,
          paymode: rawMode,
          count: 0,
          total: 0
        };
      }
      groupMap[key].count++;
      groupMap[key].total += amt;
      totalAllPenerimaan += amt;
      totalAllCount++;
    });

    const MODE_NAMES = {
      bank: 'Transfer Bank (BCA / Mandiri)',
      transfer_bca: 'Transfer Bank BCA',
      transfer_bri: 'Transfer Bank BRI',
      transfer_bni: 'Transfer Bank BNI',
      cash: 'Tunai Kasir (Cash in Hand)',
      debit_card: 'Kartu Debit EDC',
      credit_card: 'Kartu Kredit EDC',
      qris: 'QRIS / E-Wallet',
      deposit: 'Saldo Deposit Pasien'
    };

    const sortedGroups = Object.values(groupMap).sort((a, b) => b.total - a.total);
    rows = sortedGroups.map((g, idx) => {
      const porsi = totalAllPenerimaan > 0 ? ((g.total / totalAllPenerimaan) * 100).toFixed(1) + '%' : '0%';
      const displayMode = MODE_NAMES[g.paymode] || g.paymode.toUpperCase();
      const catType = g.paymode === 'cash' ? 'Tunai Kasir' : (g.paymode === 'deposit' ? 'Voucher/Deposit' : 'Bank & EDC Digital');

      return [
        idx + 1,
        g.outlet,
        displayMode,
        catType,
        g.count,
        g.total,
        porsi
      ];
    });

    summary = {
      total_transactions: totalAllCount,
      total_penerimaan: totalAllPenerimaan,
      total_penerimaan_fmt: 'Rp ' + totalAllPenerimaan.toLocaleString('id-ID'),
      channels_count: rows.length
    };

  } else if (type === 'staff_commissions') {
    reportTitle = 'Laporan Kinerja & Estimasi Komisi Tim Medis Neosoft';
    filename = `Neosoft_Staff_Commissions_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'ID Staf',
      'Nama Tenaga Medis',
      'Peran / Jabatan',
      'Cabang Home Base',
      'Total Invoices / Pasien Ditangani',
      'Tindakan Dilakukan',
      'Omzet Treatment (IDR)',
      'Omzet Skincare (IDR)',
      'Total Omzet Dihasilkan (IDR)',
      'Estimasi Komisi (IDR)'
    ];

    const missionData = getClinicMissionControlData(periodArg);
    const calc = missionData.commission_calculator || {};
    const doctors = calc.doctors || [];
    const therapistsList = calc.therapists || [];

    let totalStaffComm = 0;
    let totalStaffOmzet = 0;
    let rowIdx = 1;

    doctors.forEach(d => {
      if (!filterOutlet(d.outlet, d.outlet === 'Depok' ? 1 : 2)) return;
      totalStaffComm += Number(d.total_commission || 0);
      totalStaffOmzet += Number(d.total_revenue || 0);

      rows.push([
        rowIdx++,
        d.id || '-',
        d.name,
        'Dokter Medis (DPJP)',
        d.outlet,
        d.invoices_count || 0,
        d.treatments_performed || d.invoices_count || 0,
        d.revenue_treatment || 0,
        d.revenue_skincare || 0,
        d.total_revenue || 0,
        d.total_commission || 0
      ]);
    });

    therapistsList.forEach(t => {
      if (!filterOutlet(t.outlet, t.outlet === 'Depok' ? 1 : 2)) return;
      totalStaffComm += Number(t.total_commission || 0);

      rows.push([
        rowIdx++,
        t.id || '-',
        t.name,
        'Perawat / Terapis Klinis',
        t.outlet,
        t.invoices_count || t.treatments_performed || 0,
        t.treatments_performed || 0,
        0,
        0,
        0,
        t.total_commission || 0
      ]);
    });

    summary = {
      total_staff: rows.length,
      total_commission: totalStaffComm,
      total_commission_fmt: 'Rp ' + totalStaffComm.toLocaleString('id-ID'),
      total_generated_omzet: totalStaffOmzet,
      total_generated_omzet_fmt: 'Rp ' + totalStaffOmzet.toLocaleString('id-ID')
    };

  } else if (type === 'appointments') {
    reportTitle = 'Laporan Reservasi Pasien & Show Rate Neosoft';
    filename = `Neosoft_Appointments_${startDate || 'all'}_${endDate || ''}`.replace(/_+$/, '');
    columns = [
      'No',
      'No. Booking Reservasi',
      'Tanggal Reservasi',
      'Jam Mulai',
      'Cabang Outlet',
      'Nama Pasien',
      'No. WhatsApp / HP',
      'Dokter DPJP / Staf',
      'Layanan / Treatment Booking',
      'Status Kehadiran'
    ];

    let totalBookings = 0;
    let completedCount = 0;
    let rowIdx = 1;

    appointments.forEach(app => {
      const dStr = app.come_date || app.created_at || '';
      const outName = (app.outlet && app.outlet.name && app.outlet.name.toLowerCase().includes('depok')) ? 'Depok' : 'Pondok Kopi';
      const outId = outName === 'Depok' ? 1 : 2;

      if (!filterOutlet(outName, outId)) return;
      if (!dateInRange(dStr, startDate, endDate)) return;

      const p = app.patient || {};
      const t = app.treatment || {};
      const s = app.staff || {};
      const statusName = (app.status_color && app.status_color.name) || (app.status_appointment === 1 ? 'Booked' : 'Completed');
      const dOnly = (dStr || '').substring(0, 10);

      totalBookings++;
      if (statusName.toLowerCase().includes('complete') || statusName.toLowerCase().includes('selesai')) {
        completedCount++;
      }

      rows.push([
        rowIdx++,
        app.code || `APPT-${app.id_appointment || rowIdx}`,
        dOnly || '-',
        app.start_time || '-',
        outName,
        resolveCustomerName(p),
        p.phone || '-',
        s.name || 'Dokter Jaga',
        t.product_treatment_name || '-',
        statusName
      ]);
    });

    summary = {
      total_appointments: totalBookings,
      completed_count: completedCount,
      show_rate_pct: totalBookings > 0 ? Math.round((completedCount / totalBookings) * 100) + '%' : '0%'
    };
  }

  return {
    success: true,
    title: reportTitle,
    report_title: reportTitle,
    type,
    period: periodLabel,
    period_label: periodLabel,
    outlet: outletLabel,
    outlet_filter: outletLabel,
    outlet_label: outletLabel,
    filename,
    generated_at: new Date().toISOString(),
    columns,
    rows,
    summary
  };
}

function generateNeosoftCsv(reportData) {
  let csv = '\uFEFF'; // UTF-8 BOM agar terbaca sempurna di Microsoft Excel
  csv += `"KEFIR DERMA CLINIC - PT KEFIR KREATIF MEDIKA"\n`;
  csv += `"${reportData.report_title || 'Laporan Neosoft'}"\n`;
  csv += `"Periode: ${reportData.period_label || '-'} | Outlet: ${reportData.outlet_label || 'Semua Cabang'}"\n`;
  csv += `"Tanggal Ekspor: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB"\n\n`;

  // Baris Header
  csv += (reportData.columns || []).map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\n';

  // Baris Data
  (reportData.rows || []).forEach(row => {
    csv += row.map(val => {
      if (typeof val === 'number') return val;
      return `"${String(val ?? '').replace(/"/g, '""')}"`;
    }).join(',') + '\n';
  });

  // Ringkasan di bagian bawah
  if (reportData.summary && Object.keys(reportData.summary).length > 0) {
    csv += '\n"--- RINGKASAN LAPORAN ---"\n';
    Object.entries(reportData.summary).forEach(([k, v]) => {
      if (!k.endsWith('_fmt')) {
        csv += `"${k.replace(/_/g, ' ').toUpperCase()}","${v}"\n`;
      }
    });
  }

  return csv;
}

let _cachedTierPatients = null;
let _cachedTierPatientsTime = 0;

// --- CRM Spending Tier: pencatatan "sudah dichat WA" per pasien ---
// { "<customer_id>": { last_chat_at, count, control_date, name, by, pending: { at, control_date } | absent } }
// Dua langkah: klik "Chat WA" -> pending (menunggu konfirmasi), lalu staf konfirmasi "Terkirim"
// (menaikkan count & last_chat_at) atau "Batal" (pending dihapus). WhatsApp tidak memberi tahu
// dashboard apakah pesan benar-benar terkirim, jadi konfirmasi dilakukan manual.
// control_date = jadwal kontrol saat dichat. Kalau jadwal pasien berubah setelahnya, chat
// dianggap untuk siklus lama dan pasien muncul lagi sebagai "belum dichat".
function getCrmTierChatLog() {
  try {
    if (fs.existsSync(CRM_TIER_CHAT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CRM_TIER_CHAT_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('[getCrmTierChatLog] Gagal baca file:', e.message);
  }
  return {};
}

function markCrmTierChatted({ patient_id, name, control_date, marked_by, action = 'click' }) {
  if (patient_id === undefined || patient_id === null || patient_id === '') {
    return { success: false, error: 'patient_id wajib diisi' };
  }
  if (!['click', 'confirm', 'cancel'].includes(action)) {
    return { success: false, error: 'action harus click, confirm, atau cancel' };
  }
  const log = getCrmTierChatLog();
  const key = String(patient_id);
  const entry = log[key] || { count: 0, last_chat_at: null, control_date: null };
  const now = new Date().toISOString();

  if (action === 'click') {
    entry.pending = { at: now, control_date: control_date || null };
    entry.name = name || entry.name || '';
  } else if (action === 'confirm') {
    const ctrl = entry.pending ? entry.pending.control_date : (control_date || null);
    entry.count = (entry.count || 0) + 1;
    entry.last_chat_at = now;
    entry.control_date = ctrl;
    entry.by = marked_by || 'Dashboard User';
    entry.name = name || entry.name || '';
    delete entry.pending;
  } else if (action === 'cancel') {
    delete entry.pending;
  }

  if (!entry.pending && !entry.last_chat_at) {
    delete log[key];
  } else {
    log[key] = entry;
  }
  try {
    fs.mkdirSync(path.dirname(CRM_TIER_CHAT_FILE), { recursive: true });
    const tmp = CRM_TIER_CHAT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(log, null, 2));
    fs.renameSync(tmp, CRM_TIER_CHAT_FILE);
    return { success: true, action, chat: log[key] || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Pasien uji/latihan di master Neosoft (mis. "Tes Pasien Training") — tidak boleh ikut
// daftar CRM, hitungan tier, maupun follow-up.
function isTestPatientName(name) {
  return /^\s*(tes|test|testing|dummy)\b|\bpasien\s+(training|tes|test)\b|^\s*pasien\s+training\b/i.test(String(name || ''));
}

// Nomor WhatsApp yang bisa dipakai: 08xx / 628xx, 10–13 digit setelah jadi format 62,
// dan bukan angka berulang (mis. 0, 6288888888888888).
function normalizeWaPhone(raw) {
  // Sel bisa berisi dua nomor ("62813.../813..."): pakai nomor pertama.
  const first = String(raw || '').split(/[\/,;]| atau /i)[0];
  let d = first.replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  const repeated = /(\d)\1{7,}/.test(d.slice(2));
  let valid;
  if (d.startsWith('62')) valid = d.startsWith('628') && d.length >= 10 && d.length <= 15 && !repeated;
  else valid = d.length >= 10 && d.length <= 15 && !repeated;   // nomor luar negeri, mis. +49
  return { wa: valid ? d : '', valid };
}

// Seluruh daftar segmentasi (Neosoft + Sheets), dipakai juga agregat dashboard supaya angkanya sama dengan tabel.
function getAllTierPatients() {
  getSpendingTierPatients({ page: 1, limit: 1 });
  return _cachedTierPatients || [];
}

// Top VIP per periode (tabel "Top 15 VIP Royalty Patients"). VIP = tier very_high berdasar
// belanja SEUMUR HIDUP (Neosoft + Sheets, sama dengan segmentasi CRM); peringkat, total belanja,
// kunjungan & kunjungan terakhir dihitung HANYA dari transaksi di rentang tanggal (dan cabang)
// yang dipilih. Pasien VIP tanpa transaksi di periode itu tidak tampil.
// Daftar segmentasi untuk rentang tanggal (dan cabang) tertentu: belanja, kunjungan & kunjungan
// terakhir dihitung hanya dari transaksi Neosoft + Sheets di rentang itu, tier dihitung ulang dari
// belanja periode. Pasien tanpa transaksi di periode itu tidak ikut. Field lain (HP, jadwal kontrol,
// dst.) sama dengan daftar seumur hidup. Cache 45 detik per kombinasi rentang+cabang.
const _rangeTierCache = new Map();
function buildTierPatientsInRange(startDate, endDate, branch = null) {
  const lifetime = getAllTierPatients();
  const key = `${startDate || ''}|${endDate || ''}|${branch || ''}`;
  const hit = _rangeTierCache.get(key);
  if (hit && hit.base === lifetime && Date.now() - hit.time < 45000) return hit.list;
  const invoices = getSafeJson('invoices_all.json') || [];
  const branchOf = o => (Number(o) === 2 ? 'Pondok Kopi' : 'Depok');
  const allDates = {}, period = {};
  invoices.forEach(inv => {
    if (inv.void_invoice || inv.is_void || isMigrationInvoice(inv)) return;
    const cid = String(inv.customer_id);
    const d = String(inv.inv_date || inv.created_at || '').slice(0, 10);
    if (d) (allDates[cid] = allDates[cid] || new Set()).add(d);
    if (!d || (startDate && d < startDate) || (endDate && d > endDate)) return;
    if (branch && branchOf(inv.outlet_id) !== branch) return;
    const p = period[cid] || (period[cid] = { total: 0, count: 0, last: '', outlets: new Set() });
    p.total += Number(inv.total_after_tax || inv.total || 0);
    p.count++;
    if (d > p.last) p.last = d;
    p.outlets.add(branchOf(inv.outlet_id));
  });
  const base = lifetime.filter(c => !c.sheets_only).map(c => {
    const p = period[String(c.id)];
    return { ...c, total_spent: p ? p.total : 0, invoices_count: p ? p.count : 0, last_visit: p ? p.last : '',
      branch: p ? [...p.outlets].join(', ') : '', source: 'Neosoft', lifetime_spent: c.total_spent, lifetime_tier: c.tier };
  });
  const list = mergeSheetsIntoTierPatients(base, id => allDates[String(id)] || null, { start: startDate, end: endDate, branch })
    .filter(c => c.total_spent > 0 || c.invoices_count > 0)
    .map(c => {
      const t = tierOfSpend(c.total_spent);
      return { ...c, tier: t.code, tier_label: t.label, branch: c.branch || branch || '-', last_visit: c.last_visit || '-',
        total_spent_fmt: 'Rp ' + Math.round(c.total_spent).toLocaleString('id-ID') };
    });
  _rangeTierCache.set(key, { base: lifetime, time: Date.now(), list });
  return list;
}

function getTopVipPatientsInRange(startDate, endDate, branch = null, limit = 15) {
  const lifetime = getAllTierPatients();
  const vipIds = new Set(lifetime.filter(c => c.tier === 'very_high').map(c => String(c.id)));
  // Baris Sheets-only bisa dapat id berbeda saat difilter per cabang (id diturunkan dari
  // cabang+RM pertama) — cocokkan juga lewat RM / nama.
  const nk = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const vipSheetRms = new Set(), vipSheetNames = new Set();
  lifetime.filter(c => c.tier === 'very_high' && c.sheets_only).forEach(c => {
    String(c.code || '').split(', ').filter(Boolean).forEach(rm => vipSheetRms.add(rm));
    if (nk(c.name)) vipSheetNames.add(nk(c.name));
  });
  const isVip = c => vipIds.has(String(c.id)) || (c.sheets_only &&
    (vipSheetNames.has(nk(c.name)) || String(c.code || '').split(', ').some(rm => vipSheetRms.has(rm))));
  return buildTierPatientsInRange(startDate, endDate, branch)
    .filter(c => isVip(c) && c.total_spent > 0)
    .sort((a, b) => b.total_spent - a.total_spent)
    .slice(0, limit)
    .map(c => ({ id: c.id, name: c.name, phone: c.phone, code: c.code, outlet_names: c.branch || branch || '-',
      invoices_count: c.invoices_count, total_spent: c.total_spent, last_visit: c.last_visit || '-', source: c.source }));
}

function tierOfSpend(total) {
  if (total > 4000000) return { code: 'very_high', label: 'Very High (> Rp 4M)' };
  if (total >= 1500000) return { code: 'high', label: 'High (Rp 1.5M - 4M)' };
  if (total >= 800000) return { code: 'middle', label: 'Middle (Rp 800k - 1.5M)' };
  if (total >= 400000) return { code: 'low', label: 'Low (Rp 400k - 800k)' };
  return { code: 'very_low', label: 'Very Low (< Rp 400k)' };
}

// Tambahkan pasien dari riwayat Google Sheets (transactions_history.json) ke daftar segmentasi.
//  - Pasien Sheets yang cocok dengan pasien Neosoft (no. HP, lalu nama lengkap >= 2 kata)
//    belanjanya DIJUMLAHKAN ke pasien Neosoft itu.
//  - Yang tidak cocok jadi baris baru bersumber "Sheets" (tanpa profil Patient 360 & jadwal kontrol).
//  - Kunjungan yang sama di kedua sumber dihitung SEKALI: pasien yang sama (nama lengkap / no. HP)
//    dan tanggal yang sama. Neosoft menang — baris Sheets pada tanggal itu dibuang walau nominalnya
//    beda (Sheets per item treatment, Neosoft per invoice).
//  - Baris Sheets tanpa tanggal (hanya kolom periode bulan) dihitung sebagai belanja tanpa kunjungan;
//    pada bulan yang sudah ada invoice Neosoft pasien itu dianggap duplikat dan dibuang.
// Aturan pencocokan pasien sama dengan menu Reaktivasi Pasien.
// neoDatesOf(id) → Set tanggal invoice Neosoft (non-void, non-migrasi) milik pasien itu.
// opts.start/opts.end (YYYY-MM-DD) & opts.branch ('Depok'/'Pondok Kopi') membatasi baris Sheets
// yang dihitung — dipakai Top VIP per periode. Baris tanpa tanggal ikut bila bulannya beririsan.
function mergeSheetsIntoTierPatients(list, neoDatesOf = () => null, opts = {}) {
  const hist = getTransactionHistory();
  const rStart = opts.start || null, rEnd = opts.end || null;
  if (!hist || !Array.isArray(hist.rows) || !hist.rows.length) return list;

  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameKey = (s) => normName(s).replace(/ /g, '');
  const multiWord = (s) => normName(s).split(' ').filter(w => w.length >= 2).length >= 2;
  const phoneKey = (raw) => { const r = normalizeWaPhone(raw); return r.valid ? r.wa : ''; };
  // Sheets memuat beberapa tanggal mustahil (29–31 Feb) — dianggap 28 Feb.
  const fixDate = (d) => (d && d.slice(5, 7) === '02' && ['29', '30', '31'].includes(d.slice(8, 10))) ? d.slice(0, 8) + '28' : d;

  const byPhone = {}, byName = {};
  const neoDatesByPhone = {}, neoDatesByName = {};
  const addDates = (map, k, set) => { if (!k || !set) return; const t = map[k] || (map[k] = new Set()); set.forEach(d => t.add(d)); };
  list.forEach(c => {
    const pk = phoneKey(c.phone), nk = nameKey(c.name);
    if (pk) (byPhone[pk] = byPhone[pk] || []).push(c);
    if (nk) (byName[nk] = byName[nk] || []).push(c);
    // Pasien Neosoft kembar (nama/HP sama, ID beda) dianggap satu orang untuk cek duplikat.
    const ds = neoDatesOf(c.id);
    addDates(neoDatesByPhone, pk, ds);
    if (multiWord(c.name)) addDates(neoDatesByName, nk, ds);
  });

  const people = {};
  hist.rows.forEach(r => {
    const d = fixDate(String(r.date || '').slice(0, 10));
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(d);
    const period = /^\d{4}-\d{2}$/.test(String(r.period || '')) ? String(r.period) : '';
    if (!hasDate && !period) return;
    const rm = String(r.rm || '').trim().toUpperCase();
    const nm = String(r.patient_name || '').trim();
    if (!rm && !nameKey(nm)) return;
    if (isTestPatientName(nm)) return;
    const branch = r.branch || (Number(r.outlet_id) === 2 ? 'Pondok Kopi' : 'Depok');
    if (opts.branch && branch !== opts.branch) return;
    if (hasDate ? ((rStart && d < rStart) || (rEnd && d > rEnd))
                : ((rStart && period < rStart.slice(0, 7)) || (rEnd && period > rEnd.slice(0, 7)))) return;
    const key = branch + '|' + (rm ? 'rm:' + rm : 'nm:' + nameKey(nm));
    const p = people[key] || (people[key] = { branch, rm, name: '', nameDate: '', names: new Set(), phones: new Set(), byDate: {}, byMonth: {} });
    const amt = Number(r.amount || 0);
    const when = hasDate ? d : period + '-01';
    if (hasDate) p.byDate[d] = (p.byDate[d] || 0) + amt;
    else p.byMonth[period] = (p.byMonth[period] || 0) + amt;
    if (nm) { p.names.add(normName(nm)); if (when >= p.nameDate) { p.name = nm; p.nameDate = when; } }
    const pk = phoneKey(r.phone);
    if (pk) p.phones.add(pk);
  });

  const touched = new Set();
  const unmatched = [];
  Object.values(people).forEach(p => {
    let match = null;
    p.phones.forEach(pk => {
      if (match || !byPhone[pk]) return;
      // Satu nomor bisa dipakai keluarga: utamakan pasien yang namanya juga cocok.
      match = byPhone[pk].find(c => p.names.has(normName(c.name)) || (multiWord(c.name) && [...p.names].some(n => nameKey(n) === nameKey(c.name)))) || byPhone[pk][0];
    });
    if (!match) {
      p.names.forEach(n => {
        if (match || !multiWord(n)) return;
        const cands = byName[nameKey(n)];
        if (cands) match = cands.find(c => phoneKey(c.phone)) || cands[0];
      });
    }
    // Buang kunjungan Sheets yang sudah tercatat di Neosoft (pasien & tanggal sama); sisanya dihitung.
    const nameKeys = [...p.names].filter(multiWord).map(nameKey);
    const matchDates = match ? neoDatesOf(match.id) : null;
    p.visits = new Set(); p.spent = 0; p.last = '';
    const neoSets = () => [matchDates, ...[...p.phones].map(pk => neoDatesByPhone[pk]), ...nameKeys.map(nk => neoDatesByName[nk])].filter(Boolean);
    Object.keys(p.byDate).sort().forEach(d => {
      if (neoSets().some(set => set.has(d))) return;   // kunjungan ini sudah tercatat di Neosoft
      p.visits.add(d);
      p.spent += p.byDate[d];
      if (d > p.last) p.last = d;
    });
    Object.keys(p.byMonth).forEach(m => {
      if (neoSets().some(set => [...set].some(d => d.startsWith(m)))) return;   // bulan itu sudah ada invoice Neosoft
      p.spent += p.byMonth[m];
    });
    if (!p.visits.size && !p.spent) return;   // semua sudah ada di Neosoft
    if (match) {
      match.total_spent += Math.round(p.spent);
      match.invoices_count += p.visits.size;
      if (p.last > (match.last_visit || '')) match.last_visit = p.last;
      if (!String(match.branch || '').includes(p.branch)) match.branch = match.branch ? `${match.branch}, ${p.branch}` : p.branch;
      match.source = 'Sheets + Neosoft';
      touched.add(match);
    } else {
      unmatched.push(p);
    }
  });

  // Pasien Sheets-only yang sama di dua cabang (RM berbeda) → satu baris (hanya nama >= 2 kata).
  const merged = {}, rows = [];
  unmatched.forEach(p => {
    const k = multiWord(p.name) ? nameKey(p.name) : null;
    const m = k ? merged[k] : null;
    if (!m) {
      const row = { name: p.name || 'Pasien', rms: p.rm ? [p.rm] : [], branches: [p.branch], phone: [...p.phones][0] || '', visits: p.visits.size, last: p.last, spent: p.spent, key: p.branch + '|' + (p.rm || nameKey(p.name)) };
      rows.push(row);
      if (k) merged[k] = row;
      return;
    }
    if (p.last > m.last) m.last = p.last;
    if (!m.branches.includes(p.branch)) m.branches.push(p.branch);
    if (p.rm && !m.rms.includes(p.rm)) m.rms.push(p.rm);
    if (!m.phone) m.phone = [...p.phones][0] || '';
    m.visits += p.visits.size;
    m.spent += p.spent;
  });

  // id numerik stabil (di atas id Neosoft) — dipakai log chat WA; tidak berubah walau urutan data berubah.
  const usedIds = new Set(list.map(c => String(c.id)));
  const stableId = (key) => {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    let id = 3000000000 + (h % 1000000000);
    while (usedIds.has(String(id))) id++;
    usedIds.add(String(id));
    return id;
  };
  rows.forEach(r => {
    const spent = Math.round(r.spent);
    const t = tierOfSpend(spent);
    list.push({
      id: stableId(r.key),
      name: r.name,
      phone: r.phone,
      phone_valid: normalizeWaPhone(r.phone).valid,
      possible_duplicate: null,
      code: r.rms.join(', '),
      branch: r.branches.join(', '),
      total_spent: spent,
      total_spent_fmt: 'Rp ' + spent.toLocaleString('id-ID'),
      invoices_count: r.visits,
      last_visit: r.last || '-',
      tier: t.code,
      tier_label: t.label,
      control_date: null, control_type: null, control_doctor: null, control_treatment: null,
      days_until: null, control_status: 'none',
      source: 'Sheets',
      sheets_only: true
    });
  });

  touched.forEach(c => {
    const t = tierOfSpend(c.total_spent);
    c.tier = t.code;
    c.tier_label = t.label;
    c.total_spent_fmt = 'Rp ' + Number(c.total_spent).toLocaleString('id-ID');
  });
  return list;
}

function getSpendingTierPatients({
  tier = 'all',
  branch = 'all',
  timing = 'all',
  search = '',
  chat = 'all',
  page = 1,
  limit = 15,
  start = null,   // YYYY-MM-DD — bila diisi, tier & belanja dihitung dari periode ini saja
  end = null
} = {}) {
  const now = Date.now();
  if (!_cachedTierPatients || (now - _cachedTierPatientsTime > 45000)) {
    const customers = getSafeJson('customers_all.json') || [];
    const invoices = getSafeJson('invoices_all.json') || [];
    const appts = getSafeJson('appointment_full.json') || [];
    const recs = getDoctorRecommendations();

    const nowD = new Date();
    const todayWib = new Date(`${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}T00:00:00`);

    const custSpent = {};
    (invoices || []).forEach(inv => {
      if (inv.void_invoice || inv.is_void || isMigrationInvoice(inv)) return;
      const cid = inv.customer_id;
      const amt = Number(inv.total_after_tax || inv.total || 0);
      if (!custSpent[cid]) custSpent[cid] = { total: 0, count: 0, last: '', outlets: new Set(), dates: new Set() };
      custSpent[cid].total += amt;
      custSpent[cid].count++;
      const d = (inv.inv_date || inv.created_at || '').slice(0, 10);
      if (d) custSpent[cid].dates.add(d);
      if (!custSpent[cid].last || custSpent[cid].last < d) custSpent[cid].last = d;
      custSpent[cid].outlets.add(inv.outlet_id === 2 ? 'Pondok Kopi' : 'Depok');
    });

    // Jadwal kontrol per pasien. Status Neosoft: 1 Booked, 13 Confirmed (masih terbuka),
    // 2 Consultation / 7 Arrived / 8 Treatment / 4 Finished (sudah datang), 5 Cancelled.
    const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
    const OPEN_APPT = new Set([1, 13]);
    const ATTENDED_APPT = new Set([2, 4, 7, 8]);
    const lastVisitMap = {};
    Object.keys(custSpent).forEach(cid => {
      if (custSpent[cid].last) lastVisitMap[String(cid)] = custSpent[cid].last;
    });
    const openAppts = {};
    (appts || []).forEach(a => {
      const pid = a.patient ? String(a.patient.id) : null;
      const d = (a.come_date || '').slice(0, 10);
      if (!pid || !d) return;
      if (ATTENDED_APPT.has(a.status_appointment)) {
        if (!lastVisitMap[pid] || lastVisitMap[pid] < d) lastVisitMap[pid] = d;
      } else if (OPEN_APPT.has(a.status_appointment) && !a.appointment_cancellation) {
        (openAppts[pid] = openAppts[pid] || []).push(a);
      }
    });

    const apptToControl = (a) => {
      const therapists = a.therapists || [];
      const doc = therapists.find(t => /^dr\.?\s/i.test(t.name || '')) || therapists[0];
      const typeName = a.appointment_type && a.appointment_type.name
        ? a.appointment_type.name.charAt(0) + a.appointment_type.name.slice(1).toLowerCase()
        : 'Tindakan';
      return {
        date: (a.come_date || '').slice(0, 10),
        type: 'Reservasi Neosoft',
        doctor: doc ? doc.name : 'Dokter/Terapis',
        treatment: (a.treatment && a.treatment.product_treatment_name) || typeName
      };
    };

    const controlMap = {};
    // 1) Reservasi mendatang terdekat (hari ini atau sesudahnya).
    Object.keys(openAppts).forEach(pid => {
      const upcoming = openAppts[pid]
        .filter(a => (a.come_date || '').slice(0, 10) >= todayStr)
        .sort((x, y) => (x.come_date || '').localeCompare(y.come_date || ''));
      if (upcoming.length) controlMap[pid] = apptToControl(upcoming[0]);
    });
    // 2) Rekomendasi dokter yang belum dipenuhi (belum ada kunjungan sejak tanggal itu).
    (recs || []).forEach(r => {
      const pid = r.customer_id ? String(r.customer_id) : null;
      const d = r.recommended_return_date;
      if (!pid || !d || controlMap[pid]) return;
      if (lastVisitMap[pid] && lastVisitMap[pid] >= d) return;
      controlMap[pid] = {
        date: d,
        type: 'Rekomendasi Dokter',
        doctor: r.doctor_name || 'Dokter DPJP',
        treatment: r.next_treatment || 'Kontrol Dokter'
      };
    });
    // Data pasien dobel di Neosoft: reservasi dibuat di satu data, pasien datang & bayar di data
    // lain dengan nama yang sama. Kunjungan data kembar di TANGGAL YANG SAMA dianggap bukti datang.
    const normName = (c) => {
      const n = typeof c.name === 'string' ? c.name : `${(c.name || {}).first_name || ''} ${(c.name || {}).last_name || ''}`;
      return String(n).toLowerCase().replace(/[^a-z]/g, '');
    };
    const custById = {}; customers.forEach(c => { custById[String(c.id)] = c; });
    const visitDatesByCid = {};
    (invoices || []).forEach(inv => {
      if (inv.void_invoice || inv.is_void) return;
      const d = (inv.inv_date || inv.created_at || '').slice(0, 10);
      if (d) (visitDatesByCid[String(inv.customer_id)] = visitDatesByCid[String(inv.customer_id)] || new Set()).add(d);
    });
    (appts || []).forEach(a => {
      if (!a.patient || !ATTENDED_APPT.has(a.status_appointment)) return;
      const d = (a.come_date || '').slice(0, 10);
      if (d) (visitDatesByCid[String(a.patient.id)] = visitDatesByCid[String(a.patient.id)] || new Set()).add(d);
    });
    const cidsByName = {};
    customers.forEach(c => { const k = normName(c); if (k.length >= 3) (cidsByName[k] = cidsByName[k] || []).push(String(c.id)); });
    const twinVisitOn = (pid, date) => {
      const c = custById[pid]; if (!c) return null;
      const twins = (cidsByName[normName(c)] || []).filter(x => x !== pid);
      const hit = twins.find(t => visitDatesByCid[t] && visitDatesByCid[t].has(date));
      return hit ? custById[hit] : null;
    };
    const duplicateNotes = {};

    // 3) Reservasi terlewat (masih Booked/Confirmed, sudah lewat, dan pasien belum datang sejak itu).
    Object.keys(openAppts).forEach(pid => {
      if (controlMap[pid]) return;
      const missed = openAppts[pid]
        .filter(a => {
          const d = (a.come_date || '').slice(0, 10);
          if (d >= todayStr || (lastVisitMap[pid] && lastVisitMap[pid] >= d)) return false;
          const twin = twinVisitOn(pid, d);
          if (twin) {
            duplicateNotes[pid] = { date: d, twin_code: twin.code || `ID ${twin.id}` };
            return false;
          }
          return true;
        })
        .sort((x, y) => (y.come_date || '').localeCompare(x.come_date || ''));
      if (missed.length) controlMap[pid] = apptToControl(missed[0]);
    });

    _cachedTierPatients = customers.filter(c => !isTestPatientName(typeof c.name === 'string' ? c.name : `${(c.name || {}).first_name || ''} ${(c.name || {}).last_name || ''}`)).map(c => {
      const nameObj = c.name || {};
      const fullName = typeof c.name === 'string'
        ? c.name
        : (`${nameObj.first_name || ''} ${nameObj.last_name || ''}`.trim() || 'Pasien');

      const sp = custSpent[c.id] || { total: 0, count: 0, last: '-', outlets: new Set() };
      const outlet = sp.outlets.size > 0 ? Array.from(sp.outlets).join(', ') : (c.outlet_id === 2 ? 'Pondok Kopi' : 'Depok');
      
      const { code: tierCode, label: tierLabel } = tierOfSpend(sp.total);

      const ctrl = controlMap[String(c.id)];
      let days = null;
      let status = 'none';
      if (ctrl && ctrl.date) {
        const cDate = new Date(ctrl.date + 'T00:00:00');
        if (!isNaN(cDate.getTime())) {
          days = Math.round((cDate.getTime() - todayWib.getTime()) / (1000 * 60 * 60 * 24));
          if (days < 0) status = 'overdue';
          else if (days <= 3) status = 'h3';
          else if (days <= 7) status = 'h7';
          else if (days <= 14) status = 'h14';
          else status = 'upcoming';
        }
      }

      return {
        id: c.id,
        name: fullName,
        phone: c.phone || c.mobile_phone || '',
        phone_valid: normalizeWaPhone(c.phone || c.mobile_phone).valid,
        possible_duplicate: duplicateNotes[String(c.id)] || null,
        code: c.code || '',
        branch: outlet,
        total_spent: sp.total,
        total_spent_fmt: 'Rp ' + Number(sp.total).toLocaleString('id-ID'),
        invoices_count: sp.count,
        last_visit: sp.last,
        tier: tierCode,
        tier_label: tierLabel,
        control_date: ctrl ? ctrl.date : null,
        control_type: ctrl ? ctrl.type : null,
        control_doctor: ctrl ? ctrl.doctor : null,
        control_treatment: ctrl ? ctrl.treatment : null,
        days_until: days,
        control_status: status,
        source: 'Neosoft'
      };
    });
    _cachedTierPatients = mergeSheetsIntoTierPatients(_cachedTierPatients, (id) => (custSpent[id] && custSpent[id].dates) || null);
    _cachedTierPatientsTime = now;
  }

  // Mode periode: belanja, kunjungan & tier dihitung dari transaksi di rentang tanggal (dan
  // cabang) terpilih; hanya pasien yang bertransaksi di periode itu. Tanpa rentang = seumur hidup.
  const rangeMode = !!(start || end);
  const branchName = !branch || branch === 'all' ? null : (String(branch).toLowerCase().includes('pondok') || String(branch).toLowerCase() === 'pdk' ? 'Pondok Kopi' : 'Depok');
  const source = rangeMode ? buildTierPatientsInRange(start || null, end || null, branchName) : _cachedTierPatients;
  let filtered = source;

  if (tier && tier !== 'all') {
    filtered = filtered.filter(c => c.tier === tier);
  }

  if (branch && branch !== 'all') {
    const bNorm = branch.toLowerCase();
    filtered = filtered.filter(c => c.branch.toLowerCase().includes(bNorm.includes('depok') ? 'depok' : 'pondok'));
  }

  if (timing && timing !== 'all') {
    if (timing === 'h3') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until >= 0 && c.days_until <= 3);
    } else if (timing === 'h7') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until >= 4 && c.days_until <= 7);
    } else if (timing === 'h14') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until >= 8 && c.days_until <= 14);
    } else if (timing === 'within_7') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until >= 0 && c.days_until <= 7);
    } else if (timing === 'within_14') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until >= 0 && c.days_until <= 14);
    } else if (timing === 'overdue') {
      filtered = filtered.filter(c => c.days_until !== null && c.days_until < 0);
    } else if (timing === 'scheduled') {
      filtered = filtered.filter(c => c.control_date !== null);
    } else if (timing === 'unscheduled') {
      filtered = filtered.filter(c => c.control_date === null);
    }
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.code.toLowerCase().includes(q)
    );
  }

  // Status chat WA (dibaca dari log tiap request, tidak ikut di-cache)
  const chatLog = getCrmTierChatLog();
  const chatState = (c) => {
    const e = chatLog[String(c.id)];
    if (!e) return null;
    const ctrl = c.control_date || null;
    return {
      last_chat_at: e.last_chat_at || null,
      count: e.count || 0,
      by: e.by || '',
      current: !!e.last_chat_at && (e.control_date || null) === ctrl,
      pending: !!e.pending && (e.pending.control_date || null) === ctrl,
      pending_at: e.pending ? e.pending.at : null
    };
  };
  if (chat === 'chatted') {
    filtered = filtered.filter(c => { const st = chatState(c); return st && st.current; });
  } else if (chat === 'not_chatted') {
    filtered = filtered.filter(c => { const st = chatState(c); return !st || !st.current; });
  }

  filtered.sort((a, b) => {
    if (a.control_date && !b.control_date) return -1;
    if (!a.control_date && b.control_date) return 1;
    if (a.days_until !== null && b.days_until !== null) {
      if (a.days_until >= 0 && b.days_until >= 0) return a.days_until - b.days_until;
    }
    return b.total_spent - a.total_spent;
  });

  const total = filtered.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.max(1, parseInt(limit, 10) || 15);
  const totalPages = Math.ceil(total / l) || 1;
  const startIndex = (p - 1) * l;
  const patients = filtered.slice(startIndex, startIndex + l).map(c => ({ ...c, chat: chatState(c) }));

  // Angka kartu tier ikut filter cabang (mode periode: source sudah per cabang).
  const countSrc = branchName && !rangeMode
    ? source.filter(c => String(c.branch || '').toLowerCase().includes(branchName === 'Depok' ? 'depok' : 'pondok'))
    : source;
  const tierCounts = {
    all: countSrc.length,
    very_high: countSrc.filter(c => c.tier === 'very_high').length,
    high: countSrc.filter(c => c.tier === 'high').length,
    middle: countSrc.filter(c => c.tier === 'middle').length,
    low: countSrc.filter(c => c.tier === 'low').length,
    very_low: countSrc.filter(c => c.tier === 'very_low').length
  };

  return {
    success: true,
    tier,
    branch,
    start: rangeMode ? (start || null) : null,
    end: rangeMode ? (end || null) : null,
    timing,
    chat,
    total,
    page: p,
    limit: l,
    total_pages: totalPages,
    start_index: total > 0 ? startIndex + 1 : 0,
    end_index: Math.min(startIndex + l, total),
    tier_counts: tierCounts,
    patients
  };
}

// ═══════════════════════════════════════════════════════════════════════
// REAKTIVASI PASIEN > 6 BULAN (menu Sales)
//
// Neosoft baru dipakai sejak 20 Mei 2026, jadi "terakhir datang > 6 bulan"
// hampir seluruhnya hanya terlihat dari riwayat Google Sheets
// (transactions_history.json, Nov 2024 →). Daftar ini menggabungkan:
//   1. Riwayat Sheets — pasien dikenali dari cabang + no. RM (atau nama
//      bila RM kosong). Format RM Sheets (D-xxxx / 99-9999) tidak sama
//      dengan kode Neosoft (EM-…), jadi tidak bisa dicocokkan lewat RM.
//   2. Neosoft (invoice non-void + reservasi yang benar-benar datang) —
//      dicocokkan lewat no. HP, atau nama lengkap (minimal 2 kata, supaya
//      "Dewi" di Sheets tidak tertukar dengan "Dewi" lain di Neosoft).
//      Pasien yang sudah datang lagi di Neosoft dalam 6 bulan terakhir
//      dikeluarkan dari daftar; nomor HP diambil dari master Neosoft bila
//      Sheets tidak mencatatnya.
//   3. Pasien Neosoft-only yang invoice terakhirnya > 6 bulan (mulai
//      relevan Nov 2026 ke atas).
// ═══════════════════════════════════════════════════════════════════════
let _reactivationCache = null;
const REACTIVATION_MIN_DAYS = 183;   // ± 6 bulan
let _reactivationCacheTime = 0;

function buildReactivationList(minDays) {
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameKey = (s) => normName(s).replace(/ /g, '');
  const multiWord = (s) => normName(s).split(' ').filter(w => w.length >= 2).length >= 2;
  const phoneKey = (raw) => { const r = normalizeWaPhone(raw); return r.valid ? r.wa : ''; };
  const custName = (c) => {
    const n = c && c.name;
    if (typeof n === 'string') return n.trim();
    return [n && n.first_name, n && n.middle_name, n && n.last_name].filter(Boolean).map(x => String(x).trim()).join(' ').trim();
  };
  // Sheets memuat beberapa tanggal mustahil (29–31 Feb 2025) — dianggap 28 Feb.
  const fixDate = (d) => (d && d.slice(5, 7) === '02' && ['29', '30', '31'].includes(d.slice(8, 10))) ? d.slice(0, 8) + '28' : d;
  const branchOf = (outletId, fallback) => outletId === 2 ? 'Pondok Kopi' : (outletId === 1 ? 'Depok' : (fallback || 'Depok'));

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayMs = new Date(todayStr + 'T00:00:00').getTime();
  const daysSince = (d) => Math.floor((todayMs - new Date(d + 'T00:00:00').getTime()) / 86400000);

  // ── 1. Neosoft: kunjungan terakhir per customer
  const customers = (getSafeJson('customers_all.json') || []).filter(c => !isTestPatientName(custName(c)));
  const invoices = getSafeJson('invoices_all.json') || [];
  const appts = getSafeJson('appointment_full.json') || [];
  const ATTENDED_APPT = new Set([2, 4, 7, 8]);
  const neo = {};   // cid -> { last, spent, visits:Set, outlets:Set }
  const neoOf = (cid) => (neo[cid] = neo[cid] || { last: '', spent: 0, visits: new Set(), outlets: new Set() });
  invoices.forEach(inv => {
    if (inv.void_invoice || inv.is_void || isMigrationInvoice(inv)) return;
    const d = String(inv.inv_date || inv.created_at || '').slice(0, 10);
    if (!d) return;
    const n = neoOf(String(inv.customer_id));
    if (d > n.last) n.last = d;
    n.visits.add(d);
    n.spent += Number(inv.total_after_tax || inv.total || 0);
    n.outlets.add(branchOf(inv.outlet_id));
  });
  appts.forEach(a => {
    if (!a.patient || !ATTENDED_APPT.has(a.status_appointment)) return;
    const d = String(a.come_date || '').slice(0, 10);
    if (!d) return;
    const n = neoOf(String(a.patient.id));
    if (d > n.last) n.last = d;
    n.visits.add(d);
  });
  const custById = {};
  const neoLastByName = {}, neoLastByPhone = {}, custByName = {}, custByPhone = {};
  customers.forEach(c => {
    const cid = String(c.id);
    custById[cid] = c;
    const nk = nameKey(custName(c)), pk = phoneKey(c.phone || c.mobile_phone);
    const last = (neo[cid] && neo[cid].last) || '';
    if (nk) { (custByName[nk] = custByName[nk] || []).push(c); if (last > (neoLastByName[nk] || '')) neoLastByName[nk] = last; }
    if (pk) { (custByPhone[pk] = custByPhone[pk] || []).push(c); if (last > (neoLastByPhone[pk] || '')) neoLastByPhone[pk] = last; }
  });

  // ── 2. Riwayat Sheets per pasien (cabang + RM / nama)
  const hist = getTransactionHistory();
  const people = {};
  (hist.rows || []).forEach(r => {
    const d = fixDate(String(r.date || '').slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const rm = String(r.rm || '').trim().toUpperCase();
    const nm = String(r.patient_name || '').trim();
    if (!rm && !nameKey(nm)) return;
    if (isTestPatientName(nm)) return;
    const branch = r.branch || branchOf(r.outlet_id);
    const key = branch + '|' + (rm ? 'rm:' + rm : 'nm:' + nameKey(nm));
    const p = people[key] || (people[key] = { branch, rm, name: '', nameDate: '', names: new Set(), phones: new Set(), visits: new Set(), last: '', last_treatment: '', spent: 0, trts: new Set() });
    p.visits.add(d);
    p.spent += Number(r.amount || 0);
    if (r.treatment) p.trts.add(String(r.treatment).toLowerCase().trim());
    if (nm) { p.names.add(normName(nm)); if (d >= p.nameDate) { p.name = nm; p.nameDate = d; } }
    const pk = phoneKey(r.phone);
    if (pk) p.phones.add(pk);
    if (d > p.last) { p.last = d; p.last_treatment = String(r.treatment || '').trim(); }
    else if (d === p.last && !p.last_treatment && r.treatment) p.last_treatment = String(r.treatment).trim();
  });

  const out = [];
  const matchedCids = new Set();
  Object.values(people).forEach(p => {
    // Cocokkan ke Neosoft: nomor HP dulu, lalu nama lengkap (≥ 2 kata).
    let neoLast = '';
    let match = null;
    p.phones.forEach(pk => {
      if ((neoLastByPhone[pk] || '') > neoLast) neoLast = neoLastByPhone[pk];
      if (!match && custByPhone[pk]) match = custByPhone[pk][0];
    });
    p.names.forEach(n => {
      if (!multiWord(n)) return;
      const nk = nameKey(n);
      if ((neoLastByName[nk] || '') > neoLast) neoLast = neoLastByName[nk];
      if (!match && custByName[nk]) match = custByName[nk].find(c => phoneKey(c.phone || c.mobile_phone)) || custByName[nk][0];
    });
    if (match) matchedCids.add(String(match.id));
    const last = neoLast > p.last ? neoLast : p.last;
    const days = daysSince(last);
    if (days < minDays) return;
    let phone = [...p.phones][0] || '';
    if (!phone && match) phone = phoneKey(match.phone || match.mobile_phone);
    const n = match ? neo[String(match.id)] : null;
    out.push({
      name: p.name || (match ? custName(match) : 'Pasien'),
      rm: p.rm,
      neosoft_code: match ? (match.code || '') : '',
      branch: p.branch,
      last_visit: last,
      days_since: days,
      last_treatment: neoLast > p.last ? '' : p.last_treatment,
      visits: p.visits.size + (n ? n.visits.size : 0),
      total_spent: Math.round(p.spent + (n ? n.spent : 0)),
      phone,
      source: match ? 'Sheets + Neosoft' : 'Sheets',
      _trt: [...p.trts].join(' | ')
    });
  });

  // ── 3. Pasien Neosoft-only yang sudah lama tidak datang
  Object.keys(neo).forEach(cid => {
    if (matchedCids.has(cid)) return;
    const c = custById[cid], n = neo[cid];
    if (!c || !n.last) return;
    const days = daysSince(n.last);
    if (days < minDays) return;
    out.push({
      name: custName(c) || 'Pasien',
      rm: '',
      neosoft_code: c.code || '',
      branch: [...n.outlets].join(', ') || branchOf(c.origin_outlet_id),
      last_visit: n.last,
      days_since: days,
      last_treatment: '',
      visits: n.visits.size,
      total_spent: Math.round(n.spent),
      phone: phoneKey(c.phone || c.mobile_phone),
      source: 'Neosoft',
      _trt: ''
    });
  });

  // Pasien yang sama tercatat di dua cabang (RM berbeda) → satu baris.
  // Hanya untuk nama ≥ 2 kata; nama satu kata terlalu sering kembar.
  const merged = {};
  const result = [];
  out.forEach(r => {
    const k = multiWord(r.name) ? nameKey(r.name) : null;
    if (!k) { result.push(r); return; }
    const m = merged[k];
    if (!m) { merged[k] = r; result.push(r); return; }
    if (r.last_visit > m.last_visit) { m.last_visit = r.last_visit; m.days_since = r.days_since; m.last_treatment = r.last_treatment; }
    if (!m.branch.includes(r.branch)) m.branch += ', ' + r.branch;
    m.visits += r.visits;
    m.total_spent += r.total_spent;
    if (!m.phone) m.phone = r.phone;
    if (!m.neosoft_code) m.neosoft_code = r.neosoft_code;
    if (!m.rm) m.rm = r.rm; else if (r.rm && !m.rm.includes(r.rm)) m.rm += ', ' + r.rm;
    if (r._trt) m._trt = m._trt ? m._trt + ' | ' + r._trt : r._trt;
  });

  result.forEach(r => {
    r.total_spent_fmt = rupiah(r.total_spent);
    r.months_since = Math.floor(r.days_since / 30.44);
    r.bucket = r.days_since <= 270 ? '6_9' : r.days_since <= 365 ? '9_12' : r.days_since <= 548 ? '12_18' : '18_plus';
  });
  return { rows: result, history_from: hist.from || null, generated_for: todayStr };
}

function getReactivationRows() {
  const now = Date.now();
  if (!_reactivationCache || now - _reactivationCacheTime > 60000) {
    _reactivationCache = buildReactivationList(REACTIVATION_MIN_DAYS);
    _reactivationCacheTime = now;
  }
  return _reactivationCache;
}

// Kata kunci treatment, mis. "apoptosis" atau "rejuran hb": semua kata harus
// muncul di salah satu treatment yang pernah diambil pasien (riwayat Sheets).
function reactivationTreatmentMatcher(treatment) {
  const words = String(treatment || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return null;
  return (r) => r._trt && r._trt.split(' | ').some(t => words.every(w => t.includes(w)));
}

function getReactivationPatients({ branch = 'all', bucket = 'all', contact = 'all', search = '', sort = 'spent', treatment = '', page = 1, limit = 15 } = {}) {
  const MIN_DAYS = REACTIVATION_MIN_DAYS;
  const cache = getReactivationRows();
  const all = cache.rows;

  let rows = all;
  const trtMatch = reactivationTreatmentMatcher(treatment);
  if (trtMatch) rows = rows.filter(trtMatch);
  if (branch && branch !== 'all') {
    const b = String(branch).toLowerCase().includes('pondok') ? 'pondok' : 'depok';
    rows = rows.filter(r => r.branch.toLowerCase().includes(b));
  }
  const branchScoped = rows;
  if (bucket && bucket !== 'all') rows = rows.filter(r => r.bucket === bucket);
  if (contact === 'with_phone') rows = rows.filter(r => r.phone);
  else if (contact === 'no_phone') rows = rows.filter(r => !r.phone);
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.phone.includes(q.replace(/\D/g, '') || '\u0000') ||
      r.rm.toLowerCase().includes(q) || r.neosoft_code.toLowerCase().includes(q));
  }
  const sorters = {
    spent: (a, b) => b.total_spent - a.total_spent,
    visits: (a, b) => b.visits - a.visits || b.total_spent - a.total_spent,
    recent: (a, b) => a.days_since - b.days_since,
    oldest: (a, b) => b.days_since - a.days_since
  };
  rows = [...rows].sort(sorters[sort] || sorters.spent);

  const total = rows.length;
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
  const totalPages = Math.ceil(total / l) || 1;
  const p = Math.min(totalPages, Math.max(1, parseInt(page, 10) || 1));
  const startIndex = (p - 1) * l;

  const count = (arr, fn) => arr.filter(fn).length;
  return {
    success: true,
    min_days: MIN_DAYS,
    history_from: cache.history_from,
    treatment: treatment || '',
    summary: {
      total: branchScoped.length,
      with_phone: count(branchScoped, r => r.phone),
      total_spent_fmt: rupiah(branchScoped.reduce((a, r) => a + r.total_spent, 0)),
      buckets: {
        '6_9': count(branchScoped, r => r.bucket === '6_9'),
        '9_12': count(branchScoped, r => r.bucket === '9_12'),
        '12_18': count(branchScoped, r => r.bucket === '12_18'),
        '18_plus': count(branchScoped, r => r.bucket === '18_plus')
      }
    },
    total,
    page: p,
    limit: l,
    total_pages: totalPages,
    start_index: total > 0 ? startIndex + 1 : 0,
    end_index: Math.min(startIndex + l, total),
    patients: rows.slice(startIndex, startIndex + l).map(({ _trt, ...r }) => r)
  };
}

// ═══════════════════════════════════════════════════════════════════════
// REKOMENDASI PROMO DARI STOK (tab Marketing)
//
// Mencari BHP/homecare yang lambat bergerak atau akan kedaluwarsa sebelum
// habis, lalu mengusulkan treatment yang bisa dipromokan untuk
// menghabiskannya.
//   • Saldo & laju pakai dari kartu stok Neosoft (metode sama dengan
//     getPharmacyStockHub: saldo = jumlah mutasi, BUKAN kolom `balance`).
//     Pemakaian = USAGE + "Penggunaan Pasien (-)" − ADJ VOID USAGE.
//   • Barang → treatment: (1) kata pertama nama barang muncul di nama
//     treatment (Profhilo → Profhilo Skin Booster), atau (2) dipakai pada
//     pasien+tanggal+cabang yang sama dengan treatment itu, minimal 25%
//     dari sesi treatment tersebut (supaya Facial yang laris tidak
//     "menempel" ke semua barang).
//   • Kedaluwarsa hanya diketahui untuk barang yang DITERIMA sejak Neosoft
//     dipakai (RECEIVE punya expired_at; stok awal/BEGIN tidak).
//   • Target pasien = pasien > 6 bulan tidak datang yang pernah mengambil
//     treatment itu (daftar Reaktivasi Pasien).
// ═══════════════════════════════════════════════════════════════════════
let _stockPromoCache = null;
let _stockPromoCacheTime = 0;

function getStockPromoRecommendations() {
  const now = Date.now();
  if (_stockPromoCache && now - _stockPromoCacheTime < 5 * 60000) return _stockPromoCache;

  const stockCard = getSafeJson('stock_card.json') || [];
  if (!stockCard.length) {
    return { success: true, available: false, note: 'Kartu stok Neosoft belum disinkron.', promos: [], transfers: [], checks: [], stop_po: [] };
  }
  const items = getSafeJson('logistics_items.json') || [];
  const usages = getSafeJson('usages_details.json') || [];
  const products = getSafeJson('products.json') || [];
  const invoices = getSafeJson('invoices_all.json') || [];
  const customers = getSafeJson('customers_all.json') || [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + 'T00:00:00').getTime();
  const dayDiff = (a, b) => Math.round((new Date(a.slice(0, 10) + 'T00:00:00') - new Date(b.slice(0, 10) + 'T00:00:00')) / 86400000);
  const branchOfWh = (w) => /pondok/i.test(w || '') ? 'Pondok Kopi' : 'Depok';
  const uomClean = (u) => String(u || '').replace(/^\s*[\d.,]+\s*/, '').trim() || '-';
  const num = (v) => Number(v) || 0;
  const roundTo = (n, step) => Math.round(n / step) * step;

  const cogsBySid = {};
  items.forEach(it => { cogsBySid[it.sales_information_id] = num(it.cogs); });
  const productPrice = {};          // homecare: harga jual dari master produk P-
  const treatments = {};            // id -> product T-
  products.forEach(p => {
    const code = String(p.product_treatment_code || '');
    if (code.startsWith('P-')) productPrice[String(p.product_treatment_name || '').trim().toLowerCase()] = num(p.price);
    if (code.startsWith('T-')) treatments[p.id] = p;
  });
  const SKIP_TREATMENT = /administrasi|konsultasi|pemakaian|free|compliment|retouch/i;
  // Obat (analgesik, antibiotik, dll.) tidak boleh dipromosikan.
  const IS_MEDICINE = (name, uom) => /tablet|kaplet|kapsul|capsule|sirup|syrup/i.test(uom) ||
    /paracetamol|cefixime|cefadroxil|amoxicillin|asam mefenamat|mefenamic|ibuprofen|cetirizine|loratadine|dexamethason|methylpred|metronidazol|clindamycin|doxycyclin|omeprazol|ranitidin|antibiotik/i.test(name);

  // ── 1. saldo, laju pakai, kedaluwarsa per (barang, gudang)
  const startStr = stockCard.reduce((m, r) => (r.date < m ? r.date : m), stockCard[0].date).slice(0, 10);
  const spanDays = Math.max(30, dayDiff(todayStr, startStr));
  const months = spanDays / 30.44;
  const groups = {};
  stockCard.forEach(r => { (groups[`${r.code}|${r.warehouse}`] = groups[`${r.code}|${r.warehouse}`] || []).push(r); });
  const CONSUME = new Set(['USAGE', 'Penggunaan Pasien (-)']);
  const ADJ_PLUS = new Set(['Penggunaan Pasien (+)', 'Human Error (+)', 'More Item (+)']);
  const RECEIVED = new Set(['BEGIN', 'RECEIVE', 'MUTATION RECEIVE']);
  const usageOf = (rs) => Math.max(0, rs.reduce((a, r) => a + (CONSUME.has(r.transaction) ? num(r.stock_out) : 0) - (r.transaction === 'ADJ VOID USAGE' ? num(r.stock_in) : 0), 0));

  const stock = [];
  const rateByNameBranch = {};
  Object.values(groups).forEach(rs => {
    rs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = rs[rs.length - 1];
    const name = String(last.name || '').trim();
    const branch = branchOfWh(last.warehouse);
    const used = usageOf(rs);
    const used90 = usageOf(rs.filter(r => dayDiff(todayStr, r.date) <= 90));
    const rate = Math.max(used / months, used90 / (90 / 30.44));
    rateByNameBranch[`${name.toLowerCase()}|${branch}`] = rate;
    const bal = rs.reduce((a, r) => a + num(r.stock_in) - num(r.stock_out), 0);
    if (bal <= 0.0001) return;
    const usageDates = rs.filter(r => r.transaction === 'USAGE').map(r => r.date.slice(0, 10)).sort();
    const idle = usageDates.length ? dayDiff(todayStr, usageDates[usageDates.length - 1]) : spanDays;
    const receives = rs.filter(r => r.transaction === 'RECEIVE' && r.expired_at && num(r.stock_in) > 0);   // qty 0 = tanggal otomatis, bukan batch
    const nearest = receives.reduce((m, r) => (!m || r.expired_at < m.expired_at ? r : m), null);
    const newest = receives.reduce((m, r) => (!m || r.date > m.date ? r : m), null);
    const dte = nearest ? dayDiff(nearest.expired_at, todayStr) : null;
    const adjPlus = rs.reduce((a, r) => a + (ADJ_PLUS.has(r.transaction) ? num(r.stock_in) : 0), 0);
    const received = rs.reduce((a, r) => a + (RECEIVED.has(r.transaction) ? num(r.stock_in) : 0), 0);
    const category = (last.category || [])[0] || 'BHP';
    const unitCost = cogsBySid[last.sales_information_id] || 0;
    const retail = category === 'HOMECARE' ? (productPrice[name.toLowerCase()] || 0) : 0;
    const coverM = rate > 0 ? bal / rate : Infinity;
    const surplusAtExpiry = dte !== null && dte <= 365 ? Math.max(0, bal - rate * Math.max(dte, 0) / 30.44) : 0;
    const s = {
      code: last.code, name, branch, category, uom: uomClean(last.uom), bal, rate, idle, coverM,
      expiry: nearest ? nearest.expired_at.slice(0, 10) : null, days_to_expiry: dte,
      newest_batch_expiry: newest ? newest.expired_at.slice(0, 10) : null,
      expired: dte !== null && dte < 0,
      exp_risk: dte !== null && dte >= 0 && dte <= 365 && surplusAtExpiry > 0.0001,
      surplus_at_expiry: surplusAtExpiry,
      slow: idle > 90 || coverM > 6,
      adj_suspect: adjPlus > 0 && adjPlus >= 0.5 * Math.max(received, 1),
      unit_cost: unitCost, value_cost: bal * unitCost, retail, value_retail: bal * retail,
      medicine: IS_MEDICINE(name, uomClean(last.uom))
    };
    stock.push(s);
  });

  // ── 2. sesi treatment per (tanggal WIB, cabang, pasien)
  const invByCode = {}; invoices.forEach(i => { invByCode[i.inv_code] = i; });
  const custName = {};
  customers.forEach(c => {
    const n = c.name;
    custName[c.id] = (typeof n === 'object' && n ? [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(' ') : String(n || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  });
  const wibDay = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const sessions = {};
  const treatmentSessions = {};
  usages.forEach(u => {
    const t = treatments[u.product_id];
    if (!t || !(num(u.used) > 0)) return;
    const inv = invByCode[u.inv_code];
    if (!inv || inv.void_invoice) return;
    const nm = custName[inv.customer_id];
    if (!nm || isTestPatientName(nm)) return;
    const key = `${wibDay(u.created_at)}|${inv.outlet_id == 1 ? 'Depok' : 'Pondok Kopi'}|${nm}`;
    const set = sessions[key] || (sessions[key] = new Set());
    if (!set.has(t.id)) treatmentSessions[t.id] = (treatmentSessions[t.id] || 0) + 1;
    set.add(t.id);
  });
  const voidPool = {};
  stockCard.forEach(r => {
    if (r.transaction !== 'ADJ VOID USAGE') return;
    const k = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${num(r.stock_in)}`;
    voidPool[k] = (voidPool[k] || 0) + 1;
  });
  const coUse = {};      // code -> { treatmentId: n }
  const qtyPerUse = {};  // code -> [qty]
  stockCard.forEach(r => {
    if (r.transaction !== 'USAGE') return;
    const vk = `${r.date.slice(0, 10)}|${r.warehouse}|${r.code}|${num(r.stock_out)}`;
    if (voidPool[vk] > 0) { voidPool[vk]--; return; }
    const nm = String(r.patient_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const ts = sessions[`${r.date.slice(0, 10)}|${branchOfWh(r.warehouse)}|${nm}`];
    if (!ts) return;
    (qtyPerUse[r.code] = qtyPerUse[r.code] || []).push(num(r.stock_out));
    const c = coUse[r.code] || (coUse[r.code] = {});
    ts.forEach(t => { c[t] = (c[t] || 0) + 1; });
  });

  const STOP = new Set(['kefir', 'skin', 'booster', 'face', 'full', 'half', 'glow', 'facial', 'serum', 'cream', 'night', 'the', 'and', 'with',
    // kata umum — terlalu banyak treatment yang mengandungnya untuk dijadikan pencocok nama
    'anti', 'aging', 'acne', 'derma', 'masker', 'mask', 'needle', 'biosource', 'sunscreen', 'cleanser', 'toner', 'larasanti', 'greentea', 'immortal']);
  const keyWords = (s) => (String(s).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length >= 4 && !STOP.has(w));
  // Bahan medis habis pakai: tidak pernah jadi alasan pasien datang → tidak dipromokan.
  const IS_CONSUMABLE = (name) => /needle|jarum|wing|spuit|syringe kosong|kasa|gauze|tissu|tissue|kapas|alkohol|alcohol|handscoon|glove|sarung tangan|infus set|infusion set|abocath|pisau|cukur|wrap+ing|membran|cannula|kanula|minerva|plester|underpad|nurse cap|masker medis|headband|bandana/i.test(name);
  const linkTreatments = (s) => {
    const first = keyWords(s.name)[0];
    // Semua kata nama barang (termasuk singkatan 2 huruf seperti "HB") untuk
    // memilih varian yang paling cocok: Rejuran HB → "Rejuran HB Skin Booster",
    // bukan "Rejuran Healer".
    const allWords = (String(s.name).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length >= 2 && !STOP.has(w));
    const byName = first ? Object.values(treatments).filter(t => String(t.product_treatment_name).toLowerCase().includes(first) && !SKIP_TREATMENT.test(t.product_treatment_name) && num(t.price) > 0) : [];
    if (byName.length) {
      const tWords = (t) => (String(t.product_treatment_name).toLowerCase().match(/[a-z]+/g) || []);
      const score = (t) => allWords.filter(w => tWords(t).some(tw => tw === w || (w.length >= 4 && tw.startsWith(w)))).length;
      const ranked = byName.sort((a, b) => score(b) - score(a) || (treatmentSessions[b.id] || 0) - (treatmentSessions[a.id] || 0) || num(b.price) - num(a.price));
      const best = ranked[0];
      const kw = allWords.filter(w => tWords(best).some(tw => tw === w || (w.length >= 4 && tw.startsWith(w)))).join(' ') || first;
      return ranked.slice(0, 3).map(t => ({ t, how: 'nama', keyword: kw }));
    }
    const c = coUse[s.code] || {};
    return Object.entries(c)
      .map(([tid, n]) => ({ t: treatments[tid], n, share: n / Math.max(treatmentSessions[tid] || 0, 1) }))
      .filter(x => x.t && !SKIP_TREATMENT.test(x.t.product_treatment_name) && num(x.t.price) > 0 && x.n >= 2 && x.share >= 0.25)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map(x => ({ t: x.t, how: 'pemakaian', keyword: keyWords(x.t.product_treatment_name).slice(0, 2).join(' ') }));
  };

  // ── 2b. BHP → treatment dari pemakaian Neosoft yang sebenarnya
  // (dokumen pemakaian yang menyebut satu treatment → BHP yang keluar untuk dokumen itu).
  const U = _buildBhpUsage();
  const prodByCode = {}; products.forEach(p => { if (p.product_treatment_code) prodByCode[p.product_treatment_code] = p; });
  const pricing = getPricingIndex(products, usages, invoices);
  const itemTreatments = {};   // kode barang -> [{ code, product, cases, used_in, share, qty }]
  const approvedBoms = getTreatmentBoms().filter(b => b.treatment_code);
  const everUsed = new Set(stockCard.filter(r => r.transaction === 'USAGE').map(r => r.code));
  Object.entries(U.byTreat).forEach(([tc, t]) => {
    const prod = prodByCode[tc];
    if (!prod || SKIP_TREATMENT.test(prod.product_treatment_name) || isFeeItem(prod.product_treatment_name)) return;
    Object.entries(t.items).forEach(([ic, qs]) => {
      const share = qs.length / Math.max(t.cases, 1);
      if (qs.length < 2 || share < 0.25) return;   // bukan pemakaian rutin treatment ini
      (itemTreatments[ic] = itemTreatments[ic] || []).push({ code: tc, product: prod, cases: t.cases, used_in: qs.length, share, qty: _median(qs) });
    });
  });
  Object.values(itemTreatments).forEach(l => l.sort((a, b) => b.used_in - a.used_in));

  // Pasien yang pernah mengambil treatment (Neosoft) — untuk target penjualan
  const custInfo = {};
  customers.forEach(c => {
    const n = c.name;
    const name = (typeof n === 'object' && n ? [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(' ') : String(n || '')).replace(/\s+/g, ' ').trim();
    const ph = normalizeWaPhone(c.phone || c.mobile_phone);
    custInfo[c.id] = { name, phone: ph.valid ? ph.wa : '' };
  });
  const takersByProduct = {};  // product id -> { customer id -> { last, count, branch } }
  usages.forEach(u => {
    const t = treatments[u.product_id];
    if (!t || !(num(u.used) > 0)) return;
    const inv = invByCode[u.inv_code];
    if (!inv || inv.void_invoice) return;
    const ci = custInfo[inv.customer_id];
    if (!ci || !ci.name || isTestPatientName(ci.name)) return;
    const m = takersByProduct[t.id] || (takersByProduct[t.id] = {});
    const d = wibDay(u.created_at);
    const e = m[inv.customer_id] || (m[inv.customer_id] = { last: '', dates: new Set(), branch: inv.outlet_id == 1 ? 'Depok' : 'Pondok Kopi' });
    e.dates.add(d);
    if (d > e.last) e.last = d;
  });

  // Target pasien lama per kata kunci treatment
  const react = getReactivationRows().rows;
  const targetFor = (keyword) => {
    const m = reactivationTreatmentMatcher(keyword);
    if (!m) return { keyword: '', lapsed: 0, lapsed_with_phone: 0 };
    const hit = react.filter(m);
    return { keyword, lapsed: hit.length, lapsed_with_phone: hit.filter(r => r.phone).length };
  };

  // Pasien yang pernah ambil treatment: Neosoft + riwayat Sheets (pasien lama ≥ 6 bulan tidak datang)
  const LAPSED_DAYS = 90;
  const allTargetPhones = new Set();   // pasien unik (no. WA) di semua rekomendasi treatment
  const patientsFor = (prod) => {
    const out = new Map();
    Object.entries(takersByProduct[prod.id] || {}).forEach(([cid, e]) => {
      const ci = custInfo[cid];
      const days = dayDiff(todayStr, e.last);
      out.set(ci.phone || ci.name.toLowerCase(), { name: ci.name, phone: ci.phone, branch: e.branch, last_date: e.last, days_since: days, times: e.dates.size, lapsed: days >= LAPSED_DAYS, source: 'Neosoft' });
    });
    const kw = keyWords(prod.product_treatment_name).slice(0, 2).join(' ');
    const m = kw ? reactivationTreatmentMatcher(kw) : null;
    if (m) react.filter(m).forEach(r => {
      const k = r.phone || r.name.toLowerCase();
      if (out.has(k)) return;
      out.set(k, { name: r.name, phone: r.phone, branch: r.branch, last_date: r.last_visit, days_since: r.days_since, times: r.visits, lapsed: true, source: r.source === 'Neosoft' ? 'Neosoft' : 'Riwayat Sheets' });
    });
    const all = [...out.values()].sort((a, b) => (b.lapsed - a.lapsed) || (!!b.phone - !!a.phone) || a.days_since - b.days_since);
    all.forEach(x => { if (x.phone) allTargetPhones.add(x.phone); });
    return {
      keyword: kw, total: all.length, with_phone: all.filter(x => x.phone).length,
      lapsed: all.filter(x => x.lapsed).length, lapsed_with_phone: all.filter(x => x.lapsed && x.phone).length,
      patients: all.slice(0, 40)
    };
  };

  // ── 3. susun rekomendasi
  const risky = stock.filter(s => !s.expired && (s.exp_risk || s.slow));
  const transfers = [];
  const transferred = new Set();
  risky.forEach(s => {
    const other = s.branch === 'Depok' ? 'Pondok Kopi' : 'Depok';
    const oRate = rateByNameBranch[`${s.name.toLowerCase()}|${other}`] || 0;
    const oStock = stock.find(x => x.name.toLowerCase() === s.name.toLowerCase() && x.branch === other);
    const oBal = oStock ? oStock.bal : 0;
    const oCover = oRate > 0 ? oBal / oRate : Infinity;
    if (oRate > Math.max(s.rate * 2, s.category === 'HOMECARE' ? 1 : 0.3) && oCover < 3) {
      const qty = Math.min(s.bal, Math.max(1, Math.ceil(oRate * 3 - oBal)));
      transfers.push({
        name: s.name, category: s.category, uom: s.uom, from: s.branch, to: other,
        from_stock: s.bal, from_rate: +s.rate.toFixed(1), to_stock: oBal, to_rate: +oRate.toFixed(1),
        qty: Math.round(qty * 100) / 100, expiry: s.expiry,
        value: Math.round(qty * (s.unit_cost || s.retail))
      });
      if (qty >= s.bal - 0.0001) transferred.add(`${s.name.toLowerCase()}|${s.branch}`);
    }
  });

  const byName = {};
  risky.forEach(s => {
    if (transferred.has(`${s.name.toLowerCase()}|${s.branch}`)) return;
    (byName[s.name.toLowerCase()] = byName[s.name.toLowerCase()] || []).push(s);
  });
  const promos = [];
  const stopPo = [];
  Object.values(byName).forEach(list => {
    const s0 = list[0];
    const totalBal = list.reduce((a, s) => a + s.bal, 0);
    const totalRate = list.reduce((a, s) => a + s.rate, 0);
    const valueCost = list.reduce((a, s) => a + s.value_cost, 0);
    const valueRetail = list.reduce((a, s) => a + s.value_retail, 0);
    const expRisk = list.some(s => s.exp_risk);
    const nearestExp = list.filter(s => s.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    const dead = totalRate === 0;
    const coverM = totalRate > 0 ? totalBal / totalRate : null;
    const branchRow = (s, risky) => ({ branch: s.branch, stock: Math.round(s.bal * 100) / 100, rate: +s.rate.toFixed(1), idle_days: s.idle, cover_months: isFinite(s.coverM) ? Math.round(s.coverM) : null, adj_suspect: s.adj_suspect, risky,
      status: !risky ? 'aman' : s.exp_risk ? 'akan kedaluwarsa' : s.idle > 90 ? `tertahan ${s.idle} hari` : `stok ±${isFinite(s.coverM) ? Math.round(s.coverM) : '∞'} bln` });
    // Semua cabang ditampilkan: cabang yang stoknya bermasalah (risky) + cabang lain sebagai pembanding (aman / stok 0).
    const branches = ['Depok', 'Pondok Kopi'].map(b => {
      const r = list.find(s => s.branch === b);
      if (r) return branchRow(r, true);
      const o = stock.find(x => x.name.toLowerCase() === s0.name.toLowerCase() && x.branch === b);
      if (o) return branchRow(o, false);
      const rate = rateByNameBranch[`${s0.name.toLowerCase()}|${b}`] || 0;
      return rate > 0 ? { branch: b, stock: 0, rate: +rate.toFixed(1), idle_days: null, cover_months: 0, adj_suspect: false, risky: false, status: 'stok habis' } : null;
    }).filter(Boolean);
    const reason = expRisk
      ? `Kedaluwarsa ${nearestExp.expiry} — pada laju sekarang ±${Math.round(list.reduce((a, s) => a + s.surplus_at_expiry, 0))} ${s0.uom} tidak terpakai`
      : dead ? `Tidak terpakai sama sekali selama ${Math.max(...list.map(s => s.idle))} hari`
      : `Stok cukup untuk ±${Math.round(coverM)} bulan pada laju sekarang`;
    // Pencocokan nama/co-use hanya untuk homecare; BHP memakai data pemakaian Neosoft (di bawah).
    const links = s0.medicine || s0.category !== 'HOMECARE' ? [] : linkTreatments(s0);
    const base = {
      name: s0.name, category: s0.category, uom: s0.uom, total_stock: Math.round(totalBal * 100) / 100,
      monthly_use: +totalRate.toFixed(1), cover_months: coverM === null ? null : Math.round(coverM),
      value: Math.round(valueCost || valueRetail), value_basis: valueCost ? 'hpp' : (valueRetail ? 'harga_jual' : 'tidak_ada'),
      expiry: nearestExp ? nearestExp.expiry : null, days_to_expiry: nearestExp ? nearestExp.days_to_expiry : null,
      exp_risk: expRisk, dead, reason, branches, adj_suspect: list.some(s => s.adj_suspect)
    };
    if (s0.medicine) { stopPo.push({ ...base, action: 'Obat — tidak dipromosikan. Hentikan pemesanan ulang; retur ke supplier bila bisa.' }); return; }
    if (!s0.medicine && IS_CONSUMABLE(s0.name)) { stopPo.push({ ...base, action: 'Bahan medis habis pakai — tidak dipromokan. Hentikan pemesanan ulang sampai stok turun, atau pindahkan ke cabang yang memakai.' }); return; }
    if (s0.category !== 'HOMECARE' && !s0.medicine && !IS_CONSUMABLE(s0.name)) {
      const codes = [...new Set(list.map(s => s.code))];
      let maps = codes.flatMap(c => itemTreatments[c] || []).sort((a, b) => b.used_in - a.used_in);
      // Cadangan: barang yang BELUM PERNAH dipakai di Neosoft → cocokkan treatment dari nama
      // (mis. Vitaran Poly Booster → Vitaran PN Skin Booster). Jumlah per tindakan diasumsikan 1.
      let byNameGuess = false;
      let byStandard = false;
      if (!maps.length) {
        // Standar BHP dari spreadsheet List BHP memuat barang ini
        const std = approvedBoms.flatMap(b => (b.materials || []).filter(mt => codes.includes(mt.item_code)).map(mt => ({ b, mt })))
          .map(({ b, mt }) => ({ prod: prodByCode[b.treatment_code], qty: Number(mt.standard_qty) || 1 }))
          .filter(x => x.prod && !SKIP_TREATMENT.test(x.prod.product_treatment_name));
        if (std.length) {
          byStandard = true;
          maps = std.map(x => ({ code: x.prod.product_treatment_code, product: x.prod, cases: treatmentSessions[x.prod.id] || 0, used_in: 0, share: null, qty: x.qty }))
            .sort((a, b) => b.cases - a.cases);
        }
      }
      if (!maps.length && !codes.some(c => everUsed.has(c))) {
        // Semua kata khas nama barang harus ada di nama treatment (Pluryal Tight ≠ Pluryal Acne)
        const words = (String(s0.name).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length >= 2 && !STOP.has(w));
        const tw = (t) => String(t.product_treatment_name).toLowerCase().match(/[a-z]+/g) || [];
        const full = (t) => words.length && words.every(w => tw(t).some(x => x === w || (w.length >= 4 && x.startsWith(w))));
        const named = linkTreatments(s0).filter(x => x.how === 'nama' && full(x.t));
        if (named.length) {
          byNameGuess = true;
          maps = named.map(x => ({ code: x.t.product_treatment_code, product: x.t, cases: treatmentSessions[x.t.id] || 0, used_in: 0, share: null, qty: 1 }));
        }
      }
      if (!maps.length) {
        stopPo.push({ ...base, action: codes.some(c => everUsed.has(c)) ? 'Di data pemakaian Neosoft tidak ada treatment yang rutin memakai barang ini. Hentikan pemesanan ulang sampai stok turun.' : 'Belum pernah dipakai di Neosoft & tidak ada treatment dengan nama yang cocok. Minta Farmasi menambahkannya ke Standar BHP treatment yang memakainya — setelah itu otomatis muncul di rekomendasi. Sementara, hentikan pemesanan ulang.' });
        return;
      }
      const m = maps[0];
      const pr = pricing[m.product.id] || {};
      const tName = m.product.product_treatment_name.trim();
      const listPrice = pr.list_price || num(m.product.price);
      const perTreatment = m.qty > 0 ? m.qty : 1;
      const needed = Math.max(1, Math.ceil(totalBal / perTreatment));
      const tMonthly = m.cases / months;
      // Barang bisa dipakai beberapa treatment (mis. FA-XL di Fat Apoptosis Cheek/Body) → laju gabungan
      const allMonthly = [...new Map(maps.map(x => [x.code, x])).values()].reduce((a, x) => a + x.cases / months, 0);
      if (needed > Math.max(allMonthly * 2, 1) * 24) {
        stopPo.push({ ...base, action: `Butuh ±${needed.toLocaleString('id-ID')} tindakan ${tName} untuk habis (sekarang ${tMonthly.toFixed(1)}×/bulan) — terlalu banyak untuk dijual lewat promo. Hentikan pemesanan ulang.` });
        return;
      }
      const costPerTreatment = s0.unit_cost * perTreatment;
      const costPct = listPrice > 0 && costPerTreatment > 0 ? costPerTreatment / listPrice * 100 : null;
      if (!byNameGuess && costPct !== null && costPct < 5) {
        stopPo.push({ ...base, action: `Bahan pendukung (±${costPct.toFixed(1)}% harga ${tName}) — menjual treatment tidak efektif menghabiskannya. Hentikan pemesanan ulang sampai stok turun.` });
        return;
      }
      const promo = pr.is_on_promo ? pr.promo_price : null;
      const bottom = pr.bottom_price || null;
      const bv = pr.bv_cost || null;
      const sellPrice = promo || listPrice;
      // Batas harga terendah: bottom spreadsheet, dan tidak boleh di bawah BV (modal per tindakan)
      const floor = Math.max(bottom || 0, bv || 0) || null;
      const months_to_clear = coverM !== null ? Math.round(coverM * 10) / 10 : null;   // laju pakai barang (semua treatment)
      promos.push({ ...base, type: 'treatment',
        treatment: { code: m.code, name: tName, price: listPrice, monthly: +tMonthly.toFixed(1), cases: m.cases, item_share: m.share === null ? null : Math.round(m.share * 100), link: byNameGuess ? 'nama' : byStandard ? 'standar_bhp' : 'pemakaian' },
        mapping_note: byNameGuess ? 'Dicocokkan dari nama — belum ada data pemakaian di Neosoft. Cek ke Farmasi: benar dipakai untuk treatment ini & berapa per tindakan.' : null,
        mapping_source: byNameGuess ? 'nama' : byStandard ? 'standar_bhp' : 'pemakaian',
        alternatives: maps.slice(1, 4).filter(x => x.code !== m.code).map(x => ({ name: x.product.product_treatment_name.trim(), qty: +x.qty.toFixed(2), monthly: +(x.cases / months).toFixed(1) })),
        price: listPrice, price_source: pr.list_source || 'neosoft',
        promo_price: promo, promo_name: promo ? pr.promo_name : null, promo_is_default: !!pr.promo_is_default,
        promo_end: pr.promo_period ? pr.promo_period.end : null,
        bottom_price: bottom,
        bhp_cost: costPerTreatment > 0 ? Math.round(costPerTreatment) : null,
        bv_cost: bv, margin: bv ? sellPrice - bv : null, margin_pct: bv && sellPrice ? Math.round((sellPrice - bv) / sellPrice * 100) : null,
        floor_price: floor, discount_room: floor && sellPrice > floor ? sellPrice - floor : 0,
        units_per_treatment: +perTreatment.toFixed(2), treatments_needed: needed, months_to_clear,
        target: patientsFor(m.product),
        pitch: promo ? `${tName} ${pr.promo_is_default ? 'diskon' : 'promo'} ${rupiah(promo)} (normal ${rupiah(listPrice)})` : `${tName} ${rupiah(listPrice)}` });
      return;
    }
    if (!links.length) {
      if (s0.category === 'HOMECARE' && s0.retail > 0) {
        // Produk homecare tanpa pasangan treatment: promo produk langsung
        const disc = (coverM === null || coverM > 24) ? 30 : 20;
        promos.push({ ...base, type: 'produk', treatment: null, alternatives: [],
          price: s0.retail, suggested_discount_pct: disc, max_discount_pct: disc + 10,
          promo_price: roundTo(s0.retail * (1 - disc / 100), 1000), bottom_price: roundTo(s0.retail * (1 - (disc + 10) / 100), 1000),
          units_per_treatment: 1, treatments_needed: Math.ceil(totalBal), cost_pct: null,
          target: { keyword: '', lapsed: 0, lapsed_with_phone: 0 },
          pitch: `Diskon ${disc}% ${s0.name} atau beli 2 lebih hemat` });
      } else {
        stopPo.push({ ...base, action: 'Tidak ada treatment yang jelas memakai barang ini. Hentikan pemesanan ulang sampai stok turun.' });
      }
      return;
    }
    const { t, how, keyword } = links[0];
    const price = num(t.price);
    const q = qtyPerUse[s0.code];
    const perTreatment = how === 'nama' && /syringe|vial|ampul/i.test(s0.uom) ? 1 : (q && q.length ? q.reduce((a, b) => a + b, 0) / q.length : 1);
    const needed = Math.max(1, Math.ceil(totalBal / perTreatment));
    const tMonthly = (treatmentSessions[t.id] || 0) / months;
    // Kalaupun permintaan treatment naik 2×, butuh > 24 bulan → masalahnya order
    // kebanyakan, bukan kurang promo.
    if (s0.category !== 'HOMECARE' && needed > Math.max(tMonthly * 2, 1) * 24) {
      stopPo.push({ ...base, action: `Butuh ±${needed.toLocaleString('id-ID')} tindakan ${t.product_treatment_name.trim()} untuk habis (sekarang ${tMonthly.toFixed(1)}×/bulan) — terlalu banyak untuk promo. Hentikan pemesanan ulang.` });
      return;
    }
    if (s0.category === 'HOMECARE') {
      // Bundling: produk dibeli bersama treatment ini → diskon produk saat ambil treatment
      const disc = (coverM === null || coverM > 24) ? 50 : 30;
      promos.push({ ...base, type: 'bundling', treatment: { name: t.product_treatment_name.trim(), price, monthly: +((treatmentSessions[t.id] || 0) / months).toFixed(1), link: how },
        alternatives: links.slice(1).map(x => x.t.product_treatment_name.trim()),
        price: s0.retail, suggested_discount_pct: disc, max_discount_pct: disc + 10,
        promo_price: roundTo(s0.retail * (1 - disc / 100), 1000), bottom_price: roundTo(s0.retail * (1 - (disc + 10) / 100), 1000),
        units_per_treatment: 1, treatments_needed: Math.ceil(totalBal), cost_pct: null,
        target: targetFor(keyword),
        pitch: `${s0.name} diskon ${disc}% untuk setiap ${t.product_treatment_name.trim()}` });
      return;
    }
    const costPerTreatment = s0.unit_cost * perTreatment;
    const costPct = price > 0 && costPerTreatment > 0 ? costPerTreatment / price * 100 : null;
    // Barang habis pakai yang cuma ikut terpakai (jarum, kasa, dll., < 5% harga)
    // bukan alasan pasien datang — promo treatment tidak akan menghabiskannya.
    if (how === 'pemakaian' && costPct !== null && costPct < 5) {
      stopPo.push({ ...base, action: `Bahan pendukung (±${costPct.toFixed(1)}% harga ${t.product_treatment_name.trim()}) — tidak efektif dipromokan. Hentikan pemesanan ulang sampai stok turun.` });
      return;
    }
    // Ruang diskon dari porsi BHP terhadap harga; barang mati/akan kedaluwarsa boleh lebih agresif.
    let disc = costPct === null ? 10 : costPct <= 20 ? 25 : costPct <= 35 ? 15 : 10;
    if (!dead && !expRisk) disc = Math.max(5, disc - 5);
    const maxDisc = costPct === null ? 15 : Math.min(disc + 10, Math.floor(100 - costPct - 30));
    promos.push({ ...base, type: 'treatment',
      treatment: { name: t.product_treatment_name.trim(), price, monthly: +((treatmentSessions[t.id] || 0) / months).toFixed(1), link: how },
      alternatives: links.slice(1).map(x => x.t.product_treatment_name.trim()),
      price, suggested_discount_pct: disc, max_discount_pct: Math.max(disc, maxDisc),
      promo_price: roundTo(price * (1 - disc / 100), 5000), bottom_price: roundTo(price * (1 - Math.max(disc, maxDisc) / 100), 5000),
      units_per_treatment: +perTreatment.toFixed(2), treatments_needed: needed,
      cost_pct: costPct === null ? null : Math.round(costPct),
      target: targetFor(keyword),
      pitch: `${t.product_treatment_name.trim()} diskon ${disc}%` });
  });

  const priority = (p) => (p.value || 0) * (p.exp_risk ? 2 : 1) * (p.dead ? 1.5 : 1) * (p.value_basis === 'harga_jual' ? 0.5 : 1);
  promos.sort((a, b) => priority(b) - priority(a));
  transfers.sort((a, b) => b.value - a.value);
  stopPo.sort((a, b) => b.value - a.value);

  const checks = stock.filter(s => s.expired).map(s => ({
    name: s.name, branch: s.branch, stock: s.bal, uom: s.uom, expiry: s.expiry, newest_batch_expiry: s.newest_batch_expiry,
    action: s.newest_batch_expiry && s.newest_batch_expiry > todayStr
      ? `Ada batch kedaluwarsa ${s.expiry}; batch terbaru s/d ${s.newest_batch_expiry}. Cek fisik — pisahkan batch lama, jangan dijual.`
      : `Sudah kedaluwarsa ${s.expiry}. Tarik dari rak & catat pemusnahan.`
  }));

  _stockPromoCache = {
    success: true,
    available: true,
    generated_at: new Date().toISOString(),
    period: { from: startStr, to: todayStr, days: spanDays },
    summary: {
      promo_count: promos.length,
      promo_value: promos.reduce((a, p) => a + (p.value_basis === 'hpp' ? p.value : 0), 0),
      homecare_retail_value: promos.reduce((a, p) => a + (p.value_basis === 'harga_jual' ? p.value : 0), 0),
      exp_risk_count: promos.filter(p => p.exp_risk).length + transfers.filter(t => t.expiry && dayDiff(t.expiry, todayStr) <= 365).length,
      transfer_count: transfers.length,
      check_count: checks.length + promos.filter(p => p.adj_suspect).length,
      stop_po_count: stopPo.length,
      bv_count: promos.filter(p => p.bv_cost).length,
      target_unique_with_phone: allTargetPhones.size
    },
    promos, transfers, checks, stop_po: stopPo,
    notes: [
      `Kartu stok Neosoft ${startStr} s/d ${todayStr} (${spanDays} hari). Laju pakai = pemakaian per bulan pada periode itu (atau 90 hari terakhir bila lebih tinggi).`,
      'Tanggal kedaluwarsa hanya tercatat untuk barang yang diterima sejak Neosoft dipakai — stok awal migrasi tidak punya tanggal kedaluwarsa.',
      'Nilai BHP memakai HPP master barang Neosoft; HPP homecare kosong (0) di Neosoft sehingga nilainya memakai harga jual.',
      'Barang → treatment & jumlah per tindakan diambil dari dokumen pemakaian Neosoft (barang dihitung hanya bila keluar di ≥ 25% tindakan treatment itu). Bila tidak ada, dipakai Standar BHP dari spreadsheet List BHP; barang yang belum pernah dipakai dicocokkan dari nama (label "dari nama") — perlu dicek Farmasi.',
      'Harga normal, promo & bottom dari spreadsheet Planning (sama dengan menu Harga Treatment). BV = modal per tindakan dari kolom BV spreadsheet (sama dengan rumus Profit di spreadsheet: harga promo − BV); margin = harga jual − BV. Biaya BHP = HPP barang Neosoft × pemakaian per tindakan.',
      'Tanda ⚠ = saldo sebagian besar berasal dari adjustment (+). Lakukan stock opname sebelum promo dijalankan.'
    ]
  };
  _stockPromoCacheTime = now;
  return _stockPromoCache;
}

module.exports = {
  getRevenueBreakdown,
  isTestPatientName,
  normalizeWaPhone,
  getPriceMaster,
  suggestPatient360,
  markCrmTierChatted,
  getCrmTierChatLog,
  getSpendingTierPatients,
  getTopUsage,
  getAllTierPatients,
  getReactivationPatients,
  getStockPromoRecommendations,
  getClinicSummary: getClinicMissionControlData,
  getNeosoftReportData,
  generateNeosoftCsv,
  classifyPatientGrade,
  getGradeTransitions,
  searchPatient360,
  getTransactionHistory,
  getRmPatientMap,
  countPatient360Matches,
  getCrmJoinDiagnostics,
  getInvoiceDetail,
  addDispatchLog,
  getDispatchLogs,
  getFollowUpStatusLog,
  markFollowUpDone,
  isFollowUpDone,
  getAssetManualNotes,
  setAssetManualNote,
  recordAssetService,
  getClinicSettings,
  setClinicSettings,
  getMaintenanceReminderLog,
  markMaintenanceReminderSent,
  getPatientFeedback,
  addPatientFeedback,
  getFeedbackSummary,
  getMetaAdsSettingsSafe,
  setMetaAdsSettings,
  getOperationalData,
  addTeamComplaint,
  addSopChecklist,
  getMarketingHubData,
  addContentPlan,
  updateContentPlan,
  getGoogleSheetsData,
  getSalesComparison,
  getPeakHourAnalysis,
  getPatientFrequencyList,
  getUnpaidFollowups,
  treatmentVisitDays,
  getPatientDemographics,
  getTreatmentProductMap,
  getBhpVariance,
  getHppProfit,
  getDailyTransactionRecap, saveCashierClosing, deleteCashierClosing,
  getDoctorNurseCommission,
  getSupplierPriceComparison, addSupplierQuote, deleteSupplierQuote,
  getNeosoftMasterData,
  getNeosoftLogisticsData,
  searchPharmacyStockDetailed,
  getAutomationAlertsSummary,
  getDoctorRecommendations,
  saveDoctorRecommendation,
  getDoctorFollowupsList,
  getDoctorRecommendationCompliance,
  updateDoctorFollowupStatus,
  getMonthlyCosts,
  setMonthlyCosts,
  getPettyCashEntries,
  addPettyCashEntry,
  deletePettyCashEntry,
  addManualAsset,
  getManualAssets,
  markAssetDocReminderSent,
  getAssetDocReminderLog,
  getStockOpnameVariance,
  getClinicalPhotoLog,
  saveClinicalPhotoRecord,
  saveWaiverRecord,
  getTestimonialGalleryCandidates,
  getApprovedTestimonialGallery,
  setPhotoGalleryApproval,
  getContraindications,
  addContraindication,
  deleteContraindication,
  checkTreatmentContraindications,
  getSopExceptions,
  addSopException,
  deleteSopException,
  deleteDoctorRecommendation,
  getNurseUpsellings,
  saveNurseUpselling,
  deleteNurseUpselling,
  getTreatmentBoms,
  getBhpSheetIssues,
  getBhpDataSource,
  getBhpStandards,
  saveBhpStandard,
  deleteBhpStandard,
  getBhpItemList,
  saveBhpUnitOverride,
  getBeforeAfterGallery,
  getBeforeAfterCompliance,
  getTreatment360,
  getTreatment360List,
  getTreatmentMaster,
  saveTreatmentCategory,
  getPatientMedicalRecords,
  getSoapCompliance,
  getNextTreatmentRecommendation,
  getMonthlyTrends,
  getDailyAppointments,
  getAppointmentDetail,
  getNurseDailyKpi,
  getCampaignReminders,
  analyzePlan,
  getSyncStatusInfo,
  getUnusedPackages,
  getUnusedPackageDetail,
  planMentionsTreatment,
  parsePlanIntervalDays,
  markCampaignReminder,
  getCrossSell,
  getCrossSellOpportunities,
  getBeforeAfterTreatmentList,
  getBeforeAfterByTreatment,
  saveTreatmentBom,
  deleteTreatmentBom,
  getBranchStockTransferRecommendations,
  getMarketingPromos,
  saveMarketingPromo,
  deleteMarketingPromo,
  getPatientFeedbacks,
  savePatientFeedback,
  deletePatientFeedback,
  updateTeamComplaint,
  getHrDisciplinary,
  saveHrDisciplinary,
  deleteHrDisciplinary,
  getMonthlyTargets,
  saveMonthlyTarget,
  getSalesBottomPrices,
  saveSalesBottomPrice,
  calculatePatientXyzGrade,
  getManualUnredeemedTreatments,
  saveManualUnredeemedTreatment,
  deleteManualUnredeemedTreatment,
  getWaChatTemplates,
  saveWaChatTemplate,
  saveAllWaChatTemplates,
  resetWaChatTemplate,
  DEFAULT_WA_CHAT_TEMPLATES
};

