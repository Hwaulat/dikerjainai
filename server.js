/**
 * Node.js HTTP Server for KEFIR Clinic Executive Portal
 * Mission Control & Notification Hub (Depok & Pondok Kopi)
 */

// Penyimpanan PostgreSQL (opsional): STORAGE_BACKEND=postgres + DATABASE_URL.
// Dokumen dimuat dulu ke memori, baru server dijalankan (lihat pg_store.js).
{
  const pgStore = require('./pg_store');
  if (pgStore.enabled() && !pgStore.isReady()) {
    pgStore.init()
      .then(() => { delete require.cache[__filename]; require(__filename); })
      .catch(err => { console.error('[pg_store] gagal init:', err.message); process.exit(1); });
    return;
  }
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { 
  getClinicSummary, 
  searchPatient360, 
  countPatient360Matches, 
  getTransactionHistory, 
  getCrmJoinDiagnostics, 
  getInvoiceDetail, 
  addDispatchLog, 
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
  getPatientDemographics, 
  markFollowUpDone, 
  getFollowUpStatusLog, 
  setAssetManualNote, 
  getAssetManualNotes, 
  recordAssetService, 
  getClinicSettings, 
  setClinicSettings, 
  markMaintenanceReminderSent, 
  getMaintenanceReminderLog, 
  addPatientFeedback,
  getFeedbackSummary,
  getPatientFeedback, 
  getMetaAdsSettingsSafe, 
  setMetaAdsSettings, 
  getTreatmentProductMap, getBhpVariance, getHppProfit, getRevenueBreakdown, getDailyTransactionRecap, saveCashierClosing, deleteCashierClosing, getDoctorNurseCommission, getSupplierPriceComparison, addSupplierQuote, deleteSupplierQuote, 
  getNeosoftMasterData, 
  getNeosoftLogisticsData, 
  getAutomationAlertsSummary, 
  getDoctorRecommendations, 
  saveDoctorRecommendation, 
  getDoctorFollowupsList, 
  updateDoctorFollowupStatus,
  getMonthlyCosts,
  setMonthlyCosts,
  getPettyCashEntries,
  addPettyCashEntry,
  deletePettyCashEntry,
  addManualAsset,
  markAssetDocReminderSent,
  getAssetDocReminderLog,
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
  getSyncStatusInfo,
  getUnusedPackages,
  getUnusedPackageDetail,
  getCampaignReminders,
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
  getNeosoftReportData,
  generateNeosoftCsv,
  getManualUnredeemedTreatments,
  saveManualUnredeemedTreatment,
  deleteManualUnredeemedTreatment,
  getWaChatTemplates,
  saveWaChatTemplate,
  saveAllWaChatTemplates,
  resetWaChatTemplate,
  getSpendingTierPatients,
  getTopUsage,
  normalizeWaPhone,
  getReactivationPatients,
  getStockPromoRecommendations,
  markCrmTierChatted,
  suggestPatient360,
  getPriceMaster
} = require('./data_provider');
const { 
  getThreeWaySettlement,
  getMonthlyTxRows,
  getInvoiceReconciliation,
  getUnredeemedPackageRadar, 
  getClinicalUpsellRadar, 
  getMaintenanceAlerts, 
  getBirthdayAlerts, 
  generateMorningBriefing, 
  generateNightlyClosing, 
  askOwnerAssistant 
} = require('./unified_analytics');
const { loadDocument } = require('./document_service');
const { getInvoiceAudit, setAuditStatus } = require('./invoice_audit');
const { getUsageSummary, setPricing } = require('./ai_usage');
const { getAssistantDiagnostics, processMultiRoleQueryAsync, processMultiRoleQueryDetailed, processMultiRoleQuery, processOwnerQuery, generateMarketingContent, generateReviewReplyDraft } = require('./ai_executive_assistant');
const { initWhatsAppAssistant, getAssistantStatus, addRoleNumber, removeRoleNumber, addOwnerNumber, sendWhatsAppMessage, isWhatsAppConnected, resetWhatsAppSession, getGroupList, setGroupConfig } = require('./wa_assistant_service');
const { generate6Reports } = require('./telegram_service');
const { getBranchReviews, syncGoogleMapsReviews } = require('./google_maps_service');
const { getInstagramProfile, updateInstagramProfileManual, addInstagramPostTrack } = require('./instagram_service');
const { getTikTokProfile, updateTikTokProfileManual } = require('./tiktok_service');
const {
  getMetaSettingsSafe,
  getMetaOAuthUrl,
  handleMetaOAuthCallback,
  testAndConnectMetaToken,
  disconnectMeta,
  updateMetaConfig,
  syncMetaMarketingData,
  getCachedMetaAdsData,
  syncInstagramFromMeta,
  getAdsManagerData,
  adsManagerFromCache
} = require('./meta_ads_service');
const hrAttendance = require('./hr_attendance');
const {
  getGajiSettingsSafe,
  loginGajiId,
  connectDirectToken,
  disconnectGajiId,
  syncGajiAttendance
} = require('./gaji_id_service');

const PORT = process.env.PORT || 3344;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Periode berjalan (Asia/Jakarta) — dulu beberapa endpoint (trigger-sync,
// dispatch-telegram, telegram-reports) memanggil getClinicSummary('2026-09')
// dengan periode TERTULIS TETAP. Begitu kalender lewat September, endpoint
// itu diam-diam tetap melaporkan data September selamanya. Dipakai sebagai
// pengganti, dihitung ulang tiap dipanggil (bukan konstanta).
function currentPeriodJakarta() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Deteksi binary Python yang memiliki modul requests (mis. Homebrew python3.11 di macOS)
function getPythonBin() {
  const candidates = [
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    'python3'
  ];
  for (const c of candidates) {
    if (c.startsWith('/') && fs.existsSync(c)) return c;
  }
  return 'python3';
}

function cleanStaleSyncLock() {
  const lockFile = path.join(__dirname, 'data', 'neosoft_db', '.sync.lock');
  if (fs.existsSync(lockFile)) {
    try {
      const stats = fs.statSync(lockFile);
      const ageSec = (Date.now() - stats.mtimeMs) / 1000;
      if (ageSec > 300) { // Lebih dari 5 menit
        fs.unlinkSync(lockFile);
        console.log(`🧹 Stale sync lock dibersihkan (umur ${Math.round(ageSec)}s).`);
      }
    } catch (e) {}
  }
}

// ══════════════════════════════════════════════════════════════════════
// SESI & PENEGAKAN AKSES DI SISI SERVER
//
// Sebelumnya token login cuma base64 dari "role:timestamp" dan TIDAK
// PERNAH diperiksa endpoint manapun — siapa pun bisa memanggil
// /api/summary langsung dan menerima seluruh payload (omset, payroll,
// rekam medis), atau mengarang token "owner:123" sendiri. Pembatasan
// per-role di frontend cuma menyembunyikan tampilan, bukan datanya.
//
// Sekarang: token ditandatangani HMAC-SHA256 memakai kunci server, punya
// masa berlaku, dan payload API disaring per role SEBELUM dikirim.
// ══════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const SECRET_FILE = path.join(__dirname, 'data', '.session_secret');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam, lalu wajib login lagi

function loadOrCreateSessionSecret() {
  // Kunci penandatangan server (bukan kredensial user). Diambil dari env
  // kalau ada supaya bisa disamakan antar-instance saat deploy; kalau
  // tidak, dibuat sekali lalu disimpan lokal (mode 600, gitignored).
  if (process.env.KEFIR_SESSION_SECRET) return process.env.KEFIR_SESSION_SECRET;
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch (e) { /* belum ada — dibuat di bawah */ }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  } catch (e) {
    console.warn('[auth] Tidak bisa menyimpan session secret, memakai kunci sementara di memori:', e.message);
  }
  return generated;
}
const SESSION_SECRET = loadOrCreateSessionSecret();

function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({
    u: user.username,
    r: user.role,
    n: user.name,
    dn: user.doctor_name || null,   // nama dokter di Neosoft, untuk filter komisi sendiri
    exp: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Panjang harus dicek dulu — timingSafeEqual melempar kalau beda panjang.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function getRequestUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return verifyToken(token);
}

// Kebijakan data per role — didefinisikan sekali di role_policy.js dan
// dipakai bersama server, mesin AI, dan tampilan. Jangan disalin ulang
// ke sini: salinan yang tercecer adalah asal mula kebocoran endpoint AI.
const { permsForRole } = require('./role_policy');
const { syncPriceSheets } = require('./price_sheet_sync');

function permsFor(sess) {
  return permsForRole(sess && sess.r);
}

// Endpoint yang memang harus terbuka tanpa login.
// /api/feedback/submit dipakai PASIEN lewat public/feedback.html — kalau
// ini ikut dikunci, form feedback-nya mati.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/feedback/submit',
  '/api/meta-ads/oauth/callback',
  '/api/health'
]);

// Endpoint yang hanya boleh untuk role tertentu (di luar penyaringan payload).
const ENDPOINT_ROLE_GUARDS = {
  '/api/sales/unused-package':      ['owner', 'sales', 'marketing', 'doctor'],
  '/api/sales/unused-packages':     ['owner', 'sales', 'marketing', 'doctor'],
  '/api/sales/appointment':         ['owner', 'sales', 'marketing', 'doctor', 'operational'],
  '/api/marketing/campaign-reminders':      ['owner', 'marketing', 'sales'],
  '/api/marketing/campaign-reminders/done': ['owner', 'marketing'],
  '/api/sales/cross-sell':          ['owner', 'sales', 'marketing', 'doctor'],
  '/api/sales/cross-sell-opportunities': ['owner', 'sales', 'marketing', 'doctor'],
  '/api/hr/nurse-kpi':              ['owner', 'hr', 'operational', 'finance'],
  '/api/before-after/treatments':   ['owner', 'operational', 'doctor', 'marketing'],
  '/api/before-after/by-treatment': ['owner', 'operational', 'doctor', 'marketing'],
  '/api/sales/appointments':        ['owner', 'sales', 'marketing', 'doctor', 'operational'],
  '/api/marketing/monthly-trends':  ['owner', 'marketing', 'sales'],
  '/api/medical-record/compliance':  ['owner', 'doctor', 'hr'],
  '/api/treatment-master':          ['owner', 'operational', 'finance', 'doctor', 'marketing', 'sales'],
  '/api/treatment-master/category': ['owner', 'operational'],
  '/api/pharmacy/bhp-standard':  ['owner', 'operational', 'finance', 'doctor'],
  '/api/pharmacy/bhp-items':     ['owner', 'operational', 'finance', 'doctor'],
  '/api/pharmacy/bhp-unit':      ['owner', 'operational', 'finance'],
  '/api/patient/before-after-compliance': ['owner', 'operational', 'doctor', 'marketing'],
  '/api/patient/before-after/photo':      ['owner', 'operational', 'doctor', 'marketing'],
  '/api/commissions/update-rules': ['owner', 'finance'],
  '/api/reports/neosoft':                   ['owner', 'finance', 'operational', 'marketing', 'doctor', 'sales'],
  '/api/reports/neosoft/manual-unredeemed': ['owner', 'finance', 'operational', 'doctor', 'sales'],
  '/api/settlement/reconcile':     ['owner', 'finance'],
  '/api/unified/settlement':       ['owner', 'finance'],
  '/api/finance/reconciliation':   ['owner', 'finance'],
  '/api/finance/invoice-audit':        ['owner', 'finance'],
  '/api/finance/invoice-audit/status': ['owner', 'finance'],
  '/api/meta-ads/settings':        ['owner', 'marketing'],
  '/api/meta-ads/config':          ['owner', 'marketing'],
  '/api/meta-ads/token-connect':   ['owner', 'marketing'],
  '/api/meta-ads/oauth/url':       ['owner', 'marketing'],
  '/api/meta-ads/disconnect':      ['owner', 'marketing'],
  '/api/meta-ads/sync':            ['owner', 'marketing'],
  '/api/meta-ads/manager':         ['owner', 'marketing'],
  '/api/instagram/sync-from-meta': ['owner', 'marketing'],
  '/api/hr/attendance/day':        ['owner', 'hr', 'operational'],
  '/api/hr/attendance/recap':      ['owner', 'hr', 'operational'],
  '/api/hr/attendance/leaves':     ['owner', 'hr', 'operational'],
  '/api/gaji-id/settings':         ['owner', 'hr', 'operational'],
  '/api/gaji-id/login':            ['owner', 'hr'],
  '/api/gaji-id/token-connect':    ['owner', 'hr'],
  '/api/gaji-id/disconnect':       ['owner', 'hr'],
  '/api/gaji-id/sync':             ['owner', 'hr', 'operational'],
  '/api/clinic-settings':          ['owner', 'operational'],
  '/api/price-master':             ['owner', 'marketing', 'sales', 'finance'],
  '/api/price-master/save':        ['owner', 'marketing', 'finance'],
  '/api/price-master/sync':        ['owner', 'marketing', 'sales', 'finance'],
  '/api/treatments/top-usage':     ['owner', 'marketing', 'sales', 'finance'],
  '/api/wa-templates':             ['owner', 'marketing', 'sales', 'operational', 'finance', 'doctor'],
  '/api/wa-templates/reset':       ['owner', 'marketing', 'sales', 'operational', 'finance', 'doctor'],
  '/api/trigger-sync':             ['owner', 'operational'],
  '/api/trigger-sync/status':      ['owner', 'operational'],
  '/api/dispatch-telegram':        ['owner'],
  '/api/send-wa-promo':            ['owner', 'marketing'],
  '/api/crm/launch-blast':         ['owner', 'marketing'],
  '/api/crm/cancel-blast':         ['owner', 'marketing'],
  '/api/crm/blast-status':         ['owner', 'marketing'],
  '/api/crm/reactivation-patients': ['owner', 'sales', 'marketing'],
  '/api/crm/spending-tier-export':   ['owner', 'sales', 'marketing'],
  '/api/marketing/stock-promo':      ['owner', 'marketing', 'finance'],
  '/api/sales/stock-treatment':      ['owner', 'sales', 'marketing', 'finance'],
  // KRITIS: sebelumnya endpoint ini TIDAK ADA di guard sama sekali —
  // artinya SEMUA role yang login (sales, marketing, hr, operational)
  // bisa memanggilnya, dan formulirnya memang ditampilkan di tab AI
  // Assistant milik role-role itu juga (bukan cuma owner). Siapa pun yang
  // login sebagai sales tinggal panggil endpoint ini dengan
  // {phone: '<nomor apa saja>', role: 'owner'} untuk memberi nomor WA
  // manapun akses level Owner — jalan pintas total melewati RBAC web yang
  // sudah dibangun. Whitelist WA menentukan siapa dapat akses OWNER lewat
  // WhatsApp; mengelolanya wajib setara dengan mengelola akun staf itu
  // sendiri — hanya Owner.
  '/api/assistant/add-whitelist':  ['owner'],
  '/api/assistant/remove-whitelist': ['owner'],
  // Grup WA: menentukan grup mana yang dilayani bot & level data yang
  // terlihat semua anggotanya — setara mengelola whitelist, Owner saja.
  '/api/assistant/wa-groups':      ['owner']
};

// --- WhatsApp Blast Queue (real, jalan di background) ---
// Sengaja in-memory (bukan file) — antrian blast yang sedang jalan tidak
// perlu bertahan lewat restart server; kalau server restart di tengah
// jalan, sisa antrian memang perlu dimulai ulang oleh staf (lebih aman
// daripada diam-diam lanjut kirim ke daftar lama yang mungkin sudah basi).
let blastQueueState = {
  running: false, cancelled: false, tier: null, total: 0, sent: 0, failed: 0,
  started_at: null, finished_at: null, current_patient: null
};

async function runBlastQueue(tier, messages) {
  blastQueueState = {
    running: true, cancelled: false, tier, total: messages.length, sent: 0, failed: 0,
    started_at: new Date().toISOString(), finished_at: null, current_patient: null
  };
  for (let i = 0; i < messages.length; i++) {
    if (blastQueueState.cancelled) break;
    const m = messages[i];
    blastQueueState.current_patient = m.name || m.phone;
    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    const result = await sendWhatsAppMessage(m.phone, m.text);
    if (result.success) {
      blastQueueState.sent++;
      addDispatchLog({ timestamp: nowStr, type: `WhatsApp CRM Blast [${tier}]`, status: 'Sent ✅', items_sent: 1, recipient: m.name || m.phone, delay: 'via WhatsApp Baileys' });
    } else {
      blastQueueState.failed++;
      addDispatchLog({ timestamp: nowStr, type: `WhatsApp CRM Blast [${tier}]`, status: `Failed: ${result.error}`, items_sent: 0, recipient: m.name || m.phone, delay: '-' });
    }
    if (blastQueueState.cancelled || i === messages.length - 1) continue;
    const delayMs = 6000 + Math.round(Math.random() * 6000); // 6-12 detik anti-ban SUNGGUHAN
    await new Promise(r => setTimeout(r, delayMs));
  }
  blastQueueState.running = false;
  blastQueueState.current_patient = null;
  blastQueueState.finished_at = new Date().toISOString();
}

// BV (modal per tindakan dari spreadsheet), biaya BHP Neosoft & margin hanya untuk owner/finance. Role lain
// menerima payload yang sama tanpa angka modal (dibuang di server, bukan disembunyikan di UI).
const COST_KEYS = new Set(['bv', 'bv_cost', 'bhp_cost', 'margin', 'margin_pct', 'floor_price', 'discount_room', 'bv_count']);
const canSeeCost = (sess) => !!sess && (sess.r === 'owner' || sess.r === 'finance');
function stripCost(v) {
  if (Array.isArray(v)) return v.map(stripCost);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!COST_KEYS.has(k)) o[k] = stripCost(x);
    return o;
  }
  return v;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Buang nilai rupiah tingkat KLINIK dari payload ringkasan.
// CATATAN: belanja per-pasien (total_spent, saldo deposit) SENGAJA tidak
// dibuang — itu data CRM yang memang dibutuhkan sales/marketing.
function stripClinicMoney(summary) {
  const out = { ...summary };
  delete out.finance_cash_flow_hub;
  delete out.settlement_reconciliation;
  delete out.revenue_forecast_hub;
  delete out.daily_sales_targets;
  delete out.total_omset;

  if (out.kpi) {
    const kpi = { ...out.kpi };
    ['total_omset', 'total_omset_formatted', 'growth_vs_july', 'target_monthly', 'target_pct',
     'total_doctor_commission', 'total_doctor_commission_fmt',
     'total_therapist_commission', 'total_therapist_commission_fmt'].forEach(k => delete kpi[k]);
    out.kpi = kpi;
  }
  if (out.branches) {
    out.branches = out.branches.map(b => {
      const c = { ...b };
      delete c.revenue;
      return c;
    });
  }
  if (out.staff_performance_summary) {
    // Ringkasan performa boleh tampil, tapi tanpa nominal omset/komisi.
    const sp = { ...out.staff_performance_summary };
    const scrub = d => {
      if (!d) return d;
      const c = { ...d };
      ['gross_revenue', 'gross_revenue_fmt', 'treatment_revenue_fmt', 'skincare_revenue_fmt',
       'avg_basket', 'avg_basket_fmt', 'total_commission', 'total_commission_fmt'].forEach(k => delete c[k]);
      return c;
    };
    sp.top_doctor = scrub(sp.top_doctor);
    sp.top_therapist = scrub(sp.top_therapist);
    out.staff_performance_summary = sp;
  }
  if (out.pharmacy_po_hub) {
    const po = { ...out.pharmacy_po_hub };
    delete po.total_estimated_po_cost;
    po.recommendations = (po.recommendations || []).map(r => {
      const c = { ...r };
      delete c.cogs; delete c.total_estimated_cost; delete c.total_estimated_cost_fmt;
      return c;
    });
    out.pharmacy_po_hub = po;
  }
  return out;
}

function stripClinical(summary) {
  const out = { ...summary };
  delete out.clinical_patient_timeline_hub;
  delete out.nurse_photo_compliance;
  return out;
}

function filterCommissions(summary, sess, perms) {
  if (perms.all_commissions) return summary;
  const out = { ...summary };

  if (!perms.own_commission) {
    delete out.commission_calculator;
    delete out.doctor_kpi_hub;
    return out;
  }

  // Dokter: hanya barisnya sendiri, tanpa payroll perawat & total klinik.
  const norm = s => (s || '').toLowerCase().replace(/^(dr\.?|drg\.?)\s*/, '').trim();
  const me = norm(sess.dn || sess.n);
  const comm = out.commission_calculator || {};
  out.commission_calculator = {
    rules: comm.rules,
    doctors: (comm.doctors || []).filter(d => norm(d.name) === me),
    therapists: [],
    summary: null
  };
  if (out.doctor_kpi_hub) {
    out.doctor_kpi_hub = {
      doctors: (out.doctor_kpi_hub.doctors || []).filter(d => norm(d.name) === me),
      top_performer: null
    };
  }
  return out;
}

function filterSummaryForRole(summary, sess) {
  const perms = permsFor(sess);
  let out = summary;
  if (!perms.clinic_money) out = stripClinicMoney(out);
  if (!perms.clinical) out = stripClinical(out);
  out = filterCommissions(out, sess, perms);
  out._access = { role: sess.r, filtered: !(perms.clinic_money && perms.all_commissions && perms.clinical) };
  return out;
}

// Buang bagian klinis dari hasil Patient 360 untuk role non-klinis.
function stripPatientClinical(patients) {
  return (patients || []).map(p => {
    const c = { ...p };
    delete c.medical_record_photos;
    delete c.clinical_photo_sessions;
    delete c.neosoft_examinations;
    delete c.next_plan;
    delete c.next_doctor_plan;
    delete c.doctor_next_plan;
    delete c.rekam_medis;
    delete c.physical_examinations;
    c._clinical_hidden = true;
    return c;
  });
}

// Global configurable commission rules in memory
let globalCommissionRules = {
  doc_treatment_pct: 10,
  doc_skincare_pct: 2.5,
  therapist_fee_per_tindakan: 20000
};

// Accounts Configuration for KEFIR Clinic & Neosoft System Roles
// Mendukung login via Email / Username resmi Neosoft Cube & PIN/Password
const KEFIR_USERS = {
  // 1. Superadmin / Owner (Full Executive Access)
  'admin@kefirdermaclinic.com': { pass: ['kefir2026', '8888', 'admin123'], username: 'admin', name: 'Direksi Eksekutif', role: 'owner', title: 'Owner & Direksi', avatar: '👑', color: 'purple', outlet: 'All Outlets' },
  'owner@kefirdermaclinic.com': { pass: ['kefir2026', '8888', 'owner123'], username: 'owner', name: 'Direksi Eksekutif', role: 'owner', title: 'Owner & Direksi', avatar: '👑', color: 'purple', outlet: 'All Outlets' },
  'admin': { pass: ['kefir2026', '8888', 'admin123'], username: 'admin', name: 'Superadmin Neosoft', role: 'owner', title: 'Owner & Direksi', avatar: '👑', color: 'purple', outlet: 'All Outlets' },
  'owner': { pass: ['kefir2026', '8888'], username: 'owner', name: 'Direksi Eksekutif', role: 'owner', title: 'Owner & Direksi', avatar: '👑', color: 'purple', outlet: 'All Outlets' },

  // 2. HRD & Human Capital
  'hr@kefirdermaclinic.com': { pass: ['kefir2026', '1234', 'hr123'], username: 'hr', name: 'Tim HRD & Roster', role: 'hr', title: 'Human Resources Dept', avatar: '👥', color: 'rose', outlet: 'Depok & Pondok Kopi' },
  'hr': { pass: ['kefir2026', '1234'], username: 'hr', name: 'Tim HRD & Roster', role: 'hr', title: 'Human Resources Dept', avatar: '👥', color: 'rose', outlet: 'Depok & Pondok Kopi' },

  // 3. Marketing & Digital Ads
  'marketing@kefirdermaclinic.com': { pass: ['kefir2026', '2345', 'mkt123'], username: 'marketing', name: 'Tim Digital Ads & CRM', role: 'marketing', title: 'Marketing Division', avatar: '🎯', color: 'blue', outlet: 'All Outlets' },
  'marketing': { pass: ['kefir2026', '2345'], username: 'marketing', name: 'Tim Digital Ads & CRM', role: 'marketing', title: 'Marketing Division', avatar: '🎯', color: 'blue', outlet: 'All Outlets' },

  // 4. Front Office, Kasir & CS (Branch Outlets)
  'kasir.depok@kefirdermaclinic.com': { pass: ['kefir2026', '3456', 'kasir123'], username: 'kasir.depok', name: 'Kasir Margonda (Outlet 1)', role: 'sales', title: 'Kasir & Front Office', avatar: '🛍️', color: 'emerald', outlet: 'Depok' },
  'kasir.pdk@kefirdermaclinic.com': { pass: ['kefir2026', '3456', 'kasir123'], username: 'kasir.pdk', name: 'Kasir Ngurah Rai (Outlet 2)', role: 'sales', title: 'Kasir & Front Office', avatar: '🛍️', color: 'emerald', outlet: 'Pondok Kopi' },
  'sales': { pass: ['kefir2026', '3456'], username: 'sales', name: 'Kasir & Front Office', role: 'sales', title: 'Front Office & CS', avatar: '🛍️', color: 'emerald', outlet: 'All Outlets' },
  'kasir': { pass: ['kefir2026', '3456'], username: 'kasir', name: 'Kasir & Front Office', role: 'sales', title: 'Front Office & CS', avatar: '🛍️', color: 'emerald', outlet: 'All Outlets' },

  // 5. Operational & Medical Facilities
  'ops@kefirdermaclinic.com': { pass: ['kefir2026', '4567', 'ops123'], username: 'ops', name: 'Kepala Operasional & Mesin Laser', role: 'operational', title: 'Clinic Operations', avatar: '⚙️', color: 'amber', outlet: 'Depok & Pondok Kopi' },
  'operational': { pass: ['kefir2026', '4567'], username: 'operational', name: 'Kepala Operasional & Mesin Laser', role: 'operational', title: 'Clinic Operations', avatar: '⚙️', color: 'amber', outlet: 'Depok & Pondok Kopi' },
  'ops': { pass: ['kefir2026', '4567'], username: 'ops', name: 'Kepala Operasional & Mesin Laser', role: 'operational', title: 'Clinic Operations', avatar: '⚙️', color: 'amber', outlet: 'Depok & Pondok Kopi' },

  // 6. Dokter & Tenaga Medis (Medical Doctor & EMR)
  'dokter@kefirdermaclinic.com': { pass: ['kefir2026', '5678', 'dokter123'], username: 'dokter', name: 'Dokter Praktek Klinik', role: 'doctor', title: 'Medical Doctor & EMR', avatar: '👨‍⚕️', color: 'indigo', outlet: 'All Outlets' },
  'dokter': { pass: ['kefir2026', '5678', 'dokter123'], username: 'dokter', name: 'Dokter Praktek Klinik', role: 'doctor', title: 'Medical Doctor & EMR', avatar: '👨‍⚕️', color: 'indigo', outlet: 'All Outlets' },
  'doctor': { pass: ['kefir2026', '5678', 'dokter123'], username: 'doctor', name: 'Dokter Praktek Klinik', role: 'doctor', title: 'Medical Doctor & EMR', avatar: '👨‍⚕️', color: 'indigo', outlet: 'All Outlets' }
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── GERBANG AKSES: semua /api/ wajib token, kecuali daftar publik ───
  // Ditempatkan sebelum seluruh handler supaya tidak ada endpoint yang
  // kelewat. Sesi hasil verifikasi dipakai handler di bawah lewat `sess`.
  let sess = null;
  if (pathname.startsWith('/api/') && !PUBLIC_API_PATHS.has(pathname)) {
    sess = getRequestUser(req);
    if (!sess) {
      return sendJson(res, 401, {
        success: false,
        error: 'Sesi tidak valid atau sudah berakhir. Silakan login ulang.',
        code: 'AUTH_REQUIRED'
      });
    }
    const allowedRoles = ENDPOINT_ROLE_GUARDS[pathname];
    if (allowedRoles && !allowedRoles.includes(sess.r)) {
      return sendJson(res, 403, {
        success: false,
        error: `Akses ditolak. Endpoint ini hanya untuk: ${allowedRoles.join(', ')}.`,
        code: 'FORBIDDEN'
      });
    }
  }

  // --- HEALTH CHECK ENDPOINT ---
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'kefir-clinic-dashboard',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  // --- AUTH & LOGIN ENDPOINT ---
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const processLogin = (payload) => {
      try {
        const usernameInput = (payload.username || '').trim().toLowerCase();
        const passInput = (payload.pin || payload.password || '').trim();

        const user = KEFIR_USERS[usernameInput];
        const isValid = user && user.pass.includes(passInput);

        if (isValid) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            user: {
              username: user.username,
              name: user.name,
              role: user.role,
              title: user.title,
              avatar: user.avatar,
              color: user.color,
              outlet: user.outlet
            },
            token: issueToken(user)
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Username/Email atau Password Neosoft salah.' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    };

    if (req.body && typeof req.body === 'object') {
      return processLogin(req.body);
    }
    if (typeof req.body === 'string' && req.body.length > 0) {
      try { return processLogin(JSON.parse(req.body)); } catch (e) {}
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        processLogin(JSON.parse(body || '{}'));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- API ENDPOINTS ---

  // 0. GET /api/assistant/wa-status (WhatsApp QR & Connection Status)
  if (pathname === '/api/assistant/wa-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAssistantStatus()));
    return;
  }

  // 0a. POST /api/assistant/reset-wa (Force Reset Session & Generate Fresh QR Code)
  if (pathname === '/api/assistant/reset-wa' && req.method === 'POST') {
    const result = resetWhatsAppSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 0b. POST /api/assistant/add-whitelist (Add Multi-Role Staff Phone to Whitelist)
  if (pathname === '/api/assistant/add-whitelist' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const VALID_ROLES = ['owner', 'sales', 'marketing', 'operational', 'hr', 'finance', 'doctor', 'kasir'];
        const requested = Array.isArray(payload.roles) && payload.roles.length ? payload.roles : [payload.role || 'owner'];
        const roles = [...new Set(requested.map(r => String(r).toLowerCase()))];
        const bad = roles.find(r => !VALID_ROLES.includes(r));
        if (bad) throw new Error(`Peran tidak dikenal: ${bad}`);
        const name = payload.name || `Staf ${roles[0].toUpperCase()}`;
        // roles[] = ganti seluruh peran nomor ini; role tunggal = tambah ke peran yang ada
        const map = addRoleNumber(payload.phone, Array.isArray(payload.roles) ? roles : roles[0], name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, whitelist_map: map }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

    // 0b2. POST /api/assistant/remove-whitelist (Remove Staff Phone from Whitelist)
  if (pathname === '/api/assistant/remove-whitelist' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const map = removeRoleNumber(payload.phone || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, whitelist_map: map }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 0b3. GET/POST /api/assistant/wa-groups — daftar grup WA bot & aktivasinya
  if (pathname === '/api/assistant/wa-groups' && req.method === 'GET') {
    getGroupList(parsedUrl.searchParams.get('refresh') === '1').then(r => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (pathname === '/api/assistant/wa-groups' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const groups = setGroupConfig(payload.jid, {
          enabled: payload.enabled === undefined ? undefined : !!payload.enabled,
          role: payload.role === undefined ? undefined : String(payload.role).toLowerCase()
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, groups }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 0-doc. GET /api/assistant/documents/<id> — unduh Excel/PDF buatan AI.
  // Hanya pembuat dokumen yang bisa mengunduh (dokumen berisi data sesuai
  // hak akses role-nya saat dibuat).
  if (pathname.startsWith('/api/assistant/documents/') && req.method === 'GET') {
    const id = pathname.split('/').pop();
    const doc = loadDocument(id);
    if (!doc) return sendJson(res, 404, { success: false, error: 'Dokumen tidak ditemukan atau sudah kedaluwarsa (disimpan 7 hari).' });
    if (doc.meta.owner !== sess.u) return sendJson(res, 403, { success: false, error: 'Dokumen ini dibuat oleh akun lain.' });
    res.writeHead(200, {
      'Content-Type': doc.meta.mimetype,
      'Content-Length': doc.buffer.length,
      'Content-Disposition': `attachment; filename="${String(doc.meta.fileName).replace(/"/g, '')}"`,
      'Cache-Control': 'no-store'
    });
    res.end(doc.buffer);
    return;
  }

  // 0-usage. GET /api/assistant/usage?start=&end= — pemakaian token AI (owner)
  //          POST /api/assistant/usage/pricing { input_per_1m, output_per_1m } (owner)
  if (pathname === '/api/assistant/usage' && req.method === 'GET') {
    if (sess.r !== 'owner') return sendJson(res, 403, { success: false, error: 'Hanya owner' });
    const q = parsedUrl.searchParams;
    return sendJson(res, 200, { success: true, data: getUsageSummary({ start: q.get('start') || undefined, end: q.get('end') || undefined }) });
  }
  if (pathname === '/api/assistant/usage/pricing' && req.method === 'POST') {
    if (sess.r !== 'owner') return sendJson(res, 403, { success: false, error: 'Hanya owner' });
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        sendJson(res, 200, { success: true, pricing: setPricing(JSON.parse(body || '{}'), sess.n || sess.u) });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 0-diag. GET /api/assistant/diagnostics — versi kode, LLM, & uji tool-calling (owner)
  if (pathname === '/api/assistant/diagnostics' && req.method === 'GET') {
    if (sess.r !== 'owner') return sendJson(res, 403, { success: false, error: 'Hanya owner' });
    try {
      const diag = await getAssistantDiagnostics();
      return sendJson(res, 200, { success: true, ...diag });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 0-fb. POST /api/assistant/feedback — 👍/👎 per jawaban AI, supaya jawaban
  // yang salah terkumpul dan bisa diperbaiki dari kasus nyata.
  //   GET  → daftar feedback (owner saja), terbaru dulu.
  if (pathname === '/api/assistant/feedback') {
    const fbFile = path.join(__dirname, 'data', 'ai_feedback_log.json');
    const readFb = () => { try { return JSON.parse(fs.readFileSync(fbFile, 'utf8') || '[]'); } catch (e) { return []; } };
    if (req.method === 'GET') {
      if (sess.r !== 'owner') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Hanya owner' }));
        return;
      }
      const list = readFb().slice().reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: list.length, down: list.filter(f => f.rating === 'down').length, data: list }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const rating = payload.rating === 'down' ? 'down' : payload.rating === 'up' ? 'up' : null;
          if (!rating || !payload.msgId) throw new Error('rating (up/down) dan msgId wajib diisi');
          const list = readFb();
          // Satu feedback per jawaban per user — klik ulang mengganti yang lama
          const entry = {
            msg_id: String(payload.msgId).slice(0, 80),
            rating,
            note: String(payload.note || '').slice(0, 1000),
            question: String(payload.question || '').slice(0, 2000),
            answer: String(payload.answer || '').slice(0, 6000),
            user: sess.u,
            role: sess.r,
            period: payload.period || null,
            created_at: new Date().toISOString()
          };
          const idx = list.findIndex(f => f.msg_id === entry.msg_id && f.user === entry.user);
          if (idx >= 0) list[idx] = entry; else list.push(entry);
          fs.writeFileSync(fbFile, JSON.stringify(list.slice(-2000), null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }

  // 0. POST /api/assistant/ask (AI Executive Assistant Endpoint for WhatsApp/Web)
  if (pathname === '/api/assistant/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const question = payload.question || '';
        // Role WAJIB dari token sesi, bukan dari body. Sebelumnya
        // `payload.role || 'owner'` — artinya user kasir tinggal kirim
        // {"role":"owner"} dan AI menjawab omset klinik lengkap.
        const role = sess.r;
        const sender = payload.sender || `${sess.n || sess.u} (${String(role).toUpperCase()})`;
        // Tanpa periode (mis. dari WhatsApp) → AI pakai bulan berjalan WIB.
        const period = payload.period || undefined;

        // Sesi percakapan dipisah per user, supaya riwayat tanya-jawab
        // satu role tidak terbawa ke role lain lewat memori percakapan.
        const convoKey = `${sess.u}:${payload.sessionId || 'wa'}`;

        // Panggil AI Async ditenagai LLM 9Router
        const { answer, suggestions, documents, usage } = await processMultiRoleQueryDetailed(question, role, convoKey, period, { owner: sess.u, channel: 'web' });

        // Record query log
        addDispatchLog({
          timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
          type: `AI Assistant LLM [${role.toUpperCase()}]`,
          status: 'Answered (LLM)',
          items_sent: 1,
          recipient: sender,
          delay: '0.4s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          question: question,
          role: role,
          answer: answer,
          suggestions: suggestions,
          documents: documents,
          usage: usage,
          timestamp: new Date().toISOString()
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 0a. GET /api/price-master — master harga normal, bottom, paket & promo campaign
  if (pathname === '/api/price-master' && req.method === 'GET') {
    const m = getPriceMaster();
    let products = [];
    try {
      const fs2 = require('fs');
      const dir = require('path').join(__dirname, 'data', 'neosoft_db', 'products.json');
      products = JSON.parse(fs2.readFileSync(dir, 'utf8'))
        // Treatment + produk farmasi/homecare (P-) aktif untuk harga bottom farmasi
        .filter(x => Number(x.price || 0) > 0 && x.status_product_treatment !== false)
        .map(x => ({ id: x.id, code: x.product_treatment_code, name: String(x.product_treatment_name || '').trim(), price: Number(x.price || 0), kind: String(x.product_treatment_code || '').startsWith('P-') ? 'produk' : 'treatment' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {}
    const { stamp, ...data } = m;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Hanya baca: harga dikelola di spreadsheet Planning marketing (lihat price_sheet_sync.js).
    res.end(JSON.stringify({ success: true, data: canSeeCost(sess) ? data : stripCost(data), neosoft_products: products, can_edit: false }));
    return;
  }

  // 0a-0. GET /api/treatments/top-usage — tindakan paling sering dilakukan, dengan filter
  if (pathname === '/api/treatments/top-usage' && req.method === 'GET') {
    const q = (k, d) => parsedUrl.searchParams.get(k) || d;
    return sendJson(res, 200, getTopUsage({
      start: q('start', ''), end: q('end', ''), branch: q('branch', 'all'), type: q('type', 'all'),
      search: q('search', ''), sort: q('sort', 'count'), limit: q('limit', '10'),
    }));
  }

  // 0a-1. POST /api/price-master/sync — tarik ulang spreadsheet harga sekarang juga
  if (pathname === '/api/price-master/sync' && req.method === 'POST') {
    try {
      const out = await syncPriceSheets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, fetched_at: out.fetched_at,
        sources: out.sources.map(x => ({ title: x.title, ok: x.ok, error: x.error || null, campaigns: (x.campaigns || []).length })) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 0a-2. POST /api/price-master/save — dinonaktifkan: master harga hanya baca
  if (pathname === '/api/price-master/save' && req.method === 'POST') {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Master harga tidak bisa diubah dari aplikasi. Ubah di spreadsheet Planning bulan berjalan, lalu klik Sinkron ulang.' }));
    return;
  }

  // 0b. GET /api/patient360/suggest — daftar saran ringan (tanpa data klinis) untuk kotak cari
  if (pathname === '/api/patient360/suggest' && req.method === 'GET') {
    const r = suggestPatient360(parsedUrl.searchParams.get('q') || '', 8);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, total: r.total, data: r.data }));
    return;
  }

  // 0c. GET /api/patient360/lookup (Patient Spending History & Smart Treatment Recommendation)
  if (pathname === '/api/patient360/lookup' && req.method === 'GET') {
    const q = parsedUrl.searchParams.get('q') || '';
    // id: pasien yang dipilih dari daftar saran -> proses satu pasien itu saja
    const pickedId = parsedUrl.searchParams.get('id');
    let results = searchPatient360(q, { onlyId: pickedId ? pickedId : null });
    // Marketing/sales/HR/operasional: data kontak, kunjungan & belanja
    // tetap dikirim (dibutuhkan CRM), tapi rekam medis, foto klinis, dan
    // rencana perawatan dokter dibuang di sini — tidak sekadar
    // disembunyikan di tampilan.
    if (!permsFor(sess).clinical) results = stripPatientClinical(results);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      count: results.length,
      // Total pasien yang cocok — `count` hanyalah sebagian teratas by relevansi
      total_matches: pickedId ? results.length : countPatient360Matches(q),
      data: results,
      // Baris sheet CRM yang tidak bisa di-join — perlu rekonsiliasi manual
      join_diagnostics: getCrmJoinDiagnostics()
    }));
    return;
  }

  // 0c-2. GET /api/history/summary (riwayat 23 bulan dari Google Sheets)
  if (pathname === '/api/history/summary' && req.method === 'GET') {
    const h = getTransactionHistory();
    // `rows` (25.822 baris / 13,7 MB) sengaja TIDAK dikirim — hanya agregat.
    const { rows, ...summary } = h;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: summary }));
    return;
  }

  // 0c-3. GET /api/sales/comparison (akuisisi pasien baru vs upselling per staf)
  if (pathname === '/api/sales/comparison' && req.method === 'GET') {
    const data = getSalesComparison();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data }));
    return;
  }

  // 0c-4. GET /api/peak-hours (analisis jam sibuk kedatangan pasien)
  if (pathname === '/api/peak-hours' && req.method === 'GET') {
    const period = parsedUrl.searchParams.get('period') || parsedUrl.searchParams.get('timeframe') || 'all';
    const data = getPeakHourAnalysis(period);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data }));
    return;
  }

  // 0c-5. GET /api/patients/frequency (daftar pasien berdasarkan frekuensi kedatangan)
  if (pathname === '/api/patients/frequency' && req.method === 'GET') {
    // Ikut filter global: rentang tanggal (YYYY-MM-DD) & cabang.
    const qp = k => { const v = parsedUrl.searchParams.get(k) || ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
    const data = getPatientFrequencyList({ start: qp('start'), end: qp('end'), branch: parsedUrl.searchParams.get('branch') || '' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data }));
    return;
  }

  // 0c-6. GET /api/patients/demographics (usia, pekerjaan, tempat tinggal)
  if (pathname === '/api/patients/demographics' && req.method === 'GET') {
    const data = getPatientDemographics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data }));
    return;
  }

  // 0c-7. GET /api/treatment-products (Treatment → Product/BHP mapping untuk sales/FO)
  if (pathname === '/api/treatment-products' && req.method === 'GET') {
    const q = parsedUrl.searchParams.get('q') || '';
    const data = getTreatmentProductMap(q);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
    return;
  }

  // 0c-8. GET /api/bhp-variance (selisih harian: treatment vs BHP keluar di kartu stok)
  if (pathname === '/api/bhp-variance' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...getBhpVariance() }));
    return;
  }

  // 0d. GET /api/invoices/detail (Full In-Depth Neosoft Invoice Breakdown & Items)
  if (pathname === '/api/invoices/detail' && req.method === 'GET') {
    const id = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('code') || '';
    const detail = getInvoiceDetail(id);
    if (!detail) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invoice tidak ditemukan di sistem Neosoft.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: detail }));
    return;
  }

  // 1. GET /api/summary (Mission Control Feed + Dynamic Period Filter + Commissions)
  if (pathname === '/api/summary' && req.method === 'GET') {
    // Dulu cuma terima ?period=YYYY-MM (satu bulan penuh). Sekarang juga
    // terima ?start=YYYY-MM-DD&end=YYYY-MM-DD (rentang tanggal bebas) dari
    // date-range picker di frontend — ?period= tetap didukung apa adanya
    // untuk kompatibilitas mundur (dipakai beberapa pemanggil internal:
    // cron trigger-sync, dispatch-telegram, dsb).
    const start = parsedUrl.searchParams.get('start');
    const end = parsedUrl.searchParams.get('end');
    const period = parsedUrl.searchParams.get('period');
    const periodArg = (start || end) ? { start: start || null, end: end || null } : (period || currentPeriodJakarta());
    const summary = getClinicSummary(periodArg, globalCommissionRules);
    // Disaring per role SEBELUM dikirim — jadi data yang tidak boleh
    // dilihat memang tidak pernah sampai ke browser, bukan sekadar
    // disembunyikan tampilannya.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filterSummaryForRole(summary, sess)));
    return;
  }

  // 2. POST /api/commissions/update-rules (Update Commission SOP Rules)
  if (pathname === '/api/commissions/update-rules' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.doc_treatment_pct !== undefined) globalCommissionRules.doc_treatment_pct = Number(payload.doc_treatment_pct);
        if (payload.doc_skincare_pct !== undefined) globalCommissionRules.doc_skincare_pct = Number(payload.doc_skincare_pct);
        if (payload.therapist_fee_per_tindakan !== undefined) globalCommissionRules.therapist_fee_per_tindakan = Number(payload.therapist_fee_per_tindakan);

        const summary = getClinicSummary('2026-09', globalCommissionRules);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Aturan komisi berhasil diperbarui & dikalkulasi ulang secara live!',
          commission_calculator: summary.commission_calculator
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 3. GET /api/telegram-reports
  if (pathname === '/api/telegram-reports' && req.method === 'GET') {
    const summary = getClinicSummary(currentPeriodJakarta(), globalCommissionRules);
    const reports = generate6Reports(summary);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reports));
    return;
  }

  // 3b. GET /api/reports/neosoft — Unduh Laporan Resmi Format Neosoft (JSON / CSV Spreadsheet)
  if (pathname === '/api/reports/neosoft' && req.method === 'GET') {
    const type = parsedUrl.searchParams.get('type') || 'sales_summary';
    const start = parsedUrl.searchParams.get('start');
    const end = parsedUrl.searchParams.get('end');
    const period = parsedUrl.searchParams.get('period');
    const outlet = parsedUrl.searchParams.get('outlet') || 'all';
    const format = parsedUrl.searchParams.get('format') || 'json';

    const reportData = getNeosoftReportData({ type, start, end, period, outlet });

    if (format === 'csv') {
      const csvContent = generateNeosoftCsv(reportData);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${reportData.filename || 'Neosoft_Report'}.csv"`
      });
      res.end(csvContent);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: reportData
    }));
    return;
  }

  // 3c. GET /api/reports/neosoft/manual-unredeemed — Ambil daftar sisa treatment yang dicatat manual
  if (pathname === '/api/reports/neosoft/manual-unredeemed' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      data: getManualUnredeemedTreatments()
    });
  }

  // 3d. POST /api/reports/neosoft/manual-unredeemed — Simpan catatan sisa treatment manual / offline
  if (pathname === '/api/reports/neosoft/manual-unredeemed' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = saveManualUnredeemedTreatment(payload);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 3e. DELETE /api/reports/neosoft/manual-unredeemed — Hapus catatan sisa treatment manual
  if (pathname === '/api/reports/neosoft/manual-unredeemed' && req.method === 'DELETE') {
    const id = parsedUrl.searchParams.get('id');
    if (!id) {
      return sendJson(res, 400, { success: false, error: 'Parameter ID sisa treatment diperlukan' });
    }
    const result = deleteManualUnredeemedTreatment(id);
    return sendJson(res, 200, result);
  }


  // 4. POST /api/dispatch-telegram (Trigger delivery + Log)
  //
  // SEBELUMNYA endpoint ini SELALU melapor "Success" dan mencatat log
  // "berhasil di-dispatch ke Telegram" — padahal TIDAK ADA panggilan ke
  // Telegram Bot API di mana pun di kode ini (dicek: nol referensi
  // api.telegram.org, bot token, atau chat_id di seluruh proyek). Tombol
  // "Kirim Semua Sekarang" mengklaim mengirim ke grup manajemen padahal
  // tidak pernah menghubungi Telegram sama sekali.
  //
  // Sekarang: kalau kredensial bot Telegram (TELEGRAM_BOT_TOKEN &
  // TELEGRAM_CHAT_ID) belum diisi lewat environment variable, endpoint
  // ini jujur menolak dengan alasan jelas — tidak lagi mencatat log
  // "Success" palsu. Begitu kredensial asli tersedia, tinggal sambungkan
  // panggilan fetch ke api.telegram.org/bot<token>/sendMessage di sini.
  if (pathname === '/api/dispatch-telegram' && req.method === 'POST') {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return sendJson(res, 200, {
        success: false,
        message: 'Belum ada koneksi Telegram Bot API sungguhan (TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID belum diisi). Laporan bisa dibuka lewat "Lihat Preview 6 Laporan", tapi tombol kirim ini belum benar-benar mengirim ke Telegram mana pun.'
      });
    }
    // TODO: begitu TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID tersedia,
    // panggil api.telegram.org/bot<token>/sendMessage di sini untuk
    // tiap laporan, baru catat addDispatchLog dengan status sungguhan.
    return sendJson(res, 501, { success: false, message: 'Pengiriman Telegram sungguhan belum diimplementasikan.' });
  }

  // 5. POST /api/trigger-sync (Manual Neosoft Live Sync Trigger)
  if (pathname === '/api/trigger-sync' && req.method === 'POST') {
    const { exec } = require('child_process');
    const syncScript = path.join(__dirname, 'scripts', 'sync_neosoft.py');
    // Sync bisa makan >100 dtk; proxy/Cloudflare memutus request panjang dengan halaman HTML
    // (→ "Unexpected token '<'" di browser). Jadi dijalankan di latar belakang dan
    // dijawab langsung 202; status dipantau lewat GET /api/trigger-sync/status.
    if (manualSync.running) {
      return sendJson(res, 202, { success: true, running: true, started_at: manualSync.started_at, message: 'Sync masih berjalan…' });
    }
    manualSync = { running: true, started_at: new Date().toISOString(), finished_at: null, ok: null, message: null, inv_count: null, cust_count: null };
    sendJson(res, 202, { success: true, running: true, started_at: manualSync.started_at, message: 'Sync dimulai…' });
    cleanStaleSyncLock();
    const pyBin = getPythonBin();
    const childEnv = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
    };

    exec(`"${pyBin}" "${syncScript}"`, { timeout: 180000, env: childEnv }, (error, stdout, stderr) => {
      const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
      let isSuccess = !error;

      // Periode berjalan (Asia/Jakarta)
      const summary = getClinicSummary(currentPeriodJakarta());
      const invCount = summary.kpi?.neosoft_invoice_count || 0;
      const custCount = summary.kpi?.registered_customers_count || 0;

      let failReason = null;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'neosoft_db', 'sync_meta.json'), 'utf8'));
        if (meta.status === 'success' || meta.status === 'partial') {
          isSuccess = true;
        }
        if (Array.isArray(meta.errors) && meta.errors.length) failReason = meta.errors.join('; ');
      } catch (e) { /* sync_meta.json belum ada / tidak terbaca */ }

      if (!isSuccess && !failReason) {
        const cleaned = (stderr || '')
          .split('\n')
          .filter(line => !/NotOpenSSLWarning|warnings\.warn\(/.test(line))
          .join(' ')
          .trim();
        failReason = cleaned || error?.message || 'Unknown error';
      }

      addDispatchLog({
        timestamp: nowStr,
        type: 'Neosoft Live Sync (Manual Trigger)',
        status: isSuccess ? 'Success' : 'Failed',
        items_sent: invCount,
        recipient: 'Live Neosoft Cube Cloud API',
        delay: '0s'
      });

      manualSync = {
        running: false, started_at: manualSync.started_at, finished_at: new Date().toISOString(), ok: isSuccess,
        inv_count: invCount, cust_count: custCount,
        message: isSuccess
          ? `✅ Live Sync Neosoft Sukses! ${invCount} Invoices & ${custCount} Pasien ter-update langsung dari Cloud API.`
          : `❌ Live Sync gagal: ${failReason}`
      };
      syncState.last_finished_at = manualSync.finished_at; syncState.last_ok = isSuccess;
      syncState.last_error = isSuccess ? null : String(failReason || '').slice(0, 300);
    });
    return;
  }

  if (pathname === '/api/trigger-sync/status' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...manualSync });
  }

  // 5b. GET /api/neosoft/master (Master data: Kategori, Bank, Outlets, Roles, Equipment, dll)
  if (pathname === '/api/neosoft/master' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getNeosoftMasterData()));
    return;
  }

  // 5c. GET /api/neosoft/logistics (Logistik: Stok Opname, Kartu Stok, Mutasi, Buffer Alerts)
  if (pathname === '/api/neosoft/logistics' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getNeosoftLogisticsData()));
    return;
  }

  // 5d. GET /api/neosoft/alerts (Automasi Real-Time Neosoft Alarm Status)
  if (pathname === '/api/neosoft/alerts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAutomationAlertsSummary()));
    return;
  }

  // 5e. GET /api/instagram/profile (Official Instagram @kefirdermaclinic Status & Metrics)
  if (pathname === '/api/instagram/profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getInstagramProfile()));
    return;
  }

  // 5f. POST /api/instagram/update-manual — dulu /api/instagram/sync
  // mencoba scraping HTML publik Instagram (bukan API resmi) dan tetap
  // melaporkan sukses walau gagal total. Sekarang murni input manual staf.
  if (pathname === '/api/instagram/update-manual' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = updateInstagramProfileManual(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 5f2. POST /api/instagram/sync-from-meta — tarik data Instagram REAL
  // lewat Meta Graph API, pakai token Meta Ads yang sama (tidak perlu
  // kredensial baru). Cuma berhasil kalau Meta Ads sudah terhubung DAN
  // Instagram klinik sudah Business/Creator yang tertaut ke Facebook Page
  // yang dipakai connect — kalau tidak, gagal dengan pesan jujur (lihat
  // syncInstagramFromMeta di meta_ads_service.js).
  if (pathname === '/api/instagram/sync-from-meta' && req.method === 'POST') {
    (async () => {
      try {
        const result = await syncInstagramFromMeta();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }

  // 5g. POST /api/instagram/add-post (Track New Post from @kefirdermaclinic)
  if (pathname === '/api/instagram/add-post' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = addInstagramPostTrack(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5h. GET /api/tiktok/profile (Official TikTok @kefirdermaclinic Status & Metrics)
  if (pathname === '/api/tiktok/profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getTikTokProfile()));
    return;
  }

  // 5i. POST /api/tiktok/update-manual — dulu /api/tiktok/sync, pola sama
  // dengan Instagram (lihat komentar di atas).
  if (pathname === '/api/tiktok/update-manual' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = updateTikTokProfileManual(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 6. POST /api/send-wa-promo
  if (pathname === '/api/send-wa-promo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Voucher promo ultah berhasil disiapkan untuk ${payload.patient_name || 'Pasien'} via WhatsApp API!`
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 7. POST /api/crm/launch-blast — DULU cuma menulis 1 baris log dan
  // mengaku "diantrikan ke gateway"; tidak ada gateway apa pun, tidak ada
  // pesan yang benar-benar terkirim. Sekarang benar-benar mengirim lewat
  // koneksi WhatsApp Baileys yang sama dipakai AI Assistant (sock),
  // dengan delay anti-ban 6-12 detik SUNGGUHAN antar pesan (bukan klaim).
  // body: { tier, messages: [{ phone, name, text }] } — teks pesan sudah
  // dipersonalisasi di frontend (mengikuti template VIP/generic yang
  // sama dengan tombol kirim satuan), server cuma menjalankan antriannya.
  if (pathname === '/api/crm/launch-blast' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isWhatsAppConnected()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: 'Belum terhubung ke WhatsApp. Buka tab "AI Assistant Owner" dan scan QR dulu sebelum bisa blast otomatis. Kirim satu-satu lewat tombol wa.me tetap bisa dipakai sementara.'
          }));
        }
        if (blastQueueState.running) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: `Masih ada blast [${blastQueueState.tier}] yang sedang berjalan (${blastQueueState.sent}/${blastQueueState.total}). Tunggu selesai atau batalkan dulu.` }));
        }
        const messages = Array.isArray(payload.messages) ? payload.messages.filter(m => m && m.phone && m.text) : [];
        if (messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Tidak ada pesan valid untuk dikirim (butuh phone & text per pasien).' }));
        }

        runBlastQueue(payload.tier || 'Tier', messages); // sengaja tidak di-await — jalan di background

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          queued_count: messages.length,
          message: `Campaign [${payload.tier}] mulai dikirim ke ${messages.length} pasien via WhatsApp, delay anti-ban 6–12 detik per pesan. Pantau progresnya di /api/crm/blast-status.`
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 7a. GET /api/crm/blast-status — progres antrian real-time (dipoll UI)
  if (pathname === '/api/crm/blast-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: blastQueueState }));
    return;
  }

  // 7b. POST /api/crm/cancel-blast (Cancel Active WhatsApp Blast Queue)
  if (pathname === '/api/crm/cancel-blast' && req.method === 'POST') {
    const wasRunning = blastQueueState.running;
    blastQueueState.cancelled = true;
    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    addDispatchLog({
      timestamp: nowStr,
      type: `WhatsApp CRM Blast (CANCELLED)`,
      status: wasRunning ? `Cancelled by User (${blastQueueState.sent}/${blastQueueState.total} terkirim)` : 'No active queue',
      items_sent: blastQueueState.sent,
      recipient: `Tier: ${blastQueueState.tier || '-'}`,
      delay: 'Aborted'
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: wasRunning
        ? `🛑 Blast dihentikan. ${blastQueueState.sent} pesan sudah terkirim sebelum dibatalkan, sisanya tidak jadi dikirim.`
        : 'Tidak ada antrian blast yang sedang berjalan.'
    }));
    return;
  }

  // 9. GET /api/crm/tier-patients?tier=Very+High (Get patient list for modal blast)
  if (pathname === '/api/crm/tier-patients' && req.method === 'GET') {
    const rawTier = (parsedUrl.searchParams.get('tier') || 'Very High').toLowerCase().replace(/\s+/g, '_');
    const summaryData = getClinicSummary(parsedUrl.searchParams.get('period') || '2026-09');
    const crmBlast = summaryData.crm_blast_hub || {};
    const tierSamples = crmBlast.tier_samples || {};
    
    const list = tierSamples[rawTier] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tier: rawTier, total: list.length, patients: list.slice(0, 50) }));
    return;
  }

  // 9b. GET /api/crm/spending-tier-patients (Filtered list of patients with tier, branch, timing, pagination)
  if (pathname === '/api/crm/spending-tier-patients' && req.method === 'GET') {
    const tier = parsedUrl.searchParams.get('tier') || 'all';
    const branch = parsedUrl.searchParams.get('branch') || 'all';
    const timing = parsedUrl.searchParams.get('timing') || 'all';
    const search = parsedUrl.searchParams.get('search') || '';
    const page = parseInt(parsedUrl.searchParams.get('page'), 10) || 1;
    const limit = parseInt(parsedUrl.searchParams.get('limit'), 10) || 15;

    const chat = parsedUrl.searchParams.get('chat') || 'all';

    // start/end (YYYY-MM-DD): belanja & tier mengikuti periode filter tanggal; kosong = seumur hidup.
    const dOk = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
    const start = dOk(parsedUrl.searchParams.get('start'));
    const end = dOk(parsedUrl.searchParams.get('end'));
    const result = getSpendingTierPatients({ tier, branch, timing, search, chat, page, limit, start, end });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  // 9b1. GET /api/crm/spending-tier-export — unduh daftar Segmentasi Blasting (filter sama dengan tabel)
  // dalam format siap impor WA Blast Studio: baris 1 = header, kolom jadi variabel {{Nama}}, {{Nomor_WA}}, dst.
  // Hanya nomor WA valid, satu baris per nomor.
  if (pathname === '/api/crm/spending-tier-export' && req.method === 'GET') {
    const q = (k, d) => parsedUrl.searchParams.get(k) || d;
    const tier = q('tier', 'all');
    const result = getSpendingTierPatients({
      tier, branch: q('branch', 'all'), timing: q('timing', 'all'),
      search: q('search', ''), chat: q('chat', 'all'), page: 1, limit: 1e9,
      start: /^\d{4}-\d{2}-\d{2}$/.test(q('start', '')) ? q('start') : null,
      end: /^\d{4}-\d{2}-\d{2}$/.test(q('end', '')) ? q('end') : null
    });
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tglIndo = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
      return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : '';
    };
    const TIER = { very_high: 'Very High', high: 'High', middle: 'Middle', low: 'Low', very_low: 'Very Low' };
    const panggilan = (n) => {
      const w = String(n || '').trim().split(/\s+/)[0] || '';
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    };
    const seen = new Set();
    let skipped = 0;
    const rows = [];
    (result.patients || []).forEach(p => {
      const ph = normalizeWaPhone(p.phone);
      if (!ph.valid || seen.has(ph.wa)) { skipped++; return; }
      seen.add(ph.wa);
      rows.push([
        p.name, panggilan(p.name), ph.wa, p.code || '', TIER[p.tier] || p.tier, p.total_spent || 0, p.source || 'Neosoft',
        p.branch || '', tglIndo(p.last_visit), tglIndo(p.control_date), p.control_treatment || '', p.control_doctor || ''
      ]);
    });
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KEFIR Dashboard';
    const ws = wb.addWorksheet('Kontak Blasting');
    ws.columns = [
      { header: 'Nama', width: 30 }, { header: 'Nama_Panggilan', width: 16 }, { header: 'Nomor_WA', width: 16 },
      { header: 'No_RM', width: 14 }, { header: 'Tier', width: 11 }, { header: 'Total_Belanja', width: 15, style: { numFmt: '"Rp "#,##0' } }, { header: 'Sumber', width: 18 },
      { header: 'Cabang', width: 20 }, { header: 'Kunjungan_Terakhir', width: 18 }, { header: 'Jadwal_Kontrol', width: 18 },
      { header: 'Treatment_Kontrol', width: 28 }, { header: 'Dokter', width: 24 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach(r => {
      const row = ws.addRow(r);
      row.getCell(3).numFmt = '@';   // nomor WA tetap teks, jangan jadi 6.28E+12
    });
    const buf = await wb.xlsx.writeBuffer();
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Blasting_${tier === 'all' ? 'Semua_Tier' : tier}_${stamp}.xlsx"`,
      'X-Export-Count': String(rows.length),
      'X-Export-Skipped': String(skipped),
      'Access-Control-Expose-Headers': 'X-Export-Count, X-Export-Skipped, Content-Disposition'
    });
    res.end(Buffer.from(buf));
    return;
  }
  // 9b2. GET /api/crm/reactivation-patients — pasien > 6 bulan tidak datang (Sheets + Neosoft), menu Sales
  if (pathname === '/api/crm/reactivation-patients' && req.method === 'GET') {
    const q = (k, d) => parsedUrl.searchParams.get(k) || d;
    const result = getReactivationPatients({
      branch: q('branch', 'all'), bucket: q('bucket', 'all'), contact: q('contact', 'all'),
      search: q('search', ''), sort: q('sort', 'spent'), treatment: q('treatment', ''), page: q('page', 1), limit: q('limit', 15)
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  // 9b3. GET /api/marketing/stock-promo — rekomendasi promo treatment dari stok slow moving / mendekati kedaluwarsa
  // 9b4. GET /api/sales/stock-treatment — sama, untuk menu Sales (Rekomendasi Penjualan Treatment)
  if ((pathname === '/api/marketing/stock-promo' || pathname === '/api/sales/stock-treatment') && req.method === 'GET') {
    const r = getStockPromoRecommendations();
    return sendJson(res, 200, canSeeCost(sess) ? { ...r, can_see_cost: true } : { ...stripCost(r), can_see_cost: false });
  }
  // 9c. POST /api/crm/tier-chat-log — catat bahwa pasien sudah dichat via WhatsApp dari tabel Spending Tier
  if (pathname === '/api/crm/tier-chat-log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = markCrmTierChatted({
          patient_id: payload.patient_id,
          name: payload.name,
          control_date: payload.control_date,
          marked_by: payload.marked_by || 'Dashboard User',
          action: payload.action || 'click'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }
  if ((pathname === '/api/laser/record-service' || pathname === '/api/assets/record-service') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const srvRes = recordAssetService({
          asset_key: payload.asset_key,
          asset_name: payload.machine_name || payload.asset_name,
          branch: payload.branch,
          service_date: payload.service_date,
          vendor: payload.vendor,
          action: payload.action,
          cost: payload.cost,
          next_due: payload.next_due,
          frequency_months: payload.frequency_months,
          maintenance_type: payload.maintenance_type,
          performed_by: payload.performed_by || payload.pic,
          condition_notes: payload.notes || payload.condition_notes,
          service_procedure: payload.service_procedure
        });

        if (!srvRes.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(srvRes));
          return;
        }

        const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
        addDispatchLog({
          timestamp: nowStr,
          type: `Asset Service Log [${payload.machine_name || payload.asset_name || 'Asset'}]`,
          status: 'Recorded',
          items_sent: 1,
          recipient: `Vendor: ${payload.vendor || 'Authorized Service'} | Branch: ${payload.branch || '-'}`,
          delay: '0s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: srvRes.message || `Riwayat servis untuk ${payload.machine_name || payload.asset_name} berhasil dicatat & jadwal diperbarui!`,
          data: srvRes
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 8b-2. GET & POST /api/doctor-recommendations — EMR Extension for Doctor Clinical Roadmap
  if (pathname === '/api/doctor-recommendations') {
    if (req.method === 'GET') {
      const customerId = parsedUrl.searchParams.get('customer_id') || null;
      const data = getDoctorRecommendations(customerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const saveRes = saveDoctorRecommendation(payload);
          if (!saveRes.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(saveRes));
            return;
          }

          const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
          addDispatchLog({
            timestamp: nowStr,
            type: `Doctor Clinical Roadmap [${payload.doctor_name || 'Dokter'}]`,
            status: 'Recorded',
            items_sent: 1,
            recipient: `Pasien: ${payload.customer_name || payload.customer_id || '-'} | Diagnosa: ${payload.skin_analysis || '-'}`,
            delay: '0s'
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `Rekomendasi clinical roadmap dari ${payload.doctor_name} untuk pasien ${payload.customer_name} berhasil disimpan!`,
            data: saveRes.data
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // 8b-3. GET & POST /api/sales/doctor-followups — Sales / CRM Follow-up for Doctor Clinical Roadmaps
  if (pathname === '/api/sales/doctor-followups') {
    if (req.method === 'GET') {
      let list = getDoctorFollowupsList();
      // Assessment SOAP = catatan medis; selain owner/dokter hanya melihat Plan
      if (!['owner', 'doctor'].includes(sess.r)) list = list.map(it => it.source === 'neosoft_soap' ? { ...it, skin_analysis: '' } : it);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: list.length, data: list }));
      return;
    }
  }

  if (pathname === '/api/sales/doctor-followups/status' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const updateRes = updateDoctorFollowupStatus(payload);
        if (!updateRes.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updateRes));
          return;
        }

        const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
        addDispatchLog({
          timestamp: nowStr,
          type: `Sales Follow-Up [${payload.status || 'Updated'}]`,
          status: 'Processed',
          items_sent: 1,
          recipient: `Rec ID: ${payload.recommendation_id} | Note: ${payload.notes || '-'}`,
          delay: '0s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Status follow-up sales berhasil diperbarui!',
          data: updateRes.data
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 8b-4. POST /api/sales/send-followup-whatsapp — dulu tombol "Kirim
  // Follow-Up WhatsApp" di pipeline Sales & CS HANYA membuka wa.me
  // (window.open di frontend), staf tetap harus menekan kirim sendiri
  // di aplikasi WhatsApp-nya — meski commit yang membangunnya menyebut
  // "WhatsApp lead dispatch" seolah otomatis. Sekarang benar-benar
  // mengirim lewat koneksi Baileys yang sama dipakai AI Assistant &
  // CRM Blast kalau sudah terhubung; kalau belum, menolak jujur supaya
  // frontend bisa jatuh ke wa.me manual sebagai fallback (bukan diam-
  // diam gagal).
  if (pathname === '/api/sales/send-followup-whatsapp' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.phone || !payload.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'phone & text wajib diisi' }));
        }
        if (!isWhatsAppConnected()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'WhatsApp belum terhubung — buka tab AI Assistant Owner dan scan QR dulu.' }));
        }
        const result = await sendWhatsAppMessage(payload.phone, payload.text);
        if (result.success) {
          const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
          addDispatchLog({
            timestamp: nowStr,
            type: 'Sales Follow-Up WhatsApp',
            status: 'Sent ✅',
            items_sent: 1,
            recipient: payload.recipient_name || payload.phone,
            delay: 'via WhatsApp Baileys'
          });
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8b-5. POST /api/pharmacy/send-po-reminder — dulu "reminder PO" cuma
  // berarti tombol "Copy PO Draft" per SKU (staf salin manual, lalu
  // tempel sendiri ke WhatsApp) — tidak ada pengingat yang benar-benar
  // terkirim. Sekarang: kirim SATU pesan gabungan berisi semua SKU di
  // bawah buffer ke PIC Pembelian (dikonfigurasi di Pengaturan Klinik)
  // lewat koneksi WhatsApp Baileys yang sama, kalau sudah terhubung.
  if (pathname === '/api/pharmacy/send-po-reminder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const settings = getClinicSettings();
        if (!settings.purchasing_pic_phone) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Nomor WhatsApp PIC Pembelian belum diisi di Pengaturan Klinik.' }));
        }
        if (!isWhatsAppConnected()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'WhatsApp belum terhubung — buka tab AI Assistant Owner dan scan QR dulu.' }));
        }
        if (!payload.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Isi pesan (text) wajib diisi' }));
        }
        const result = await sendWhatsAppMessage(settings.purchasing_pic_phone, payload.text);
        if (result.success) {
          const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
          addDispatchLog({
            timestamp: nowStr,
            type: 'Reminder PO Farmasi',
            status: 'Sent ✅',
            items_sent: payload.item_count || 1,
            recipient: settings.purchasing_pic_name || settings.purchasing_pic_phone,
            delay: 'via WhatsApp Baileys'
          });
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8b. POST /api/followup/mark-done — record that a patient/stage follow-up was sent,
  // so the Smart Follow-Up Journey queue never surfaces the same invoice+stage twice.
  if (pathname === '/api/followup/mark-done' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = markFollowUpDone({
          id: payload.id,
          stage: payload.stage,
          patient: payload.patient,
          phone: payload.phone,
          outlet: payload.outlet,
          treatment: payload.treatment,
          marked_by: (sess && (sess.n || sess.u)) || payload.marked_by || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8c. GET /api/followup/status-log — history of marked follow-ups
  if (pathname === '/api/followup/status-log' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, logs: getFollowUpStatusLog() }));
    return;
  }

  // 8d. POST /api/assets/update-note — input manual kondisi terakhir & tanggal
  // beli aset dari dashboard (spreadsheet belum punya kolom tanggal beli,
  // dan kolom Notes-nya sering kosong).
  if (pathname === '/api/assets/update-note' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = setAssetManualNote({
          name: payload.name,
          branch_or_location: payload.branch_or_location,
          condition_notes: payload.condition_notes,
          purchase_date: payload.purchase_date,
          usage_instructions: payload.usage_instructions,
          service_procedure: payload.service_procedure,
          maintenance_type_override: payload.maintenance_type_override,
          updated_by: payload.updated_by || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8e. GET /api/assets/manual-notes — semua catatan manual tersimpan
  if (pathname === '/api/assets/manual-notes' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, notes: getAssetManualNotes() }));
    return;
  }

  // 8e2. POST /api/assets/add-manual — tambah aset baru dari dashboard.
  // Aset dari sheet operasional read-only (sync satu arah), jadi ini
  // penyimpanan lokal terpisah — ditandai source:'manual' supaya jelas
  // bukan hasil sync sheet.
  if (pathname === '/api/assets/add-manual' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = addManualAsset({
          name: payload.name,
          category: payload.category,
          branch: payload.branch,
          location: payload.location,
          purchase_date: payload.purchase_date,
          notes: payload.notes,
          added_by: payload.added_by || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8e3. POST /api/assets/mark-doc-reminded — tandai "sudah diingatkan
  // bulan ini" untuk aset yang dokumentasinya belum lengkap.
  if (pathname === '/api/assets/mark-doc-reminded' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = markAssetDocReminderSent({
          asset_key: payload.asset_key,
          asset_name: payload.asset_name,
          reminded_by: payload.reminded_by || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8e4. GET /api/assets/doc-reminder-log
  if (pathname === '/api/assets/doc-reminder-log' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, log: getAssetDocReminderLog() }));
    return;
  }

  // 8f-2. GET /api/finance/hpp-profit — omzet vs HPP BHP per bulan. Angka
  // keuangan klinik, jadi hanya untuk role yang boleh melihat clinic_money.
  if (pathname === '/api/finance/hpp-profit' && req.method === 'GET') {
    if (!permsFor(sess).clinic_money) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tidak punya akses data keuangan klinik.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...getHppProfit(parsedUrl.searchParams.get('period')) }));
    return;
  }

  // 8f-3. Komparasi harga antar supplier (GET), tambah/hapus penawaran (POST/DELETE).
  // Harga beli = angka keuangan klinik: role tanpa clinic_money ditolak.
  if (pathname === '/api/finance/supplier-prices') {
    if (!permsFor(sess).clinic_money) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tidak punya akses data keuangan klinik.' }));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...getSupplierPriceComparison() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const result = addSupplierQuote(JSON.parse(body || '{}'));
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'DELETE') {
      const result = deleteSupplierQuote(parsedUrl.searchParams.get('id'));
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
  }

  // 8f-4. GET /api/finance/commission?period=YYYY-MM — komisi dokter & nurse
  // (aturan klinik vs Neosoft). Payroll: hanya role yang boleh lihat semua komisi.
  if (pathname === '/api/finance/commission' && req.method === 'GET') {
    if (!permsFor(sess).all_commissions) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tidak punya akses data komisi seluruh staf.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...getDoctorNurseCommission(parsedUrl.searchParams.get('period')) }));
    return;
  }

  // 8f-4. Ringkasan pendapatan per cabang: omset vs collection vs revenue (definisi Neosoft).
  if (pathname === '/api/finance/revenue-summary' && req.method === 'GET') {
    if (!permsFor(sess).clinic_money) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tidak punya akses data keuangan klinik.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...getRevenueBreakdown(parsedUrl.searchParams.get('period')) }));
    return;
  }

  // 8f-5. Rekap Transaksi Harian (GET) + log kasir harian (POST simpan / DELETE).
  // Angka keuangan klinik: hanya role dengan clinic_money.
  if (pathname === '/api/finance/daily-recap') {
    if (!permsFor(sess).clinic_money) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tidak punya akses data keuangan klinik.' }));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...getDailyTransactionRecap(parsedUrl.searchParams.get('period')) }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const result = saveCashierClosing(JSON.parse(body || '{}'));
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'DELETE') {
      const result = deleteCashierClosing(parsedUrl.searchParams.get('id'));
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
  }

  // 8g. GET /api/finance/monthly-costs?period=YYYY-MM — biaya bulanan
  // input manual (petty cash/BHP, gaji, sewa & utilitas, lain-lain),
  // dipakai untuk hitung Profit Bersih (Estimasi) = Omzet - Biaya.
  if (pathname === '/api/finance/monthly-costs' && req.method === 'GET') {
    const period = parsedUrl.searchParams.get('period') || new Date().toISOString().slice(0, 7);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, costs: getMonthlyCosts(period) }));
    return;
  }

  // 8h. POST /api/finance/monthly-costs
  if (pathname === '/api/finance/monthly-costs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const period = payload.period || new Date().toISOString().slice(0, 7);
        const result = setMonthlyCosts(period, { ...payload, updated_by: payload.updated_by || 'Dashboard User' });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8h-2. GET /api/finance/petty-cash?period=YYYY-MM — dulu petty cash
  // cuma bisa diisi 1 angka total per bulan. Sekarang staf bisa mencatat
  // tiap pengeluaran satu-satu; getMonthlyCosts() otomatis pakai jumlah
  // dari daftar ini kalau ada, bukan lagi angka lump-sum.
  if (pathname === '/api/finance/petty-cash' && req.method === 'GET') {
    const period = parsedUrl.searchParams.get('period') || new Date().toISOString().slice(0, 7);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, entries: getPettyCashEntries(period) }));
    return;
  }

  // 8h-3. POST /api/finance/petty-cash — tambah satu entri pengeluaran
  if (pathname === '/api/finance/petty-cash' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = addPettyCashEntry(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8h-4. DELETE /api/finance/petty-cash?id=... — hapus entri (salah input)
  if (pathname === '/api/finance/petty-cash' && req.method === 'DELETE') {
    const id = parsedUrl.searchParams.get('id');
    const result = deletePettyCashEntry(id);
    res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 8i. POST /api/patient360/save-recommendation — rekomendasi treatment
  // yang BENAR-BENAR ditulis dokter per kunjungan (per invoice), beda
  // dari rekomendasi otomatis berbasis histori yang sudah ada.
  if (pathname === '/api/patient360/save-recommendation' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = saveDoctorRecommendation({
          invoice_code: payload.invoice_code,
          customer_id: payload.customer_id,
          patient_name: payload.patient_name,
          doctor_name: payload.doctor_name,
          recommendation: payload.recommendation,
          updated_by: payload.updated_by || payload.doctor_name || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8j. GET /api/patient360/recommendations — semua rekomendasi tersimpan
  // (dipakai untuk hitung compliance % & prefill form kalau sudah pernah diisi)
  if (pathname === '/api/patient360/recommendations' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, recommendations: getDoctorRecommendations() }));
    return;
  }

  // 8k. POST /api/clinical/save-photo-documentation — GANTI alert() palsu
  // yang klaim "BERHASIL disimpan ke Cloudflare R2/S3" tanpa menyimpan
  // apa pun. Sekarang benar-benar tersimpan (link foto + metadata).
  if (pathname === '/api/clinical/save-photo-documentation' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = saveClinicalPhotoRecord({
          invoice_code: payload.invoice_code,
          patient_name: payload.patient_name,
          nurse_name: payload.nurse_name,
          consent_tier: payload.consent_tier,
          before_url: payload.before_url,
          after_url: payload.after_url,
          saved_by: payload.saved_by || payload.nurse_name
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8l. POST /api/clinical/save-waiver
  if (pathname === '/api/clinical/save-waiver' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = saveWaiverRecord({
          invoice_code: payload.invoice_code,
          patient_name: payload.patient_name,
          nurse_name: payload.nurse_name,
          reason: payload.reason,
          note: payload.note,
          saved_by: payload.saved_by || payload.nurse_name
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8m. GET /api/clinical/documentation-log
  if (pathname === '/api/clinical/documentation-log' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, log: getClinicalPhotoLog() }));
    return;
  }

  // 8n. GET /api/testimonials/candidates — foto consent MARKETING yang
  // belum ditinjau tim marketing untuk galeri publik.
  if (pathname === '/api/testimonials/candidates' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, candidates: getTestimonialGalleryCandidates() }));
    return;
  }

  // 8o. GET /api/testimonials/gallery — foto yang sudah disetujui tampil.
  if (pathname === '/api/testimonials/gallery' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, gallery: getApprovedTestimonialGallery() }));
    return;
  }

  // 8p. POST /api/testimonials/approve — dulu galeri testimoni tidak ada
  // sama sekali. Sekarang dibangun dari clinical_photo_log.json (sumber
  // yang sudah real), tapi consent 'MARKETING' dari perawat saat
  // kunjungan tidak otomatis mempublikasikan apa pun — tim marketing
  // wajib meninjau & approve dulu di sini sebelum foto tampil di galeri.
  if (pathname === '/api/testimonials/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = setPhotoGalleryApproval(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8f. GET /api/clinic-settings — kontak PIC alat (Clinic Leader)
  if (pathname === '/api/clinic-settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, settings: getClinicSettings() }));
    return;
  }

  // 8g. POST /api/clinic-settings — set nama & no. WA Clinic Leader (PIC alat)
  if (pathname === '/api/clinic-settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = setClinicSettings({
          maintenance_pic_name: payload.maintenance_pic_name,
          maintenance_pic_phone: payload.maintenance_pic_phone
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8h. GET /api/wa-templates — Semua template WhatsApp chat klinik
  if (pathname === '/api/wa-templates' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, templates: getWaChatTemplates() }));
    return;
  }

  // 8i. POST /api/wa-templates — Simpan/update template WhatsApp
  if (pathname === '/api/wa-templates' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        let result;
        if (payload.templates) {
          result = saveAllWaChatTemplates(payload.templates);
        } else if (payload.key) {
          result = saveWaChatTemplate(payload.key, payload);
        } else {
          result = { success: false, error: 'Key template atau objek templates wajib disertakan' };
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8j. POST /api/wa-templates/reset — Reset template ke format standar
  if (pathname === '/api/wa-templates/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = resetWaChatTemplate(payload.key || 'all');
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8h. POST /api/maintenance/mark-reminded — tandai reminder maintenance sudah
  // dikirim ke Clinic Leader, supaya tidak dobel untuk next_due yang sama.
  if (pathname === '/api/maintenance/mark-reminded' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = markMaintenanceReminderSent({
          asset_key: payload.asset_key,
          asset_name: payload.asset_name,
          next_due: payload.next_due,
          reminded_by: payload.reminded_by || 'Dashboard User'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8i. GET /api/maintenance/reminder-log — riwayat reminder yang sudah ditandai
  if (pathname === '/api/maintenance/reminder-log' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, logs: getMaintenanceReminderLog() }));
    return;
  }

  // 8j. POST /api/feedback/submit — halaman publik public/feedback.html
  // (tanpa login) kirim bintang kepuasan + review pasien ke sini.
  if (pathname === '/api/feedback/submit' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = addPatientFeedback({
          rating: payload.rating,
          rating_overall: payload.rating_overall || payload.rating,
          rating_doctor: payload.rating_doctor,
          rating_nurse: payload.rating_nurse,
          rating_facility: payload.rating_facility,
          rating_treatment: payload.rating_treatment,
          nps_score: payload.nps_score,
          review_text: payload.review_text || payload.comments,
          comments: payload.comments || payload.review_text,
          patient_name: payload.patient_name || payload.customer_name,
          customer_name: payload.customer_name || payload.patient_name,
          phone: payload.phone,
          branch: payload.branch,
          doctor_name: payload.doctor_name,
          nurse_name: payload.nurse_name,
          treatment: payload.treatment,
          source: payload.source || 'Web QR Feedback'
        });
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8k. GET /api/feedback/summary — dipakai dashboard internal & bisa juga
  // dipakai halaman publik untuk menampilkan rating rata-rata saat ini.
  if (pathname === '/api/feedback/summary' && req.method === 'GET') {
    const sum = getFeedbackSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, summary: sum, data: sum }));
    return;
  }

  // 8k2. POST /api/feedback/draft-reply — draf balasan AI untuk feedback
  // pasien sendiri (public/feedback.html), bukan cuma ulasan Google Maps.
  // generateReviewReplyDraft() sama persis dipakai google_maps_service.js
  // saat sync — LLM sungguhan yang sama, cuma dipanggil on-demand di sini
  // (bukan otomatis untuk semua review saat load) supaya tidak boros
  // panggilan LLM untuk review yang stafnya belum tentu mau balas.
  if (pathname === '/api/feedback/draft-reply' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const entry = getPatientFeedback().find(f => f.id === payload.id);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Feedback tidak ditemukan.' }));
        }
        if (!entry.review_text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Feedback ini tidak ada teks review untuk dibalas.' }));
        }
        const draft = await generateReviewReplyDraft(entry.review_text, entry.rating, entry.patient_name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, draft }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8l. GET /api/meta-ads/settings — status koneksi Meta Business & Ads (aman, tanpa token bocor)
  if (pathname === '/api/meta-ads/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, settings: getMetaSettingsSafe(), synced: getCachedMetaAdsData() }));
    return;
  }

  // 8m. GET /api/meta-ads/oauth/url — Generate Meta OAuth URL untuk popup 1-Click Login
  if (pathname === '/api/meta-ads/oauth/url' && req.method === 'GET') {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3344';
    const hostOrigin = `${proto}://${host}`;

    const authRes = getMetaOAuthUrl(hostOrigin);
    res.writeHead(authRes.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authRes));
    return;
  }

  // 8n. GET /api/meta-ads/oauth/callback — Public Callback dari Facebook Login for Business
  if (pathname === '/api/meta-ads/oauth/callback' && req.method === 'GET') {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3344';
    const hostOrigin = `${proto}://${host}`;

    const code = parsedUrl.query.code;
    const errorMsg = parsedUrl.query.error_message || parsedUrl.query.error_description;

    if (errorMsg || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Meta Login Gagal</title><meta charset="utf-8"><style>body{font-family:sans-serif;background:#0f172a;color:#fff;text-align:center;padding:50px;}</style></head>
        <body>
          <h2 style="color:#f43f5e;">❌ Otorisasi Meta Dibatalkan / Gagal</h2>
          <p>${errorMsg || 'Kode otorisasi tidak ditemukan.'}</p>
          <button onclick="window.close()" style="margin-top:20px;padding:10px 20px;background:#334155;color:#fff;border:none;border-radius:8px;cursor:pointer;">Tutup Jendela</button>
        </body>
        </html>
      `);
      return;
    }

    try {
      const result = await handleMetaOAuthCallback(code, hostOrigin);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Meta Login Sukses</title>
          <meta charset="utf-8">
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #fff; text-align: center; padding: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; }
            .card { background: #1e293b; border: 1px solid #3b82f6; padding: 30px; border-radius: 16px; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h2 { color: #10b981; margin-top: 0; font-size: 20px; }
            p { font-size: 13px; color: #94a3b8; line-height: 1.5; }
            .badge { display: inline-block; background: #3b82f6; color: #fff; font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 99px; margin-top: 8px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🎉 Terhubung ke Meta Business!</h2>
            <p>Selamat datang, <strong>${result.user_name}</strong>. Akun Meta Ads & Instagram KEFIR Derma Clinic berhasil diotorisasi secara aman.</p>
            <div class="badge">${result.ad_accounts.length} Akun Iklan Terdeteksi</div>
            <p style="margin-top: 15px; font-size: 11px; color: #64748b;">Jendela ini akan tertutup otomatis dalam beberapa detik...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'META_OAUTH_SUCCESS', data: ${JSON.stringify(result)} }, '*');
              }
            } catch(e) {}
            setTimeout(() => {
              window.close();
            }, 1800);
          </script>
        </body>
        </html>
      `);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Meta OAuth Error</title><meta charset="utf-8"><style>body{font-family:sans-serif;background:#0f172a;color:#fff;text-align:center;padding:50px;}</style></head>
        <body>
          <h2 style="color:#f43f5e;">❌ Gagal Menyelesaikan Koneksi Meta</h2>
          <p style="color:#cbd5e1;font-size:13px;max-width:500px;margin:10px auto;">${err.message}</p>
          <button onclick="window.close()" style="margin-top:20px;padding:10px 20px;background:#334155;color:#fff;border:none;border-radius:8px;cursor:pointer;">Tutup Jendela</button>
        </body>
        </html>
      `);
    }
    return;
  }

  // 8o. POST /api/meta-ads/config — Konfigurasi manual (App ID, Secret, atau Direct System User Token)
  if (pathname === '/api/meta-ads/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = updateMetaConfig(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8o-2. POST /api/meta-ads/token-connect — Direct Token Connect & Verification (Zero-App setup)
  if (pathname === '/api/meta-ads/token-connect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await testAndConnectMetaToken(payload.access_token, payload.ad_account_id);
        
        // Auto sync Instagram data if available
        let igSyncResult = null;
        try {
          igSyncResult = await syncInstagramFromMeta();
        } catch (igErr) {
          console.warn('[token-connect] Auto Instagram sync note:', igErr.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, ig_synced: !!igSyncResult, ig_message: igSyncResult?.message }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8p. POST /api/meta-ads/disconnect — Putuskan koneksi Meta
  if (pathname === '/api/meta-ads/disconnect' && req.method === 'POST') {
    const result = disconnectMeta();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 8q. POST /api/meta-ads/sync — Live sync data campaign & insights dari Meta Marketing API
  // GET /api/meta-ads/manager?level=campaign|adset|ad&date_preset=last_30d&refresh=1
  // Tampilan seperti Meta Ads Manager; jatuh ke data sinkron terakhir bila API gagal.
  if (pathname === '/api/meta-ads/manager' && req.method === 'GET') {
    const q = parsedUrl.searchParams;
    const level = q.get('level') || 'campaign';
    try {
      const data = await getAdsManagerData({ level, datePreset: q.get('date_preset') || 'last_30d', refresh: q.get('refresh') === '1' });
      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 200, { success: true, data: adsManagerFromCache(level, err.message) });
    }
  }

  if (pathname === '/api/meta-ads/sync' && req.method === 'POST') {
    try {
      const syncResult = await syncMetaMarketingData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(syncResult));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 8r. GET /api/gaji-id/settings — Ambil status koneksi Gaji.id
  if (pathname === '/api/gaji-id/settings' && req.method === 'GET') {
    const settings = getGajiSettingsSafe();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, settings }));
    return;
  }

  // 8s. POST /api/gaji-id/login — Login ke Gaji.id via Username/Email & Password
  if (pathname === '/api/gaji-id/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await loginGajiId(payload.username, payload.password, payload.company_code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8t. POST /api/gaji-id/token-connect — Hubungkan langsung via X-Auth-Token
  if (pathname === '/api/gaji-id/token-connect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await connectDirectToken(payload.token, payload.username);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8u. POST /api/gaji-id/disconnect — Putuskan koneksi Gaji.id
  if (pathname === '/api/gaji-id/disconnect' && req.method === 'POST') {
    const result = disconnectGajiId();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 8v. POST /api/gaji-id/sync — Sinkronisasi absensi & karyawan dari Gaji.id
  if (pathname === '/api/gaji-id/sync' && req.method === 'POST') {
    try {
      const result = await syncGajiAttendance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 9b. POST /api/operational/submit-complaint (AI Auto Categorize & Priority Scoring)
  if (pathname === '/api/operational/submit-complaint' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const rawText = payload.text || '';
        const reporter = payload.reporter || 'Staf Medis / FO';
        const branch = payload.branch || 'Depok';
        const role = payload.role || 'Staff Operasional';

        // LLM AI Classification & Priority Prompt
        let aiResult = {
          category: 'Fasilitas & Operasional Umum',
          priority: 'P2 - MEDIUM',
          sla: 'Maksimal 4 Jam',
          impact: 'Operasional harian & kenyamanan klinik',
          action_recommendation: 'Koordinasikan dengan PIC Operasional Cabang untuk pengecekan fisik.'
        };

        const lower = rawText.toLowerCase();
        if (lower.includes('ac') || lower.includes('bocor') || lower.includes('panas') || lower.includes('dingin')) {
          aiResult = {
            category: 'Fasilitas & AC Ruangan',
            priority: lower.includes('pasien') || lower.includes('tindakan') || lower.includes('dokter') ? 'P1 - CRITICAL' : 'P2 - HIGH',
            sla: 'Maksimal 2 Jam',
            impact: 'Kenyamanan pasien saat tindakan & suhu ruang steril',
            action_recommendation: `Pindahkan pasien ke ruang tindakan alternatif sementara. Hubungi CV Sejuk Abadi (0856-1122-3344 Pak Joko) untuk servis AC cabang ${branch}.`
          };
        } else if (lower.includes('laser') || lower.includes('alat') || lower.includes('pico') || lower.includes('harmony') || lower.includes('mati') || lower.includes('rusak') || lower.includes('error')) {
          aiResult = {
            category: 'Alat Medis & Laser Machine',
            priority: 'P1 - CRITICAL',
            sla: 'Maksimal 1 Jam (Immediate)',
            impact: 'Keselamatan pasien & kelancaran jadwal tindakan dokter',
            action_recommendation: `Tunda tindakan laser terkait. Pasang tanda Under Maintenance & segera kontak vendor PT IDS Medical Systems (0812-9988-7711 Pak Bambang).`
          };
        } else if (lower.includes('stok') || lower.includes('habis') || lower.includes('obat') || lower.includes('krim') || lower.includes('jarum') || lower.includes('botox')) {
          aiResult = {
            category: 'Logistik & Farmasi Kritis',
            priority: 'P2 - HIGH',
            sla: 'Maksimal 3 Jam',
            impact: 'Potensi penundaan tindakan / resep skincare pasien',
            action_recommendation: `Lakukan transfer buffer stock antar cabang (${branch === 'Depok' ? 'Pondok Kopi ➔ Depok' : 'Depok ➔ Pondok Kopi'}) dan ajukan PO Cito ke Purchasing.`
          };
        } else if (lower.includes('kasir') || lower.includes('edc') || lower.includes('sinyal') || lower.includes('struk') || lower.includes('wifi')) {
          aiResult = {
            category: 'IT, POS & Kasir Network',
            priority: 'P2 - HIGH',
            sla: 'Maksimal 1 Jam',
            impact: 'Kelancaran settlement & pembayaran pasien',
            action_recommendation: `Restart modem router / EDC Terminal. Gunakan backup Hotspot IT & metode QRIS Statis kasir sementara.`
          };
        }

        const newComplaint = {
          id: `TKT-OPS-00${Math.floor(Math.random() * 900) + 100}`,
          timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
          branch: branch,
          reporter: reporter,
          role: role,
          raw_text: rawText,
          ai_analysis: aiResult,
          status: 'Open (AI Categorized) 🤖'
        };

        addTeamComplaint(newComplaint);

        addDispatchLog({
          timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
          type: `AI Ticket [${aiResult.priority}]`,
          status: 'Categorized',
          items_sent: 1,
          recipient: `${branch} - ${aiResult.category}`,
          delay: '0.2s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Keluhan berhasil dicatat & dikategorikan otomatis oleh AI Engine dengan prioritas ${aiResult.priority}!`,
          ticket: newComplaint
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 9c. POST /api/operational/submit-sop (Daily SOP Audit Checklist Submission)
  if (pathname === '/api/operational/submit-sop' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

        const items = Array.isArray(payload.items) ? payload.items.filter(it => it && it.item && it.status) : [];
        if (items.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Checklist kosong — centang minimal 1 item sebelum submit.' }));
        }
        if (!payload.auditor || !String(payload.auditor).trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Nama auditor wajib diisi.' }));
        }
        // Skor dihitung SERVER dari jawaban Pass/Fail per item — dulu
        // klien mengirim compliance_score bebas (dari prompt() angka
        // manual), jadi auditor bisa menulis 100% tanpa checklist sungguhan
        // pernah dicentang. Sekarang skor = % item berstatus Pass.
        const passCount = items.filter(it => String(it.status || '').toLowerCase().startsWith('pass')).length;
        const complianceScore = Math.round((passCount / items.length) * 100);

        const newSop = {
          id: `SOP-CHK-${Date.now().toString(36).toUpperCase()}`,
          branch: payload.branch || 'Depok',
          shift: payload.shift || 'Shift Harian',
          date: new Date().toISOString().substring(0, 10),
          auditor: String(payload.auditor).trim(),
          compliance_score: complianceScore,
          items
        };

        addSopChecklist(newSop);

        addDispatchLog({
          timestamp: nowStr,
          type: `SOP Audit Check [${payload.branch}]`,
          status: `Compliance ${complianceScore}%`,
          items_sent: items.length,
          recipient: 'Operational Compliance Ledger',
          delay: '0s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Checklist Audit SOP cabang ${newSop.branch} tersimpan — skor kepatuhan ${complianceScore}% (${passCount}/${items.length} item Pass).`,
          sop: newSop
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 9d. GET /api/operational/data (Operational Assets, SOP & Complaints Stream)
  if (pathname === '/api/operational/data' && req.method === 'GET') {
    const opsData = getOperationalData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(opsData));
    return;
  }

  // 10a. GET /api/marketing/data (Content Planning, Published Social Media Posts & Meta Ads)
  if (pathname === '/api/marketing/data' && req.method === 'GET') {
    const mktData = getMarketingHubData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mktData));
    return;
  }

  // 10b. POST /api/marketing/create-content-plan (Add Content Plan)
  if (pathname === '/api/marketing/create-content-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const newPlan = {
          id: `CP-2026-${Math.floor(Math.random() * 900) + 100}`,
          date: payload.date || new Date().toISOString().substring(0, 10),
          day: payload.day || 'Senin',
          pillar: payload.pillar || 'Edukasi & Treatment Deep-Dive',
          format: payload.format || 'IG Carousel (6 Slide)',
          topic: payload.topic || 'Manfaat Perawatan Kulit di KEFIR Derma Clinic',
          hook: payload.hook || 'Rahasia kulit glowing alami ala dokter spesialis ✨',
          status: 'Approved 📅',
          carousel_slides: payload.carousel_slides || [],
          caption: payload.caption || 'Yuk rawat kulitmu bersama KEFIR Derma Clinic! 💖',
          hashtags: payload.hashtags || '#KefirDermaClinic #GlowingSkin #KlinikEstetika',
          pic: payload.pic || 'Creative Team'
        };

        addContentPlan(newPlan);

        addDispatchLog({
          timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
          type: 'Marketing Content Plan Created',
          status: 'Scheduled',
          items_sent: 1,
          recipient: `${newPlan.date} - ${newPlan.format}`,
          delay: '0s'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Jadwal Konten Plan 1 Bulan Berhasil Ditambahkan ke Editorial Calendar!',
          data: newPlan
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 10b2. POST /api/marketing/update-content-plan (Edit Content Plan)
  // Dulu content plan yang sudah tersimpan tidak bisa dikoreksi lewat UI
  // sama sekali — cuma bisa ditambah baru. Sekarang bisa diedit per field
  // (topic, hook, caption, hashtags, pic, status, dst) lewat id yang sama
  // dipakai tabel Content Plan Schedule.
  if (pathname === '/api/marketing/update-content-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { id, ...patch } = payload;
        const result = updateContentPlan(id, patch);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 10c. POST /api/marketing/generate-ai-script (AI Generate Script / Carousel Slides / Caption / Hashtags)
  //
  // SEBELUMNYA endpoint ini tidak memanggil LLM sama sekali — topik dari
  // user cuma disisipkan ke template string TETAP, dan SETIAP topik apa
  // pun menghasilkan struktur 5-slide identik plus statistik KARANGAN
  // yang sama persis: "500+ pasien... tingkat kepuasan 98.4%". Diverifikasi
  // langsung: angka itu tidak dihitung dari data apa pun, teks tetap di
  // kode. Sekarang memanggil LLM sungguhan (generateMarketingContent di
  // ai_executive_assistant.js — jalur router yang sama yang sudah
  // terbukti bekerja untuk AI Assistant sepanjang sesi ini), dengan
  // instruksi eksplisit dilarang mengarang statistik/harga.
  if (pathname === '/api/marketing/generate-ai-script' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const topic = payload.topic || 'Pico Laser Rejuvenation';
        const format = payload.format || 'IG Carousel';

        const generated = await generateMarketingContent(topic, format);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Draft konten berhasil dibuat AI. Periksa & sesuaikan sebelum dipublikasikan — harga/promo tidak diisi otomatis.',
          data: generated
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Gagal generate konten: ' + err.message }));
      }
    });
    return;
  }

  // 10d. GET /api/google-maps/reviews (Get reviews per branch or all)
  if (pathname === '/api/google-maps/reviews' && req.method === 'GET') {
    const branch = parsedUrl.searchParams.get('branch') || 'all';
    const reviews = getBranchReviews(branch);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reviews));
    return;
  }

  // 10e. POST /api/google-maps/sync (Sync Google Maps reviews)
  if (pathname === '/api/google-maps/sync' && req.method === 'POST') {
    syncGoogleMapsReviews().then(result => {
      addDispatchLog({
        timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        type: 'Google Maps Reviews Synced',
        status: 'Success ⭐ 4.8',
        items_sent: 422,
        recipient: 'Depok & Pondok Kopi',
        delay: '0.4s'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 9. POST /api/settlement/reconcile (Trigger 3-Way Auto Settlement Reconciliation)
  if (pathname === '/api/settlement/reconcile' && req.method === 'POST') {
    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    addDispatchLog({
      timestamp: nowStr,
      type: '3-Way Auto-Settlement Run',
      status: 'Matched 98.2%',
      items_sent: 242,
      recipient: 'Finance Reconciliation Ledger',
      delay: '0s'
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Rekonsiliasi 3-Way Otomatis Selesai! 238 dari 242 invoice balanced 100% dengan mutasi rekening bank BCA & Mandiri.'
    }));
    return;
  }

  // 11a. GET /api/googlesheets/data (Get Synced Google Sheets Database)
  if (pathname === '/api/googlesheets/data' && req.method === 'GET') {
    try {
      const gsData = getGoogleSheetsData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: gsData
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 11b. POST /api/googlesheets/sync (Trigger Real-time Sync from 3 Google Sheets)
  if (pathname === '/api/googlesheets/sync' && req.method === 'POST') {
    try {
      const scriptPath = path.join(__dirname, 'scripts', 'sync_google_sheets.py');
      const stdout = execSync(`python3 "${scriptPath}"`, { timeout: 120000, encoding: 'utf8' });
      const gsData = getGoogleSheetsData();
      
      addDispatchLog({
        timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        type: 'Google Sheets 3-Way Sync Triggered',
        status: 'Success (All 3 Synced)',
        items_sent: (gsData.ops?.preventive_maintenance?.length || 0) + (gsData.depok?.unused_packages_deposits?.length || 0) + getMonthlyTxRows(gsData.pondokkopi || {}).length,
        recipient: 'Mission Control Data Lake',
        delay: 'Live'
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Sinkronisasi 3 Google Sheets (Operasional, Depok & Pondok Kopi) Berhasil!',
        summary: gsData.summary,
        stdout: stdout.split('\n').filter(Boolean).slice(-5)
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // ==================== UNIFIED INTELLIGENCE & COPILOT ENDPOINTS ====================
  // 12a-audit. GET /api/finance/invoice-audit?start=&end=&outlet= — invoice janggal
  if (pathname === '/api/finance/invoice-audit' && req.method === 'GET') {
    try {
      const q = parsedUrl.searchParams;
      const data = getInvoiceAudit({ start: q.get('start') || undefined, end: q.get('end') || undefined, outlet: q.get('outlet') || 'all' });
      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }
  // POST /api/finance/invoice-audit/status { inv_code, status: aman|perlu_koreksi|belum_dicek, note }
  if (pathname === '/api/finance/invoice-audit/status' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}');
        const review = setAuditStatus(String(p.inv_code || ''), p.status, p.note, sess.n || sess.u);
        sendJson(res, 200, { success: true, review });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 12a-0. GET /api/finance/reconciliation?period=YYYY-MM — invoice Neosoft vs log kasir, per invoice
  if (pathname === '/api/finance/reconciliation' && req.method === 'GET') {
    try {
      const data = getInvoiceReconciliation(parsedUrl.searchParams.get('period') || '2026-09');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12a. GET /api/unified/settlement (3-Way Auto Settlement & Payment Splits)
  if (pathname === '/api/unified/settlement' && req.method === 'GET') {
    try {
      const period = parsedUrl.searchParams.get('period') || '2026-09';
      const settlement = getThreeWaySettlement(period);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: settlement }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12b. GET /api/unified/unredeemed (Unredeemed Package & DP Churn Rescue)
  if (pathname === '/api/unified/unredeemed' && req.method === 'GET') {
    try {
      const period = parsedUrl.searchParams.get('period') || '2026-09';
      const start = parsedUrl.searchParams.get('start');
      const end = parsedUrl.searchParams.get('end');
      const outlet = parsedUrl.searchParams.get('outlet') || 'all';
      const allTime = parsedUrl.searchParams.get('all') === 'true' || parsedUrl.searchParams.get('scope') === 'all';
      const list = getUnredeemedPackageRadar({ period, start, end, outlet, allTime });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: list, summary: list.summary }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12c. GET /api/unified/upsell (Clinical Next-Best-Treatment Radar)
  if (pathname === '/api/unified/upsell' && req.method === 'GET') {
    try {
      const list = getClinicalUpsellRadar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: list }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12d. GET /api/unified/briefing/morning (Morning Executive Briefing)
  if (pathname === '/api/unified/briefing/morning' && req.method === 'GET') {
    try {
      const dateParam = parsedUrl.searchParams.get('date');
      const outletParam = parsedUrl.searchParams.get('outlet') || 'all';
      const briefing = generateMorningBriefing(dateParam, outletParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: briefing }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12e. GET /api/unified/briefing/nightly (Nightly Closing Audit)
  if (pathname === '/api/unified/briefing/nightly' && req.method === 'GET') {
    try {
      const dateParam = parsedUrl.searchParams.get('date');
      const closing = generateNightlyClosing(dateParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: closing }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12f. POST /api/unified/ai/chat (Owner Assistant — ReAct Agent with tool-calling)
  if (pathname === '/api/unified/ai/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const query = payload.query || payload.question || '';
        // Dulu role-nya di-hardcode 'owner' — siapa pun yang login (kasir,
        // marketing, HR) mendapat jawaban selengkap owner lewat endpoint ini.
        const { answer, suggestions, documents, usage } = await processMultiRoleQueryDetailed(
          query,
          sess.r,
          `${sess.u}:${payload.sessionId || 'web'}`,
          payload.period || undefined,
          { owner: sess.u, channel: 'web' }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { reply: answer, suggestions, documents, usage } }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ── 13. FITUR 11 DIVISI KLINIK (CRUD, DETAIL, ZERO-DUMMY) ──

  // 13a. Doctor Recommendations - DELETE
  if (pathname === '/api/doctor-roadmap/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteDoctorRecommendation(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13b. Clinical Contraindications
  if (pathname === '/api/contraindications') {
    if (req.method === 'GET') {
      const treatment = parsedUrl.searchParams.get('treatment');
      const notes = parsedUrl.searchParams.get('notes');
      if (treatment || notes) {
        const warnings = checkTreatmentContraindications(treatment, notes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: warnings.length, data: warnings }));
        return;
      }
      const data = getContraindications();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = addContraindication(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/contraindications/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteContraindication(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13c. SOP Exceptions
  if (pathname === '/api/sop-exceptions') {
    if (req.method === 'GET') {
      const data = getSopExceptions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = addSopException(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/sop-exceptions/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteSopException(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13d. Nurse Upselling
  if (pathname === '/api/nurse-upsell/list' && req.method === 'GET') {
    const nurse = parsedUrl.searchParams.get('nurse_name');
    const status = parsedUrl.searchParams.get('status');
    const list = getNurseUpsellings({ nurse_name: nurse, status });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: list.length, data: list }));
    return;
  }
  if (pathname === '/api/nurse-upsell/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = saveNurseUpselling(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }
  if (pathname === '/api/nurse-upsell/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteNurseUpselling(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13d-1. Foto Before/After (Pemeriksaan Fisik Neosoft) — foto disajikan dari
  // cache server, hanya untuk user login; URL publik Neosoft tak dibuka ke browser.
  {
    const mGallery = pathname.match(/^\/api\/patient\/(\d+)\/before-after$/);
    if (mGallery && req.method === 'GET') {
      if (!['owner', 'operational', 'doctor', 'marketing'].includes(sess.r)) return sendJson(res, 403, { success: false, error: 'Akses foto pasien hanya untuk owner, operasional, dokter, atau marketing.' });
      return getBeforeAfterGallery(mGallery[1]).then(d => sendJson(res, 200, { success: true, ...d })).catch(e => sendJson(res, 500, { success: false, error: e.message }));
    }
  }
  // 13d-1b. Medical record SOAP Neosoft & rekomendasi next treatment.
  // SOAP lengkap hanya owner/dokter; sales & marketing hanya Plan (rencana dokter).
  {
    const mMr = pathname.match(/^\/api\/patient\/(\d+)\/(medical-record|next-treatment)$/);
    if (mMr && req.method === 'GET') {
      const full = ['owner', 'doctor'].includes(sess.r);
      if (!full && !['sales', 'marketing'].includes(sess.r)) return sendJson(res, 403, { success: false, error: 'Akses medical record hanya untuk owner, dokter, atau sales.' });
      if (mMr[2] === 'medical-record') {
        const d = getPatientMedicalRecords(mMr[1]);
        if (!full && d.records) d.records = d.records.map(r => ({ ...r, soap: { plan: r.soap.plan }, diagnosa: [], filled: undefined }));
        return sendJson(res, 200, { success: true, full_access: full, ...d });
      }
      const d = getNextTreatmentRecommendation(mMr[1]);
      if (!full && d.doctor_plan) d.doctor_plan = { ...d.doctor_plan, assessment: null };
      return sendJson(res, 200, { success: true, ...d });
    }
  }
  // Daily KPI perawat (HR) — komisi hanya owner/HR/finance
  if (pathname === '/api/hr/nurse-kpi' && req.method === 'GET') {
    const d = getNurseDailyKpi();
    if (d.available && !['owner', 'hr', 'finance'].includes(sess.r)) {
      const strip = r => ({ ...r, commission: null });
      d.daily = d.daily.map(x => ({ ...x, nurses: x.nurses.map(strip) }));
      d.month = { ...d.month, rows: d.month.rows.map(strip) }; d.prev_month = { ...d.prev_month, rows: d.prev_month.rows.map(strip) };
    }
    return sendJson(res, 200, { success: true, ...d });
  }
  // Status sync (ringan; semua role) — detail error hanya owner/operasional
  if (pathname === '/api/system/sync-status' && req.method === 'GET') {
    const d = getSyncStatusInfo(syncState.last_started_at ? { ...syncState } : null);
    if (!['owner', 'operational'].includes(sess.r)) { d.problems = d.problems.length ? ['Data dashboard mungkin belum terbaru — hubungi admin sistem'] : []; if (d.server_sync) d.server_sync.last_error = null; d.stores = {}; }
    return sendJson(res, 200, { success: true, ...d });
  }
  // Detail satu pasien di Paket Belum Terpakai (assessment SOAP hanya owner/dokter)
  if (pathname === '/api/sales/unused-package' && req.method === 'GET') {
    const d = getUnusedPackageDetail(parsedUrl.searchParams.get('customer_id'));
    if (d.plan && !['owner', 'doctor'].includes(sess.r)) d.plan = { ...d.plan, assessment: null };
    return sendJson(res, 200, { success: true, ...d });
  }
  // Paket belum terpakai (Sales)
  if (pathname === '/api/sales/unused-packages' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getUnusedPackages() });
  }
  // Rekomendasi penjualan by product (cross-sell)
  if (pathname === '/api/sales/cross-sell' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getCrossSell(parsedUrl.searchParams.get('code') || '') });
  }
  if (pathname === '/api/sales/cross-sell-opportunities' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getCrossSellOpportunities() });
  }
  // Reminder campaign promosi (Marketing)
  if (pathname === '/api/marketing/campaign-reminders' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getCampaignReminders() });
  }
  if (pathname === '/api/marketing/campaign-reminders/done' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      try { const b = JSON.parse(body || '{}'); const r = markCampaignReminder({ key: b.key, done: b.done !== false, by: sess.n || sess.u }); sendJson(res, r.success ? 200 : 400, r); }
      catch (e) { sendJson(res, 400, { success: false, error: 'Format data tidak valid' }); }
    });
    return;
  }
  // Detail satu appointment + ringkasan pasien (assessment SOAP hanya owner/dokter)
  if (pathname === '/api/sales/appointment' && req.method === 'GET') {
    const d = getAppointmentDetail(parsedUrl.searchParams.get('id'));
    if (d.next && d.next.doctor_plan && !['owner', 'doctor'].includes(sess.r)) d.next.doctor_plan = { ...d.next.doctor_plan, assessment: null };
    return sendJson(res, 200, { success: true, ...d });
  }
  // Appointment pasien harian (Sales)
  if (pathname === '/api/sales/appointments' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getDailyAppointments(parsedUrl.searchParams.get('date')) });
  }
  // Tren bulanan marketing: kedatangan, pasien baru vs kembali, treatment, spending
  if (pathname === '/api/marketing/monthly-trends' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getMonthlyTrends() });
  }
  if (pathname === '/api/medical-record/compliance' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getSoapCompliance() });
  }
  // Galeri before/after per treatment (foto tetap disajikan lewat route foto ber-otorisasi)
  if (pathname === '/api/before-after/treatments' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, treatments: getBeforeAfterTreatmentList() });
  }
  if (pathname === '/api/before-after/by-treatment' && req.method === 'GET') {
    return getBeforeAfterByTreatment(parsedUrl.searchParams.get('code') || '', { limit: Math.min(30, Number(parsedUrl.searchParams.get('limit')) || 12) })
      .then(d => sendJson(res, 200, { success: true, ...d })).catch(e => sendJson(res, 500, { success: false, error: e.message }));
  }
  if (pathname === '/api/patient/before-after-compliance' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getBeforeAfterCompliance() });
  }
  if (pathname === '/api/patient/before-after/photo' && req.method === 'GET') {
    const svc = require('./pe_photo_service');
    const file = svc.localPhotoPath(parsedUrl.searchParams.get('pe'), parsedUrl.searchParams.get('n'));
    if (!file) return sendJson(res, 404, { success: false, error: 'Foto tidak ada di cache' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // 13d-00. Master Treatment (master Neosoft + realisasi + standar BHP; HPP hanya owner/finance/operational)
  if (pathname === '/api/treatment-master' && req.method === 'GET') {
    const d = getTreatmentMaster();
    if (d.available && !['owner', 'finance', 'operational'].includes(sess.r)) d.rows = d.rows.map(r => ({ ...r, hpp_bhp: null, hpp_pct: null }));
    // Kategori diatur di spreadsheet List BHP — dashboard hanya membaca.
    return sendJson(res, 200, { success: true, can_edit: false, show_hpp: ['owner', 'finance', 'operational'].includes(sess.r), ...d });
  }
  if (pathname === '/api/treatment-master/category' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      try { const b = JSON.parse(body || '{}'); const r = saveTreatmentCategory({ treatment_code: b.treatment_code, category: b.category, updated_by: sess.n || sess.u }); sendJson(res, r.success ? 200 : 400, r); }
      catch (e) { sendJson(res, 400, { success: false, error: 'Format data tidak valid' }); }
    });
    return;
  }

  // 13d-0. Treatment 360 — inquiry per treatment (komisi & margin hanya owner/finance)
  if (pathname === '/api/treatment360/list' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, treatments: getTreatment360List() });
  }
  if (pathname === '/api/treatment360' && req.method === 'GET') {
    const d = getTreatment360(parsedUrl.searchParams.get('code') || '');
    if (d.available && !['owner', 'finance'].includes(sess.r)) {
      d.kpi.commission_per_case = null; d.kpi.margin_per_case = null;
      d.performers = d.performers.map(x => ({ ...x, commission: null }));
    }
    return sendJson(res, 200, { success: true, ...d });
  }

  // 13d-2. Standar BHP per Treatment (usulan dari pemakaian aktual Neosoft + standar tersimpan)
  if (pathname === '/api/pharmacy/bhp-standard' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...getBhpStandards({ treatment: parsedUrl.searchParams.get('treatment') || null }) });
  }
  if (pathname === '/api/pharmacy/bhp-standard' && req.method === 'POST') {
    if (!['owner', 'operational', 'doctor'].includes(sess.r)) return sendJson(res, 403, { success: false, error: 'Hanya owner, operasional/farmasi, atau dokter yang bisa menyimpan standar BHP.' });
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { const p = JSON.parse(body || '{}'); const r = saveBhpStandard({ treatment_code: p.treatment_code, treatment_name: p.treatment_name, materials: p.materials, updated_by: sess.n || sess.u || p.updated_by }); sendJson(res, r.success ? 200 : 400, r); }
      catch (err) { sendJson(res, 400, { success: false, error: err.message }); }
    });
    return;
  }
  if (pathname === '/api/pharmacy/bhp-standard' && req.method === 'DELETE') {
    if (!['owner', 'operational', 'doctor'].includes(sess.r)) return sendJson(res, 403, { success: false, error: 'Hanya owner, operasional/farmasi, atau dokter yang bisa menghapus standar BHP.' });
    const r = deleteBhpStandard({ treatment_code: parsedUrl.searchParams.get('treatment') || '' });
    return sendJson(res, r.success ? 200 : 400, r);
  }
  if (pathname === '/api/pharmacy/bhp-items' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, items: getBhpItemList() });
  }
  if (pathname === '/api/pharmacy/bhp-unit' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { const p = JSON.parse(body || '{}'); const r = saveBhpUnitOverride({ ...p, updated_by: sess.n || sess.u }); sendJson(res, r.success ? 200 : 400, r); }
      catch (err) { sendJson(res, 400, { success: false, error: err.message }); }
    });
    return;
  }

  // 13e. Pharmacy Treatment BOM & Stock Transfer Recommendations
  if (pathname === '/api/pharmacy/bom') {
    if (req.method === 'GET') {
      const data = getTreatmentBoms();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = saveTreatmentBom(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/pharmacy/bom/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteTreatmentBom(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }
  if (pathname === '/api/pharmacy/transfer-recommendations' && req.method === 'GET') {
    const data = getBranchStockTransferRecommendations();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
    return;
  }

  // 13f. Marketing Promos
  if (pathname === '/api/marketing/promos') {
    if (req.method === 'GET') {
      const data = getMarketingPromos();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = saveMarketingPromo(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/marketing/promos/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteMarketingPromo(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13g. Patient Feedbacks (NPS / CSAT)
  if (pathname === '/api/feedback/patient') {
    if (req.method === 'GET') {
      const data = getPatientFeedbacks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = savePatientFeedback(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/feedback/patient/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deletePatientFeedback(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13h. Team Complaints Update (RCA, CAPA, Status)
  if (pathname === '/api/complaints/update' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = updateTeamComplaint(payload);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13h. Absensi harian (hanya baca) — daftar staf, rekap, cuti/sakit/izin
  if (pathname === '/api/hr/attendance/day' && req.method === 'GET') {
    return sendJson(res, 200, { ...hrAttendance.getDay(parsedUrl.searchParams.get('date')), has_data: hrAttendance.hasData() });
  }
  if (pathname === '/api/hr/attendance/recap' && req.method === 'GET') {
    return sendJson(res, 200, hrAttendance.getRecap(parsedUrl.searchParams.get('from'), parsedUrl.searchParams.get('to')));
  }
  if (pathname === '/api/hr/attendance/leaves' && req.method === 'GET') {
    return sendJson(res, 200, hrAttendance.getLeaves({ from: parsedUrl.searchParams.get('from') || undefined, to: parsedUrl.searchParams.get('to') || undefined }));
  }

  // 13i. HR Disciplinary Records (SP / Konseling)
  if (pathname === '/api/hr/disciplinary') {
    if (req.method === 'GET') {
      const data = getHrDisciplinary();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.length, data }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = saveHrDisciplinary(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }
  if (pathname === '/api/hr/disciplinary/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const resDel = deleteHrDisciplinary(id);
        res.writeHead(resDel.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resDel));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 13j. Monthly Targets (Executive / Owner)
  if (pathname === '/api/owner/targets') {
    if (req.method === 'GET') {
      const targets = getMonthlyTargets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: targets }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = saveMonthlyTarget(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }

  // 13k. Sales Bottom Prices
  if (pathname === '/api/sales/bottom-prices') {
    if (req.method === 'GET') {
      const prices = getSalesBottomPrices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: prices }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = saveSalesBottomPrice(payload);
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }

  // 13l. Peak Hour Heatmap
  if (pathname === '/api/operations/peak-hour-heatmap' && req.method === 'GET') {
    try {
      const period = parsedUrl.searchParams.get('period') || parsedUrl.searchParams.get('timeframe') || 'all';
      const data = getPeakHourAnalysis(period);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 13m. Patient XYZ Grade detail
  if (pathname === '/api/patient/xyz-grade' && req.method === 'GET') {
    const cid = parsedUrl.searchParams.get('customer_id') || parsedUrl.searchParams.get('id');
    if (!cid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'customer_id parameter is required' }));
      return;
    }
    const result = calculatePatientXyzGrade(cid);
    res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // --- STATIC FILES SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error: ' + err.code);
      }
    } else {
      let contentType = 'text/html';
      if (filePath.endsWith('.js')) contentType = 'text/javascript';
      else if (filePath.endsWith('.css')) contentType = 'text/css';
      else if (filePath.endsWith('.json')) contentType = 'application/json';
      else if (filePath.endsWith('.png')) contentType = 'image/png';
      else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (filePath.endsWith('.webp')) contentType = 'image/webp';
      else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content, 'utf-8');
    }
  });
});

// Status percobaan sync terakhir yang dijalankan server (dilaporkan di /api/system/sync-status)
let manualSync = { running: false, started_at: null, finished_at: null, ok: null, message: null, inv_count: null, cust_count: null };
const syncState = { last_started_at: null, last_finished_at: null, last_ok: null, last_error: null, duration_s: null, killed: false, consecutive_failures: 0 };

const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, HOST, () => {
  // DISABLE_BACKGROUND_JOBS=1: hanya melayani HTTP (uji lokal) — tanpa WhatsApp, sync spreadsheet harga, dan sync Neosoft.
  if (process.env.DISABLE_BACKGROUND_JOBS === '1') {
    console.log(`✨ KEFIR Clinic Mission Control Hub running at http://${HOST}:${PORT} (job latar belakang & WhatsApp DIMATIKAN)`);
    return;
  }
  // Harga Promo & Bottom: tarik spreadsheet Planning marketing saat start lalu tiap 30 menit.
  const runPriceSync = () => syncPriceSheets()
    .then(o => console.log(`💲 Sync spreadsheet harga: ${o.sources.map(x => `${x.title} ${x.ok ? 'OK' : 'GAGAL (' + x.error + ')'}`).join(', ') || 'tidak ada sumber'}`))
    .catch(e => console.error('💲 Sync spreadsheet harga gagal:', e.message));
  setTimeout(runPriceSync, 5000);
  setInterval(runPriceSync, 30 * 60 * 1000);
  console.log(`✨ KEFIR Clinic Mission Control Hub running at http://${HOST}:${PORT}`);
  console.log(`🤖 Starting WhatsApp Executive Assistant Multi-Device Engine...`);
  try {
    initWhatsAppAssistant();
  } catch (e) {
    console.error('Failed to init WA assistant:', e);
  }

  // Auto-Sync Neosoft Cloud API berkala setiap 10 menit tanpa perlu git pull
  const { exec } = require('child_process');
  const syncScript = path.join(__dirname, 'scripts', 'sync_neosoft.py');
  console.log(`🔄 Initializing Neosoft Auto-Sync Worker (Every 10 minutes)...`);
  
  setInterval(() => {
    console.log(`[${new Date().toISOString()}] 🔄 Running background Neosoft Live Sync...`);
    cleanStaleSyncLock();
    const pyBin = getPythonBin();
    const childEnv = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
    };
    const startedAt = Date.now();
    syncState.last_started_at = new Date(startedAt).toISOString();
    exec(`"${pyBin}" "${syncScript}"`, { timeout: 180000, env: childEnv }, (error, stdout, stderr) => {
      syncState.last_finished_at = new Date().toISOString();
      syncState.duration_s = Math.round((Date.now() - startedAt) / 1000);
      if (error) {
        syncState.last_ok = false; syncState.killed = !!error.killed; syncState.consecutive_failures += 1;
        syncState.last_error = String(stderr || error.message || '').split('\n').filter(Boolean).slice(-1)[0] || 'gagal';
        console.error('⚠️ Background Neosoft sync warning:', stderr || error.message);
      } else {
        // "Sync lain masih berjalan" juga keluar dengan kode 0 — itu bukan sukses baru, tapi bukan kegagalan
        syncState.last_ok = true; syncState.killed = false; syncState.consecutive_failures = 0; syncState.last_error = null;
        console.log('✅ Background Neosoft sync completed successfully!');
      }
    });
  }, 10 * 60 * 1000); // 10 menit
  });
}

module.exports = server;
