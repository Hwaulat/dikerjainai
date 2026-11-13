// ==================================================================
// KEBIJAKAN DATA PER ROLE — SUMBER TUNGGAL
//
// Dipakai bersama oleh:
//   • server.js               → menyaring payload /api/ sebelum dikirim
//   • ai_executive_assistant.js → membatasi tool yang boleh dipanggil AI
//   • public/index.html       → menyembunyikan blok di tampilan
//
// File ini dibuat setelah ditemukan kebocoran: endpoint AI mengambil
// role dari BODY request (`payload.role || 'owner'`) dan katalog tool-nya
// sama untuk semua role — jadi user kasir yang sudah login bisa bertanya
// "berapa omset bulan ini?" dan AI menjawabnya dari get_clinic_summary.
// Menyalin kebijakan ke tiga tempat berbeda membuat celah seperti ini
// gampang terulang, makanya sekarang satu file saja.
//
// Kebijakan dikonfirmasi ke owner, 9 Sep 2026:
//   clinic_money    — angka rupiah tingkat KLINIK (omset, profit, target,
//                     payroll komisi, settlement). Owner & Finance saja.
//                     CATATAN: belanja per-pasien (total_spent, saldo
//                     deposit) TIDAK termasuk — itu data CRM yang memang
//                     dipakai sales & marketing untuk blast/upsell.
//   all_commissions — tabel komisi seluruh dokter + perawat + total payout.
//   own_commission  — dokter hanya boleh lihat barisnya sendiri.
//   clinical        — SOAP, next plan, diagnosis, foto klinis pasien.
// ==================================================================

const ROLE_DATA_PERMISSIONS = {
  owner:       { clinic_money: true,  all_commissions: true,  own_commission: false, clinical: true  },
  finance:     { clinic_money: true,  all_commissions: true,  own_commission: false, clinical: false },
  doctor:      { clinic_money: false, all_commissions: false, own_commission: true,  clinical: true  },
  hr:          { clinic_money: false, all_commissions: false, own_commission: false, clinical: false },
  marketing:   { clinic_money: false, all_commissions: false, own_commission: false, clinical: false },
  sales:       { clinic_money: false, all_commissions: false, own_commission: false, clinical: false },
  operational: { clinic_money: false, all_commissions: false, own_commission: false, clinical: false }
};

// Role tidak dikenal → jatuh ke yang PALING KETAT, jangan ke owner.
// Kalau default-nya owner, salah ketik satu huruf di nama role langsung
// membuka semua data.
const STRICTEST_ROLE = 'sales';

function permsForRole(role) {
  return ROLE_DATA_PERMISSIONS[role] || ROLE_DATA_PERMISSIONS[STRICTEST_ROLE];
}

module.exports = { ROLE_DATA_PERMISSIONS, STRICTEST_ROLE, permsForRole };
