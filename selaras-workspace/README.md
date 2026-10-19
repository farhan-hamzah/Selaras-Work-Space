# IT Selaras Workspace

Aplikasi manajemen project & task IT Selaras — Next.js 16 (App Router) + Supabase.

**Status: Fase 0 — Setup & Fondasi.** Next.js sudah terhubung ke Supabase, seluruh skema inti sudah ada di
migration, ada data contoh, dan tersedia halaman status + `GET /api/health`. Login, permission di level aplikasi,
dan fitur project/task dikerjakan mulai Fase 1, setelah review.

Penjelasan empat koreksi teknis (policy, cookie/session, logout paksa, audit log) ada di
[`docs/review-fase-0.md`](docs/review-fase-0.md).

---

## Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | ≥ 20.11 (diuji di 24.19) | `node -v` |
| npm | ≥ 10 | ikut terpasang bersama Node.js |
| Akun Supabase | paket gratis cukup | https://supabase.com/dashboard |
| Docker Desktop | opsional | hanya bila ingin Supabase **lokal** (lihat bagian bawah) |

Supabase CLI tidak perlu dipasang global; sudah ada di `devDependencies` dan dipanggil lewat skrip npm.

---

## Menjalankan dengan Supabase Cloud (± 15 menit)

### 1. Install dependency

```bash
npm install
```

### 2. Buat project Supabase untuk development

1. Buka https://supabase.com/dashboard → **New project**.
2. Nama: mis. `selaras-dev`. Region: **Southeast Asia (Singapore)**.
3. Buat **database password** yang kuat dan simpan — dipakai di `SUPABASE_DB_URL`.
4. Tunggu sampai project selesai dibuat (± 2 menit).

### 3. Matikan pendaftaran publik

**Authentication → Sign In / Providers → User Signups → matikan "Allow new users to sign up"**, lalu Save.

Akun dibuat oleh Admin (matriks User Management di SRS 3.7). Kalau signup dibiarkan aktif, siapa pun yang tahu URL
project dan publishable key (keduanya memang publik) bisa membuat akun sendiri. Pembuatan akun lewat Admin API dan
`npm run db:seed` tetap berjalan walaupun signup dimatikan.

### 4. Isi `.env.local`

```bash
cp .env.example .env.local        # Windows (cmd): copy .env.example .env.local
```

| Variabel | Ambil dari | Contoh |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL | `https://abcd…xyz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → **Publishable key** | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → **Secret key** (klik *Reveal*) | `sb_secret_…` |
| `SUPABASE_DB_URL` | Tombol **Connect** (bar atas) → Connection string → **Session pooler** | `postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` |
| `SEED_DEMO_PASSWORD` | tentukan sendiri, min. 12 karakter | password semua akun demo |
| `SEED_EMAIL_DOMAIN` | opsional, default `selaras.test` | domain email akun demo |

Penting:

- **Secret key tidak boleh diberi prefix `NEXT_PUBLIC_`.** Bila secret key tertukar ke variabel publik, aplikasi
  menolak konfigurasi tersebut dan halaman status menampilkan peringatan. ESLint juga menolak kode yang membaca
  secret key di luar `src/lib/supabase/admin.ts`.
- Pakai **Session pooler**, bukan *Direct connection*: direct connection hanya bisa lewat IPv6, sedangkan banyak
  jaringan kantor/rumah hanya IPv4.
- Karakter khusus di password database harus di-*percent-encode* di URL (`@` → `%40`, `#` → `%23`, `/` → `%2F`).
- Project lama yang masih punya kunci legacy `anon`/`service_role` tetap bisa dipakai, tetapi Supabase
  menjadwalkan kunci legacy itu deprecated akhir 2026.

### 5. Terapkan migration (skema + policy + audit log)

```bash
npm run db:push
```

Ada 4 migration di `supabase/migrations/`. Supabase mencatat migration yang sudah diterapkan, jadi perintah ini aman
diulang dan hanya menerapkan migration yang baru. Kalau ingin melihat dulu apa yang akan dijalankan:
`npm run db:push -- --dry-run`.

### 6. Isi data contoh

```bash
npm run db:seed
```

Perintah ini membuat 7 akun demo, 2 project, dan 7 task. Kalau datanya sudah ada, seed dilewati;
`npm run db:seed -- --reset` menghapus lalu membuat ulang project/task demo.

### 7. Jalankan aplikasi

```bash
npm run dev
```

Buka http://localhost:3000. Halaman status harus menunjukkan **Terhubung**, skema `Tabel inti 5/5 · Enum 4/4 ·
RLS aktif 5/5`, tabel akun demo, task per project, dan audit log.

```bash
curl http://localhost:3000/api/health
# {"status":"success","data":{"supabase":"connected","latencyMs":…,"database":{…}}}
```

### 8. Verifikasi permission langsung ke Supabase

```bash
npm run verify:supabase
```

Skrip ini login sungguhan sebagai akun-akun demo, lalu mencoba aksi yang seharusnya diizinkan dan yang seharusnya
ditolak. Contoh: viewer yang membuat task mencoba mengeditnya, akun nonaktif yang JWT-nya masih valid, Staff yang
mencoba menaikkan role-nya sendiri, dan pemalsuan audit log. Hasilnya dicetak sebagai tabel ✓/✗. Probe edit
memakai UPDATE tanpa perubahan nilai, jadi data contoh tidak berubah.

---

## Alternatif: Supabase lokal (butuh Docker)

```bash
npx supabase start          # pertama kali mengunduh image Docker (beberapa menit)
npx supabase status         # menampilkan API URL, Publishable key, Secret key, DB URL
```

Isi `.env.local` dengan nilai dari `supabase status`, yaitu `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` dan
`SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Setelah itu:

```bash
npx supabase db reset       # terapkan semua migration ke DB lokal
npm run db:seed
npm run dev
```

Studio lokal tersedia di http://127.0.0.1:54323. Konfigurasi lokal (`supabase/config.toml`) sudah mematikan signup
publik dan mewajibkan password minimal 12 karakter.

---

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server development (http://localhost:3000) |
| `npm run build` / `npm start` | Build & jalankan mode production |
| `npm run db:push` | Terapkan migration ke `SUPABASE_DB_URL` |
| `npm run db:seed` | Buat akun demo & data contoh (`-- --reset` untuk membuat ulang) |
| `npm run db:types` | Regenerate `src/types/database.ts` dari skema database (`SUPABASE_DB_URL`) — wajib setelah tiap migration |
| `npm run verify:supabase` | Cek koneksi, skema, seed, dan permission langsung ke project Supabase |
| `npm run test:db` | Uji RLS, grant, trigger, & audit log di Postgres in-memory (tanpa internet/Docker) |
| `npm test` | Semua test (database + unit) |
| `npm run check` | Lint + typecheck + test (jalankan sebelum membuat PR) |

---

## Data contoh

Password semua akun = `SEED_DEMO_PASSWORD`. Skenarionya sengaja memuat kasus-kasus yang perlu dibuktikan oleh
policy.

| Akun | Role global | Status | Project | Kenapa ada |
|---|---|---|---|---|
| `admin@…` Arif Pratama | admin | aktif | — | Admin melihat semua project walau bukan member (D1) |
| `rina@…` Rina Wulandari | staff | aktif | Alpha: owner · Beta: member | Owner = admin lokal project (D3) |
| `budi@…` Budi Santoso | staff | aktif | Alpha: member · Beta: viewer | Creator T2; viewer di Beta |
| `citra@…` Citra Lestari | staff | aktif | Alpha: member | Assignee T2, "member lain" untuk T1 (D2) |
| `dewi@…` Dewi Anggraini | staff | aktif | Alpha: **viewer** | Pernah member, membuat & mengerjakan T3, lalu diturunkan → tetap tidak boleh edit |
| `eko@…` Eko Saputra | staff | aktif | Beta: owner | Owner di satu project tidak punya akses ke project lain (D4) |
| `fajar@…` Fajar Nugroho | staff | **nonaktif** | Alpha: member | Assignee T4; akun nonaktif harus ditolak walau JWT masih valid |

Project: **Alpha** = "Migrasi Server Internal" (5 task), **Beta** = "Portal Helpdesk IT" (2 task). Definisi
lengkap ada di [`scripts/demo-data.ts`](scripts/demo-data.ts) dan dipakai bersama oleh seed maupun test.

---

## Pengujian

- **`npm run test:db`** menjalankan migration asli di PGlite (PostgreSQL 18 versi WebAssembly) dengan stub minimal
  lingkungan Supabase: role `anon`/`authenticated`/`service_role`, `auth.uid()` dari klaim JWT, dan default
  privileges Supabase. Query dijalankan dengan cara yang sama seperti PostgREST (`SET ROLE authenticated` + klaim
  JWT), dan setiap test di-rollback. Yang diuji: seluruh sel matriks permission, empat koreksi, dan *test pembanding*
  yang memasang kembali policy v0.2 untuk membuktikan bahwa celahnya memang nyata.
- **`tests/unit`** menguji validasi env (secret key yang tertukar ke variabel publik) dan klasifikasi health check
  terhadap server HTTP tiruan.
- **`npm run verify:supabase`** adalah verifikasi ujung-ke-ujung terhadap project Supabase sungguhan.

---

## Struktur folder

```
selaras-workspace/                  (= "nextjs-stack/" pada SRS Lampiran A)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                   halaman status Fase 0
│  │  └─ api/health/route.ts        GET /api/health
│  ├─ components/
│  │  ├─ ui/                        Card, Badge
│  │  └─ status/                    ConnectionStatus, DemoData
│  ├─ lib/
│  │  ├─ env.ts                     validasi env publik (Zod)
│  │  ├─ labels.ts                  label enum berbahasa Indonesia
│  │  ├─ supabase/
│  │  │  ├─ server.ts               client + sesi pengguna (Server Component/Action/Route Handler)
│  │  │  ├─ admin.ts                client secret key — satu-satunya pembaca SUPABASE_SECRET_KEY
│  │  │  ├─ proxy.ts                refresh sesi per request
│  │  │  ├─ cookie-options.ts       cookie HttpOnly/Secure/SameSite (koreksi #2)
│  │  │  └─ health.ts               logika health check
│  │  └─ dev/demo-overview.ts       data halaman status (development saja)
│  ├─ types/database.ts             tipe skema, di-generate Supabase CLI (npm run db:types)
│  └─ proxy.ts                      Next.js 16 "proxy" (dulu middleware.ts)
├─ supabase/
│  ├─ config.toml                   konfigurasi Supabase lokal
│  └─ migrations/                   skema, kontrol akses, audit log, health check
├─ scripts/                         seed, verify, db-push, db-types, demo-data
├─ tests/
│  ├─ db/                           uji RLS & audit (PGlite)
│  └─ unit/                         uji env & health
└─ docs/review-fase-0.md            penjelasan 4 koreksi + status Fase 0
```

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Halaman status: **Belum dikonfigurasi** | `.env.local` belum ada atau belum lengkap. Setelah mengubahnya, restart `npm run dev`. |
| **Migration belum dijalankan** (`schema_missing`) | Jalankan `npm run db:push`. |
| **Kunci ditolak** (`unauthorized`) | Publishable key salah, atau milik project lain dari URL yang dipakai. |
| **Tidak terjangkau** (`unreachable`) | URL salah, tidak ada internet, atau project Supabase sedang di-*pause* (project gratis di-pause setelah tidak aktif; buka dashboard lalu *Restore*). |
| `db:push` gagal: *network is unreachable* / *no route to host* | Memakai Direct connection (IPv6). Ganti ke **Session pooler**. |
| `db:push` gagal: *password authentication failed* | Password salah atau belum di-percent-encode. Reset di Project Settings → Database. |
| `db:seed`: `email_address_invalid` | Ganti `SEED_EMAIL_DOMAIN` (mis. ke domain kantor). |
| `db:seed`: "Profile tidak terbuat otomatis" | Migration belum lengkap; jalankan `npm run db:push`. |
| `verify:supabase`: login gagal | Seed belum dijalankan, `SEED_DEMO_PASSWORD` berubah sejak seed (jalankan `npm run db:seed` lagi untuk menyamakan), atau terkena rate limit login (tunggu beberapa menit). |
| `npm run dev`: "Another next dev server is already running" | Hentikan server lama (PID ada di pesan error), atau buka port yang disebutkan. |
| `db:types` gagal | Periksa `SUPABASE_DB_URL` (sama seperti `db:push`). Tanpa DB URL, skrip memakai project ref dan butuh `npx supabase login`. |

---

## Catatan keamanan

- `.env.local` tidak boleh di-commit (sudah ada di `.gitignore`). `.env.example` hanya berisi placeholder.
- Sesi Supabase disimpan di cookie **HttpOnly** dan hanya dibaca di server. Jangan memakai `createBrowserClient`
  untuk data atau aksi yang butuh login; ESLint akan menolaknya. Alasannya dijelaskan di koreksi #2.
- Secret key melewati seluruh RLS. Gunakan hanya di `src/lib/supabase/admin.ts`, hanya untuk hal yang memang tidak
  bisa dilakukan dengan sesi pengguna, dan hanya setelah hak akses pemanggil diperiksa.
