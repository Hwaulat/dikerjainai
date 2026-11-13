#!/usr/bin/env node
/**
 * Bangun tabel pemetaan nomor RM (spreadsheet) -> customer_id (Neosoft).
 *
 * SEPENUHNYA LOKAL. Skrip ini hanya MEMBACA snapshot JSON dan menulis satu
 * berkas pemetaan di folder data. Tidak ada apa pun yang dikirim ke Neosoft.
 *
 * Nomor RM (mis. D-3694) hanya hidup di spreadsheet — Neosoft tidak
 * menyimpannya di field manapun. Tanpa jembatan ini, ~18 bulan riwayat
 * sebelum Mei 2026 tidak bisa dilekatkan ke pasien.
 *
 * Dua tingkat keyakinan, sengaja dipisah supaya tidak tercampur:
 *   PASTI     - baris yang memuat RM sekaligus kode invoice Neosoft, dan
 *               seluruh buktinya menunjuk ke satu pasien yang sama.
 *   NAMA_UNIK - nama dominan RM cocok PERSIS dan hanya ke satu pasien.
 *               Perlu ditinjau manusia sebelum dipercaya penuh.
 * Sisanya sengaja TIDAK ditebak dan dilaporkan sebagai pekerjaan manual.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NEO = path.join(ROOT, 'data', 'neosoft_db');
const GS = path.join(ROOT, 'data', 'google_sheets_db');
const OUT = path.join(ROOT, 'data', 'rm_patient_map.json');
const MANUAL = path.join(ROOT, 'data', 'rm_patient_map_manual.json');

const read = (p) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(j) ? j : (j.data || j); };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function build() {
  const history = read(path.join(GS, 'transactions_history.json'));
  const invoices = read(path.join(NEO, 'invoices_all.json'));
  const customers = read(path.join(NEO, 'customers_all.json'));

  const custOfInvoice = {};
  invoices.forEach(i => { if (i.inv_code) custOfInvoice[i.inv_code] = i.customer_id; });

  const custById = {};
  const byName = {};
  customers.forEach(c => {
    custById[c.id] = c;
    const n = norm(`${c.name?.first_name || ''} ${c.name?.last_name || ''}`);
    if (n) (byName[n] = byName[n] || []).push(c.id);
  });

  // Kumpulkan bukti per RM
  const rmEvidence = {};
  history.forEach(r => {
    if (!r.rm) return;
    const e = rmEvidence[r.rm] || (rmEvidence[r.rm] = { rows: 0, viaInvoice: {}, names: {}, periods: new Set() });
    e.rows++;
    if (r.period) e.periods.add(r.period);
    if (r.patient_name) { const n = norm(r.patient_name); e.names[n] = (e.names[n] || 0) + 1; }
    if (r.invoice) {
      const cid = custOfInvoice[r.invoice];
      if (cid) e.viaInvoice[cid] = (e.viaInvoice[cid] || 0) + 1;
    }
  });

  const entries = {}, conflicts = [], needsManual = [];

  Object.entries(rmEvidence).forEach(([rm, e]) => {
    const names = Object.entries(e.names).sort((a, b) => b[1] - a[1]);
    const topName = names.length ? names[0][0] : null;
    const invCands = Object.entries(e.viaInvoice).sort((a, b) => b[1] - a[1]);
    const base = {
      rm,
      rows: e.rows,
      periods: [...e.periods].sort(),
      patient_name: topName,
      name_variants: names.length > 1 ? names.map(([n, c]) => ({ name: n, count: c })) : undefined
    };

    // 1) Bukti invoice
    if (invCands.length === 1) {
      entries[rm] = { ...base, customer_id: Number(invCands[0][0]), confidence: 'PASTI',
        source: 'inv_code', evidence: invCands[0][1] };
      return;
    }
    if (invCands.length > 1) {
      // Bukti bertentangan — hampir selalu salah input di sheet (satu invoice
      // dengan dua RM berbeda). Ambil mayoritas HANYA bila dominasinya jelas.
      const [topId, topN] = invCands[0];
      const [, secondN] = invCands[1];
      const dominant = topN >= secondN * 3;
      conflicts.push({ ...base, candidates: invCands.map(([id, n]) => ({ customer_id: Number(id), hits: n, name: nameOf(custById, id) })), resolved: dominant });
      if (dominant) {
        entries[rm] = { ...base, customer_id: Number(topId), confidence: 'MAYORITAS',
          source: 'inv_code_mayoritas', evidence: topN };
      } else {
        needsManual.push({ ...base, reason: 'bukti invoice bertentangan tanpa mayoritas jelas' });
      }
      return;
    }

    // 2) Nama persis & unik
    const ids = topName ? (byName[topName] || []) : [];
    if (ids.length === 1) {
      entries[rm] = { ...base, customer_id: ids[0], confidence: 'NAMA_UNIK',
        source: 'nama_persis', evidence: names[0][1] };
    } else if (ids.length > 1) {
      needsManual.push({ ...base, reason: `nama cocok ke ${ids.length} pasien (ambigu)`, candidates: ids });
    } else {
      needsManual.push({ ...base, reason: 'nama tidak ditemukan di master pasien Neosoft' });
    }
  });

  // Override manual menang atas apa pun
  let manual = {};
  if (fs.existsSync(MANUAL)) {
    try {
      manual = JSON.parse(fs.readFileSync(MANUAL, 'utf8')).entries || {};
      Object.entries(manual).forEach(([rm, cid]) => {
        entries[rm] = { rm, customer_id: Number(cid), confidence: 'MANUAL', source: 'manual', evidence: null };
      });
    } catch (e) { console.error('rm_patient_map_manual.json tidak terbaca:', e.message); }
  }

  const tally = {};
  Object.values(entries).forEach(v => { tally[v.confidence] = (tally[v.confidence] || 0) + 1; });
  const attributed = history.filter(r => r.rm && entries[r.rm]).length;

  const out = {
    generated_at: new Date().toISOString(),
    note: 'Dibangun lokal dari snapshot JSON. Tidak ada data yang ditulis ke Neosoft. ' +
          'Edit data/rm_patient_map_manual.json untuk menimpa/melengkapi secara manual — berkas itu tidak pernah ditimpa skrip ini.',
    stats: {
      rm_total: Object.keys(rmEvidence).length,
      mapped: Object.keys(entries).length,
      by_confidence: tally,
      needs_manual: needsManual.length,
      conflicts: conflicts.length,
      history_rows: history.length,
      history_rows_with_rm: history.filter(r => r.rm).length,
      history_rows_attributed: attributed
    },
    entries,
    conflicts,
    needs_manual: needsManual.sort((a, b) => b.rows - a.rows)
  };

  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);
  return out;
}

function nameOf(custById, id) {
  const c = custById[id];
  return c ? `${c.name?.first_name || ''} ${c.name?.last_name || ''}`.trim() : '?';
}

if (require.main === module) {
  const r = build();
  const s = r.stats;
  console.log('=== TABEL PEMETAAN RM -> PASIEN ===');
  console.log('RM unik di spreadsheet :', s.rm_total.toLocaleString('id-ID'));
  console.log('terpetakan             :', s.mapped.toLocaleString('id-ID'));
  Object.entries(s.by_confidence).forEach(([k, v]) => console.log('   ' + k.padEnd(12) + String(v).padStart(6)));
  console.log('perlu kerja manual     :', s.needs_manual.toLocaleString('id-ID'));
  console.log('konflik bukti          :', s.conflicts.toLocaleString('id-ID'));
  console.log('baris riwayat ber-RM   :', s.history_rows_with_rm.toLocaleString('id-ID'));
  console.log('  -> terekat ke pasien :', s.history_rows_attributed.toLocaleString('id-ID'),
              `(${Math.round(s.history_rows_attributed / s.history_rows_with_rm * 100)}%)`);
  console.log('\ntersimpan di', OUT);
}

module.exports = { build };
