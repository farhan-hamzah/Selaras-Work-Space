import type { CookieOptionsWithName } from '@supabase/ssr'

/**
 * KOREKSI #2 — opsi cookie sesi Supabase.
 *
 * Default @supabase/ssr adalah `httpOnly: false` (node_modules/@supabase/ssr/
 * dist/main/utils/constants.js) karena createBrowserClient membaca sesi lewat
 * document.cookie. Aplikasi ini memutuskan sesi HANYA dikelola di server
 * (Server Component, Server Action, Route Handler, proxy), sehingga cookie bisa
 * dibuat HttpOnly dan token tidak bisa dibaca JavaScript di browser.
 *
 * Konsekuensi: jangan memakai createBrowserClient untuk data/aksi yang butuh
 * sesi — client di browser tidak akan melihat sesi (diblokir ESLint, lihat
 * eslint.config.mjs). Detail & alternatifnya: docs/review-fase-0.md, koreksi #2.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  httpOnly: true,
  // Default @supabase/ssr tidak menyetel Secure; wajib di production (HTTPS).
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
}
