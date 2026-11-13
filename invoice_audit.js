/**
 * KEFIR CLINIC — Audit Invoice.
 *
 * Mencari invoice yang janggal dari data Neosoft supaya dicek manusia
 * (Owner / Finance). Hasilnya TANDA untuk diperiksa, bukan tuduhan: tiap
 * tanda membawa alasan yang bisa diverifikasi (nomor invoice pembanding,
 * selisih menit, harga bottom, dst).
 *
 * Status pemeriksaan ("aman" / "perlu_koreksi" + catatan) disimpan di
 * data/invoice_audit_status.json.
 */

const fs = require('fs');
const path = require('path');

const NEOSOFT_DIR = path.join(__dirname, 'data', 'neosoft_db');
const STATUS_FILE = path.join(__dirname, 'data', 'invoice_audit_status.json');

const SEVERITY_RANK = { tinggi: 3, sedang: 2, rendah: 1, info: 0 };
const TYPE_LABELS = {
  duplikat: 'Kemungkinan dobel',
  void: 'Void',
  backdate: 'Dicatat belakangan',
  bawah_bottom: 'Di bawah harga bottom',
  diskon_besar: 'Diskon besar',
  belum_lunas: 'Belum lunas',
  tanpa_item: 'Tanpa item'
};

// Ambang pemeriksaan — sengaja ditulis di satu tempat supaya mudah disetel.
const RULES = {
  voidHighValue: 1000000,     // void >= Rp1 jt → tinggi
  repeatedVoidsPerStaff: 3,   // >= 3 void oleh staf yang sama dalam periode
  duplicateWindowMinutes: 180,
  bigDiscountPct: 50,
  unpaidOldDays: 14
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const amountOf = inv => Number(inv.total_after_tax || inv.total || 0);
const dayOf = inv => String(inv.inv_date || inv.created_at || '').slice(0, 10);
// inv_date memakai jam lokal (WIB) walau berlabel Z; created_at benar-benar UTC.
const localMinutes = inv => {
  const t = Date.parse(String(inv.inv_date || '').replace('Z', ''));
  return Number.isFinite(t) ? t / 60000 : null;
};
const recordedDay = inv => {
  const t = Date.parse(inv.created_at || '');
  return Number.isFinite(t) ? new Date(t + 7 * 3600000).toISOString().slice(0, 10) : null;
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function loadStatus() {
  return readJson(STATUS_FILE, {});
}

function setAuditStatus(invCode, status, note, user) {
  if (!invCode) throw new Error('Nomor invoice wajib diisi');
  if (!['aman', 'perlu_koreksi', 'belum_dicek'].includes(status)) throw new Error('Status tidak dikenal');
  const all = loadStatus();
  if (status === 'belum_dicek') delete all[invCode];
  else all[invCode] = { status, note: String(note || '').slice(0, 500), by: user || null, at: new Date().toISOString() };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(all, null, 2));
  return all[invCode] || null;
}

function outletMatches(inv, outlet) {
  const id = Number(inv.outlet_id);
  if (id !== 1 && id !== 2) return false;
  const o = String(outlet || 'all').toLowerCase();
  if (o === 'all' || o === '') return true;
  if (o.includes('depok') || o === 'dpk' || o === 'kdc') return id === 1;
  if (o.includes('pondok') || o === 'pdk') return id === 2;
  return true;
}

/**
 * @param {object} opts { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', outlet: 'all'|'depok'|'pondok_kopi' }
 */
function getInvoiceAudit(opts = {}) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = opts.start || `${ymd(today).slice(0, 7)}-01`;
  const end = opts.end || ymd(today);

  const invoices = readJson(path.join(NEOSOFT_DIR, 'invoices_all.json'), []);
  const usages = readJson(path.join(NEOSOFT_DIR, 'usages_details.json'), []);
  const customers = readJson(path.join(NEOSOFT_DIR, 'customers_all.json'), []);
  const therapists = readJson(path.join(NEOSOFT_DIR, 'therapists.json'), []);
  const users = readJson(path.join(NEOSOFT_DIR, 'user_access.json'), []);
  const products = readJson(path.join(NEOSOFT_DIR, 'products.json'), []);
  const priceMaster = readJson(path.join(__dirname, 'data', 'price_master.json'), {});
  const statusStore = loadStatus();

  const custName = {};
  customers.forEach(c => { custName[c.id] = c.name ? `${c.name.first_name || ''} ${c.name.last_name || ''}`.trim() : (c.customer_name || ''); });
  // doctor_id → master terapis/dokter; staff_id → akun user Neosoft (CS/kasir
  // yang membuat invoice). Dua master ini BERBEDA — memetakan staff_id ke
  // master terapis membuat void kasir tampil seolah dibuat dokter.
  const doctorName = {};
  therapists.forEach(t => {
    const n = String(t.therapist_name || '').trim();
    doctorName[t.id] = (!n || ['NONE', 'ADMIN'].includes(n.toUpperCase())) ? '-' : n;
  });
  const staffName = {};
  users.forEach(u => {
    const div = u.role && u.role.divisi ? ` (${u.role.divisi})` : '';
    staffName[u.id] = `${u.name || u.username || 'user ' + u.id}${div}`;
  });
  const productName = {};
  products.forEach(p => { productName[p.id] = p.product_treatment_name || p.name; });
  const bottomByProduct = {};
  (priceMaster.items || []).forEach(it => {
    if (it.product_id && Number(it.bottom_price) > 0) {
      const perSession = [it.pkg3_per_session, it.pkg6_per_session].map(Number).filter(n => n > 0);
      bottomByProduct[it.product_id] = { key: it.key, bottom: Number(it.bottom_price), minPackage: perSession.length ? Math.min(...perSession) : null, name: it.name };
    }
  });
  // Harga promo campaign resmi (memo marketing) yang berlaku di tanggal invoice
  // dianggap harga sah, jadi tidak ditandai walau di bawah bottom.
  const campaigns = priceMaster.campaigns || [];
  const promoFloor = (key, day) => {
    const prices = [];
    campaigns.forEach(c => {
      if (c.start && c.end && (day < c.start || day > c.end)) return;
      (c.items || []).forEach(ci => { if (ci.item_key === key && Number(ci.promo) > 0) prices.push({ price: Number(ci.promo), name: c.name }); });
    });
    return prices.sort((a, b) => a.price - b.price)[0] || null;
  };
  const usagesByInv = {};
  usages.forEach(u => { (usagesByInv[u.inv_code] = usagesByInv[u.inv_code] || []).push(u); });

  const inRange = invoices.filter(inv => {
    const d = dayOf(inv);
    return d >= start && d <= end && outletMatches(inv, opts.outlet);
  });

  const flagsByCode = {};
  const addFlag = (inv, type, severity, reason) => {
    const code = inv.inv_code || `INV-${inv.id}`;
    (flagsByCode[code] = flagsByCode[code] || { inv, flags: [] }).flags.push({ type, label: TYPE_LABELS[type], severity, reason });
  };

  // 1. Kemungkinan dobel: pasien, tanggal, dan nominal sama, berdekatan waktunya
  const groups = {};
  inRange.filter(i => !i.void_invoice && amountOf(i) > 0 && i.customer_id).forEach(i => {
    const k = `${i.customer_id}|${dayOf(i)}|${amountOf(i)}`;
    (groups[k] = groups[k] || []).push(i);
  });
  Object.values(groups).filter(g => g.length > 1).forEach(g => {
    g.forEach(inv => {
      const others = g.filter(o => o !== inv).map(o => {
        const a = localMinutes(inv), b = localMinutes(o);
        const gap = (a !== null && b !== null) ? Math.abs(Math.round(a - b)) : null;
        return { code: o.inv_code, gap };
      }).filter(o => o.gap === null || o.gap <= RULES.duplicateWindowMinutes);
      if (!others.length) return;
      const o = others[0];
      addFlag(inv, 'duplikat', 'tinggi',
        `Pasien, tanggal, dan nominal (${rp(amountOf(inv))}) sama dengan ${o.code}${o.gap !== null ? `, selisih ${o.gap} menit` : ''}.`);
    });
  });

  // 2. Void
  const voids = inRange.filter(i => i.void_invoice);
  const voidsByStaff = {};
  voids.forEach(v => { voidsByStaff[v.staff_id] = (voidsByStaff[v.staff_id] || 0) + 1; });
  voids.forEach(v => {
    const who = staffName[v.staff_id] || 'staf tidak diketahui';
    const repeat = voidsByStaff[v.staff_id] >= RULES.repeatedVoidsPerStaff ? ` ${who} tercatat ${voidsByStaff[v.staff_id]} void pada periode ini.` : '';
    const severity = amountOf(v) >= RULES.voidHighValue ? 'tinggi' : (repeat ? 'sedang' : 'rendah');
    addFlag(v, 'void', severity, `Invoice dibatalkan senilai ${rp(amountOf(v))}, dibuat oleh ${who}.${repeat}`);
  });

  inRange.filter(i => !i.void_invoice).forEach(inv => {
    // 3. Dicatat belakangan
    const rec = recordedDay(inv);
    const d = dayOf(inv);
    if (rec && d && rec !== d) {
      const gap = daysBetween(d, rec);
      addFlag(inv, 'backdate', Math.abs(gap) >= 3 ? 'sedang' : 'rendah',
        `Tanggal invoice ${d}, tetapi baru dicatat di sistem ${rec} (${gap > 0 ? `${gap} hari kemudian` : `${-gap} hari sebelumnya`}).`);
    }

    // 4. Di bawah harga bottom (harga paket per sesi dianggap wajar)
    (usagesByInv[inv.inv_code] || []).forEach(u => {
      const rule = bottomByProduct[u.product_id];
      const price = Number(u.value || 0);
      if (!rule || price <= 0 || price >= rule.bottom) return;
      if (rule.minPackage && price >= rule.minPackage) return;
      const promo = promoFloor(rule.key, d);
      if (promo && price >= promo.price) return;
      addFlag(inv, 'bawah_bottom', 'sedang',
        `${productName[u.product_id] || rule.name} dijual ${rp(price)}, di bawah harga bottom ${rp(rule.bottom)}` +
        (promo ? ` dan harga promo ${promo.name} ${rp(promo.price)}.` : '.') +
        ' Bisa jadi harga paket yang dibagi per sesi — cek bila bukan.');
    });

    // 5. Diskon besar (diskon dicatat terhadap harga kotor)
    const disc = Number(inv.discount || 0);
    const gross = amountOf(inv) + disc;
    if (disc > 0 && gross > 0) {
      const pct = Math.round(disc / gross * 100);
      if (pct >= RULES.bigDiscountPct) {
        addFlag(inv, 'diskon_besar', pct >= 75 ? 'sedang' : 'rendah', `Diskon ${pct}% (${rp(disc)} dari ${rp(gross)}).`);
      }
    }

    // 6. Belum lunas
    const remaining = Number(inv.remaining || 0);
    if (remaining > 0) {
      const age = daysBetween(d, end);
      addFlag(inv, 'belum_lunas', age >= RULES.unpaidOldDays ? 'sedang' : 'rendah', `Sisa tagihan ${rp(remaining)}, sudah ${age} hari sejak invoice.`);
    }

    // 7. Tanpa item — biasanya paket/deposit yang belum dipakai (informasi)
    if (amountOf(inv) > 0 && !(usagesByInv[inv.inv_code] || []).length) {
      addFlag(inv, 'tanpa_item', 'info', 'Tidak ada item tercatat. Biasanya pembelian paket atau deposit yang belum dipakai; cek bila bukan.');
    }
  });

  const items = Object.entries(flagsByCode).map(([code, { inv, flags }]) => {
    const top = flags.reduce((m, f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[m] ? f.severity : m, 'info');
    return {
      inv_code: code,
      id: inv.id,
      date: dayOf(inv),
      outlet: Number(inv.outlet_id) === 1 ? 'Depok' : 'Pondok Kopi',
      customer: custName[inv.customer_id] || '-',
      doctor: doctorName[inv.doctor_id] || '-',
      created_by: staffName[inv.staff_id] || '-',
      amount: amountOf(inv),
      amount_fmt: rp(amountOf(inv)),
      void: !!inv.void_invoice,
      severity: top,
      flags,
      review: statusStore[code] || null
    };
  }).sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.amount - a.amount));

  const byType = {};
  const bySeverity = { tinggi: 0, sedang: 0, rendah: 0, info: 0 };
  items.forEach(it => {
    bySeverity[it.severity]++;
    new Set(it.flags.map(f => f.type)).forEach(t => { byType[t] = (byType[t] || 0) + 1; });
  });
  const needsReview = items.filter(it => it.severity !== 'info' && !it.review);

  return {
    range: { start, end, outlet: opts.outlet || 'all' },
    rules: RULES,
    total_invoices_checked: inRange.length,
    summary: {
      flagged: items.filter(it => it.severity !== 'info').length,
      info_only: bySeverity.info,
      belum_dicek: needsReview.length,
      perlu_koreksi: items.filter(it => it.review && it.review.status === 'perlu_koreksi').length,
      by_severity: bySeverity,
      by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { label: TYPE_LABELS[k], count: v }])),
      void_total_fmt: rp(voids.reduce((a, v) => a + amountOf(v), 0))
    },
    items
  };
}

module.exports = { getInvoiceAudit, setAuditStatus, TYPE_LABELS };
