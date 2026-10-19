import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { readPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'
import { AUTH_COOKIE_OPTIONS } from './cookie-options'

/**
 * Me-refresh sesi Supabase di setiap request (FR-AUTH-08) dan menulis cookie
 * baru ke response. Fase 0: kerangka saja. Fase 1 menambahkan redirect ke
 * /login untuk rute terproteksi (FR-AUTH-04) — sebagai pemeriksaan optimistis;
 * keputusan akses tetap di requireAuth() + RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const config = readPublicEnv()
  if (!config.ok) return response // belum dikonfigurasi: halaman status akan menjelaskan

  const supabase = createServerClient<Database>(config.env.supabaseUrl, config.env.publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        // Cache-Control: private, no-store — respons yang membawa cookie sesi
        // tidak boleh di-cache CDN (bisa tertukar antar pengguna).
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
      },
    },
  })

  // Jangan sisipkan kode di antara createServerClient dan getClaims():
  // getClaims() yang memicu refresh token bila access token hampir habis.
  try {
    await supabase.auth.getClaims()
  } catch {
    // Supabase tidak terjangkau: biarkan request lanjut; halaman/endpoint
    // yang butuh sesi akan menolak sendiri.
  }

  return response
}
