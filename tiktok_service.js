/**
 * KEFIR CLINIC — TIKTOK SOCIAL MEDIA SERVICE
 * Mengelola profil publik TikTok @kefirdermaclinic.
 *
 * Pola sama dengan instagram_service.js: DEFAULT_TIKTOK_PROFILE dulu
 * mengaku "Terhubung Aktif" dengan angka karangan (32,9K followers,
 * 425,3K likes) sebelum pernah disinkronkan. syncTikTokProfile() mencoba
 * scraping HTML publik TikTok (bukan API resmi), dan tetap melaporkan
 * {success:true, message:'...dari cache data terverifikasi'} bahkan saat
 * request gagal total (network error/timeout). Sekarang: tidak ada
 * scraping — profil hanya terisi dari input manual staf, ditandai jelas
 * sumber & waktunya.
 */

const fs = require('fs');
const path = require('path');

const TIKTOK_PROFILE_FILE = path.join(__dirname, 'data', 'marketing_db', 'tiktok_profile.json');

const DEFAULT_TIKTOK_PROFILE = {
  username: "kefirdermaclinic",
  full_name: "Kefir Derma Clinic",
  profile_url: "https://www.tiktok.com/@kefirdermaclinic",
  bio: "✨INTIMATE & SKIN EXPERT✨\nKlinik Spesialis Perawatan Kulit & Kewanitaan\n💗V-Theraphy | Pink Secret | Probiotic Skin Rejuve\nKonsultasi & Appointment👇",
  linktree: "https://linktr.ee/kefirdermaclinic",
  followers: null,
  followers_fmt: null,
  total_likes: null,
  total_likes_fmt: null,
  top_video_views: null,
  connected: false,
  source: null,
  status_text: "Belum diisi — tidak ada API resmi TikTok, isi manual dari angka yang terlihat di aplikasi",
  last_synced: null
};

function getTikTokProfile() {
  try {
    if (fs.existsSync(TIKTOK_PROFILE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(TIKTOK_PROFILE_FILE, 'utf8'));
      return { ...DEFAULT_TIKTOK_PROFILE, ...saved };
    }
  } catch (e) {
    console.error('Error reading tiktok_profile.json:', e);
  }
  return { ...DEFAULT_TIKTOK_PROFILE };
}

function saveTikTokProfile(data) {
  try {
    const dir = path.dirname(TIKTOK_PROFILE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TIKTOK_PROFILE_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving tiktok_profile.json:', e);
    return false;
  }
}

/**
 * Update profil dari input manual staf — tidak ada auto-sync (TikTok
 * tidak menyediakan API publik gratis untuk profil bisnis kecil).
 */
function updateTikTokProfileManual({ followers, total_likes, top_video_views, updated_by }) {
  if (followers == null || followers === '') return { success: false, error: 'Jumlah followers wajib diisi' };
  const profile = getTikTokProfile();
  const f = Number(followers);
  if (!Number.isFinite(f) || f < 0) return { success: false, error: 'Jumlah followers harus angka' };

  profile.followers = f;
  profile.followers_fmt = f >= 1000 ? (f / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(f);
  if (total_likes !== undefined && total_likes !== '') {
    const l = Number(total_likes);
    if (Number.isFinite(l)) { profile.total_likes = l; profile.total_likes_fmt = l >= 1000 ? (l / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(l); }
  }
  if (top_video_views !== undefined && top_video_views !== '') {
    profile.top_video_views = String(top_video_views);
  }
  profile.connected = true;
  profile.source = 'manual_staff_entry';
  profile.status_text = 'Diisi Manual';
  profile.updated_by = updated_by || 'Dashboard User';
  profile.last_synced = new Date().toISOString();

  saveTikTokProfile(profile);
  return { success: true, profile, message: `Profil TikTok diperbarui manual oleh ${profile.updated_by}.` };
}

module.exports = {
  getTikTokProfile,
  updateTikTokProfileManual
};
