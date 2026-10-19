import { z } from 'zod'

/**
 * Variabel lingkungan publik (boleh terlihat di browser). Secret key TIDAK
 * dibaca di sini — hanya di src/lib/supabase/admin.ts (NFR-SEC-01).
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'harus berupa URL, contoh https://abcd.supabase.co' }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, { error: 'terlalu pendek — salin publishable key dari Project Settings > API Keys' })
    .refine((key) => !key.startsWith('sb_secret_'), {
      error: 'BERISI SECRET KEY! Secret key tidak boleh memakai prefix NEXT_PUBLIC_ (akan terkirim ke browser)',
    })
    .refine((key) => legacyJwtRole(key) !== 'service_role', {
      error: 'BERISI service_role key! Pakai publishable/anon key di variabel ini',
    }),
})

export interface PublicEnv {
  supabaseUrl: string
  publishableKey: string
}

export type PublicEnvResult =
  | { ok: true; env: PublicEnv }
  | { ok: false; missing: string[]; problems: string[] }

export function readPublicEnv(): PublicEnvResult {
  // Akses statis agar Next.js bisa meng-inline nilai NEXT_PUBLIC_*.
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
  }
  const missing = Object.entries(raw)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) return { ok: false, missing, problems: [] }

  const parsed = publicEnvSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      missing: [],
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }
  }
  return {
    ok: true,
    env: {
      supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ''),
      publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
  }
}

export function requirePublicEnv(): PublicEnv {
  const result = readPublicEnv()
  if (!result.ok) {
    const detail = [...result.missing.map((name) => `${name} belum diisi`), ...result.problems].join('; ')
    throw new Error(`Konfigurasi Supabase belum lengkap: ${detail}. Lihat README langkah 4 ("Isi .env.local").`)
  }
  return result.env
}

/** Kunci legacy (anon/service_role) berupa JWT; ambil klaim role-nya bila ada. */
export function legacyJwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** Jenis kunci untuk ditampilkan (tanpa membocorkan isinya). */
export function describeKey(key: string): string {
  if (key.startsWith('sb_publishable_')) return 'publishable key (sb_publishable_…)'
  if (key.startsWith('sb_secret_')) return 'secret key (sb_secret_…)'
  const role = legacyJwtRole(key)
  if (role) return `legacy JWT key (role: ${role}) — dijadwalkan deprecated akhir 2026`
  return 'format tidak dikenal'
}
