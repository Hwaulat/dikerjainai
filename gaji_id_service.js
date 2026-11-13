/**
 * GAJI.ID LIVE SYNC & RECONCILIATION ENGINE
 * PT Kefir House / Kefir Derma Clinic (Depok & Pondok Kopi)
 * Connects directly to Gaji.id V2 API (member.gaji.id)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GAJI_SETTINGS_FILE = path.join(__dirname, 'data', 'gaji_id_settings.json');
const GAJI_DB_PATH = path.join(__dirname, 'data', 'gaji_id_db.json');

const GAJI_BASE_AUTH = 'https://member.gaji.id/gaji-id-auth-api';
const GAJI_BASE_API = 'https://member.gaji.id/gajiid-API';

/**
 * HTTPS helper for JSON requests
 */
function httpsJsonRequest(url, method = 'GET', data = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const payload = data ? JSON.stringify(data) : null;

      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...customHeaders
      };

      if (payload && (method === 'POST' || method === 'PUT')) {
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: headers,
        timeout: 20000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            parsed = body;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: parsed
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Koneksi ke server Gaji.id timeout (20s).'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Load Gaji.id connection settings
 */
function getGajiSettings() {
  // Default = belum terhubung. Dulu default-nya "terhubung" dengan token
  // palsu (AUTO_CONNECTED_...) dan 38 karyawan, sehingga dashboard selalu
  // mengira Gaji.id tersambung.
  const defaultSettings = {
    connected: false,
    username: null,
    company_code: 'c0000706',
    token: null,
    last_sync: null,
    total_employees_synced: 0,
    updated_at: null
  };

  try {
    if (fs.existsSync(GAJI_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(GAJI_SETTINGS_FILE, 'utf8'));
      if (parsed && typeof parsed.connected === 'boolean') {
        const merged = { ...defaultSettings, ...parsed };
        // Token placeholder lama bukan token Gaji.id sungguhan
        if (!merged.token || /^AUTO_CONNECTED/.test(merged.token)) merged.connected = false;
        return merged;
      }
    }
  } catch (e) {}

  return defaultSettings;
}

/**
 * Save Gaji.id connection settings
 */
function saveGajiSettings(settings) {
  try {
    const dir = path.dirname(GAJI_SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GAJI_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving Gaji.id settings:', e);
    return false;
  }
}

/**
 * Safe settings for frontend (hides raw token)
 */
function getGajiSettingsSafe() {
  const s = getGajiSettings();
  return {
    connected: !!s.connected,
    username: s.username || null,
    company_code: s.company_code || 'c0000706',
    last_sync: s.last_sync || null,
    last_sync_error: s.last_sync_error || null,
    total_employees_synced: s.connected ? (s.total_employees_synced || 0) : 0,
    updated_at: s.updated_at || null
  };
}

/**
 * Login to Gaji.id using Username and Password
 */
async function loginGajiId(username, password, companyCode = 'c0000706') {
  if (!username || !password) {
    throw new Error('Username/Email dan Password Gaji.id wajib diisi.');
  }

  const cleanUser = username.trim();
  const cleanPass = password.trim();

  // 1. Validation check
  try {
    const valRes = await httpsJsonRequest(
      `${GAJI_BASE_API}/public/token/validation`,
      'POST',
      { username: cleanUser }
    );
    // Even if validation returns ok/warning, proceed to token request
  } catch (e) {
    // Non-blocking network error for validation
  }

  // 2. Request Token — mode admin (HR) dulu: mode karyawan (admin:false)
  // hanya melihat data akun itu sendiri, bukan seluruh staf.
  let asAdmin = true;
  let authRes = await httpsJsonRequest(`${GAJI_BASE_AUTH}/public/token/request`, 'POST', { username: cleanUser, password: cleanPass, admin: true });
  if (authRes.statusCode !== 200 || !authRes.data?.data?.token) {
    asAdmin = false;
    authRes = await httpsJsonRequest(`${GAJI_BASE_AUTH}/public/token/request`, 'POST', { username: cleanUser, password: cleanPass, admin: false });
  }

  if (authRes.statusCode !== 200 || !authRes.data?.data?.token) {
    const errMsg = (authRes.data?.errors && authRes.data.errors.length > 0)
      ? authRes.data.errors[0].desc || authRes.data.errors[0].code
      : `Login Gaji.id gagal (HTTP ${authRes.statusCode})`;
    throw new Error(errMsg);
  }

  const token = authRes.data.data.token;

  // 3. Test token by fetching profile/employee
  const testRes = await httpsJsonRequest(
    `${GAJI_BASE_API}/private/employee?limit=5`,
    'GET',
    null,
    {
      'X-Auth-Token': token,
      'Language': 'ID'
    }
  );

  let empCount = 0;
  if (testRes.statusCode === 200 && Array.isArray(testRes.data?.data)) {
    empCount = testRes.data.data.length;
  }

  // 4. Save settings
  const settings = {
    connected: true,
    username: cleanUser,
    company_code: companyCode.trim(),
    token: token,
    last_sync: new Date().toISOString(),
    total_employees_synced: empCount,
    admin_mode: asAdmin,
    updated_at: new Date().toISOString()
  };
  saveGajiSettings(settings);

  return {
    success: true,
    message: asAdmin ? 'Berhasil terhubung ke akun Gaji.id KEFIR (mode admin HR).' : 'Terhubung ke Gaji.id dalam mode karyawan — akun ini bukan admin HR, jadi hanya data akun sendiri yang terlihat.',
    settings: getGajiSettingsSafe()
  };
}

/**
 * Connect directly using existing X-Auth-Token
 */
async function connectDirectToken(tokenInput, usernameInput = 'hrd.kefirhouse@gmail.com') {
  if (!tokenInput || typeof tokenInput !== 'string') {
    throw new Error('Token X-Auth-Token Gaji.id wajib diisi.');
  }

  const cleanToken = tokenInput.trim();

  // Test token with Gaji.id private endpoint
  const testRes = await httpsJsonRequest(
    `${GAJI_BASE_API}/private/employee?limit=5`,
    'GET',
    null,
    {
      'X-Auth-Token': cleanToken,
      'Language': 'ID'
    }
  );

  if (testRes.statusCode === 401 || testRes.statusCode === 403) {
    throw new Error('Token Gaji.id tidak valid atau sesi telah berakhir (HTTP 401).');
  }

  let empCount = 0;
  if (testRes.statusCode === 200 && Array.isArray(testRes.data?.data)) {
    empCount = testRes.data.data.length;
  }

  const settings = {
    connected: true,
    username: usernameInput ? usernameInput.trim() : 'hrd.kefirhouse@gmail.com',
    company_code: 'c0000706',
    token: cleanToken,
    last_sync: new Date().toISOString(),
    total_employees_synced: empCount,
    updated_at: new Date().toISOString()
  };
  saveGajiSettings(settings);

  return {
    success: true,
    message: 'Koneksi token Gaji.id berhasil diverifikasi!',
    settings: getGajiSettingsSafe()
  };
}

/**
 * Disconnect Gaji.id
 */
function disconnectGajiId() {
  const reset = {
    connected: false,
    username: null,
    company_code: 'c0000706',
    token: null,
    last_sync: null,
    total_employees_synced: 0,
    updated_at: new Date().toISOString()
  };
  saveGajiSettings(reset);
  return { success: true, message: 'Koneksi Gaji.id berhasil diputuskan.' };
}

/**
 * Sync Live Attendance and Roster from Gaji.id
 */
async function syncGajiAttendance() {
  const s = getGajiSettings();
  if (!s.connected || !s.token) {
    throw new Error('Akun Gaji.id belum terhubung. Silakan login atau hubungkan token terlebih dahulu.');
  }
  const headers = { 'X-Auth-Token': s.token, 'Language': 'ID' };
  const fail = (msg) => {
    s.last_sync_error = msg;
    if (/401|403/.test(msg)) s.connected = false;
    saveGajiSettings(s);
    throw new Error(msg);
  };

  // 1. Daftar karyawan
  let empRes;
  try { empRes = await httpsJsonRequest(`${GAJI_BASE_API}/private/employee?page=0&perPage=500`, 'GET', null, headers); }
  catch (e) { fail(`Gaji.id tidak bisa dihubungi: ${e.message}`); }
  if (empRes.statusCode === 401 || empRes.statusCode === 403) fail('Token Gaji.id ditolak (HTTP 401) — silakan login ulang.');
  // Format Gaji.id: data.employees (daftar) atau data.employee (satu akun sendiri)
  const ed = empRes.data?.data;
  const employees = Array.isArray(ed) ? ed : Array.isArray(ed?.employees) ? ed.employees : Array.isArray(ed?.employee) ? ed.employee : ed?.employee ? [ed.employee] : null;
  if (empRes.statusCode !== 200 || !employees) fail(`Daftar karyawan Gaji.id gagal diambil (HTTP ${empRes.statusCode}${empRes.data?.errors?.[0]?.desc ? ': ' + empRes.data.errors[0].desc : ''}).`);
  if (!s.admin_mode && employees.length <= 1) fail('Akun Gaji.id ini login sebagai karyawan, bukan admin HR — hanya data akun sendiri yang terlihat. Login dengan akun admin HR Gaji.id.');

  // 2. Absensi harian (hari ini, WIB)
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  let attendanceRows = [];
  let attendanceError = null;
  try {
    const attRes = await httpsJsonRequest(`${GAJI_BASE_API}/private/absensiHarian?tanggal=${today}`, 'GET', null, headers);
    if (attRes.statusCode === 200 && Array.isArray(attRes.data?.data)) attendanceRows = attRes.data.data;
    else attendanceError = `HTTP ${attRes.statusCode}`;
  } catch (e) { attendanceError = e.message; }

  // 3. Simpan data apa adanya — absensi per tanggal diakumulasi
  let db = {};
  try { if (fs.existsSync(GAJI_DB_PATH)) db = JSON.parse(fs.readFileSync(GAJI_DB_PATH, 'utf8')) || {}; } catch (e) { db = {}; }
  db.employees = employees;
  db.attendance_by_date = db.attendance_by_date || {};
  if (!attendanceError) db.attendance_by_date[today] = attendanceRows;
  db.synced_at = new Date().toISOString();
  fs.writeFileSync(GAJI_DB_PATH + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(GAJI_DB_PATH + '.tmp', GAJI_DB_PATH);

  s.last_sync = db.synced_at;
  s.last_sync_error = attendanceError ? `Absensi harian gagal diambil (${attendanceError})` : null;
  s.total_employees_synced = employees.length;
  saveGajiSettings(s);

  return {
    success: true,
    message: `Sinkronisasi Gaji.id berhasil: ${employees.length} karyawan${attendanceError ? ', absensi harian gagal diambil' : `, ${attendanceRows.length} baris absensi ${today}`}.`,
    synced_at: s.last_sync,
    total_employees: employees.length,
    attendance_count: attendanceRows.length
  };
}

/**
 * Main Data Provider for HR Dashboard & AI Assistant
 */
function getGajiIdData() {
  const settings = getGajiSettingsSafe();
  let db = null;
  try { if (fs.existsSync(GAJI_DB_PATH)) db = JSON.parse(fs.readFileSync(GAJI_DB_PATH, 'utf8')); } catch (e) { db = null; }
  const employees = (db && Array.isArray(db.employees)) ? db.employees : [];
  const byDate = (db && db.attendance_by_date) || {};
  const dates = Object.keys(byDate).sort();
  const latest = dates.length ? dates[dates.length - 1] : null;
  return {
    settings,
    // available hanya kalau benar-benar ada hasil sync tersimpan
    available: !!(settings.connected && db && employees.length),
    synced_at: db ? db.synced_at || null : null,
    employees,
    attendance_dates: dates,
    latest_attendance_date: latest,
    latest_attendance: latest ? byDate[latest] : [],
    attendance_by_date: byDate
  };
}

module.exports = {
  getGajiIdData,
  getGajiSettings,
  getGajiSettingsSafe,
  loginGajiId,
  connectDirectToken,
  disconnectGajiId,
  syncGajiAttendance
};
