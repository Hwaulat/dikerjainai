#!/usr/bin/env node
/**
 * Deteksi PERPINDAHAN grade pasien (X / Y / Z / Baru / Belum transaksi).
 *
 * Grade dihitung ulang tiap saat dari data, jadi perubahannya tidak
 * meninggalkan jejak apa pun. Skrip ini menyimpan potret grade terakhir tiap
 * pasien lalu membandingkannya tiap kali dijalankan, sehingga perpindahan
 * bisa diberitahukan ke tim.
 *
 * Jalankan SETELAH sync (scripts/sync_neosoft.py), karena grade bergerak
 * mengikuti data baru maupun waktu yang berjalan.
 *
 * Sepenuhnya lokal — hanya membaca snapshot JSON dan menulis satu berkas
 * state. Tidak ada apa pun yang dikirim ke Neosoft.
 */
const fs = require('fs');
const path = require('path');
const { classifyPatientGrade, treatmentVisitDays } = require('../data_provider');

const ROOT = path.join(__dirname, '..');
const NEO = path.join(ROOT, 'data', 'neosoft_db');
const STATE = path.join(ROOT, 'data', 'patient_grade_state.json');
const MAX_TRANSITIONS = 500;

const read = (f) => { const j = JSON.parse(fs.readFileSync(path.join(NEO, f), 'utf8')); return Array.isArray(j) ? j : (j.data || j); };

// Urutan untuk menentukan arah perpindahan. Makin besar makin sering datang.
const RANK = { BELUM: 0, BARU: 1, Z: 2, Y: 3, X: 4 };

// Definisi kunjungan yang dipakai potret grade. Bila berubah, potret lama tidak
// sebanding — jalan berikutnya membuat garis dasar baru, bukan melaporkan
// ribuan "perpindahan" palsu.
const GRADE_DEFINITION = 'kunjungan_treatment_v1';

function currentGrades() {
  const customers = read('customers_all.json');

  const out = {};
  customers.forEach(c => {
    // Kunjungan = hari dikerjakan treatment (beli produk saja bukan kunjungan), sama dengan dashboard.
    const days = treatmentVisitDays(c.id);
    const g = classifyPatientGrade(days.length, days[0] || null);
    out[c.id] = {
      grade: g.grade,
      rate: g.rate_per_month,
      visit_days: days.length,
      last_visit: days[days.length - 1] || null,
      name: `${c.name?.first_name || ''} ${c.name?.last_name || ''}`.trim(),
      phone: c.phone || null
    };
  });
  return out;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch (e) { return null; }
}

function describe(from, to) {
  const df = (RANK[to] ?? 0) - (RANK[from] ?? 0);
  if (from === 'BELUM') return { kind: 'aktivasi', dir: 'naik', urgency: 'INFO',
    label: 'Mulai bertransaksi di Neosoft' };
  if (from === 'BARU') return { kind: 'pola_terbentuk', dir: 'naik', urgency: 'INFO',
    label: `Pola kunjungan terbentuk — masuk Grade ${to}` };
  // Pindah ke BARU/BELUM bukan penurunan frekuensi, melainkan hilangnya
  // keterukuran — biasanya karena invoice dibatalkan sehingga hari
  // kunjungan berkurang. Diperlakukan sebagai anomali data, bukan churn.
  if (to === 'BARU' || to === 'BELUM') return { kind: 'anomali', dir: 'lain', urgency: 'INFO',
    label: `Data kunjungan berkurang — grade ${from} tidak lagi terukur` };
  if (df < 0) return { kind: 'turun', dir: 'turun',
    urgency: from === 'X' ? 'TINGGI' : 'SEDANG',
    label: `Frekuensi menurun: Grade ${from} → ${to}` };
  if (df > 0) return { kind: 'naik', dir: 'naik', urgency: 'PELUANG',
    label: `Frekuensi meningkat: Grade ${from} → ${to}` };
  return null;
}

function run() {
  const now = new Date().toISOString();
  const current = currentGrades();
  const prev = loadState();

  if (!prev || prev.definition !== GRADE_DEFINITION) {
    // Jalan pertama: tetapkan garis dasar, jangan laporkan apa pun sebagai
    // "perpindahan" — belum ada pembanding.
    const patients = {};
    Object.entries(current).forEach(([id, v]) => { patients[id] = { ...v, since: now }; });
    // Riwayat perpindahan lama tetap disimpan (masih benar menurut definisinya saat itu).
    write({ generated_at: now, baseline_at: now, definition: GRADE_DEFINITION, patients, transitions: (prev && prev.transitions) || [] });
    return { baseline: true, patients: Object.keys(patients).length, transitions: 0 };
  }

  const patients = {};
  const fresh = [];
  Object.entries(current).forEach(([id, v]) => {
    const old = prev.patients[id];
    if (!old) { patients[id] = { ...v, since: now }; return; }
    if (old.grade === v.grade) { patients[id] = { ...v, since: old.since }; return; }
    const d = describe(old.grade, v.grade);
    patients[id] = { ...v, since: now };
    if (!d) return;
    fresh.push({
      customer_id: Number(id), name: v.name, phone: v.phone,
      from: old.grade, to: v.grade,
      from_rate: old.rate, to_rate: v.rate,
      visit_days: v.visit_days, last_visit: v.last_visit,
      held_since: old.since, detected_at: now,
      ...d
    });
  });

  const order = { TINGGI: 0, SEDANG: 1, PELUANG: 2, INFO: 3 };
  fresh.sort((a, b) => (order[a.urgency] - order[b.urgency]) || (b.visit_days - a.visit_days));

  const transitions = [...fresh, ...(prev.transitions || [])].slice(0, MAX_TRANSITIONS);
  write({ generated_at: now, baseline_at: prev.baseline_at || now, definition: GRADE_DEFINITION, patients, transitions });
  return { baseline: false, patients: Object.keys(patients).length, transitions: fresh.length, fresh };
}

function write(obj) {
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, STATE);
}

if (require.main === module) {
  const r = run();
  if (r.baseline) {
    console.log(`Garis dasar dibuat untuk ${r.patients.toLocaleString('id-ID')} pasien.`);
    console.log('Perpindahan grade akan terdeteksi mulai jalan berikutnya.');
  } else {
    console.log(`${r.patients.toLocaleString('id-ID')} pasien diperiksa — ${r.transitions} perpindahan baru.`);
    (r.fresh || []).slice(0, 15).forEach(t =>
      console.log(`  [${t.urgency}] ${t.name || t.customer_id} — ${t.label}`));
  }
}

module.exports = { run, currentGrades };
