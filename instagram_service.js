/**
 * KEFIR CLINIC — INSTAGRAM SOCIAL MEDIA SERVICE
 * Mengelola profil publik @kefirdermaclinic dan pelacakan performa postingan.
 *
 * SEBELUMNYA: DEFAULT_PROFILE berisi angka karangan (24,1K followers, 1.936
 * postingan) dengan connected:true & status_text:"Terhubung Aktif" — jadi
 * bahkan SEBELUM pernah di-sync, dashboard sudah mengaku terhubung dengan
 * angka yang tidak pernah diverifikasi. syncInstagramProfile() mencoba
 * scraping HTML publik Instagram (bukan API resmi — Instagram tidak
 * menyediakan API publik gratis tanpa App Review & akun Business
 * terverifikasi), dan yang lebih serius: kalau scraping gagal (network
 * error/timeout — yang sering terjadi karena Instagram memblokir bot),
 * kode tetap resolve {success:true, message:'...dari cache terverifikasi'}
 * — mengaku berhasil padahal tidak terjadi apa-apa. addInstagramPostTrack
 * juga diam-diam mengarang angka engagement (reach 15000, views 18500,
 * likes 1200, engagement 9.5%) kalau field tidak diisi pemanggil.
 *
 * SEKARANG: tidak ada percobaan scraping sama sekali (tidak reliable &
 * berisiko melanggar ToS Instagram). Profil HANYA terisi dari input
 * manual staf (angka yang mereka lihat sendiri di aplikasi Instagram),
 * ditandai jelas sumbernya "manual_staff_entry" dengan timestamp &
 * siapa yang mengisi — bukan diklaim "tersambung otomatis". Postingan
 * baru WAJIB diisi field engagement-nya, tidak lagi default ke angka
 * karangan.
 */

const fs = require('fs');
const path = require('path');

const PROFILE_FILE = path.join(__dirname, 'data', 'marketing_db', 'instagram_profile.json');
const POSTS_FILE = path.join(__dirname, 'data', 'marketing_db', 'published_posts.json');

const DEFAULT_PROFILE = {
  username: null,
  full_name: "Akun Instagram Meta",
  profile_url: "https://www.instagram.com/",
  profile_picture_url: null,
  category: "Instagram Business / Professional Account",
  bio: "Hubungkan akun Meta Anda untuk menampilkan profil, followers, dan postingan Instagram yang tertaut secara otomatis.",
  followers: null,
  followers_fmt: null,
  following: null,
  posts_count: null,
  posts_count_fmt: null,
  connected: false,
  source: null,
  status_text: "Belum terhubung ke Meta",
  last_synced: null
};

function getInstagramProfile() {
  let profile = { ...DEFAULT_PROFILE };
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      profile = { ...DEFAULT_PROFILE, ...saved };
    }
  } catch (e) {
    console.error('Error reading instagram_profile.json:', e);
  }

  // Kalau akun Meta Ads sudah pernah dipakai untuk sync Instagram sungguhan
  // (syncInstagramFromMeta di meta_ads_service.js — pakai token Meta Ads
  // yang sama, real Graph API), data ASLI dari akun Instagram yang tertaut
  // diprioritaskan sepenuhnya.
  try {
    const { getCachedInstagramMetaData } = require('./meta_ads_service');
    const metaSynced = getCachedInstagramMetaData();
    if (metaSynced) {
      if (metaSynced.username) {
        profile.username = metaSynced.username;
        profile.profile_url = `https://www.instagram.com/${metaSynced.username}/`;
      }
      if (metaSynced.name) {
        profile.full_name = metaSynced.name;
      }
      if (metaSynced.profile_picture_url) {
        profile.profile_picture_url = metaSynced.profile_picture_url;
      }
      const f = metaSynced.followers_count;
      profile.followers = f ?? profile.followers;
      profile.followers_fmt = f != null ? (f >= 1000 ? (f / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(f)) : profile.followers_fmt;
      profile.following = metaSynced.follows_count ?? profile.following;
      profile.posts_count = metaSynced.media_count ?? profile.posts_count;
      profile.posts_count_fmt = metaSynced.media_count != null ? metaSynced.media_count.toLocaleString('id-ID') : profile.posts_count_fmt;
      profile.connected = true;
      profile.source = 'meta_graph_api';
      profile.status_text = `Terhubung via Meta (@${metaSynced.username || profile.username})`;
      profile.last_synced = metaSynced.synced_at;
      profile.recent_media = metaSynced.recent_media || [];
    }
  } catch (e) {
    // meta_ads_service.js tidak wajib ada/berhasil dimuat — profil manual
    // tetap jalan seperti biasa kalau lazy-require ini gagal.
  }

  return profile;
}

function saveInstagramProfile(data) {
  try {
    const dir = path.dirname(PROFILE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving instagram_profile.json:', e);
    return false;
  }
}

/**
 * Update profil dari input manual staf — SATU-SATUNYA cara profil ini
 * terisi. Tidak ada auto-sync karena tidak ada API resmi Instagram yang
 * tersambung (butuh Instagram Business API via Meta Graph API + akun
 * Business terverifikasi, App Review Meta — belum ada infrastrukturnya).
 */
function updateInstagramProfileManual({ followers, posts_count, following, updated_by }) {
  if (followers == null || followers === '') return { success: false, error: 'Jumlah followers wajib diisi' };
  const profile = getInstagramProfile();
  const f = Number(followers);
  if (!Number.isFinite(f) || f < 0) return { success: false, error: 'Jumlah followers harus angka' };

  profile.followers = f;
  profile.followers_fmt = f >= 1000 ? (f / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(f);
  if (posts_count !== undefined && posts_count !== '') {
    const p = Number(posts_count);
    if (Number.isFinite(p)) { profile.posts_count = p; profile.posts_count_fmt = p.toLocaleString('id-ID'); }
  }
  if (following !== undefined && following !== '') {
    const g = Number(following);
    if (Number.isFinite(g)) profile.following = g;
  }
  profile.connected = true;
  profile.source = 'manual_staff_entry';
  profile.status_text = 'Diisi Manual';
  profile.updated_by = updated_by || 'Dashboard User';
  profile.last_synced = new Date().toISOString();

  saveInstagramProfile(profile);
  return { success: true, profile, message: `Profil Instagram diperbarui manual oleh ${profile.updated_by}.` };
}

/**
 * Tambah postingan Instagram baru ke list tracking — SEMUA angka
 * engagement wajib diisi pemanggil (staf), tidak ada lagi default
 * karangan kalau kosong.
 */
function addInstagramPostTrack(postData) {
  const required = ['views', 'likes', 'comments', 'shares', 'saves'];
  for (const key of required) {
    if (postData[key] === undefined || postData[key] === null || postData[key] === '') {
      return { success: false, error: `Field "${key}" wajib diisi — tidak ada angka default lagi.` };
    }
  }
  try {
    let posts = [];
    if (fs.existsSync(POSTS_FILE)) {
      posts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    }
    if (!Array.isArray(posts)) posts = [];

    const platform = postData.platform === 'TikTok' ? 'TikTok' : 'Instagram';
    const prefix = platform === 'TikTok' ? 'TK' : 'IG';
    const newId = `POST-${prefix}-${Date.now().toString().slice(-4)}`;
    const defaultUrl = platform === 'TikTok' ? 'https://www.tiktok.com/@kefirdermaclinic' : 'https://www.instagram.com/kefirdermaclinic/';
    const newPost = {
      id: newId,
      platform: platform,
      post_type: postData.post_type || (platform === 'TikTok' ? "Short Video" : "Reels"),
      post_url: postData.post_url || defaultUrl,
      title: postData.title || `Postingan @kefirdermaclinic (${platform})`,
      published_at: postData.published_at || new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + ' WIB',
      reach: parseInt(postData.reach, 10) || null,
      views: parseInt(postData.views, 10),
      likes: parseInt(postData.likes, 10),
      comments: parseInt(postData.comments, 10),
      shares: parseInt(postData.shares, 10),
      saves: parseInt(postData.saves, 10),
      engagement_rate: postData.engagement_rate || null,
      status: postData.status || "Baru Ditambahkan",
      entry_source: 'manual_staff_entry'
    };

    posts.unshift(newPost);
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), 'utf8');
    return { success: true, post: newPost };
  } catch (e) {
    console.error('Error adding Instagram post to track:', e);
    return { success: false, error: e.message };
  }
}

module.exports = {
  getInstagramProfile,
  updateInstagramProfileManual,
  addInstagramPostTrack
};
