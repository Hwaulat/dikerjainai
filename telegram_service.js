/**
 * Telegram Dispatcher for KEFIR Clinic
 *
 * SEBELUMNYA: generate6Reports() mencampur beberapa angka nyata dengan
 * angka yang ditulis TETAP di kode, disajikan seolah laporan harian
 * lengkap. Yang paling serius: laporan HRD/Absensi (#4 & #5) MENGARANG
 * catatan keterlambatan dengan NAMA STAF ASLI ("Anisa Melati — 8 menit,
 * masuk 09:38 WIB") — pola sama dengan temuan dr. Dorra & consent foto
 * pasien di audit-audit sebelumnya, tapi di sini kejadiannya adalah
 * CATATAN DISIPLIN yang tidak pernah terjadi, dan kalau endpoint-nya
 * pernah benar-benar terhubung ke Telegram, ini akan terkirim ke grup
 * manajemen sebagai fakta.
 *
 * Laporan #2 (Chat/Leads) 100% karangan — TIDAK ADA pemantauan chat/leads
 * apa pun di sistem ini (sudah dicek berkali-kali di audit sebelumnya:
 * nol koneksi API Instagram/TikTok, WA assistant cuma menjawab pertanyaan
 * staf, tidak menghitung metrik chat masuk).
 *
 * Sekarang: tiap baris HANYA diisi angka yang benar-benar ada di `data`
 * (hasil getClinicSummary — sudah diverifikasi berkali-kali sepanjang
 * audit sesi ini). Bagian yang tidak ada sumbernya ditandai jujur,
 * bukan dikarang.
 */

function generate6Reports(data) {
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const kpi = data.kpi || {};
  const totalOmset = kpi.total_omset_formatted || 'Rp 0';
  const depok = (data.branches || []).find(b => b.name === 'Depok') || { revenue: 0, visits: 0 };
  const pdk = (data.branches || []).find(b => b.name === 'Pondok Kopi') || { revenue: 0, visits: 0 };
  const BELUM_ADA = '⚠️ Belum ada sumber data untuk bagian ini di sistem.';

  return [
    {
      id: 1,
      title: '1. Daily Report - Kunjungan Pasien',
      text: `Kunjungan Pasien — ${today}\n\nDepok: ${depok.visits || 0} kunjungan (Rp ${(depok.revenue || 0).toLocaleString('id-ID')})\nPondok Kopi: ${pdk.visits || 0} kunjungan (Rp ${(pdk.revenue || 0).toLocaleString('id-ID')})\n\nBreakdown per jam belum tersedia — tidak ada pencatatan waktu kedatangan per slot di sistem ini.`
    },
    {
      id: 2,
      title: '2. Daily Report - Chat & Leads',
      text: `Chat & Leads Masuk — ${today}\n\n${BELUM_ADA}\nTidak ada integrasi API Instagram/TikTok/WhatsApp Business untuk menghitung chat masuk, kontak baru, atau booking dari chat.`
    },
    {
      id: 3,
      title: '3. Daily Report - Sales',
      text: `Sales — ${today}\n\nTotal Omset (periode berjalan): ${totalOmset}\nPasien Baru: ${kpi.new_patients ?? '-'} orang\nPasien Lama: ${kpi.returning_patients ?? '-'} orang\n\nJadwal praktek dokter & appointment besok/lusa belum tersedia di ringkasan ini — cek tab Reminders & Alerts untuk jadwal terbaru.`
    },
    {
      id: 4,
      title: '4. Daily Report - HRD',
      text: `HRD — ${today}\n\n${BELUM_ADA}\nTidak ada sumber data absensi (Gaji.id/fingerprint belum terhubung), rekrutmen, atau turnover karyawan di sistem ini — lihat tab Human Resources untuk data staf yang memang tersedia (roster dari master Neosoft).`
    },
    {
      id: 5,
      title: '5. Daily Report - Absensi Shift',
      text: `Absensi Shift — ${today}\n\n${BELUM_ADA}\nJam masuk, keterlambatan, dan status kehadiran per staf tidak bisa dilaporkan karena belum ada integrasi absensi apa pun.`
    },
    {
      id: 6,
      title: '6. Daily Report - Finance',
      text: `Finance — ${today}\n\nTotal Omset (periode berjalan): ${totalOmset}\n\nPetty cash & rincian pembelian BHP belum tersedia di ringkasan ini — cek tab Finance untuk breakdown channel pembayaran & komisi yang sudah dihitung dari data nyata.`
    }
  ];
}

module.exports = { generate6Reports };
