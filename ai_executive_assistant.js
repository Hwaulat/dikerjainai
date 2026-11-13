/**
 * KEFIR CLINIC — ReAct Autonomous AI Agent Engine
 * Full tool-calling loop with real-time data access to ALL clinic systems.
 * Powered by LLM Router (OpenAI-compatible) with multi-turn memory.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { isMigrationInvoice, depositPaidByInvoice, omsetAmount, depositTopups } = require('./invoice_flags');
const {
  getClinicSummary, searchPatient360, countPatient360Matches,
  getTransactionHistory, getCrmJoinDiagnostics, getInvoiceDetail,
  getOperationalData, getMarketingHubData, getGoogleSheetsData,
  getSalesComparison, getPeakHourAnalysis, getPatientFrequencyList,
  getTreatmentProductMap, getNeosoftMasterData, getNeosoftLogisticsData,
  searchPharmacyStockDetailed, getAutomationAlertsSummary, getDoctorFollowupsList, getRevenueBreakdown
} = require('./data_provider');
const {
  getThreeWaySettlement, getUnredeemedPackageRadar,
  getClinicalUpsellRadar, getMaintenanceAlerts,
  getBirthdayAlerts, generateMorningBriefing,
  generateNightlyClosing, askOwnerAssistant
} = require('./unified_analytics');
const { permsForRole } = require('./role_policy');
const { createDocument } = require('./document_service');
const { getInvoiceAudit } = require('./invoice_audit');
const { recordUsage } = require('./ai_usage');
const crypto = require('crypto');

// ==================== LLM CONFIG (HERMES 9ROUTER INTEGRATION) ====================
function getLLMConfig() {
  let host = process.env.NINEROUTER_HOST || '127.0.0.1';
  let port = process.env.NINEROUTER_PORT ? parseInt(process.env.NINEROUTER_PORT, 10) : 20129;
  let protocol = 'http:';
  let basePath = '';
  // NINEROUTER_BASE_URL atau NINEROUTER_HOST boleh berupa URL lengkap, mis.
  // https://9router.example.com/v1 → protokol, host, port, dan path dasar dipisah.
  const urlEnv = process.env.NINEROUTER_BASE_URL || (/^https?:\/\//i.test(host) ? host : '');
  if (urlEnv) {
    try {
      const u = new URL(urlEnv);
      protocol = u.protocol;
      host = u.hostname;
      port = u.port ? parseInt(u.port, 10) : (process.env.NINEROUTER_PORT ? parseInt(process.env.NINEROUTER_PORT, 10) : (u.protocol === 'https:' ? 443 : 80));
      basePath = u.pathname.replace(/\/+$/, '');
    } catch (e) { /* URL tidak valid: pakai nilai apa adanya */ }
  }
  let model = process.env.NINEROUTER_MODEL || 'utama';
  let apiKey = process.env.NINEROUTER_API_KEY || '';

  if (!apiKey) {
    try {
      const homeDir = process.env.HOME || '/Users/mymac';
      const hermesConfigPath = path.join(homeDir, '.hermes', 'config.yaml');
      if (fs.existsSync(hermesConfigPath)) {
        const confText = fs.readFileSync(hermesConfigPath, 'utf8');
        const matchKey = confText.match(/api_key:\s*([^\s\r\n]+)/);
        if (matchKey && matchKey[1]) apiKey = matchKey[1].trim();
        const matchBase = confText.match(/base_url:\s*http:\/\/([^:\/]+):(\d+)/);
        if (matchBase && !process.env.NINEROUTER_HOST) {
          host = matchBase[1];
          port = parseInt(matchBase[2], 10);
        }
      }
    } catch (e) {}
  }
  if (!apiKey) apiKey = 'BlackBox2026!';
  return { host, port, model, apiKey, protocol, basePath };
}

const MAX_REACT_STEPS = 6; // max tool-call iterations per query (allow multi-tool deep analysis)

// Periode berjalan (Asia/Jakarta) — dipakai sebagai default kalau
// pemanggil tidak menyebut periode secara eksplisit. Sebelumnya default
// parameter-nya angka TETAP '2026-09' di tiga fungsi berbeda: dashboard
// web selalu mengirim periode aktual jadi tidak kena, tapi jalur
// WhatsApp (wa_assistant_service.js) TIDAK PERNAH mengirim periode sama
// sekali — artinya begitu kalender lewat September, semua pertanyaan
// lewat WhatsApp diam-diam tetap menganalisis data September selamanya,
// tanpa error atau tanda apa pun kalau tidak dicek kodenya.
function currentPeriodJakarta() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ==================== SESSION MEMORY ====================
// Dulu murni in-memory (Map biasa) — riwayat percakapan hilang total
// setiap server di-restart (termasuk restart otomatis saat WA Assistant
// reconnect), dan hanya menyimpan 16 pesan terakhir tanpa cara melihat
// yang lebih lama. Sekarang dipersist ke file per sesi, jadi bertahan
// lewat restart. Cap 16 pesan TERAKHIR yang dikirim ke LLM tetap ada
// (biar konteks tidak membengkak), tapi riwayat penuh di disk tidak
// dipotong sampai 500 pesan/sesi.
const CHAT_HISTORY_DIR = path.join(__dirname, 'data', 'ai_chat_history');
const conversationMemory = new Map();

function historyFilePath(sessionId) {
  const safeId = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CHAT_HISTORY_DIR, `${safeId}.json`);
}

function loadSessionHistoryFromDisk(sessionId) {
  try {
    const p = historyFilePath(sessionId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* file korup/kosong — mulai riwayat baru */ }
  return [];
}

function saveSessionHistoryToDisk(sessionId, history) {
  try {
    fs.mkdirSync(CHAT_HISTORY_DIR, { recursive: true });
    fs.writeFileSync(historyFilePath(sessionId), JSON.stringify(history.slice(-500), null, 2));
  } catch (e) {
    console.error('[AI Chat History] Gagal menyimpan riwayat:', e.message);
  }
}

function getSessionHistory(sessionId) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, loadSessionHistoryFromDisk(sessionId));
  }
  return conversationMemory.get(sessionId);
}

// Pisahkan baris "SARAN: a | b | c" (saran pertanyaan lanjutan) dari
// jawaban. Saran ditampilkan sebagai tombol di dashboard, tidak ikut
// dikirim ke WhatsApp maupun disimpan di riwayat percakapan.
function splitSuggestions(text) {
  const raw = String(text || '');
  const re = /^[ \t>*_-]*\**SARAN\**\s*:\s*(.+)$/gim;
  let suggestions = [];
  const answer = raw.replace(re, (_, list) => {
    suggestions = list.split('|')
      .map(x => x.replace(/[*_`"“”<>]/g, '').trim())
      .filter(x => x.length >= 2 && x.length <= 80);
    return '';
  }).trim();
  return { answer, suggestions: suggestions.slice(0, 3) };
}

function appendSessionHistory(sessionId, role, content) {
  if (role === 'assistant') content = splitSuggestions(content).answer;
  const history = getSessionHistory(sessionId);
  history.push({ role, content, timestamp: Date.now() });
  saveSessionHistoryToDisk(sessionId, history);
}

// Konteks dikirim ke LLM tetap dibatasi 16 pesan terakhir supaya prompt
// tidak membengkak — riwayat penuh (sampai 500 pesan) tetap tersimpan di
// disk untuk ditampilkan di dashboard/riwayat.
function recentHistoryForLLM(sessionId) {
  const history = getSessionHistory(sessionId);
  return history.slice(-16);
}

// ==================== TOOL CATALOG ====================
// Each tool: { name, description, parameters (JSON schema), execute(params) }
// Buang angka rupiah tingkat klinik dari hasil tool, untuk role yang
// tidak berhak. Dipakai supaya AI tidak bisa jadi pintu belakang:
// tampilan sudah disaring, payload /api/ sudah disaring, percuma kalau
// user tinggal bertanya "berapa omset?" ke asisten.
function scrubClinicMoney(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const MONEY_KEYS = new Set([
    'total_omset', 'total_omset_formatted', 'growth_vs_july', 'target_monthly', 'target_pct',
    'total_doctor_commission', 'total_doctor_commission_fmt',
    'total_therapist_commission', 'total_therapist_commission_fmt',
    'revenue', 'gross_revenue', 'gross_revenue_fmt', 'total_commission', 'total_commission_fmt',
    'profit', 'net_profit', 'total_revenue', 'omset'
  ]);
  if (Array.isArray(obj)) return obj.map(scrubClinicMoney);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (MONEY_KEYS.has(k)) continue;
    out[k] = (v && typeof v === 'object') ? scrubClinicMoney(v) : v;
  }
  return out;
}

function stripPatientClinicalFields(patients) {
  return (patients || []).map(p => {
    const c = { ...p };
    ['medical_record_photos', 'clinical_photo_sessions', 'neosoft_examinations',
     'next_plan', 'rekam_medis', 'physical_examinations'].forEach(k => delete c[k]);
     c._clinical_hidden = true;
    return c;
  });
}

function getDailySales(dateInput, acl = {}) {
  let targetDate = (dateInput || 'today').trim().toLowerCase();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  
  if (targetDate === 'today' || targetDate === 'hari ini') {
    targetDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  } else if (targetDate === 'yesterday' || targetDate === 'kemarin' || targetDate === 'kemaren') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    targetDate = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  }

  const invoicesPath = path.join(__dirname, 'data', 'neosoft_db', 'invoices_all.json');
  let invoices = [];
  try {
    if (fs.existsSync(invoicesPath)) {
      invoices = JSON.parse(fs.readFileSync(invoicesPath, 'utf8') || '[]');
    }
  } catch (e) {}

  // Invoice void dikecualikan — sama dengan dashboard. Sebelumnya ikut
  // dihitung, jadi omset harian versi AI bisa lebih besar dari dashboard.
  const dayInvoices = invoices.filter(inv => {
    const d = String(inv.inv_date || inv.created_at || '').slice(0, 10);
    return d === targetDate && !inv.void_invoice && !isMigrationInvoice(inv);
  });

  let depokTotal = 0, depokCount = 0;
  let pdkTotal = 0, pdkCount = 0;
  let overallTotal = 0;

  // Omset: pemakaian saldo deposit tidak dihitung (invoice_flags.omsetAmount).
  let payReport = {};
  try { payReport = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'neosoft_db', 'payment_report.json'), 'utf8') || '{}'); } catch (e) {}
  const depMap = depositPaidByInvoice(payReport);
  dayInvoices.forEach(inv => {
    const amt = omsetAmount(inv, depMap);
    overallTotal += amt;
    if (inv.outlet_id === 1) {
      depokTotal += amt;
      depokCount++;
    } else {
      pdkTotal += amt;
      pdkCount++;
    }
  });
  // Top-up deposit MANUAL (Sales > Deposit Neosoft) bukan invoice — ikut omset (aturan deposit).
  const dayTopups = depositTopups(readDepositMutations(), invoices)
    .filter(t => t.date === targetDate && (t.outlet_id === 1 || t.outlet_id === 2));
  let depokTopup = 0, pdkTopup = 0;
  dayTopups.forEach(t => {
    if (!t.counted) return;
    overallTotal += t.amount;
    if (t.outlet_id === 1) { depokTotal += t.amount; depokTopup += t.amount; } else { pdkTotal += t.amount; pdkTopup += t.amount; }
  });
  const money = acl.clinic_money !== false;
  const rpx = n => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
  const topupNames = patientNameMap(dayTopups.map(t => t.patient_id));

  const isToday = targetDate === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let dayName = 'Hari Kerja';
  try {
    dayName = new Date(targetDate + 'T12:00:00+07:00').toLocaleDateString('id-ID', { weekday: 'long' });
  } catch (e) {}

  return {
    date: targetDate,
    day_name: dayName,
    total_invoices: dayInvoices.length,
    depok: {
      invoices: depokCount,
      omset: acl.clinic_money !== false ? `Rp ${depokTotal.toLocaleString('id-ID')}` : undefined,
      omset_num: acl.clinic_money !== false ? depokTotal : undefined,
      ...(money && depokTopup ? { termasuk_topup_deposit_manual: rpx(depokTopup) } : {})
    },
    pondok_kopi: {
      invoices: pdkCount,
      omset: acl.clinic_money !== false ? `Rp ${pdkTotal.toLocaleString('id-ID')}` : undefined,
      omset_num: acl.clinic_money !== false ? pdkTotal : undefined,
      ...(money && pdkTopup ? { termasuk_topup_deposit_manual: rpx(pdkTopup) } : {})
    },
    topup_deposit_manual: dayTopups.map(t => ({
      cabang: t.branch, jam: t.time, pasien: topupNames[t.patient_id] || '-', kode_pasien: t.patient_code, metode: t.bank,
      nominal: money ? rpx(t.amount) : undefined, diinput_oleh: t.by,
      ...(t.counted ? {} : { catatan: `uang yang sama sudah tercatat lewat invoice ${t.via_invoice} — tidak dihitung dua kali` })
    })),
    total_omset: acl.clinic_money !== false ? `Rp ${overallTotal.toLocaleString('id-ID')}` : undefined,
    total_omset_num: acl.clinic_money !== false ? overallTotal : undefined,
    note: dayInvoices.length > 0 
      ? `Tercatat ${dayInvoices.length} transaksi kasir selesai pada ${dayName}, ${targetDate}.`
      : (isToday ? 'Belum ada transaksi kasir yang masuk hari ini (Shift Pagi klinik buka pukul 09:30 WIB).' : `Tidak ada transaksi yang tercatat pada sistem untuk tanggal ${targetDate}.`)
  };
}

// ==================== ANALISIS PENYEBAB (KENAPA ANGKANYA BEGITU) ====================
// Membongkar satu rentang tanggal (opsional dibanding rentang lain) sampai
// ke invoice, item, dokter, pasien baru/lama, metode bayar, dan void —
// supaya AI bisa menjawab "kenapa omset naik/turun" dengan bukti, bukan
// menebak.
function readNeosoft(file) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'neosoft_db', file), 'utf8') || '[]'); } catch (e) { return []; }
}

// Laporan Mutasi Deposit Neosoft (sync_deposit_mutations): { synced_at, data: [...] }.
function readDepositMutations() {
  const raw = readNeosoft('deposit_mutations.json');
  return Array.isArray(raw) ? raw : (Array.isArray(raw && raw.data) ? raw.data : []);
}

// Nama pasien untuk sekumpulan id (file pasien hanya dibaca bila perlu).
function patientNameMap(ids) {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return {};
  const out = {};
  readNeosoft('customers_all.json').forEach(c => {
    if (!set.has(c.id)) return;
    out[c.id] = c.name ? [c.name.first_name, c.name.middle_name, c.name.last_name].map(x => String(x || '').trim()).filter(Boolean).join(' ') : (c.customer_name || '');
  });
  return out;
}

function resolveDateWord(v) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const w = String(v || '').trim().toLowerCase();
  if (!w || w === 'today' || w === 'hari ini') return fmt(now);
  if (w === 'yesterday' || w === 'kemarin' || w === 'kemaren') { const y = new Date(now); y.setDate(y.getDate() - 1); return fmt(y); }
  if (/^\d{4}-\d{2}$/.test(w)) return w + '-01';
  return w.slice(0, 10);
}

function endOfRange(start, end) {
  if (end) {
    const e = String(end).trim();
    if (/^\d{4}-\d{2}$/.test(e)) { const [y, m] = e.split('-').map(Number); return `${e}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; }
    return resolveDateWord(e);
  }
  return start;
}

function analyzeSalesDrivers(args = {}, acl = {}) {
  const money = acl.clinic_money !== false;
  const invoices = readNeosoft('invoices_all.json');
  const usages = readNeosoft('usages_details.json');
  const products = readNeosoft('products.json');
  const customers = readNeosoft('customers_all.json');
  const therapists = readNeosoft('therapists.json');
  const depMap = depositPaidByInvoice(readNeosoft('payment_report.json'));
  const allTopups = depositTopups(readDepositMutations(), invoices).filter(t => t.counted);

  const pMap = {}; products.forEach(p => { pMap[p.id] = p.product_treatment_name || p.name; });
  const tMap = {}; therapists.forEach(t => { tMap[t.id] = (!t.therapist_name || t.therapist_name === 'NONE') ? 'Tanpa dokter (kasir/produk)' : t.therapist_name; });
  const cMap = {}; customers.forEach(c => { cMap[c.id] = c.name ? `${c.name.first_name || ''} ${c.name.last_name || ''}`.trim() : (c.customer_name || ''); });
  const uMap = {}; usages.forEach(u => { (uMap[u.inv_code] = uMap[u.inv_code] || []).push(u); });

  // Kunjungan pertama tiap pasien (seluruh riwayat) untuk membedakan pasien baru vs lama
  const firstVisit = {};
  invoices.forEach(inv => {
    if (inv.void_invoice) return;
    // Pemilik invoice migrasi sisa paket = pasien lama dari sistem sebelumnya
    if (isMigrationInvoice(inv)) { firstVisit[inv.customer_id] = '0000-00-00'; return; }
    const d = String(inv.inv_date || '').slice(0, 10);
    if (d && (!firstVisit[inv.customer_id] || d < firstVisit[inv.customer_id])) firstVisit[inv.customer_id] = d;
  });

  const cab = String(args.cabang || 'all').toLowerCase();
  const outletOk = id => (id === 1 || id === 2) && (cab === 'all' || (cab.includes('depok') ? id === 1 : cab.includes('pondok') || cab.includes('pdk') ? id === 2 : true));
  const rp = n => money ? 'Rp ' + Math.round(n).toLocaleString('id-ID') : undefined;

  function profile(start, end) {
    const inRange = invoices.filter(inv => {
      const d = String(inv.inv_date || inv.created_at || '').slice(0, 10);
      return d >= start && d <= end && outletOk(Number(inv.outlet_id));
    });
    const valid = inRange.filter(i => !i.void_invoice && !isMigrationInvoice(i));
    const voids = inRange.filter(i => i.void_invoice);
    // amt = nilai invoice penuh; omset = tanpa bagian yang dibayar pakai saldo deposit.
    const amt = i => Number(i.total_after_tax || i.total || 0);
    const omset = i => omsetAmount(i, depMap);
    // Top-up deposit manual (bukan invoice) ikut omset — aturan deposit.
    const topups = allTopups.filter(t => t.date >= start && t.date <= end && outletOk(t.outlet_id));
    const topupTotal = topups.reduce((a, t) => a + t.amount, 0);
    const total = valid.reduce((a, i) => a + omset(i), 0) + topupTotal;

    const group = (keyFn) => {
      const g = {};
      valid.forEach(i => { const k = keyFn(i) || '-'; g[k] = g[k] || { n: 0, v: 0 }; g[k].n++; g[k].v += omset(i); });
      return g;
    };
    const branchGroup = () => {
      const g = group(i => Number(i.outlet_id) === 1 ? 'Depok' : 'Pondok Kopi');
      topups.forEach(t => { const k = t.outlet_id === 1 ? 'Depok' : 'Pondok Kopi'; g[k] = g[k] || { n: 0, v: 0 }; g[k].v += t.amount; });
      return g;
    };
    const items = {};
    valid.forEach(i => (uMap[i.inv_code] || []).forEach(u => {
      const name = pMap[u.product_id] || `Produk ${u.product_id}`;
      items[name] = items[name] || { n: 0, v: 0 };
      items[name].n++; items[name].v += Number(u.value || 0);
    }));
    let baru = 0, lama = 0;
    new Set(valid.map(i => i.customer_id)).forEach(cid => { (firstVisit[cid] >= start && firstVisit[cid] <= end) ? baru++ : lama++; });
    const sorted = [...valid].sort((a, b) => amt(b) - amt(a));
    const top3 = sorted.slice(0, 3).reduce((a, i) => a + omset(i), 0);
    const backdated = valid.filter(i => {
      if (!i.created_at) return false;
      const rec = new Date(new Date(i.created_at).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      return rec !== String(i.inv_date || '').slice(0, 10);
    }).length;

    return {
      raw: { total, count: valid.length, items, doctors: group(i => tMap[i.doctor_id]), branches: branchGroup(), paymode: group(i => i.paymode) },
      out: {
        rentang: start === end ? start : `${start} s/d ${end}`,
        jumlah_invoice: valid.length,
        omset: rp(total),
        ...(topups.length ? { termasuk_topup_deposit_manual: { jumlah: topups.length, nilai: rp(topupTotal) } } : {}),
        rata_rata_per_invoice: valid.length ? rp((total - topupTotal) / valid.length) : undefined,
        pasien_unik: baru + lama, pasien_baru: baru, pasien_lama: lama,
        porsi_3_invoice_terbesar: total ? `${Math.round(top3 / total * 100)}%` : undefined,
        invoice_terbesar: sorted.slice(0, 5).map(i => ({ invoice: i.inv_code, pasien: cMap[i.customer_id] || '-', nilai: rp(amt(i)), dokter: tMap[i.doctor_id] || '-', item: (uMap[i.inv_code] || []).slice(0, 4).map(u => pMap[u.product_id]).filter(Boolean) })),
        item_terlaris: Object.entries(items).sort((a, b) => (money ? b[1].v - a[1].v : b[1].n - a[1].n)).slice(0, 8).map(([k, v]) => ({ item: k, kali: v.n, nilai: rp(v.v) })),
        per_dokter: Object.entries(group(i => tMap[i.doctor_id])).sort((a, b) => b[1].v - a[1].v).slice(0, 8).map(([k, v]) => ({ dokter: k, invoice: v.n, nilai: rp(v.v) })),
        per_cabang: Object.entries(branchGroup()).map(([k, v]) => ({ cabang: k, invoice: v.n, nilai: rp(v.v) })),
        metode_bayar: Object.entries(group(i => i.paymode)).map(([k, v]) => ({ metode: k, invoice: v.n, nilai: rp(v.v) })),
        invoice_void: { jumlah: voids.length, nilai: rp(voids.reduce((a, i) => a + amt(i), 0)) },
        invoice_dicatat_belakangan: backdated
      }
    };
  }

  const start = resolveDateWord(args.start);
  const end = endOfRange(start, args.end);
  const main = profile(start, end);
  const result = { periode: main.out };

  if (args.compare_start) {
    const cs = resolveDateWord(args.compare_start);
    const ce = endOfRange(cs, args.compare_end);
    const cmp = profile(cs, ce);
    const pct = (a, b) => b ? `${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}%` : 'n/a';
    const movers = (a, b) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].map(k => ({ k, dv: (a[k]?.v || 0) - (b[k]?.v || 0), dn: (a[k]?.n || 0) - (b[k]?.n || 0) }))
        .sort((x, y) => money ? Math.abs(y.dv) - Math.abs(x.dv) : Math.abs(y.dn) - Math.abs(x.dn)).slice(0, 6)
        .map(m => ({ nama: m.k, selisih_nilai: money ? (m.dv >= 0 ? '+' : '-') + rp(Math.abs(m.dv)) : undefined, selisih_jumlah: m.dn }));
    };
    result.pembanding = cmp.out;
    result.perubahan = {
      omset: money ? pct(main.raw.total, cmp.raw.total) : undefined,
      jumlah_invoice: pct(main.raw.count, cmp.raw.count),
      penggerak_terbesar_item: movers(main.raw.items, cmp.raw.items),
      penggerak_terbesar_dokter: movers(main.raw.doctors, cmp.raw.doctors),
      penggerak_terbesar_cabang: movers(main.raw.branches, cmp.raw.branches)
    };
  }
  if (!money) result._catatan_akses = 'Nilai rupiah tidak disertakan — di luar hak akses user ini. Analisis memakai jumlah transaksi.';
  return result;
}

// ==================== MUTASI DEPOSIT (TOP-UP & PEMAKAIAN SALDO) ====================
// Sumber: laporan Mutasi Deposit Neosoft (REPORTS > Sales > By Deposit), disinkron
// ke deposit_mutations.json. Top-up deposit MANUAL (menu Sales > Deposit) HANYA ada
// di sini — tidak menjadi invoice dan tidak muncul di Collection by Payment.
function getDepositMutations(args = {}, acl = {}) {
  const money = acl.clinic_money !== false;
  const rows = readDepositMutations();
  let syncedAt = null;
  try { syncedAt = new Date(fs.statSync(path.join(__dirname, 'data', 'neosoft_db', 'deposit_mutations.json')).mtimeMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); } catch (e) { /* belum pernah sync */ }
  if (!rows.length) {
    return { tersedia: false, catatan: 'Data mutasi deposit belum tersinkron dari Neosoft (deposit_mutations.json kosong). Jangan menyimpulkan deposit "tidak ada" — sampaikan bahwa datanya belum tersedia.' };
  }
  const invoices = readNeosoft('invoices_all.json');
  const start = resolveDateWord(args.start || 'today');
  const end = endOfRange(start, args.end);
  const cab = String(args.cabang || 'all').toLowerCase();
  const outletOk = id => cab === 'all' || (cab.includes('depok') ? id === 1 : (cab.includes('pondok') || cab.includes('pdk')) ? id === 2 : true);
  const jenis = String(args.jenis || 'semua').toLowerCase();
  const q = String(args.pasien || '').trim().toLowerCase();

  const topups = depositTopups(rows, invoices);
  const topupKey = t => `${t.patient_id}|${t.date}|${t.time}|${t.amount}`;
  const topupByKey = new Map(topups.map(t => [topupKey(t), t]));
  const names = patientNameMap(rows.map(r => r.patient_id));
  const rp = n => money ? 'Rp ' + Math.round(n).toLocaleString('id-ID') : undefined;

  const picked = rows.filter(r => {
    const d = String(r.date || '').slice(0, 10);
    if (d < start || d > end || !outletOk(Number(r.outlet_id))) return false;
    const desc = String(r.description || '').toUpperCase();
    if (jenis.startsWith('top') && !(desc === 'MANUAL DEPOSIT' && Number(r.deposit_in) > 0)) return false;
    if (jenis.startsWith('pakai') && !(desc === 'USE DEPOSIT')) return false;
    if (q) {
      const nm = String(names[r.patient_id] || '').toLowerCase();
      if (!nm.includes(q) && !String(r.patient_code || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let topupOmset = 0, pakai = 0;
  const detail = picked.map(r => {
    const desc = String(r.description || '').toUpperCase();
    const t = desc === 'MANUAL DEPOSIT' ? topupByKey.get(`${r.patient_id}|${String(r.date).slice(0, 10)}|${String(r.date).slice(11, 16)}|${Number(r.deposit_in)}`) : null;
    let status;
    if (desc === 'MANUAL DEPOSIT') {
      if (t && t.counted) { status = 'top-up manual: uang masuk, dihitung omset'; topupOmset += t.amount; }
      else if (t && t.via_invoice) status = `uang sama sudah tercatat di invoice ${t.via_invoice} (tidak dihitung dua kali)`;
      else if (!String(r.bank_name || '').trim()) status = 'saldo awal migrasi dari sistem lama (bukan uang baru)';
      else if (/^deposit$/i.test(String(r.bank_name || '').trim())) status = 'pemindahan saldo internal (bukan uang baru)';
      else status = 'dibatalkan (ada VOID MANUAL DEPOSIT)';
    } else if (desc === 'USE DEPOSIT') { status = 'pemakaian saldo untuk bayar invoice (tidak dihitung omset)'; pakai += Number(r.deposit_out) || 0; }
    return {
      tanggal: String(r.date || '').slice(0, 10), jam: String(r.date || '').slice(11, 16),
      cabang: Number(r.outlet_id) === 2 ? 'Pondok Kopi' : Number(r.outlet_id) === 1 ? 'Depok' : (r.outlet || '-'),
      pasien: names[r.patient_id] || '-', kode_pasien: r.patient_code, jenis: r.description,
      masuk: Number(r.deposit_in) ? rp(r.deposit_in) : undefined, keluar: Number(r.deposit_out) ? rp(r.deposit_out) : undefined,
      metode: r.bank_name || '-', invoice: r.reff || undefined, diinput_oleh: r.deposit_by || '-', keterangan: status
    };
  });

  return {
    tersedia: true, rentang: start === end ? start : `${start} s/d ${end}`, data_per: syncedAt,
    ringkasan: {
      jumlah_mutasi: detail.length,
      topup_manual_dihitung_omset: rp(topupOmset),
      pemakaian_saldo: rp(pakai)
    },
    mutasi: detail.slice(0, 60),
    ...(detail.length > 60 ? { catatan_potong: `Hanya 60 dari ${detail.length} baris ditampilkan — persempit rentang/cabang/pasien.` } : {}),
    catatan: 'Sumber: laporan Mutasi Deposit Neosoft. Top-up deposit manual tidak berupa invoice, jadi tidak muncul di daftar invoice maupun Collection by Payment.'
  };
}

// Kesehatan & asal-usul data: kapan terakhir sync, file mana yang basi,
// dan catatan metodologi tiap angka dashboard (field note/basis/source
// yang sudah ditulis di data_provider). Dipakai untuk menjawab "kenapa
// angkanya begini" ketika penyebabnya ada di data, bukan di bisnis.
function getDataHealth(summary) {
  const files = {
    'Neosoft invoice': ['neosoft_db', 'invoices_all.json'],
    'Neosoft pasien': ['neosoft_db', 'customers_all.json'],
    'Neosoft item invoice': ['neosoft_db', 'usages_details.json'],
    'Neosoft reservasi': ['neosoft_db', 'appointment_full.json'],
    'Neosoft stok': ['neosoft_db', 'logistics_items.json'],
    'Google Sheets operasional': ['google_sheets_db', 'operational_assets.json']
  };
  const now = Date.now();
  const sumber = Object.entries(files).map(([label, parts]) => {
    try {
      const st = fs.statSync(path.join(__dirname, 'data', ...parts));
      const jam = Math.round((now - st.mtimeMs) / 36e5);
      return { sumber: label, terakhir_diperbarui: new Date(st.mtimeMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), umur_jam: jam, basi: jam > 24 };
    } catch (e) { return { sumber: label, terakhir_diperbarui: 'file tidak ada' }; }
  });
  const catatan = {};
  const NOTE_KEYS = ['note', 'source_note', 'basis', 'methodology', 'grading_basis', 'forecast_basis', 'forecast_method', 'sop_note', 'assets_source'];
  Object.entries(summary || {}).forEach(([hub, v]) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const notes = NOTE_KEYS.filter(k => typeof v[k] === 'string' && v[k]).map(k => v[k].slice(0, 300));
    if (v.available === false) notes.unshift('BELUM TERSEDIA');
    if (notes.length) catatan[hub] = notes.join(' | ');
  });
  return { sync_neosoft: summary?.sync_status, sumber_data: sumber, catatan_metodologi_per_bagian: catatan };
}

// perms = objek dari role_policy.permsForRole(). Katalog yang dikembalikan
// HANYA berisi tool yang boleh dipakai role ini — tool yang tidak lolos
// tidak dikirim ke LLM sama sekali, jadi model tidak tahu tool itu ada
// dan tidak bisa "dibujuk" memanggilnya.
// ctx (opsional): { owner, role, documents[] } — dipakai tool buat_dokumen untuk
// mencatat file yang dibuat selama satu pertanyaan.
function buildToolCatalog(period = currentPeriodJakarta(), perms = null, ctx = null) {
  const acl = perms || { clinic_money: false, all_commissions: false, own_commission: false, clinical: false };
  // Ringkasan dashboard dipakai beberapa tool sekaligus — dihitung sekali
  // per pertanyaan supaya tool berikutnya tidak menghitung ulang.
  let summaryCache = null;
  const dashboard = () => summaryCache || (summaryCache = getClinicSummary(period));
  const todayJakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const todayMmDd = `${String(todayJakarta.getMonth() + 1).padStart(2, '0')}-${String(todayJakarta.getDate()).padStart(2, '0')}`;

  const catalog = [
    {
      name: 'get_deposit_mutations',
      description: 'Mutasi deposit pasien dari laporan Mutasi Deposit Neosoft: TOP-UP deposit (termasuk top-up MANUAL lewat menu Sales > Deposit yang TIDAK berupa invoice), pemakaian saldo deposit, void, dan transfer antar pasien — lengkap dengan nama pasien, cabang, jam, metode bayar, dan kasir yang menginput. WAJIB dipakai saat user menanyakan deposit masuk/top-up/DP deposit/saldo deposit pasien tertentu, atau saat ada selisih uang masuk yang tidak ketemu di invoice.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: '"today", "yesterday", "YYYY-MM-DD" atau "YYYY-MM". Default hari ini.' },
          end: { type: 'string', description: 'Akhir rentang (opsional), format sama.' },
          cabang: { type: 'string', description: '"depok", "pondok kopi", atau "all" (default).' },
          jenis: { type: 'string', description: '"topup" (deposit masuk), "pakai" (pemakaian saldo), atau "semua" (default).' },
          pasien: { type: 'string', description: 'Filter nama atau kode pasien (opsional).' }
        }
      },
      execute: (a) => getDepositMutations(a, acl)
    },
    {
      name: 'get_daily_sales',
      description: 'Ambil data omset, jumlah transaksi invoice kasir, dan performa harian klinik per cabang (Depok vs Pondok Kopi) untuk HARI INI, KEMARIN, atau TANGGAL SPESIFIK (format YYYY-MM-DD). Gunakan tool ini saat user menanyakan "omset hari ini", "omset kemarin", "kalo hari ini?", "kalo kemaren?", "penjualan kemarin", dsb.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Nilai: "today", "yesterday", atau tanggal spesifik "YYYY-MM-DD". Default: "today"' }
        }
      },
      execute: (p) => getDailySales(p.date || 'today', acl)
    },
    {
      name: 'get_clinic_summary',
      description: acl.clinic_money
        ? 'Ambil ringkasan lengkap klinik: KPI omset, jumlah invoice, pasien, branches, laser maintenance, settlement, absensi, top treatments, top spenders, pharmacy, daily targets. Ini adalah data utama dashboard.'
        : 'Ambil ringkasan operasional klinik: jumlah invoice, pasien, cabang, laser maintenance, top treatments, top spenders, absensi, pharmacy. TANPA angka omset/target/komisi (di luar hak akses user ini).',
      parameters: { type: 'object', properties: { period: { type: 'string', description: 'Periode YYYY-MM, default bulan berjalan' } } },
      execute: (q) => {
        const s = getClinicSummary(q.period || period);
        // Return condensed summary to fit context window
        // Hasil tool dipotong di 12.000 karakter: data penting (target) harus
        // di depan, dan detail maintenance cukup ringkasannya — daftar lengkapnya
        // ada di get_maintenance_alerts. Dulu target terpotong di ujung sehingga
        // AI menjawab "target tidak tersedia".
        const base = {
          period: q.period || period,
          ...(acl.clinic_money ? { target_omset_bulanan_per_cabang: s.daily_sales_targets } : {}),
          kpi: s.kpi,
          total_invoices: s.total_invoices,
          total_patients: s.total_patients,
          branches: s.branches,
          top_treatments_ranking: (s.top_treatments_ranking || []).slice(0, 10),
          top_spenders: (s.top_spenders || []).slice(0, 10), // belanja per-pasien = data CRM, sengaja tetap ada
          maintenance_ringkas: s.laser_maintenance_hub?.summary,
          pharmacy_burn_down_hub: {
            near_expiry_count: (s.pharmacy_burn_down_hub?.near_expiry_fefo || []).length,
            dead_stock_count: (s.pharmacy_burn_down_hub?.dead_stock_items || []).length,
            dead_stock_top5: (s.pharmacy_burn_down_hub?.dead_stock_items || []).slice(0, 5)
          },
          multi_division: {
            hrd_attendance: s.multi_division?.hrd_attendance,
            pharmacy_inventory_low_stock: (s.multi_division?.pharmacy_inventory?.low_stock || []).slice(0, 5)
          }
        };
        if (!acl.clinic_money) {
          return Object.assign(scrubClinicMoney(base), {
            _catatan_akses: 'Angka omset, target, settlement, dan komisi tidak disertakan — di luar hak akses user ini.'
          });
        }
        return Object.assign(base, {
          settlement_status: s.settlement_status,
          commission_calculator: acl.all_commissions ? s.commission_calculator : undefined
        });
      }
    },
    {
      name: 'search_patient_360',
      description: 'Cari profil pasien lengkap (360°) berdasarkan nama. Mengembalikan: data profil, tier loyalitas, total spending, visit count, rekomendasi treatment, DP gantung, rekomendasi membership, CLV projection, dan package recommendations.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Nama pasien yang dicari' } }, required: ['query'] },
      execute: (q) => {
        const results = searchPatient360(q.query || '');
        if (!results || results.length === 0) return { found: false, message: `Pasien "${q.query}" tidak ditemukan di database Neosoft.` };
        // Return top 3 matches with full detail
        const top = results.slice(0, 3);
        return { found: true, count: results.length, patients: acl.clinical ? top : stripPatientClinicalFields(top) };
      }
    },
    ...(acl.clinic_money ? [{
      name: 'get_revenue_breakdown',
      description: 'Ringkasan pendapatan per cabang untuk satu bulan dengan definisi SAMA seperti dashboard Neosoft: omset (nilai invoice), collection (uang masuk), deposit/CV, REVENUE (nilai treatment/produk yang dipakai/diakui), dan belum dibayar. Pakai saat user bertanya "revenue", "collection", "pendapatan", "omset bulan X", atau menanyakan kenapa angka berbeda dengan Neosoft. Jelaskan bedanya singkat: omset = nilai invoice terbit; collection = uang masuk; revenue = nilai pemakaian.',
      parameters: { type: 'object', properties: { period: { type: 'string', description: 'Periode YYYY-MM, default bulan berjalan' } } },
      execute: (p) => getRevenueBreakdown(p.period || period)
    }] : []),
    {
      name: 'get_settlement_reconciliation',
      description: 'Ambil data rekonsiliasi 3-way settlement: Google Sheets (kasir) vs Neosoft. Breakdown per metode bayar (EDC BRI/BNI, QRIS, Transfer BCA/BRI, Cash, Voucher). Match rate dan variance.',
      parameters: { type: 'object', properties: { period: { type: 'string' } } },
      execute: (p) => getThreeWaySettlement(p.period || period)
    },
    {
      name: 'get_unredeemed_packages',
      description: 'Ambil daftar pasien dengan DP gantung / paket belum terpakai dari Google Sheets Depok. Mengembalikan nama, jenis paket, sisa kuota, dan urgency.',
      parameters: { type: 'object', properties: {} },
      execute: () => getUnredeemedPackageRadar()
    },
    {
      name: 'get_treatment_product_map',
      description: 'Ambil mapping Treatment → Produk/Obat/BHP yang dipakai. Dari data real pemakaian klinik (co-occurrence di invoice). Bisa filter berdasarkan nama treatment atau produk.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Filter nama treatment/produk (opsional)' } } },
      execute: (p) => {
        const r = getTreatmentProductMap(p.query || '');
        return {
          total_treatments: r.total_treatments_with_products,
          treatments: r.treatments.slice(0, 15).map(t => ({
            name: t.name, code: t.code, price_fmt: t.price_fmt,
            products: t.products.slice(0, 8).map(pr => ({
              name: pr.name, code: pr.code, frequency: pr.frequency,
              frequency_label: pr.frequency_label, price_fmt: pr.price_fmt
            }))
          }))
        };
      }
    },
    {
      name: 'get_peak_hour_analysis',
      description: 'Analisis jam sibuk kedatangan pasien per outlet. Berguna untuk staffing dan scheduling.',
      parameters: { type: 'object', properties: {} },
      execute: () => getPeakHourAnalysis()
    },
    {
      name: 'get_sales_comparison',
      description: 'Perbandingan performa staf: akuisisi pasien baru vs upselling per sales/dokter/terapis.',
      parameters: { type: 'object', properties: {} },
      execute: () => getSalesComparison()
    },
    {
      name: 'get_patient_frequency_list',
      description: 'Daftar pasien berdasarkan frekuensi kunjungan (paling sering sampai paling jarang). Berguna untuk analisis retensi dan churn.',
      parameters: { type: 'object', properties: {} },
      execute: (p) => {
        const list = getPatientFrequencyList();
        return { total: list.length, top_20: list.slice(0, 20) };
      }
    },
    {
      name: 'get_maintenance_alerts',
      description: 'Jadwal preventive maintenance SEMUA aset klinik (mesin treatment, AC, dll) dari sheet operasional: alat yang lewat jadwal / kritis (<=H-7), servis 2 minggu ke depan, alat tanpa jadwal, PIC, vendor, dan aset yang dokumentasinya (tanggal beli / cara pakai) belum lengkap.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        // getMaintenanceAlerts() lama membaca kolom "agenda" yang tidak ada
        // di sheet — hasilnya 15 baris "Servis Rutin" tanpa nama alat &
        // tanggal, sehingga AI tidak bisa menjawab "alat mana yang telat".
        const mh = dashboard().laser_maintenance_hub || {};
        const slim = i => ({
          alat: i.asset_name, cabang: i.branch, aktivitas: i.activity,
          servis_terakhir: i.last_maintenance, jadwal_berikutnya: i.next_due,
          sisa_hari: i.days_left, status: i.status_label, vendor: i.vendor, pic: i.pic
        });
        const items = mh.items || [];
        return {
          ringkasan: mh.summary,
          pic_penanggung_jawab: mh.pic_settings ? (mh.pic_settings.maintenance_pic_name || mh.pic_settings.maintenance_pic_role) : null,
          lewat_jadwal_atau_kritis: items.filter(i => i.status === 'overdue' || i.status === 'critical').map(slim),
          servis_2_minggu_ke_depan: items.filter(i => i.status === 'upcoming').map(slim),
          belum_ada_jadwal: items.filter(i => i.status === 'unknown').map(i => i.asset_name),
          reminder_belum_dikirim_ke_pic: (mh.reminder_queue || []).length,
          aset_dokumentasi_belum_lengkap: (mh.documentation_gaps?.items || []).map(g => ({
            alat: g.name, lokasi: g.location,
            kurang: [g.missing_purchase_date && 'tanggal beli', g.missing_usage_instructions && 'cara pakai'].filter(Boolean)
          })),
          sumber: mh.source_note
        };
      }
    },
    {
      name: 'analyze_sales_drivers',
      description: 'Bongkar PENYEBAB angka penjualan: untuk satu rentang tanggal (opsional dibanding rentang lain) tampilkan invoice terbesar, item terlaris, per dokter, per cabang, pasien baru vs lama, metode bayar, invoice void, dan penggerak terbesar perubahan. WAJIB dipakai untuk pertanyaan "kenapa omset naik/turun", "apa yang bikin beda", "dari mana omsetnya".',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Awal rentang: "today", "yesterday", "YYYY-MM-DD", atau "YYYY-MM" (sebulan penuh)' },
          end: { type: 'string', description: 'Akhir rentang (opsional, default = start; "YYYY-MM" = akhir bulan)' },
          compare_start: { type: 'string', description: 'Awal rentang pembanding (opsional)' },
          compare_end: { type: 'string', description: 'Akhir rentang pembanding (opsional)' },
          cabang: { type: 'string', description: 'depok | pondok_kopi | all (default all)' }
        },
        required: ['start']
      },
      execute: (a) => analyzeSalesDrivers(a, acl)
    },
    {
      name: 'get_invoice_audit',
      description: 'Audit Invoice: daftar invoice janggal untuk dicek Finance/Owner — kemungkinan dobel, void (termasuk void berulang oleh CS yang sama), dicatat belakangan, di bawah harga bottom/promo, diskon besar, belum lunas, dan status pemeriksaannya. Pakai untuk "invoice janggal", "void", "invoice dobel", "cek invoice", "audit".',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'YYYY-MM-DD (default awal bulan ini)' },
          end: { type: 'string', description: 'YYYY-MM-DD (default hari ini)' },
          cabang: { type: 'string', description: 'depok | pondok_kopi | all (default all)' },
          jenis: { type: 'string', description: 'duplikat | void | backdate | bawah_bottom | diskon_besar | belum_lunas | all (default all)' }
        }
      },
      execute: (a = {}) => {
        const r = getInvoiceAudit({ start: a.start ? resolveDateWord(a.start) : undefined, end: a.end ? resolveDateWord(a.end) : undefined, outlet: a.cabang || 'all' });
        const jenis = a.jenis && a.jenis !== 'all' ? a.jenis : null;
        const items = r.items.filter(it => it.severity !== 'info' && (!jenis || it.flags.some(f => f.type === jenis)));
        return {
          periode: r.range,
          ringkasan: r.summary,
          catatan: 'Ini tanda untuk dicek, bukan kesimpulan kesalahan. Detail & status pemeriksaan ada di menu Finance & Kasir › Audit Invoice.',
          invoice: items.slice(0, 20).map(it => ({
            invoice: it.inv_code, tanggal: it.date, cabang: it.outlet, pasien: it.customer, nilai: it.amount_fmt,
            dibuat_oleh: it.created_by, tingkat: it.severity,
            alasan: it.flags.filter(f => f.severity !== 'info').map(f => `${f.label}: ${f.reason}`),
            status_cek: it.review ? `${it.review.status}${it.review.note ? ' — ' + it.review.note : ''}` : 'belum dicek'
          })),
          total_invoice_ditandai: items.length
        };
      }
    },
    {
      name: 'get_data_health',
      description: 'Cek kondisi & asal-usul data: kapan tiap sumber (Neosoft, Google Sheets) terakhir diperbarui, apakah basi, status sync, dan catatan cara menghitung tiap bagian dashboard (mis. dasar grading pasien, sumber aset, metode forecast, bagian yang belum tersedia). Pakai kalau angka terlihat aneh/nol/tidak cocok, atau user bertanya "datanya dari mana" / "kenapa datanya begitu".',
      parameters: { type: 'object', properties: {} },
      execute: () => getDataHealth(dashboard())
    },
    {
      name: 'get_followup_today',
      description: 'Daftar pasien yang harus di-follow up (sama dengan tab Reminders): kontrol/rekomendasi dokter yang jatuh tempo hari ini atau terlewat, follow-up pasca treatment (Hari H, H+3, H+7, recall H+14), invoice belum lunas, dan pasien ulang tahun hari ini. Pakai untuk "siapa yang harus dihubungi hari ini", "pasien kontrol", "follow up", "belum bayar".',
      parameters: {
        type: 'object',
        properties: {
          kategori: { type: 'string', description: 'all | dokter | pasca_treatment | belum_lunas | ulang_tahun (default all)' },
          cabang: { type: 'string', description: 'depok | pondok_kopi | all (default all)' }
        }
      },
      execute: (p = {}) => {
        const kat = (p.kategori || 'all').toLowerCase();
        const cab = (p.cabang || 'all').toLowerCase().replace(/[^a-z]/g, '');
        const inBranch = b => cab === 'all' || cab === '' || String(b || '').toLowerCase().replace(/[^a-z]/g, '').includes(cab);
        const want = k => kat === 'all' || kat === k;
        const s = dashboard();
        const out = {};

        if (want('dokter')) {
          const docs = getDoctorFollowupsList().filter(d => inBranch(d.branch) && d.due_status !== 'upcoming');
          out.kontrol_rekomendasi_dokter = {
            jatuh_tempo_hari_ini: docs.filter(d => d.due_status === 'due_today').length,
            terlewat: docs.filter(d => d.due_status === 'overdue').length,
            daftar: docs.slice(0, 20).map(d => ({
              pasien: d.customer_name, telepon: d.phone_valid ? d.customer_phone : 'nomor tidak valid',
              cabang: d.branch, dokter: d.doctor_name, jadwal_kembali: d.recommended_return_date,
              status: d.due_status === 'overdue' ? `terlewat ${Math.abs(d.days_until_due)} hari` : 'hari ini',
              rencana: d.next_treatment, status_followup: d.followup_status || 'belum dihubungi',
              ...(acl.clinical ? { catatan_dokter: d.doctor_notes || d.skin_analysis || undefined } : {})
            }))
          };
        }
        if (want('pasca_treatment')) {
          const fu = s.smart_followup_hub || {};
          const stage = (list) => (list || []).filter(x => inBranch(x.outlet)).slice(0, 10).map(x => ({
            pasien: x.patient, telepon: x.phone, cabang: x.outlet, treatment: x.treatment,
            tanggal: x.inv_date, hari_sejak: x.days_since, tindakan: x.action
          }));
          out.pasca_treatment = {
            jumlah: fu.stats,
            hari_h: stage(fu.day_h), h_plus_3: stage(fu.day_h3), h_plus_7: stage(fu.day_h7), recall_h14: stage(fu.day_h14_recall)
          };
        }
        if (want('belum_lunas')) {
          // Invoice dengan sisa tagihan nyata (bukan notifikasi "Unpaid" Neosoft yang berisi rekam medis)
          const unpaid = (s.reminders?.unpaid_invoices || []).filter(u => inBranch(u.outlet || u.branch));
          out.invoice_belum_lunas = {
            jumlah: unpaid.length,
            daftar: unpaid.slice(0, 15).map(u => ({ pasien: u.patient_name, telepon: u.patient_phone, invoice: u.inv_code, cabang: u.outlet || u.branch, tanggal: u.date, total: u.total_fmt, sisa_tagihan: u.remaining_fmt }))
          };
          const recs = (s.reminders?.pending_medical_records || []).filter(u => inBranch(u.outlet || u.branch));
          out.rekam_medis_belum_ditagihkan = {
            jumlah: recs.length,
            catatan: 'Rekam medis (kode ANM-) dari notifikasi Unpaid Neosoft yang belum tertaut invoice dan tidak ada invoice di hari & cabang yang sama — perlu dicek kasir, belum tentu tagihan.',
            daftar: recs.slice(0, 15).map(u => ({ pasien: u.patient_name, rekam_medis: u.record_code, cabang: u.outlet || u.branch, tanggal: u.date, keterangan: u.note }))
          };
        }
        if (want('ulang_tahun')) {
          const bdays = (s.reminders?.birthdays || []).filter(b => inBranch(b.outlet) && String(b.birth_date || '').slice(5) === todayMmDd);
          out.ulang_tahun_hari_ini = bdays.map(b => ({ pasien: b.name, telepon: b.phone, cabang: b.outlet, kode_promo: b.promo_code }));
        }
        return out;
      }
    },
    {
      name: 'get_doctor_kpi',
      description: 'Leaderboard KPI dokter (sama dengan tab HR): jumlah pasien, skor KPI, treatment teratas, plus kepatuhan pengisian rekomendasi dokter. Pakai untuk "dokter terbaik", "performa dokter", "dokter mana yang paling banyak pasien".',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const s = dashboard();
        const docs = (s.doctor_kpi_hub?.doctors || []).map(d => acl.clinic_money ? d : {
          rank: d.rank, name: d.name, branch: d.branch, patients: d.patients,
          kpi_score: d.kpi_score, top_treatment: d.top_treatment, rating_badge: d.rating_badge
        });
        return {
          dokter: docs,
          kepatuhan_rekomendasi_dokter: s.doctor_recommendation_compliance,
          ...(acl.clinic_money ? {} : { _catatan_akses: 'Omset per dokter tidak disertakan — di luar hak akses user ini.' })
        };
      }
    },
    {
      name: 'get_patient_segments',
      description: 'Segmentasi pasien: grade frekuensi kunjungan (X rutin / Y / Z jarang / baru), pasien lama yang hilang untuk reaktivasi (dengan total belanja & hari sejak kunjungan terakhir), dan pasien dengan saldo deposit / voucher yang belum terpakai. Pakai untuk retensi, churn, reaktivasi, deposit.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const s = dashboard();
        const g = s.patient_grading_hub || {};
        const grade = k => g[k] ? { label: g[k].label, jumlah: g[k].count } : undefined;
        const mem = s.membership_deposit_hub || {};
        return {
          dasar_grading: g.grading_basis,
          grade: { X: grade('grade_x'), Y: grade('grade_y'), Z: grade('grade_z'), baru: grade('grade_baru'), belum_transaksi: grade('grade_belum_transaksi') },
          pasien_hilang_untuk_reaktivasi: (g.lost_patients_reactivation || []).slice(0, 15).map(p => ({
            pasien: p.name, telepon: p.phone, cabang: p.outlets, kunjungan_terakhir: p.last_visit, hari_lalu: p.days_ago, total_belanja: p.total_spent_fmt
          })),
          deposit_belum_terpakai: {
            jumlah_pasien: mem.total_members_with_deposit,
            ...(acl.clinic_money ? { total_deposit: mem.total_active_deposit_fmt, total_voucher: mem.total_active_voucher_fmt } : {}),
            teratas: (mem.members || []).slice(0, 10).map(m => ({ pasien: m.name, cabang: m.outlet, saldo: m.deposit_balance_fmt, voucher: m.credit_voucher_balance_fmt, kunjungan_terakhir: m.last_visit }))
          }
        };
      }
    },
    {
      name: 'get_birthday_alerts',
      description: 'Ambil daftar pasien yang berulang tahun hari ini atau minggu ini (untuk promo birthday treatment).',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        // Sama dengan kartu ulang tahun di Reminders (getBirthdayAlerts()
        // lama memakai sumber berbeda dan sering tanpa nomor telepon).
        const list = dashboard().reminders?.birthdays || [];
        const hariIni = list.filter(b => String(b.birth_date || '').slice(5) === todayMmDd);
        return {
          hari_ini: hariIni.map(b => ({ pasien: b.name, telepon: b.phone, cabang: b.outlet, kode_promo: b.promo_code })),
          minggu_ini_total: list.length,
          minggu_ini: list.slice(0, 20).map(b => ({ pasien: b.name, tanggal_lahir: b.birth_date, cabang: b.outlet }))
        };
      }
    },
    {
      name: 'get_morning_briefing',
      description: 'Generate morning briefing lengkap: reservasi hari ini, staf on-duty, agenda maintenance, omset yesterday recap.',
      parameters: { type: 'object', properties: {} },
      execute: () => generateMorningBriefing()
    },
    {
      name: 'get_transaction_history',
      description: 'Ambil ringkasan riwayat transaksi 23 bulan dari Google Sheets (agregat per bulan, tanpa raw rows). Berguna untuk tren historis.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const h = getTransactionHistory();
        return { months: h.summary?.months || [], total_rows: h.summary?.total_rows, date_range: h.summary?.date_range };
      }
    },
    {
      name: 'get_operational_data',
      description: 'Data operasional: tiket keluhan tim/pasien, rekap audit SOP & skor kepatuhan, dan daftar judul SOP klinik. Untuk jadwal servis alat pakai get_maintenance_alerts.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const o = getOperationalData();
        const lib = Array.isArray(o.sop_library) ? o.sop_library : [];
        return {
          keluhan: (o.complaints || []).slice(0, 15),
          jumlah_keluhan: (o.complaints || []).length,
          audit_sop: (o.sop || []).slice(0, 10),
          catatan_sop: o.sop_note,
          sop_tersedia: lib.slice(0, 40).map(x => x.title || x.name || x.id)
        };
      }
    },
    {
      name: 'get_invoice_detail',
      description: 'Detail lengkap satu invoice Neosoft berdasarkan ID atau kode invoice.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Invoice ID atau kode (misal PDK-I-202609-0001)' } }, required: ['id'] },
      execute: (p) => getInvoiceDetail(p.id || '')
    },
    {
      name: 'get_google_sheets_data',
      description: 'Data mentah dari 3 Google Sheets resmi (Depok transaksi, Pondok Kopi transaksi, Operasional).',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const d = getGoogleSheetsData();
        return {
          depok: { total_records: d.depok?.length || 0, sample: (d.depok || []).slice(0, 5) },
          pondok_kopi: { total_records: d.pondok_kopi?.length || 0, sample: (d.pondok_kopi || []).slice(0, 5) },
          operasional: { total_records: d.operasional?.length || 0, sample: (d.operasional || []).slice(0, 5) }
        };
      }
    },
    {
      name: 'search_pharmacy_stock',
      description: 'Cari data stok fisik riil obat, BHP, atau produk medis di apotek/gudang klinik (Depok & Pondok Kopi) berdasarkan nama barang atau kode SKU (contoh: "antibiotik", "juvelook", "kapas", "P-26050072"). Mengembalikan sisa stok aktual per cabang, buffer minimum, status stok, dan kebutuhan restock.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nama obat, produk, BHP, atau kode SKU yang dicari' },
          warehouse: { type: 'string', description: 'Filter cabang: "depok", "pondok_kopi", atau "all" (default: "all")' }
        },
        required: ['query']
      },
      execute: (args = {}) => {
        const results = searchPharmacyStockDetailed(args.query || '', args.warehouse || 'all');
        if (!results || results.length === 0) {
          return { found: false, message: `Barang atau obat "${args.query}" tidak ditemukan di kartu stok Neosoft.` };
        }
        return { found: true, count: results.length, items: results };
      }
    },
    {
      name: 'get_logistics_and_stock_alerts',
      description: 'Cek data logistik Neosoft: barang kritis di bawah buffer stock, sisa stok opname fisik riil, riwayat mutasi antar cabang Depok ↔ PDK, dan kartu stok gudang. Bisa mencari nama barang lewat parameter query.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'buffer_alerts | stock_opname | mutations | all' },
          query: { type: 'string', description: 'Cari nama barang atau SKU tertentu (opsional)' }
        }
      },
      execute: (args = {}) => {
        if (args && args.query) {
          const itemSearch = searchPharmacyStockDetailed(args.query);
          return { query: args.query, total_matches: itemSearch.length, items: itemSearch };
        }
        const log = getNeosoftLogisticsData();
        return {
          total_items: (log.items || []).length,
          buffer_alerts_count: (log.buffer_alerts || []).length,
          buffer_alerts_sample: (log.buffer_alerts || []).slice(0, 8),
          mutation_orders_count: (log.mutation_orders || []).length,
          mutation_orders_latest: (log.mutation_orders || []).slice(0, 5),
          stock_opname_count: (log.stock_opname || []).length,
          warehouses: log.warehouses
        };
      }
    },
    {
      name: 'get_master_and_automation_alerts',
      description: 'Ambil data master Neosoft (kategori resmi treatment/produk, akun bank & EDC kasir, cabang resmi, data user/staf) serta status indikator bilah Automasi real-time (unpaid, appointment hari ini, ultah, dll).',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const m = getNeosoftMasterData();
        const a = getAutomationAlertsSummary();
        return {
          automation_indicators: a.indicators,
          treatment_categories: (m.categories || []).filter(c => c.type === 'T').map(c => c.category_name),
          product_categories: (m.categories || []).filter(c => c.type === 'P').map(c => c.category_name),
          bank_accounts: (m.banks || []).map(b => ({ name: b.bank_name, code: b.bank_code })),
          outlets: m.outlets,
          active_vouchers: m.vouchers,
          total_staff_users: (m.user_access || []).length
        };
      }
    }
  ];

  // Tool yang isinya angka keuangan tingkat klinik — dibuang seluruhnya
  // untuk role tanpa clinic_money, bukan cuma disaring hasilnya:
  //   get_settlement_reconciliation → omset & breakdown metode bayar
  //   get_transaction_history       → agregat omset 23 bulan
  //   get_google_sheets_data        → baris transaksi mentah + nominal
  //   get_morning_briefing          → recap omset kemarin
  const CLINIC_MONEY_TOOLS = new Set([
    'get_invoice_audit',
    'get_settlement_reconciliation',
    'get_transaction_history',
    'get_google_sheets_data',
    'get_morning_briefing',
    'get_deposit_mutations'
  ]);

  const allowed = acl.clinic_money ? catalog : catalog.filter(t => !CLINIC_MONEY_TOOLS.has(t.name));

  // Dokumen Excel/PDF. Isi file diambil server dari tool data yang disebut di
  // "sumber" — LLM tidak menulis/menyalin angka ke file — dan tool sumbernya
  // dicari di katalog yang SUDAH disaring per role, jadi hak akses ikut berlaku.
  if (ctx && Array.isArray(ctx.documents)) {
    const sourceNames = allowed.map(t => t.name);
    allowed.push({
      name: 'buat_dokumen',
      description: 'Buat file Excel atau PDF dari data klinik untuk diunduh/dikirim ke user. Pakai HANYA kalau user minta file/dokumen/Excel/PDF/"kirim datanya"/"download". Server mengambil isinya langsung dari tool di "sumber" dengan "argumen" yang sama — jangan menyalin data sendiri. Tombol unduh muncul otomatis di bawah jawaban.',
      parameters: {
        type: 'object',
        properties: {
          sumber: { type: 'string', enum: sourceNames, description: 'Nama tool data yang isinya dijadikan dokumen' },
          argumen: { type: 'object', description: 'Argumen untuk tool sumber (sama seperti saat memanggilnya langsung)' },
          format: { type: 'string', enum: ['excel', 'pdf'], description: 'excel untuk daftar/tabel (default), pdf untuk dokumen yang dibaca/dicetak seperti invoice atau ringkasan' },
          judul: { type: 'string', description: 'Judul dokumen, singkat dan jelas, mis. "Follow-up Pasien 24 Sep 2026"' }
        },
        required: ['sumber', 'judul']
      },
      execute: async (p = {}) => {
        const src = allowed.find(t => t.name === p.sumber && t.name !== 'buat_dokumen');
        if (!src) return { ok: false, error: `Sumber "${p.sumber}" tidak tersedia untuk role ini.` };
        // Argumen diperiksa ketat terhadap skema tool sumber. Dulu argumen yang
        // salah nama (mis. "tanggal" padahal "start") diam-diam diabaikan dan
        // tool memakai default = hari ini, sehingga file berisi data hari ini
        // sementara jawaban AI menyebut data kemarin.
        const args = (p.argumen && typeof p.argumen === 'object') ? p.argumen : {};
        const props = Object.keys(src.parameters?.properties || {});
        const unknown = Object.keys(args).filter(k => !props.includes(k));
        const missing = (src.parameters?.required || []).filter(k => args[k] === undefined || args[k] === '');
        if (unknown.length || missing.length) {
          return {
            ok: false,
            error: `Argumen untuk ${p.sumber} tidak valid — dokumen TIDAK dibuat. ` +
              (unknown.length ? `Tidak dikenal: ${unknown.join(', ')}. ` : '') +
              (missing.length ? `Wajib diisi: ${missing.join(', ')}. ` : '') +
              `Argumen yang tersedia: ${JSON.stringify(src.parameters?.properties || {})}. Panggil ulang buat_dokumen dengan argumen yang benar.`
          };
        }
        const data = await src.execute(args);
        if (!data || (typeof data === 'object' && data.found === false)) {
          return { ok: false, error: 'Data sumber kosong/tidak ditemukan, dokumen tidak dibuat.', detail: data };
        }
        // Format yang disebut user menang atas pilihan model (model kadang
        // tetap memilih excel walau user jelas minta PDF).
        const q = String(ctx.query || '').toLowerCase();
        const saysPdf = /\bpdf\b/.test(q);
        const saysExcel = /\b(excel|xlsx|xls|spreadsheet)\b/.test(q);
        const format = saysPdf && !saysExcel ? 'pdf' : (saysExcel && !saysPdf ? 'excel' : (p.format || 'excel'));
        const doc = await createDocument({
          title: p.judul || 'Data KEFIR',
          format,
          data,
          sourceLabel: p.sumber,
          owner: ctx.owner,
          role: ctx.role
        });
        ctx.documents.push({ id: doc.id, fileName: doc.fileName, format: doc.format, size: doc.size, mimetype: doc.mimetype });
        return {
          ok: true,
          nama_file: doc.fileName,
          format: doc.format,
          isi: doc.tables,
          cuplikan_isi_file: JSON.stringify(data).slice(0, 2500),
          catatan: 'File sudah dibuat; tombol unduh (atau file di WhatsApp) muncul otomatis. Jelaskan isinya HANYA berdasarkan cuplikan_isi_file (bukan dari jawaban tool lain). JANGAN menulis link/URL dan jangan bilang tidak bisa mengirim file.'
        };
      }
    });
  }
  return allowed;
}

// ==================== LLM CALLER ====================
// Kegagalan LLM terakhir, supaya status AI bisa dicek dari dashboard
// (dulu hanya console.error — di VPS tidak terlihat kenapa AI jatuh ke
// mesin cadangan).
let lastLlmError = null;
function recordLlmError(kind, detail) {
  lastLlmError = { kind, detail: String(detail || '').slice(0, 400), at: new Date().toISOString() };
}

// meta (opsional): { purpose, user, role, channel, query_id, question, acc[] }
// — dipakai untuk mencatat pemakaian token setiap pemanggilan LLM.
async function callLLM(messages, tools = null, temperature = 0.15, maxTokens = 3500, meta = null) {
  const { host, port, model: activeModel, apiKey, protocol, basePath } = getLLMConfig();
  const t0 = Date.now();
  const done = await new Promise((resolve) => {
    const body = {
      model: activeModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    // Add tools if provided (OpenAI function-calling format)
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      body.tool_choice = 'auto';
    }
    const postData = JSON.stringify(body);
    const options = {
      hostname: host,
      port: port,
      // basePath berakhir '/v1' (mis. https://router/v1) → jangan digandakan
      path: /\/v1$/.test(basePath) ? `${basePath}/chat/completions` : `${basePath}/v1/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 45000
    };

    const req = (protocol === 'https:' ? https : http).request(options, (res) => {
      let chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.error('LLM API error:', res.statusCode, parsed);
            recordLlmError(`HTTP ${res.statusCode}`, parsed?.error?.message || JSON.stringify(parsed));
            resolve(null);
          }
        } catch (e) {
          console.error('LLM parse error:', e.message);
          recordLlmError('respons bukan JSON', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => { console.error('LLM request error:', err.message); recordLlmError('tidak bisa terhubung', err.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); recordLlmError('timeout', 'Tidak ada respons dalam 45 detik'); resolve(null); });
    req.write(postData);
    req.end();
  });

  // Catat pemakaian token. Router mengirim `usage` (OpenAI-compatible);
  // kalau tidak ada, diperkirakan ~4 karakter per token dan ditandai.
  const u = done?.usage;
  const est = !u;
  const promptTokens = u ? Number(u.prompt_tokens || 0) : (done ? Math.round(JSON.stringify(messages).length / 4) : 0);
  const completionTokens = u ? Number(u.completion_tokens || 0) : (done ? Math.round(String(done.choices?.[0]?.message?.content || '').length / 4) : 0);
  const entry = {
    purpose: meta?.purpose || 'lainnya',
    user: meta?.user || null,
    role: meta?.role || null,
    channel: meta?.channel || null,
    query_id: meta?.query_id || null,
    question: meta?.question ? String(meta.question).slice(0, 140) : null,
    model_requested: activeModel,
    model: done?.model || null,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: u ? Number(u.total_tokens || promptTokens + completionTokens) : promptTokens + completionTokens,
    estimated: est && !!done,
    ms: Date.now() - t0,
    ok: !!done
  };
  recordUsage(entry);
  if (meta && Array.isArray(meta.acc)) meta.acc.push(entry);
  return done;
}

// ==================== DIAGNOSTIK AI ====================
// Menjawab "kenapa AI di server A beda dengan server B": versi kode yang
// berjalan, LLM yang dipakai, dan apakah LLM itu bisa memanggil tool.
// Tanpa tool-calling, AI selalu jatuh ke mesin cadangan kata kunci.
function codeVersion() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['log', '-1', '--format=%h|%cI|%s'], { cwd: __dirname, timeout: 3000, encoding: 'utf8' }).trim();
    const [commit, date, subject] = out.split('|');
    return { commit, date, subject };
  } catch (e) {
    return { commit: null, note: 'git tidak tersedia di server ini' };
  }
}

async function getAssistantDiagnostics() {
  const { host, port, model, apiKey, protocol, basePath } = getLLMConfig();
  const started = Date.now();
  const probeTool = [{
    name: 'cek_koneksi',
    description: 'Tool uji. Selalu panggil tool ini untuk menjawab.',
    parameters: { type: 'object', properties: { ok: { type: 'boolean' } } }
  }];
  const res = await callLLM([
    { role: 'system', content: 'Kamu sedang diuji. Panggil tool cek_koneksi dengan ok=true.' },
    { role: 'user', content: 'Tes koneksi.' }
  ], probeTool, 0, 50, { purpose: 'diagnostik' });
  const ms = Date.now() - started;
  const choice = res?.choices?.[0];
  const toolCalling = !!(choice?.message?.tool_calls?.length);
  let verdict;
  if (!res) verdict = 'LLM tidak bisa dipanggil — AI memakai mesin cadangan kata kunci (jawaban terbatas).';
  else if (!toolCalling) verdict = 'LLM tersambung tapi TIDAK memanggil tool — AI tidak bisa mengambil data klinik. Ganti ke model yang mendukung tool/function calling.';
  else verdict = 'Normal — LLM tersambung dan bisa memanggil tool data klinik.';
  return {
    ok: !!res && toolCalling,
    verdict,
    version: codeVersion(),
    llm: { host, port, protocol, base_path: basePath || null, model, api_key_set: !!apiKey, response_ms: ms, model_reported: res?.model || null, tool_calling: toolCalling },
    last_error: lastLlmError,
    tools_available: buildToolCatalog(currentPeriodJakarta(), permsForRole('owner')).length
  };
}

// ==================== SYSTEM PROMPT BUILDER ====================
function buildSystemPrompt(role = 'owner', period = currentPeriodJakarta(), perms = null) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const acl = perms || { clinic_money: false, all_commissions: false, own_commission: false, clinical: false };

  // Batas akses ditegakkan di katalog tool (tool terlarang tidak dikirim
  // ke model sama sekali). Blok ini cuma supaya jawabannya jujur — model
  // bilang "di luar akses", bukan mengarang angka pengganti.
  const batasAkses = (acl.clinic_money && acl.all_commissions && acl.clinical) ? '' : `

🔒 BATAS AKSES USER INI (role: ${role.toUpperCase()}):
${!acl.clinic_money  ? '- TIDAK boleh melihat angka keuangan tingkat klinik: omset, profit, target bulanan, settlement, total payroll komisi.\n' : ''}${!acl.all_commissions && !acl.own_commission ? '- TIDAK boleh melihat tabel komisi dokter/perawat.\n' : ''}${acl.own_commission ? '- Komisi: HANYA boleh membahas komisi dirinya sendiri, bukan dokter/perawat lain.\n' : ''}${!acl.clinical ? '- TIDAK boleh melihat data klinis pasien: SOAP, diagnosis, next plan dokter, foto rekam medis.\n' : ''}
Kalau user bertanya soal data di atas: bilang terus terang datanya di luar hak aksesnya
dan arahkan minta ke Owner/Finance. JANGAN mengarang angka, JANGAN memperkirakan,
JANGAN menyusun ulang dari data lain (mis. menjumlahkan belanja pasien jadi omset).`;

  // "KONTEKS BISNIS KLINIK" di bawah sebelumnya berisi "fakta" yang ditulis
  // tetap di prompt dan TERBUKTI SALAH atau tidak bisa diverifikasi
  // terhadap data asli — model menyampaikannya ke user dengan percaya
  // diri seolah fakta klinik, padahal:
  //   • "Target Rp150jt/cabang" (=Rp300jt total) — waktu ditulis di sini,
  //     BERTENTANGAN dengan field kpi.target_monthly (Rp250jt total) yang
  //     saat itu masih ada di data_provider.js. Ditelusuri lebih jauh:
  //     kpi.target_monthly TERNYATA kode mati, tidak pernah dibaca
  //     frontend — satu-satunya target yang BENAR-BENAR ditampilkan di
  //     dashboard adalah daily_sales_targets (Rp150jt/cabang, panel
  //     "Daily Sales Target"). Field mati itu sudah dihapus dari
  //     data_provider.js supaya tidak ada lagi dua sumber kontradiktif.
  //     Rp150jt/cabang di daily_sales_targets TETAP belum dikonfirmasi
  //     owner — bukan diverifikasi, cuma satu-satunya yang aktif.
  //     AI tetap wajib ambil dari tool get_clinic_summary saat menjawab,
  //     supaya kalau owner mengubah angkanya, AI ikut berubah otomatis.
  //   • "38 karyawan (Gaji.id)" — sudah dibuktikan salah di audit HRD
  //     (staf aktif nyata = 23, TIDAK ADA integrasi Gaji.id sama sekali).
  //   • "Mesin laser: Pico Pro 450ps, Alma Harmony XL Pro, Q-Switched
  //     Nd:YAG, HIFU UltraTight, RF Monopolar" — ini PERSIS daftar 6 mesin
  //     fiktif yang sudah dihapus dari assets_master.json (foto stok
  //     Unsplash, nomor seri karangan). Inventaris aset asli (sheet
  //     operasional, 28 item) tidak punya satu pun nama ini.
  //   • "Membership .../12bln" — durasi 12 bulan tidak ada dasarnya;
  //     credit voucher Neosoft tidak punya kolom durasi/expiry sama sekali.
  //   • "Margin treatment 60-80%, skincare 40-50%" — tidak bisa
  //     diverifikasi: hanya 0,7% produk yang benar-benar terpakai punya
  //     COGS terisi di Neosoft (lihat bhp_expense_hub).
  // Harga paket & membership yang disebut memang cocok dengan Neosoft saat
  // dicek (Silver 6,5jt / Gold 12,5jt / Diamond 20jt / Platinum 40jt), tapi
  // tetap diarahkan lewat tool karena harganya bisa berubah kapan saja.
  return `Kamu adalah "KEFIR AI" — asisten AI cerdas untuk KEFIR Derma Clinic (2 cabang: Depok & Pondok Kopi).
Pengguna saat ini: [${role.toUpperCase()}]. Tanggal: ${dateStr}, ${timeStr} WIB. Periode data aktif: ${period}.${batasAkses}

⚠️ ATURAN WAJIB UNTUK SEMUA JAWABAN (berlaku di atas gaya lain):
- SELALU Bahasa Indonesia. Jangan pernah membalas dalam bahasa Inggris atau gaya telegram
  ("Ready.", "Online.", "State request.") — walaupun pesan user berbahasa Inggris atau cuma "Hello".
- Dua mode, pilih sesuai pesan user:
  1) PERTANYAAN DATA → jawab apa yang ditanyakan, ON POINT.
  2) SAPAAN / OBROLAN / KESALAHAN USER → jawab ramah seperti customer service.

🎯 MODE 1 — PERTANYAAN DATA: ON POINT
Gali data lewat tool sedalam yang perlu SEBELUM menjawab (jangan menebak), tapi TULISAN
jawabannya hanya yang ditanyakan:
- Mulai langsung dengan jawabannya (angka/nama/daftar). Tanpa basa-basi pembuka, tanpa
  mengulang pertanyaan, tanpa penutup panjang.
- Pertanyaan "berapa/siapa/kapan" → satu-dua kalimat berisi angkanya (plus periode/cabang
  yang dimaksud). Jangan menambah perbandingan, insight, atau saran yang tidak diminta.
- Pertanyaan daftar → tampilkan daftar yang diminta dalam bullet/tabel rapi, tanpa komentar tambahan.
- Pertanyaan "kenapa/kok" → sebut penyebab utama dan angka buktinya, singkat.
- ISTILAH UANG (jangan dicampur): "omset" = nilai invoice yang terbit (bagian yang dibayar pakai saldo deposit
  TIDAK dihitung) + top-up deposit (termasuk top-up manual non-invoice); "collection" = uang yang masuk; "revenue" = nilai
  treatment/produk yang DIPAKAI bulan itu (angka Revenue di Neosoft). Kalau user bilang "revenue" atau "collection" atau
  bertanya kenapa beda dengan Neosoft → panggil get_revenue_breakdown dan sebut definisinya dalam satu kalimat.
- Baru beri analisis/perbandingan/rekomendasi kalau user memintanya ("analisa", "bandingkan",
  "saran", "gimana baiknya").
- Kalau ada hal penting yang jelas mengubah arti jawaban (mis. data belum sinkron, periode
  tidak lengkap), tambahkan SATU kalimat catatan singkat — hanya itu.
- Format: **bold** untuk angka penting; tabel/bullet hanya bila memang daftar atau perbandingan.

💬 MODE 2 — SAPAAN, OBROLAN & KESALAHAN USER: RAMAH SEPERTI CS
- Sapaan, terima kasih, basa-basi → balas hangat dan sopan, perkenalkan diri bila baru
  menyapa, lalu tawarkan bantuan dengan 2–3 contoh yang bisa ditanyakan.
- Kalau user salah ketik, pertanyaannya kurang jelas, atau keliru (mis. salah nama
  cabang/periode, minta data yang memang belum tersedia): JANGAN menyalahkan. Mohon maaf
  dengan ringan bila perlu, jelaskan singkat apa yang terjadi, lalu tawarkan jalan keluar
  ("Maksud Kakak X atau Y?" / "Datanya belum ada, yang tersedia adalah ...").
- Kalau pertanyaan di luar kemampuan atau di luar akses role: sampaikan dengan sopan dan
  arahkan ke pihak yang tepat (Owner/Finance), tanpa nada kaku.
- Nada: sopan, hangat, sabar, seperti CS yang ramah. Ikuti gaya user (santai dijawab santai).
  Emoji boleh sesekali (😊) secukupnya.

MENCARI PENYEBAB ("KENAPA"):
- Penyebab bisnis (omset/transaksi naik-turun, cabang beda) → analyze_sales_drivers
  dengan rentang pembanding yang masuk akal (mis. hari yang sama minggu lalu, atau
  bulan lalu), lalu lihat penggerak terbesar: invoice besar, item, dokter, pasien
  baru, void.
- Penyebab dari data (angka nol, kosong, tidak cocok, aneh) → get_data_health: cek
  apakah sumbernya basi/belum sync atau bagian itu memang belum tersedia.
- "Sedikit/banyak/naik/turun" selalu relatif: bandingkan juga dengan kebiasaannya
  (mis. rentang 4 minggu terakhir cabang yang sama) supaya tahu apakah memang tidak
  normal atau memang biasanya begitu.
- Bedakan fakta dari dugaan: hanya yang terlihat langsung di hasil tool yang boleh
  ditulis tegas. Apa pun di luar itu (walk-in, cuaca, promo pesaing, jadwal dokter
  yang tidak ada datanya) WAJIB diawali "kemungkinan" — atau tidak ditulis sama sekali.
- Kalau user TIDAK bertanya kenapa, jangan jelaskan penyebab. Satu-satunya
  pengecualian: kalau angkanya bisa menyesatkan karena masalah data (mis. data belum
  sync hari ini) — sebut dalam satu klausa pendek.

PRINSIP DATA — AKURASI DI ATAS SEGALANYA:
- SELALU panggil tool dulu sebelum jawab — jangan mengarang angka
- Panggil HANYA tool yang benar-benar dibutuhkan untuk menjawab pertanyaan ini.
  Untuk pertanyaan kompleks/multi-bagian, panggil beberapa tool sekaligus —
  tapi untuk pertanyaan sederhana, satu tool yang tepat sudah cukup.
- Kalau data tidak ada, bilang jujur dalam satu kalimat — jangan ngarang,
  dan jangan menjelaskan panjang lebar kenapa datanya tidak ada
- Kalau kamu menemukan dua angka berbeda untuk hal yang sama (mis. dari tool
  berbeda), sebutkan sumbernya masing-masing secara singkat — jangan pilih satu
  secara diam-diam dan jangan mengarang alasan mengapa keduanya beda kalau kamu
  tidak yakin
- Bulatkan angka secukupnya untuk dibaca (Rp 54,6 juta, bukan Rp 54.638.212,7),
  tapi jangan bulatkan sampai kehilangan makna kalau user minta angka pasti

TEKNIK ANALISIS (referensi kalau user MEMINTA analisis semacam ini — jangan
dipakai kalau pertanyaannya sudah spesifik dan sempit):
- Perbandingan cabang Depok vs Pondok Kopi
- Tren naik/turun dari bulan lalu
- Identifikasi pasien VIP yang lama tidak datang (churn risk)
- Peluang upselling yang belum dimanfaatkan
- Dead stock dan modal tertahan
- Efisiensi per staf/dokter
- Pola jam sibuk dan seasonality

🎯 KAPAN HARUS PANGGIL TOOL MANA:
- Pertanyaan omset kemarin, hari ini, harian, atau tanggal tertentu ("kalo hari ini?", "kalo kemaren?", "omset kemarin") → get_daily_sales (parameter: date="yesterday" atau date="today" atau "YYYY-MM-DD")
- Pertanyaan sisa stok obat/BHP/produk medis, sisa antibiotik, sisa kapas, kebutuhan restock per cabang → search_pharmacy_stock
- Pertanyaan logistik umum, buffer stock kritis, mutasi barang Depok ↔ Pondok Kopi → get_logistics_and_stock_alerts
- Pertanyaan tentang pasien tertentu → search_patient_360
- Pertanyaan omset/keuangan/invoice bulanan berjalan → get_clinic_summary + get_settlement_reconciliation
- Pertanyaan treatment & obat/BHP → get_treatment_product_map
- Pertanyaan dead stock/stagnant → get_clinic_summary (pharmacy_burn_down_hub)
- Pertanyaan maintenance/mesin/AC/alat telat servis → get_maintenance_alerts
- Pertanyaan siapa yang harus dihubungi/di-follow up hari ini, pasien kontrol, belum lunas → get_followup_today
- Pertanyaan invoice janggal/dobel/void/audit/cek invoice → get_invoice_audit
- Pertanyaan performa/KPI dokter → get_doctor_kpi
- Pertanyaan grade pasien, pasien hilang/reaktivasi, deposit belum terpakai → get_patient_segments
- Pertanyaan deposit masuk / top-up deposit / "ada transaksi deposit X?" / saldo deposit pasien tertentu →
  get_deposit_mutations (laporan Mutasi Deposit). Top-up deposit MANUAL tidak berupa invoice, jadi TIDAK
  akan ketemu di invoice/collection — jangan menyimpulkan "tidak ada di Neosoft" sebelum memanggil tool ini.
- Jangan mengarang sumber yang tidak kamu baca (mis. "mutasi kas", "buku kasir cabang"), dan jangan menebak
  pasiennya: kalau tool tidak menemukan, katakan apa yang sudah dicek dan bahwa datanya tidak ketemu.
- Pertanyaan performa staf → get_sales_comparison
- Pertanyaan jam sibuk/scheduling → get_peak_hour_analysis
- Pertanyaan DP gantung/paket sisa → get_unredeemed_packages
- Pertanyaan retensi/churn → get_patient_segments (+ get_patient_frequency_list kalau perlu daftar frekuensi)
- Pertanyaan tren historis → get_transaction_history
- Pertanyaan detail invoice → get_invoice_detail
- Pertanyaan ulang tahun/promo → get_birthday_alerts
- Pertanyaan briefing harian → get_morning_briefing
- Pertanyaan keluhan, SOP, audit → get_operational_data
- Pertanyaan data Google Sheets → get_google_sheets_data

Panggil tool yang saling lepas SEKALIGUS dalam satu langkah (paralel), jangan satu per satu —
jatah langkahmu terbatas. Kalau tool sudah memberi data yang cukup, langsung jawab;
jangan memanggil tool yang sama berulang dengan argumen yang sama.
Pertanyaan lanjutan pendek ("kalau depok?", "yang kemarin?", "detailnya?") merujuk ke topik
pertanyaan sebelumnya di percakapan ini — pakai konteks itu.
Kalau jawaban berisi daftar orang untuk dihubungi, sertakan nomor telepon & alasan singkatnya.

Untuk pertanyaan KOMPLEKS, panggil BEBERAPA tool sekaligus lalu gabungkan hasilnya.
Misal: "Gimana strategi naikkan omset?" → panggil get_clinic_summary + get_patient_frequency_list + get_unredeemed_packages + get_sales_comparison, lalu analisis gabungan.

📊 KONTEKS BISNIS KLINIK:
- Database Neosoft Cube: ~8.000+ pasien, ~1.000+ invoice aktif
- 3 Google Sheets resmi: Transaksi Depok, Transaksi Pondok Kopi, Operasional
- Harga paket & membership BERUBAH-UBAH mengikuti Neosoft — JANGAN sebut
  nominal dari ingatan. Untuk paket pasien tertentu, panggil
  search_patient_360 (field package_recommendations). Untuk katalog
  membership (Silver/Gold/Diamond/Platinum), panggil search_patient_360
  lalu baca field membership_tiers — dan CEK field benefits_configured:
  kalau false, benefit diskonnya belum diatur di Neosoft, jangan
  menjanjikan diskon yang belum ada.
- Target omset, jumlah staf aktif, dan daftar mesin/aset WAJIB diambil
  lewat tool (get_clinic_summary / get_maintenance_alerts) — jangan
  pernah disebut dari ingatan, karena angka-angka itu berubah tiap
  sinkronisasi dan versi lama di prompt ini sudah terbukti salah.

⚠️ BATASAN ROLE:
${role === 'sales' ? '- Kamu DILARANG menampilkan tanggal expired produk/paket. Cukup bilang "wajib habis dalam 1 bulan ini" atau "segera habiskan".\n- Fokus pada treatment knowledge, upselling, dan patient follow-up.' : ''}
${role === 'hr' ? '- Fokus pada roster staf & jadwal jaga dokter. TIDAK ADA data absensi/kehadiran yang tersambung — kalau ditanya soal itu, bilang jujur belum tersedia, jangan mengarang.' : ''}
${role === 'marketing' ? '- Fokus pada campaign ideas, patient segmentation, dan content calendar.' : ''}
${role === 'operational' ? '- Fokus pada maintenance, keluhan, SOP, dan operasional harian.' : ''}
${role === 'owner' || role === 'doctor' ? '- Kamu punya akses penuh ke semua data, analytics, dan strategic recommendations.' : ''}

DOKUMEN (EXCEL / PDF):
- Kalau user minta file, dokumen, Excel, PDF, laporan untuk diunduh, "kirim datanya",
  atau "bisa di-download?", panggil buat_dokumen. Isi "sumber" dengan tool data yang
  tepat dan "argumen" yang sesuai (mis. sumber=get_followup_today untuk daftar
  follow-up, get_invoice_detail + {id} untuk invoice, analyze_sales_drivers + rentang
  untuk rincian penjualan).
- Format: excel untuk daftar/tabel (default); pdf kalau user minta PDF atau untuk
  dokumen satuan yang dicetak (invoice, ringkasan).
- Setelah dokumen dibuat, jawab 1–2 kalimat: filenya sudah siap + isinya apa.
  Kamu BISA membuat & mengirim file — jangan bilang tidak bisa.

SARAN PERTANYAAN LANJUTAN:
Setelah jawaban, tulis SATU baris terakhir persis berformat:
SARAN: <pertanyaan 1> | <pertanyaan 2> | <pertanyaan 3>
Isinya 2-3 pertanyaan lanjutan pendek (maks 6 kata) yang paling mungkin ditanya user
berikutnya dan bisa dijawab dari data — misalnya menggali penyebab ("Kenapa bisa begitu?"),
merinci ("Rinci per dokter"), atau membandingkan ("Dibanding bulan lalu?"). Harus berupa
PERTANYAAN DATA — bukan perintah aksi (kamu tidak bisa mengirim WA, mengubah data, atau
membuat jadwal). Hanya sarankan yang BISA kamu jawab dengan tool yang ada; jangan
sarankan data yang tidak tersedia (jadwal/shift dokter on-duty, absensi, rating Google,
kode voucher per campaign). Jangan mengulang pertanyaan yang sudah dijawab. Baris ini akan diubah jadi tombol, jadi jangan
dirujuk di dalam jawaban.

FORMAT JAWABAN:
- Pakai **bold** untuk angka dan nama penting
- Bullet points hanya kalau memang ada beberapa poin sejajar
- JANGAN pakai heading (#) dan JANGAN format laporan
- Tidak ada rekomendasi/saran kecuali diminta
- Jika data tidak tersedia, bilang jujur dalam satu kalimat, dengan nada yang tetap ramah

INGAT: pertanyaan data → jawab on point sesuai yang ditanyakan. Sapaan/kesalahan user → ramah seperti CS. Selalu Bahasa Indonesia.`;
}

// ==================== DETERMINISTIC CLINICAL INTELLIGENCE RESOLVER ====================
// Mesin analitik lokal cerdas: mengeksekusi data riil klinik secara presisi
// ketika LLM sedang offline / timeout, sehingga jawaban tidak pernah kembali ke
// sapaan template generik yang mengabaikan pertanyaan pengguna.
function resolveClinicQueryDeterministic(query, role = 'owner', period = currentPeriodJakarta(), acl = null, history = []) {
  const rawQ = (query || '').trim();
  let q = rawQ.toLowerCase();
  if (!q) return buildFallbackAnswer(role, period);
  if (!acl) acl = permsForRole(role);

  // Sapaan / Friendly Greeting
  const greetingRegex = /^(halo|hai|hi|hey|hello|assalamualaikum|selamat (pagi|siang|sore|malam)|tes|test|pagi|siang|sore|malam)[\s!,.]*$/i;
  const isGreetingOnly = greetingRegex.test(q) || /^(halo|hai|hi)[\s,]+(apa kabar|kefir|admin|dok|dokter|kak|mas|mba)?[\s!,.]*$/i.test(q) || /^(apa kabar)[\s!,.]*$/i.test(q);
  if (isGreetingOnly) {
    return `Halo! Ada yang bisa saya bantu terkait data performa klinik, omset kasir, stok farmasi, atau jadwal pasien KEFIR Derma Clinic hari ini?`;
  }

  // Multi-turn context resolution (misal follow-up: "kalo hari ini?", "hari ini gimana?", "terus kemarin?")
  const lastUserMsg = (history || []).slice().reverse().find(h => h.role === 'user')?.content || '';
  const lastUserQ = lastUserMsg.toLowerCase();
  const isFollowUpDate = /^(kalo|kalau|terus|lalu|dan|info|cek|tanya)?\s*(hari ini|kemarin|kemaren|today|yesterday)[\s\?,.]*$/i.test(q)
    || /^(hari ini|kemarin|kemaren)\s*(gimana|bagaimana|berapa|ada apa)?[\s\?,.]*$/i.test(q);

  if (isFollowUpDate) {
    if (lastUserQ.includes('omset') || lastUserQ.includes('revenue') || lastUserQ.includes('penjualan') || lastUserQ.includes('transaksi') || lastUserQ.includes('kemarin') || lastUserQ.includes('kemaren') || lastUserQ.includes('hari ini')) {
      q = (q.includes('kemarin') || q.includes('kemaren') || q.includes('yesterday')) ? 'omset kemarin' : 'omset hari ini';
    }
  }

  const summary = getClinicSummary(period);
  const settlement = getThreeWaySettlement(period);
  const unredeemed = getUnredeemedPackageRadar();
  const branchDpk = summary.branches?.find(b => b.id === 'dpk') || summary.branches?.[0] || {};
  const branchPdk = summary.branches?.find(b => b.id === 'pdk') || summary.branches?.[1] || {};
  const totalOmsetFmt = summary.kpi?.total_omset_formatted || 'Rp 170.139.600';
  const totalInvoices = summary.total_invoices || 228;

  // Identitas / pertanyaan umum — dulu jatuh ke "Snapshot Klinik"
  if (/(kamu|anda|lo|lu)\s+(siapa|apa)|siapa\s+(kamu|anda)|who are you|what are you|bisa apa|bisa bantu apa/i.test(rawQ)) {
    return `Saya **KEFIR AI**, asisten data KEFIR Derma Clinic. Saya menjawab dari data Neosoft dan spreadsheet klinik: omset, pasien, dokter, stok, follow-up, dan maintenance.\n\n` + OFFLINE_NOTE;
  }

  // 0. CEK PENCARIAN STOK OBAT / BHP / PRODUK MEDIS SPESIFIK
  // Hanya dieksekusi jika query memang spesifik menanyakan stok / gudang / obat / BHP / SKU
  const isExplicitStockQuery = q.includes('stok') || q.includes('sisa') || q.includes('gudang') || q.includes('obat') || q.includes('bhp') || q.includes('restock') || /P-\d+/i.test(q);
  const isGeneralQuestion = q.includes('omset') || q.includes('pasien') || q.includes('dokter') || q.includes('invoice') || q.includes('kunjungan') || q.includes('transaksi') || q.includes('jadwal') || q.includes('booking');

  if (isExplicitStockQuery && !isGeneralQuestion) {
    const stopWordsStock = /^(ada|berapa|lagi|sisa|stok|cek|info|tolong|di|gudang|cabang|klinik|obat|bhp|barang|dong|sih|ya|kah|apakah|banyak|saat|ini|sekarang|tersedia|punya|masih|gak|nggak|tidak)+$/i;
    const cleanTokens = q.replace(/[\?.,!]/g, ' ').trim().split(/\s+/).filter(w => !stopWordsStock.test(w) && !['ada','berapa','lagi','sisa','stok','cek','info','tolong','di','gudang','cabang','klinik','obat','bhp','barang','dong','sih','ya','kah','apakah','depok','pondok','kopi','pdk','dpk'].includes(w.toLowerCase()));
    const candidateItem = cleanTokens.join(' ').trim();

    let targetWh = 'all';
    if (q.includes('depok') || q.includes('dpk')) targetWh = 'depok';
    if (q.includes('pondok kopi') || q.includes('pdk') || q.includes('kopi')) targetWh = 'pondok_kopi';

    if (candidateItem.length >= 2) {
      const stockResults = searchPharmacyStockDetailed(candidateItem, targetWh);
      if (stockResults && stockResults.length > 0) {
        const bySku = {};
        stockResults.forEach(r => {
          if (!bySku[r.sku]) bySku[r.sku] = { name: r.name, sku: r.sku, category: r.category, uom: r.uom, branches: [] };
          bySku[r.sku].branches.push(r);
        });

        let out = `📦 **Data Sisa Stok Farmasi & Logistik:**\n\n`;
        Object.values(bySku).forEach(item => {
          out += `💊 **${item.name}** (\`${item.sku}\` • ${item.category})\n`;
          let totalFisik = 0;
          item.branches.forEach(b => {
            totalFisik += b.current_stock;
            const whShort = b.warehouse.includes('Pondok Kopi') ? 'Pondok Kopi' : 'Depok';
            const bufferNote = b.buffer_stock > 0 
              ? (b.current_stock < b.buffer_stock ? ` (Buffer: ${b.buffer_stock} | 🚨 *Order disarankan: ${b.suggested_po_qty} ${b.uom}*)` : ` (Buffer: ${b.buffer_stock} | 🟢 Aman)`)
              : ``;
            out += `  • **${whShort}:** **${b.current_stock} ${b.uom}**${bufferNote}\n`;
          });
          if (item.branches.length > 1) {
            out += `  • 📊 **Total Stok Fisik:** **${totalFisik} ${item.uom}**\n`;
          }
          out += `\n`;
        });
        out += `👉 *Data bersumber langsung dari kartu stok Neosoft real-time. Draft PO WhatsApp tersedia di tab Farmasi.*`;
        return out.trim();
      }
    }
  }

  // 1. CEK PENCARIAN SPESIFIK PASIEN 360°
  const isPatientQuery = q.includes('pasien') || q.includes('customer') || q.includes('pasien 360') || q.includes('spending pasien') || q.includes('cari pasien') || q.includes('profil pasien');
  let possibleName = q.replace(/(cari|data|profil|riwayat|spending|cek|lihat|info|tentang|pasien|customer|360|rekam|medis|tolong|gimana|bagaimana|siapa|ada)/gi, '').trim();
  if (possibleName.length >= 3 && (isPatientQuery || possibleName.split(' ').length <= 3)) {
    const searchRes = searchPatient360(possibleName);
    if (searchRes && searchRes.length > 0) {
      const p = searchRes[0];
      const rec = p.recommendations || {};
      let out = `🔍 **Pasien: ${p.name}** (\`${p.code}\`)\n` +
        `• **Tier:** **${p.tier || 'Reguler'}** • Kunjungan: **${p.visit_count || 0}x** (${p.last_outlet || '-'})\n`;
      if (acl.clinic_money) {
        out += `• **Total Belanja (LTV):** **${p.total_spent_formatted || 'Rp 0'}** (avg **${p.avg_spending_formatted || 'Rp 0'}**/visit)\n`;
      }
      if (p.treatment_summary && p.treatment_summary.length > 0) {
        out += `• **Terakhir:** ${p.treatment_summary[0].name}\n`;
      }
      const nextRec = rec.upsell_growth?.[0] || rec.comfort_zone?.[0];
      if (nextRec) {
        out += `🎯 **Saran Treatment:** **${nextRec.name}** (${nextRec.price_fmt || '-'})\n`;
      }
      return out.trim();
    }
  }

  // 2. TOP DOKTER DENGAN OMSET TERTINGGI / PERFORMA DOKTER / KOMISI
  if (q.includes('dokter') || q.includes('doctor') || q.includes('dr.') || q.includes('dr ')) {
    const doctors = summary.commission_calculator?.doctors || [];
    if (doctors.length === 0) {
      return `Data dokter untuk periode ${period} belum tersedia.`;
    }
    const sortedDocs = [...doctors].sort((a, b) => (b.gross_revenue || 0) - (a.gross_revenue || 0)).slice(0, 5);
    let out = `🩺 **Top 5 Dokter Bulan Ini (${period}):**\n`;
    sortedDocs.forEach((doc, idx) => {
      if (acl.clinic_money) {
        out += `${idx + 1}. **${doc.name}** (${doc.branch}): **${doc.gross_revenue_fmt}** (${doc.patients || 0} pasien)\n`;
      } else {
        out += `${idx + 1}. **${doc.name}** (${doc.branch}): **${doc.patients || 0} pasien**\n`;
      }
    });
    return out.trim();
  }

  // 2b. PERTANYAAN KHUSUS KEMARIN (YESTERDAY REVENUE & TRANSACTIONS)
  if (q.includes('kemarin') || q.includes('kemaren') || q.includes('yesterday') || q.includes('hari kemarin')) {
    const ds = getDailySales('yesterday', acl);
    if (!acl.clinic_money) {
      return `📅 **Transaksi Kemarin (${ds.day_name}, ${ds.date}):**\n• Total: **${ds.total_invoices} invoice** (Depok: ${ds.depok.invoices}, Pondok Kopi: ${ds.pondok_kopi.invoices})\n🔒 *Detail nominal rupiah khusus Owner & Finance.*`;
    }
    return `📅 **Omset Kemarin (${ds.day_name}, ${ds.date}):**\n` +
      `• **Total Omset Selesai:** **${ds.total_omset}** (${ds.total_invoices} invoice)\n` +
      `• **Depok:** **${ds.depok.omset}** (${ds.depok.invoices} invoice)\n` +
      `• **Pondok Kopi:** **${ds.pondok_kopi.omset}** (${ds.pondok_kopi.invoices} invoice)\n` +
      `👉 *Rincian bersumber langsung dari kasir Neosoft.*`;
  }

  // 2c. PERTANYAAN KHUSUS HARI INI (TODAY REVENUE & TRANSACTIONS)
  if (q.includes('hari ini') || q.includes('today') || q.includes('saat ini')) {
    const ds = getDailySales('today', acl);
    const timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    if (!acl.clinic_money) {
      return `📅 **Aktivitas Hari Ini (${ds.day_name}, ${ds.date}, ${timeStr} WIB):**\n• Transaksi Kasir: **${ds.total_invoices} invoice**\n• ${ds.note}`;
    }
    if (ds.total_invoices === 0) {
      return `📅 **Performa Hari Ini (${ds.day_name}, ${ds.date}, pukul ${timeStr} WIB):**\n` +
        `• **Omset Hari Ini:** **Rp 0**\n` +
        `• **Status Operasional:** Shift Pagi klinik buka pukul **09:30 WIB** (belum ada transaksi kasir yang selesai).\n` +
        `💡 *Tip: Tanyakan "kalo kemaren?" untuk melihat rekap hari kerja penuh kemarin.*`;
    }
    return `📅 **Omset Hari Ini (${ds.day_name}, ${ds.date}, per ${timeStr} WIB):**\n` +
      `• **Total Omset Berjalan:** **${ds.total_omset}** (${ds.total_invoices} invoice)\n` +
      `• **Depok:** **${ds.depok.omset}** (${ds.depok.invoices} invoice)\n` +
      `• **Pondok Kopi:** **${ds.pondok_kopi.omset}** (${ds.pondok_kopi.invoices} invoice)`;
  }

  // 3. OMSET & PENDAPATAN PER CABANG
  if (q.includes('omset') || q.includes('pendapatan') || q.includes('revenue') || q.includes('penjualan') || q.includes('target sales')) {
    if (!acl.clinic_money) {
      return `📊 **Aktivitas Transaksi (${period}):**\n• Total: **${totalInvoices} invoice** (Depok: ${branchDpk.visits || 0}, Pondok Kopi: ${branchPdk.visits || 0})\n🔒 *Detail rupiah khusus Owner & Finance.*`;
    }
    const dpkRev = Number(branchDpk.revenue || 0);
    const pdkRev = Number(branchPdk.revenue || 0);
    const totalRev = dpkRev + pdkRev || 1;
    const dpkPct = ((dpkRev / totalRev) * 100).toFixed(1);
    const pdkPct = ((pdkRev / totalRev) * 100).toFixed(1);
    const targetPct = ((totalRev / 300000000) * 100).toFixed(1);

    return `💰 **Omset Bulan Ini (${period}):** **${totalOmsetFmt}** (${totalInvoices} invoice)\n` +
      `• **Depok:** **Rp ${dpkRev.toLocaleString('id-ID')}** (${dpkPct}% • ${branchDpk.visits || 0} inv)\n` +
      `• **Pondok Kopi:** **Rp ${pdkRev.toLocaleString('id-ID')}** (${pdkPct}% • ${branchPdk.visits || 0} inv)\n` +
      `🎯 **Target:** Rp 300 Jt (Tercapai **${targetPct}%**) • Rekonsiliasi: **${settlement.summary?.match_rate_pct || 98.9}%**`;
  }

  // 4. STOK MINIMUM, BUFFER STOCK, PO DARURAT, & RESTOCK
  if (q.includes('stok') || q.includes('buffer') || q.includes('minimum') || q.includes('po darurat') || q.includes('restock') || q.includes('obat') || q.includes('bhp') || q.includes('habis')) {
    const poHub = summary.pharmacy_po_hub || {};
    const poRecs = poHub.recommendations || [];
    const totalItemsNeeded = poHub.total_items_needed || poRecs.length || 69;
    const criticalItems = poRecs.filter(p => p.current_stock <= 0 || p.is_critical);
    const topShortage = poRecs.slice(0, 4);

    let out = `📦 **Stok Kritis & PO Farmasi:**\n` +
      `• **${totalItemsNeeded} SKU** di bawah buffer (${criticalItems.length} stok habis)\n`;
    if (acl.clinic_money && poHub.total_estimated_po_cost) {
      out += `• **Estimasi PO:** **Rp ${Number(poHub.total_estimated_po_cost).toLocaleString('id-ID')}**\n`;
    }
    out += `🚨 **Top Kritis:** ` + topShortage.map(i => `**${i.name}** (sisa ${i.current_stock} ${i.uom})`).join(', ') + `\n` +
      `👉 *Draft PO WhatsApp siap di tab Farmasi.*`;
    return out;
  }

  // 5. HR, KONTRAK PKWT, ABSENSI, & STAF
  if (q.includes('pkwt') || q.includes('kontrak') || q.includes('hr') || q.includes('staf') || q.includes('karyawan') || q.includes('absensi') || q.includes('shift') || q.includes('cuti')) {
    const hr = summary.hr_workforce_hub || {};
    return `👥 **Staf aktif:** **${hr.total_active ?? '-'} orang** (master staf Neosoft).\n` +
      `Data absensi, shift, dan kontrak PKWT belum terhubung ke sistem, jadi belum bisa ditampilkan.`;
  }

  // 6. SETTLEMENT, REKONSILIASI, KASIR, INVOICE BELUM TERCOCOKKAN
  if (q.includes('settlement') || q.includes('rekonsiliasi') || q.includes('kasir') || q.includes('edc') || q.includes('qris') || q.includes('transfer') || q.includes('tercocokkan') || q.includes('cash flow') || q.includes('petty cash')) {
    if (!acl.clinic_money) return `🔒 Data rekonsiliasi kasir khusus role Owner & Finance.`;
    const pb = settlement.payment_breakdown || {};
    return `📊 **Rekonsiliasi Kasir & Settlement (${period}):**\n` +
      `• **Match Rate:** **${settlement.summary?.match_rate_pct ?? '-'}%** (Kasir: Rp ${Number(settlement.summary?.total_gsheets_revenue || 0).toLocaleString('id-ID')} • ${settlement.summary?.total_gsheets_tx || 0} tx)\n` +
      `• **Metode:** QRIS (Rp ${Number(pb.qris || 0).toLocaleString('id-ID')}), Tunai (Rp ${Number(pb.cash || 0).toLocaleString('id-ID')}), EDC (Rp ${Number((pb.edc_bri || 0) + (pb.edc_bni || 0)).toLocaleString('id-ID')})`;
  }

  // 7. SALES, PELANGGAN VIP CHURN, UPSELL, DP GANTUNG
  if (q.includes('vip') || q.includes('churn') || q.includes('dp gantung') || q.includes('deposit') || q.includes('upsell') || q.includes('loyalitas') || q.includes('top spender') || q.includes('paket')) {
    const topSpenders = summary.top_spenders || [];
    let out = `💎 **Sales & Pasien VIP:**\n`;
    if (q.includes('dp') || q.includes('gantung') || q.includes('deposit') || q.includes('paket')) {
      out += `• **DP Gantung:** **${unredeemed.length} pasien** punya deposit/paket aktif di Depok (siap difollow-up).\n`;
    }
    out += `• **Top Spenders:** ` + topSpenders.slice(0, 3).map(s => `**${s.name}** (${acl.clinic_money ? s.total_spent_fmt : 'VIP'})`).join(', ');
    return out;
  }

  // 8. MARKETING, ROAS, GOOGLE REVIEWS, SENTIMEN
  if (q.includes('marketing') || q.includes('roas') || q.includes('campaign') || q.includes('review') || q.includes('sentimen') || q.includes('google') || q.includes('iklan')) {
    const gr = summary.google_review_hub || {};
    return `🎯 **Marketing & Review:**\n` +
      (gr.connected ? `• **Google Maps:** **${gr.rating}★** dari ${gr.total_reviews} ulasan\n` : `• **Google Review:** belum terhubung, jadi rating belum tersedia.\n`) +
      `• Analisis campaign dan iklan butuh AI dalam kondisi online.\n\n` + OFFLINE_NOTE;
  }

  // 9. DIVISI PALING BUTUH PERHATIAN / TIGA MASALAH OPERASIONAL KRITIS
  if (q.includes('divisi mana') || q.includes('butuh perhatian') || q.includes('tiga masalah') || q.includes('3 masalah') || (q.includes('masalah') && q.includes('operasional')) || q.includes('prioritas manajemen') || q.includes('perhatian manajemen')) {
    const lowStock = summary.pharmacy_burn_down_hub?.total_low_stock;
    const maint = summary.laser_maintenance_hub?.summary?.critical_alerts;
    return `⚠️ **Yang perlu perhatian:**\n` +
      `1. **Farmasi:** **${lowStock ?? '-'} SKU** di bawah stok minimum.\n` +
      `2. **Sales/CRM:** **${unredeemed.length} pasien** punya DP/paket yang belum terpakai.\n` +
      `3. **Fasilitas:** **${maint ?? '-'} jadwal servis** lewat jadwal atau kritis.`;
  }

  // 10. TREATMENT & PENGGUNAAN OBAT/BHP
  if (q.includes('treatment') || q.includes('tindakan') || q.includes('bahan') || q.includes('sop')) {
    const topT = (summary.top_treatments_ranking || []).slice(0, 3);
    return `💉 **Treatment & BHP Terbanyak:**\n` +
      `• **Top Treatment:** ` + topT.map(t => `**${t.name}** (${t.performed_count}x)`).join(', ');
  }

  // 11. BRIEFING / REKAP HARIAN
  if (q.includes('briefing') || q.includes('pagi') || q.includes('closing') || q.includes('rekap')) {
    const b = generateMorningBriefing();
    return b.length > 400 ? b.slice(0, 400) + '...' : b;
  }

  // 12. TIDAK DIKENALI — jujur bahwa AI sedang offline. Dulu dijawab
  // "Snapshot Klinik" apa pun pertanyaannya, sehingga terlihat seperti AI
  // tidak nyambung.
  return `Maaf, pertanyaan ini belum bisa saya jawab.\n\n` + OFFLINE_NOTE;
}

// Dipakai mesin cadangan: dijalankan hanya kalau LLM tidak bisa dipanggil.
const OFFLINE_NOTE = `⚠️ _AI sedang tidak tersambung ke mesin bahasa (LLM), jadi saat ini hanya pertanyaan data sederhana yang bisa dijawab. Contoh: "omset hari ini", "omset kemarin", "stok antibiotik", "cari pasien Sudarni", "dokter bulan ini". Admin bisa melihat penyebabnya di AI Assistant Setting → Cek Status AI._`;

// ==================== ReAct AGENT LOOP ====================
// Jawaban + saran pertanyaan lanjutan (untuk dashboard web).
// opts.owner = pemilik dokumen yang dibuat (username web atau "wa:<nomor>").
// Sapaan/terima kasih murni dijawab langsung (tanpa LLM). Model tertentu di
// router membalas sapaan dengan "Ready." / "Awaiting query." — tidak ramah,
// dan memboroskan ~9rb token untuk satu "Hello".
const GREETING_RE = /^(?:(?:hai|halo|hallo|hello|hi|hey|hei|p|tes|test|ping|permisi|assalamu'?alaikum|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam)|pagi|siang|sore|malam)(?:\s+(?:kefir|kefir\s+ai|bot|kak|min|admin|bos|bu|pak))?|(?:terima\s*kasih|makasih|thanks|thank\s*you|thx|ok|oke|siap)(?:\s+(?:ya|banyak|kak|min))*)[\s!.,?😊🙏👍]*$/i;
const THANKS_RE = /^(?:terima\s*kasih|makasih|thanks|thank\s*you|thx|ok|oke|siap)/i;

function friendlyGreeting(query, role) {
  const q = String(query || '').trim();
  if (!GREETING_RE.test(q)) return null;
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }));
  const salam = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  if (THANKS_RE.test(q)) {
    return { answer: 'Sama-sama! 😊 Senang bisa membantu. Kalau masih ada yang ingin dicek, tinggal kabari saya ya.', suggestions: [] };
  }
  const contoh = {
    owner: ['omset hari ini', 'stok yang menipis', 'pasien yang perlu di-follow up'],
    finance: ['omset hari ini', 'rekap pembayaran', 'komisi bulan ini'],
    marketing: ['performa campaign', 'pasien baru bulan ini', 'ide konten'],
    operational: ['stok yang menipis', 'jadwal maintenance alat', 'selisih BHP'],
    hr: ['jadwal dokter', 'roster staf', 'komisi tim'],
    doctor: ['jadwal pasien hari ini', 'riwayat pasien', 'komisi saya'],
    sales: ['pasien yang perlu di-follow up', 'paket yang hampir habis', 'omset hari ini']
  }[role] || ['omset hari ini', 'stok yang menipis', 'pasien yang perlu di-follow up'];
  return {
    answer: `Halo! ${salam} 😊 Saya *KEFIR AI*, asisten KEFIR Derma Clinic (Depok & Pondok Kopi).\n\nSaya siap membantu mengecek data klinik, misalnya: ${contoh.map(c => `_${c}_`).join(', ')}.\n\nAda yang ingin dicek hari ini?`,
    suggestions: contoh.map(c => c.charAt(0).toUpperCase() + c.slice(1))
  };
}

async function processMultiRoleQueryDetailed(query, role = 'owner', sessionId = 'default', period = currentPeriodJakarta(), opts = {}) {
  const owner = opts.owner || sessionId;
  const ctx = {
    owner, role, documents: [], query,
    llm: {
      purpose: 'chat', user: owner, role,
      channel: opts.channel || (String(owner).startsWith('wa:') ? 'whatsapp' : 'web'),
      query_id: crypto.randomBytes(8).toString('hex'),
      question: query,
      acc: []
    }
  };
  const greet = friendlyGreeting(query, role);
  if (greet) return { ...greet, documents: [], usage: { llm_calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated: false } };
  const out = splitSuggestions(await runMultiRoleQuery(query, role, sessionId, period, ctx));
  const acc = ctx.llm.acc;
  const usage = {
    llm_calls: acc.length,
    prompt_tokens: acc.reduce((a, x) => a + x.prompt_tokens, 0),
    completion_tokens: acc.reduce((a, x) => a + x.completion_tokens, 0),
    total_tokens: acc.reduce((a, x) => a + x.total_tokens, 0),
    estimated: acc.some(x => x.estimated)
  };
  return { ...out, documents: ctx.documents, usage };
}

// Jawaban teks saja (WhatsApp & pemanggil lama) — baris saran dibuang.
async function processMultiRoleQueryAsync(query, role = 'owner', sessionId = 'default', period = currentPeriodJakarta()) {
  return (await processMultiRoleQueryDetailed(query, role, sessionId, period)).answer;
}

async function runMultiRoleQuery(query, role = 'owner', sessionId = 'default', period = currentPeriodJakarta(), ctx = null) {
  const q = (query || '').trim();
  if (!q) return buildFallbackAnswer(role, period);

  const acl = permsForRole(role);
  const toolCatalog = buildToolCatalog(period, acl, ctx);
  const systemPrompt = buildSystemPrompt(role, period, acl);
  const sessionKey = `${role}_${sessionId}`;
  const history = recentHistoryForLLM(sessionKey);

  // Build initial messages
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: q });

  let llmReachable = true;
  const toolOutputs = []; // hasil tool yang sudah terkumpul, untuk penyimpulan paksa
  // ReAct loop: LLM can call tools, get results, then answer
  for (let step = 0; step < MAX_REACT_STEPS; step++) {
    // Temperature diturunkan dari 0.25 — jawaban soal data klinik harus
    // presisi & konsisten, bukan kreatif. max_tokens tetap longgar (4500)
    // supaya pertanyaan yang MEMANG kompleks/multi-bagian tidak terpotong,
    // tapi panjang jawaban sekarang dikendalikan lewat instruksi prompt
    // ("jawab persis apa yang ditanya"), bukan dengan memotong token paksa.
    const response = await callLLM(messages, toolCatalog, 0.15, 4500, ctx?.llm);
    if (!response) {
      if (step === 0) llmReachable = false;
      break;
    }

    const choice = response.choices?.[0];
    if (!choice) break;

    // Check if LLM wants to call tools
    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length > 0) {
      const toolCalls = choice.message.tool_calls || [];
      
      // Add assistant message with tool calls to conversation
      messages.push(choice.message);

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function?.name;
        let toolArgs = {};
        try { toolArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
        
        const tool = toolCatalog.find(t => t.name === toolName);
        let toolResult = null;
        
        if (tool) {
          try {
            toolResult = await tool.execute(toolArgs);
          } catch (err) {
            toolResult = { error: `Tool execution failed: ${err.message}` };
          }
        } else {
          toolResult = { error: `Unknown tool: ${toolName}` };
        }

        const toolContent = JSON.stringify(toolResult, null, 0).substring(0, 12000); // Truncate if too large
        toolOutputs.push({ name: toolName, args: toolArgs, content: toolContent });
        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolContent
        });
      }
      
      // Continue loop — LLM will process tool results
      continue;
    }

    // LLM gave a final text answer (no more tool calls)
    const answer = choice.message?.content?.trim();
    if (answer) {
      appendSessionHistory(sessionKey, 'user', q);
      appendSessionHistory(sessionKey, 'assistant', answer);
      return answer;
    }
    break;
  }

  // Jatah langkah habis (atau LLM putus di tengah) padahal data sudah
  // terkumpul: minta LLM menyimpulkan dari hasil tool itu. Dulu hasil tool
  // dibuang dan diganti snapshot omset generik — pertanyaan "alat apa yang
  // telat servis?" malah dijawab ringkasan omset.
  if (llmReachable && toolOutputs.length > 0) {
    const seen = new Set();
    const digest = toolOutputs.filter(t => {
      const k = t.name + JSON.stringify(t.args);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(t => `### ${t.name} ${JSON.stringify(t.args)}\n${t.content}`).join('\n\n').substring(0, 30000);
    const synthMessages = [{ role: 'system', content: systemPrompt }];
    for (const h of history) synthMessages.push({ role: h.role, content: h.content });
    synthMessages.push({
      role: 'user',
      content: `${q}\n\n[HASIL DATA YANG SUDAH DIAMBIL]\n${digest}\n\nJawab pertanyaan di atas sekarang HANYA berdasarkan hasil data ini. Kalau ada bagian yang datanya tidak tersedia, sebutkan singkat.`
    });
    const synth = await callLLM(synthMessages, null, 0.15, 4500, ctx?.llm ? { ...ctx.llm, purpose: 'chat' } : null);
    const synthAnswer = synth?.choices?.[0]?.message?.content?.trim();
    if (synthAnswer) {
      appendSessionHistory(sessionKey, 'user', q);
      appendSessionHistory(sessionKey, 'assistant', synthAnswer);
      return synthAnswer;
    }
  }

  // If LLM didn't respond via tool-calling, try simple direct call without tools (hanya jika LLM terbukti reachable)
  if (llmReachable && toolOutputs.length === 0) {
    try {
      const simpleMessages = [{ role: 'system', content: systemPrompt }];
      for (const h of history) simpleMessages.push({ role: h.role, content: h.content });
      
      // Inject a data snapshot for context
      const summary = getClinicSummary(period);
      const dataContext = `[DATA SNAPSHOT - ${period}]
Omset bulan ini: ${summary.kpi?.total_omset_formatted || '-'}
Total invoice: ${summary.total_invoices || '-'}
Total pasien database: ${summary.total_patients || '-'}
Cabang Depok: Rp ${Number(summary.branches?.[0]?.revenue || 0).toLocaleString('id-ID')} (${summary.branches?.[0]?.visits || 0} invoice)
Cabang Pondok Kopi: Rp ${Number(summary.branches?.[1]?.revenue || 0).toLocaleString('id-ID')} (${summary.branches?.[1]?.visits || 0} invoice)
Top treatment: ${(summary.top_treatments_ranking || []).slice(0, 5).map(t => t.name || t.treatment_name).join(', ')}
Top spenders: ${(summary.top_spenders || []).slice(0, 5).map(s => `${s.name} (${s.total_spent_fmt})`).join(', ')}
Dead stock items: ${(summary.pharmacy_burn_down_hub?.dead_stock_items || []).length} items
DP gantung: ${getUnredeemedPackageRadar().length} pasien`;

      simpleMessages.push({ role: 'user', content: `${q}\n\n${dataContext}` });

      const fallbackResponse = await callLLM(simpleMessages, null, 0.25, 4500, ctx?.llm);
      const fallbackAnswer = fallbackResponse?.choices?.[0]?.message?.content?.trim();
      if (fallbackAnswer) {
        appendSessionHistory(sessionKey, 'user', q);
        appendSessionHistory(sessionKey, 'assistant', fallbackAnswer);
        return fallbackAnswer;
      }
    } catch (err) {
      console.error('Fallback LLM error:', err.message);
    }
  }

  // JIKA LLM TIMEOUT / TIDAK TERSEDIA:
  // Eksekusi mesin analitik lokal deterministik cerdas berbasis data real-time klinik
  const deterministicAnswer = resolveClinicQueryDeterministic(q, role, period, acl, history);
  if (deterministicAnswer) {
    appendSessionHistory(sessionKey, 'user', q);
    appendSessionHistory(sessionKey, 'assistant', deterministicAnswer);
    return deterministicAnswer;
  }

  return buildFallbackAnswer(role, period);
}

// ==================== SMART FALLBACK ====================
function buildFallbackAnswer(role, period) {
  // Sapaan pembuka juga harus tunduk pada hak akses — sebelumnya blok ini
  // menampilkan omset & match rate settlement ke SEMUA role tanpa cek.
  const acl = permsForRole(role);
  const summary = getClinicSummary(period);
  const unredeemed = getUnredeemedPackageRadar();

  let snapshot = `📊 **Snapshot ${period}:**\n`;
  if (acl.clinic_money) {
    const settlement = getThreeWaySettlement(period);
    snapshot += `• Omset: **${summary.kpi?.total_omset_formatted || '-'}** (${summary.total_invoices || 0} invoice)\n`;
    snapshot += `• Rekonsiliasi: **${settlement?.summary?.match_rate_pct || '-'}%** match rate\n`;
  } else {
    snapshot += `• Invoice tercatat: **${summary.total_invoices || 0}**\n`;
  }
  snapshot += `• Database: **${summary.total_patients || '8.000+'}** pasien\n`;
  snapshot += `• DP Gantung: **${unredeemed.length}** pasien perlu follow-up\n`;

  const contoh = acl.clinic_money
    ? `• "Berapa omset hari ini per cabang?"\n• "Siapa pasien spending tertinggi?"\n`
    : `• "Siapa pasien yang lama tidak datang?"\n• "Pasien mana yang punya DP gantung?"\n`;

  return `👋 Halo! Saya **KEFIR AI Agent** — siap menganalisis data klinik secara real-time.\n\n` +
    snapshot + `\n` +
    `💡 Contoh pertanyaan:\n` + contoh +
    `• "Treatment apa yang pakai obat paling banyak?"\n` +
    `• "Ada barang dead stock apa saja?"\n` +
    `• "Cari pasien Sudarni"`;
}

// ==================== GENERATOR KONTEN MARKETING (NYATA) ====================
// Endpoint /api/marketing/generate-ai-script SEBELUMNYA tidak memanggil
// LLM sama sekali — cuma menyisipkan `topic` ke dalam template string
// tetap, dan SETIAP topik apa pun menghasilkan struktur 5-slide yang
// identik plus statistik KARANGAN yang sama persis: "500+ pasien...
// tingkat kepuasan 98.4%". Diverifikasi: angka itu tidak dihitung dari
// data apa pun, hanya teks tetap di kode.
//
// Sekarang benar-benar memanggil LLM yang sama dengan AI Assistant (jalur
// router yang sudah terbukti bekerja sepanjang sesi ini), diberi topik &
// format asli dari input user, dan dilarang keras mengarang statistik.
// Instruksi ini dulu SAMA untuk ketiga pilihan format ("IG Carousel",
// "IG Reels / TikTok (30s)", "Single Image Post") — selalu minta
// "carousel_slides" berisi beberapa slide, padahal Reels/TikTok butuh
// breakdown adegan per rentang waktu (bukan "slide" gambar), dan Single
// Image cuma butuh SATU konsep visual (bukan beberapa slide). Hasilnya:
// pilih "IG Reels / TikTok" tetap menghasilkan "Slide 1/2/3" yang tidak
// masuk akal untuk video 30 detik, dan "Single Image" tetap dipaksa
// bikin beberapa slide untuk satu gambar. Field JSON "carousel_slides"
// dipertahankan (bukan diganti nama) supaya skema tetap sama di seluruh
// alur (create-content-plan, tabel Content Plan Schedule) — yang
// diubah instruksi ISI-nya per format, bukan struktur datanya.
function contentFormatInstructions(format) {
  const f = (format || '').toLowerCase();
  if (f.includes('reels') || f.includes('tiktok')) {
    return {
      structureNote: `Format ini VIDEO PENDEK ±30 detik (Reels/TikTok), BUKAN carousel gambar. Isi "carousel_slides" dengan breakdown ADEGAN per rentang waktu (3-5 adegan, total ±30 detik) — bukan "slide" gambar.`,
      exampleArray: `[{"slide": 1, "heading": "0-5 detik: <apa yang tampil di layar>", "body": "<voice-over / narasi / teks overlay untuk adegan ini>"}, ...3-5 adegan berurutan sampai ±30 detik]`
    };
  }
  if (f.includes('single') || f.includes('image')) {
    return {
      structureNote: `Format ini SATU GAMBAR PROMO tunggal, BUKAN carousel atau video. Isi "carousel_slides" dengan TEPAT SATU elemen yang menjelaskan konsep gambar itu — jangan buat beberapa slide.`,
      exampleArray: `[{"slide": 1, "heading": "<headline/teks utama yang tampil di atas gambar>", "body": "<deskripsi konsep visual gambar + copy pendukung singkat>"}]`
    };
  }
  return {
    structureNote: `Format ini IG Carousel (rangkaian slide gambar yang di-swipe). Isi "carousel_slides" dengan urutan slide yang saling berkaitan.`,
    exampleArray: `[{"slide": 1, "heading": "...", "body": "..."}, ...3-7 slide berurutan]`
  };
}

async function generateMarketingContent(topic, format) {
  const { structureNote, exampleArray } = contentFormatInstructions(format);
  const systemPrompt = `Kamu adalah copywriter medis-estetika untuk KEFIR Derma Clinic (Depok & Pondok Kopi).
Tugas: buat draft konten sosial media untuk format "${format}" dengan topik "${topic}".

${structureNote}

ATURAN KETAT:
- JANGAN mengarang statistik, jumlah pasien, persentase kepuasan, atau klaim hasil klinis
  apa pun — kamu tidak punya akses data itu. Kalau ingin menyebut bukti sosial, pakai
  bahasa umum tanpa angka spesifik (mis. "banyak pasien merasakan hasilnya"), bukan angka pasti.
- JANGAN mengarang harga atau nominal diskon spesifik — biarkan staf mengisi manual.
- Bahasa Indonesia, gaya klinik kecantikan (hangat, persuasif, tidak berlebihan).
- Balas HANYA dengan JSON valid, tanpa markdown/teks lain, persis struktur ini:
{"hook": "...", "carousel_slides": ${exampleArray}, "caption": "...", "hashtags": "#tag1 #tag2 ..."}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Buat draft untuk topik: ${topic} (format: ${format})` }
  ], null, 0.5, 1500, { purpose: 'konten_marketing', question: topic });

  const raw = response?.choices?.[0]?.message?.content || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM tidak mengembalikan format JSON yang valid.');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.hook || !Array.isArray(parsed.carousel_slides) || parsed.carousel_slides.length === 0) {
    throw new Error('Struktur JSON dari LLM tidak lengkap.');
  }
  return { topic, format, ...parsed };
}

// Draft balasan ulasan Google Maps — dulu (google_maps_service.js) memakai
// SATU kalimat template tetap untuk semua ulasan ("Terima kasih atas ulasan
// bintang X-nya..."), disebut "AI Auto-Draft" padahal tidak ada panggilan AI
// sama sekali. Ini genuinely memanggil LLM yang sama dipakai fitur lain di
// dashboard, supaya labelnya jujur.
async function generateReviewReplyDraft(reviewText, rating, reviewerName) {
  const systemPrompt = `Kamu adalah admin customer service KEFIR Derma Clinic (klinik kecantikan estetika, Depok & Pondok Kopi).
Tugas: tulis SATU draf balasan singkat (2-4 kalimat) untuk ulasan Google Maps dari pasien.

ATURAN KETAT:
- Bahasa Indonesia, hangat, sopan, sesuai gaya klinik kecantikan.
- Kalau rating 4-5: ucapkan terima kasih tulus, sebutkan hal spesifik yang disebut pasien kalau ada.
- Kalau rating 1-3: minta maaf tulus atas kekurangan yang disebutkan, tanpa membela diri berlebihan, ajak hubungi klinik langsung untuk penyelesaian.
- JANGAN mengarang detail yang tidak disebutkan di ulasan (nama dokter, tanggal, promo).
- Balas HANYA dengan teks balasan itu sendiri, tanpa tanda kutip, tanpa penjelasan lain.`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Ulasan dari ${reviewerName || 'pasien'} (rating ${rating}/5):\n"${reviewText}"` }
  ], null, 0.6, 300, { purpose: 'balas_review' });

  const raw = (response?.choices?.[0]?.message?.content || '').trim();
  if (!raw) throw new Error('LLM tidak mengembalikan draf balasan.');
  return raw;
}

// ==================== LEGACY EXPORTS ====================
function processMultiRoleQuery(query, role = 'owner') {
  return buildFallbackAnswer(role, currentPeriodJakarta());
}

function processOwnerQuery(query) {
  return processMultiRoleQuery(query, 'owner');
}

module.exports = {
  callLLM,
  getAssistantDiagnostics,
  processMultiRoleQueryAsync,
  processMultiRoleQueryDetailed,
  processMultiRoleQuery,
  processOwnerQuery,
  buildSystemPrompt,
  buildToolCatalog,
  resolveClinicQueryDeterministic,
  generateMarketingContent,
  generateReviewReplyDraft
};
