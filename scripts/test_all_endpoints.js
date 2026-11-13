const handler = require('../api/index');
const { EventEmitter } = require('events');

function testEndpoint(url) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.url = '/api/index.js?__url=' + encodeURIComponent(url);
    req.method = 'GET';
    req.headers = { authorization: 'Bearer preview_token' };
    
    let statusCode = 200;
    let body = '';
    const res = {
      writeHead(code) { statusCode = code; },
      setHeader() {},
      end(chunk) { if (chunk) body += chunk; resolve({ url, statusCode, length: body.length, body }); }
    };
    handler(req, res);
  });
}

const endpoints = [
  '/api/summary?start=2026-11-01&end=2026-11-30',
  '/api/summary?period=all',
  '/api/contraindications',
  '/api/sop-exceptions',
  '/api/nurse-upsell/list',
  '/api/pharmacy/bhp-standard',
  '/api/pharmacy/bom',
  '/api/pharmacy/transfer-recommendations',
  '/api/marketing/promos',
  '/api/feedback/patient',
  '/api/feedback/summary',
  '/api/crm/spending-tier-patients',
  '/api/doctor-recommendations',
  '/api/hr/disciplinary',
  '/api/sales/bottom-prices',
  '/api/price-master',
  '/api/sales/appointments?date=2026-11-13',
  '/api/sales/unused-packages',
  '/api/finance/reconciliation?period=2026-11',
  '/api/meta-ads/settings',
  '/api/gaji-id/settings'
];

async function runAll() {
  console.log('Testing all REAL frontend API endpoints...');
  let allPass = true;
  for (const ep of endpoints) {
    const r = await testEndpoint(ep);
    let parsedOk = false;
    let count = '-';
    try {
      const data = JSON.parse(r.body);
      parsedOk = true;
      if (Array.isArray(data)) count = `${data.length} items`;
      else if (data.data && Array.isArray(data.data)) count = `${data.data.length} items (data)`;
      else if (data.rows && Array.isArray(data.rows)) count = `${data.rows.length} rows`;
      else if (data.packages && Array.isArray(data.packages)) count = `${data.packages.length} packages`;
      else count = 'object OK';
    } catch(e) {}
    const pass = r.statusCode === 200 && parsedOk;
    if (!pass) allPass = false;
    console.log(`[HTTP ${r.statusCode}] ${ep} -> ${pass ? `✅ ${count}` : `❌ FAILED (${r.body.slice(0, 80)})`}`);
  }
  console.log(allPass ? '\n🎉 ALL 21 FRONTEND ENDPOINTS PASSED WITH 200 OK & DUMMY DATA!' : '\n⚠️ SOME ENDPOINTS FAILED');
}

runAll();
