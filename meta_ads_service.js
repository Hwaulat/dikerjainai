/**
 * Meta Ads & Graph API Integration Service for KEFIR Clinic
 * Supports Self-Service 1-Click Facebook Login for Business (OAuth 2.0)
 * and System User Long-Lived Access Tokens.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const META_SETTINGS_FILE = path.join(__dirname, 'data', 'meta_ads_settings.json');
const META_SYNCED_CACHE_FILE = path.join(__dirname, 'data', 'meta_synced_data.json');
const INSTAGRAM_SYNCED_CACHE_FILE = path.join(__dirname, 'data', 'instagram_meta_synced.json');

// Default Meta Graph API version
const GRAPH_API_VERSION = 'v22.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Standard HTTPS Request Helper
 */
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', err => reject(err));
    // Tanpa batas waktu, permintaan yang menggantung membuat tombol
    // "Hubungkan"/"Sinkron" berputar selamanya
    req.setTimeout(options.timeout || 30000, () => req.destroy(Object.assign(new Error('Waktu habis menghubungi Meta Graph API'), { code: 'ETIMEDOUT' })));

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// Pesan yang bisa dibaca untuk gangguan jaringan (DNS, offline, timeout)
function networkErrorMessage(err) {
  const code = err && err.code ? ` (${err.code})` : '';
  return `Tidak bisa menghubungi Meta Graph API${code}. Periksa koneksi internet server lalu coba lagi.`;
}
const isNetworkError = err => !!err && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(err.code);

/**
 * Load stored Meta settings
 */
function getMetaSettings() {
  try {
    if (fs.existsSync(META_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(META_SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[MetaService] Error reading settings:', e.message);
  }
  return {
    app_id: process.env.META_APP_ID || '',
    app_secret: process.env.META_APP_SECRET || '',
    ad_account_id: process.env.META_AD_ACCOUNT_ID || '',
    access_token: process.env.META_ACCESS_TOKEN || '',
    user_name: null,
    user_id: null,
    connected_ad_accounts: [],
    connected_pages: [],
    token_expires_at: null,
    connected: false,
    updated_at: null
  };
}

/**
 * Save Meta settings
 */
function saveMetaSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(META_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(META_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[MetaService] Error saving settings:', e.message);
    return false;
  }
}

/**
 * Safe settings for frontend consumption (hides token and secret)
 */
function getMetaSettingsSafe() {
  const s = getMetaSettings();
  const isConnected = !!(s.access_token && (s.ad_account_id || (s.connected_ad_accounts && s.connected_ad_accounts.length > 0)));

  return {
    connected: isConnected,
    has_app_id: !!s.app_id,
    app_id: s.app_id || '',
    user_name: s.user_name || null,
    user_id: s.user_id || null,
    ad_account_id: s.ad_account_id || null,
    connected_ad_accounts: s.connected_ad_accounts || [],
    connected_pages: s.connected_pages || [],
    token_expires_at: s.token_expires_at || null,
    token_never_expires: !!s.token_never_expires,
    updated_at: s.updated_at || null,
    has_synced_data: fs.existsSync(META_SYNCED_CACHE_FILE)
  };
}

/**
 * Generate Meta OAuth 2.0 Authorization URL
 */
function getMetaOAuthUrl(hostOrigin) {
  const s = getMetaSettings();
  const appId = s.app_id || process.env.META_APP_ID;

  if (!appId) {
    return {
      success: false,
      error: 'Meta App ID belum dikonfigurasi. Silakan masukkan Meta App ID & Secret di tab Pengaturan Meta terlebih dahulu.'
    };
  }

  const redirectUri = `${hostOrigin}/api/meta-ads/oauth/callback`;
  // Hanya izin BACA. "read_insights" sudah tidak valid di Facebook Login
  // (dialog menolak dengan "Invalid Scopes: read_insights") — insights iklan
  // sudah tercakup ads_read. "ads_management" (izin mengubah iklan) dihapus
  // karena dashboard tidak pernah menulis ke Meta.
  const scopes = [
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic'
  ].join(',');

  const state = Buffer.from(JSON.stringify({ timestamp: Date.now(), origin: hostOrigin })).toString('base64url');

  const authUrl = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes)}&response_type=code`;

  return {
    success: true,
    auth_url: authUrl,
    redirect_uri: redirectUri
  };
}

/**
 * Exchange Authorization Code for Long-Lived Token & Fetch User Profile
 */
async function handleMetaOAuthCallback(code, hostOrigin) {
  const s = getMetaSettings();
  const appId = s.app_id || process.env.META_APP_ID;
  const appSecret = s.app_secret || process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('Meta App ID atau App Secret tidak ditemukan di konfigurasi server.');
  }

  const redirectUri = `${hostOrigin}/api/meta-ads/oauth/callback`;

  // 1. Exchange code for Short-Lived Access Token
  const tokenUrl = `${GRAPH_BASE_URL}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`;
  
  const tokenRes = await httpsRequest(tokenUrl);
  if (tokenRes.status !== 200 || !tokenRes.data || !tokenRes.data.access_token) {
    const errMsg = tokenRes.data?.error?.message || 'Gagal menukar authorization code dengan access token Meta.';
    throw new Error(errMsg);
  }

  const shortToken = tokenRes.data.access_token;

  // 2. Exchange for Long-Lived Access Token (60 Days)
  const longTokenUrl = `${GRAPH_BASE_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  
  const longTokenRes = await httpsRequest(longTokenUrl);
  const finalToken = (longTokenRes.status === 200 && longTokenRes.data?.access_token) ? longTokenRes.data.access_token : shortToken;
  const expiresIn = longTokenRes.data?.expires_in || 5184000; // ~60 days default

  // 3. Fetch User Profile (/me)
  const meRes = await httpsRequest(`${GRAPH_BASE_URL}/me?fields=id,name,email&access_token=${encodeURIComponent(finalToken)}`);
  const userName = meRes.data?.name || 'Pengguna Meta';
  const userId = meRes.data?.id || null;

  // 4. Fetch Connected Ad Accounts (/me/adaccounts)
  const adAccountsRes = await httpsRequest(`${GRAPH_BASE_URL}/me/adaccounts?fields=id,account_id,name,currency,account_status,business&access_token=${encodeURIComponent(finalToken)}`);
  const adAccounts = Array.isArray(adAccountsRes.data?.data) ? adAccountsRes.data.data.map(a => ({
    id: a.id, // e.g. act_12345
    account_id: a.account_id,
    name: a.name || `Ad Account ${a.account_id}`,
    currency: a.currency || 'IDR',
    status: a.account_status === 1 ? 'ACTIVE' : 'INACTIVE',
    business_name: a.business?.name || 'KEFIR Business'
  })) : [];

  // Default to first ad account if available
  const defaultAdAccount = adAccounts.length > 0 ? adAccounts[0].id : (s.ad_account_id || null);

  // 5. Fetch Connected Instagram & Facebook Pages (/me/accounts)
  const pagesRes = await httpsRequest(`${GRAPH_BASE_URL}/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(finalToken)}`);
  const pages = Array.isArray(pagesRes.data?.data) ? pagesRes.data.data.map(p => ({
    page_id: p.id,
    page_name: p.name,
    instagram_id: p.instagram_business_account?.id || null,
    instagram_username: p.instagram_business_account?.username || null
  })) : [];

  // Save to settings
  const updatedSettings = {
    ...s,
    access_token: finalToken,
    user_name: userName,
    user_id: userId,
    ad_account_id: defaultAdAccount,
    connected_ad_accounts: adAccounts,
    connected_pages: pages,
    token_expires_at: new Date(Date.now() + (expiresIn * 1000)).toISOString(),
    connected: true,
    updated_at: new Date().toISOString()
  };

  saveMetaSettings(updatedSettings);

  return {
    success: true,
    user_name: userName,
    ad_accounts: adAccounts,
    selected_ad_account: defaultAdAccount,
    pages: pages
  };
}

/**
 * Disconnect Meta Account
 */
function disconnectMeta() {
  const s = getMetaSettings();
  const reset = {
    app_id: s.app_id,
    app_secret: s.app_secret,
    ad_account_id: null,
    access_token: null,
    user_name: null,
    user_id: null,
    connected_ad_accounts: [],
    connected_pages: [],
    token_expires_at: null,
    connected: false,
    updated_at: new Date().toISOString()
  };
  saveMetaSettings(reset);
  return { success: true, message: 'Koneksi akun Meta Ads berhasil diputuskan.' };
}

/**
 * Manual Configuration (Update App ID, Secret, or Token directly)
 */
function updateMetaConfig({ app_id, app_secret, ad_account_id, access_token }) {
  const s = getMetaSettings();
  const next = {
    ...s,
    app_id: app_id !== undefined ? (app_id ? app_id.trim() : '') : s.app_id,
    app_secret: app_secret !== undefined ? (app_secret ? app_secret.trim() : '') : s.app_secret,
    ad_account_id: ad_account_id !== undefined ? (ad_account_id ? ad_account_id.trim() : '') : s.ad_account_id,
    access_token: access_token !== undefined ? (access_token ? access_token.trim() : '') : s.access_token,
    updated_at: new Date().toISOString()
  };

  next.connected = !!(next.access_token && (next.ad_account_id || (next.connected_ad_accounts && next.connected_ad_accounts.length > 0)));
  saveMetaSettings(next);

  return { success: true, settings: getMetaSettingsSafe() };
}

/**
 * Sync Real Campaigns and Insights from Meta Marketing API
 */
async function syncMetaMarketingData() {
  const s = getMetaSettings();
  if (!s.access_token || !s.ad_account_id) {
    throw new Error('Akun Meta Ads belum terhubung atau Ad Account ID belum dipilih.');
  }

  const actId = s.ad_account_id.startsWith('act_') ? s.ad_account_id : `act_${s.ad_account_id}`;
  const token = s.access_token;

  // 1. Fetch Ad Account Summary & Daily Insights (Lifetime / Maximum)
  const insightsUrl = `${GRAPH_BASE_URL}/${actId}/insights?date_preset=maximum&fields=spend,impressions,clicks,cpc,ctr,reach,frequency,actions,action_values,cost_per_action_type&access_token=${encodeURIComponent(token)}`;
  const campaignsUrl = `${GRAPH_BASE_URL}/${actId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(maximum){spend,impressions,clicks,cpc,ctr,actions,action_values}&limit=50&access_token=${encodeURIComponent(token)}`;

  let insightsRes = null;
  let campaignsRes = null;

  try {
    insightsRes = await httpsRequest(insightsUrl);
    campaignsRes = await httpsRequest(campaignsUrl);
  } catch (netErr) {
    console.warn('[syncMetaMarketingData] Network error during Meta sync:', netErr.message);
    const existingCache = getCachedMetaAdsData();
    if (existingCache) {
      return {
        success: true,
        message: `Menggunakan data Meta Ads cache tersimpan (${existingCache.campaigns?.length || 0} campaign).`,
        data: existingCache
      };
    }
    throw netErr;
  }

  // Check if Graph API returned error (e.g. 403 Forbidden / lacks ads_read permission)
  const isApiError = (!insightsRes || !campaignsRes || insightsRes.data?.error || campaignsRes.data?.error);
  if (isApiError) {
    const errMsg = insightsRes?.data?.error?.message || campaignsRes?.data?.error?.message || 'Meta API returned error';
    console.warn('[syncMetaMarketingData] Meta API error:', errMsg);
    const existingCache = getCachedMetaAdsData();
    if (existingCache) {
      return {
        success: true,
        message: `Menggunakan data Meta Ads cache tersimpan: ${errMsg}`,
        data: existingCache
      };
    }
    throw new Error(errMsg);
  }

  // Format summary
  const summaryInsight = Array.isArray(insightsRes.data?.data) && insightsRes.data.data.length > 0 ? insightsRes.data.data[0] : {};
  const totalSpend = parseFloat(summaryInsight.spend || 0);
  const totalImpressions = parseInt(summaryInsight.impressions || 0, 10);
  const totalClicks = parseInt(summaryInsight.clicks || 0, 10);
  const ctr = parseFloat(summaryInsight.ctr || 0);
  const cpc = parseFloat(summaryInsight.cpc || 0);

  // ROAS — DULU actions & action_values SUDAH DITARIK dari Graph API
  // tapi tidak pernah diparse, jadi kolom ROAS di tabel selalu "-" walau
  // akun sudah tersambung & tersinkron. Meta tidak punya satu field
  // "ROAS" langsung — dihitung dari total nilai event 'purchase' (Pixel/
  // Conversions API) dibagi spend. Nama action_type beda-beda tergantung
  // setup tracking klinik (purchase langsung, atau lewat pixel/app), jadi
  // dicari semua varian yang mengandung 'purchase'. Kalau tidak ada satu
  // pun event konversi tercatat, ROAS jujur ditandai tidak bisa dihitung
  // — bukan 0 atau dikira-kira dari CTR.
  function extractPurchaseValue(actionValues) {
    if (!Array.isArray(actionValues)) return null;
    const purchaseTypes = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'];
    const match = actionValues.find(a => purchaseTypes.includes(a.action_type));
    return match ? parseFloat(match.value || 0) : null;
  }
  function extractPurchaseCount(actions) {
    if (!Array.isArray(actions)) return null;
    const purchaseTypes = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'];
    const match = actions.find(a => purchaseTypes.includes(a.action_type));
    if (match) return parseInt(match.value || 0, 10);
    // Jika bukan e-commerce purchase langsung, cari lead/inbound messaging (WhatsApp)
    const leadTypes = [
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.total_messaging_connection',
      'onsite_conversion.messaging_first_reply',
      'lead',
      'contact_total',
      'omni_complete_registration'
    ];
    let maxLeads = 0;
    actions.forEach(a => {
      if (leadTypes.includes(a.action_type)) {
        const val = parseInt(a.value || 0, 10);
        if (val > maxLeads) maxLeads = val;
      }
    });
    return maxLeads > 0 ? maxLeads : null;
  }
  function computeRoas(spend, purchaseValue) {
    if (purchaseValue == null || !spend) return null;
    return purchaseValue / spend;
  }

  const totalPurchaseValue = extractPurchaseValue(summaryInsight.action_values);
  const totalPurchaseCount = extractPurchaseCount(summaryInsight.actions);
  const overallRoas = computeRoas(totalSpend, totalPurchaseValue);

  // Parse campaigns
  const campaignsList = Array.isArray(campaignsRes.data?.data) ? campaignsRes.data.data.map(c => {
    const cInsight = c.insights?.data?.[0] || {};
    const cSpend = parseFloat(cInsight.spend || 0);
    const cImpressions = parseInt(cInsight.impressions || 0, 10);
    const cClicks = parseInt(cInsight.clicks || 0, 10);
    const cCtr = parseFloat(cInsight.ctr || 0);
    const cCpc = parseFloat(cInsight.cpc || 0);
    const cPurchaseValue = extractPurchaseValue(cInsight.action_values);
    const cPurchaseCount = extractPurchaseCount(cInsight.actions);
    const cRoas = computeRoas(cSpend, cPurchaseValue);

    let recommendation;
    if (cRoas != null) {
      if (cRoas >= 3) recommendation = 'Scale Up (+20% Budget) — ROAS sehat';
      else if (cRoas < 1) recommendation = 'Evaluasi Funnel/Closing — trafik ada, ROAS di bawah 1x';
      else recommendation = 'Maintain — ROAS positif tapi belum tinggi';
    } else {
      recommendation = (cSpend > 100000 && cCtr > 2.0) || (cPurchaseCount && cPurchaseCount >= 5) 
        ? 'Scale Up (+20% Budget)' 
        : (cCtr < 1.0 ? 'Refresh Creative / Ganti Hook' : 'Maintain & Optimasi');
    }

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      daily_budget: c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : null,
      daily_budget_fmt: c.daily_budget ? `Rp ${Math.round(parseInt(c.daily_budget, 10) / 100).toLocaleString('id-ID')} / hari` : 'Lifetime / Manual',
      spend: cSpend,
      spend_fmt: 'Rp ' + Math.round(cSpend).toLocaleString('id-ID'),
      impressions: cImpressions,
      clicks: cClicks,
      ctr: cCtr.toFixed(2) + '%',
      cpc: 'Rp ' + Math.round(cCpc).toLocaleString('id-ID'),
      purchase_count: cPurchaseCount,
      purchase_value: cPurchaseValue,
      purchase_value_fmt: cPurchaseValue != null ? 'Rp ' + Math.round(cPurchaseValue).toLocaleString('id-ID') : null,
      roas: cRoas,
      roas_fmt: cRoas != null ? cRoas.toFixed(2) + 'x' : '— (Lead Gen WA)',
      recommendation
    };
  }) : [];

  const syncedData = {
    ad_account_id: actId,
    synced_at: new Date().toISOString(),
    total_spend: totalSpend,
    total_spend_fmt: 'Rp ' + Math.round(totalSpend).toLocaleString('id-ID'),
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    overall_ctr: ctr.toFixed(2) + '%',
    overall_cpc: 'Rp ' + Math.round(cpc).toLocaleString('id-ID'),
    total_purchase_count: totalPurchaseCount,
    total_purchase_value: totalPurchaseValue,
    total_purchase_value_fmt: totalPurchaseValue != null ? 'Rp ' + Math.round(totalPurchaseValue).toLocaleString('id-ID') : 'Lead Gen WA',
    overall_roas: overallRoas,
    overall_roas_fmt: overallRoas != null ? overallRoas.toFixed(2) + 'x' : 'Lead Gen WA',
    roas_note: overallRoas != null ? null : 'Objective campaign adalah Inbound WhatsApp & Lead Gen. Belum ada event purchase e-commerce langsung.',
    campaigns: campaignsList
  };

  fs.mkdirSync(path.dirname(META_SYNCED_CACHE_FILE), { recursive: true });
  fs.writeFileSync(META_SYNCED_CACHE_FILE, JSON.stringify(syncedData, null, 2), 'utf8');

  return {
    success: true,
    message: `Berhasil menyinkronkan ${campaignsList.length} campaign Meta Ads!`,
    data: syncedData
  };
}

/**
 * Get Cached Synced Meta Ads Data
 */
function getCachedMetaAdsData() {
  try {
    if (fs.existsSync(META_SYNCED_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(META_SYNCED_CACHE_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

/**
 * Sync Instagram profile & recent media dari Instagram Graph API — pakai
 * access_token YANG SAMA dengan Meta Ads (tidak perlu kredensial baru).
 *
 * connected_pages[].instagram_id sudah ditarik sejak lama saat OAuth/token
 * connect (lihat handleMetaOAuthCallback & testAndConnectMetaToken di atas
 * — keduanya sudah memanggil /me/accounts?fields=...instagram_business_
 * account), tapi field itu cuma disimpan, tidak pernah benar-benar dipakai
 * untuk menarik data Instagram apa pun. Ini pertama kalinya benar-benar
 * dipakai. Hanya berfungsi kalau (1) akun Meta Ads sudah terhubung, dan
 * (2) Instagram klinik sudah jadi akun Business/Creator yang ditautkan ke
 * Facebook Page yang dipakai connect — kalau salah satu tidak terpenuhi,
 * gagal dengan pesan jujur, bukan diam-diam pakai data lama/kosong.
 */
async function syncInstagramFromMeta() {
  const s = getMetaSettings();
  if (!s.access_token) {
    throw new Error('Akun Meta Ads belum terhubung. Sambungkan dulu lewat "Hubungkan Akun Meta Ads" di tab Marketing — token yang sama dipakai untuk menarik data Instagram.');
  }

  const igAccount = (s.connected_pages || []).find(p => p.instagram_id);
  if (!igAccount) {
    throw new Error('Tidak ada akun Instagram Business/Creator yang tertaut ke Facebook Page manapun pada akun Meta yang terhubung. Pastikan Instagram @kefirdermaclinic sudah diubah jadi akun Business/Creator dan ditautkan ke Facebook Page yang dipakai connect Meta Ads, lalu sambungkan ulang.');
  }

  const token = s.access_token;
  const igId = igAccount.instagram_id;

  let profileRes = null;
  let mediaList = [];
  let p = {};

  try {
    profileRes = await httpsRequest(`${GRAPH_BASE_URL}/${igId}?fields=username,name,followers_count,follows_count,media_count,profile_picture_url&access_token=${encodeURIComponent(token)}`);
    if (profileRes.status !== 200 || !profileRes.data || profileRes.data.error) {
      throw new Error(profileRes.data?.error?.message || 'Gagal mengambil data profil Instagram dari Graph API.');
    }
    p = profileRes.data;

    const mediaRes = await httpsRequest(`${GRAPH_BASE_URL}/${igId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=25&access_token=${encodeURIComponent(token)}`);
    mediaList = Array.isArray(mediaRes.data?.data) ? mediaRes.data.data.map(m => ({
      id: m.id,
      caption: m.caption || '',
      media_type: m.media_type,
      media_url: m.media_url || null,
      thumbnail_url: m.thumbnail_url || null,
      permalink: m.permalink,
      timestamp: m.timestamp,
      like_count: m.like_count ?? null,
      comments_count: m.comments_count ?? null
    })) : [];
  } catch (netErr) {
    // Dulu: saat offline dibuat profil pengganti (follower dari file lokal /
    // angka tetap 24.100, foto Unsplash) dan ditulis ke cache seolah hasil
    // Graph API. Sekarang gagal = gagal; cache sinkron terakhir yang asli
    // tidak disentuh dan tetap ditampilkan.
    if (isNetworkError(netErr)) {
      const last = getCachedInstagramMetaData();
      throw new Error(`${networkErrorMessage(netErr)}${last?.synced_at ? ` Data Instagram yang tampil masih hasil sinkron terakhir (${new Date(last.synced_at).toLocaleString('id-ID')}).` : ''}`);
    }
    throw netErr;
  }

  const synced = {
    instagram_id: igId,
    username: p.username || igAccount.instagram_username,
    name: p.name || null,
    followers_count: p.followers_count ?? null,
    follows_count: p.follows_count ?? null,
    media_count: p.media_count ?? null,
    profile_picture_url: p.profile_picture_url || null,
    recent_media: mediaList,
    synced_at: new Date().toISOString(),
    source: 'meta_graph_api'
  };

  fs.mkdirSync(path.dirname(INSTAGRAM_SYNCED_CACHE_FILE), { recursive: true });
  fs.writeFileSync(INSTAGRAM_SYNCED_CACHE_FILE, JSON.stringify(synced, null, 2), 'utf8');

  // Sinkronkan juga postingan terbaru Instagram ke published_posts.json
  // agar tabel live feed sosial media menampilkan postingan akun yang terhubung
  if (mediaList.length > 0) {
    try {
      const postsFile = path.join(__dirname, 'data', 'marketing_db', 'published_posts.json');
      let currentPosts = [];
      if (fs.existsSync(postsFile)) {
        currentPosts = JSON.parse(fs.readFileSync(postsFile, 'utf8') || '[]');
      }
      const nonIgPosts = currentPosts.filter(p => p.platform !== 'Instagram');
      const formattedIgPosts = mediaList.map((m, idx) => ({
        id: `IG-META-${m.id}`,
        platform: 'Instagram',
        post_type: m.media_type === 'VIDEO' ? 'IG Reels / Video' : (m.media_type === 'CAROUSEL_ALBUM' ? 'IG Carousel' : 'IG Post'),
        post_url: m.permalink || `https://www.instagram.com/p/${m.id}/`,
        thumbnail: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : null),
        title: (m.caption || '').split('\n')[0].substring(0, 80) || `Postingan Instagram #${idx + 1}`,
        published_at: m.timestamp ? new Date(m.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Baru saja',
        reach: null,
        views: null,
        likes: m.like_count != null ? m.like_count : 0,
        comments: m.comments_count != null ? m.comments_count : 0,
        shares: 0,
        saves: 0,
        engagement_rate: (m.like_count && synced.followers_count) ? ((m.like_count / synced.followers_count) * 100).toFixed(1) + '%' : '—',
        status: '🚀 Live Sync Meta'
      }));
      const combined = [...formattedIgPosts, ...nonIgPosts];
      fs.mkdirSync(path.dirname(postsFile), { recursive: true });
      fs.writeFileSync(postsFile, JSON.stringify(combined, null, 2), 'utf8');
    } catch (postErr) {
      console.error('Gagal memperbarui published_posts.json dari Meta IG:', postErr);
    }
  }

  return {
    success: true,
    message: `Berhasil sinkron profil Instagram @${synced.username || igAccount.instagram_username} dari Graph API (${synced.followers_count ?? '?'} followers, ${mediaList.length} postingan terbaru).`,
    data: synced
  };
}

function getCachedInstagramMetaData() {
  try {
    if (fs.existsSync(INSTAGRAM_SYNCED_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(INSTAGRAM_SYNCED_CACHE_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

/**
 * Test & Connect Meta Access Token directly (System User or User Token)
 * Validates token against Graph API /me and /me/adaccounts
 */
async function testAndConnectMetaToken(tokenInput, adAccountIdInput) {
  const token = (tokenInput || '').trim();
  if (!token) {
    throw new Error('Access Token Meta tidak boleh kosong.');
  }

  // Dulu: nilai awal di sini adalah akun iklan, Page, dan Instagram KARANGAN
  // ("KEFIR Derma Clinic — Official Ads", act_884920194821) yang tetap
  // disimpan sebagai "terhubung" kalau server offline. Sekarang semua nilai
  // hanya berasal dari Graph API; gangguan jaringan = koneksi gagal.
  let userName, userId, adAccounts, pages;
  let selectedAdAccount = (adAccountIdInput || '').trim() || null;
  const warnings = [];
  try {
    // 1. Validasi token & profil (/me)
    const meRes = await httpsRequest(`${GRAPH_BASE_URL}/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`);
    if (meRes.status !== 200 || !meRes.data || meRes.data.error) {
      const msg = meRes.data?.error?.message || 'Access Token Meta tidak valid atau sudah kedaluwarsa.';
      throw new Error(msg);
    }
    userName = meRes.data.name || 'Meta User / System User';
    userId = meRes.data.id || null;

    // 2. Daftar Ad Account (/me/adaccounts)
    const adAccountsRes = await httpsRequest(`${GRAPH_BASE_URL}/me/adaccounts?fields=id,account_id,name,currency,account_status,business&access_token=${encodeURIComponent(token)}`);
    if (adAccountsRes.data?.error) warnings.push(`Ad account tidak bisa dibaca: ${adAccountsRes.data.error.message}`);
    adAccounts = Array.isArray(adAccountsRes.data?.data) ? adAccountsRes.data.data.map(a => ({
      id: a.id,
      account_id: a.account_id,
      name: a.name || `Ad Account ${a.account_id}`,
      currency: a.currency || 'IDR',
      status: a.account_status === 1 ? 'ACTIVE' : 'INACTIVE',
      business_name: a.business?.name || null
    })) : [];
    if (!selectedAdAccount && adAccounts.length > 0) selectedAdAccount = adAccounts[0].id;

    // 3. Page & Instagram (/me/accounts)
    const pagesRes = await httpsRequest(`${GRAPH_BASE_URL}/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(token)}`);
    if (pagesRes.data?.error) warnings.push(`Page/Instagram tidak bisa dibaca: ${pagesRes.data.error.message}`);
    pages = Array.isArray(pagesRes.data?.data) ? pagesRes.data.data.map(p => ({
      page_id: p.id,
      page_name: p.name,
      instagram_id: p.instagram_business_account?.id || null,
      instagram_username: p.instagram_business_account?.username || null
    })) : [];
  } catch (netErr) {
    if (isNetworkError(netErr)) throw new Error(networkErrorMessage(netErr));
    throw netErr;
  }
  if (!selectedAdAccount) warnings.push('Token valid, tetapi tidak ada Ad Account yang bisa diakses token ini (cek akses System User / izin ads_read).');

  // Masa berlaku token yang SEBENARNYA (debug_token butuh App ID & Secret).
  // System User token tidak kedaluwarsa (expires_at = 0). Kalau tidak bisa
  // dicek, dibiarkan kosong — dulu diisi tebakan "60 hari".
  let tokenExpiresAt = null;
  let tokenNeverExpires = false;
  const cfg = getMetaSettings();
  const appId = cfg.app_id || process.env.META_APP_ID;
  const appSecret = cfg.app_secret || process.env.META_APP_SECRET;
  if (appId && appSecret) {
    try {
      const dbg = await httpsRequest(`${GRAPH_BASE_URL}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
      const exp = dbg.data?.data?.expires_at;
      if (exp === 0) tokenNeverExpires = true;
      else if (exp) tokenExpiresAt = new Date(exp * 1000).toISOString();
    } catch (e) { /* masa berlaku opsional */ }
  }

  const s = getMetaSettings();
  const updatedSettings = {
    ...s,
    access_token: token,
    user_name: userName,
    user_id: userId,
    ad_account_id: selectedAdAccount || s.ad_account_id || null,
    connected_ad_accounts: adAccounts,
    connected_pages: pages,
    token_expires_at: tokenExpiresAt,
    token_never_expires: tokenNeverExpires,
    connected: !!selectedAdAccount,
    updated_at: new Date().toISOString()
  };

  saveMetaSettings(updatedSettings);

  return {
    success: true,
    message: `Berhasil terhubung ke Meta sebagai "${userName}"!${warnings.length ? ` Catatan: ${warnings.join(' ')}` : ''}`,
    warnings,
    user_name: userName,
    user_id: userId,
    ad_accounts: adAccounts,
    selected_ad_account: selectedAdAccount,
    pages: pages,
    settings: getMetaSettingsSafe(updatedSettings)
  };
}

// ==================== ADS MANAGER (tampilan seperti Meta Ads Manager) ====================
// Data diambil langsung dari Graph API per level (campaign / adset / ad) dan
// rentang tanggal, lalu dihitung seperti kolom Ads Manager: Delivery, Results
// (mengikuti tujuan/optimization goal), Reach, Impressions, Cost per result,
// Amount spent, Ends. Reach total diambil dari tingkat akun karena reach
// tidak bisa dijumlahkan antar baris.
const ADS_MANAGER_PRESETS = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'maximum'];
const adsManagerCache = new Map();
const ADS_MANAGER_TTL_MS = 5 * 60 * 1000;

const RESULT_RULES = [
  { match: /MESSAG|CONVERSATION/, types: ['onsite_conversion.messaging_conversation_started_7d'], label: 'Percakapan dimulai' },
  { match: /LEAD/, types: ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'onsite_conversion.messaging_conversation_started_7d'], label: 'Lead' },
  { match: /SALES|CONVERSION|PURCHASE|VALUE/, types: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'], label: 'Pembelian' },
  { match: /TRAFFIC|LINK_CLICK|LANDING/, types: ['link_click', 'landing_page_view'], label: 'Klik tautan' },
  { match: /ENGAGEMENT|POST_ENGAGEMENT/, types: ['onsite_conversion.messaging_conversation_started_7d', 'post_engagement'], label: 'Interaksi' },
  { match: /VIDEO|THRUPLAY/, types: ['video_view'], label: 'Tayangan video' },
  { match: /AWARENESS|REACH|IMPRESSION/, types: ['__reach__'], label: 'Jangkauan' }
];

function pickResult(goal, actions, reach) {
  const list = Array.isArray(actions) ? actions : [];
  const val = t => { const a = list.find(x => x.action_type === t); return a ? Number(a.value) : null; };
  const g = String(goal || '').toUpperCase();
  const rule = RESULT_RULES.find(r => r.match.test(g));
  const candidates = rule ? [rule] : [];
  // Tanpa aturan yang cocok: pakai hasil pertama yang ada (urutan paling bernilai)
  if (!rule) candidates.push(...RESULT_RULES.filter(r => !r.types.includes('__reach__')));
  for (const r of candidates) {
    for (const t of r.types) {
      if (t === '__reach__') return { value: Number(reach || 0), label: r.label, type: 'reach' };
      const v = val(t);
      if (v !== null) return { value: v, label: r.label, type: t };
    }
  }
  return { value: 0, label: rule ? rule.label : 'Hasil', type: rule ? rule.types[0] : null };
}

function deliveryStatus(effective, endTime) {
  const s = String(effective || '').toUpperCase();
  if (endTime && Date.parse(endTime) < Date.now() && s === 'ACTIVE') return { key: 'completed', label: 'Selesai' };
  const map = {
    ACTIVE: ['active', 'Aktif'], PAUSED: ['off', 'Nonaktif'], CAMPAIGN_PAUSED: ['off', 'Kampanye nonaktif'],
    ADSET_PAUSED: ['off', 'Set iklan nonaktif'], ARCHIVED: ['archived', 'Diarsipkan'], DELETED: ['archived', 'Dihapus'],
    WITH_ISSUES: ['error', 'Bermasalah'], DISAPPROVED: ['error', 'Ditolak'], PENDING_REVIEW: ['review', 'Dalam peninjauan'],
    IN_PROCESS: ['review', 'Diproses'], PREAPPROVED: ['review', 'Disetujui awal'], PENDING_BILLING_INFO: ['error', 'Perlu info tagihan']
  };
  const m = map[s] || ['off', s ? s.replace(/_/g, ' ').toLowerCase() : '-'];
  return { key: m[0], label: m[1] };
}

const budgetOf = o => {
  if (o.daily_budget) return { amount: Number(o.daily_budget) / 100, period: 'Harian' };
  if (o.lifetime_budget) return { amount: Number(o.lifetime_budget) / 100, period: 'Total' };
  return null;
};

async function graphGetAll(url, maxPages = 5) {
  const out = [];
  let next = url;
  for (let i = 0; next && i < maxPages; i++) {
    const res = await httpsRequest(next);
    if (!res || res.data?.error) throw new Error(res?.data?.error?.message || 'Meta API error');
    out.push(...(res.data?.data || []));
    next = res.data?.paging?.next || null;
  }
  return out;
}

async function getAdsManagerData({ level = 'campaign', datePreset = 'last_30d', refresh = false } = {}) {
  const lv = ['campaign', 'adset', 'ad'].includes(level) ? level : 'campaign';
  const preset = ADS_MANAGER_PRESETS.includes(datePreset) ? datePreset : 'last_30d';
  const s = getMetaSettings();
  if (!s.access_token || !s.ad_account_id) throw new Error('Akun Meta Ads belum terhubung atau Ad Account ID belum dipilih.');
  const actId = s.ad_account_id.startsWith('act_') ? s.ad_account_id : `act_${s.ad_account_id}`;
  const key = `${actId}|${lv}|${preset}`;
  const cached = adsManagerCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < ADS_MANAGER_TTL_MS) return { ...cached.data, cached: true };

  const tk = `access_token=${encodeURIComponent(s.access_token)}`;
  const entityFields = {
    campaign: 'id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy',
    adset: 'id,name,campaign_id,campaign{name,objective},effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal',
    ad: 'id,name,campaign_id,adset_id,campaign{name,objective},adset{name,optimization_goal,end_time},effective_status,creative{thumbnail_url}'
  }[lv];
  const edge = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' }[lv];
  const idField = `${lv}_id`;
  const insightFields = `${idField},spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions`;

  const [entities, insights, accountRes, acctInfo] = await Promise.all([
    graphGetAll(`${GRAPH_BASE_URL}/${actId}/${edge}?fields=${entityFields}&limit=200&${tk}`),
    graphGetAll(`${GRAPH_BASE_URL}/${actId}/insights?level=${lv}&date_preset=${preset}&fields=${insightFields}&limit=500&${tk}`),
    httpsRequest(`${GRAPH_BASE_URL}/${actId}/insights?date_preset=${preset}&fields=spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions&${tk}`),
    httpsRequest(`${GRAPH_BASE_URL}/${actId}?fields=name,currency,account_status,timezone_name&${tk}`)
  ]);
  if (accountRes?.data?.error) throw new Error(accountRes.data.error.message);

  const insightById = {};
  insights.forEach(r => { insightById[r[idField]] = r; });

  const rows = entities.map(e => {
    const ins = insightById[e.id] || {};
    const goal = lv === 'campaign' ? e.objective : (lv === 'adset' ? (e.optimization_goal || e.campaign?.objective) : (e.adset?.optimization_goal || e.campaign?.objective));
    const reach = Number(ins.reach || 0);
    const spend = Number(ins.spend || 0);
    const result = pickResult(goal, ins.actions, reach);
    const end = e.stop_time || e.end_time || e.adset?.end_time || null;
    return {
      id: e.id,
      name: e.name,
      parent: lv === 'adset' ? e.campaign?.name : (lv === 'ad' ? `${e.campaign?.name || '-'} › ${e.adset?.name || '-'}` : null),
      delivery: deliveryStatus(e.effective_status, end),
      objective: goal || null,
      budget: lv === 'ad' ? null : budgetOf(e),
      results: result.value,
      result_label: result.label,
      result_type: result.type,
      reach,
      impressions: Number(ins.impressions || 0),
      frequency: Number(ins.frequency || 0),
      clicks: Number(ins.inline_link_clicks || ins.clicks || 0),
      ctr: Number(ins.ctr || 0),
      cpc: Number(ins.cpc || 0),
      cpm: Number(ins.cpm || 0),
      spend,
      cost_per_result: result.value > 0 ? spend / result.value : null,
      starts: e.start_time || null,
      ends: end,
      thumbnail: e.creative?.thumbnail_url || null
    };
  }).sort((a, b) => ((b.delivery.key === 'active') - (a.delivery.key === 'active')) || (b.spend - a.spend));

  const acc = (Array.isArray(accountRes?.data?.data) && accountRes.data.data[0]) || {};
  const resultTypes = new Set(rows.filter(r => r.results > 0).map(r => r.result_type));
  const totalResults = resultTypes.size === 1 ? rows.reduce((a, r) => a + r.results, 0) : null;
  const totalSpend = Number(acc.spend || rows.reduce((a, r) => a + r.spend, 0));

  const data = {
    level: lv,
    date_preset: preset,
    fetched_at: new Date().toISOString(),
    account: {
      id: actId,
      name: acctInfo?.data?.name || null,
      currency: acctInfo?.data?.currency || 'IDR',
      timezone: acctInfo?.data?.timezone_name || null
    },
    totals: {
      results: totalResults,
      result_label: resultTypes.size === 1 ? rows.find(r => r.results > 0).result_label : (resultTypes.size > 1 ? 'Beragam jenis hasil' : null),
      reach: Number(acc.reach || 0),
      impressions: Number(acc.impressions || 0),
      frequency: Number(acc.frequency || 0),
      clicks: Number(acc.inline_link_clicks || acc.clicks || 0),
      ctr: Number(acc.ctr || 0),
      cpc: Number(acc.cpc || 0),
      cpm: Number(acc.cpm || 0),
      spend: totalSpend,
      cost_per_result: totalResults ? totalSpend / totalResults : null
    },
    rows
  };
  adsManagerCache.set(key, { at: Date.now(), data });
  return data;
}

// Cadangan saat Graph API gagal (mis. token kedaluwarsa): tampilkan data
// sinkronisasi terakhir dalam format Ads Manager, tingkat campaign saja.
function adsManagerFromCache(level, errorMessage) {
  const c = getCachedMetaAdsData();
  const expired = /expired|session has expired|validating access token/i.test(String(errorMessage || ''));
  const base = {
    level,
    stale: true,
    error: expired
      ? 'Token Meta sudah kedaluwarsa. Sambungkan ulang akun Meta di bagian "Koneksi Akun Meta" di bawah untuk data terbaru.'
      : `Data live Meta belum bisa diambil: ${errorMessage}`,
    fetched_at: c?.synced_at || null,
    account: { id: c?.ad_account_id || null, name: null, currency: 'IDR' }
  };
  if (!c || level !== 'campaign') {
    return { ...base, rows: [], totals: null, note: level !== 'campaign' ? 'Data ad set & iklan hanya tersedia saat terhubung live.' : null };
  }
  const rows = (c.campaigns || []).map(x => {
    const results = Number(x.purchase_count || 0);
    const spend = Number(x.spend || 0);
    const goal = x.objective || '';
    const rule = RESULT_RULES.find(r => r.match.test(String(goal).toUpperCase()));
    return {
      id: x.id, name: x.name, parent: null,
      delivery: deliveryStatus(x.status, null),
      objective: goal,
      budget: x.daily_budget ? { amount: Number(x.daily_budget), period: 'Harian' } : null,
      results, result_label: rule ? rule.label : 'Hasil', result_type: rule ? rule.types[0] : null,
      reach: null, impressions: Number(x.impressions || 0), frequency: null,
      clicks: Number(x.clicks || 0), ctr: parseFloat(x.ctr) || 0, cpc: null, cpm: null,
      spend, cost_per_result: results > 0 ? spend / results : null, starts: null, ends: null, thumbnail: null
    };
  }).sort((a, b) => ((b.delivery.key === 'active') - (a.delivery.key === 'active')) || (b.spend - a.spend));
  // Seperti Ads Manager: hasil hanya dijumlahkan kalau jenisnya sama
  const types = new Set(rows.filter(r => r.results > 0).map(r => r.result_type));
  const totalResults = types.size === 1 ? rows.reduce((a, r) => a + r.results, 0) : null;
  const totalSpend = Number(c.total_spend || 0);
  return {
    ...base,
    date_preset: 'maximum',
    rows,
    totals: {
      results: totalResults,
      result_label: types.size === 1 ? rows.find(r => r.results > 0).result_label : (types.size > 1 ? 'Beragam jenis hasil' : null),
      reach: null,
      impressions: Number(c.total_impressions || 0), clicks: Number(c.total_clicks || 0),
      ctr: parseFloat(c.overall_ctr) || 0, spend: totalSpend,
      cost_per_result: totalResults ? totalSpend / totalResults : null
    }
  };
}

module.exports = {
  getAdsManagerData,
  adsManagerFromCache,
  getMetaSettings,
  saveMetaSettings,
  getMetaSettingsSafe,
  getMetaOAuthUrl,
  handleMetaOAuthCallback,
  testAndConnectMetaToken,
  disconnectMeta,
  updateMetaConfig,
  syncMetaMarketingData,
  getCachedMetaAdsData,
  syncInstagramFromMeta,
  getCachedInstagramMetaData
};
