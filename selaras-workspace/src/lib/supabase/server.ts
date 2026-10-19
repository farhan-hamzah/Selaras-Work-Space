import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { requirePublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'
import { AUTH_COOKIE_OPTIONS } from './cookie-options'

/**
 * Supabase client dengan sesi pengguna — untuk Server Component, Server Action,
 * dan Route Handler. Buat baru di setiap request (jangan disimpan global).
 * Semua query lewat client ini tunduk pada RLS sebagai pengguna yang login.
 */
export async function createClient() {
  const env = requirePublicEnv()
  const cookieStore = await cookies()
  const requestHeaders = await headers()

  return createServerClient<Database>(env.supabaseUrl, env.publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Dipanggil dari Server Component (tidak boleh set cookie).
          // Aman diabaikan karena proxy (src/proxy.ts) yang me-refresh sesi.
        }
      },
    },
    global: {
      // Diteruskan ke audit log (private.write_activity_log) sebagai konteks
      // pengguna akhir — tanpa ini, IP/UA yang tercatat adalah milik server.
      headers: clientContextHeaders(requestHeaders),
    },
  })
}

function clientContextHeaders(requestHeaders: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || requestHeaders.get('x-real-ip')
  const userAgent = requestHeaders.get('user-agent')
  if (ip) result['x-client-ip'] = ip
  if (userAgent) result['x-client-user-agent'] = userAgent.slice(0, 512)
  return result
}
