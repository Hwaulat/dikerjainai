/**
 * Penanda jenis invoice Neosoft yang BUKAN transaksi penjualan.
 *
 * Invoice "migrasi sisa paket" (remarks "- migrasi sisa paket", semua
 * bertanggal 2026-07-01 00:00) adalah sisa paket pasien lama yang diinput
 * ulang ke Neosoft supaya bisa di-redeem. Nilainya tercatat sebagai total
 * invoice tetapi pembayarannya Rp 0 (dulu sudah dibayar di sistem lama).
 *
 * Karena itu invoice migrasi:
 *   • TIDAK dihitung sebagai omset / penjualan / kunjungan / jam ramai /
 *     pasien baru — pasiennya pasien lama, bukan akuisisi Juli 2026;
 *   • TETAP dipakai untuk detail invoice dan saldo paket pasien, dan
 *     pemakaiannya tetap masuk "revenue" (nilai treatment yang dipakai).
 */

const isMigrationInvoice = inv => !!inv && /migrasi/i.test(String(inv.remarks || ''));

/**
 * Aturan omset untuk deposit (keputusan owner, Nov 2026):
 *   • top-up deposit                      → MASUK omset (uang baru diterima) —
 *                                            top-up manual tidak berupa invoice,
 *                                            lihat depositTopups() di bawah;
 *   • pemakaian saldo deposit             → TIDAK masuk omset (uangnya sudah
 *                                            dihitung saat top-up);
 *   • pelunasan sisa tagihan di luar deposit (QRIS/transfer/cash/EDC/voucher)
 *                                         → MASUK omset.
 * Jadi omset per invoice = nilai invoice − bagian yang dibayar pakai DEPOSIT.
 * Bagian deposit dibaca dari payment_report.json (laporan pembayaran Neosoft,
 * bank_type 4 = "DEPOSIT").
 */
const invoiceTotal = inv => Number((inv && (inv.total_after_tax || inv.total)) || 0);

const isDepositPayment = p => !!p && (Number(p.bank_type) === 4 || /^deposit$/i.test(String(p.bank_name || '').trim()));

const _depositMapCache = new WeakMap();
// payment_report.json: { 'YYYY-MM': [{ inv_code, payment: [{ bank_name, bank_type, amount, info }] }] }
function depositPaidByInvoice(paymentReport) {
  if (!paymentReport || typeof paymentReport !== 'object') return new Map();
  const hit = _depositMapCache.get(paymentReport);
  if (hit) return hit;
  const map = new Map();
  const rows = Array.isArray(paymentReport) ? paymentReport : Object.values(paymentReport).flat();
  rows.forEach(r => {
    if (!r || !r.inv_code) return;
    (r.payment || []).forEach(p => {
      if (p.info === 'charge' || !isDepositPayment(p)) return;
      const amt = Number(p.amount) || 0;
      if (amt > 0) map.set(r.inv_code, (map.get(r.inv_code) || 0) + amt);
    });
  });
  _depositMapCache.set(paymentReport, map);
  return map;
}

// Nilai invoice yang dihitung sebagai omset (lihat aturan di atas).
function omsetAmount(inv, depositMap) {
  const total = invoiceTotal(inv);
  const dep = (depositMap && inv && inv.inv_code && depositMap.get(inv.inv_code)) || 0;
  return Math.max(0, total - dep);
}

/**
 * Top-up deposit yang BUKAN invoice. Di Neosoft kasir mengisi deposit lewat
 * menu Sales > Deposit ("MANUAL DEPOSIT"); hasilnya hanya muncul di laporan
 * Mutasi Deposit (report /sales/deposit → deposit_mutations.json), tidak di
 * invoices_all maupun Collection by Payment. (Invoice transtype "topup" — beli
 * credit voucher member atau top-up lewat invoice — sudah terhitung di omset
 * sebagai invoice.)
 *
 * Yang dihitung uang masuk / omset: MANUAL DEPOSIT dengan metode bayar nyata
 * (QRIS/EDC/transfer/tunai). Tidak dihitung:
 *   • MANUAL DEPOSIT tanpa metode bayar → saldo awal migrasi dari sistem lama;
 *   • metode "DEPOSIT" → pemindahan saldo internal, bukan uang baru;
 *   • yang dibatalkan (VOID MANUAL DEPOSIT pasangan: pasien, waktu & nominal sama);
 *   • yang uangnya SUDAH tercatat lewat invoice topup (pasien & nominal sama,
 *     selisih ≤ 3 hari) — kasir kadang membuat keduanya untuk satu pembayaran.
 *     Baris ini tetap dikembalikan dengan `via_invoice` terisi, tapi
 *     `counted` = false supaya tidak dihitung dua kali.
 * Tanggal "date" Neosoft berlabel Z tetapi sudah waktu lokal (WIB).
 */
const _isRealBank = b => { const n = String(b || '').trim(); return !!n && !/^deposit$/i.test(n); };
const _dayDiff = (a, b) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000;
const _topupCache = new WeakMap();
function depositTopups(mutations, invoices = []) {
  if (!Array.isArray(mutations)) return [];
  const byInv = _topupCache.get(mutations) || new WeakMap();
  _topupCache.set(mutations, byInv);
  const invKey = Array.isArray(invoices) ? invoices : [];
  const hit = byInv.get(invKey);
  if (hit) return hit;
  const topupInvoices = invKey.filter(i => i && i.transtype === 'topup' && !i.void_invoice);
  const usedInv = new Set();
  const voids = mutations.filter(m => m && /^void manual deposit$/i.test(String(m.description || '').trim()) && Number(m.deposit_out) > 0);
  const used = new Set();
  const out = [];
  mutations.forEach((m, idx) => {
    if (!m || !/^manual deposit$/i.test(String(m.description || '').trim())) return;
    const amount = Number(m.deposit_in) || 0;
    if (amount <= 0 || !_isRealBank(m.bank_name)) return;
    const v = voids.findIndex((x, vi) => !used.has(vi) && x.patient_id === m.patient_id && x.date === m.date && Number(x.deposit_out) === amount);
    if (v >= 0) { used.add(v); return; }
    const outletId = Number(m.outlet_id);
    const date = String(m.date || '').slice(0, 10);
    const twin = topupInvoices.find(i => !usedInv.has(i.inv_code) && i.customer_id === m.patient_id
      && Number(i.total_after_tax || i.total || 0) === amount && _dayDiff(String(i.inv_date || ''), date) <= 3);
    if (twin) usedInv.add(twin.inv_code);
    out.push({
      date, time: String(m.date || '').slice(11, 16),
      outlet_id: outletId, branch: outletId === 2 ? 'Pondok Kopi' : outletId === 1 ? 'Depok' : (m.outlet || '-'),
      amount, bank: m.bank_name, patient_id: m.patient_id, patient_code: m.patient_code || null, by: m.deposit_by || null,
      via_invoice: twin ? twin.inv_code : null, counted: !twin
    });
  });
  byInv.set(invKey, out);
  return out;
}

// Jumlahkan top-up deposit yang dihitung omset per kunci (mis. tanggal / bulan / cabang).
function sumTopups(topups, keyFn, filter = () => true) {
  const acc = {};
  topups.forEach(t => { if (!t.counted || !filter(t)) return; const k = keyFn(t); acc[k] = (acc[k] || 0) + t.amount; });
  return acc;
}

module.exports = { isMigrationInvoice, invoiceTotal, depositPaidByInvoice, omsetAmount, depositTopups, sumTopups };
