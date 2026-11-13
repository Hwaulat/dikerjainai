const fs = require('fs');
const path = require('path');

const NEOSOFT_DIR = path.join(__dirname, '..', 'data', 'neosoft_db');
if (!fs.existsSync(NEOSOFT_DIR)) {
  fs.mkdirSync(NEOSOFT_DIR, { recursive: true });
}

// 1. DOCTOR TYPES
const doctortypes = [
  { id: 1, name: "Dokter Penanggung Jawab" },
  { id: 2, name: "Dokter Estetika" },
  { id: 3, name: "Dokter Sp.D.V.E" },
  { id: 4, name: "Dokter Umum" },
  { id: 5, name: "Perawat / Nurse" },
  { id: 6, name: "Terapis Medis" }
];

// 2. THERAPISTS / DOCTORS / NURSES
const therapists = [
  { id: 1, therapist_name: "dr. Cindy Novita", therapist_type: 2, outlet_id: 1, phone: "628112233441", is_active: 1, status_therapist: true },
  { id: 2, therapist_name: "dr. Farah Diba Sp.D.V.E", therapist_type: 3, outlet_id: 1, phone: "628112233442", is_active: 1, status_therapist: true },
  { id: 3, therapist_name: "dr. Randy Wijaya", therapist_type: 2, outlet_id: 2, phone: "628112233443", is_active: 1, status_therapist: true },
  { id: 4, therapist_name: "dr. Amanda Putri", therapist_type: 2, outlet_id: 2, phone: "628112233444", is_active: 1, status_therapist: true },
  { id: 5, therapist_name: "Suster Maya Kusuma", therapist_type: 5, outlet_id: 1, phone: "628112233445", is_active: 1, status_therapist: true },
  { id: 6, therapist_name: "Suster Rina Anggraini", therapist_type: 5, outlet_id: 1, phone: "628112233446", is_active: 1, status_therapist: true },
  { id: 7, therapist_name: "Terapis Dewi Lestari", therapist_type: 5, outlet_id: 2, phone: "628112233447", is_active: 1, status_therapist: true },
  { id: 8, therapist_name: "Terapis Salsa Nabila", therapist_type: 5, outlet_id: 2, phone: "628112233448", is_active: 1, status_therapist: true }
];

// 3. UOMS, SUPPLIERS, BANKS
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
  { id: 1, name: "BCA EDC - Depok", account_number: "8800112233" },
  { id: 2, name: "Mandiri QRIS - Depok", account_number: "15700998877" },
  { id: 3, name: "BCA EDC - Pondok Kopi", account_number: "8800445566" },
  { id: 4, name: "Mandiri QRIS - Pondok Kopi", account_number: "15700223344" }
];

// 4. PRODUCTS & TREATMENTS
// Load from price_master if available, and add skincare items
let products = [];
const priceMasterPath = path.join(__dirname, '..', 'data', 'price_master.json');
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
  } catch (e) {
    console.error('Error reading price master:', e);
  }
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

// Add Skincare Products (P-)
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

// 5. CUSTOMERS (100 Patients)
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

  customers.push({
    id: i,
    code: `EM-2605${String(i).padStart(5, '0')}`,
    name: { first_name: fn, middle_name: "", last_name: ln },
    phone: `62812${String(90000000 + i * 11111).slice(0, 8)}`,
    gender: (i % 7 === 0) ? "Male" : "Female",
    birth_date: `${birthYear}-${birthMonth}-${birthDay}`,
    origin_outlet_id: outletId,
    join_date: `2025-0${(i % 9) + 1}-10 09:30:00`,
    first_visit_date: `2025-0${(i % 9) + 1}-10`,
    membership_status: i <= 15 ? "Platinum VIP" : (i <= 40 ? "Gold Member" : "Silver Member")
  });
}

// 6. INVOICES & USAGES (400 Realistis Transactions)
const invoices = [];
const usages = [];
const usages_details = [];

const paymodes = ["bca", "mandiri", "qris", "cash", "credit_card"];

// Generate transactions from Aug 1, 2026 to Nov 13, 2026
const startDate = new Date(2026, 7, 1); // 1 Aug 2026
const endDate = new Date(2026, 10, 13); // 13 Nov 2026
const totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));

let invIdCounter = 1001;
let usageIdCounter = 1;
let detailIdCounter = 1;

for (let d = 0; d <= totalDays; d++) {
  const curDate = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
  const yyyy = curDate.getFullYear();
  const mm = String(curDate.getMonth() + 1).padStart(2, '0');
  const dd = String(curDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // 3-6 transactions per day
  const txCount = 3 + (d % 4);

  for (let t = 0; t < txCount; t++) {
    const outletId = (t % 2 === 0) ? 1 : 2;
    const branchCode = outletId === 1 ? 'D' : 'P';
    const hour = 10 + Math.floor((t * 2.2) % 10);
    const minute = (t * 17) % 60;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    const fullDateTime = `${dateStr} ${timeStr}`;

    const cust = customers[(invIdCounter * 7) % customers.length];
    const docId = outletId === 1 ? ((t % 2 === 0) ? 1 : 2) : ((t % 2 === 0) ? 3 : 4);
    const thId = outletId === 1 ? ((t % 2 === 0) ? 5 : 6) : ((t % 2 === 0) ? 7 : 8);

    // Pick 1-2 treatments
    const tItem = products[(invIdCounter + t * 3) % products.length];
    // Sometimes add skincare product
    const addSkincare = (t % 2 === 1);
    const sItem = addSkincare ? skincareProducts[(t * 2) % skincareProducts.length] : null;

    const totalAmt = (tItem.price || 500000) + (sItem ? sItem.price : 0);
    const invCode = `INV-${branchCode}-${yyyy.toString().slice(2)}${mm}${dd}-${String(t + 1).padStart(4, '0')}`;

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
      paymode: paymodes[(invIdCounter) % paymodes.length],
      void_invoice: false,
      is_void: false
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
      is_void: 0,
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

    invIdCounter++;
    usageIdCounter++;
  }
}

// 7. APPOINTMENTS (40 Appointments: Past, Today, Upcoming)
const appointmentsAll = [];
const apptRooms = [
  { id: 1, name: "Ruang Laser Pico 1 (DPK)" },
  { id: 2, name: "Ruang Facial & Estetika 1 (DPK)" },
  { id: 3, name: "Ruang Konsultasi dr. Cindy (DPK)" },
  { id: 4, name: "Ruang Laser Alma 1 (PDK)" },
  { id: 5, name: "Ruang Facial VIP (PDK)" }
];

// Appts for Nov 10, 11, 12, 13, 14, 15, 16
const apptDays = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
let apptIdCounter = 1;

apptDays.forEach((dStr, dayIdx) => {
  const isPast = dayIdx < 3;
  const isToday = dayIdx === 3;
  const isFuture = dayIdx > 3;

  for (let s = 0; s < 5; s++) {
    const cust = customers[(s * 7 + dayIdx * 3) % customers.length];
    const room = apptRooms[s % apptRooms.length];
    const outletId = s >= 3 ? 2 : 1;
    const doc = therapists[s % 4];
    const tItem = products[(s * 4 + dayIdx) % 15];
    const hour = 10 + s * 2;
    const comeDate = `${dStr} ${String(hour).padStart(2, '0')}:00:00`;

    // 2 = Attended (Selesai), 1 = Scheduled (Menunggu/Konfirmasi)
    const statusAppt = isPast ? 2 : (isToday ? (s < 2 ? 2 : 1) : 1);
    const statusName = isPast ? "Finished" : (isToday ? (s < 2 ? "Finished" : "Waiting") : "Confirmed");

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

// Commission Report
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

// 8. BIRTHDAY NOTIFICATIONS (November Birthdays)
const birthdayNotifs = [
  { patient_id: 8, patient_name: "Clarissa Valerie", patient_code: "EM-260500008", phone: "6281298765408", birth_date: "1994-11-13", membership_status: "Platinum VIP" },
  { patient_id: 14, patient_name: "Bunga Citra Paramita", patient_code: "EM-260500014", phone: "6281298765414", birth_date: "1992-11-14", membership_status: "Gold Member" },
  { patient_id: 22, patient_name: "Nadia Salsabila", patient_code: "EM-260500022", phone: "6281298765422", birth_date: "1996-11-15", membership_status: "Gold Member" },
  { patient_id: 31, patient_name: "Putri Wulandari", patient_code: "EM-260500031", phone: "6281298765431", birth_date: "1995-11-16", membership_status: "Platinum VIP" },
  { patient_id: 45, patient_name: "Aurelia Natasha", patient_code: "EM-260500045", phone: "6281298765445", birth_date: "1998-11-18", membership_status: "Silver Member" }
];

// 9. LOGISTICS / BHP INVENTORY
const logisticsItems = [
  { id: 1, item_code: "BHP-001", name: "Kasa Steril 7.5 x 7.5cm (Kotak)", stock: 48, min_stock: 20, uom: "Box", cogs: 25000, supplier: "PT Kimia Farma Medika" },
  { id: 2, item_code: "BHP-002", name: "Jarum BD PrecisionGlide 30G x 1/2", stock: 8, min_stock: 25, uom: "Box", cogs: 85000, supplier: "PT IDS Medical Systems" },
  { id: 3, item_code: "BHP-003", name: "Spuit Syringe 1cc Terumo Ultra", stock: 120, min_stock: 50, uom: "Pcs", cogs: 4500, supplier: "PT IDS Medical Systems" },
  { id: 4, item_code: "BHP-004", name: "Krim Anestesi Topikal Lidocaine 10.56% 500g", stock: 3, min_stock: 2, uom: "Pot", cogs: 650000, supplier: "PT Harsen Laboratories" },
  { id: 5, item_code: "BHP-005", name: "Serum PDRN Salmon DNA Rejuran Healer 2ml", stock: 6, min_stock: 10, uom: "Ampul", cogs: 1200000, supplier: "PT Regen Prime Aesthetics" },
  { id: 6, item_code: "BHP-006", name: "Handscoon Nitrile Non-Powder M (Sens)", stock: 35, min_stock: 15, uom: "Box", cogs: 48000, supplier: "PT Kimia Farma Medika" },
  { id: 7, item_code: "BHP-007", name: "Alcohol Swabs 70% BD", stock: 18, min_stock: 10, uom: "Box", cogs: 18000, supplier: "PT Kimia Farma Medika" },
  { id: 8, item_code: "BHP-008", name: "Tip Laser Pico Toning Disposible", stock: 14, min_stock: 10, uom: "Pcs", cogs: 175000, supplier: "PT IDS Medical Systems" }
];

// Write All Neosoft DB JSON Files
const writeNeosoft = (file, data) => {
  fs.writeFileSync(path.join(NEOSOFT_DIR, file), JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Written: data/neosoft_db/${file} (${Array.isArray(data) ? data.length + ' items' : 'OK'})`);
};

writeNeosoft('doctortypes.json', doctortypes);
writeNeosoft('therapists.json', therapists);
writeNeosoft('uoms.json', uoms);
writeNeosoft('suppliers.json', suppliers);
writeNeosoft('banks.json', banks);
writeNeosoft('products.json', products);
writeNeosoft('customers_all.json', customers);
writeNeosoft('invoices_all.json', invoices);
writeNeosoft('usages.json', usages);
writeNeosoft('usages_details.json', usages_details);
writeNeosoft('appointment_full.json', appointmentsAll);
writeNeosoft('notification_birthday.json', birthdayNotifs);
writeNeosoft('notification_unpaid.json', []);
writeNeosoft('logistics_items.json', logisticsItems);
writeNeosoft('commission_report.json', commissionReport);

// 10. GOOGLE MAPS REVIEWS
const googleMapsDb = path.join(__dirname, '..', 'data', 'google_maps_db');
if (!fs.existsSync(googleMapsDb)) fs.mkdirSync(googleMapsDb, { recursive: true });

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
fs.writeFileSync(path.join(googleMapsDb, 'branch_reviews.json'), JSON.stringify(branchReviews, null, 2), 'utf8');
console.log(`✅ Written: data/google_maps_db/branch_reviews.json`);

// 11. PATIENT FEEDBACKS
const patientFeedbacks = [
  { id: 1, date: "2026-11-12", patient_name: "Clarissa Valerie", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Pico Glow Laser", comment: "Sangat puas! dr. Cindy komunikatif dan menjelaskan aftercare dengan jelas.", nps: 10 },
  { id: 2, date: "2026-11-12", patient_name: "Bunga Citra", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Farah Diba Sp.D.V.E", treatment_name: "HydraFacial Deep Cleansing", comment: "Pelayanan ramah, terapisnya lembut dan tidak sakit sama sekali.", nps: 10 },
  { id: 3, date: "2026-11-11", patient_name: "Nadia Salsabila", branch: "Pondok Kopi", rating_doctor: 5, rating_service: 4, doctor_name: "dr. Randy Wijaya", treatment_name: "Rejuran Healer Salmon DNA", comment: "Hasil treatment langsung kelihatan segar. Ruang tunggu nyaman.", nps: 9 },
  { id: 4, date: "2026-11-10", patient_name: "Rizky Pratama", branch: "Depok", rating_doctor: 5, rating_service: 5, doctor_name: "dr. Cindy Novita", treatment_name: "Acne Clear Peeling", comment: "Jerawat langsung kempes dalam 2 hari. Recommended!", nps: 10 },
  { id: 5, date: "2026-11-09", patient_name: "Maya Kartika", branch: "Pondok Kopi", rating_doctor: 4, rating_service: 5, doctor_name: "dr. Amanda Putri", treatment_name: "Kefir Phyto Derma Facial", comment: "Sangat menenangkan, kulit halus dan lembap.", nps: 9 }
];
fs.writeFileSync(path.join(__dirname, '..', 'data', 'patient_feedbacks.json'), JSON.stringify(patientFeedbacks, null, 2), 'utf8');
console.log(`✅ Written: data/patient_feedbacks.json`);

// 12. DOCTOR RECOMMENDATIONS
const doctorRecs = [
  { id: "REC-001", patient_id: 8, patient_name: "Clarissa Valerie", doctor_name: "dr. Cindy Novita", treatment_code: "T-001", treatment_name: "Pico Glow Laser (Sesi 2)", recommended_date: "2026-11-28", status: "Pending Booking", notes: "Lanjutkan sesi 2 untuk optimalisasi pembersihan flek melanin." },
  { id: "REC-002", patient_id: 22, patient_name: "Nadia Salsabila", doctor_name: "dr. Randy Wijaya", treatment_code: "T-003", treatment_name: "Rejuran Salmon DNA Booster", recommended_date: "2026-12-05", status: "Contacted", notes: "Kombinasikan dengan Cica Barrier Soothing Toner di rumah." }
];
fs.writeFileSync(path.join(__dirname, '..', 'data', 'doctor_recommendations.json'), JSON.stringify(doctorRecs, null, 2), 'utf8');
console.log(`✅ Written: data/doctor_recommendations.json`);

// 13. NURSE UPSELLING LOGS
const nurseUpselling = [
  { id: "UPS-001", date: "2026-11-12", nurse_name: "Suster Maya Kusuma", patient_name: "Clarissa Valerie", product_name: "Kefir Daily UV Sunscreen SPF 50+", amount: 165000, status: "Success", commission: 16500 },
  { id: "UPS-002", date: "2026-11-11", nurse_name: "Terapis Dewi Lestari", patient_name: "Nadia Salsabila", product_name: "Kefir Ceramide Deep Moisture Cream", amount: 195000, status: "Success", commission: 19500 },
  { id: "UPS-003", date: "2026-11-10", nurse_name: "Suster Rina Anggraini", patient_name: "Bunga Citra", product_name: "Kefir Advanced Glow Serum Salmon DNA", amount: 285000, status: "Success", commission: 28500 }
];
fs.writeFileSync(path.join(__dirname, '..', 'data', 'nurse_upselling.json'), JSON.stringify(nurseUpselling, null, 2), 'utf8');
console.log(`✅ Written: data/nurse_upselling.json`);

// 14. MONTHLY TARGETS
const monthlyTargets = {
  "2026-11": {
    "depok": { target_omset: 280000000, target_patients: 450, target_new_patients: 120 },
    "pondok_kopi": { target_omset: 220000000, target_patients: 380, target_new_patients: 90 }
  },
  "2026-10": {
    "depok": { target_omset: 270000000, target_patients: 420, target_new_patients: 110 },
    "pondok_kopi": { target_omset: 210000000, target_patients: 360, target_new_patients: 85 }
  }
};
fs.writeFileSync(path.join(__dirname, '..', 'data', 'monthly_targets.json'), JSON.stringify(monthlyTargets, null, 2), 'utf8');
console.log(`✅ Written: data/monthly_targets.json`);

console.log("\n🎉 ALL COMPREHENSIVE CLINIC DUMMY DATA GENERATED SUCCESSFULLY!");
