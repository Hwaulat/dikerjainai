/**
 * KEFIR CLINIC — GOOGLE MAPS REVIEW & SENTIMENT SERVICE
 *
 * SEBELUMNYA: branch_reviews.json berisi 12 ulasan KARANGAN (nama pasien,
 * rating, teks ulasan, tanggal — semuanya ditulis manual, bukan dari Google)
 * + statistik ringkasan tetap (rating 4.8, 422 ulasan, NPS 72.5). Fungsi
 * sync (syncGoogleMapsReviews) SELALU mengembalikan {success:true} bahkan
 * kalau tidak ada API key sama sekali — jadi tombol "Sync Maps" di dashboard
 * selalu bilang "Berhasil!" walau tidak pernah benar-benar menghubungi
 * Google. Balasan "AI Auto-Draft" juga cuma 1 kalimat template tetap,
 * bukan hasil AI.
 *
 * SEKARANG: kalau GOOGLE_MAPS_API_KEY/GOOGLE_PLACES_API_KEY belum diisi,
 * seluruh fungsi jujur mengembalikan available:false — tidak ada angka
 * ulasan yang ditampilkan sampai benar-benar tersambung ke Google. Begitu
 * API key diisi dan sync berhasil, data yang tampil 100% dari Google
 * Places API (bukan campuran data karangan + data asli).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REVIEWS_FILE = path.join(__dirname, 'data', 'google_maps_db', 'branch_reviews.json');

function hasApiKey() {
  return !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY);
}

function loadReviewsData() {
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read branch_reviews.json:', e);
  }
  return { connected: false, branches: {} };
}

function saveReviewsData(data) {
  try {
    const dir = path.dirname(REVIEWS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save branch_reviews.json:', e);
    return false;
  }
}

const NOT_CONNECTED_NOTE = 'Belum terhubung ke Google Maps — GOOGLE_MAPS_API_KEY belum diisi di server, atau belum pernah sync sejak diisi. Klik "Sync Maps" setelah API Key dipasang.';

function branchPayload(key, bData) {
  const connected = !!(bData && bData.last_synced_at);
  return {
    branch: key,
    branch_name: bData?.branch_name || null,
    connected,
    rating: connected ? bData.rating : null,
    total_reviews: connected ? bData.total_reviews : null,
    nps_score: connected ? bData.nps_score : null,
    maps_url: bData?.maps_url || null,
    address: bData?.address || null,
    recent_reviews: connected ? (bData.recent_reviews || []) : [],
    note: connected ? null : NOT_CONNECTED_NOTE
  };
}

/**
 * Get Google Maps reviews filtered by branch — jujur mengembalikan
 * connected:false + angka null kalau belum pernah sync sungguhan.
 * @param {'all'|'depok'|'pondok_kopi'} branch
 */
function getBranchReviews(branch = 'all') {
  const db = loadReviewsData();
  const b = (branch || 'all').toLowerCase().replace(/\s+/g, '_');

  if (b === 'depok') return branchPayload('depok', db.branches?.depok);
  if (b === 'pondok_kopi' || b === 'pdk') return branchPayload('pondok_kopi', db.branches?.pondok_kopi);

  // Combined 'all'
  const depok = db.branches?.depok;
  const pdk = db.branches?.pondok_kopi;
  const depokConnected = !!depok?.last_synced_at;
  const pdkConnected = !!pdk?.last_synced_at;
  const anyConnected = depokConnected || pdkConnected;

  const depokReviews = depokConnected ? (depok.recent_reviews || []).map(r => ({ ...r, branch: 'Depok', branch_code: 'KDC' })) : [];
  const pdkReviews = pdkConnected ? (pdk.recent_reviews || []).map(r => ({ ...r, branch: 'Pondok Kopi', branch_code: 'PDK' })) : [];
  const allReviews = [...depokReviews, ...pdkReviews].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const totalReviews = (depokConnected ? (depok.total_reviews || 0) : 0) + (pdkConnected ? (pdk.total_reviews || 0) : 0);
  const ratings = [depokConnected ? depok.rating : null, pdkConnected ? pdk.rating : null].filter(r => r != null);
  const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

  return {
    branch: 'all',
    branch_name: 'Semua Cabang (Depok & Pondok Kopi)',
    connected: anyConnected,
    rating: anyConnected ? avgRating : null,
    total_reviews: anyConnected ? totalReviews : null,
    nps_score: null, // NPS butuh survei terpisah, Google Places API tidak menyediakan ini
    branches_stat: {
      depok: { name: depok?.branch_name || 'Kefir Derma Clinic Depok', connected: depokConnected, rating: depokConnected ? depok.rating : null, total_reviews: depokConnected ? depok.total_reviews : null, maps_url: depok?.maps_url || null },
      pondok_kopi: { name: pdk?.branch_name || 'Kefir Derma Clinic Pondok Kopi', connected: pdkConnected, rating: pdkConnected ? pdk.rating : null, total_reviews: pdkConnected ? pdk.total_reviews : null, maps_url: pdk?.maps_url || null }
    },
    recent_reviews: allReviews,
    note: anyConnected ? null : NOT_CONNECTED_NOTE
  };
}

/**
 * Trigger sync of Google Maps Reviews — HANYA mengembalikan success:true
 * kalau benar-benar berhasil mengambil data dari Google Places API.
 */
async function syncGoogleMapsReviews() {
  if (!hasApiKey()) {
    return {
      success: false,
      error: 'GOOGLE_MAPS_API_KEY belum diisi di server. Tidak ada data yang bisa disinkronkan dari Google — panel ulasan tetap menampilkan "Belum Terhubung" sampai API Key dipasang.'
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const db = loadReviewsData();
  let anySuccess = false;
  const errors = [];
  // Lazy-require supaya google_maps_service.js tidak bikin ai_executive_assistant.js
  // (dan LLM router-nya) wajib termuat untuk fitur yang tidak selalu dipakai.
  const { generateReviewReplyDraft } = require('./ai_executive_assistant');

  for (const [key, bData] of Object.entries(db.branches || {})) {
    if (!bData.place_id) {
      errors.push(`${key}: tidak ada place_id tersimpan.`);
      continue;
    }
    try {
      const placeUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${bData.place_id}&fields=name,rating,reviews,user_ratings_total&key=${apiKey}`;
      const res = await fetchJson(placeUrl);
      if (res?.status !== 'OK' || !res?.result) {
        errors.push(`${key}: ${res?.status || 'gagal terhubung ke Google Places API'} — ${res?.error_message || ''}`.trim());
        continue;
      }
      bData.rating = res.result.rating ?? null;
      bData.total_reviews = res.result.user_ratings_total ?? null;

      const rawReviews = res.result.reviews || [];
      const liveReviews = [];
      for (let idx = 0; idx < rawReviews.length; idx++) {
        const gr = rawReviews[idx];
        let aiResponse = null;
        try {
          aiResponse = await generateReviewReplyDraft(gr.text || '', gr.rating || 5, gr.author_name);
        } catch (e) {
          aiResponse = null; // draf gagal dibuat — jangan tampilkan template palsu, biarkan kosong
        }
        liveReviews.push({
          id: `GMR-${key.toUpperCase()}-${idx + 1}`,
          reviewer: gr.author_name || 'Reviewer Google',
          rating: gr.rating || 5,
          date: gr.time ? new Date(gr.time * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : null,
          text: gr.text || '',
          sentiment: gr.rating >= 4 ? 'Positive' : (gr.rating === 3 ? 'Neutral' : 'Negative'),
          ai_response: aiResponse
        });
      }
      bData.recent_reviews = liveReviews;
      bData.last_synced_at = new Date().toISOString();
      anySuccess = true;
    } catch (err) {
      errors.push(`${key}: ${err.message}`);
    }
  }

  saveReviewsData(db);

  if (!anySuccess) {
    return { success: false, error: errors.join(' | ') || 'Gagal menghubungi Google Places API.' };
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    partial_errors: errors.length ? errors : undefined,
    branches: {
      depok: db.branches?.depok?.last_synced_at ? { rating: db.branches.depok.rating, total_reviews: db.branches.depok.total_reviews } : null,
      pondok_kopi: db.branches?.pondok_kopi?.last_synced_at ? { rating: db.branches.pondok_kopi.rating, total_reviews: db.branches.pondok_kopi.total_reviews } : null
    }
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

module.exports = {
  getBranchReviews,
  syncGoogleMapsReviews
};
