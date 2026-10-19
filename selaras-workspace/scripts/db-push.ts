/**
 * npm run db:push [-- --dry-run]
 * Menerapkan supabase/migrations ke database di SUPABASE_DB_URL.
 * Riwayat migration dicatat Supabase (supabase_migrations.schema_migrations),
 * jadi aman dijalankan berulang: hanya migration baru yang diterapkan.
 */
import { requireVars, runSupabaseCli } from './lib/script-env'

const { SUPABASE_DB_URL } = requireVars(['SUPABASE_DB_URL'])
const extra = process.argv.slice(2)

console.log('→ Menerapkan migration ke database Supabase…')
const code = runSupabaseCli(['db', 'push', '--db-url', SUPABASE_DB_URL, '--yes', ...extra])
if (code !== 0) {
  console.error(
    '\n✗ db push gagal. Penyebab umum:\n' +
      '  - Memakai "Direct connection" (IPv6) di jaringan tanpa IPv6 → pakai "Session pooler" (port 5432).\n' +
      '  - Password mengandung karakter khusus yang belum di-percent-encode (mis. @ → %40).\n' +
      '  - Password database salah (reset di Project Settings > Database).\n',
  )
}
process.exit(code)
