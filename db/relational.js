'use strict';
/**
 * Pemetaan dokumen JSON ↔ tabel relasional.
 * Aplikasi tetap memakai berkas (treatment_bom.json, bhp_unit_overrides.json) lewat
 * fs; pg_store memanggil handler ini sehingga datanya tersimpan di tabel PostgreSQL.
 * Setiap handler: load(pool) -> teks JSON | null,  save(pool, teksJson).
 */
const STD_KEYS = ['id', 'treatment_code', 'treatment_name', 'version', 'is_promo_version', 'materials', 'standard_duration_minutes', 'updated_at', 'updated_by'];
const MAT_KEYS = ['item_code', 'name', 'standard_qty', 'uom'];
const OV_KEYS = ['usage_uom', 'per_pack', 'updated_by', 'updated_at'];

const pick = (o, keys) => { const out = {}; Object.keys(o || {}).forEach(k => { if (!keys.includes(k)) out[k] = o[k]; }); return Object.keys(out).length ? out : null; };
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

async function withTx(pool, fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await fn(c); await c.query('COMMIT'); }
  catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { c.release(); }
}

const bom = {
  async load(pool) {
    const st = await pool.query('SELECT *, extract(epoch from db_updated_at) * 1000 AS ms FROM bhp_standards ORDER BY position');
    if (!st.rows.length) return null;
    const it = await pool.query('SELECT * FROM bhp_standard_items ORDER BY standard_id, line_no');
    const by = {};
    it.rows.forEach(r => {
      (by[r.standard_id] = by[r.standard_id] || []).push({
        item_code: r.item_code, name: r.name, standard_qty: Number(r.standard_qty), uom: r.uom, ...(r.extra || {})
      });
    });
    const list = st.rows.map(r => ({
      id: r.id, treatment_code: r.treatment_code, treatment_name: r.treatment_name, version: r.version,
      is_promo_version: r.is_promo_version, materials: by[r.id] || [],
      standard_duration_minutes: r.standard_duration_minutes, updated_at: r.updated_at, updated_by: r.updated_by,
      ...(r.extra || {})
    }));
    return { text: JSON.stringify(list, null, 2), mtimeMs: Math.max(...st.rows.map(r => Number(r.ms))) };
  },
  async save(pool, text) {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('treatment_bom.json harus berupa array');
    await withTx(pool, async (c) => {
      await c.query('DELETE FROM bhp_standards');
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        await c.query(
          `INSERT INTO bhp_standards (id, position, treatment_code, treatment_name, version, is_promo_version, standard_duration_minutes, updated_at, updated_by, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [s.id, i, s.treatment_code ?? null, s.treatment_name ?? '', s.version ?? null, !!s.is_promo_version,
           num(s.standard_duration_minutes), s.updated_at ?? null, s.updated_by ?? null, pick(s, STD_KEYS)]);
        const mats = Array.isArray(s.materials) ? s.materials : [];
        for (let j = 0; j < mats.length; j++) {
          const m = mats[j];
          await c.query(
            `INSERT INTO bhp_standard_items (standard_id, line_no, item_code, name, standard_qty, uom, extra)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [s.id, j, m.item_code ?? '', m.name ?? null, num(m.standard_qty) ?? 0, m.uom ?? null, pick(m, MAT_KEYS)]);
        }
      }
    });
  }
};

const overrides = {
  async load(pool) {
    const r = await pool.query('SELECT *, extract(epoch from db_updated_at) * 1000 AS ms FROM bhp_unit_overrides ORDER BY item_code');
    if (!r.rows.length) return null;
    const obj = {};
    r.rows.forEach(x => { obj[x.item_code] = { usage_uom: x.usage_uom, per_pack: x.per_pack === null ? null : Number(x.per_pack), updated_by: x.updated_by, updated_at: x.updated_at, ...(x.extra || {}) }; });
    return { text: JSON.stringify(obj, null, 2), mtimeMs: Math.max(...r.rows.map(x => Number(x.ms))) };
  },
  async save(pool, text) {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bhp_unit_overrides.json harus berupa objek');
    await withTx(pool, async (c) => {
      await c.query('DELETE FROM bhp_unit_overrides');
      for (const [code, v] of Object.entries(obj)) {
        await c.query(
          'INSERT INTO bhp_unit_overrides (item_code, usage_uom, per_pack, updated_by, updated_at, extra) VALUES ($1,$2,$3,$4,$5,$6)',
          [code, v.usage_uom ?? null, num(v.per_pack), v.updated_by ?? null, v.updated_at ?? null, pick(v, OV_KEYS)]);
      }
    });
  }
};


// ===================== Mesin pemetaan deklaratif =====================
// Tiap spesifikasi: berkas JSON ↔ tabel. Kolom skalar bertipe; properti yang tidak
// punya kolom (atau nilainya tidak sesuai tipe) masuk ke `extra` (JSONB) sehingga
// bentuk JSON hasil muat ulang sama dengan aslinya. Properti bernilai null
// dicatat di `null_props` agar tidak hilang.
const FITS = {
  text: v => typeof v === 'string',
  num: v => typeof v === 'number' && Number.isFinite(v),
  int: v => Number.isInteger(v),
  bool: v => typeof v === 'boolean',
  json: v => typeof v === 'object' && v !== null
};
const SQLTYPE = { text: 'text', num: 'numeric', int: 'integer', bool: 'boolean', json: 'jsonb' };
const C = (prop, type = 'text') => ({ prop, col: prop, type });

function encodeRow(obj, cols) {
  const values = [], nulls = [], used = new Set(), extra = {};
  cols.forEach(c => {
    used.add(c.prop);
    const v = obj[c.prop];
    if (v === undefined) { values.push(null); return; }
    if (v === null) { values.push(null); nulls.push(c.prop); return; }
    if (FITS[c.type](v)) values.push(c.type === 'json' ? JSON.stringify(v) : v);
    else { values.push(null); extra[c.prop] = v; }
  });
  Object.keys(obj).forEach(k => { if (!used.has(k)) extra[k] = obj[k]; });
  return { values, nulls, extra: Object.keys(extra).length ? extra : null };
}
function decodeRow(row, cols) {
  const o = {};
  const nulls = row.null_props || [];
  cols.forEach(c => {
    const v = row[c.col];
    if (v !== null && v !== undefined) o[c.prop] = (c.type === 'num' || c.type === 'int') ? Number(v) : v;
    else if (nulls.includes(c.prop)) o[c.prop] = null;
  });
  return { ...o, ...(row.extra || {}) };
}
const maxMs = (rows) => Math.max(...rows.map(r => Number(r.ms)));

function ddlFor(spec) {
  const cols = spec.cols.map(c => `  ${c.col} ${SQLTYPE[c.type]}`).join(',\n');
  const lead = spec.shape === 'dict' ? `  ${spec.keyCol} text PRIMARY KEY,` : `  position integer PRIMARY KEY,`;
  return `CREATE TABLE IF NOT EXISTS ${spec.table} (\n${lead}\n${cols},\n  null_props text[],\n  extra jsonb,\n  db_updated_at timestamptz NOT NULL DEFAULT now()\n);`
    + (spec.index ? `\nCREATE INDEX IF NOT EXISTS ${spec.table}_${spec.index}_idx ON ${spec.table} (${spec.index});` : '');
}

async function insertRows(c, spec, items) {
  const colNames = spec.cols.map(x => x.col);
  const lead = spec.shape === 'dict' ? [spec.keyCol] : ['position'];
  const all = [...lead, ...colNames, 'null_props', 'extra'];
  const ph = all.map((_, i) => `$${i + 1}`);
  spec.cols.forEach((x, i) => { if (x.type === 'json') ph[lead.length + i] += '::jsonb'; });
  ph[all.length - 1] += '::jsonb';
  const sql = `INSERT INTO ${spec.table} (${all.join(', ')}) VALUES (${ph.join(', ')})`;
  for (let i = 0; i < items.length; i++) {
    const [k, obj] = items[i];
    const e = encodeRow(obj, spec.cols);
    await c.query(sql, [spec.shape === 'dict' ? k : i, ...e.values, e.nulls.length ? e.nulls : null, e.extra ? JSON.stringify(e.extra) : null]);
  }
}
async function selectRows(pool, spec) {
  const order = spec.shape === 'dict' ? spec.keyCol : 'position';
  return (await pool.query(`SELECT *, extract(epoch from db_updated_at) * 1000 AS ms FROM ${spec.table} ORDER BY ${order}`)).rows;
}

function tableHandler(spec) {
  return {
    spec,
    async load(pool) {
      const rows = await selectRows(pool, spec);
      if (!rows.length) return null;
      let out;
      if (spec.shape === 'dict') { out = {}; rows.forEach(r => { out[r[spec.keyCol]] = decodeRow(r, spec.cols); }); }
      else out = rows.map(r => decodeRow(r, spec.cols));
      return { text: JSON.stringify(out, null, 2), mtimeMs: maxMs(rows) };
    },
    async save(pool, text) {
      const data = JSON.parse(text);
      let items;
      if (spec.shape === 'dict') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${spec.file} harus berupa objek`);
        items = Object.entries(data).filter(([, v]) => v && typeof v === 'object');
      } else {
        if (!Array.isArray(data)) throw new Error(`${spec.file} harus berupa array`);
        items = data.map(v => [null, v && typeof v === 'object' ? v : { value: v }]);
      }
      await withTx(pool, async (c) => { await c.query(`DELETE FROM ${spec.table}`); await insertRows(c, spec, items); });
    }
  };
}

// Objek dengan properti skalar (meta) + beberapa array anak, mis. price_master.json
function compositeHandler(spec) {
  const metaSpec = { shape: 'meta', table: spec.metaTable, cols: spec.metaCols };
  return {
    spec,
    async load(pool) {
      const m = (await pool.query(`SELECT *, extract(epoch from db_updated_at) * 1000 AS ms FROM ${spec.metaTable} WHERE id = 1`)).rows[0];
      if (!m) return null;
      const out = decodeRow(m, spec.metaCols);
      let ms = Number(m.ms);
      for (const ch of spec.children) {
        if (!(m.arrays_present || []).includes(ch.prop)) continue;
        const rows = await selectRows(pool, ch);
        out[ch.prop] = rows.map(r => decodeRow(r, ch.cols));
        if (rows.length) ms = Math.max(ms, maxMs(rows));
      }
      return { text: JSON.stringify(out, null, 2), mtimeMs: ms };
    },
    async save(pool, text) {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${spec.file} harus berupa objek`);
      const childProps = spec.children.map(c => c.prop);
      const present = childProps.filter(p => Array.isArray(data[p]));
      const rest = { ...data }; present.forEach(p => delete rest[p]);
      await withTx(pool, async (c) => {
        await c.query(`DELETE FROM ${spec.metaTable}`);
        for (const ch of spec.children) await c.query(`DELETE FROM ${ch.table}`);
        const e = encodeRow(rest, spec.metaCols);
        const names = spec.metaCols.map(x => x.col);
        const ph = names.map((_, i) => `$${i + 1}` + (spec.metaCols[i].type === 'json' ? '::jsonb' : ''));
        await c.query(
          `INSERT INTO ${spec.metaTable} (id, ${names.join(', ')}, arrays_present, null_props, extra) VALUES (1, ${ph.join(', ')}, $${names.length + 1}, $${names.length + 2}, $${names.length + 3}::jsonb)`,
          [...e.values, present, e.nulls.length ? e.nulls : null, e.extra ? JSON.stringify(e.extra) : null]);
        for (const ch of spec.children) {
          if (present.includes(ch.prop)) await insertRows(c, ch, data[ch.prop].map(v => [null, v && typeof v === 'object' ? v : { value: v }]));
        }
      });
    }
  };
}
function compositeDdl(spec) {
  const cols = spec.metaCols.map(c => `  ${c.col} ${SQLTYPE[c.type]}`).join(',\n');
  return `CREATE TABLE IF NOT EXISTS ${spec.metaTable} (\n  id integer PRIMARY KEY CHECK (id = 1),\n${cols},\n  arrays_present text[],\n  null_props text[],\n  extra jsonb,\n  db_updated_at timestamptz NOT NULL DEFAULT now()\n);\n`
    + spec.children.map(ddlFor).join('\n');
}

// ===================== Spesifikasi data yang diedit user =====================
const SPECS = [
  { file: 'marketing_promos.json', shape: 'list', table: 'marketing_promos', index: 'id', cols: [
    C('id'), C('name'), C('period_start'), C('period_end'), C('branch'), C('target_item'), C('target_type'),
    C('normal_price', 'num'), C('promo_price', 'num'), C('bottom_price', 'num'), C('quota_total', 'num'), C('quota_used', 'num'),
    C('target_patient'), C('terms_conditions'), C('status'), C('created_at'), C('created_by')] },
  { file: 'doctor_recommendations.json', shape: 'list', table: 'doctor_recommendations', index: 'id', cols: [
    C('id'), C('invoice_code'), C('customer_id', 'json'), C('customer_name'), C('doctor_name'), C('doctor_id', 'json'),
    C('consultation_date'), C('skin_analysis'), C('return_interval_days', 'num'), C('recommended_return_date'),
    C('roadmap_steps', 'json'), C('roadmap_months', 'json'), C('homecare_skincare', 'json'), C('doctor_notes'), C('recommendation'),
    C('updated_by'), C('created_at'), C('updated_at')] },
  { file: 'patient_feedbacks.json', shape: 'list', table: 'patient_feedbacks', index: 'id', cols: [
    C('id'), C('date'), C('submitted_at'), C('customer_name'), C('patient_name'), C('phone'), C('branch'), C('treatment'),
    C('doctor_name'), C('nurse_name'), C('rating', 'num'), C('rating_overall', 'num'), C('rating_doctor', 'num'),
    C('rating_nurse', 'num'), C('rating_facility', 'num'), C('rating_treatment', 'num'), C('nps_score', 'num'),
    C('review_text'), C('comments'), C('source'), C('routing_action'), C('google_maps_url'),
    C('complaint_ticket_id'), C('auto_ticket_id')] },
  { file: 'petty_cash_entries.json', shape: 'list', table: 'petty_cash_entries', index: 'period', cols: [
    C('id'), C('period'), C('date'), C('description'), C('amount', 'num'), C('category'), C('added_by'), C('added_at')] },
  { file: 'doctor_followup_status.json', shape: 'dict', table: 'doctor_followup_status', keyCol: 'rec_id', cols: [
    C('status'), C('last_contacted_at'), C('contacted_by'), C('notes'), C('booking_date'), C('updated_at')] },
  { file: 'monthly_targets.json', shape: 'dict', table: 'monthly_targets', keyCol: 'month', cols: [
    C('total_target', 'num'), C('depok_target', 'num'), C('pondok_kopi_target', 'num'), C('notes'), C('updated_at'), C('updated_by')] },
  { file: 'monthly_costs.json', shape: 'dict', table: 'monthly_costs', keyCol: 'period_key', cols: [
    C('period'), C('bhp_petty_cash', 'num'), C('gaji_karyawan', 'num'), C('sewa_utilitas', 'num'), C('lain_lain', 'num'),
    C('filled', 'bool'), C('updated_by'), C('updated_at')] },
  { file: 'sales_bottom_prices.json', shape: 'dict', table: 'sales_bottom_prices', keyCol: 'code_key', cols: [
    C('code'), C('name'), C('normal_price', 'num'), C('bottom_price', 'num'), C('max_discount_pct', 'num'),
    C('allowed_roles', 'json'), C('notes'), C('updated_at')] },
];
const COMPOSITES = [
  { file: 'price_master.json', metaTable: 'price_master_meta',
    metaCols: [C('version', 'num'), C('updated_at'), C('updated_by'), C('drive_folder_url'), C('currency_note')],
    children: [
      { prop: 'items', shape: 'list', table: 'price_items', index: 'key', cols: [
        C('key'), C('name'), C('category'), C('product_id', 'num'), C('product_code'), C('product_name'), C('match'),
        C('list_price', 'num'), C('bottom_price', 'num'), C('pkg3_per_session', 'num'), C('pkg6_per_session', 'num'),
        C('pkg3_total', 'num'), C('pkg6_total', 'num'), C('note')] },
      { prop: 'campaigns', shape: 'list', table: 'price_campaigns', index: 'id', cols: [
        C('id'), C('name'), C('memo_no'), C('start'), C('end'), C('offer'), C('terms'), C('source_url'),
        C('items', 'json'), C('bundles', 'json')] }
    ] },
];
SPECS.forEach(s => { s.cols.forEach(c => { c.col = c.col === 'end' ? 'end_date' : c.col === 'start' ? 'start_date' : c.col; }); });
COMPOSITES.forEach(cs => cs.children.forEach(ch => ch.cols.forEach(c => { c.col = c.col === 'end' ? 'end_date' : c.col === 'start' ? 'start_date' : c.col; })));

const handlers = { 'treatment_bom.json': bom, 'bhp_unit_overrides.json': overrides };
SPECS.forEach(s => { handlers[s.file] = tableHandler(s); });
COMPOSITES.forEach(cs => { cs.children.forEach(ch => { ch.file = cs.file; }); handlers[cs.file] = compositeHandler(cs); });

// Hanya alat bantu pengembangan: DDL dari spesifikasi di atas untuk disalin ke prisma/schema.prisma.
// Sumber kebenaran skema = prisma/schema.prisma + prisma/migrations.
function generatedDdl() {
  return SPECS.map(ddlFor).join('\n') + '\n' + COMPOSITES.map(compositeDdl).join('\n');
}

module.exports = { handlers, generatedDdl };
