import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { requirePublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Supabase client dengan SECRET KEY — melewati RLS sepenuhnya.
 *
 * Satu-satunya tempat SUPABASE_SECRET_KEY dibaca (NFR-SEC-01, ditegakkan ESLint).
 * `import 'server-only'` membuat build gagal bila file ini ter-import dari
 * Client Component. Pakai hanya untuk operasi yang memang tidak bisa dilakukan
 * dengan sesi pengguna (Auth Admin API, USER_LOGIN_FAILED, seed/dev tooling) dan
 * SELALU setelah hak akses pemanggil diperiksa.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) {
    throw new Error('SUPABASE_SECRET_KEY belum diisi di .env.local (lihat README).')
  }
  const env = requirePublicEnv()
  return createClient<Database>(env.supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function isAdminClientConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY)
}
