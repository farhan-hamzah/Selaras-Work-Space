# Review Fase 0: Setup & Empat Koreksi Teknis

**IT Selaras Workspace** · 18 Oktober 2026, **direvisi 24 Oktober 2026** setelah review · Bahan review sebelum Fase 1
Dokumen acuan: SRS v0.2 dan Implementation Plan v0.2. Bagian yang direvisi di bawah diusulkan menjadi **v0.3**.

---

## Tindak lanjut review (24 Oktober 2026)

| # | Temuan review | Perbaikan | Bukti |
|---|---|---|---|
| 1 | Owner bisa mengeluarkan Viewer lalu menambahkannya lagi sebagai Member, sehingga melewati aturan "ubah role per-project khusus Admin". | Migration `20261024090000_member_role_guard.sql`. Role terakhir anggota yang dikeluarkan disimpan di `private.project_member_removals`. Non-Admin yang menambahkan kembali pengguna itu wajib memakai role yang sama; role berbeda ditolak (`42501`). Berlaku dua arah (viewer→member dan member→viewer). Lihat [aturan turunan e](#aturan-turunan-yang-kuambil-mohon-dikonfirmasi). | 8 test di `access-control.test.ts` bagian *"Revisi poin 1"*, ditambah 1 test pembanding: tanpa guard, Dewi kembali bisa mengedit T3. Probe live baru di `verify:supabase`. |
| 2 | Pengguna bisa memanggil `log_auth_event('USER_LOGOUT')` tanpa benar-benar logout. | Migration `20261024090100_auth_session_audit.sql`. RPC `log_auth_event` **dihapus**. `USER_LOGIN`/`USER_LOGOUT` kini dicatat oleh trigger pada `auth.sessions`, tabel yang hanya ditulis oleh server Supabase Auth: login = sesi dibuat, logout = sesi dihapus. Tidak ada lagi jalur bagi pengguna untuk menulis event autentikasi sendiri. Detail di [koreksi #4](#koreksi-4-penyimpanan-audit-log-yang-terjamin). | 7 test di `audit-log.test.ts` bagian *"Revisi poin 2"*, termasuk fail-closed. Probe live baru di `verify:supabase`: login/logout sungguhan tercatat per `session_id`, dan RPC lama tidak ada lagi. |
| 3 | Status implementasi bercampur: yang sudah jadi, yang masih rancangan, dan yang sudah diuji langsung tidak dibedakan. Logout paksa baru rancangan endpoint. | Bagian baru [Status implementasi](#status-implementasi) memisahkan tiga kategori itu. Koreksi #3 ditandai **rancangan**. | — |
| 4 | Migration, seed, dan `verify:supabase` belum dijalankan di Supabase asli. | Dijalankan di project development terpisah. Hasilnya ada di [Hasil uji di Supabase asli](#hasil-uji-di-supabase-asli). | Lihat bagian tersebut. |

---

## Ringkasan

| | |
|---|---|
| **Fase 0** | Next.js 16.4 + Supabase siap: klien server/admin, proxy sesi, `GET /api/health`, halaman status, 6 migration (skema lengkap, kontrol akses, audit log, health check, dan 2 migration revisi review), data contoh, dan panduan menjalankan ([README](../README.md)). |
| **Empat koreksi** | Koreksi #1, #2, dan #4 sudah diterapkan di kode/migration dan diuji otomatis. Koreksi #3 (logout paksa) **baru rancangan**: yang sudah jadi hanya fungsi database `admin_set_user_active`, sedangkan endpoint dan ban di Supabase Auth dikerjakan di Fase 3. Total 80 test database + 11 unit test lulus. Test pembanding memasang kembali kondisi lama dan membuktikan celahnya memang nyata. |
| **Pengujian langsung** | Lihat [Hasil uji di Supabase asli](#hasil-uji-di-supabase-asli). Pengujian cookie dan sesi lengkap menunggu fitur login di Fase 1. |
| **Butuh keputusan** | 4 poin di bagian [Perlu diputuskan saat review](#perlu-diputuskan-saat-review). |

---

## Status implementasi

Tiga kategori di bawah ini dipisahkan dengan tegas:

- **Sudah jadi**: kode atau migration ada di repo dan diuji otomatis (`npm test`).
- **Baru rancangan**: baru ada di dokumen ini, belum ada kodenya.
- **Diuji langsung**: sudah dijalankan terhadap project Supabase asli.

"Diuji otomatis" berarti migration asli dijalankan di PGlite (Postgres 18 WebAssembly) dengan stub lingkungan
Supabase (`tests/db/supabase-stub.sql`), atau logika aplikasi diuji terhadap server Supabase tiruan. Bukti ini kuat
untuk policy dan trigger, tetapi tidak menggantikan uji di Supabase asli. Contohnya, perilaku Supabase Auth pada
`auth.sessions` di PGlite hanya ditiru.

### Sudah jadi (kode/migration ada dan diuji otomatis)

| Komponen | Lokasi | Diuji otomatis | Diuji langsung |
|---|---|---|---|
| Skema inti: 5 tabel, 4 enum, index, `updated_at`, profile otomatis | migration `…090000_core_schema` | ✅ `schema.test.ts` | lihat [hasil](#hasil-uji-di-supabase-asli) |
| Kontrol akses: grant kolom, RLS, guard trigger, RPC soft delete & admin (koreksi #1) | migration `…090100_access_control` | ✅ `access-control.test.ts` | lihat hasil |
| Guard perubahan role lewat hapus lalu tambah lagi (revisi poin 1) | migration `20261024090000_member_role_guard` | ✅ 8 test + pembanding | lihat hasil |
| Audit log perubahan data: trigger atomik, append-only, anti-pemalsuan (koreksi #4) | migration `…090200_audit_log` | ✅ `audit-log.test.ts` | lihat hasil |
| Audit login/logout dari `auth.sessions` (revisi poin 2) | migration `20261024090100_auth_session_audit` | ✅ 7 test (sesi ditiru) | lihat hasil |
| Fungsi database `admin_set_user_active` / `admin_set_user_role` | migration `…090100_access_control` | ✅ | lihat hasil |
| `health_check()`, `GET /api/health`, halaman status | migration `…090300`, `src/app` | ✅ terhadap Supabase tiruan | lihat hasil |
| Client Supabase server/admin/proxy dan opsi cookie HttpOnly (koreksi #2) | `src/lib/supabase/*` | ✅ lint & typecheck · ⏳ perilaku cookie belum diuji (belum ada login) | ⏳ Fase 1 |
| Skrip `db:push`, `db:seed`, `db:types`, `verify:supabase` | `scripts/` | — (skrip ke Supabase asli) | lihat hasil |

### Baru rancangan (belum ada kode)

| Komponen | Rancangan ada di | Dikerjakan di |
|---|---|---|
| **Logout paksa**: endpoint `PATCH /api/admin/members/[id]` + ban lewat `auth.admin.updateUserById(ban_duration)` | [Koreksi #3](#koreksi-3-logout-paksa-saat-admin-menonaktifkan-akun) | Fase 3 |
| `requireAuth()` / `requireAdmin()` (`getUser()` + cek `is_active`) | Koreksi #2 & #3 | Fase 1 |
| Halaman login/logout dan Server Action-nya | — | Fase 1 |
| Pencatatan `USER_LOGIN_FAILED` (server, secret key) | [Koreksi #4](#koreksi-4-penyimpanan-audit-log-yang-terjamin) | Fase 1 |
| `canDo()` di lapisan aplikasi dan pemetaan error DB → HTTP (`mapDbError`) | Koreksi #1 & #3 | Fase 1 |

`recordAuthEvent()` (retry pemanggilan `log_auth_event`) **dihapus dari rancangan** karena digantikan trigger
`auth.sessions` (revisi poin 2).

---

## Status Fase 0 terhadap DoD (Implementation Plan, Fase 0)

| # | Kriteria selesai | Sudah jadi & diuji otomatis | Diuji langsung di Supabase asli |
|---|---|---|---|
| 1 | `npm run dev` berhasil tanpa error | ✅ Dev server dan `next build` produksi berhasil tanpa error/warning | — (tidak butuh Supabase) |
| 2 | `/api/health` mengembalikan `connected` | ✅ Format `{ status: "success", data: { supabase: "connected" } }` diuji end-to-end ke Supabase tiruan. Status gagal dibedakan: belum dikonfigurasi, tidak terjangkau, kunci ditolak, migration belum jalan, skema belum lengkap | lihat [hasil](#hasil-uji-di-supabase-asli) |
| 3 | Supabase client bisa dibuat di server & browser | ✅ **diubah**: client server, admin, dan proxy tersedia. Client browser sengaja tidak dipakai untuk sesi (koreksi #2) | ⏳ cookie & sesi diuji saat fitur login ada (Fase 1) |
| 4 | Seluruh tabel inti & enum ter-migrate | ✅ 6 migration diterapkan ke PGlite. 5 tabel, 4 enum, dan RLS di 5 tabel diverifikasi `schema.test.ts` dan `health_check()` | lihat hasil |
| 5 | `.env.example` terdokumentasi | ✅ Setiap variabel dijelaskan asal nilainya; README memuat tabel isian | — |

---

## Koreksi #1: Policy database disamakan dengan matriks permission

### Masalah di v0.2

Sumbernya Implementation Plan 2.2 dan tugas Fase 1 nomor 7.

1. **Viewer bisa mengedit task.** Policy `"Creator or assignee can update their task"` hanya memeriksa
   `assignee_id = auth.uid() OR created_by = auth.uid()`. Policy PostgreSQL bersifat *permissive* (digabung dengan
   OR), jadi siapa pun yang tercatat sebagai creator/assignee lolos: Viewer, mantan member yang sudah dikeluarkan,
   maupun akun nonaktif.
2. **Tidak ada policy yang memeriksa `is_active`.** Pemeriksaan itu hanya ada di `requireAuth()` Next.js. Padahal
   URL project dan publishable key memang publik, sehingga pemegang JWT bisa langsung memanggil Data API Supabase dan
   melewati Next.js selama JWT berlaku (≤ 1 jam).
3. **Staff bisa menjadikan dirinya Admin.** Supabase memberi `GRANT ALL` pada tabel baru ke role `authenticated`.
   Dengan policy "user ubah baris sendiri", perintah `update profiles set role = 'admin' where id = <diri sendiri>`
   akan lolos.
4. Celah lain: policy `FOR ALL` untuk owner/admin di tasks mengizinkan *hard delete* (bertentangan dengan NFR-REL-02);
   member bisa me-*reassign* task lewat UPDATE biasa (bertentangan dengan FR-TASK-06); `project_members` belum
   punya policy; subquery ke `profiles`/`project_members` di dalam policy rawan rekursi RLS.

**Bukti:** `tests/db/access-control.test.ts` bagian *"Pembanding — policy v0.2"* memasang ulang policy v0.2 di
transaksi yang di-rollback. Hasilnya Dewi (viewer) berhasil mengedit T3, Fajar (nonaktif) berhasil mengubah status
T4, dan Budi (staff) berhasil mengubah role-nya menjadi admin.

### Perbaikan

Lihat migration `supabase/migrations/20261018090100_access_control.sql`.

- **Helper `SECURITY DEFINER`** di schema `private` (tidak diekspos API): `is_admin()`, `project_role(project)`,
  `can_edit_task(...)`, `is_project_contributor(...)`. **Semua mensyaratkan akun aktif**, sehingga akun nonaktif
  otomatis ditolak oleh setiap policy.
- **`can_edit_task`**: Admin → ya · Owner → ya · Member → hanya bila creator **atau** assignee · Viewer → **tidak
  pernah** · bukan member/nonaktif → tidak.
- **Empat lapis**, karena satu lapis saja tidak cukup:

| Aturan matriks | Ditegakkan oleh |
|---|---|
| Kolom yang boleh disentuh role API (role, is_active, created_by, project_id, deleted_at tidak termasuk) | `GRANT` tingkat kolom |
| Siapa boleh melihat, membuat, dan mengedit baris mana | RLS policy per tabel |
| Assign/reassign hanya Admin/Owner; assignee harus owner/member aktif; role/status akun tidak bisa diubah lewat API | Guard trigger (butuh nilai lama vs baru, yang tidak bisa diekspresikan RLS) |
| Hapus task/project (soft delete), ubah role global, aktif/nonaktif akun | Fungsi RPC yang memeriksa `is_admin()`/owner **di database** |

**Bukti setelah koreksi:** 55 test di `access-control.test.ts` (termasuk 9 test revisi poin 1), mencakup setiap sel
matriks Projects dan Tasks, kasus Dewi/Fajar/Budi, dan lapis kedua (guard trigger tetap menolak walaupun `GRANT`
kolom sengaja dibuka keliru).

### Teks revisi dokumen

- **SRS 3.1 D2**, tambahkan: *"Hak edit creator/assignee hanya berlaku selama pengguna tersebut masih berstatus owner
  atau member pada project itu dan akunnya aktif. Viewer tidak pernah dapat mengedit, walaupun tercatat sebagai
  creator atau assignee task."*
- **SRS FR-TASK-04 dan FR-TASK-05**: ganti "creator ATAU assignee" menjadi *"creator ATAU assignee yang masih
  berperan owner/member di project tersebut (bukan viewer) dan akunnya aktif"*.
- **SRS 3.7 (catatan di bawah matriks Tasks)**, tambahkan: *"Kolom 'Member (creator/assignee)' berlaku hanya
  selama role-nya member. Bila diturunkan menjadi viewer atau dinonaktifkan, berlaku kolom Viewer/Non-member. Setiap
  sel matriks juga mensyaratkan akun aktif."*
- **SRS 5.2**, baris `PATCH /api/projects/[id]/tasks/[taskId]`: akses menjadi *"Admin / Owner / creator-assignee
  yang masih member (D2)"*. Baris `DELETE` task tetap Admin / Owner.
- **Implementation Plan 2.2**: ganti contoh SQL dengan ringkasan empat lapis di atas, lalu rujuk migration
  `20261018090100_access_control.sql` sebagai sumber kebenaran.
- **Implementation Plan Fase 1, tugas 7**: menjadi *"profiles: pengguna membaca barisnya sendiri dan rekan satu
  project, mengubah hanya nama/avatar (GRANT kolom); role & is_active hanya lewat fungsi admin; Admin membaca semua."*
- **Implementation Plan 2.1 `canDo()`**: logika v0.2 sudah benar untuk viewer, tetapi perlu satu tambahan.
  Endpoint `PATCH` task yang payload-nya mengubah `assignee_id` wajib memanggil `canDo(user, 'assign', 'task', …)`,
  bukan hanya `'edit'`, agar lapisan aplikasi sama dengan guard trigger di database.

### Aturan turunan yang kuambil (mohon dikonfirmasi)

Matriks v0.2 tidak menjawab beberapa kasus berikut secara eksplisit:

- a. Owner hanya bisa menambah/menghapus **member dan viewer**. Menjadikan seseorang owner, mengubah role
  per-project, dan mengeluarkan owner adalah tindakan Admin, mengikuti baris *"Ubah role per-project: Admin"*.
- b. Member boleh membuat task tanpa assignee atau untuk **dirinya sendiri**. Meng-assign ke orang lain mengikuti
  FR-TASK-06 (Admin/Owner).
- c. Assignee baru harus **owner/member aktif** di project tersebut.
- d. Staff hanya melihat profile **dirinya dan rekan satu project**. Daftar semua pengguna khusus Admin.
- e. *(revisi 24 Oktober, poin 1)* Owner yang menambahkan kembali pengguna yang **pernah dikeluarkan** dari project
  hanya boleh memakai **role terakhirnya**. Role berbeda dianggap perubahan role per-project, jadi khusus Admin.
  Aturan ini berlaku dua arah: viewer→member (naik) maupun member→viewer (turun). Untuk menurunkan akses, owner
  tetap bisa mengeluarkan anggota. Pengguna yang belum pernah menjadi anggota bisa ditambahkan seperti biasa.

---

## Koreksi #2: Mekanisme cookie/session dan klaim HttpOnly

### Masalah di v0.2

FR-AUTH-07, NFR-SEC-03, dan tabel SRS 5.4 menyatakan bahwa `@supabase/ssr` menyimpan token di cookie HTTP-only yang
tidak bisa diakses JavaScript. Ini **tidak sesuai** dengan perilaku sebenarnya:

- Default `@supabase/ssr` adalah `httpOnly: false` (`node_modules/@supabase/ssr/dist/main/utils/constants.js`).
  Alasannya, `createBrowserClient` membaca dan menulis sesi lewat `document.cookie`. Panduan resmi Supabase menyebut
  HttpOnly *"not necessary"* karena sisi browser butuh refresh token.
- Atribut `Secure` juga tidak diset secara default.
- SRS 5.3 sendiri merencanakan *"Query dari browser & server"*. Selama browser client dipakai dengan sesi, cookie
  sesi **tidak bisa** HttpOnly, jadi klaim "mencegah pencurian via XSS" tidak berlaku.

### Pilihan

| | A. Ikuti default Supabase | **B. Sesi hanya di server (dipilih)** |
|---|---|---|
| Cookie | Bisa dibaca JS (`httpOnly: false`) | `HttpOnly` + `Secure` (production) + `SameSite=Lax` |
| Query dari browser | Boleh, langsung ke Supabase | Tidak. Semua lewat Server Component, Server Action, atau Route Handler |
| Bila terjadi XSS | Refresh token bisa dicuri, sesi bisa dibajak dari luar | Token tidak bisa dibaca. XSS tetap bisa bertindak di tab korban, jadi escaping React & CSP tetap wajib |
| Kesesuaian dengan SRS | Klaim HttpOnly dihapus dari SRS | Klaim HttpOnly tetap berlaku, dengan syarat tertulis |
| Konsekuensi | — | Realtime dari browser (Fase 4+) butuh keputusan tersendiri |

Opsi B dipilih karena SRS 5.2 sudah mendesain semua akses data lewat API server (sehingga `canDo()` dan
`logActivity()` selalu terlewati), dan karena klaim keamanan di dokumen tetap benar. Penerapannya ada di
`src/lib/supabase/cookie-options.ts` (opsi cookie), `server.ts`, dan `proxy.ts`. ESLint **menolak** import
`createBrowserClient`, supaya tidak ada developer yang tanpa sadar membuat client browser yang "tidak melihat"
sesi. Kalau di review dipilih opsi A, perubahannya kecil: set `httpOnly: false`, tambahkan `client.ts`, hapus aturan
ESLint, dan sesuaikan teks SRS.

Hasil pengecekan ulang lain:

- Respons yang membawa cookie sesi kini menyertakan `Cache-Control: private, no-store` (header dari `@supabase/ssr`
  diteruskan di proxy), supaya CDN tidak menyajikan cookie seseorang ke pengguna lain.
- `getClaims()` memverifikasi JWT secara lokal: cepat, tetapi **tidak tahu** bila sesi sudah dicabut atau di-ban.
  `getUser()` bertanya ke Auth server. Rekomendasi untuk Fase 1: proxy memakai `getClaims()` untuk refresh dan
  redirect optimistis, sedangkan `requireAuth()` memakai `getUser()` ditambah query `profiles.is_active`, sehingga
  ban dari koreksi #3 langsung berlaku.
- Next.js 16 mengganti `middleware.ts` menjadi **`proxy.ts`** (runtime Node.js).

### Teks revisi dokumen

- **SRS FR-AUTH-07**: *"Sistem harus menyimpan token sesi pada cookie dengan atribut HttpOnly, Secure (production),
  dan SameSite=Lax melalui opsi `cookieOptions` @supabase/ssr. Sesi hanya dibaca dan diperbarui di server; aplikasi
  tidak memakai Supabase client di browser untuk data atau aksi yang membutuhkan sesi."*
- **SRS NFR-SEC-03**, tambahkan: *"Atribut ini harus disetel eksplisit; default @supabase/ssr adalah
  `httpOnly: false` dan tanpa `Secure`."*
- **SRS 5.3**, baris "Supabase JS Client": *"Query dari server (Server Component/Action, Route Handler) via
  @supabase/ssr. Tidak ada query ber-sesi dari browser."*
- **SRS 5.4**, baris "HTTP-only cookies": *"Disetel oleh aplikasi (bukan default library). Konsekuensinya, client
  di browser tidak dapat membaca sesi."* Baris "Secure flag": *"Disetel saat NODE_ENV=production."*
- **Implementation Plan Fase 0, tugas 4 & DoD 3**: *"client.ts (browser)"* diganti *"server.ts (sesi pengguna),
  admin.ts (secret key, server-only), proxy.ts (refresh sesi)"*. Tugas 7: "middleware" → `proxy.ts`.

---

## Koreksi #3: Logout paksa saat Admin menonaktifkan akun

> **Status: RANCANGAN.** Endpoint di bawah belum diimplementasikan; kodenya dikerjakan di Fase 3. Yang sudah jadi dan
> diuji hanya bagian database: `admin_set_user_active` (menolak non-admin dan menolak admin menonaktifkan dirinya
> sendiri) serta `is_active` di setiap policy RLS. Mekanisme ban di Supabase Auth baru diverifikasi lewat pembacaan
> source code Supabase Auth, belum dicoba langsung.

### Masalah di v0.2

Bagian terkait: Implementation Plan 3.2, NFR-SEC-07, SRS 5.3, dan SRS 5.5-A.

- `supabaseAdmin.auth.admin.signOut(params.id, 'global')` keliru: signature-nya `signOut(jwt, scope)` dengan
  parameter pertama *"A valid, logged-in JWT"* (`@supabase/auth-js`, `GoTrueAdminApi.js`). Admin tidak memegang JWT
  milik pengguna target. Memberi userId membuat request ditolak, dan karena `{ error }` tidak diperiksa, kegagalan
  itu **diam-diam**: endpoint tetap membalas `success` padahal tidak ada sesi yang dicabut.
- Endpoint contoh **tidak memeriksa hak Admin** sama sekali. Komentar *"dipanggil dengan service_role key"* hanya
  menjelaskan kunci yang dipakai server, bukan siapa pemanggilnya.
- Masalah lain: hasil `update profiles` tidak dicek; `params` tidak di-`await` (sejak Next.js 15 `params` adalah
  Promise); tidak ada validasi input; `logActivity` dipanggil dengan `userId: null`.

### Mekanisme yang benar (diverifikasi di source Supabase Auth)

- `auth.admin.updateUserById(id, { ban_duration: '876000h' })` mem-*ban* pengguna. Akibatnya Auth server menolak
  pemakaian refresh token (*"Invalid Refresh Token: User Banned"*), **menolak request terautentikasi termasuk
  `getUser()` walaupun access token terbit sebelum ban** (*"Reject banned users who still hold an access token
  issued before the ban"*), dan menolak login baru. Membuka ban: `ban_duration: 'none'`.
- Data API (PostgREST) hanya memverifikasi tanda tangan JWT dan tidak tahu soal ban. Celah ini ditutup oleh
  `is_active` di setiap policy (koreksi #1), sehingga penolakan berlaku **seketika** di semua lapisan, tanpa
  menunggu JWT kedaluwarsa.

### Alur endpoint yang diusulkan (Fase 3, belum diimplementasikan)

```ts
// src/app/api/admin/members/[id]/route.ts
const Body = z.object({ is_active: z.boolean() })
const BAN_FOREVER = '876000h' // ±100 tahun; dibuka dengan 'none'

export async function PATCH(req: Request, ctx: RouteContext<'/api/admin/members/[id]'>) {
  // 1. Hak akses: sesi valid (getUser) + akun aktif + role admin → 401/403
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // 2. Validasi input → 400
  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return error(400, 'ID tidak valid')
  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return error(400, 'Body harus { is_active: boolean }')
  if (id === auth.user.id && !body.data.is_active) return error(400, 'Tidak bisa menonaktifkan akun sendiri')

  // 3. Sumber kebenaran: profiles.is_active + audit log dalam satu transaksi.
  //    Dipanggil dengan sesi ADMIN (bukan secret key), sehingga is_admin() dicek ulang di database.
  const supabase = await createClient()
  const { error: dbError } = await supabase.rpc('admin_set_user_active', {
    p_user_id: id,
    p_is_active: body.data.is_active,
  })
  if (dbError) return mapDbError(dbError) // 42501→403, P0002→404, 22023→400, lainnya→500

  // 4. Lapis Supabase Auth: ban / buka ban (butuh secret key)
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(id, {
    ban_duration: body.data.is_active ? 'none' : BAN_FOREVER,
  })
  if (banError) {
    console.error(JSON.stringify({ event: 'AUTH_BAN_SYNC_FAILED', target: id, actor: auth.user.id, message: banError.message }))
    return Response.json(
      { status: 'partial', retryable: true,
        message: 'Status akun tersimpan dan semua akses data sudah ditolak, tetapi sinkronisasi ke Supabase Auth gagal. Ulangi aksi ini.' },
      { status: 502 },
    )
  }
  return Response.json({ status: 'success' })
}
```

| Langkah | Bila gagal | Respons | Kondisi akhir |
|---|---|---|---|
| 1. `requireAdmin()` | tidak login / bukan admin / nonaktif / di-ban | 401 / 403 | Tidak ada perubahan |
| 2. Validasi | ID/body salah, menonaktifkan diri sendiri | 400 | Tidak ada perubahan |
| 3. RPC database | bukan admin / user tidak ada / input salah / error lain | 403 / 404 / 400 / 500 | Rollback: status **dan** log tidak tersimpan |
| 4. Ban di Auth | jaringan / API Auth error | 502 `partial`, `retryable` | `is_active=false` sudah memblokir semua data (RLS + requireAuth). Ban dicoba ulang; endpoint idempoten, aman diulang |

Urutannya sengaja **database dulu, lalu Auth**. Begitu langkah 3 sukses, pengguna sudah tidak bisa mengakses data
apa pun. Langkah 4 menutup pintu login dan refresh. Kalau urutannya dibalik dan langkah database gagal, pengguna
akan ter-ban tanpa jejak audit.

Bagian database (`admin_set_user_active`, yang menolak non-admin dan menolak admin menonaktifkan dirinya sendiri) sudah
ada dan diuji. Endpoint Next.js-nya dibangun di Fase 3 sesuai rencana.

### Teks revisi dokumen

- **SRS NFR-SEC-07**: *"Saat Admin menonaktifkan akun, sistem harus (1) menyetel profiles.is_active = false melalui
  fungsi database yang memeriksa hak Admin dan mencatat audit dalam transaksi yang sama, lalu (2) mem-ban pengguna
  di Supabase Auth dengan `auth.admin.updateUserById(id, { ban_duration })` sehingga refresh token dan request
  terautentikasi ditolak. Kegagalan langkah (2) dilaporkan ke Admin sebagai keberhasilan parsial yang dapat
  diulang. `auth.admin.signOut()` tidak dipakai karena membutuhkan JWT milik pengguna target."*
- **SRS 5.3**, baris "Supabase Auth Admin API": *"`updateUserById(ban_duration)` untuk pencabutan sesi paksa;
  `createUser`/`inviteUserByEmail` untuk pembuatan akun."*
- **SRS 5.5-A, poin ketiga**: ganti `signOut(userId, 'global')` dengan mekanisme ban di atas.
- **Implementation Plan 3.2**: ganti kode contoh dengan alur di atas. **Fase 3, tugas 4**: *"Saat is_active diubah
  ke false: RPC `admin_set_user_active` lalu `updateUserById(ban_duration)`."* **Fase 3, DoD 4**: cara uji menjadi
  *"Nonaktifkan akun yang sedang login. Request berikutnya ditolak (RLS/requireAuth), refresh token ditolak dengan
  'User Banned', login ulang ditolak, dan mengaktifkan kembali memulihkan akses."*

---

## Koreksi #4: Penyimpanan audit log yang terjamin

### Masalah di v0.2

Bagian terkait: Implementation Plan 2.3, Fase 1 tugas 9, NFR-PERF-01, dan SRS 6.3.

- `logActivity()` dipanggil **tanpa `await`** dan hasil insert-nya tidak dicek. Akibatnya kegagalan hilang tanpa
  jejak. Di hosting serverless (mis. Vercel), promise yang belum selesai juga bisa terputus begitu respons terkirim,
  sehingga log bisa hilang walaupun database sehat.
- Mutasi dan log adalah dua operasi terpisah. Mutasi bisa sukses sementara log gagal, sehingga ada perubahan data
  tanpa jejak, yang justru ingin dicegah oleh audit trail.
- Policy `INSERT` untuk `authenticated` dan `user_id` yang diambil dari parameter membuat log **bisa dipalsukan** atas
  nama orang lain. Test pembanding di `audit-log.test.ts` membuktikannya.

### Desain baru

Lihat migration `supabase/migrations/20261018090200_audit_log.sql`.

| Jenis event | Cara dicatat | Jaminan | Bila penulisan log gagal |
|---|---|---|---|
| Perubahan data: `TASK_*`, `PROJECT_*`, `PROJECT_MEMBER_*`, `USER_ROLE_CHANGED`, `USER_ACTIVATED/DEACTIVATED` | **Trigger AFTER di database**, dalam transaksi yang sama dengan perubahan | Atomik: data berubah **jika dan hanya jika** log tersimpan. Tidak ada endpoint yang bisa "lupa" mencatat | **Fail-closed**: seluruh perubahan di-rollback dan API menerima error (diuji) |
| `USER_LOGIN`, `USER_LOGOUT` *(direvisi 24 Okt, poin 2)* | **Trigger AFTER INSERT/DELETE pada `auth.sessions`**, tabel yang hanya ditulis server Supabase Auth. Login = Auth membuat sesi; logout = Auth menghapus sesi. `user_id`, IP, dan user agent diambil dari baris sesi; `session_id` disimpan di metadata | Event hanya ada bila sesi **benar-benar** dibuat/dihapus Auth. Tidak ada RPC atau tabel yang bisa ditulis pengguna untuk event ini | **Fail-closed**: login/logout ikut gagal (diuji). Ini mengubah usulan sebelumnya (fail-open), lihat [keputusan #2](#perlu-diputuskan-saat-review) |
| `USER_LOGIN_FAILED` (belum ada sesi) | *Rancangan Fase 1:* server menulis dengan secret key setelah login gagal | Hasilnya selalu diperiksa | Ulangi 2×, lalu log terstruktur `AUDIT_WRITE_FAILED` ke log server |

Penguatan lainnya:

- **Append-only benar-benar ditegakkan**: tidak ada `GRANT` UPDATE/DELETE/TRUNCATE untuk role mana pun, termasuk
  `service_role`, dan trigger menolak operasi itu bahkan dari pemilik database. Arsip/retensi kelak harus lewat
  migration yang di-review.
- **Anti-pemalsuan**: role API tidak bisa INSERT langsung ke `activity_logs`. Pelaku selalu `auth.uid()`.
- **Konteks**: IP dan user agent pengguna akhir diteruskan server lewat header `x-client-ip`/`x-client-user-agent`.
  Header yang rusak tidak membatalkan pencatatan.
- `created_at` memakai `clock_timestamp()` (waktu kejadian sebenarnya, urut walau dalam satu transaksi), dan
  `user_id` **tanpa foreign key**, supaya ID pelaku tetap tersimpan walaupun akunnya kelak dihapus.
- **Performa**: biayanya satu `INSERT` ber-index per mutasi di transaksi yang sama. Ini menggantikan pendekatan
  "async" pada NFR-PERF-01, yang justru menjadi sumber kehilangan log.

**Bukti:** 20 test di `audit-log.test.ts`. Yang diuji: isi log (nilai lama/baru, pelaku), satu UPDATE menghasilkan
log per jenis aksi, UPDATE yang ditolak policy tidak menghasilkan log, **simulasi kegagalan penyimpanan log
membatalkan perubahan task**, admin/service_role/pemilik DB tidak bisa mengubah atau menghapus log, staff tidak bisa
membaca atau memalsukan log, IP/user agent dari header ikut tersimpan, dan event login/logout (di bawah).

### Event login/logout dari Supabase Auth (revisi poin 2)

Desain awal memakai RPC `public.log_auth_event(p_action)` yang dipanggil server setelah login/logout. Masalahnya, RPC
itu juga bisa dipanggil langsung oleh siapa pun yang punya sesi (Data API + publishable key). Akibatnya pengguna bisa
mencatat `USER_LOGOUT` tanpa benar-benar logout, atau `USER_LOGIN` berulang kali. Memeriksa "apakah ini dipanggil
dari server" tidak mungkin dilakukan di database, karena server dan pengguna memakai JWT yang sama.

Desain baru (`supabase/migrations/20261024090100_auth_session_audit.sql`):

| Kejadian di Supabase Auth | Perubahan di `auth.sessions` | Dicatat sebagai |
|---|---|---|
| Login berhasil (password, magic link, OTP, OAuth, SSO) | INSERT 1 baris sesi | `USER_LOGIN` + `last_login_at` diperbarui |
| Refresh token | tidak ada sesi baru | tidak dicatat (memang bukan login) |
| `POST /logout` scope `local` / `global` / `others` | DELETE 1 / semua / semua kecuali sesi ini | `USER_LOGOUT` per sesi yang berakhir |
| Pencabutan sesi oleh Auth (ganti password, unenroll MFA) atau akun dihapus | DELETE | `USER_LOGOUT` per sesi |
| Pembersihan sesi yang sudah kedaluwarsa (`not_after` lewat) | DELETE | tidak dicatat (bukan logout) |

- **Kenapa ini "proses autentikasi yang valid"**: `auth.sessions` hanya ditulis server Supabase Auth (role
  `supabase_auth_admin`). Role API tidak punya hak apa pun atas tabel itu, dan schema `auth` tidak diekspos Data API.
  Satu-satunya cara memunculkan `USER_LOGOUT` adalah benar-benar mengakhiri sesi di Supabase Auth.
- `metadata.session_id` sama dengan klaim `session_id` di JWT, sehingga login dan logout satu sesi bisa dipasangkan.
  Login akun nonaktif yang belum di-ban ditandai `account_active: false`.
- Supabase mengizinkan trigger pada `auth.sessions` ([changelog 21 April 2025](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025)).
  Perilaku INSERT/DELETE di atas dicek dari source Supabase Auth (`internal/models/sessions.go`, `cleanup.go`,
  `internal/api/logout.go`) dan diuji langsung oleh `verify:supabase`.
- **Batasan yang perlu diketahui:**
  - IP/user agent yang tercatat adalah yang dilihat Supabase Auth. Bila nanti login dilakukan lewat Server Action,
    yang terlihat adalah IP server. Penerusan IP klien perlu diuji di Fase 1.
  - Bila fitur *session timebox / inactivity timeout* (paket Pro) diaktifkan kelak, pembersihan sesi oleh fitur itu
    akan tercatat sebagai `USER_LOGOUT` sekitar 24 jam setelah sesi berakhir. Saat ini fitur tersebut tidak dipakai.
- Di Fase 1, kode login/logout **tidak perlu** memanggil apa pun untuk audit. Cukup `signInWithPassword` /
  `signOut`.

### Teks revisi dokumen

- **SRS FR-AUTH-06** *(direvisi 24 Okt)*, tambahkan: *"…login dan logout dicatat oleh database dari pembuatan dan
  penghapusan sesi di Supabase Auth (`auth.sessions`), dalam transaksi yang sama. Pengguna tidak dapat mencatat event
  autentikasi secara langsung. Login gagal dicatat oleh server memakai secret key."*
- **SRS FR-TASK-08**, tambahkan: *"…dicatat oleh trigger database dalam transaksi yang sama dengan perubahan.
  Perubahan dibatalkan bila log gagal tersimpan."*
- **SRS FR-LOG-04**, tambahkan: *"…ditegakkan oleh hak akses dan trigger database, berlaku juga untuk secret
  key/service role. Role API tidak dapat menulis log secara langsung."*
- **SRS NFR-PERF-01**: *"Pencatatan activity log tidak boleh fire-and-forget. Log perubahan data ditulis dalam
  transaksi yang sama, dengan overhead satu INSERT ber-index per mutasi."*
- **SRS 6.3** (catatan activity_logs): *"…hanya SELECT (khusus Admin). INSERT hanya oleh trigger & fungsi database;
  `user_id` tanpa foreign key agar jejak pelaku tetap ada."*
- **Implementation Plan 2.3**: ganti `logActivity()` fire-and-forget dengan tabel desain di atas. **Fase 1, tugas
  9** menjadi *"Trigger audit data + trigger `auth.sessions` untuk login/logout (sudah ada sejak Fase 0) +
  pencatatan `USER_LOGIN_FAILED`"*. **Fase 1, DoD 8** menjadi *"Log tersimpan atomik dengan perubahan. Simulasi
  kegagalan log membatalkan perubahan. Login/logout lewat halaman aplikasi menghasilkan tepat satu
  `USER_LOGIN`/`USER_LOGOUT` dengan `session_id` yang sama."*
- **Risiko** (SRS 8 / Implementation Plan 6), baris *"Activity log terlalu verbose/lambat"*: mitigasi menjadi
  *"index + insert dalam transaksi yang sama; ukur di Fase 2"*. Tambahkan baris baru: *"Log hilang/terputus → trigger
  atomik, fail-closed."*

---

## Catatan implementasi lain

Bagian ini di luar empat koreksi, tetapi perlu diketahui.

- **Kunci Supabase baru**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) dan `SUPABASE_SECRET_KEY`
  (`sb_secret_…`) menggantikan anon/`SUPABASE_SERVICE_ROLE_KEY`, karena kunci legacy dijadwalkan deprecated akhir 2026.
  Aturan ESLint NFR-SEC-01 mencakup kedua nama.
- **Cache Components** aktif (default Next.js 16.4). Bagian halaman yang membaca data per-request harus berada di
  dalam `<Suspense>`, yang sekaligus memenuhi NFR-USA-01 (loading state).
- **Signup publik dimatikan** (README langkah 3). Tanpa itu, siapa pun bisa membuat akun lewat publishable key.
  Akun baru selalu `staff`; role tidak pernah diambil dari metadata sign-up.
- `project_members` diberi `created_at`/`updated_at` (NFR-REL-01). `activity_logs` hanya punya `created_at` karena
  append-only.
- `src/types/database.ts` di-generate oleh Supabase CLI (`npm run db:types`) dari database hasil migration, sesuai
  NFR-REL-03. Jalankan ulang setiap ada migration baru.
- Seed memakai Auth Admin API, bukan `seed.sql`, supaya sama persis di Supabase Cloud maupun lokal. Akun Fajar
  (nonaktif) sengaja **tidak** di-ban, untuk membuktikan bahwa RLS menolak JWT yang masih valid.

---

## Perlu diputuskan saat review

1. **Koreksi #2**: setuju opsi B (sesi hanya di server, cookie HttpOnly)? Opsi A tetap bisa dipilih dengan
   perubahan kecil.
2. **Koreksi #4** *(berubah karena revisi poin 2)*: log login/logout kini dicatat di transaksi yang sama dengan
   sesi Supabase Auth, sehingga otomatis **fail-closed**. Bila log gagal tersimpan, login/logout ikut gagal. Ini
   konsisten dengan perubahan data, tetapi gangguan pada penulisan log berarti tidak ada yang bisa login. Setuju?
   Alternatifnya *fail-open*: trigger menangkap error dan hanya menulis peringatan ke log Postgres (event bisa hilang).
3. **Aturan turunan matriks** (koreksi #1, poin a–d): setuju?
4. **Project Supabase dev**: siapa pemilik organisasi/akunnya, dan siapa yang memegang secret key serta password
   database? Rekomendasi region: Singapore.

## Cara demo

1. Ikuti README langkah 1–7 untuk membuka halaman status: koneksi, skema, akun demo, task, dan audit log.
2. `curl localhost:3000/api/health` untuk DoD #2.
3. `npm run verify:supabase` membuktikan koreksi #1, #4, dan revisi poin 1–2 langsung di Supabase. Hasilnya tabel
   ✓/✗ untuk: viewer, akun nonaktif, staff yang mencoba jadi admin, owner yang mencoba mengubah role lewat hapus lalu
   tambah lagi, login/logout sungguhan yang tercatat per sesi, RPC `log_auth_event` yang sudah tidak ada, pemalsuan
   log, dan log yang tidak bisa dihapus.
4. `npm run test:db` menjalankan seluruh matriks plus pembanding, tanpa internet (± 3 detik).

---

## Hasil uji di Supabase asli

> **Belum dijalankan.** Menunggu project Supabase development terpisah dan isian `.env.local`. Bagian ini diisi
> dengan keluaran asli `db:push`, `db:seed`, dan `verify:supabase` setelah dijalankan.
