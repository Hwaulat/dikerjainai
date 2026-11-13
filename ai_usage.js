/**
 * KEFIR CLINIC — Tracking pemakaian token AI (LLM).
 *
 * Setiap pemanggilan LLM dicatat satu baris ke data/ai_usage_log.jsonl:
 * siapa, role, channel (web / whatsapp), jenis pemakaian, model, jumlah token
 * dari router (bukan perkiraan, kecuali router tidak mengirim `usage`),
 * lama respons, dan berhasil/gagal. Ringkasan dihitung saat diminta.
 *
 * Harga per 1 juta token bisa diisi owner (data/ai_usage_settings.json)
 * untuk estimasi biaya — harga router tidak diketahui dari kode.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'data', 'ai_usage_log.jsonl');
const SETTINGS_FILE = path.join(__dirname, 'data', 'ai_usage_settings.json');
const MAX_LOG_BYTES = 50 * 1024 * 1024;

const wibDay = iso => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10);

function recordUsage(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // Rotasi sederhana supaya file tidak tumbuh tanpa batas
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE.replace('.jsonl', `-${Date.now()}.jsonl`));
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error('[AI Usage] Gagal mencatat pemakaian token:', e.message);
  }
}

function getPricing() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      input_per_1m: Number(s.input_per_1m) || 0,
      output_per_1m: Number(s.output_per_1m) || 0,
      updated_by: s.updated_by || null,
      updated_at: s.updated_at || null
    };
  } catch (e) {
    return { input_per_1m: 0, output_per_1m: 0, updated_by: null, updated_at: null };
  }
}

function setPricing({ input_per_1m, output_per_1m }, user) {
  const input = Math.max(0, Number(input_per_1m) || 0);
  const output = Math.max(0, Number(output_per_1m) || 0);
  const s = { input_per_1m: input, output_per_1m: output, updated_by: user || null, updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  return s;
}

function readEntries(start, end) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const out = [];
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      const d = wibDay(e.at);
      if ((!start || d >= start) && (!end || d <= end)) out.push({ ...e, day: d });
    } catch (err) { /* baris rusak dilewati */ }
  }
  return out;
}

function getUsageSummary({ start, end } = {}) {
  const today = wibDay(new Date().toISOString());
  const s = start || `${today.slice(0, 7)}-01`;
  const e = end || today;
  const entries = readEntries(s, e);
  const pricing = getPricing();
  const priced = pricing.input_per_1m > 0 || pricing.output_per_1m > 0;
  const costOf = (p, c) => priced ? (p / 1e6) * pricing.input_per_1m + (c / 1e6) * pricing.output_per_1m : null;

  const blank = () => ({ calls: 0, questions: new Set(), prompt: 0, completion: 0, total: 0, errors: 0 });
  const add = (acc, x) => {
    acc.calls++;
    if (x.query_id) acc.questions.add(x.query_id);
    acc.prompt += x.prompt_tokens || 0;
    acc.completion += x.completion_tokens || 0;
    acc.total += x.total_tokens || 0;
    if (x.ok === false) acc.errors++;
  };
  const finish = acc => ({
    calls: acc.calls,
    questions: acc.questions.size,
    prompt_tokens: acc.prompt,
    completion_tokens: acc.completion,
    total_tokens: acc.total,
    errors: acc.errors,
    cost: costOf(acc.prompt, acc.completion)
  });
  const groupBy = keyFn => {
    const m = {};
    entries.forEach(x => { const k = keyFn(x) || '-'; add(m[k] = m[k] || blank(), x); });
    return Object.entries(m).map(([key, acc]) => ({ key, ...finish(acc) })).sort((a, b) => b.total_tokens - a.total_tokens);
  };

  const total = blank();
  entries.forEach(x => add(total, x));
  const totals = finish(total);

  // Harian, termasuk hari tanpa pemakaian supaya grafik tidak bolong
  const byDayMap = {};
  entries.forEach(x => { add(byDayMap[x.day] = byDayMap[x.day] || blank(), x); });
  const days = [];
  for (let d = new Date(s + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= e && days.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    days.push({ date: k, ...(byDayMap[k] ? finish(byDayMap[k]) : finish(blank())) });
  }

  // Pertanyaan paling boros token
  const byQuery = {};
  entries.filter(x => x.query_id).forEach(x => {
    const q = byQuery[x.query_id] = byQuery[x.query_id] || { query_id: x.query_id, question: x.question || '', user: x.user, role: x.role, channel: x.channel, at: x.at, calls: 0, total_tokens: 0, prompt: 0, completion: 0 };
    q.calls++;
    q.total_tokens += x.total_tokens || 0;
    q.prompt += x.prompt_tokens || 0;
    q.completion += x.completion_tokens || 0;
  });
  const topQuestions = Object.values(byQuery)
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 10)
    .map(q => ({ ...q, cost: costOf(q.prompt, q.completion) }));

  return {
    range: { start: s, end: e },
    pricing: { ...pricing, configured: priced },
    estimated_share: entries.length ? entries.filter(x => x.estimated).length / entries.length : 0,
    totals: { ...totals, avg_per_question: totals.questions ? Math.round(totals.total_tokens / totals.questions) : 0 },
    by_day: days,
    by_user: groupBy(x => x.user),
    by_channel: groupBy(x => x.channel),
    by_purpose: groupBy(x => x.purpose),
    by_model: groupBy(x => x.model),
    top_questions: topQuestions
  };
}

module.exports = { recordUsage, getUsageSummary, getPricing, setPricing };
