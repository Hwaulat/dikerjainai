/**
 * unified_analytics.js
 * Kefir Derma Clinic - Unified Data Fusion, Owner Assistant, & Recommendation Engine
 * Merges Neosoft Cube, 3 Google Sheets, & Gaji.id Roster
 */

const fs = require('fs');
const path = require('path');
const { isMigrationInvoice } = require('./invoice_flags');

const NEOSOFT_DIR = path.join(__dirname, 'data', 'neosoft_db');
const GSHEETS_DIR = path.join(__dirname, 'data', 'google_sheets_db');
const OPERATIONAL_DIR = path.join(__dirname, 'data', 'operational_db');
const HR_DIR = path.join(__dirname, 'data', 'hr_db');

function loadJson(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`[loadJson Error] ${filePath}:`, err.message);
  }
  return defaultValue;
}

// ==================== 1. DATA ACCESSORS ====================
function getRawData() {
  const invoices = loadJson(path.join(NEOSOFT_DIR, 'invoices_all.json'), []);
  const customers = loadJson(path.join(NEOSOFT_DIR, 'customers_all.json'), []);
  const appointments = loadJson(path.join(NEOSOFT_DIR, 'appointment_full.json'), []);
  const usages = loadJson(path.join(NEOSOFT_DIR, 'usages_details.json'), []);
  
  const depok = loadJson(path.join(GSHEETS_DIR, 'depok_transactions.json'), { unused_packages_deposits: [], recent_transactions_sep26: [], recent_transactions_aug26: [] });
  const pdk = loadJson(path.join(GSHEETS_DIR, 'pondokkopi_transactions.json'), { recent_transactions_sep26: [], recent_transactions_aug26: [] });
  const ops = loadJson(path.join(GSHEETS_DIR, 'operational_assets.json'), { preventive_maintenance: [], assets_inventory: [], daily_findings: [] });
  
  const roster = loadJson(path.join(HR_DIR, 'roster_shifts.json'), []);

  // Riwayat transaksi penuh, sudah dikelompokkan per invoice dengan benar
  // (lihat scripts/sync_google_sheets.py: parse_all_transaction_tabs).
  // Sumber ini jauh lebih andal daripada depok/pdk.recent_transactions_*
  // untuk MENCOCOKKAN nilai invoice — sudah diverifikasi ke 3 invoice
  // sampel, jumlahnya persis sama dengan total Neosoft asli.
  const transactionsHistory = loadJson(path.join(GSHEETS_DIR, 'transactions_history.json'), []);

  return { invoices, customers, appointments, usages, depok, pdk, ops, roster, transactionsHistory };
}

// Format IDR currency
function formatRupiah(num) {
  return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
}

// Clean phone for WhatsApp (e.g. 0812... or 812... -> 62812...)
function normalizePhone(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '62' + clean.slice(1);
  if (clean.startsWith('8')) clean = '62' + clean;
  return clean.length >= 10 ? clean : null;
}

// Semua baris log kasir bulanan (recent_transactions_<abbr><yy>) dari satu berkas sheet cabang,
// urut kronologis. Bulan baru ikut otomatis begitu sinkronisasi membuat kuncinya.
function getMonthlyTxRows(sheet) {
  const mm = [];
  Object.keys(sheet || {}).forEach(k => {
    const m = /^recent_transactions_([a-z]{3})(\d{2})$/.exec(k);
    const idx = m ? MONTH_ABBR.indexOf(m[1]) : -1;
    if (m && idx >= 0) mm.push({ key: k, order: `20${m[2]}-${String(idx + 1).padStart(2, '0')}` });
  });
  return mm.sort((a, b) => a.order.localeCompare(b.order)).flatMap(x => sheet[x.key] || []);
}

// ==================== 2. DATA ENRICHMENT & MERGING ====================
function getEnrichedCustomers() {
  const { customers, pdk, depok } = getRawData();
  const phoneMap = new Map();

  // Harvest phones from PDK GSheets
  // Terbaru dulu (nomor telepon terbaru menang), semua bulan yang ada.
  const pdkTx = getMonthlyTxRows(pdk).reverse();
  pdkTx.forEach(tx => {
    if (tx.patient_name && tx.phone) {
      const nameKey = tx.patient_name.toLowerCase().trim();
      const normPhone = normalizePhone(tx.phone);
      if (normPhone && !phoneMap.has(nameKey)) {
        phoneMap.set(nameKey, normPhone);
      }
    }
  });

  // Enrich Neosoft customers
  return customers.map(c => {
    const rawName = (typeof c.name === 'string' ? c.name : (c.name ? `${c.name.first_name || ''} ${c.name.last_name || ''}` : '')).trim();
    const nameKey = rawName.toLowerCase();
    let phone = normalizePhone(c.phone);

    let isEnriched = false;
    if ((!phone || phone === '0' || phone === '620') && phoneMap.has(nameKey)) {
      phone = phoneMap.get(nameKey);
      isEnriched = true;
    }

    return {
      ...c,
      displayName: rawName || 'Pasien Tanpa Nama',
      effectivePhone: phone,
      isEnrichedWithGSheets: isEnriched
    };
  });
}

// ==================== 3. 3-WAY AUTO-SETTLEMENT ENGINE ====================
//
// Sebelumnya sumber sisi "Google Sheets" (depok/pdk.recent_transactions_*)
// dibaca lewat parse_depok_tx/parse_tx_sheet yang HANYA mengambil baris
// PERTAMA tiap invoice — baris lanjutan (kode invoice kosong karena satu
// invoice bisa punya banyak baris tindakan) dilewati. Nilai Nett/QRIS/EDC
// justru sering tercatat di baris LANJUTAN, bukan baris pertama, sehingga
// hasilnya nyaris selalu meleset (diverifikasi: 2 dari 3 baris di 3 sampel
// invoice September 2026 nilainya hilang total).
//
// Diganti ke transactions_history.json (parse_all_transaction_tabs),
// yang sudah mengelompokkan baris per invoice dengan benar sejak awal.
// Diverifikasi ke 3 invoice sampel: jumlahnya PERSIS sama dengan total
// Neosoft asli (Rp303.000 / Rp824.000 / Rp549.000, cocok semua).
// Breakdown channel pembayaran (EDC/QRIS/Transfer/Cash/Voucher).
//
// Sumber mentahnya (depok/pdk.recent_transactions_*) punya bug tata letak:
// tiap baris ADALAH satu baris tindakan, tapi nilai channel pembayaran
// (Nett/EDC/QRIS/Transfer) hanya tercatat SEKALI per invoice — biasanya
// di salah satu baris lanjutan, bukan baris pertama. Kode Python
// (parse_depok_tx/parse_tx_sheet di scripts/sync_google_sheets.py) hanya
// membaca baris yang kolom invoice-nya terisi (baris pertama grup),
// sehingga nilai di baris lanjutan tidak pernah terbaca.
//
// Diperbaiki di sini (bukan di Python) dengan cara membaca ULANG baris
// mentah dan mengelompokkannya sendiri: invoice code "dibawa turun" ke
// baris lanjutan yang kosong (carry-forward, reset tiap invoice baru),
// baru kolom channel pembayaran DIJUMLAHKAN per grup invoice — karena
// terbukti (3 sampel invoice September 2026) satu invoice bisa punya
// pembayaran dari 2 baris berbeda (mis. QRIS Rp499.000 + Rp50.000 = 
// Rp549.000, cocok persis dengan total Neosoft aslinya).
function getPaymentChannelBreakdown(period = '2026-09') {
  const { depok, pdk } = getRawData();
  const CHANNEL_FIELDS = ['edc_bri', 'edc_bni', 'qris', 'transfer_bca', 'transfer_bri',
    'transfer_bni', 'cash', 'voucher', 'fasilitas_karyawan'];

  const sumByInvoiceGroup = (rawRows) => {
    const groups = new Map();
    let currentInvoice = null;
    rawRows.forEach(r => {
      if (r.invoice) currentInvoice = r.invoice;
      if (!currentInvoice) return;
      const g = groups.get(currentInvoice) || Object.fromEntries(CHANNEL_FIELDS.map(f => [f, 0]));
      CHANNEL_FIELDS.forEach(f => { g[f] += Number(r[f] || 0); });
      groups.set(currentInvoice, g);
    });
    return groups;
  };

  // Hanya bulan yang benar-benar ada di sheet (RECON_SHEET_KEYS). Periode
  // lain dulu DIAM-DIAM jatuh ke data Agustus (label bulan salah) — sekarang
  // dikembalikan nol semua supaya tampil "belum ada data".
  const sheetKey = sheetKeyForPeriod(period);
  const src = sheetKey ? [...(depok[sheetKey] || []), ...(pdk[sheetKey] || [])] : [];

  const grouped = sumByInvoiceGroup(src);
  const totals = Object.fromEntries(CHANNEL_FIELDS.map(f => [f, 0]));
  grouped.forEach(g => CHANNEL_FIELDS.forEach(f => { totals[f] += g[f]; }));
  return totals;
}

// Rekonsiliasi Neosoft vs log kasir spreadsheet.
//
// Dulu dibandingkan PER KODE INVOICE. Itu menghasilkan selisih palsu: kasir
// sering menulis beberapa invoice satu pasien di hari yang sama dalam SATU
// grup berkode salah satu invoice (contoh nyata: Mirna Destianti 20 Sep —
// Neosoft punya KDC-0105 Rp349.000 + KDC-0106 Rp0 + KDC-0108 Rp600.000,
// Sheets menulisnya semua di bawah "0108" = Rp949.000). Dibandingkan per
// kode, 0108 tampak "selisih −349.000" padahal totalnya persis sama.
//
// Sekarang pembandingan per PASIEN + HARI (cluster): sisi Neosoft = jumlah
// semua invoice sah pasien itu di hari itu; sisi Sheets = jumlah semua grup
// Sheets yang kodenya jatuh ke cluster itu. Tambahan klasifikasi:
//   • VOID_DI_NEOSOFT  — kode ada di Sheets tapi invoicenya void di Neosoft
//   • BULAN_LAIN       — kode invoice milik bulan lain (terselip di tab ini)
//   • UNRECORDED       — kode tidak ditemukan di Neosoft sama sekali
//   • hanya di Neosoft — invoice sah Neosoft tanpa baris di Sheets
// Catatan: nilai Sheets dihitung dari penjumlahan nilai item treatment
// (hasil parse), jadi selisih kecil bisa dari cara baca, bukan kesalahan kasir.
function getThreeWaySettlement(period = '2026-09', opts = {}) {
  const { invoices, transactionsHistory, customers } = getRawData();

  const groups = new Map();
  transactionsHistory
    .filter(r => r.period === period && r.invoice)
    .forEach(r => {
      const g = groups.get(r.invoice) || {
        invoice: r.invoice, branch: r.branch, date: r.date,
        patient_name: r.patient_name, treatments: [], amount: 0
      };
      g.amount += Number(r.amount || 0);
      if (r.treatment) g.treatments.push(r.treatment);
      if (!g.date && r.date) g.date = r.date;
      groups.set(r.invoice, g);
    });
  const allGsTx = [...groups.values()];

  const neoMap = new Map();
  invoices.forEach(inv => { if (inv.inv_code) neoMap.set(inv.inv_code, inv); });
  const custName = new Map();
  (customers || []).forEach(c => custName.set(c.id, [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim()));

  // total_after_total_discount SELALU 0 di Neosoft; nilai asli di total_after_tax
  // (fallback ke total untuk topup deposit).
  const amt = inv => Number(inv.total_after_tax || inv.total || inv.total_amount || 0);
  // inv_date Neosoft berlabel "Z" tetapi sudah waktu lokal klinik — hari dipakai apa adanya.
  const dayOf = inv => String(inv.inv_date || '').slice(0, 10);
  // Migrasi sisa paket: bukan transaksi kasir (dibayar di sistem lama), jadi tidak dicocokkan
  const isSah = inv => !inv.void_invoice && (!inv.transtype || inv.transtype === 'sales') && !isMigrationInvoice(inv);
  const codePeriod = code => { const m = String(code).match(/-(\d{4})(\d{2})-/); return m ? `${m[1]}-${m[2]}` : null; };

  // Cluster Neosoft: pasien + hari -> semua invoice sah (semua bulan; hari yang menentukan)
  const clusters = new Map();
  const clusterKey = inv => `${inv.customer_id}|${dayOf(inv)}`;
  invoices.forEach(inv => {
    if (!isSah(inv) || !inv.customer_id) return;
    const k = clusterKey(inv);
    const c = clusters.get(k) || { key: k, customer_id: inv.customer_id, day: dayOf(inv), invoices: [], gs: [] };
    c.invoices.push(inv); clusters.set(k, c);
  });

  const voidInNeosoft = [];
  const replacedVoid = [];
  const otherPeriod = [];
  const unrecordedInNeosoft = [];

  // Satu sel kode di Sheets bisa memuat BEBERAPA kode invoice ("KDC-I-202609-0062 KDC-I-202609-0061"):
  // kasir menulis dua invoice satu pasien dalam satu grup. Setiap kode dicocokkan ke Neosoft sendiri-sendiri;
  // dulu seluruh sel dianggap satu kode yang tak dikenal (Rp17,2 jt Eva Yuanita sempat salah dibaca "tidak ada di Neosoft").
  const CODE_RE = /[A-Z]{3}-[A-Z]-\d{6}-\d{4}/g;
  allGsTx.forEach(gtx => {
    const cell = gtx.invoice;
    const codes = (cell && String(cell).match(CODE_RE)) || (cell ? [cell] : []);
    const found = codes.map(c => ({ code: c, neo: neoMap.get(c) || null }));
    const sahFound = found.filter(f => f.neo && !f.neo.void_invoice);
    const voidFound = found.filter(f => f.neo && f.neo.void_invoice);
    const monthOf = c => codePeriod(c);
    // Semua kode milik bulan lain -> bukan bagian periode ini
    if (codes.length && codes.every(c => monthOf(c) && monthOf(c) !== period)) {
      otherPeriod.push({ invoice: cell, patient_name: gtx.patient_name, branch: gtx.branch, amount: gtx.amount, neosoft_found: found.some(f => f.neo), status: 'BULAN_LAIN' });
      return;
    }
    if (!sahFound.length && !voidFound.length) {
      unrecordedInNeosoft.push({ invoice: cell || 'NON-INV', patient_name: gtx.patient_name, branch: gtx.branch, date: gtx.date,
        amount: gtx.amount, status: 'UNRECORDED_NEOSOFT', treatment: gtx.treatments.join(', ') });
      return;
    }
    if (!sahFound.length) { // semua kode yang ditemukan void di Neosoft
      // Invoice di-void lalu diterbitkan ulang (pasien sama, ±3 hari) dengan nominal SAMA dengan catatan
      // kasir -> kasir hanya masih memakai kode lama; dihitung PAS ke invoice penggantinya.
      // Contoh: Firdaya Kusmawarni 12 Sep, KDC-I-202609-0064 (void) -> 0067 Rp5.098.000, kasir mencatat 0064 Rp5.098.000.
      const vNeo = voidFound[0].neo;
      const vDay = new Date(dayOf(vNeo));
      const rep = [...clusters.values()].find(c => c.customer_id === vNeo.customer_id && !c.gs.length &&
        Math.abs(new Date(c.day) - vDay) <= 3 * 86400000 &&
        Math.abs(c.invoices.filter(i => codePeriod(i.inv_code) === period).reduce((a, i) => a + amt(i), 0) - gtx.amount) <= 1);
      if (rep && gtx.amount > 0) {
        rep.gs.push({ ...gtx, replaced_void: voidFound.map(f => f.code).join(' ') });
        replacedVoid.push({ void_code: voidFound.map(f => f.code).join(' '), replacement: rep.invoices.map(i => i.inv_code).join(' + '),
          patient_name: gtx.patient_name, branch: gtx.branch, amount: gtx.amount });
        return;
      }
      voidInNeosoft.push({ invoice: cell, patient_name: gtx.patient_name, branch: gtx.branch, gsAmount: gtx.amount, neoAmount: 0,
        voidAmount: voidFound.reduce((a, f) => a + amt(f.neo), 0), status: 'VOID_DI_NEOSOFT' });
      return;
    }
    const cl = clusters.get(clusterKey(sahFound[0].neo));
    if (!cl) { // transtype non-sales (mis. topup) — dibandingkan sendiri
      unrecordedInNeosoft.push({ invoice: cell, patient_name: gtx.patient_name, branch: gtx.branch, date: gtx.date,
        amount: gtx.amount, status: 'BUKAN_SALES', treatment: gtx.treatments.join(', ') });
      return;
    }
    // Kode lain di sel yang sama (pasien/hari berbeda) ikut dibawa ke cluster ini
    sahFound.slice(1).forEach(f => {
      const other = clusters.get(clusterKey(f.neo));
      if (other && other !== cl) other.merged_into = cl;
    });
    cl.gs.push(gtx);
  });

  const matchedList = [];
  const discrepancies = [];
  const neosoftOnly = [];
  let totalGSheetsRevenue = 0;
  let totalNeosoftRevenue = 0;
  const inPeriod = inv => dayOf(inv).slice(0, 7) === period;

  clusters.forEach(cl => {
    const periodInv = cl.invoices.filter(i => codePeriod(i.inv_code) === period || (!codePeriod(i.inv_code) && inPeriod(i)));
    if (!periodInv.length && !cl.gs.length) return;
    const neoAmount = periodInv.reduce((a, i) => a + amt(i), 0);
    if (!cl.gs.length) {
      periodInv.filter(i => amt(i) > 0).forEach(i => neosoftOnly.push({
        invoice: i.inv_code, patient_name: custName.get(i.customer_id) || String(i.customer_id), branch: Number(i.outlet_id) === 2 ? 'Pondok Kopi' : 'Depok',
        date: dayOf(i), neoAmount: amt(i), status: 'HANYA_DI_NEOSOFT' }));
      return;
    }
    const gsAmount = cl.gs.reduce((a, g) => a + g.amount, 0);
    totalGSheetsRevenue += gsAmount;
    totalNeosoftRevenue += neoAmount;
    const diff = Math.abs(neoAmount - gsAmount);
    const first = cl.gs[0];
    const row = {
      invoice: cl.gs.map(g => g.invoice).join(' + '),
      neosoft_invoices: periodInv.map(i => i.inv_code),
      patient_name: first.patient_name || custName.get(cl.customer_id),
      branch: first.branch,
      date: cl.day,
      amount: gsAmount,
      neoAmount,
      diff,
      grouped: periodInv.length > 1 || cl.gs.length > 1,
      replaced_void: cl.gs.map(g => g.replaced_void).filter(Boolean).join(' ') || undefined,
      status: diff <= 1000 ? 'MATCHED_100' : 'SETTLED_WITH_DISCOUNT',
      treatment: cl.gs.flatMap(g => g.treatments).join(', ')
    };
    matchedList.push(row);
    if (diff > 1000) {
      discrepancies.push({
        invoice: row.invoice, neosoft_invoices: row.neosoft_invoices, patient_name: row.patient_name, branch: row.branch, date: row.date,
        gsAmount, neoAmount, diff: neoAmount - gsAmount, status: 'PROMO_DISCOUNT_DIFF'
      });
    }
  });
  // Grup Sheets yang di-void di Neosoft tetap dihitung di sisi Sheets agar totalnya jujur
  voidInNeosoft.forEach(v => { totalGSheetsRevenue += v.gsAmount; });
  unrecordedInNeosoft.forEach(u => { totalGSheetsRevenue += u.amount; });

  const paymentBreakdown = getPaymentChannelBreakdown(period);
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const total = allGsTx.length;

  return {
    period,
    summary: {
      total_gsheets_tx: total,
      total_matched: matchedList.filter(r => r.status === 'MATCHED_100').length,
      total_discrepancies: discrepancies.length,
      total_unrecorded: unrecordedInNeosoft.length,
      match_rate_pct: matchedList.length ? Number(((matchedList.filter(r => r.status === 'MATCHED_100').length / matchedList.length) * 100).toFixed(1)) : 100,
      total_gsheets_revenue: totalGSheetsRevenue,
      total_neosoft_revenue: totalNeosoftRevenue,
      void_di_neosoft: { count: voidInNeosoft.length, gs_amount: sum(voidInNeosoft, v => v.gsAmount) },
      bulan_lain: { count: otherPeriod.length, amount: sum(otherPeriod, v => v.amount) },
      kode_void_diganti: { count: replacedVoid.length, amount: sum(replacedVoid, v => v.amount) },
      hanya_di_neosoft: { count: neosoftOnly.length, neo_amount: sum(neosoftOnly, v => v.neoAmount) },
      method: 'cluster pasien+hari'
    },
    payment_breakdown: paymentBreakdown,
    matched_sample: matchedList.slice(0, 15),
    discrepancies,
    unrecorded_sample: unrecordedInNeosoft.slice(0, 10),
    ...(opts.full ? { matched_all: matchedList } : {}),
    void_di_neosoft: voidInNeosoft,
    kode_void_diganti: replacedVoid,
    bulan_lain: otherPeriod,
    hanya_di_neosoft: neosoftOnly
  };
}

// ==================== 4. SMART RECOMMENDATIONS ====================
// A. DP 50% & Unredeemed Package Churn Rescue
function getUnredeemedPackageRadar(options = {}) {
  const { getNeosoftReportData } = require('./data_provider');
  const period = options.period || (options.allTime ? null : '2026-09');
  const rep = getNeosoftReportData({
    type: 'by_revenue',
    start: options.start,
    end: options.end,
    period,
    outlet: options.outlet || 'all'
  });

  const list = (rep.rows || []).map((row, idx) => {
    const invCode = row[1];
    const dateStr = row[2];
    const outlet = row[3];
    const custId = row[4];
    const patName = row[5] || 'Pasien';
    const phone = row[6] || '-';
    const doctor = row[7] || 'dr. Jaga';
    const therapist = row[8] || '-';
    const treatment = row[9] || 'Paket Perawatan';
    const category = row[10] || 'Treatment Medis';
    const totalAmt = Number(row[11] || 0);
    const usedVal = Number(row[12] || 0);
    const remaining = Number(row[13] || 0);
    const status = row[14] || 'Sisa Treatment';

    // Format phone to 62...
    let cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    const hasValidPhone = cleanPhone.length >= 9 && cleanPhone !== '6200';

    const remFmt = 'Rp ' + Math.round(remaining).toLocaleString('id-ID');
    let waText = '';
    try {
      const { getWaChatTemplates } = require('./data_provider');
      const templates = getWaChatTemplates();
      const tpl = templates.unredeemed ? templates.unredeemed.template : '';
      if (tpl) {
        waText = tpl
          .replace(/{NAMA_PASIEN}/g, patName)
          .replace(/{CABANG}/g, outlet)
          .replace(/{TREATMENT}/g, treatment)
          .replace(/{SISA_SALDO}/g, remFmt)
          .replace(/{KATEGORI}/g, category)
          .replace(/{DOKTER}/g, doctor);
      }
    } catch (e) {}

    if (!waText) {
      const greeting = `Halo Kak ${patName}, salam hangat dari Kefir Derma Clinic ${outlet}! ✨`;
      const body = `Kami menginfokan bahwa Kakak masih memiliki benefit perawatan *${treatment}* (Sisa Saldo: ${remFmt}) yang tersimpan aktif di sistem kami dan siap untuk Kakak reservasi kapan saja.`;
      const closing = `Apakah berkenan kami bantu atur jadwal perawatannya minggu ini Kak? Agar hasil kulit glowingnya tetap optimal ya Kak~ 💆‍♀️✨\n\nBisa langsung balas pesan ini untuk booking jadwal ya Kak. Terima kasih banyak! 🙏💕`;
      waText = `${greeting}\n\n${body}\n\n${closing}`;
    }
    const waLink = hasValidPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}` : null;

    let priority = 'MEDIUM (Treatment Quota)';
    if (status.includes('DP 50%') || status.includes('KEEP') || remaining > 1000000) {
      priority = 'HIGH (Priority Recall)';
    }

    return {
      id: `UNREDEEMED-${idx + 1}`,
      inv_code: invCode,
      date: dateStr,
      outlet,
      customer_id: custId,
      patient_name: patName,
      phone: hasValidPhone ? (phone.startsWith('0') ? phone : '0' + cleanPhone.slice(2)) : (phone || '-'),
      clean_phone: cleanPhone,
      has_valid_phone: hasValidPhone,
      doctor,
      therapist,
      treatment,
      category,
      total_amount: totalAmt,
      total_amount_fmt: 'Rp ' + Math.round(totalAmt).toLocaleString('id-ID'),
      used_amount: usedVal,
      used_amount_fmt: 'Rp ' + Math.round(usedVal).toLocaleString('id-ID'),
      remaining_balance: remaining,
      remaining_balance_fmt: remFmt,
      status,
      priority,
      wa_link: waLink,
      wa_text: waText
    };
  });

  list.summary = rep.summary;
  return list;
}

// B. Clinical Next-Best-Treatment Recommendation
function getClinicalUpsellRadar() {
  const { usages } = getRawData();
  const recommendations = [];

  const treatmentUpsellRules = {
    'facial': { next: 'Laser Pico Black Doll & Rejuvenation', reason: 'Pembersihan pori telah tuntas, saatnya regenerasi kolagen & memudarkan flek/hiperpigmentasi.', estRevenue: 450000 },
    'acne': { next: 'IPL Acne Spectrum + Serum Kefir Healing', reason: 'Meredakan inflamasi jerawat aktif dan mengontrol bakteri P. acnes secara menyeluruh.', estRevenue: 350000 },
    'peel': { next: 'Oxy Infusion Facial Glowing + PDT Mask', reason: 'Menghidrasi lapisan kulit pasca-eksfoliasi agar tidak kering dan semakin glowing seketika.', estRevenue: 360000 },
    'laser': { next: 'Skin Rejuvenation Booster Treatment', reason: 'Mempercepat epitelisasi kulit dan mengunci elastisitas jangka panjang pasca laser.', estRevenue: 650000 }
  };

  const recentPatients = usages.slice(0, 20);
  recentPatients.forEach((u, i) => {
    const tname = (u.treatment_name || u.item_name || '').toLowerCase();
    let rule = null;
    for (const [key, val] of Object.entries(treatmentUpsellRules)) {
      if (tname.includes(key)) {
        rule = val;
        break;
      }
    }
    if (!rule) {
      rule = treatmentUpsellRules['facial'];
    }

    recommendations.push({
      id: `UPSELL-${i + 1}`,
      patient_name: u.customer_name || 'Pasien Terdaftar',
      last_treatment: u.treatment_name || u.item_name || 'Treatment Facial',
      recommended_next: rule.next,
      clinical_rationale: rule.reason,
      potential_revenue: rule.estRevenue,
      doctor: u.doctor_name || 'dr. Nur Annisa Novanda'
    });
  });

  return recommendations;
}

// ==================== 5. NOTIFIKASI & EARLY WARNING RADAR ====================
// A. Maintenance Schedule Radar (Sheet 1)
function getMaintenanceAlerts() {
  const { ops } = getRawData();
  const rawList = ops.preventive_maintenance || [];

  return rawList.map((item, idx) => {
    const agenda = item.agenda || 'Servis Rutin';
    const vendor = item.vendor || 'Vendor Resmi';
    const notes = item.keterangan || '-';

    // Check urgency
    let urgency = 'NORMAL';
    if (agenda.toLowerCase().includes('pico') || agenda.toLowerCase().includes('laser')) {
      urgency = 'HIGH_PRIORITY';
    } else if (agenda.toLowerCase().includes('ac')) {
      urgency = 'MEDIUM_PRIORITY';
    }

    return {
      id: `MAINT-${idx + 1}`,
      agenda,
      vendor,
      notes,
      urgency,
      status: 'SCHEDULED',
      suggested_action: `Hubungi ${vendor} untuk verifikasi jadwal servis kalibrasi alat.`
    };
  });
}

// B. Birthday Alerts Today
function getBirthdayAlerts() {
  const enrichedCustomers = getEnrichedCustomers();
  const today = new Date();
  const curMonth = String(today.getMonth() + 1).padStart(2, '0');
  const curDay = String(today.getDate()).padStart(2, '0');

  const bdays = [];
  enrichedCustomers.forEach(c => {
    const dob = c.dob || c.birth_date;
    if (dob && typeof dob === 'string') {
      const parts = dob.split('-');
      if (parts.length === 3 && parts[1] === curMonth && parts[2] === curDay) {
        bdays.push(c);
      }
    }
  });

  // If none today, return upcoming this month
  const candidates = bdays.length > 0 ? bdays : enrichedCustomers.slice(0, 8);

  return candidates.map(c => {
    const phone = c.effectivePhone;
    let bdayMsg = '';
    try {
      const { getWaChatTemplates } = require('./data_provider');
      const templates = getWaChatTemplates();
      const tpl = templates.birthday;
      if (tpl && tpl.template) {
        bdayMsg = tpl.template
          .replace(/{NAMA_PASIEN}/g, c.displayName)
          .replace(/{CABANG}/g, 'Depok & Pondok Kopi')
          .replace(/{KODE_VOUCHER}/g, tpl.code || 'HBD-KEFIR-GLOW')
          .replace(/{BENEFIT_1}/g, tpl.benefit1 || 'FREE 1x Treatment Facial Glow Refresh')
          .replace(/{BENEFIT_2}/g, tpl.benefit2 || 'Diskon 25% Seluruh Treatment Dokter & Laser');
      }
    } catch (e) {}
    if (!bdayMsg) {
      bdayMsg = `Selamat Ulang Tahun Kak ${c.displayName}! 🎂🎉\n\nKefir Derma Clinic memberikan kado spesial berupa Voucher Diskon Perawatan 30% untuk Kakak yang berlaku selama bulan ini.\n\nKlaim voucher Kakak sekarang dan rasakan pengalaman glowing maksimal bersama kami! ✨💖`;
    }
    const msg = encodeURIComponent(bdayMsg);
    return {
      patient_name: c.displayName,
      phone: phone || 'Tanpa No HP',
      wa_link: phone ? `https://wa.me/${phone}?text=${msg}` : null,
      status: 'READY_TO_BLAST'
    };
  });
}

// ==================== 6. OWNER ASSISTANT EXECUTIVE COPILOT ====================
function getWibTodayDate() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function generateMorningBriefing(targetDate, outlet) {
  const dateStr = targetDate || getWibTodayDate();
  const { appointments, roster, depok, pdk } = getRawData();
  const maintAlerts = getMaintenanceAlerts();
  const unredeemed = getUnredeemedPackageRadar();

  // Filter reservasi khusus untuk tanggal yang dipilih (hari ini)
  const todayAppts = (appointments || []).filter(a => {
    const d = String(a.come_date || a.date || '').slice(0, 10);
    return d === dateStr;
  });

  let depokAppts = 0;
  let pdkAppts = 0;
  todayAppts.forEach(a => {
    const code = String(a.code || '');
    const oid = a.outlet && typeof a.outlet === 'object' ? a.outlet.id : a.outlet_id;
    if (oid === 1 || code.startsWith('KDC') || code.includes('DPK')) {
      depokAppts++;
    } else {
      pdkAppts++;
    }
  });

  // Filter berdasarkan outlet yang diminta
  const outletKey = (outlet || 'all').toLowerCase();
  let filteredAppts;
  let branchLabel;
  if (outletKey === 'dpk' || outletKey === 'depok') {
    filteredAppts = depokAppts;
    branchLabel = 'Depok';
  } else if (outletKey === 'pdk' || outletKey === 'pondok' || outletKey === 'pondok kopi') {
    filteredAppts = pdkAppts;
    branchLabel = 'Pondok Kopi';
  } else {
    filteredAppts = todayAppts.length;
    branchLabel = null;
  }

  const totalAppts = filteredAppts;
  const staffShift1 = (roster || []).filter(r => r.shift_time === '09:30 WIB' || (r.shift || '').includes('1'));
  const staffShift2 = (roster || []).filter(r => r.shift_time === '11:30 WIB' || (r.shift || '').includes('2'));

  const branchText = branchLabel
    ? `di ${branchLabel}`
    : (todayAppts.length > 0 ? `(${depokAppts} Depok, ${pdkAppts} Pondok Kopi)` : `(Depok & Pondok Kopi)`);

  const shift1Count = staffShift1.length;
  const shift2Count = staffShift2.length;

  const unredeemedFiltered = branchLabel
    ? unredeemed.filter(u => (u.outlet || u.branch || '').toLowerCase().includes(branchLabel.toLowerCase()))
    : unredeemed;

  return {
    date: dateStr,
    title: `☀️ Morning Executive Briefing — ${dateStr}${branchLabel ? ' • ' + branchLabel : ''}`,
    summary: `Selamat pagi! Hari ini terdaftar ${totalAppts} reservasi pasien ${branchText}. Ada ${shift1Count} staf bertugas di Shift Pagi (09:30 WIB) dan ${shift2Count} staf di Shift Siang (11:30 WIB).`,
    key_metrics: {
      scheduled_appointments: totalAppts,
      depok_appointments: depokAppts,
      pdk_appointments: pdkAppts,
      active_staff_today: shift1Count + shift2Count,
      pending_dp_packages: unredeemedFiltered.length,
      maintenance_tasks_due: maintAlerts.length
    },
    action_items_today: [
      `Follow-up ${unredeemedFiltered.length} pasien dengan DP / paket gantung${branchLabel ? ' di ' + branchLabel : ' di Cabang Depok & Pondok Kopi'} melalui WhatsApp CRM.`,
      `Konfirmasi teknisi vendor untuk perawatan AC & kalibrasi mesin Pico Laser.`,
      `Pastikan kasir${branchLabel ? ' ' + branchLabel : ' Pondok Kopi dan Depok'} melakukan settlement EDC BRI & QRIS tepat waktu.`
    ]
  };
}

function generateNightlyClosing(targetDate) {
  // Dulu default parameter '2026-09-08' tidak pernah kepakai — pemanggil
  // asli (server.js /api/unified/briefing/nightly) mengirim `null`
  // (bukan `undefined`) kalau tidak ada query ?date=, dan default
  // parameter JS TIDAK berlaku untuk `null`. Hasilnya kartu "Nightly
  // Closing" di dashboard selalu menampilkan "...— null" sebagai
  // tanggal, karena frontend memang tidak pernah mengirim ?date= sama
  // sekali. Sekarang pakai tanggal WIB hari ini kalau tidak diberi.
  const dateStr = targetDate || getWibTodayDate();
  const settlement = getThreeWaySettlement('2026-09');
  const pb = settlement.payment_breakdown;
  const discrepancyCount = settlement.discrepancies.length;

  return {
    date: dateStr,
    title: `🌙 Nightly Closing & Cash Flow Audit — ${dateStr}`,
    total_omset_month_to_date: formatRupiah(settlement.summary.total_gsheets_revenue),
    settlement_match_rate: `${settlement.summary.match_rate_pct}% MATCHED`,
    cash_flow_breakdown: {
      edc_bri_bni: formatRupiah(pb.edc_bri + pb.edc_bni),
      qris: formatRupiah(pb.qris),
      transfer_bca: formatRupiah(pb.transfer_bca),
      transfer_bri_bni: formatRupiah(pb.transfer_bri + pb.transfer_bni),
      cash: formatRupiah(pb.cash),
      voucher_promo: formatRupiah(pb.voucher)
    },
    audit_verdict: discrepancyCount === 0
      ? '🟢 AUDIT SEMPURNA: Tidak ditemukan selisih nominal kasir fisik vs sistem.'
      : `🟡 PERHATIAN: Ditemukan ${discrepancyCount} selisih nominal yang memerlukan konfirmasi kasir.`,
    // Dulu kalimat ini ditulis tetap ("Semua dana...telah terekonsiliasi
    // rapi") TANPA MEMPERDULIKAN discrepancies — bisa saja bilang "rapi"
    // padahal audit_verdict di atasnya sendiri melaporkan ada selisih.
    // Sekarang konsisten dengan angka discrepancies yang sama.
    top_recommendation: discrepancyCount === 0
      ? 'Semua dana EDC dan QRIS terekonsiliasi rapi bulan ini — tidak ada tindak lanjut mendesak.'
      : `Tindak lanjuti ${discrepancyCount} selisih nominal dengan kasir sebelum batch settlement bank berikutnya — lihat rincian di tab Auto-Settlement 3-Way.`
  };
}

// Natural language query processor for Owner Assistant
function askOwnerAssistant(query = '') {
  const q = (query || '').toLowerCase();
  const settlement = getThreeWaySettlement('2026-09');
  const unredeemed = getUnredeemedPackageRadar();
  const maint = getMaintenanceAlerts();

  if (q.includes('omset') || q.includes('pendapatan') || q.includes('revenue') || q.includes('penjualan')) {
    return {
      reply: `Total omset terkonsolidasi bulan September 2026 adalah **${formatRupiah(settlement.summary.total_gsheets_revenue)}** dari **${settlement.summary.total_gsheets_tx} transaksi**. Rekonsiliasi kasir fisik Google Sheets vs Neosoft saat ini mencapai akurasi **${settlement.summary.match_rate_pct}%**!`,
      data: settlement.summary
    };
  }

  if (q.includes('dp') || q.includes('paket') || q.includes('gantung') || q.includes('sisa')) {
    return {
      reply: `Ada **${unredeemed.length} pasien** yang tercatat memiliki DP 50% atau sisa kuota paket perawatan di Cabang Depok yang belum digunakan. Pasien seperti Ibu *Afriani* dan Ibu *Annisa Syafriyati* dapat segera dihubungi via tombol 1-klik WhatsApp untuk menjadwalkan tindakan!`,
      data: unredeemed.slice(0, 5)
    };
  }

  if (q.includes('edc') || q.includes('qris') || q.includes('cash') || q.includes('bca') || q.includes('bayar')) {
    const pb = settlement.payment_breakdown;
    return {
      reply: `Rincian penerimaan kasir September 2026:\n• EDC BRI & BNI: **${formatRupiah(pb.edc_bri + pb.edc_bni)}**\n• QRIS: **${formatRupiah(pb.qris)}**\n• Transfer BCA: **${formatRupiah(pb.transfer_bca)}**\n• Transfer BRI: **${formatRupiah(pb.transfer_bri)}**\n• Tunai (Cash): **${formatRupiah(pb.cash)}**\n• Voucher & Promo: **${formatRupiah(pb.voucher)}**`,
      data: pb
    };
  }

  if (q.includes('servis') || q.includes('alat') || q.includes('maintenance') || q.includes('mesin') || q.includes('laser')) {
    return {
      reply: `Tercatat **${maint.length} agenda pemeliharaan** dari Google Sheet Operasional, mencakup jadwal pemeliharaan mesin *Pico Laser PDK* bersama Raditya Sume dan servis berkala 15 unit AC klinik oleh Solusi AC.`,
      data: maint.slice(0, 4)
    };
  }

  // Default response
  return {
    reply: `Halo Owner! Saya siap membantu memantau performa klinik Kefir Derma. Omset September tercatat **${formatRupiah(settlement.summary.total_gsheets_revenue)}**, dengan **${unredeemed.length} paket/DP gantung** yang siap diaktivasi dan akurasi rekonsiliasi kasir **${settlement.summary.match_rate_pct}%**!`,
    data: {
      revenue: settlement.summary.total_gsheets_revenue,
      unredeemed_count: unredeemed.length,
      match_rate: settlement.summary.match_rate_pct
    }
  };
}

// ==================== REKONSILIASI INVOICE NEOSOFT vs LOG KASIR ====================
// Mencocokkan SETIAP invoice Neosoft (non-void) satu periode dengan baris log kasir
// di Google Sheets (recent_transactions_<mmm>26), lalu memecah selisih totalnya ke
// kategori yang bisa ditindaklanjuti. Jumlah semua kategori = selisih total, persis.
//
// Kategori:
//   belum_masuk_log   invoice bertanggal SETELAH tanggal terakhir di log kasir (log belum diperbarui)
//   tidak_tercatat    invoice sebelum/sama tanggal terakhir log, tapi tidak ada di log kasir
//   kode_void         log kasir memakai kode invoice yang sudah di-VOID di Neosoft (sering: void
//                     lalu diterbitkan ulang dengan kode baru, kasir masih menulis kode lama)
//   beda_bulan        log kasir periode ini memakai invoice bulan lain
//   tidak_dikenal     kode di log kasir tidak ada di Neosoft
//   nominal_beda      ada di keduanya, nominal berbeda
//
// Grup baris log kasir mengikuti getPaymentChannelBreakdown: baris lanjutan tanpa kode
// invoice ikut ke invoice di atasnya, supaya totalnya sama dengan kartu breakdown channel.
// Kunci data log kasir per bulan: recent_transactions_<abbr><yy> (dibuat otomatis oleh
// scripts/sync_google_sheets.py untuk tab bulanan Agustus 2026 dst.). Bulan yang tidak ada
// di sheet tidak punya kunci -> tampil "belum ada data".
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function sheetKeyForPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  if (period < '2026-08') return null;
  return `recent_transactions_${MONTH_ABBR[Number(m[2]) - 1]}${m[1].slice(2)}`;
}
// Daftar periode yang punya data di berkas sheet (dibaca dari kunci yang ada).
function sheetPeriodsAvailable() {
  const { depok, pdk } = getRawData();
  const periods = new Set();
  [depok, pdk].forEach(o => Object.keys(o || {}).forEach(k => {
    const mm = /^recent_transactions_([a-z]{3})(\d{2})$/.exec(k);
    if (mm && (o[k] || []).length) periods.add(`20${mm[2]}-${String(MONTH_ABBR.indexOf(mm[1]) + 1).padStart(2, '0')}`);
  }));
  return [...periods].sort();
}
const RECON_SHEET_KEYS = new Proxy({}, {
  get: (_, p) => (typeof p === 'string' ? (sheetPeriodsAvailable().includes(p) ? sheetKeyForPeriod(p) : undefined) : undefined),
  ownKeys: () => sheetPeriodsAvailable(),
  getOwnPropertyDescriptor: (_, p) => (sheetPeriodsAvailable().includes(p) ? { enumerable: true, configurable: true, value: sheetKeyForPeriod(p) } : undefined)
});

function getInvoiceReconciliation(period = '2026-09') {
  const key = RECON_SHEET_KEYS[period];
  if (!key) {
    return { available: false, period, periods_available: Object.keys(RECON_SHEET_KEYS),
      note: `Log kasir di spreadsheet hanya tersedia untuk ${Object.keys(RECON_SHEET_KEYS).join(' & ')}.` };
  }
  const { invoices, customers, depok, pdk } = getRawData();
  const syncSummary = loadJson(path.join(GSHEETS_DIR, 'sync_summary.json'), {}) || {};
  const CH = ['edc_bri', 'edc_bni', 'qris', 'transfer_bca', 'transfer_bri', 'transfer_bni', 'cash', 'voucher', 'fasilitas_karyawan'];
  const RE = /[A-Z]{3}-[A-Z]-\d{6}-\d{4}/g;
  const custName = new Map(customers.map(c => [c.id, typeof c.name === 'string' ? c.name : `${(c.name || {}).first_name || ''} ${(c.name || {}).last_name || ''}`.trim()]));
  const invByCode = new Map(invoices.map(i => [i.inv_code, i]));
  const amtOf = (i) => Number(i.total_after_tax || i.total || 0);
  const branchOf = (outletId) => outletId === 1 ? 'Depok' : (outletId === 2 ? 'Pondok Kopi' : '-');

  // 1) Log kasir per kelompok invoice
  const groups = new Map();
  [['Depok', depok[key] || []], ['Pondok Kopi', pdk[key] || []]].forEach(([branch, rows]) => {
    let cur = null;
    rows.forEach(r => {
      if (r.invoice) cur = String(r.invoice);
      if (!cur) return;
      const gk = `${branch}|${cur}`;
      const g = groups.get(gk) || { raw: cur, branch, amount: 0, dates: new Set(), patient: r.patient_name || '' };
      g.amount += CH.reduce((a, f) => a + Number(r[f] || 0), 0);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) g.dates.add(String(r.date));
      if (!g.patient && r.patient_name) g.patient = r.patient_name;
      groups.set(gk, g);
    });
  });
  const sheetTotal = [...groups.values()].reduce((a, g) => a + g.amount, 0);
  const lastLogDate = [...groups.values()].flatMap(g => [...g.dates]).filter(d => d.startsWith(period)).sort().pop() || null;

  // 2) Kode di log -> nominal (sel berisi beberapa kode dibagi rata)
  const sheetByCode = new Map();
  const unreadable = [];
  groups.forEach(g => {
    const codes = g.raw.toUpperCase().match(RE) || [];
    if (!codes.length) { unreadable.push(g); return; }
    const share = g.amount / codes.length;
    codes.forEach(c => {
      const e = sheetByCode.get(c) || { amount: 0, branch: g.branch, patient: g.patient, raw: [], multi: codes.length > 1 };
      e.amount += share; e.raw.push(g.raw); sheetByCode.set(c, e);
    });
  });

  // 3) Invoice Neosoft periode ini
  // Migrasi sisa paket tidak punya baris di log kasir — bukan selisih
  const neo = invoices.filter(i => !i.void_invoice && !isMigrationInvoice(i) && String(i.inv_date || '').startsWith(period) && (i.outlet_id === 1 || i.outlet_id === 2));
  const neoTotal = neo.reduce((a, i) => a + amtOf(i), 0);
  const neoCodes = new Set(neo.map(i => i.inv_code));

  const items = [];
  const push = (o) => items.push({ ...o, neosoft_fmt: formatRupiah(o.neosoft), kasir_fmt: formatRupiah(o.kasir), selisih: o.neosoft - o.kasir, selisih_fmt: formatRupiah(o.neosoft - o.kasir) });

  neo.forEach(i => {
    const s = sheetByCode.get(i.inv_code);
    const d = String(i.inv_date).slice(0, 10);
    const base = { inv_code: i.inv_code, date: d, branch: branchOf(i.outlet_id), patient: custName.get(i.customer_id) || '-',
      customer_id: i.customer_id, neosoft: amtOf(i), remaining: Number(i.remaining || 0) };
    if (!s) {
      push({ ...base, kasir: 0, category: (lastLogDate && d > lastLogDate) ? 'belum_masuk_log' : 'tidak_tercatat' });
    } else if (Math.abs(s.amount - amtOf(i)) > 1) {
      push({ ...base, kasir: s.amount, category: 'nominal_beda', note: s.multi ? 'Satu baris kasir memuat beberapa invoice; nominal dibagi rata.' : '' });
    }
  });

  const voidReplacedPas = [];
  const dropCodes = new Set();
  // Invoice pengganti untuk kode void: invoice pasien yang sama, tanggal sama/berdekatan, tidak ada di log kasir
  const unrecordedByCustomer = new Map();
  items.filter(x => x.category === 'tidak_tercatat' || x.category === 'belum_masuk_log').forEach(x => {
    (unrecordedByCustomer.get(x.customer_id) || unrecordedByCustomer.set(x.customer_id, []).get(x.customer_id)).push(x);
  });
  sheetByCode.forEach((s, c) => {
    if (neoCodes.has(c)) return;
    const i = invByCode.get(c);
    if (!i) {
      push({ inv_code: c, date: null, branch: s.branch, patient: s.patient || '-', customer_id: null, neosoft: 0, kasir: s.amount,
        category: 'tidak_dikenal', note: `Kode tertulis di log kasir: ${s.raw.join(', ')}` });
      return;
    }
    const d = String(i.inv_date || '').slice(0, 10);
    if (i.void_invoice) {
      const cands = (unrecordedByCustomer.get(i.customer_id) || []).filter(x => Math.abs(new Date(x.date) - new Date(d)) <= 3 * 86400000);
      const rep = cands.find(x => Math.abs(x.neosoft - s.amount) <= 1) || cands[0] || null;
      // Pengganti dengan nominal SAMA: kasir hanya memakai kode lama -> PAS, bukan selisih.
      if (rep && Math.abs(rep.neosoft - s.amount) <= 1 && s.amount > 0) {
        voidReplacedPas.push({ void_code: c, replacement: rep.inv_code, patient: custName.get(i.customer_id) || s.patient || '-',
          date: rep.date, branch: branchOf(i.outlet_id), amount: rep.neosoft, amount_fmt: formatRupiah(rep.neosoft) });
        dropCodes.add(rep.inv_code);
        rep._pas = true;
        return;
      }
      if (rep) rep.replaces = c;
      push({ inv_code: c, date: d, branch: branchOf(i.outlet_id), patient: custName.get(i.customer_id) || s.patient || '-', customer_id: i.customer_id,
        neosoft: 0, kasir: s.amount, voided_amount: amtOf(i), category: 'kode_void',
        replacement: rep ? { inv_code: rep.inv_code, amount: rep.neosoft, amount_fmt: formatRupiah(rep.neosoft), date: rep.date } : null,
        note: rep
          ? (Math.abs(rep.neosoft - s.amount) > 1
            ? `Diterbitkan ulang sebagai ${rep.inv_code} (${formatRupiah(rep.neosoft)}). Kasir mencatat ${formatRupiah(s.amount)}: beda ${formatRupiah(rep.neosoft - s.amount)}.`
            : `Diterbitkan ulang sebagai ${rep.inv_code} dengan nominal sama. Kasir perlu mengganti kode invoicenya.`)
          : 'Invoice di-void dan tidak ada invoice pengganti, padahal pembayaran tercatat di log kasir.' });
    } else {
      push({ inv_code: c, date: d, branch: branchOf(i.outlet_id), patient: custName.get(i.customer_id) || s.patient || '-', customer_id: i.customer_id,
        neosoft: 0, kasir: s.amount, category: 'beda_bulan', note: `Invoice bertanggal ${d}, dicatat di log kasir ${period}.` });
    }
  });
  for (let n = items.length - 1; n >= 0; n--) { if (items[n]._pas) items.splice(n, 1); }
  // Baris pasien tanpa kode invoice (pembaca memberi kunci "TANPA KODE: <nama>"): hanya yang membawa
  // pembayaran yang ditampilkan; pemakaian paket tanpa pembayaran bukan selisih uang.
  unreadable.filter(g => Math.abs(g.amount) > 0).forEach(g => {
    const noCode = /^TANPA KODE:/i.test(g.raw);
    push({ inv_code: g.raw, date: null, branch: g.branch, patient: g.patient || (noCode ? g.raw.replace(/^TANPA KODE:\s*/i, '') : '-'), customer_id: null,
      neosoft: 0, kasir: g.amount, category: 'tidak_dikenal',
      note: noCode ? 'Pembayaran di log kasir tanpa kode invoice (dicatat di bawah invoice pasien lain).' : 'Format kode invoice di log kasir tidak terbaca.' });
  });
  items.forEach(x => {
    if (x.replaces) x.note = `Pengganti invoice VOID ${x.replaces} (kasir masih mencatat kode lama).`;
  });

  // Gabungan per pasien + hari. Kasir sering menulis beberapa invoice satu pasien di hari yang sama
  // dalam SATU baris berkode salah satu invoice (Mirna Destianti 20 Sep: log kasir "KDC-I-202609-0108"
  // Rp949.000, Neosoft 0105 Rp349.000 + 0106 Rp0 + 0108 Rp600.000). Dibandingkan per kode, 0108 tampak
  // "nominal beda -349.000" dan 0105 "tidak tercatat +349.000" — padahal totalnya sama. Bila total pasien
  // hari itu sama di kedua sisi, baris-baris itu dianggap cocok dan dikeluarkan dari daftar selisih.
  const neoByCluster = new Map();
  neo.forEach(i => {
    const k = `${i.customer_id}|${String(i.inv_date).slice(0, 10)}`;
    (neoByCluster.get(k) || neoByCluster.set(k, []).get(k)).push(i);
  });
  const SPLIT_CATS = new Set(['tidak_tercatat', 'belum_masuk_log', 'nominal_beda']);
  const groupedMatches = [];
  neoByCluster.forEach((invs, k) => {
    if (invs.length < 2) return;
    const codes = invs.map(i => i.inv_code);
    const flagged = items.filter(x => codes.includes(x.inv_code) && SPLIT_CATS.has(x.category));
    if (!flagged.length) return;
    const neoSum = invs.reduce((a, i) => a + amtOf(i), 0);
    const kasirSum = codes.reduce((a, c) => a + ((sheetByCode.get(c) || {}).amount || 0), 0);
    if (!kasirSum) return;
    if (Math.abs(neoSum - kasirSum) <= 1) {
      codes.forEach(c => dropCodes.add(c));
      groupedMatches.push({ customer_id: invs[0].customer_id, patient: custName.get(invs[0].customer_id) || '-', date: k.split('|')[1],
        branch: branchOf(invs[0].outlet_id), neosoft_invoices: codes, kasir_codes: codes.filter(c => sheetByCode.has(c)),
        amount: neoSum, amount_fmt: formatRupiah(neoSum) });
    } else {
      flagged.forEach(x => { x.note = [x.note, `Kasir menggabungkan beberapa invoice pasien ini (${codes.join(', ')}); total hari itu Neosoft ${formatRupiah(neoSum)} vs kasir ${formatRupiah(kasirSum)}.`].filter(Boolean).join(' '); });
    }
  });
  for (let n = items.length - 1; n >= 0; n--) {
    if (dropCodes.has(items[n].inv_code) && SPLIT_CATS.has(items[n].category)) items.splice(n, 1);
  }

  const LABELS = {
    belum_masuk_log: 'Belum masuk log kasir',
    tidak_tercatat: 'Tidak tercatat di log kasir',
    kode_void: 'Log kasir memakai kode VOID',
    beda_bulan: 'Invoice bulan lain di log kasir',
    tidak_dikenal: 'Kode tidak dikenal',
    nominal_beda: 'Nominal berbeda'
  };
  const categories = Object.keys(LABELS).map(k => {
    const rows = items.filter(x => x.category === k);
    const net = rows.reduce((a, x) => a + x.selisih, 0);
    return { key: k, label: LABELS[k], count: rows.length, net, net_fmt: formatRupiah(net) };
  }).filter(c => c.count > 0);

  const diff = neoTotal - sheetTotal;
  const explained = categories.reduce((a, c) => a + c.net, 0);
  return {
    available: true,
    period,
    periods_available: Object.keys(RECON_SHEET_KEYS),
    neosoft_total: neoTotal, neosoft_total_fmt: formatRupiah(neoTotal), neosoft_count: neo.length,
    kasir_total: sheetTotal, kasir_total_fmt: formatRupiah(sheetTotal), kasir_count: groups.size,
    difference: diff, difference_fmt: formatRupiah(diff),
    explained, fully_explained: Math.abs(diff - explained) < 1,
    last_log_date: lastLogDate,
    sheet_synced_at: syncSummary.last_synced_at || null,
    categories,
    // Invoice yang PAS: nominal sama per kode, atau pas setelah digabung per pasien + hari
    ...(() => {
      const flaggedCodes = new Set(items.map(x => x.inv_code));
      const pas = neo.filter(i => !flaggedCodes.has(i.inv_code));
      const voidRepCodes = new Set(voidReplacedPas.map(v => v.replacement));
      const pasGabungan = pas.filter(i => dropCodes.has(i.inv_code) && !voidRepCodes.has(i.inv_code));
      const pasVoid = pas.filter(i => voidRepCodes.has(i.inv_code));
      return {
        pas_count: pas.length, pas_total: pas.reduce((a, i) => a + amtOf(i), 0), pas_total_fmt: formatRupiah(pas.reduce((a, i) => a + amtOf(i), 0)),
        pas_gabungan_count: pasGabungan.length,
        pas_void_diganti_count: pasVoid.length,
        pas_note: `Pas: ${pas.length} dari ${neo.length} invoice` + ((pasGabungan.length || pasVoid.length) ? ` (termasuk ${[
          pasGabungan.length ? `${pasGabungan.length} invoice yang dicatat kasir digabung per pasien` : '',
          pasVoid.length ? `${pasVoid.length} invoice pengganti void yang di log kasir masih memakai kode lama` : ''
        ].filter(Boolean).join(' dan ')}, nominalnya sama)` : '')
      };
    })(),
    grouped_matches: groupedMatches,
    void_replaced_pas: voidReplacedPas,
    grouped_matches_note: groupedMatches.length ? `${groupedMatches.length} pasien: beberapa invoice Neosoft dicatat kasir dalam satu baris, totalnya sama — dihitung PAS.` : null,
    items: items.sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih))
  };
}

module.exports = {
  getRawData,
  getMonthlyTxRows,
  getInvoiceReconciliation,
  formatRupiah,
  getEnrichedCustomers,
  getThreeWaySettlement,
  getPaymentChannelBreakdown,
  getUnredeemedPackageRadar,
  getClinicalUpsellRadar,
  getMaintenanceAlerts,
  getBirthdayAlerts,
  generateMorningBriefing,
  generateNightlyClosing,
  askOwnerAssistant
};
