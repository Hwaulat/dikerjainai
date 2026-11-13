/**
 * ABSENSI HARIAN — HANYA BACA
 *
 * Neosoft tidak punya data absensi dan Gaji.id belum terhubung, jadi modul ini hanya
 * MEMBACA data/hr_attendance.json (diisi oleh sumber absensi, bukan dari dashboard).
 * Daftar staf = master staf Neosoft (therapists.json, aktif). Format file:
 *   records[tanggal][staf] = { status, shift, clock_in, clock_out, note }
 *   leaves = [{ id, staff, type: cuti|sakit|izin, from, to, note }]
 *   settings = { shifts: {1:'09:30', 2:'11:30'}, tolerance_min }
 * Cuti/sakit/izin yang berentang tanggal otomatis berlaku di tiap hari dalam rentang
 * (kecuali hari itu diisi manual). Terlambat = jam masuk setelah jam mulai shift + toleransi.
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.HR_ATTENDANCE_FILE || path.join(__dirname, 'data', 'hr_attendance.json');
const THERAPISTS_FILE = process.env.HR_THERAPISTS_FILE || path.join(__dirname, 'data', 'neosoft_db', 'therapists.json');

const STATUSES = ['hadir', 'alpa', 'cuti', 'sakit', 'izin', 'libur'];   // nilai status yang dikenali
const LEAVE_TYPES = ['cuti', 'sakit', 'izin'];
const DEFAULT_SETTINGS = { shifts: { 1: '09:30', 2: '11:30' }, tolerance_min: 0 };
const NON_PERSON = new Set(['automasi', 'neosoft', 'none', 'ns training', '-', '']);

const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const dayNum = (s) => Math.round(new Date(s + 'T00:00:00Z').getTime() / 86400000);
const addDays = (s, n) => new Date((dayNum(s) + n) * 86400000).toISOString().slice(0, 10);
const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const pad = (t) => { const [h, m] = String(t).split(':'); return `${String(h).padStart(2, '0')}:${m}`; };

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const d = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
      return { records: d.records || {}, leaves: Array.isArray(d.leaves) ? d.leaves : [], settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
    }
  } catch (e) { console.error('[hr_attendance] gagal baca:', e.message); }
  return { records: {}, leaves: [], settings: { ...DEFAULT_SETTINGS } };
}
function roleOf(name) {
  if (/^dr\.?\s|^drg\.?\s/i.test(name)) return 'Dokter';
  if (/^(ns\.?|br\.?|sr\.?)\s/i.test(name)) return 'Perawat';
  if (/^btc\.?\s/i.test(name)) return 'Beautician';
  return 'Lainnya';
}

function getRoster() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(THERAPISTS_FILE, 'utf8')) || []; } catch (e) { list = []; }
  const names = list.filter(t => t.status_therapist === true).map(t => String(t.therapist_name || '').trim())
    .filter(n => !NON_PERSON.has(n.toLowerCase()));
  return [...new Set(names)].map(name => ({ name, role: roleOf(name) }))
    .sort((a, b) => ['Dokter', 'Perawat', 'Beautician', 'Lainnya'].indexOf(a.role) - ['Dokter', 'Perawat', 'Beautician', 'Lainnya'].indexOf(b.role) || a.name.localeCompare(b.name, 'id'));
}

// Status satu staf pada satu tanggal: entri manual > rentang cuti/sakit/izin > belum diisi
function resolveDay(db, date, staff) {
  const rec = (db.records[date] || {})[staff];
  if (rec) {
    const out = { status: rec.status, shift: rec.shift || 1, clock_in: rec.clock_in || null, clock_out: rec.clock_out || null, note: rec.note || '', source: 'manual', late_min: 0, late: false };
    if (rec.status === 'hadir' && rec.clock_in) {
      const start = db.settings.shifts[rec.shift || 1] || db.settings.shifts[1];
      const diff = minutes(rec.clock_in) - minutes(start) - (Number(db.settings.tolerance_min) || 0);
      if (diff > 0) { out.late = true; out.late_min = diff + (Number(db.settings.tolerance_min) || 0); }
    }
    if (LEAVE_TYPES.includes(rec.status)) out.leave = leaveInfo(db, date, staff, rec.status);
    return out;
  }
  const lv = db.leaves.find(l => l.staff === staff && l.from <= date && date <= l.to);
  if (lv) return { status: lv.type, shift: null, clock_in: null, clock_out: null, note: lv.note || '', source: 'rentang', late_min: 0, late: false, leave: leaveInfo(db, date, staff, lv.type, lv) };
  return { status: null, shift: 1, clock_in: null, clock_out: null, note: '', source: null, late_min: 0, late: false };
}
function leaveInfo(db, date, staff, type, lv) {
  const l = lv || db.leaves.find(x => x.staff === staff && x.type === type && x.from <= date && date <= x.to);
  if (!l) return { total_days: 1, day_no: 1, from: date, to: date };
  return { id: l.id, from: l.from, to: l.to, total_days: dayNum(l.to) - dayNum(l.from) + 1, day_no: dayNum(date) - dayNum(l.from) + 1 };
}

function emptySummary() { return { hadir: 0, terlambat: 0, late_total_min: 0, alpa: 0, cuti: 0, sakit: 0, izin: 0, libur: 0, belum_diisi: 0 }; }

function getDay(date) {
  date = isDate(date) ? date : todayWib();
  const db = load();
  const sum = emptySummary();
  const rows = getRoster().map(s => {
    const r = resolveDay(db, date, s.name);
    if (r.status === null) sum.belum_diisi++;
    else if (r.status === 'hadir') { sum.hadir++; if (r.late) { sum.terlambat++; sum.late_total_min += r.late_min; } }
    else sum[r.status]++;
    return { staff: s.name, role: s.role, ...r };
  });
  return { success: true, date, summary: sum, rows, shifts: db.settings.shifts, tolerance_min: db.settings.tolerance_min };
}

// Rekap per staf dalam rentang tanggal (default: siklus cut-off payroll 26 s/d 25)
function cutoffRange(today) {
  const [y, m, d] = today.split('-').map(Number);
  const startMonth = d >= 26 ? new Date(Date.UTC(y, m - 1, 26)) : new Date(Date.UTC(y, m - 2, 26));
  const from = startMonth.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + 1, 25)).toISOString().slice(0, 10);
  return { from, to: end };
}
function getRecap(from, to) {
  const today = todayWib();
  const def = cutoffRange(today);
  from = isDate(from) ? from : def.from;
  to = isDate(to) ? to : def.to;
  if (to < from) [from, to] = [to, from];
  if (dayNum(to) - dayNum(from) > 92) to = addDays(from, 92);
  const upTo = to < today ? to : today;   // hari yang belum lewat tidak dihitung "belum diisi"
  const db = load();
  const roster = getRoster();
  const rows = roster.map(s => {
    const x = { staff: s.name, role: s.role, ...emptySummary(), late_days: [], leaves: [] };
    for (let d = from; d <= upTo; d = addDays(d, 1)) {
      const r = resolveDay(db, d, s.name);
      if (r.status === null) x.belum_diisi++;
      else if (r.status === 'hadir') { x.hadir++; if (r.late) { x.terlambat++; x.late_total_min += r.late_min; x.late_days.push({ date: d, minutes: r.late_min, clock_in: r.clock_in }); } }
      else x[r.status]++;
    }
    x.leaves = db.leaves.filter(l => l.staff === s.name && l.to >= from && l.from <= to)
      .map(l => ({ id: l.id, type: l.type, from: l.from, to: l.to, days: dayNum(l.to) - dayNum(l.from) + 1, note: l.note || '' }));
    return x;
  });
  const total = emptySummary();
  rows.forEach(r => Object.keys(total).forEach(k => { total[k] += r[k]; }));
  return { success: true, from, to, counted_until: upTo, rows, total };
}

function getLeaves({ from, to } = {}) {
  const db = load();
  const today = todayWib();
  const list = db.leaves.filter(l => (!from || l.to >= from) && (!to || l.from <= to))
    .map(l => ({ ...l, days: dayNum(l.to) - dayNum(l.from) + 1, state: l.to < today ? 'selesai' : l.from > today ? 'akan datang' : 'sedang berjalan', role: roleOf(l.staff) }))
    .sort((a, b) => b.from.localeCompare(a.from));
  return { success: true, leaves: list };
}

// Ada data sama sekali? (dipakai tampilan untuk membedakan "kosong" dari "belum diisi")
function hasData() {
  const db = load();
  return Object.keys(db.records).length > 0 || db.leaves.length > 0;
}

module.exports = { getDay, getRecap, getLeaves, hasData, getRoster, cutoffRange, STATUSES, LEAVE_TYPES };
