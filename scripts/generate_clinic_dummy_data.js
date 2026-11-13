const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const NEOSOFT_DIR = path.join(ROOT_DIR, 'data', 'neosoft_db');
const GOOGLE_SHEETS_DIR = path.join(ROOT_DIR, 'data', 'google_sheets_db');
const OPERATIONAL_DIR = path.join(ROOT_DIR, 'data', 'operational_db');
const MARKETING_DIR = path.join(ROOT_DIR, 'data', 'marketing_db');
const GOOGLE_MAPS_DIR = path.join(ROOT_DIR, 'data', 'google_maps_db');
const DATA_DIR = path.join(ROOT_DIR, 'data');

[NEOSOFT_DIR, GOOGLE_SHEETS_DIR, OPERATIONAL_DIR, MARKETING_DIR, GOOGLE_MAPS_DIR, DATA_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

console.log('🚀 Generating comprehensive dummy data for KEFIR Derma Clinic...');

// ==========================================
// 1. DOCTOR TYPES & THERAPISTS / STAFF
// ==========================================
const doctortypes = [
  { id: 1, name: "Dokter Penanggung Jawab" },
  { id: 2, name: "Dokter Estetika" },
  { id: 3, name: "Dokter Sp.D.V.E" },
  { id: 4, name: "Dokter Umum" },
  { id: 5, name: "Perawat / Nurse" },
  { id: 6, name: "Terapis Medis" }
];

const therapists = [
  { id: 1, therapist_name: "dr. Cindy Novita", therapist_type: 2, outlet_id: 1, phone: "628112233441", is_active: 1, status_therapist: true, role: 'doctor' },
  { id: 2, therapist_name: "dr. Farah Diba Sp.D.V.E", therapist_type: 3, outlet_id: 1, phone: "628112233442", is_active: 1, status_therapist: true, role: 'doctor' },
  { id: 3, therapist_name: "dr. Randy Wijaya", therapist_type: 2, outlet_id: 2, phone: "628112233443", is_active: 1, status_therapist: true, role: 'doctor' },
  { id: 4, therapist_name: "dr. Amanda Putri", therapist_type: 2, outlet_id: 2, phone: "628112233444", is_active: 1, status_therapist: true, role: 'doctor' },
  { id: 5, therapist_name: "Suster Maya Kusuma", therapist_type: 5, outlet_id: 1, phone: "628112233445", is_active: 1, status_therapist: true, role: 'nurse' },
  { id: 6, therapist_name: "Suster Rina Anggraini", therapist_type: 5, outlet_id: 1, phone: "628112233446", is_active: 1, status_therapist: true, role: 'nurse' },
  { id: 7, therapist_name: "Terapis Dewi Lestari", therapist_type: 5, outlet_id: 2, phone: "628112233447", is_active: 1, status_therapist: true, role: 'therapist' },
  { id: 8, therapist_name: "Terapis Salsa Nabila", therapist_type: 5, outlet_id: 2, phone: "628112233448", is_active: 1, status_therapist: true, role: 'therapist' }
];

// ==========================================
// 2. UOMS, SUPPLIERS, BANKS
// ==========================================
const uoms = [
  { id: 1, display: "Pcs", smallest_unit: "Pcs" },
  { id: 2, display: "Box", smallest_unit: "Box" },
  { id: 3, display: "Pot", smallest_unit: "Pot" },
  { id: 4, display: "Ampul", smallest_unit: "Ampul" },
  { id: 5, display: "Vial", smallest_unit: "Vial" }
];

const suppliers = [
  { id: 1, name: "PT IDS Medical Systems Indonesia" },
  { id: 2, name: "PT Kimia Farma Medika" },
  { id: 3, name: "PT Regen Prime Aesthetics" },
  { id: 4, name: "PT Harsen Laboratories" },
  { id: 5, name: "PT Kalbe Farma Tbk" }
];

const banks = [
  { id: 1, name: "BCA EDC - Depok", account_number: "8800112233", bank_type: 1 },
  { id: 2, name: "Mandiri QRIS - Depok", account_number: "15700998877", bank_type: 3 },
  { id: 3, name: "BCA EDC - Pondok Kopi", account_number: "8800445566", bank_type: 1 },
  { id: 4, name: "Mandiri QRIS - Pondok Kopi", account_number: "15700223344", bank_type: 3 }
];

// ==========================================
// 3. PRODUCTS & TREATMENTS
// ==========================================
let products = [];
const priceMasterPath = path.join(DATA_DIR, 'price_master.json');
if (fs.existsSync(priceMasterPath)) {
  try {
    const pm = JSON.parse(fs.readFileSync(priceMasterPath, 'utf8'));
    (pm.items || []).forEach((item, idx) => {
      products.push({
        id: item.product_id || (idx + 1),
        product_treatment_code: item.product_code || `T-${26050000 + idx}`,
        product_treatment_name: item.name || item.product_name,
        product_treatment_category_name: item.category || 'Treatment',
        price: item.list_price || 350000,
        cogs: Math.round((item.list_price || 350000) * 0.25),
        status: 1
      });
    });
  } catch (e) {}
}

if (products.length === 0) {
  products = [
    { id: 1, product_treatment_code: "T-001", product_treatment_name: "Pico Glow Laser Treatment", product_treatment_category_name: "Laser", price: 1250000, cogs: 280000, status: 1 },
    { id: 2, product_treatment_code: "T-002", product_treatment_name: "HydraFacial Deep Cleansing", product_treatment_category_name: "Facial", price: 650000, cogs: 120000, status: 1 },
    { id: 3, product_treatment_code: "T-003", product_treatment_name: "Rejuran Healer Salmon DNA 2cc", product_treatment_category_name: "Skinbooster Premium", price: 3850000, cogs: 1350000, status: 1 },
    { id: 4, product_treatment_code: "T-004", product_treatment_name: "Kefir Phyto Derma Facial", product_treatment_category_name: "Facial", price: 195000, cogs: 45000, status: 1 },
    { id: 5, product_treatment_code: "T-005", product_treatment_name: "Meso Glow Brightening Cocktail", product_treatment_category_name: "Meso", price: 850000, cogs: 180000, status: 1 },
    { id: 6, product_treatment_code: "T-006", product_treatment_name: "Alma Harmony Rejuvenation Laser", product_treatment_category_name: "Laser", price: 1450000, cogs: 320000, status: 1 },
    { id: 7, product_treatment_code: "T-007", product_treatment_name: "Acne Clear Cauter & Peeling", product_treatment_category_name: "Peeling", price: 450000, cogs: 95000, status: 1 }
  ];
}

const skincareProducts = [
  { id: 901, product_treatment_code: "P-101", product_treatment_name: "Kefir Daily UV Sunscreen SPF 50+ 30ml", product_treatment_category_name: "Homecare Skincare", price: 165000, cogs: 55000, status: 1 },
  { id: 902, product_treatment_code: "P-102", product_treatment_name: "Kefir Brightening Night Cream 15g", product_treatment_category_name: "Homecare Skincare", price: 185000, cogs: 62000, status: 1 },
  { id: 903, product_treatment_code: "P-103", product_treatment_name: "Kefir Gentle Hydrating Facial Wash 100ml", product_treatment_category_name: "Homecare Skincare", price: 125000, cogs: 38000, status: 1 },
  { id: 904, product_treatment_code: "P-104", product_treatment_name: "Kefir Cica Barrier Soothing Toner 100ml", product_treatment_category_name: "Homecare Skincare", price: 145000, cogs: 44000, status: 1 },
  { id: 905, product_treatment_code: "P-105", product_treatment_name: "Kefir Advanced Glow Serum Salmon DNA 20ml", product_treatment_category_name: "Homecare Skincare", price: 285000, cogs: 88000, status: 1 },
  { id: 906, product_treatment_code: "P-106", product_treatment_name: "Kefir Acne Clarifying BHA Serum 20ml", product_treatment_category_name: "Homecare Skincare", price: 225000, cogs: 68000, status: 1 },
  { id: 907, product_treatment_code: "P-107", product_treatment_name: "Kefir Ceramide Deep Moisture Cream 30g", product_treatment_category_name: "Homecare Skincare", price: 195000, cogs: 58000, status: 1 }
];
products.push(...skincareProducts);

// ==========================================
// 4. CUSTOMERS (90 Patients)
// Half joined in 2025/early 2026 (Returning) and half joined recently (New)
// ==========================================
const firstNames = ["Anisa", "Siti", "Rina", "Dian", "Bunga", "Maya", "Nadia", "Clarissa", "Aurelia", "Putri", "Jessica", "Fitri", "Desi", "Wulan", "Tania", "Melati", "Ratna", "Indah", "Shinta", "Gita", "Tiara", "Lestari", "Kiki", "Natasya", "Rizky", "Kevin", "Dimas", "Bagas", "Aldo", "Reza"];
const lastNames = ["Safitri", "Rahmawati", "Nuraini", "Paramita", "Citra", "Kartika", "Salsabila", "Valerie", "Natasha", "Wulandari", "Tan", "Handayani", "Pratama", "Kusuma", "Anggraini", "Wijaya", "Siregar", "Lubis", "Hidayat", "Santoso", "Saputra", "Utami", "Dewi", "Pratiwi", "Mulyani"];

const customers = [];
for (let i = 1; i <= 90; i++) {
  const fn = firstNames[(i - 1) % firstNames.length];
  const ln = lastNames[(i * 3) % lastNames.length];
  const outletId = (i % 2 === 0) ? 2 : 1;
  const birthMonth = String((i % 12) + 1).padStart(2, '0');
  const birthDay = String((i % 28) + 1).padStart(2, '0');
  const birthYear = 1985 + (i % 20);

  // Set join dates: 60% returning (2025 or early 2026), 40% new (Aug-Nov 2026)
  const isReturning = i <= 55;
  const joinDate = isReturning ? `2025-0${(i % 9) + 1}-10 09:30:00` : `2026-10-0${(i % 9) + 1} 11:00:00`;
  const firstVisit = isReturning ? `2025-0${(i % 9) + 1}-10` : `2026-10-0${(i % 9) + 1}`;

  customers.push({
    id: i,
    code: `EM-2605${String(i).padStart(5, '0')}`,
    name: { first_name: fn, middle_name: "", last_name: ln },
    phone: `62812${String(90000000 + i * 11111).slice(0, 8)}`,
    gender: (i % 7 === 0) ? "Male" : "Female",
    birth_date: `${birthYear}-${birthMonth}-${birthDay}`,
    origin_outlet_id: outletId,
    join_date: joinDate,
    first_visit_date: firstVisit,
    membership_status: i <= 15 ? "Platinum VIP" : (i <= 40 ? "Gold Member" : "Silver Member")
  });
}

// ==========================================
// 5. INVOICES, USAGES, & PAYMENT REPORT
// ==========================================
const invoices = [];
const usages = [];
const usages_details = [];
const paymentReport = {
  "2026-08": [],
  "2026-09": [],
  "2026-10": [],
  "2026-11": []
};

const paymodes = ["bca", "mandiri", "qris", "cash", "credit_card"];

// Date range: 1 Aug 2026 to 13 Nov 2026
const startDate = new Date(2026, 7, 1);
const endDate = new Date(2026, 10, 13);
const totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));

let invIdCounter = 1001;
let usageIdCounter = 1;
let detailIdCounter = 1;

for (let d = 0; d <= totalDays; d++) {
  const curDate = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
  const yyyy = curDate.getFullYear();
  const mm = String(curDate.getMonth() + 1).padStart(2, '0');
  const dd = String(curDate.getDate()).padStart(2, '0');
  const monthKey = `${yyyy}-${mm}`;
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // 3-6 transactions per day
  const txCount = 3 + (d % 4);

  for (let t = 0; t < txCount; t++) {
    const outletId = (t % 2 === 0) ? 1 : 2;
    const branchCode = outletId === 1 ? 'D' : 'P';
    const branchName = outletId === 1 ? 'Kefir Derma Clinic Depok' : 'Kefir Derma Clinic Pondok Kopi';
    const hour = 10 + Math.floor((t * 2.2) % 10);
    const minute = (t * 17) % 60;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    const fullDateTime = `${dateStr} ${timeStr}`;

    // Before November (d < 92), only pick from first 55 customers so customers 56-90 are brand new in November
    const custPool = (curDate.getMonth() === 10) ? customers : customers.slice(0, 55);
    const cust = custPool[(invIdCounter * 7) % custPool.length];
    const docId = outletId === 1 ? ((t % 2 === 0) ? 1 : 2) : ((t % 2 === 0) ? 3 : 4);
    const thId = outletId === 1 ? ((t % 2 === 0) ? 5 : 6) : ((t % 2 === 0) ? 7 : 8);

    const tItem = products[(invIdCounter + t * 3) % products.length];
    const addSkincare = (t % 2 === 1);
    const sItem = addSkincare ? skincareProducts[(t * 2) % skincareProducts.length] : null;

    const totalAmt = (tItem.price || 500000) + (sItem ? sItem.price : 0);
    const invCode = `INV-${branchCode}-${yyyy.toString().slice(2)}${mm}${dd}-${String(t + 1).padStart(4, '0')}`;

    // Occasional unpaid invoice (for Reminders tab)
    const isUnpaid = (d >= totalDays - 5 && t === 0 && d % 2 === 0);
    const remainingAmt = isUnpaid ? Math.round(totalAmt * 0.5) : 0;
    const paidAmt = totalAmt - remainingAmt;

    // Rare void invoice (for void anomaly detection)
    const isVoid = (d === 15 || d === 60) && t === 0;

    const inv = {
      id: invIdCounter,
      inv_code: invCode,
      inv_date: fullDateTime,
      created_at: fullDateTime,
      customer_id: cust.id,
      outlet_id: outletId,
      doctor_id: docId,
      therapist_id: thId,
      total: totalAmt,
      total_after_tax: totalAmt,
      remaining: remainingAmt,
      paymode: paymodes[(invIdCounter) % paymodes.length],
      void_invoice: isVoid,
      is_void: isVoid
    };

    invoices.push(inv);

    // USAGE HEADER
    const uCode = `USG-${branchCode}-${yyyy.toString().slice(2)}${mm}${dd}-${String(t + 1).padStart(4, '0')}`;
    usages.push({
      id: usageIdCounter,
      usage_code: uCode,
      inv_code: invCode,
      customer_id: cust.id,
      outlet_id: outletId,
      is_void: isVoid ? 1 : 0,
      date: fullDateTime
    });

    // USAGE DETAILS
    usages_details.push({
      id: detailIdCounter++,
      usage_id: usageIdCounter,
      inv_code: invCode,
      product_id: tItem.id,
      used: 1,
      value: tItem.price
    });

    if (sItem) {
      usages_details.push({
        id: detailIdCounter++,
        usage_id: usageIdCounter,
        inv_code: invCode,
        product_id: sItem.id,
        used: 1,
        value: sItem.price
      });
    }

    // PAYMENT REPORT ENTRY
    if (!isVoid && paidAmt > 0 && paymentReport[monthKey]) {
      const bankId = outletId === 1 ? (t % 2 === 0 ? 1 : 2) : (t % 2 === 0 ? 3 : 4);
      const bObj = banks.find(b => b.id === bankId) || banks[0];
      paymentReport[monthKey].push({
        id_invoice: invIdCounter,
        inv_code: invCode,
        outlet_name: branchName,
        inv_date: fullDateTime,
        payment: [
          {
            amount: paidAmt,
            paid_date: fullDateTime,
            bank_id: bObj.id,
            bank_name: bObj.name,
            bank_type: bObj.bank_type,
            info: "payment"
          }
        ]
      });
    }

    invIdCounter++;
    usageIdCounter++;
  }
}

// ==========================================
// 6. APPOINTMENTS (Full Calendar)
// ==========================================
const appointmentsAll = [];
const apptRooms = [
  { id: 1, name: "Ruang Laser Pico 1 (DPK)" },
  { id: 2, name: "Ruang Facial & Estetika 1 (DPK)" },
  { id: 3, name: "Ruang Konsultasi dr. Cindy (DPK)" },
  { id: 4, name: "Ruang Laser Alma 1 (PDK)" },
  { id: 5, name: "Ruang Facial VIP (PDK)" }
];

const apptDays = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
let apptIdCounter = 1;

apptDays.forEach((dStr, dayIdx) => {
  const isPast = dayIdx < 3;
  const isToday = dayIdx === 3;

  for (let s = 0; s < 6; s++) {
    const cust = customers[(s * 7 + dayIdx * 3) % customers.length];
    const room = apptRooms[s % apptRooms.length];
    const outletId = s >= 3 ? 2 : 1;
    const doc = therapists[s % 4];
    const tItem = products[(s * 4 + dayIdx) % 15];
    const hour = 10 + s * 2;
    const comeDate = `${dStr} ${String(hour).padStart(2, '0')}:00:00`;

    const statusAppt = isPast ? 2 : (isToday ? (s < 3 ? 2 : 1) : 1);
    const statusName = isPast ? "Finished" : (isToday ? (s < 3 ? "Finished" : "Waiting") : "Confirmed");

    appointmentsAll.push({
      id_appointment: apptIdCounter++,
      id_room: room.id,
      room_name: room.name,
      outlet_id: outletId,
      come_date: comeDate,
      customer_id: cust.id,
      patient: {
        id: cust.id,
        name: `${cust.name.first_name} ${cust.name.last_name}`,
        phone: cust.phone,
        code: cust.code
      },
      doctor_id: doc.id,
      doctor_name: doc.therapist_name,
      treatment_name: tItem.product_treatment_name,
      status_appointment: statusAppt,
      status: statusName,
      status_name: statusAppt === 2 ? "Attended (Selesai)" : "Confirmed (Terjadwal)",
      status_color: { name: statusName },
      note: `Konsultasi & Tindakan ${tItem.product_treatment_name}`
    });
  }
});

// ==========================================
// 7. COMMISSION REPORT
// ==========================================
const commissionReport = {
  treatment: {
    "2026-11": [
      { therapist_id: 1, therapist_name: "dr. Cindy Novita", date: "2026-11-12", total_commission: 14500000, is_doctor: true },
      { therapist_id: 2, therapist_name: "dr. Farah Diba Sp.D.V.E", date: "2026-11-12", total_commission: 16800000, is_doctor: true },
      { therapist_id: 3, therapist_name: "dr. Randy Wijaya", date: "2026-11-12", total_commission: 13200000, is_doctor: true },
      { therapist_id: 4, therapist_name: "dr. Amanda Putri", date: "2026-11-12", total_commission: 11900000, is_doctor: true },
      { therapist_id: 5, therapist_name: "Suster Maya Kusuma", date: "2026-11-12", total_commission: 3400000, therapist_type: 5 },
      { therapist_id: 6, therapist_name: "Suster Rina Anggraini", date: "2026-11-12", total_commission: 3100000, therapist_type: 5 },
      { therapist_id: 7, therapist_name: "Terapis Dewi Lestari", date: "2026-11-12", total_commission: 3250000, therapist_type: 5 },
      { therapist_id: 8, therapist_name: "Terapis Salsa Nabila", date: "2026-11-12", total_commission: 2950000, therapist_type: 5 }
    ],
    "2026-10": [
      { therapist_id: 1, therapist_name: "dr. Cindy Novita", date: "2026-10-25", total_commission: 18500000, is_doctor: true },
      { therapist_id: 2, therapist_name: "dr. Farah Diba Sp.D.V.E", date: "2026-10-25", total_commission: 21200000, is_doctor: true },
      { therapist_id: 3, therapist_name: "dr. Randy Wijaya", date: "2026-10-25", total_commission: 16800000, is_doctor: true },
      { therapist_id: 4, therapist_name: "dr. Amanda Putri", date: "2026-10-25", total_commission: 15400000, is_doctor: true },
      { therapist_id: 5, therapist_name: "Suster Maya Kusuma", date: "2026-10-25", total_commission: 4200000, therapist_type: 5 },
      { therapist_id: 6, therapist_name: "Suster Rina Anggraini", date: "2026-10-25", total_commission: 3900000, therapist_type: 5 },
      { therapist_id: 7, therapist_name: "Terapis Dewi Lestari", date: "2026-10-25", total_commission: 4100000, therapist_type: 5 },
      { therapist_id: 8, therapist_name: "Terapis Salsa Nabila", date: "2026-10-25", total_commission: 3800000, therapist_type: 5 }
    ]
  },
  sales: {
    "2026-11": [
      { therapist_id: 1, therapist_type: 2, date: "2026-11-12", total_commission: 2250000 },
      { therapist_id: 2, therapist_type: 2, date: "2026-11-12", total_commission: 2600000 },
      { therapist_id: 3, therapist_type: 2, date: "2026-11-12", total_commission: 1950000 },
      { therapist_id: 4, therapist_type: 2, date: "2026-11-12", total_commission: 1850000 }
    ],
    "2026-10": [
      { therapist_id: 1, therapist_type: 2, date: "2026-10-25", total_commission: 2850000 },
      { therapist_id: 2, therapist_type: 2, date: "2026-10-25", total_commission: 3100000 },
      { therapist_id: 3, therapist_type: 2, date: "2026-10-25", total_commission: 2450000 },
      { therapist_id: 4, therapist_type: 2, date: "2026-10-25", total_commission: 2350000 }
    ]
  }
};

// ==========================================
// 8. MEDICAL RECORDS & UNPAID NOTIFICATIONS
// ==========================================
const medicalRecords = {
  synced_at: "2026-11-13T10:00:00Z",
  fetched_customers: {},
  records: []
};

for (let m = 1; m <= 30; m++) {
  const cust = customers[(m * 3) % customers.length];
  medicalRecords.fetched_customers[cust.id] = true;
  const doc = therapists[m % 4];
  const outletId = (m % 2 === 0) ? 2 : 1;
  const invMatch = invoices.find(i => i.customer_id === cust.id && !i.void_invoice);

  medicalRecords.records.push({
    id: m,
    code: `MR-2611-${String(m).padStart(4, '0')}`,
    customer_id: cust.id,
    outlet_id: outletId,
    date: `2026-11-0${(m % 9) + 1} 13:30:00`,
    doctor_id: doc.id,
    doctor_name: doc.therapist_name,
    anamnesa: "Keluhan hiperpigmentasi post-inflamasi dan pori-pori melebar di area T-zone.",
    diagnosis: "Post-Inflammatory Hyperpigmentation (PIH) + Seborrheic Skin",
    therapy: "Pico Glow Laser Sesi 1 + Serum Salmon DNA Booster",
    inv_code: invMatch ? invMatch.inv_code : `INV-D-26110${(m % 9) + 1}-0001`
  });
}

const notificationUnpaid = [
  { id: 1, patient_id: 12, full_name: "Jessica Tan", patient_code: "EM-260500012", code: "ANM-2611-0012", date: "2026-11-11 11:30:00" },
  { id: 2, patient_id: 25, full_name: "Rizky Hidayat", patient_code: "EM-260500025", code: "ANM-2611-0025", date: "2026-11-12 15:00:00" },
  { id: 3, patient_id: 38, full_name: "Tania Wijaya", patient_code: "EM-260500038", code: "ANM-2611-0038", date: "2026-11-13 09:45:00" }
];

// ==========================================
// 9. PHYSICAL EXAMINATION (Clinical Photos)
// ==========================================
const physicalexamination = [];
for (let p = 1; p <= 40; p++) {
  const cust = customers[(p * 2) % customers.length];
  const outletId = (p % 2 === 0) ? 2 : 1;
  const day = `2026-11-0${(p % 9) + 1}`;
  
  // Before photo
  physicalexamination.push({
    id: p * 2 - 1,
    customer_id: cust.id,
    outlet_id: outletId,
    examination_date: `${day} 10:15:00`,
    description: "Foto Klinis Sebelum Tindakan (Before Photo) - Tampak Depan & Oblique Kanan",
    doctor_id: (p % 4) + 1,
    created_at: `${day} 10:15:00`
  });

  // After photo
  physicalexamination.push({
    id: p * 2,
    customer_id: cust.id,
    outlet_id: outletId,
    examination_date: `${day} 11:45:00`,
    description: "Foto Klinis Selesai Tindakan (After Photo) - Post Pico Laser & Masker Calming",
    doctor_id: (p % 4) + 1,
    created_at: `${day} 11:45:00`
  });
}

// ==========================================
// 10. PACKAGE BALANCES & PACKAGES (Unused Packages)
// ==========================================
const validTreatments = products.filter(p => String(p.product_treatment_code || '').startsWith('T-'));
const t0 = validTreatments[0] || { id: 1, product_treatment_code: 'T-001', product_treatment_name: 'Pico Glow Laser', price: 1250000 };
const t1 = validTreatments[1] || { id: 2, product_treatment_code: 'T-002', product_treatment_name: 'HydraFacial', price: 650000 };
const t2 = validTreatments[2] || { id: 3, product_treatment_code: 'T-003', product_treatment_name: 'Rejuran Salmon DNA', price: 3850000 };
const t3 = validTreatments[3] || { id: 4, product_treatment_code: 'T-004', product_treatment_name: 'Phyto Derma Facial', price: 195000 };

const packageBalances = {
  synced_at: "2026-11-13T10:00:00Z",
  packages: [
    { customer_id: 1, product_id: t0.id, inv_code: "INV-D-261015-0001", inv_date: "2026-10-15", expired_date: "2027-10-15", remaining: 3, used: 2, outlet_id: 1 },
    { customer_id: 2, product_id: t2.id, inv_code: "INV-D-260920-0002", inv_date: "2026-09-20", expired_date: "2027-09-20", remaining: 1, used: 2, outlet_id: 1 },
    { customer_id: 5, product_id: t1.id, inv_code: "INV-P-261025-0003", inv_date: "2026-10-25", expired_date: "2027-10-25", remaining: 4, used: 1, outlet_id: 2 },
    { customer_id: 8, product_id: t0.id, inv_code: "INV-D-261102-0004", inv_date: "2026-11-02", expired_date: "2027-11-02", remaining: 2, used: 3, outlet_id: 1 },
    { customer_id: 12, product_id: t1.id, inv_code: "INV-P-261010-0005", inv_date: "2026-10-10", expired_date: "2027-10-10", remaining: 3, used: 1, outlet_id: 2 },
    { customer_id: 18, product_id: t3.id, inv_code: "INV-D-261020-0006", inv_date: "2026-10-20", expired_date: "2027-10-20", remaining: 2, used: 2, outlet_id: 1 },
    { customer_id: 24, product_id: t2.id, inv_code: "INV-P-261101-0007", inv_date: "2026-11-01", expired_date: "2027-11-01", remaining: 2, used: 1, outlet_id: 2 }
  ],
  invoices: {
    "INV-D-261015-0001": {
      customer_id: 1, inv_code: "INV-D-261015-0001", inv_date: "2026-10-15", expired_date: "2027-10-15",
      lines: [{ product_id: t0.id, item_code: t0.product_treatment_code, price: t0.price, qty: 5, remaining: 3, used: 2, subtotal: t0.price * 4.5 }]
    },
    "INV-D-260920-0002": {
      customer_id: 2, inv_code: "INV-D-260920-0002", inv_date: "2026-09-20", expired_date: "2027-09-20",
      lines: [{ product_id: t2.id, item_code: t2.product_treatment_code, price: t2.price, qty: 3, remaining: 1, used: 2, subtotal: t2.price * 2.7 }]
    },
    "INV-P-261025-0003": {
      customer_id: 5, inv_code: "INV-P-261025-0003", inv_date: "2026-10-25", expired_date: "2027-10-25",
      lines: [{ product_id: t1.id, item_code: t1.product_treatment_code, price: t1.price, qty: 5, remaining: 4, used: 1, subtotal: t1.price * 4.5 }]
    },
    "INV-D-261102-0004": {
      customer_id: 8, inv_code: "INV-D-261102-0004", inv_date: "2026-11-02", expired_date: "2027-11-02",
      lines: [{ product_id: t0.id, item_code: t0.product_treatment_code, price: t0.price, qty: 5, remaining: 2, used: 3, subtotal: t0.price * 4.5 }]
    },
    "INV-P-261010-0005": {
      customer_id: 12, inv_code: "INV-P-261010-0005", inv_date: "2026-10-10", expired_date: "2027-10-10",
      lines: [{ product_id: t1.id, item_code: t1.product_treatment_code, price: t1.price, qty: 4, remaining: 3, used: 1, subtotal: t1.price * 3.6 }]
    },
    "INV-D-261020-0006": {
      customer_id: 18, inv_code: "INV-D-261020-0006", inv_date: "2026-10-20", expired_date: "2027-10-20",
      lines: [{ product_id: t3.id, item_code: t3.product_treatment_code, price: t3.price, qty: 4, remaining: 2, used: 2, subtotal: t3.price * 3.6 }]
    },
    "INV-P-261101-0007": {
      customer_id: 24, inv_code: "INV-P-261101-0007", inv_date: "2026-11-01", expired_date: "2027-11-01",
      lines: [{ product_id: t2.id, item_code: t2.product_treatment_code, price: t2.price, qty: 3, remaining: 2, used: 1, subtotal: t2.price * 2.7 }]
    }
  }
};

const manualUnredeemed = [
  { id: 1, patient_name: "Clarissa Valerie", phone: "6281298765408", branch: "Depok", treatment: "Pico Glow Laser Treatment", remaining: 3, total_sessions: 5, inv_code: "INV-D-261015-0001", last_visit: "2026-11-02", status: "Aktif" },
  { id: 2, patient_name: "Bunga Citra", phone: "6281298765414", branch: "Depok", treatment: "HydraFacial Deep Cleansing", remaining: 2, total_sessions: 4, inv_code: "INV-D-261010-0008", last_visit: "2026-10-28", status: "Aktif" },
  { id: 3, patient_name: "Nadia Salsabila", phone: "6281298765422", branch: "Pondok Kopi", treatment: "Rejuran Healer Salmon DNA", remaining: 2, total_sessions: 3, inv_code: "INV-P-261101-0007", last_visit: "2026-11-08", status: "Aktif" },
  { id: 4, patient_name: "Putri Wulandari", phone: "6281298765431", branch: "Depok", treatment: "Alma Harmony Rejuvenation Laser", remaining: 4, total_sessions: 5, inv_code: "INV-D-261025-0009", last_visit: "2026-11-01", status: "Aktif" }
];

// ==========================================
// 11. DEPOSITS & CREDIT VOUCHERS
// ==========================================
const depositMutations = [
  { id: 1, customer_id: 1, outlet_id: 1, date: "2026-11-01 10:00:00", mutation_type: "topup", amount: 2000000, counted: true, notes: "Topup Deposit Membership Platinum" },
  { id: 2, customer_id: 10, outlet_id: 2, date: "2026-11-03 14:00:00", mutation_type: "topup", amount: 1500000, counted: true, notes: "Topup Deposit Gold Member" },
  { id: 3, customer_id: 15, outlet_id: 1, date: "2026-11-06 16:30:00", mutation_type: "topup", amount: 3000000, counted: true, notes: "Topup Deposit Treatment Series" },
  { id: 4, customer_id: 22, outlet_id: 2, date: "2026-11-09 11:15:00", mutation_type: "topup", amount: 1000000, counted: true, notes: "Topup Deposit Reguler" }
];

const creditVouchers = [
  { id: 1, customer_id: 1, voucher_code: "CV-2611-001", amount: 250000, balance: 250000, expired_date: "2027-12-31", status: "Active" },
  { id: 2, customer_id: 5, voucher_code: "CV-2611-002", amount: 500000, balance: 500000, expired_date: "2027-12-31", status: "Active" },
  { id: 3, customer_id: 8, voucher_code: "CV-2611-003", amount: 200000, balance: 200000, expired_date: "2027-06-30", status: "Active" },
  { id: 4, customer_id: 14, voucher_code: "CV-2611-004", amount: 300000, balance: 300000, expired_date: "2027-06-30", status: "Active" }
];

// ==========================================
// 12. LOGISTICS / STOCK CARD / PHARMACY
// ==========================================
const logisticsItems = [
  { id: 1, sales_information_id: 1, item_code: "BHP-001", name: "Kasa Steril 7.5 x 7.5cm (Kotak)", stock: 48, min_stock: 20, uom: "Box", cogs: 25000, supplier: "PT Kimia Farma Medika" },
  { id: 2, sales_information_id: 2, item_code: "BHP-002", name: "Jarum BD PrecisionGlide 30G x 1/2", stock: 8, min_stock: 25, uom: "Box", cogs: 85000, supplier: "PT IDS Medical Systems" },
  { id: 3, sales_information_id: 3, item_code: "BHP-003", name: "Spuit Syringe 1cc Terumo Ultra", stock: 120, min_stock: 50, uom: "Pcs", cogs: 4500, supplier: "PT IDS Medical Systems" },
  { id: 4, sales_information_id: 4, item_code: "BHP-004", name: "Krim Anestesi Topikal Lidocaine 10.56% 500g", stock: 3, min_stock: 2, uom: "Pot", cogs: 650000, supplier: "PT Harsen Laboratories" },
  { id: 5, sales_information_id: 5, item_code: "BHP-005", name: "Serum PDRN Salmon DNA Rejuran Healer 2ml", stock: 6, min_stock: 10, uom: "Ampul", cogs: 1200000, supplier: "PT Regen Prime Aesthetics" },
  { id: 6, sales_information_id: 6, item_code: "BHP-006", name: "Handscoon Nitrile Non-Powder M (Sens)", stock: 35, min_stock: 15, uom: "Box", cogs: 48000, supplier: "PT Kimia Farma Medika" },
  { id: 7, sales_information_id: 7, item_code: "BHP-007", name: "Alcohol Swabs 70% BD", stock: 18, min_stock: 10, uom: "Box", cogs: 18000, supplier: "PT Kimia Farma Medika" },
  { id: 8, sales_information_id: 8, item_code: "BHP-008", name: "Tip Laser Pico Toning Disposible", stock: 14, min_stock: 10, uom: "Pcs", cogs: 175000, supplier: "PT IDS Medical Systems" }
];

const stockCard = [];
const warehouses = ["Gudang Farmasi Depok", "Gudang Farmasi Pondok Kopi"];

logisticsItems.forEach((item, idx) => {
  warehouses.forEach((wh, whIdx) => {
    // Current stock card row
    const isPdk = whIdx === 1;
    const stockQty = Math.round(item.stock * (isPdk ? 0.45 : 0.55));
    const expDate = idx === 1 ? "2026-12-15" : (idx === 4 ? "2027-01-20" : "2027-08-30");

    stockCard.push({
      id: stockCard.length + 1,
      sales_information_id: item.sales_information_id,
      code: item.item_code,
      name: item.name,
      warehouse: wh,
      category: ["BHP"],
      uom: item.uom,
      cogs: item.cogs,
      batch_number: `BCH-26${idx + 1}${whIdx}`,
      date: "2026-11-10 09:00:00",
      expired_at: expDate,
      expiry_date: expDate,
      stock_in: 20,
      stock_out: 5,
      current_stock: stockQty,
      transaction: "USAGE PEMAKAIAN KLINIK"
    });
  });
});

const stockBufferAlerts = [
  { item_id: 2, item_code: "BHP-002", name: "Jarum BD PrecisionGlide 30G x 1/2", buffer_stock: 25, current_stock: 8, status: "LOW_STOCK" },
  { item_id: 5, item_code: "BHP-005", name: "Serum PDRN Salmon DNA Rejuran Healer 2ml", buffer_stock: 10, current_stock: 6, status: "LOW_STOCK" }
];

const stockOpname = [
  { item_code: "BHP-001", name: "Kasa Steril 7.5 x 7.5cm (Kotak)", warehouse: "Depok", system_stock: 26, physical_stock: 26, variance: 0, date: "2026-11-01" },
  { item_code: "BHP-003", name: "Spuit Syringe 1cc Terumo Ultra", warehouse: "Depok", system_stock: 66, physical_stock: 65, variance: -1, date: "2026-11-01" },
  { item_code: "BHP-006", name: "Handscoon Nitrile Non-Powder M (Sens)", warehouse: "Pondok Kopi", system_stock: 16, physical_stock: 16, variance: 0, date: "2026-11-01" }
];

const purchaseOrders = [
  { id: "PO-2611-001", date: "2026-11-05", supplier: "PT IDS Medical Systems", branch: "Depok", total_items: 2, total_amount: 3250000, status: "Approved" },
  { id: "PO-2611-002", date: "2026-11-08", supplier: "PT Regen Prime Aesthetics", branch: "Pondok Kopi", total_items: 1, total_amount: 12000000, status: "Delivered" },
  { id: "PO-2611-003", date: "2026-11-11", supplier: "PT Kimia Farma Medika", branch: "Depok", total_items: 4, total_amount: 1850000, status: "Pending Approval" }
];

// Per-outlet pricing
const productOutletPrices = [];
products.forEach(p => {
  productOutletPrices.push({ product_id: p.id, outlet_id: 1, price: p.price, status: 1 });
  productOutletPrices.push({ product_id: p.id, outlet_id: 2, price: p.price, status: 1 });
});

// Sync Meta
const syncMeta = {
  status: "success",
  health: "healthy",
  endpoints_ok: 12,
  endpoints_total: 12,
  last_sync_timestamp: new Date().toISOString(),
  last_sync_formatted: "13 Nov 2026, 16:00 WIB",
  last_sync: new Date().toISOString()
};

// ==========================================
// 13. GOOGLE SHEETS DB (Operational & Transactions)
// ==========================================
const operationalAssets = {
  synced_at: "2026-11-13T10:00:00Z",
  preventive_maintenance: [
    { asset_name: "Laser Pico Nd:YAG", branch: "Depok", vendor: "PT IDS Medical Systems", last_maintenance: "2026-09-10", next_due: "2026-12-10", frequency: "Triwulan (3 Bulan)", activity: "Kalibrasi handpiece laser & pembersihan optical lens" },
    { asset_name: "HydraFacial MD Elite", branch: "Depok", vendor: "PT Regen Prime", last_maintenance: "2026-10-05", next_due: "2026-11-20", frequency: "Bulanan", activity: "Deep flush sistem tube & desinfeksi vacuum motor" },
    { asset_name: "Alma Harmony XL Pro", branch: "Pondok Kopi", vendor: "PT IDS Medical Systems", last_maintenance: "2026-08-15", next_due: "2026-11-25", frequency: "Triwulan (3 Bulan)", activity: "Pengecekan cooling chiller & daya tembak flash lamp" },
    { asset_name: "Autoclave Sterilizer Kelas B", branch: "Depok", vendor: "PT Kalbe Farma", last_maintenance: "2026-10-12", next_due: "2026-11-18", frequency: "Bulanan", activity: "Uji Bowie-Dick test & penggantian gasket pintu" },
    { asset_name: "Cauter Radiofrequency Electrosurgical", branch: "Pondok Kopi", vendor: "PT Medika Jaya", last_maintenance: "2026-09-20", next_due: "2026-12-20", frequency: "Triwulan", activity: "Kalibrasi impedansi daya & kabel grounding" }
  ],
  assets_inventory: [
    { name: "Laser Pico Nd:YAG 1064nm", brand_type: "Wontech Picocare 450", qty: 1, location: "Depok - Ruang Tindakan Medis 1", purchase_date: "2024-03-15", condition: "Prima / Beroperasi Baik" },
    { name: "Alma Harmony XL Pro Dye-VL", brand_type: "Alma Lasers Harmony", qty: 1, location: "Pondok Kopi - Ruang Laser", purchase_date: "2024-06-20", condition: "Prima / Beroperasi Baik" },
    { name: "HydraFacial MD Elite", brand_type: "Edge Systems HydraFacial", qty: 2, location: "Depok & Pondok Kopi", purchase_date: "2024-01-10", condition: "Baik" },
    { name: "Skin Analyzer 3D Magic Mirror", brand_type: "Visia 8th Gen", qty: 2, location: "Ruang Konsultasi Dokter", purchase_date: "2024-05-10", condition: "Baik" },
    { name: "Centrifuge PRP Zenith Medika", brand_type: "Hermle Z206A", qty: 2, location: "Laboratorium Mini", purchase_date: "2024-04-12", condition: "Baik" }
  ]
};

// CRM Recent Transactions for Depok & Pondok Kopi
const buildSheetTx = (branchPrefix, branchName) => {
  const res = {
    recent_transactions_nov26: [],
    recent_transactions_okt26: [],
    recent_transactions_sep26: [],
    recent_transactions_agu26: [],
    unused_packages_deposits: []
  };

  invoices.filter(i => !i.void_invoice).slice(0, 120).forEach(inv => {
    const cust = customers.find(c => c.id === inv.customer_id);
    const m = inv.inv_date.slice(5, 7);
    let key = "recent_transactions_nov26";
    if (m === "10") key = "recent_transactions_okt26";
    else if (m === "09") key = "recent_transactions_sep26";
    else if (m === "08") key = "recent_transactions_agu26";

    const item = {
      invoice: inv.inv_code,
      patient_name: cust ? `${cust.name.first_name} ${cust.name.last_name}` : 'Pasien',
      phone: cust ? cust.phone : '',
      treatment: "Pico Glow Laser Treatment",
      branch: branchName,
      nominal: inv.total,
      date: inv.inv_date.slice(0, 10),
      is_unused: false
    };

    res[key].push(item);
  });

  return res;
};

const depokTransactions = buildSheetTx('D', 'Depok');
const pondokkopiTransactions = buildSheetTx('P', 'Pondok Kopi');

// Marketing Price Sheets
const priceSheets = {
  synced_at: "2026-11-13T10:00:00Z",
  sources: [
    {
      key: "nov-2026",
      campaign: "Promo Glow November 2026",
      period: { start: "2026-11-01", end: "2026-11-30" },
      audience: "all",
      terms: ["Berlaku di Depok & Pondok Kopi", "Wajib reservasi H-1 via WhatsApp", "Tidak dapat digabung promo lain"],
      items: [
        { name: "Pico Glow Laser Treatment", normal: 1250000, promo: 950000, bottom: 850000, bv: 280000, benefit: "Free Sheet Mask + Calming Cream" },
        { name: "HydraFacial Deep Cleansing", normal: 650000, promo: 499000, bottom: 450000, bv: 120000, benefit: "Free LED Therapy 15 Menit" },
        { name: "Rejuran Healer Salmon DNA 2cc", normal: 3850000, promo: 3200000, bottom: 2900000, bv: 1350000, benefit: "Free Recovery Meso Mask" },
        { name: "Kefir Phyto Derma Facial", normal: 195000, promo: 150000, bottom: 135000, bv: 45000, benefit: "Free Ekstraksi Komedo Ringan" },
        { name: "Alma Harmony Rejuvenation Laser", normal: 1450000, promo: 1100000, bottom: 990000, bv: 320000, benefit: "Free Antioksidan Serum Infusion" }
      ],
      issues: []
    }
  ]
};

const syncSummary = {
  last_synced_at: "2026-11-13T10:00:00Z",
  status: "OK",
  sheets: ["Depok Transactions", "Pondok Kopi Transactions", "Operational Assets", "Price Sheets"]
};

// ==========================================
// 14. OPERATIONAL DB (Complaints, SOP Audits)
// ==========================================
const teamComplaints = [
  {
    id: "TC-2611-001",
    branch: "Depok",
    raw_text: "[Ulasan Rating Rendah: ⭐3/5 | NPS: 7] Waktu tunggu konsultasi agak lama sekitar 25 menit karena ada tindakan pasien sebelumnya yang mundur. Pelayanan dokter tetap ramah dan solutif.",
    status: "Resolved",
    ai_analysis: {
      category: "Waiting Time & Scheduling",
      priority: "P2 - HIGH",
      sla: "Maksimal 6 Jam",
      impact: "Kepuasan Pasien & Efisiensi Ruang Tunggu",
      action_recommendation: "Sesuaikan buffer time antar sesi laser dari 10 menit menjadi 15 menit pada jam sibuk (14:00 - 17:00)."
    },
    rca: "Pasien sebelumnya memerlukan anestesi topikal tambahan 15 menit karena ambang nyeri rendah.",
    capa: "Briefing perawat untuk cek riwayat toleransi nyeri pasien saat pre-treatment assesment.",
    pic: "dr. Cindy Novita / Clinic Head Depok",
    resolution_notes: "Pasien sudah dihubungi via WA dan diberikan complimentary eye treatment pada kunjungan berikutnya.",
    created_at: "2026-11-08T14:30:00Z"
  },
  {
    id: "TC-2611-002",
    branch: "Pondok Kopi",
    raw_text: "[Ulasan Rating Rendah: ⭐3/5 | NPS: 8] Area parkir Pondok Kopi saat weekend agak padat. Fasilitas klinik di dalam sangat nyaman dan bersih.",
    status: "Open",
    ai_analysis: {
      category: "Facility & Parking Access",
      priority: "P3 - MEDIUM",
      sla: "Maksimal 24 Jam",
      impact: "Kenyamanan Akses Pasien",
      action_recommendation: "Koordinasikan dengan petugas keamanan gedung sebelah untuk opsi vallet/overflow parking weekend."
    },
    rca: "Lonjakan kunjungan weekend Sabtu sore bersamaan dengan reservasi facial.",
    capa: "Pemasangan signage arahan parkir tambahan dan koordinasi sekuriti.",
    pic: "Operational Lead PDK",
    resolution_notes: "Sedang dalam penjajakan MoU slot parkir cadangan.",
    created_at: "2026-11-11T16:00:00Z"
  }
];

const sopChecklists = [
  {
    id: "SOP-CHK-DPK-01",
    branch: "Depok",
    shift: "Shift Pagi (09:00 - 15:00)",
    date: "2026-11-13",
    auditor: "Suster Maya Kusuma",
    compliance_score: 100,
    items: [
      { item: "Sterilisasi handpiece laser Pico dengan alkohol 70% & optical wipe", status: "Pass" },
      { item: "Pengecekan suhu chiller mesin laser Alma (18-20°C)", status: "Pass" },
      { item: "Kalibrasi autoclave dan uji strip indikator steril", status: "Pass" },
      { item: "Kerapian & higienitas linen bed facial per pasien baru", status: "Pass" },
      { item: "Pemeriksaan expired date BHP di trolley tindakan", status: "Pass" }
    ]
  },
  {
    id: "SOP-CHK-PDK-01",
    branch: "Pondok Kopi",
    shift: "Shift Pagi (09:00 - 15:00)",
    date: "2026-11-13",
    auditor: "Terapis Dewi Lestari",
    compliance_score: 95,
    items: [
      { item: "Pembersihan jarum suction HydraFacial & desinfeksi tabung", status: "Pass" },
      { item: "Kesiapan emergency kit & injeksi antihistamin di ruang dokter", status: "Pass" },
      { item: "Kelengkapan form informed consent sebelum tindakan invasive", status: "Pass" },
      { item: "Pengecekan stok krim anestesi topikal", status: "Pass" },
      { item: "Pembersihan filter udara HEPA ruang tindakan", status: "Pass" }
    ]
  },
  {
    id: "SOP-CHK-DPK-02",
    branch: "Depok",
    shift: "Shift Sore (15:00 - 21:00)",
    date: "2026-11-12",
    auditor: "Suster Rina Anggraini",
    compliance_score: 100,
    items: [
      { item: "Disinfeksi seluruh ruangan tindakan & sinar UV 30 menit", status: "Pass" },
      { item: "Pencatatan sisa BHP & penutupan safety box jarum medis", status: "Pass" },
      { item: "Penguncian lemari obat keras & skinbooster kulkas 2-8°C", status: "Pass" }
    ]
  }
];

const sopExceptions = [
  {
    id: "SOPE-001",
    date: "2026-11-10",
    doctor_name: "dr. Cindy Novita",
    patient_name: "Clarissa Valerie",
    treatment_name: "Pico Glow Laser Treatment",
    deviation_reason: "Penurunan fluence laser dari 1.8 J/cm² ke 1.4 J/cm² karena pasien baru kembali dari liburan pantai dengan paparan matahari intens.",
    supervisor_approved: true,
    supervisor_notes: "Disetujui untuk mencegah hiperpigmentasi reaktif."
  },
  {
    id: "SOPE-002",
    date: "2026-11-08",
    doctor_name: "dr. Randy Wijaya",
    patient_name: "Nadia Salsabila",
    treatment_name: "Rejuran Healer Salmon DNA",
    deviation_reason: "Aplikasi anestesi topikal diperpanjang dari 30 menit menjadi 45 menit atas permintaan pasien dengan riwayat sensitif nyeri.",
    supervisor_approved: true,
    supervisor_notes: "Disetujui, kondisi kulit dipantau tidak ada eritema berlebih."
  }
];

const hrDisciplinary = [
  {
    id: "DISC-001",
    staff_name: "Budi Santoso",
    staff_role: "Staff Front Office",
    date: "2026-11-04",
    violation_type: "Keterlambatan Masuk Shift",
    sp_level: "Teguran Lisan",
    description: "Terlambat hadir shift pagi 25 menit sebanyak 2 kali dalam 1 minggu.",
    status: "Active",
    action_taken: "Konseling kedisiplinan dan penyesuaian jadwal komuter.",
    valid_until: "2027-02-04",
    created_by: "HR Management"
  }
];

// ==========================================
// 15. FINANCE (Closings, Petty Cash, Costs, Quotes)
// ==========================================
const cashierClosings = [
  { id: "CL-2026-11-12-DPK", date: "2026-11-12", branch: "Depok", cash: 3200000, edc: 12500000, qris: 4800000, transfer: 2500000, notes: "Closing shift 2 selesai, setoran fisik klop.", entered_by: "Kasir Depok", entered_at: "2026-11-12T21:15:00Z" },
  { id: "CL-2026-11-12-PDK", date: "2026-11-12", branch: "Pondok Kopi", cash: 2100000, edc: 9800000, qris: 3900000, transfer: 1500000, notes: "Semua settlement batch EDC approved.", entered_by: "Kasir PDK", entered_at: "2026-11-12T21:10:00Z" },
  { id: "CL-2026-11-11-DPK", date: "2026-11-11", branch: "Depok", cash: 2800000, edc: 11200000, qris: 4200000, transfer: 1800000, notes: "Kliring harian sesuai.", entered_by: "Kasir Depok", entered_at: "2026-11-11T21:05:00Z" },
  { id: "CL-2026-11-11-PDK", date: "2026-11-11", branch: "Pondok Kopi", cash: 1950000, edc: 8900000, qris: 3100000, transfer: 1200000, notes: "Semua batch klop.", entered_by: "Kasir PDK", entered_at: "2026-11-11T21:00:00Z" }
];

const pettyCashEntries = [
  { id: "PC-001", period: "2026-11", date: "2026-11-02", description: "Beli Air Mineral Galon Aqua & Kopi Ruang Tunggu VIP", amount: 185000, category: "Konsumsi Pasien", added_by: "Front Office Depok" },
  { id: "PC-002", period: "2026-11", date: "2026-11-05", description: "Beli Kertas Thermal EDC 10 Roll & Kertas A4", amount: 165000, category: "ATK & Kasir", added_by: "Kasir Depok" },
  { id: "PC-003", period: "2026-11", date: "2026-11-07", description: "Isi Ulang Gas Desinfeksi Ruangan & Cairan Pembersih Lantai", amount: 240000, category: "Kebersihan & Sanitasi", added_by: "Housekeeping PDK" },
  { id: "PC-004", period: "2026-11", date: "2026-11-10", description: "Baterai Cadangan Oximeter & Tensimeter Digital", amount: 95000, category: "BHP Medis Kecil", added_by: "Suster Maya" }
];

const monthlyCosts = {
  "2026-11": {
    period: "2026-11",
    bhp_petty_cash: 685000,
    gaji_karyawan: 48500000,
    sewa_utilitas: 18000000,
    lain_lain: 6500000,
    filled: true
  },
  "2026-10": {
    period: "2026-10",
    bhp_petty_cash: 1250000,
    gaji_karyawan: 48500000,
    sewa_utilitas: 18000000,
    lain_lain: 7200000,
    filled: true
  }
};

const supplierQuotes = [
  { id: "SQ-001", item_id: 1, item_name: "Kasa Steril 7.5 x 7.5cm (Kotak)", supplier: "PT Kimia Farma Medika", price: 25000, moq: 10, payment_terms: "TOP 30 Hari", valid_until: "2027-01-01", notes: "Harga kontrak tahunan", added_by: "Finance Lead", added_at: "2026-11-01T08:00:00Z" },
  { id: "SQ-002", item_id: 2, item_name: "Jarum BD PrecisionGlide 30G x 1/2", supplier: "PT IDS Medical Systems", price: 85000, moq: 5, payment_terms: "TOP 14 Hari", valid_until: "2027-02-01", notes: "Kualitas terjamin steril", added_by: "Finance Lead", added_at: "2026-11-01T08:00:00Z" },
  { id: "SQ-003", item_id: 5, item_name: "Serum PDRN Salmon DNA Rejuran Healer 2ml", supplier: "PT Regen Prime Aesthetics", price: 1200000, moq: 10, payment_terms: "Cash Before Delivery", valid_until: "2027-06-01", notes: "Distributor resmi original BPOM", added_by: "Finance Lead", added_at: "2026-11-01T08:00:00Z" }
];

// ==========================================
// 16. MARKETING & FEEDBACK & UPSELLING
// ==========================================
const marketingPromos = [
  { id: "PROMO-001", title: "Promo Glowing November Pico Laser", category: "Laser & Rejuvenation", branch: "All Branches", start_date: "2026-11-01", end_date: "2026-11-30", discount_pct: 25, price_promo: 950000, price_normal: 1250000, target_audience: "Pasien Baru & Lama", description: "Treatment Pico Glow Laser 1064nm lengkap dengan calming sheet mask dan konsultasi dokter gratis.", is_active: true },
  { id: "PROMO-002", title: "Rejuran Salmon DNA Skinbooster Weekend Glow", category: "Skinbooster Premium", branch: "Depok", start_date: "2026-11-01", end_date: "2026-11-30", discount_pct: 17, price_promo: 3200000, price_normal: 3850000, target_audience: "Platinum & Gold VIP", description: "Regenerasi sel kulit mendalam dengan PDRN murni 2cc untuk hidrasi maksimal dan pori rapat.", is_active: true },
  { id: "PROMO-003", title: "HydraFacial Duo Package", category: "Facial & Cleansing", branch: "Pondok Kopi", start_date: "2026-11-05", end_date: "2026-11-25", discount_pct: 23, price_promo: 499000, price_normal: 650000, target_audience: "Semua Pasien", description: "Pembersihan komedo mendalam dengan serum hidrasi + free LED light therapy 15 menit.", is_active: true },
  { id: "PROMO-004", title: "Acne Clear Cauter & Peeling Solution", category: "Peeling & Acne Care", branch: "All Branches", start_date: "2026-11-01", end_date: "2026-11-30", discount_pct: 20, price_promo: 360000, price_normal: 450000, target_audience: "Gen Z & Mahasiswa", description: "Perawatan jerawat meradang dan komedo membandel dengan hasil kempes cepat.", is_active: true }
];

const doctorRecommendations = [
  { id: "REC-001", patient_id: 8, patient_name: "Clarissa Valerie", doctor_name: "dr. Cindy Novita", treatment_code: "T-001", treatment_name: "Pico Glow Laser Treatment (Sesi 2)", recommended_date: "2026-11-28", status: "Pending Booking", notes: "Lanjutkan sesi 2 untuk optimalisasi pembersihan flek melanin area pipi." },
  { id: "REC-002", patient_id: 22, patient_name: "Nadia Salsabila", doctor_name: "dr. Randy Wijaya", treatment_code: "T-003", treatment_name: "Rejuran Salmon DNA Booster", recommended_date: "2026-12-05", status: "Contacted", notes: "Kombinasikan dengan Cica Barrier Soothing Toner di rumah." },
  { id: "REC-003", patient_id: 14, patient_name: "Bunga Citra", doctor_name: "dr. Farah Diba Sp.D.V.E", treatment_code: "T-002", treatment_name: "HydraFacial Deep Cleansing", recommended_date: "2026-11-25", status: "Follow Up Sent", notes: "Facial rutin bulanan untuk menjaga kebersihan komedo." },
  { id: "REC-004", patient_id: 31, patient_name: "Putri Wulandari", doctor_name: "dr. Amanda Putri", treatment_code: "T-006", treatment_name: "Alma Harmony Rejuvenation Laser", recommended_date: "2026-12-01", status: "Pending Booking", notes: "Toning laser untuk mengencangkan tekstur kulit wajah." }
];

const nurseUpselling = [
  { id: "UPS-001", date: "2026-11-12", nurse_name: "Suster Maya Kusuma", patient_name: "Clarissa Valerie", product_name: "Kefir Daily UV Sunscreen SPF 50+", amount: 165000, status: "Success", commission: 16500 },
  { id: "UPS-002", date: "2026-11-11", nurse_name: "Terapis Dewi Lestari", patient_name: "Nadia Salsabila", product_name: "Kefir Ceramide Deep Moisture Cream", amount: 195000, status: "Success", commission: 19500 },
  { id: "UPS-003", date: "2026-11-10", nurse_name: "Suster Rina Anggraini", patient_name: "Bunga Citra", product_name: "Kefir Advanced Glow Serum Salmon DNA", amount: 285000, status: "Success", commission: 28500 },
  { id: "UPS-004", date: "2026-11-09", nurse_name: "Terapis Salsa Nabila", patient_name: "Putri Wulandari", product_name: "Kefir Brightening Night Cream 15g", amount: 185000, status: "Success", commission: 18500 },
  { id: "UPS-005", date: "2026-11-08", nurse_name: "Suster Maya Kusuma", patient_name: "Jessica Tan", product_name: "Kefir Cica Barrier Soothing Toner 100ml", amount: 145000, status: "Success", commission: 14500 }
];

const patientFeedbacks = [
  { id: 1, date: "2026-11-12", patient_name: "Clarissa Valerie", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Pico Glow Laser", comment: "Sangat puas! dr. Cindy komunikatif dan menjelaskan aftercare dengan jelas.", nps: 10 },
  { id: 2, date: "2026-11-12", patient_name: "Bunga Citra", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Farah Diba Sp.D.V.E", treatment_name: "HydraFacial Deep Cleansing", comment: "Pelayanan ramah, terapisnya lembut dan tidak sakit sama sekali.", nps: 10 },
  { id: 3, date: "2026-11-11", patient_name: "Nadia Salsabila", branch: "Pondok Kopi", rating_doctor: 5, rating_service: 4, doctor_name: "dr. Randy Wijaya", treatment_name: "Rejuran Healer Salmon DNA", comment: "Hasil treatment langsung kelihatan segar. Ruang tunggu nyaman.", nps: 9 },
  { id: 4, date: "2026-11-10", patient_name: "Rizky Pratama", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Acne Clear Peeling", comment: "Jerawat langsung kempes dalam 2 hari. Recommended!", nps: 10 },
  { id: 5, date: "2026-11-09", patient_name: "Maya Kartika", branch: "Pondok Kopi", rating_doctor: 4, rating_service: 5, doctor_name: "dr. Amanda Putri", treatment_name: "Kefir Phyto Derma Facial", comment: "Sangat menenangkan, kulit halus dan lembap.", nps: 9 },
  { id: 6, date: "2026-11-08", patient_name: "Putri Wulandari", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Farah Diba Sp.D.V.E", treatment_name: "Pico Glow Laser", comment: "Kulit glowing dan flek hitam mulai tersamarkan di sesi ke-2.", nps: 10 },
  { id: 7, date: "2026-11-07", patient_name: "Aurelia Natasha", branch: "Pondok Kopi", rating_doctor: 5, rating_service: 4, doctor_name: "dr. Randy Wijaya", treatment_name: "HydraFacial Deep Cleansing", comment: "Komedo terangkat maksimal tanpa iritasi kemerahan.", nps: 9 },
  { id: 8, date: "2026-11-06", patient_name: "Fitri Handayani", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Kefir Phyto Derma Facial", comment: "Tempat bersih, wangi aroma therapy menenangkan pikiran.", nps: 10 },
  { id: 9, date: "2026-11-05", patient_name: "Desi Kusuma", branch: "Pondok Kopi", rating_doctor: 4, rating_service: 5, doctor_name: "dr. Amanda Putri", treatment_name: "Acne Clear Peeling", comment: "Minyak wajah terkontrol dengan sangat baik.", nps: 9 },
  { id: 10, date: "2026-11-04", patient_name: "Wulan Anggraini", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Rejuran Healer Salmon DNA", comment: "Muka plumpy dan kenyal banget pas bangun tidur.", nps: 10 }
];

const birthdayNotifs = [
  { patient_id: 8, patient_name: "Clarissa Valerie", patient_code: "EM-260500008", phone: "6281298765408", birth_date: "1994-11-13", membership_status: "Platinum VIP" },
  { patient_id: 14, patient_name: "Bunga Citra Paramita", patient_code: "EM-260500014", phone: "6281298765414", birth_date: "1992-11-14", membership_status: "Gold Member" },
  { patient_id: 22, patient_name: "Nadia Salsabila", patient_code: "EM-260500022", phone: "6281298765422", birth_date: "1996-11-15", membership_status: "Gold Member" },
  { patient_id: 31, patient_name: "Putri Wulandari", patient_code: "EM-260500031", phone: "6281298765431", birth_date: "1995-11-16", membership_status: "Platinum VIP" },
  { patient_id: 45, patient_name: "Aurelia Natasha", patient_code: "EM-260500045", phone: "6281298765445", birth_date: "1998-11-18", membership_status: "Silver Member" }
];

const monthlyTargets = {
  "2026-11": {
    "depok": { target_omset: 280000000, target_patients: 450, target_new_patients: 120 },
    "pondok_kopi": { target_omset: 220000000, target_patients: 380, target_new_patients: 90 }
  },
  "2026-10": {
    "depok": { target_omset: 270000000, target_patients: 430, target_new_patients: 110 },
    "pondok_kopi": { target_omset: 210000000, target_patients: 360, target_new_patients: 85 }
  }
};

const branchReviews = {
  branches: {
    depok: {
      branch_id: "depok",
      branch_name: "Kefir Derma Clinic Depok",
      branch_code: "KDC",
      address: "Jl. Margonda No.333 A, Kemiri Muka, Kecamatan Beji, Kota Depok",
      maps_url: "https://maps.google.com/?cid=1234567890",
      rating: 4.9,
      total_reviews: 428,
      nps_score: 91.5,
      last_synced_at: "2026-11-13T10:00:00+07:00",
      recent_reviews: [
        { author: "Clarissa V.", rating: 5, time_ago: "2 hari lalu", text: "Treatment Pico Laser di KEFIR Depok sama dr. Cindy bener-bener mantul! Bekas jerawat kemerahan langsung pudar dalam 2 sesi. Tempatnya bersih dan stafnya ramah banget 🥰", clinic_response: "Terima kasih banyak Kak Clarissa! Senang sekali bisa membantu merawat kulit Kakak. Sampai jumpa di sesi berikutnya! ✨" },
        { author: "Bunga Citra", rating: 5, time_ago: "3 hari lalu", text: "Dokter Farah SpKK penjelasannya detail dan solutif banget. HydraFacial-nya super relaxing, muka langsung glowing dan komedo keangkat semua.", clinic_response: null },
        { author: "Rizky P.", rating: 5, time_ago: "1 minggu lalu", text: "Klinik estetika terbaik di Margonda. Gak dipaksa beli paket macem-macem, harga transparan, alat-alatnya canggih.", clinic_response: "Terima kasih Kak Rizky atas kepercayaannya pada KEFIR Derma Clinic!" },
        { author: "Dian Paramita", rating: 4, time_ago: "1 minggu lalu", text: "Pelayanan sangat memuaskan, dokternya telaten. Cuma kalau weekend agak antre, saran saya booking appointment dulu.", clinic_response: "Terima kasih Kak Dian sarannya, kami siap melayani reservasi via WhatsApp ya Kak!" }
      ]
    },
    pondok_kopi: {
      branch_id: "pondok_kopi",
      branch_name: "Kefir Derma Clinic Pondok Kopi",
      branch_code: "PDK",
      address: "Jl. I Gusti Ngurah Rai No.13, Pd. Kopi, Kec. Duren Sawit, Jakarta Timur",
      maps_url: "https://maps.google.com/?cid=9876543210",
      rating: 4.8,
      total_reviews: 312,
      nps_score: 87.2,
      last_synced_at: "2026-11-13T10:00:00+07:00",
      recent_reviews: [
        { author: "Nadia Salsabila", rating: 5, time_ago: "Kemarin", text: "dr. Randy ramah banget, treatment Rejuran Salmon DNA-nya minim sakit karena anestesinya pas. Muka jadi plumpy dan glowing!", clinic_response: "Terima kasih Kak Nadia! Kulit sehat bercahaya impian kita bersama 💖" },
        { author: "Maya Kartika", rating: 5, time_ago: "4 hari lalu", text: "Klinik langganan di Duren Sawit. Suster Maya telaten banget pas facial. Ruangannya wangi dan nyaman.", clinic_response: "Terima kasih banyak Kak Maya atas ulasan positifnya!" },
        { author: "Kevin Sanjaya", rating: 4, time_ago: "1 minggu lalu", text: "Laser Alma Harmony bagus banget buat pori-pori dan tekstur wajah. Pelayanan cepat dan profesional.", clinic_response: null }
      ]
    }
  }
};

// ==========================================
// FILE WRITER HELPER
// ==========================================
const writeJson = (filePath, data, label) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ [${label}] Written: ${path.relative(ROOT_DIR, filePath)} (${Array.isArray(data) ? data.length + ' items' : 'OK'})`);
};

// WRITE ALL NEOSOFT DB FILES
writeJson(path.join(NEOSOFT_DIR, 'doctortypes.json'), doctortypes, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'therapists.json'), therapists, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'uoms.json'), uoms, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'suppliers.json'), suppliers, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'banks.json'), banks, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'products.json'), products, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'customers_all.json'), customers, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'invoices_all.json'), invoices, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'usages.json'), usages, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'usages_details.json'), usages_details, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'payment_report.json'), paymentReport, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'appointment_full.json'), appointmentsAll, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'notification_birthday.json'), birthdayNotifs, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'notification_unpaid.json'), notificationUnpaid, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'medicalrecords.json'), medicalRecords, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'physicalexamination.json'), physicalexamination, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'package_balances.json'), packageBalances, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'manual_unredeemed_treatments.json'), manualUnredeemed, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'deposit_mutations.json'), depositMutations, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'creditvoucher.json'), creditVouchers, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'logistics_items.json'), logisticsItems, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'stock_card.json'), stockCard, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'logistics_stock_card.json'), stockCard, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'stock_buffer_alerts.json'), stockBufferAlerts, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'logistics_stock_opname.json'), stockOpname, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'logistics_purchaseorder.json'), purchaseOrders, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'product_outlet_prices.json'), productOutletPrices, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'sync_meta.json'), syncMeta, 'Neosoft');
writeJson(path.join(NEOSOFT_DIR, 'commission_report.json'), commissionReport, 'Neosoft');

// WRITE GOOGLE SHEETS DB FILES
writeJson(path.join(GOOGLE_SHEETS_DIR, 'operational_assets.json'), operationalAssets, 'GoogleSheets');
writeJson(path.join(GOOGLE_SHEETS_DIR, 'depok_transactions.json'), depokTransactions, 'GoogleSheets');
writeJson(path.join(GOOGLE_SHEETS_DIR, 'pondokkopi_transactions.json'), pondokkopiTransactions, 'GoogleSheets');
writeJson(path.join(GOOGLE_SHEETS_DIR, 'price_sheets.json'), priceSheets, 'GoogleSheets');
writeJson(path.join(GOOGLE_SHEETS_DIR, 'sync_summary.json'), syncSummary, 'GoogleSheets');

// WRITE OPERATIONAL DB FILES
writeJson(path.join(OPERATIONAL_DIR, 'team_complaints.json'), teamComplaints, 'Operational');
writeJson(path.join(OPERATIONAL_DIR, 'sop_checklists.json'), sopChecklists, 'Operational');

// WRITE ROOT DATA FILES
writeJson(path.join(DATA_DIR, 'sop_exceptions.json'), sopExceptions, 'RootData');
writeJson(path.join(DATA_DIR, 'hr_disciplinary_records.json'), hrDisciplinary, 'RootData');
writeJson(path.join(DATA_DIR, 'cashier_closings.json'), cashierClosings, 'RootData');
writeJson(path.join(DATA_DIR, 'petty_cash_entries.json'), pettyCashEntries, 'RootData');
writeJson(path.join(DATA_DIR, 'monthly_costs.json'), monthlyCosts, 'RootData');
writeJson(path.join(DATA_DIR, 'supplier_quotes.json'), supplierQuotes, 'RootData');
writeJson(path.join(DATA_DIR, 'marketing_promos.json'), marketingPromos, 'RootData');
writeJson(path.join(DATA_DIR, 'doctor_recommendations.json'), doctorRecommendations, 'RootData');
writeJson(path.join(DATA_DIR, 'nurse_upselling.json'), nurseUpselling, 'RootData');
writeJson(path.join(DATA_DIR, 'patient_feedbacks.json'), patientFeedbacks, 'RootData');
writeJson(path.join(DATA_DIR, 'monthly_targets.json'), monthlyTargets, 'RootData');
writeJson(path.join(GOOGLE_MAPS_DIR, 'branch_reviews.json'), branchReviews, 'GoogleMaps');

console.log('✨ All 35+ data stores successfully generated and written!');
