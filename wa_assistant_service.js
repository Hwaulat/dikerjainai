/**
 * KEFIR CLINIC — WHATSAPP MULTI-ROLE ASSISTANT CONNECTOR
 * Multi-device Baileys client yang otomatis mendeteksi peran staf dari nomor WhatsApp pengirim.
 */

let makeWASocket = null, useMultiFileAuthState = null, DisconnectReason = { loggedOut: 401 }, fetchLatestBaileysVersion = null, downloadMediaMessage = null;
let pino = () => ({ level: 'silent', info() { }, error() { }, warn() { }, debug() { } });
let QRCode = { toDataURL: async () => '' };

try {
  ({ default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys'));
} catch (e) {
  makeWASocket = null;
}
try { pino = require('pino'); } catch (e) { }
try { QRCode = require('qrcode'); } catch (e) { }
const path = require('path');
const fs = require('fs');
const { processMultiRoleQueryDetailed, processMultiRoleQuery, callLLM } = require('./ai_executive_assistant');
const paymentProof = require('./payment_proof');
const { loadDocument } = require('./document_service');

const AUTH_FOLDER = path.join(__dirname, 'wa_assistant_auth');
const WHITELIST_FILE = path.join(__dirname, 'data', 'wa_whitelist.json');
let currentQrBase64 = null;
let connectionStatus = 'Waiting for QR Scan';
let botUser = null;
let sock = null;

// ==================== PENGENDALI KONEKSI ====================
// Penyebab "connect–reconnect terus": setiap koneksi putus, init() membuat
// socket BARU tanpa mematikan socket lama & tanpa melepas listener-nya.
// Reset dari dashboard juga menjadwalkan init() dua kali (sekali dari
// reset, sekali dari event 'close' socket yang di-end). Begitu ada DUA
// socket dengan sesi yang sama, WhatsApp saling menendang (440
// connectionReplaced) → tiap yang ditendang membuat socket baru lagi →
// putus-sambung tiap beberapa detik tanpa henti.
//
// Sekarang: hanya satu socket hidup (generasi), event dari socket lama
// diabaikan, hanya satu jadwal reconnect, jeda naik bertahap, dan 440
// tidak dilawan terus-menerus.
let socketGen = 0;
let reconnectTimer = null;
let reconnectAttempts = 0;
let cachedBaileysVersion = null;
let lastDisconnect = null; // { code, reason, at }
const WA_LOG_FILE = path.join(__dirname, 'logs', 'wa-assistant.log');

const DISCONNECT_REASONS = {
  401: 'logged out (perangkat dikeluarkan dari HP)',
  403: 'forbidden',
  408: 'timeout / QR tidak di-scan',
  411: 'multi-device mismatch',
  428: 'koneksi ditutup',
  440: 'sesi digantikan koneksi lain',
  500: 'sesi rusak',
  503: 'layanan WhatsApp tidak tersedia',
  515: 'restart diminta WhatsApp (normal setelah scan)'
};

function waLog(line) {
  const msg = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}] ${line}`;
  console.log(msg);
  try {
    fs.mkdirSync(path.dirname(WA_LOG_FILE), { recursive: true });
    fs.appendFileSync(WA_LOG_FILE, msg + '\n');
  } catch (e) { /* log file opsional */ }
}

function scheduleReconnect(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; initWhatsAppAssistant(); }, delayMs);
}

// Matikan socket yang sedang hidup tanpa memicu reconnect dari event-nya.
function teardownSocket() {
  socketGen++; // event dari socket lama otomatis diabaikan
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) { }
    try { sock.end(undefined); } catch (e) { }
    sock = null;
  }
}

function clearAuthExceptLidMapping() {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) return;
    for (const f of fs.readdirSync(AUTH_FOLDER)) {
      if (!f.startsWith('lid-mapping')) {
        try { fs.unlinkSync(path.join(AUTH_FOLDER, f)); } catch (e) { }
      }
    }
  } catch (e) { }
}

// Multi-Role Whitelist Map
//
// SEBELUMNYA berisi 6 nomor "contoh" (6287880455887, 6281299887766, dst)
// yang ditulis tetap di kode — pola angka repetitif (2998-8776-6,
// 5556-6778-8, 9887-7665-5) jelas nomor placeholder, bukan staf sungguhan.
// Ini BUG KEAMANAN, bukan cuma data dummy biasa: begitu WA di-scan dan
// live, siapa pun yang kebetulan memegang nomor-nomor itu — orang asing
// yang tidak ada hubungannya dengan klinik — langsung dapat akses level
// OWNER/HR/marketing/sales/operational lewat WhatsApp tanpa didaftarkan
// siapa pun. Dikosongkan; Owner wajib mendaftarkan nomor staf sungguhan
// sendiri lewat dashboard sebelum WA bisa dipakai siapa pun.
//
// SEBELUMNYA juga hanya hidup di memori (variabel biasa) — restart
// server mengembalikannya ke 6 nomor contoh di atas, MENGHAPUS nomor
// staf asli yang sudah didaftarkan Owner tanpa peringatan apa pun.
// Sekarang disimpan ke data/wa_whitelist.json (gitignored — isinya
// nomor pribadi staf).
// Penyimpanan whitelist diperketat setelah daftar nomor staf pernah hilang
// tanpa jejak. Penyebab yang dicegah di sini:
//  • file gagal dibaca sesaat (mis. sedang ditulis proses lain) dianggap
//    KOSONG, lalu penyimpanan berikutnya menimpa seluruh daftar → sekarang
//    kalau file ada tapi tak terbaca, dipakai daftar terakhir yang valid
//    (memori, atau backup terbaru) dan penyimpanan ditunda.
//  • penulisan langsung ke file (bisa terbaca setengah jadi) → sekarang
//    tulis ke file sementara lalu rename (atomik).
//  • tidak ada salinan sebelumnya → sekarang setiap perubahan membackup
//    file lama ke data/wa_whitelist_backups/ (30 terakhir).
const WHITELIST_BACKUP_DIR = path.join(__dirname, 'data', 'wa_whitelist_backups');
let lastGoodWhitelist = null;
let whitelistReadFailed = false;

function readWhitelistFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('format whitelist tidak valid');
  return parsed;
}

function latestWhitelistBackup() {
  try {
    const files = fs.readdirSync(WHITELIST_BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try { return readWhitelistFile(path.join(WHITELIST_BACKUP_DIR, files[i])); } catch (e) { }
    }
  } catch (e) { }
  return null;
}

function loadWhitelist() {
  if (!fs.existsSync(WHITELIST_FILE)) {
    whitelistReadFailed = false;
    return lastGoodWhitelist ? JSON.parse(JSON.stringify(lastGoodWhitelist)) : (latestWhitelistBackup() || {});
  }
  try {
    const w = readWhitelistFile(WHITELIST_FILE);
    lastGoodWhitelist = JSON.parse(JSON.stringify(w));
    whitelistReadFailed = false;
    return w;
  } catch (e) {
    // Coba sekali lagi (kemungkinan file sedang ditulis), lalu jatuh ke cadangan.
    try {
      const w = readWhitelistFile(WHITELIST_FILE);
      lastGoodWhitelist = JSON.parse(JSON.stringify(w));
      whitelistReadFailed = false;
      return w;
    } catch (e2) {
      whitelistReadFailed = true;
      console.error('[WA Whitelist] wa_whitelist.json ada tapi tidak terbaca, pakai daftar terakhir yang valid:', e2.message);
      return lastGoodWhitelist ? JSON.parse(JSON.stringify(lastGoodWhitelist)) : (latestWhitelistBackup() || {});
    }
  }
}

function saveWhitelist() {
  try {
    if (whitelistReadFailed) {
      console.error('[WA Whitelist] Simpan DITUNDA: file whitelist sedang tidak terbaca — tidak menimpa agar data tidak hilang.');
      return false;
    }
    fs.mkdirSync(path.dirname(WHITELIST_FILE), { recursive: true });
    // Backup file lama (kalau ada & isinya valid) sebelum ditimpa.
    if (fs.existsSync(WHITELIST_FILE)) {
      try {
        readWhitelistFile(WHITELIST_FILE);
        fs.mkdirSync(WHITELIST_BACKUP_DIR, { recursive: true, mode: 0o700 });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(WHITELIST_FILE, path.join(WHITELIST_BACKUP_DIR, `wa_whitelist-${stamp}.json`));
        const old = fs.readdirSync(WHITELIST_BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
        old.slice(0, Math.max(0, old.length - 30)).forEach(f => { try { fs.unlinkSync(path.join(WHITELIST_BACKUP_DIR, f)); } catch (e) { } });
      } catch (e) { /* file lama rusak: jangan dibackup sebagai "valid" */ }
    }
    const tmp = WHITELIST_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(roleWhitelistMap, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, WHITELIST_FILE);
    lastGoodWhitelist = JSON.parse(JSON.stringify(roleWhitelistMap));
    return true;
  } catch (e) {
    console.error('[WA Whitelist] Gagal simpan wa_whitelist.json:', e.message);
    return false;
  }
}

let roleWhitelistMap = loadWhitelist();

// ==================== ROLE GANDA & GAMBAR ====================
function rolesOf(info) {
  const list = Array.isArray(info.roles) && info.roles.length ? info.roles : (info.role ? [info.role] : []);
  return [...new Set(list.map(r => String(r).toLowerCase()))];
}

// Hanya role kasir yang boleh mengirim gambar (khusus bukti pembayaran).
const PAYMENT_ROLES = ['kasir'];

// ==================== GRUP WHATSAPP ====================
// Bot hanya menjawab di grup yang DIDAFTARKAN Owner dari dashboard, dan
// hanya bila di-mention (@bot), pesan bot di-reply, atau pesan diawali
// "/kefir". Jawaban di grup terbaca SEMUA anggota grup, jadi level akses
// data ditentukan per GRUP (dipilih Owner), bukan dari role pengirim —
// mis. grup marketing diset role "marketing" sehingga data omset klinik
// tidak pernah muncul di sana walau yang bertanya adalah Owner.
// Pengirim tetap wajib terdaftar di whitelist; selain itu diabaikan diam-diam.
const GROUPS_FILE = path.join(__dirname, 'data', 'wa_groups.json');
const GROUP_ROLES = ['owner', 'finance', 'hr', 'marketing', 'sales', 'operational'];
const DEFAULT_GROUP_ROLE = 'operational';
let knownGroups = {}; // jid → { name, members } dari WhatsApp (grup tempat bot jadi anggota)

function loadGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return {};
    const g = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
  } catch (e) {
    console.error('[WA Grup] wa_groups.json tidak terbaca:', e.message);
    return {};
  }
}

function saveGroups(groups) {
  fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true });
  const tmp = GROUPS_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(groups, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, GROUPS_FILE);
}

function jidNum(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

// Nomor & LID bot sendiri (dipakai untuk mendeteksi mention / reply ke bot).
function botIdNums(thisSock) {
  const u = thisSock.user || {};
  return new Set([jidNum(u.id), jidNum(u.lid)].filter(Boolean));
}

function contextInfoOf(message) {
  const m = message || {};
  return m.extendedTextMessage?.contextInfo
    || m.imageMessage?.contextInfo
    || m.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
    || null;
}

const GROUP_PREFIX_RE = /^\s*\/kefir\b[\s,:]*/i;

// Apakah pesan grup ditujukan ke bot? Kembalikan teks pertanyaan yang sudah
// dibersihkan dari mention/prefix, atau null bila bukan untuk bot.
function extractGroupQuestion(message, text, thisSock) {
  const ids = botIdNums(thisSock);
  const ctx = contextInfoOf(message);
  const mentioned = (ctx?.mentionedJid || []).some(j => ids.has(jidNum(j)));
  const repliedToBot = !!(ctx?.stanzaId && ctx?.participant && ids.has(jidNum(ctx.participant)));
  const prefixed = GROUP_PREFIX_RE.test(text);
  if (!mentioned && !repliedToBot && !prefixed) return null;
  let q = text.replace(GROUP_PREFIX_RE, '');
  for (const n of ids) q = q.replace(new RegExp(`@${n}\\b`, 'g'), '');
  return q.replace(/\s+/g, ' ').trim();
}

async function groupName(thisSock, jid) {
  if (knownGroups[jid]?.name) return knownGroups[jid].name;
  try {
    const meta = await thisSock.groupMetadata(jid);
    knownGroups[jid] = { name: meta.subject, members: (meta.participants || []).length };
    return meta.subject;
  } catch (e) { return null; }
}

async function refreshKnownGroups(thisSock) {
  try {
    const all = await thisSock.groupFetchAllParticipating();
    const next = {};
    for (const [jid, g] of Object.entries(all || {})) next[jid] = { name: g.subject, members: (g.participants || []).length };
    knownGroups = next;
  } catch (e) {
    waLog(`⚠️ [WA] Gagal mengambil daftar grup: ${e.message}`);
  }
}

// Cari staf di whitelist dari nomor/LID pengirim.
function findStaff(senderNumber, isLid) {
  const realPhone = isLid ? (resolveLidToPhone(senderNumber) || senderNumber) : senderNumber;
  const normalizedPhone = normalizePhone(realPhone);
  const normalLocalPhone = formatNormalPhone(realPhone);
  for (const [phone, info] of Object.entries(roleWhitelistMap)) {
    const mappedLid = resolvePhoneToLid(phone);
    if (
      phone === senderNumber ||
      phone === realPhone ||
      normalizePhone(phone) === normalizedPhone ||
      formatNormalPhone(phone) === normalLocalPhone ||
      (mappedLid && (mappedLid === senderNumber || mappedLid === realPhone))
    ) {
      const roles = rolesOf(info);
      return { found: true, roles, role: roles.find(r => r !== 'kasir') || roles[0] || 'guest', name: info.name, normalizedPhone, normalLocalPhone };
    }
  }
  return { found: false, roles: [], role: 'guest', name: 'Tamu', normalizedPhone, normalLocalPhone };
}

async function sendAiAnswer(thisSock, jid, question, role, sessionId, owner, quoted) {
  try { await thisSock.sendPresenceUpdate('composing', jid); } catch (e) { }
  const { answer: replyText, documents } = await processMultiRoleQueryDetailed(question, role, sessionId, undefined, { owner });
  try { await thisSock.sendPresenceUpdate('paused', jid); } catch (e) { }
  await thisSock.sendMessage(jid, { text: markdownToWhatsApp(replyText) }, quoted ? { quoted } : undefined);
  // Dokumen Excel/PDF yang dibuat AI dikirim sebagai lampiran.
  for (const d of (documents || [])) {
    const doc = loadDocument(d.id);
    if (!doc) continue;
    try {
      await thisSock.sendMessage(jid, { document: doc.buffer, fileName: doc.meta.fileName, mimetype: doc.meta.mimetype });
    } catch (e) {
      waLog(`❌ [WA] Gagal mengirim dokumen ${d.fileName}: ${e.message}`);
    }
  }
}

async function handleGroupMessage({ thisSock, msg, groupJid, text, imgMsg }) {
  const question = extractGroupQuestion(msg.message, text, thisSock);
  if (question === null) return; // obrolan biasa di grup — bot diam

  // Pengirim di grup: key.participant (bisa @lid); participantAlt berisi nomor HP bila ada.
  const alt = msg.key.participantAlt || msg.key.participantPn || '';
  const senderJid = alt.endsWith('@s.whatsapp.net') ? alt : (msg.key.participant || alt);
  const isLid = String(senderJid).endsWith('@lid');
  const staff = findStaff(jidNum(senderJid), isLid);
  if (!staff.found) {
    console.log(`📩 [WA Grup] ${groupJid}: pengirim ${jidNum(senderJid)} tidak di whitelist — diabaikan.`);
    return;
  }

  const groups = loadGroups();
  const cfg = groups[groupJid];
  if (!cfg || cfg.enabled === false) {
    await thisSock.sendMessage(groupJid, { text: '🔒 Grup ini belum diaktifkan untuk KEFIR Assistant. Owner dapat mengaktifkannya di dashboard (AI Assistant → Grup WhatsApp).' }, { quoted: msg });
    return;
  }

  console.log(`📩 [WA Grup] ${cfg.name || groupJid} — ${staff.name}: ${imgMsg ? '[gambar] ' : ''}"${question}"`);

  if (imgMsg) {
    await thisSock.sendMessage(groupJid, { text: '🧾 Bukti pembayaran dikirim lewat chat pribadi ke nomor ini ya, bukan di grup.' }, { quoted: msg });
    return;
  }
  if (staff.roles.every(r => r === 'kasir')) {
    await thisSock.sendMessage(groupJid, { text: '🧾 Role *Kasir* hanya untuk mencatat bukti pembayaran lewat chat pribadi.' }, { quoted: msg });
    return;
  }
  if (!question) {
    await thisSock.sendMessage(groupJid, { text: `Halo ${staff.name} 👋 Silakan tulis pertanyaannya setelah mention saya.` }, { quoted: msg });
    return;
  }

  const role = GROUP_ROLES.includes(cfg.role) ? cfg.role : DEFAULT_GROUP_ROLE;
  // Riwayat percakapan dipisah per grup + per orang agar konteks tidak tercampur.
  await sendAiAnswer(thisSock, groupJid, question, role, `grp_${jidNum(groupJid)}_${staff.normalizedPhone}`, `wa:${staff.normalizedPhone}`, msg);
}

function listGroups() {
  const saved = loadGroups();
  const jids = new Set([...Object.keys(knownGroups), ...Object.keys(saved)]);
  return [...jids].map(jid => ({
    jid,
    name: knownGroups[jid]?.name || saved[jid]?.name || jid,
    members: knownGroups[jid]?.members ?? null,
    is_member: !!knownGroups[jid],
    enabled: !!saved[jid] && saved[jid].enabled !== false,
    role: saved[jid]?.role || DEFAULT_GROUP_ROLE
  })).sort((a, b) => (b.enabled - a.enabled) || String(a.name).localeCompare(String(b.name)));
}

async function getGroupList(refresh) {
  if (refresh && sock && connectionStatus === 'Connected') await refreshKnownGroups(sock);
  return { connected: connectionStatus === 'Connected', roles: GROUP_ROLES, groups: listGroups() };
}

function setGroupConfig(jid, { enabled, role }) {
  if (!/^[0-9-]+@g\.us$/.test(String(jid || ''))) throw new Error('ID grup tidak valid');
  if (role !== undefined && !GROUP_ROLES.includes(role)) throw new Error(`Level akses tidak dikenal: ${role}`);
  const groups = loadGroups();
  const prev = groups[jid] || {};
  groups[jid] = {
    name: knownGroups[jid]?.name || prev.name || jid,
    role: role || prev.role || DEFAULT_GROUP_ROLE,
    enabled: enabled === undefined ? (prev.enabled !== false) : !!enabled,
    updated_at: new Date().toISOString()
  };
  saveGroups(groups);
  waLog(`👥 [WA] Grup "${groups[jid].name}" ${groups[jid].enabled ? 'diaktifkan' : 'dinonaktifkan'} (akses: ${groups[jid].role}).`);
  return listGroups();
}

async function handleImageMessage({ thisSock, msg, remoteJid, assignedRoles, assignedRole, caption, staffName, normalizedPhone }) {
  // Gambar hanya untuk role Kasir, dan hanya bukti pembayaran.
  if (!assignedRoles.some(r => PAYMENT_ROLES.includes(r))) {
    await thisSock.sendMessage(remoteJid, { text: '🔒 Maaf, pengiriman gambar hanya untuk role *Kasir* (bukti pembayaran). Gambar Anda tidak diproses.' });
    return;
  }
  try { await thisSock.sendPresenceUpdate('composing', remoteJid); } catch (e) { }
  let buffer;
  try {
    buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: thisSock.updateMediaMessage });
  } catch (e) {
    waLog(`❌ [WA] Gagal unduh gambar: ${e.message}`);
    await thisSock.sendMessage(remoteJid, { text: '⚠️ Gambar tidak bisa diunduh, coba kirim ulang.' });
    return;
  }
  const mime = (msg.message.imageMessage || msg.message.ephemeralMessage?.message?.imageMessage || msg.message.viewOnceMessage?.message?.imageMessage)?.mimetype || 'image/jpeg';

  // Caption tidak dipakai sebagai pertanyaan — kasir hanya mengirim bukti pembayaran.
  const a = await paymentProof.analyzeImage(buffer, mime, '', false, callLLM,
    { user: `wa:${normalizedPhone}`, role: 'kasir', question: 'bukti pembayaran' });
  try { await thisSock.sendPresenceUpdate('paused', remoteJid); } catch (e) { }
  if (!a) {
    await thisSock.sendMessage(remoteJid, { text: '⚠️ AI belum bisa membaca gambar ini saat ini. Coba kirim ulang sebentar lagi.' });
    return;
  }
  if (a.tipe !== 'bukti_pembayaran') {
    await thisSock.sendMessage(remoteJid, { text: '🚫 Gambar ini bukan bukti pembayaran, jadi tidak diproses. Role Kasir hanya bisa mengirim bukti pembayaran (struk EDC, QRIS, transfer, kwitansi tunai).' });
    return;
  }
  const p = a.pembayaran || {};
  if (!p.nominal) {
    await thisSock.sendMessage(remoteJid, { text: '⚠️ Nominal pada bukti ini tidak terbaca. Mohon kirim ulang dengan foto yang lebih jelas dan tidak terpotong.' });
    return;
  }
  const branch = paymentProof.branchFromText(caption);
  const hash = paymentProof.hashBuffer(buffer);
  const it = paymentProof.addPending(normalizedPhone, { parsed: p, hash, branch, caption, senderName: staffName });
  const SRC = { edc: 'EDC', qris: 'QRIS', transfer: 'Transfer', tunai: 'Tunai', lainnya: 'Lainnya' };
  const lines = [
    `🧾 *Hasil analisa bukti pembayaran* (#${it.seq})`,
    '',
    `• Total: *${paymentProof.rp(p.nominal)}*`,
    `• Sumber: *${SRC[p.jenis] || p.jenis || '-'}*${p.bank ? ' — ' + p.bank : ''}`,
    `• Waktu: ${(p.tanggal || '-') + ' ' + (p.jam || '')}`.trim(),
    `• Referensi: ${p.referensi || '-'}`,
    p.pengirim ? `• Pengirim/Pemegang kartu: ${p.pengirim}` : null,
    p.penerima ? `• Penerima/Merchant: ${p.penerima}` : null,
    `• Cabang: ${branch || '-'}`,
    p.keyakinan === 'rendah' ? '\n⚠️ _Ada bagian yang kurang jelas, mohon cek teliti._' : null,
    '',
    branch
      ? 'Apakah data sudah benar? Balas *ya* untuk dicatat, atau *tidak* untuk membatalkan.'
      : 'Apakah data sudah benar? Balas *ya Depok* / *ya Pondok Kopi* untuk dicatat, atau *tidak* untuk membatalkan.'
  ].filter(x => x !== null);
  await thisSock.sendMessage(remoteJid, { text: lines.join('\n') });
}

// Balasan konfirmasi untuk bukti pembayaran yang menunggu: "ya", "ya depok", "ya 2", "tidak", "tidak 2".
async function handlePendingReply({ thisSock, remoteJid, text, normalizedPhone }) {
  const list = paymentProof.getPending(normalizedPhone);
  if (!list.length) return false;
  const m = text.trim().match(/^(ya|y|iya|ok|oke|simpan|masukkan|input|tidak|tdk|gak|ga|nggak|enggak|jangan|batal)(?:\s+(\d+))?(?:\s+(depok|pondok\s*kopi|pk))?$/i);
  if (!m) return false;
  const yes = /^(ya|y|iya|ok|oke|simpan|masukkan|input)$/i.test(m[1]);
  const seq = m[2] ? Number(m[2]) : null;
  const branchTxt = m[3] ? paymentProof.branchFromText(m[3]) : null;
  const targets = seq ? list.filter(x => x.seq === seq) : list;
  if (!targets.length) {
    await thisSock.sendMessage(remoteJid, { text: `⚠️ Tidak ada bukti #${seq} yang menunggu konfirmasi.` });
    return true;
  }
  if (!yes) {
    paymentProof.removePending(normalizedPhone, targets.map(x => x.seq));
    await thisSock.sendMessage(remoteJid, { text: `🗑️ Tidak dicatat (${targets.length} bukti dibuang). Silakan kirim ulang foto yang benar bila perlu.` });
    return true;
  }
  const out = [];
  const saved = [];
  for (const it of targets) {
    const branch = it.branch || branchTxt;
    if (!branch) { out.push(`❓ #${it.seq}: cabang belum jelas — balas *ya ${it.seq} Depok* atau *ya ${it.seq} Pondok Kopi*.`); continue; }
    const res = paymentProof.saveProof({ parsed: it.parsed, hash: it.hash, sender: normalizedPhone, senderName: it.senderName, branch, caption: it.caption });
    saved.push(it.seq);
    if (!res.duplicate) {
      const sh = await paymentProof.syncToSheet(res.record.id);
      res.record.sheet = sh.ok ? 'spreadsheet' : (sh.reason === 'belum_tersambung' ? 'lokal' : 'gagal');
    }
    if (res.duplicate) out.push(`♻️ #${it.seq}: sudah pernah dicatat (*${res.duplicate.id}*, ${paymentProof.rp(res.duplicate.nominal)}).`);
    else out.push(`✅ #${it.seq}: tercatat *${res.record.id}* — ${paymentProof.rp(res.record.nominal)} (${branch}) ${res.record.sheet === 'spreadsheet' ? '📊 masuk spreadsheet' : (res.record.sheet === 'gagal' ? '⚠️ tersimpan, tapi gagal ke spreadsheet (akan dicoba ulang)' : '⚠️ tersimpan, spreadsheet belum disambungkan')}. Salah? Balas *batal ${res.record.id}*.`);
  }
  paymentProof.removePending(normalizedPhone, saved);
  await thisSock.sendMessage(remoteJid, { text: out.join('\n') });
  paymentProof.retryUnsynced().catch(() => { }); // kirim ulang catatan lama yang belum masuk spreadsheet
  return true;
}

function resolveLidToPhone(lid) {
  if (!lid) return null;
  const clean = String(lid).replace(/[^0-9]/g, '');
  const reverseFile = path.join(AUTH_FOLDER, `lid-mapping-${clean}_reverse.json`);
  if (fs.existsSync(reverseFile)) {
    try {
      const phone = JSON.parse(fs.readFileSync(reverseFile, 'utf8'));
      if (phone) return String(phone).replace(/[^0-9]/g, '');
    } catch (e) { }
  }
  return null;
}

function resolvePhoneToLid(phone) {
  if (!phone) return null;
  const norm = normalizePhone(phone);
  const forwardFile = path.join(AUTH_FOLDER, `lid-mapping-${norm}.json`);
  if (fs.existsSync(forwardFile)) {
    try {
      const lid = JSON.parse(fs.readFileSync(forwardFile, 'utf8'));
      if (lid) return String(lid).replace(/[^0-9]/g, '');
    } catch (e) { }
  }
  return null;
}

function formatNormalPhone(phone) {
  let d = String(phone || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  // Jika ini LID (14-15 digit dan tidak diawali 62), cari nomor HP aslinya dari Baileys reverse map
  if (d.length >= 14 && !d.startsWith('62')) {
    const resolved = resolveLidToPhone(d);
    if (resolved) d = resolved;
  }
  // Normalisasi tampilan ke 08... jika berawalan 628
  if (d.startsWith('628')) {
    return '08' + d.slice(3);
  } else if (d.startsWith('62')) {
    return '0' + d.slice(2);
  }
  return d;
}

// Nomor Indonesia bisa ditulis staf dengan awalan 0 (081234567890) atau
// 62 (6281234567890); WhatsApp sendiri selalu mengirim JID dalam format
// 62... tanpa 0. Disamakan dulu ke satu bentuk baku sebelum dibandingkan.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.length >= 14 && !d.startsWith('62')) {
    const resolved = resolveLidToPhone(d);
    if (resolved) d = resolved;
  }
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (!d.startsWith('62') && d.startsWith('8')) d = '62' + d;
  return d;
}

// Jawaban AI ditulis dalam Markdown (sama dengan dashboard), sedangkan
// WhatsApp punya format sendiri: *tebal*, _miring_, ~coret~. Tanpa
// konversi, "**Rp 10 juta**" tampil dengan bintang ganda di WA.
function markdownToWhatsApp(text) {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')          // **tebal** → *tebal*
    .replace(/__(.+?)__/g, '*$1*')                  // __tebal__ → *tebal*
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')          // # Judul → *Judul*
    .replace(/^(\s*)[*-]\s+/gm, '$1• ')            // * butir / - butir → • butir
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)') // [teks](url) → teks (url)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function initWhatsAppAssistant() {
  if (!makeWASocket || !useMultiFileAuthState) {
    connectionStatus = 'Preview Mode (WA Disabled)';
    return;
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  teardownSocket();
  const myGen = socketGen;
  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    // Versi WA Web cukup diambil sekali per proses — dulu setiap reconnect
    // memanggil GitHub lagi.
    if (!cachedBaileysVersion) {
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
      cachedBaileysVersion = version;
    }
    const version = cachedBaileysVersion;
    if (myGen !== socketGen) return; // sudah ada init lain yang lebih baru

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '120.0.0']
    });

    const thisSock = sock;
    thisSock.ev.on('creds.update', saveCreds);

    thisSock.ev.on('connection.update', async (update) => {
      if (myGen !== socketGen) return; // event dari socket lama — abaikan
      const { connection, lastDisconnect: ld, qr } = update;

      if (qr) {
        try {
          currentQrBase64 = await QRCode.toDataURL(qr, { scale: 6, margin: 2 });
          connectionStatus = 'Waiting for QR Scan';
          console.log('📱 [KEFIR WA Assistant] QR Code baru siap di-scan dari Web Dashboard.');
        } catch (err) {
          console.error('QR Error:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = ld?.error?.output?.statusCode;
        const reason = DISCONNECT_REASONS[statusCode] || (ld?.error?.message || 'tidak diketahui');
        lastDisconnect = { code: statusCode || null, reason, at: new Date().toISOString() };
        currentQrBase64 = null;
        botUser = null;
        reconnectAttempts++;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
          // Perangkat dikeluarkan dari HP → sesi tidak berlaku, minta scan ulang
          waLog(`❌ [WA] Terputus ${statusCode} (${reason}). Sesi dihapus, menunggu scan QR baru.`);
          connectionStatus = 'Waiting for QR Scan';
          teardownSocket();
          clearAuthExceptLidMapping();
          reconnectAttempts = 0;
          scheduleReconnect(2000);
        } else if (statusCode === 440) {
          // Ada koneksi lain yang memakai sesi ini (server kedua / salinan
          // folder sesi). Melawan terus hanya membuat keduanya saling tendang.
          const delay = Math.min(300000, 60000 * reconnectAttempts);
          waLog(`⚠️ [WA] Terputus 440 (${reason}). Coba lagi dalam ${Math.round(delay / 1000)} dtk. Pastikan tidak ada server/perangkat lain yang memakai folder wa_assistant_auth yang sama.`);
          connectionStatus = 'Sesi dipakai koneksi lain — menunggu';
          scheduleReconnect(delay);
        } else {
          // 515 setelah scan QR itu normal → langsung sambung ulang; sisanya
          // pakai jeda yang naik bertahap (3s, 6s, 12s ... maks 60s)
          const delay = statusCode === 515 ? 1000 : Math.min(60000, 3000 * Math.pow(2, Math.max(0, reconnectAttempts - 1)));
          waLog(`❌ [WA] Terputus ${statusCode ?? '-'} (${reason}). Sambung ulang dalam ${Math.round(delay / 1000)} dtk (percobaan ${reconnectAttempts}).`);
          connectionStatus = 'Reconnecting...';
          scheduleReconnect(delay);
        }
      } else if (connection === 'open') {
        connectionStatus = 'Connected';
        currentQrBase64 = null;
        botUser = thisSock.user;
        reconnectAttempts = 0;
        refreshKnownGroups(thisSock).catch(() => { });
        waLog(`✅ [WA] Terhubung sebagai ${String(thisSock.user?.id || '').split(':')[0].replace(/\d{4}$/, '****')}`);
      }
    });

    thisSock.ev.on('messages.upsert', async (m) => {
      if (myGen !== socketGen) return;
      try {
        const msg = m.messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) return;

        const imgMsg = msg.message.imageMessage
          || msg.message.ephemeralMessage?.message?.imageMessage
          || msg.message.viewOnceMessage?.message?.imageMessage;
        const messageContent = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.ephemeralMessage?.message?.conversation ||
          msg.message.ephemeralMessage?.message?.extendedTextMessage?.text ||
          imgMsg?.caption || '';

        if (!messageContent.trim() && !imgMsg) return;

        if (remoteJid.endsWith('@g.us')) {
          roleWhitelistMap = loadWhitelist();
          await handleGroupMessage({ thisSock, msg, groupJid: remoteJid, text: messageContent, imgMsg });
          return;
        }

        const isLid = remoteJid.endsWith('@lid');
        const senderNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/[^0-9]/g, '');

        console.log(`📩 [WA Masuk] Dari ${senderNumber} (${isLid ? 'WhatsApp LID' : 'Phone JID'}): ${imgMsg ? '[gambar] ' : ''}"${messageContent}"`);

        // Selalu reload fresh whitelist agar nomor/LID baru langsung aktif tanpa restart
        roleWhitelistMap = loadWhitelist();

        let assignedRole = 'guest';
        let assignedRoles = [];
        let staffName = 'Tamu';

        const realPhone = isLid ? (resolveLidToPhone(senderNumber) || senderNumber) : senderNumber;
        const normalizedPhone = normalizePhone(realPhone);
        const normalLocalPhone = formatNormalPhone(realPhone);

        for (const [phone, info] of Object.entries(roleWhitelistMap)) {
          const normKey = normalizePhone(phone);
          const localKey = formatNormalPhone(phone);
          const mappedLid = resolvePhoneToLid(phone);

          if (
            phone === senderNumber ||
            phone === realPhone ||
            normKey === normalizedPhone ||
            localKey === normalLocalPhone ||
            (mappedLid && (mappedLid === senderNumber || mappedLid === realPhone))
          ) {
            assignedRoles = rolesOf(info);
            assignedRole = assignedRoles.find(r => r !== 'kasir') || assignedRoles[0] || 'guest';
            staffName = info.name;
            break;
          }
        }

        if (assignedRole === 'guest') {
          const displayPhone = normalLocalPhone || (isLid ? `WhatsApp LID: ${senderNumber}` : `+${senderNumber}`);
          await thisSock.sendMessage(remoteJid, {
            text: `🔒 *AKSES DITOLAK — KEFIR CLINIC ASSISTANT*\n\nMaaf Bapak/Ibu, nomor Anda (*${displayPhone}*) belum terdaftar di Whitelist Sistem KEFIR Derma Clinic.\n\nSilakan hubungi Administrator/Direksi untuk mendaftarkan nomor WhatsApp Anda ke role divisi yang sesuai.`
          });
          return;
        }

        // Batalkan catatan bukti pembayaran: "batal BP0001"
        const cancelM = messageContent.trim().match(/^batal\s+(bp\d+)$/i);
        if (cancelM && !imgMsg) {
          const r = paymentProof.voidProof(cancelM[1], normalizedPhone);
          await thisSock.sendMessage(remoteJid, { text: r.error ? `⚠️ ${r.error}.` : `✅ Bukti ${r.record.id} dibatalkan.` });
          if (!r.error) paymentProof.syncToSheet(r.record.id, 'BATAL').catch(() => { });
          return;
        }

        if (!imgMsg && await handlePendingReply({ thisSock, remoteJid, text: messageContent, normalizedPhone })) return;

        if (imgMsg) {
          await handleImageMessage({ thisSock, msg, remoteJid, caption: messageContent, assignedRoles, assignedRole, staffName, normalizedPhone });
          return;
        }

        // Role kasir saja: hanya boleh kirim bukti pembayaran, bukan tanya data.
        if (assignedRoles.length && assignedRoles.every(r => r === 'kasir')) {
          await thisSock.sendMessage(remoteJid, { text: '🧾 Role *Kasir* dipakai untuk mencatat bukti pembayaran.\n\nKirim foto bukti pembayaran (tambahkan caption *Depok* / *Pondok Kopi* bila perlu), lalu konfirmasi hasil analisanya.' });
          return;
        }

        // sessionId dipakai memisahkan riwayat percakapan per pengirim —
        // nomor WA / LID ternormalisasi yang stabil per orang.
        // Status "sedang mengetik..." selama AI menganalisis (bisa 15-45 dtk)
        await sendAiAnswer(thisSock, remoteJid, messageContent, assignedRole, normalizedPhone, `wa:${normalizedPhone}`);
      } catch (err) {
        console.error('Error handling WA message:', err);
      }
    });

  } catch (err) {
    waLog(`❌ [WA] Gagal inisialisasi: ${err.message}. Coba lagi dalam 10 dtk.`);
    connectionStatus = 'Reconnecting...';
    scheduleReconnect(10000);
  }
}

// --- Kirim pesan keluar sungguhan (dipakai untuk WhatsApp CRM Blast) ---
// Dulu "Launch Targeted Blast" & "WhatsApp Broadcast Console" cuma
// menulis 1 baris log dan mengaku "diantrikan ke gateway" — tidak ada
// gateway apa pun. sock (koneksi Baileys) yang sama dipakai AI Assistant
// untuk membalas staf di sini dipakai ulang untuk BENAR-BENAR mengirim
// pesan blast ke pasien, bukan cuma AI Assistant.
async function sendWhatsAppMessage(phone, text) {
  if (!sock || connectionStatus !== 'Connected') {
    return { success: false, error: 'WhatsApp belum terhubung. Buka tab AI Assistant Owner dan scan QR dulu.' };
  }
  const jid = normalizePhone(phone) + '@s.whatsapp.net';
  try {
    await sock.sendMessage(jid, { text });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function isWhatsAppConnected() {
  return !!sock && connectionStatus === 'Connected';
}

function getAssistantStatus() {
  const displayWhitelist = {};
  for (const [phone, info] of Object.entries(roleWhitelistMap)) {
    const normal = formatNormalPhone(phone);
    displayWhitelist[normal] = {
      ...info,
      display_phone: normal
    };
  }

  let connNumber = botUser ? botUser.id.split(':')[0] : null;
  if (connNumber) {
    connNumber = formatNormalPhone(connNumber);
  }

  return {
    status: connectionStatus,
    last_disconnect: lastDisconnect,
    reconnect_attempts: reconnectAttempts,
    qr_code_image: currentQrBase64,
    connected_number: connNumber,
    whitelist_map: displayWhitelist
  };
}

function removeRoleNumber(phone) {
  roleWhitelistMap = loadWhitelist(); // selalu mulai dari isi file terbaru, bukan memori yang mungkin basi
  const normal = formatNormalPhone(phone);
  const normalized = normalizePhone(phone);
  const rawClean = String(phone || '').replace(/[^0-9]/g, '');

  for (const k of [phone, normal, normalized, rawClean]) {
    if (k && roleWhitelistMap[k]) {
      delete roleWhitelistMap[k];
      if (!saveWhitelist()) throw new Error('Whitelist belum bisa disimpan (file sedang tidak terbaca). Perubahan dibatalkan, coba lagi sebentar lagi.');
      break;
    }
  }
  return roleWhitelistMap;
}

function addRoleNumber(phone, role, name) {
  roleWhitelistMap = loadWhitelist(); // selalu mulai dari isi file terbaru, bukan memori yang mungkin basi
  const normal = formatNormalPhone(phone) || normalizePhone(phone);
  if (normal) {
    const existing = roleWhitelistMap[normal];
    // Array = set ulang seluruh peran; string = tambahkan ke peran yang sudah ada.
    const incoming = (Array.isArray(role) ? role : [role]).map(x => String(x).toLowerCase());
    const roles = Array.isArray(role) || !existing ? [...new Set(incoming)] : [...new Set([...rolesOf(existing), ...incoming])];
    roleWhitelistMap[normal] = {
      name: name || existing?.name || `Staf ${roles[0].toUpperCase()}`,
      role: roles.find(x => x !== 'kasir') || roles[0],
      roles
    };
    if (!saveWhitelist()) throw new Error('Whitelist belum bisa disimpan (file sedang tidak terbaca). Perubahan dibatalkan, coba lagi sebentar lagi.');
  }
  return roleWhitelistMap;
}

function resetWhatsAppSession() {
  currentQrBase64 = null;
  botUser = null;
  connectionStatus = 'Waiting for QR Scan';
  reconnectAttempts = 0;
  try {
    teardownSocket(); // listener dilepas dulu → end() tidak memicu reconnect kedua
    clearAuthExceptLidMapping();
  } catch (e) {
    console.error('Error resetting WA session:', e);
  }
  waLog('🔄 [WA] Sesi di-reset dari dashboard, membuat QR baru.');
  scheduleReconnect(1000);
  return { success: true, message: 'Session reset. Generating new QR Code...' };
}

module.exports = {
  initWhatsAppAssistant,
  markdownToWhatsApp,
  getAssistantStatus,
  addOwnerNumber: (p) => addRoleNumber(p, 'owner', 'Owner KEFIR'),
  addRoleNumber,
  removeRoleNumber,
  sendWhatsAppMessage,
  isWhatsAppConnected,
  resetWhatsAppSession,
  getGroupList,
  setGroupConfig,
  // diekspor untuk pengujian
  _extractGroupQuestion: extractGroupQuestion
};
