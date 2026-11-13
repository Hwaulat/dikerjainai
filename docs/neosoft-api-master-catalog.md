# 📚 Master Katalog Lengkap Endpoint API Neosoft Cube
**PT Kefir House / Kefir Derma Clinic (Depok & Pondok Kopi)**  
*Dokumentasi Resmi & Terverifikasi (Total 58+ Endpoints)*

---

### 🌐 Konfigurasi & Header Wajib
* **Base URL**: `https://api-registry-c1.cube.neosoft.id/api/v1`
* **Format**: JSON
* **Auth**: `Authorization: Bearer <TOKEN>`
* **Custom Headers**:
  * `x-clinic`: `L1V1GnoWuzBDrHadet3fgEbnftv3EL3nvY3qQcYdJk36SUG27ho=`
  * `x-host`: `L1V1GnoWuzBDrHadet3fgEbnftv3EL3nvY3qQcYdJk36SUG27ho=`
  * `x-origin`: `https://kefirdermaclinic.neosoft.co.id`
  * `x-path`: `kefirdermaclinic`
  * `x-time`: `<timestamp_ms>`
  * `x-lang`: `en`
  * `x-tz`: `+07:00`

---

## 1. 📋 Pasien, Rekam Medis & Tindakan Medis (Clinical & EMR)

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 1 | `/customers` | `GET` | Master seluruh pasien (biodata, telepon, alamat, riwayat) `?limit=100&page=N` | 8.136 Pasien |
| 2 | `/customers/:id` | `GET` | Detail profil lengkap 1 pasien spesifik berdasarkan ID | Profil Pasien |
| 3 | `/customers/log-histories` | `GET` | Log jejak riwayat audit perubahan data pasien oleh staf | Log Audit Pasien |
| 4 | `/customers/summary` | `GET` | Ringkasan riwayat kunjungan dan total belanja pasien | Summary Pasien |
| 5 | `/customers/loyalty` | `GET` | Riwayat transaksi reward poin loyalitas pasien | Loyalty Rewards |
| 6 | `/customers/points` | `GET` | Mutasi saldo poin loyalty pasien | Saldo Poin |
| 7 | `/customers/tiers` | `GET` | Histori perubahan level/tier keanggotaan pasien | Tier Pasien |
| 8 | `/physicalexamination` | `GET` | Rekam medis pemeriksaan fisik dokter & diagnosa klinis | 731+ Rekam Medis |
| 9 | `/physicalexamination/:id` | `PUT/DEL`| Update diagnosa klinis atau hapus pemeriksaan fisik | Update Medis |
| 10 | `/physicalexamination/photos` | `POST/PUT`| Upload & kelola foto klinis Before-After pasien | Galeri Foto Medis |
| 11 | `/usages` | `GET` | Master header dokumen pemakaian tindakan medis & BHP | Header Usages |
| 12 | `/usages/:id` | `GET` | Detail 1 dokumen header usage tertentu | Detail Usage Header |
| 13 | `/usages/details` | `GET` | Detail pemakaian produk/tindakan per pasien, dokter & perawat | 3.031 Tindakan |
| 14 | `/usages/bom` | `GET` | Bill of Materials (resep komposisi BHP per tindakan) | Komposisi Resep |
| 15 | `/usages/history` | `GET` | Riwayat pemakaian obat per pasien | Riwayat Obat Pasien |
| 16 | `/usages/group` | `GET` | Pengelompokan tindakan yang dilakukan bersamaan | Bundle Tindakan |
| 17 | `/appointment` | `GET` | Jadwal reservasi pasien (`?start_date=...&end_date=...&outlet_id=N`) | 622 Reservasi |

---

## 2. 💰 Penjualan, Billing & Keuangan (Sales & Finance)

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 18 | `/invoices` | `GET` | Seluruh faktur penjualan, status lunas, DP, sisa piutang, void | 1.146 Invoices |
| 19 | `/invoices/:id` | `GET` | Rincian lengkap 1 invoice (item treatment/produk, diskon, kasir) | Detail Faktur |
| 20 | `/invoices/summary` | `GET` | Agregasi omset penjualan dan total piutang | Ringkasan Billing |
| 21 | `/invoices/items` | `GET` | Rincian breakdown per item yang terjual pada invoice | Item Penjualan |
| 22 | `/invoices/payments` | `GET` | Histori angsuran dan mutasi pelunasan invoice | Mutasi Pelunasan |
| 23 | `/invoices/converts` | `GET` | Konversi deposit advance package menjadi invoice tindakan | Konversi Deposit |
| 24 | `/expenses` | `GET/POST`| Pencatatan dan monitoring pengeluaran kas operasional / petty cash | Beban Operasional |
| 25 | `/banks` | `GET` | Master 17 rekening bank & EDC kasir (BCA, Mandiri, QRIS, dll) | 17 Akun Bank |
| 26 | `/creditvoucher` | `GET` | Saldo voucher kredit atau deposit pembayaran di muka pasien | Saldo Kredit |

---

## 3. 🏷️ Master Katalog Treatment, Produk & Promo (Catalog & Pricing)

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 27 | `/products` | `GET` | Master katalog treatment dokter, beautician, dan produk skincare | 448 Layanan/SKU |
| 28 | `/packages` | `GET` | Master paket bundling treatment klinik (Pico 3x, Advance, dll) | Master Paket |
| 29 | `/vouchers` | `GET` | Master voucher diskon promo resmi terdaftar | Master Diskon |
| 30 | `/category` | `GET` | Kategori klasifikasi layanan & produk | Kategori Produk |

---

## 4. 📦 Logistik, Pengadaan, Stok & Farmasi (Purchasing & Warehouse)

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 31 | `/logistics/items` | `GET` | Master barang logistik medis, buffer stock, harga dasar | 448 Item Logistik |
| 32 | `/logistics/purchaseorder` | `GET` | Master Purchase Order (PO) pemesanan barang ke supplier | Transaksi PO |
| 33 | `/logistics/purchaseorder/:id` | `GET` | Rincian lengkap 1 dokumen Surat Pesanan / PO | Detail Item PO |
| 34 | `/logistics/purchaseorder-type` | `GET` | Master klasifikasi jenis PO (Rutin, Cito/Darurat) | Tipe PO |
| 35 | `/logistics/stock-card` | `POST` | Kartu stok pergerakan barang (Body: `warehouse_id`, date range) | Audit Saldo & FEFO |
| 36 | `/logistics/stock-opname` | `POST` | Data stok fisik riil & Expired Date (Body: `warehouse_id`) | Fisik vs Sistem |
| 37 | `/logistics/check-stock` | `POST` | Peringatan otomatis stok di bawah batas aman buffer | Alert Habis Stok |
| 38 | `/logistics/mutation-order` | `GET` | Surat jalan mutasi kirim antar cabang (Depok ⇄ Pondok Kopi) | Mutasi Kirim |
| 39 | `/logistics/mutation-order/:id` | `GET` | Rincian 1 dokumen surat jalan mutasi kirim | Detail Mutasi |
| 40 | `/logistics/mutation-receive` | `GET` | Konfirmasi penerimaan mutasi stok di cabang tujuan | Penerimaan Mutasi |
| 41 | `/logistics/mutation-receive/:id` | `GET` | Rincian 1 dokumen tanda terima mutasi barang | Detail Penerimaan |
| 42 | `/logistics/inventory-adjustment` | `GET` | Dokumen penyesuaian stok rusak, susut, atau selisih | Adjustment Stok |
| 43 | `/logistics/inventory-adjustment/:id`| `GET` | Rincian 1 dokumen penyesuaian stok | Detail Adjustment |
| 44 | `/warehouses` | `GET` | Master gudang (Gudang 1: Depok, Gudang 2: Pondok Kopi) | 2 Gudang Utama |
| 45 | `/racks` | `GET` | Master nomor rak dan lemari penyimpanan obat | Lokasi Rak Obat |
| 46 | `/suppliers` | `GET` | Database distributor dan supplier farmasi resmi | Vendor Supplier |
| 47 | `/uoms` | `GET` | Satuan unit takaran barang (pcs, ampul, vial, pot, botol, tube) | 24 Satuan UOM |

---

## 5. 👨‍⚕️ Tenaga Medis, Staf & Hak Akses (HRD & Access Control)

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 48 | `/therapists` | `GET` | Master seluruh staf: Dokter DPJP, Perawat, Beautician, Kasir | 44 Staf Medis |
| 49 | `/consultants` | `GET` | Master beauty consultant / konsultan medis klinik | 3 Konsultan |
| 50 | `/doctortypes` | `GET` | Tipe klasifikasi dokter (Dokter Estetika / GP, SpKK) | 8 Tipe Dokter |
| 51 | `/roles` | `GET` | Master 9 peran hak akses (Super User, Doctor, Cashier, dll) | 9 Role Sistem |
| 52 | `/user-access` | `GET` | Pemetaan akses menu dan ID akun pengguna staf | 48 User Neosoft |

---

## 6. 🔔 Notifikasi & Trigger Otomatis (Alerts & CRM)

| # | Endpoint | Method | Deskripsi & Parameter | Kegunaan |
|---|---|:---:|---|---|
| 53 | `/notification/unpaid` | `GET` | Daftar invoice gantung / sisa pembayaran belum lunas | Follow-up Kasir & CS |
| 54 | `/notification/birthday` | `GET` | Daftar pasien yang berulang tahun hari ini / bulan ini | Blast Promo Ultah WA |
| 55 | `/notification/appointment` | `GET` | Notifikasi konfirmasi kehadiran reservasi pasien | Reminder Jadwal H-1 |
| 56 | `/notification/unvalidated-usage`| `GET` | Pemakaian tindakan/BHP yang belum divalidasi supervisor | Kontrol Mutu Medis |

---

## 7. 🏥 Fasilitas Cabang, Mesin Medis & Demografi Wilayah

| # | Endpoint | Method | Deskripsi & Parameter | Data di KEFIR |
|---|---|:---:|---|---|
| 57 | `/outlets` | `GET` | Data cabang klinik aktif: Depok (ID: 1) & Pondok Kopi (ID: 2) | 2 Outlet Aktif |
| 58 | `/marketingsource` | `GET` | Master saluran kedatangan pasien (Instagram, TikTok, Teman) | 9 Saluran Marketing |
| 59 | `/patient-status` | `GET` | Status pasien (Reguler, Member VIP, Blacklist) | 7 Status Pasien |
| 60 | `/occupations` | `GET` | Master klasifikasi profesi/pekerjaan pasien | 12 Profesi Pasien |
| 61 | `/religions` | `GET` | Master klasifikasi agama pasien | 6 Agama |
| 62 | `/groups` | `GET` | Master grup pengelompokan pasien | 2 Grup Pasien |
| 63 | `/equipment/brand` | `GET` | Merek mesin medis & laser (Pico, Nd:YAG, CO2, IPL, RF) | Merek Mesin |
| 64 | `/equipment/model` | `GET` | Model tipe mesin laser klinik | Model Mesin |
| 65 | `/equipment/series` | `GET` | Serial number unik mesin laser per cabang | Serial Unit Mesin |
| 66 | `/equipment/supplier` | `GET` | Kontak vendor penyedia servis mesin medis | Vendor Teknisi |
| 67 | `/locations/provinces` | `GET` | Master provinsi seluruh Indonesia | 36 Provinsi |
| 68 | `/locations/cities` | `GET` | Master kota/kabupaten | 732 Kota/Kab |
| 69 | `/locations/districts` | `GET` | Master kecamatan domisili pasien | 10.815 Kecamatan |
| 70 | `/locations/countries` | `GET` | Master negara | 292 Negara |

---

## 8. 🧪 Produksi Farmasi Racikan, Laporan & Konfigurasi

| # | Endpoint | Method | Deskripsi & Parameter | Kegunaan |
|---|---|:---:|---|---|
| 71 | `/activities` | `GET` | Catatan histori kegiatan promo, event, atau operasional | Log Event Klinik |
| 72 | `/report/appointment` | `GET` | Laporan agregasi reservasi dan show rate pasien | Statistik Reservasi |
| 73 | `/manufacture/work-order` | `GET` | Surat perintah peracikan produk farmasi klinik | Produksi Racikan |
| 74 | `/manufacture/material-release` | `GET` | Pengeluaran bahan baku racikan farmasi dokter | Pengeluaran Bahan |
| 75 | `/manufacture/finished-product` | `GET` | Penerimaan produk jadi hasil racikan ke gudang | Penerimaan Racikan |
| 76 | `/configuration-settings` | `GET` | Dump 941 aturan konfigurasi internal Neosoft Cube | Master Config |
