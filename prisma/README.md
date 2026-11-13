# Skema & migrasi (Prisma)

Skema PostgreSQL dikelola Prisma. Aplikasi sendiri tetap memakai driver `pg`
(`pg_store.js`, `db/relational.js`); Prisma dipakai untuk **skema dan migrasi**.

| Perintah | Fungsi |
|---|---|
| `npm run db:deploy` | Terapkan migrasi ke database (`prisma migrate deploy`) — dipakai di server/produksi |
| `npm run db:status` | Cek status migrasi |
| `npm run db:migrate` | Impor `data/*.json` ke tabel + verifikasi (setelah `db:deploy`) |
| `npx prisma migrate dev --name <nama>` | Buat migrasi baru dari perubahan `schema.prisma` (dev saja) |

`DATABASE_URL` harus memakai format `postgresql://USER@HOST:5432/DB` (sertakan USER).

## Menambah tabel / kolom
1. Ubah `prisma/schema.prisma`, lalu `npx prisma migrate dev --name <nama>`.
2. Bila tabel dipakai pemetaan JSON, tambahkan spesifikasinya di `db/relational.js`.
3. Commit `prisma/migrations/*` bersama perubahannya.

## Database yang sudah ada (mis. dev lokal)
`npx prisma migrate resolve --applied 0_init` menandai baseline tanpa menjalankan SQL.

`0_init` memuat bagian manual di akhir berkas (CHECK constraint dan indeks ekspresi)
yang tidak bisa dinyatakan di `schema.prisma` — jangan dihapus.
