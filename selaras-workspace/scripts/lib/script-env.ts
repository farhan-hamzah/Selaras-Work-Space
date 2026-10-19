import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import type { Database } from '../../src/types/database'

export const ROOT = path.resolve(import.meta.dirname, '../..')

/** Muat .env.local (lalu .env) — skrip CLI tidak otomatis membacanya seperti Next.js. */
export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const full = path.join(ROOT, file)
    if (existsSync(full)) config({ path: full, quiet: true })
  }
}

export function requireVars<const K extends string>(names: readonly K[]): Record<K, string> {
  loadEnv()
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    fail(`Variabel berikut belum diisi di .env.local: ${missing.join(', ')}\nLihat README langkah 4 ("Isi .env.local").`)
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]!])) as Record<K, string>
}

export function fail(message: string): never {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

export function createAdmin(url: string, secretKey: string) {
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function createAnon(url: string, publishableKey: string) {
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Jalankan Supabase CLI lokal (node_modules) tanpa shell — aman di Windows/macOS/Linux. */
export function runSupabaseCli(args: string[]): number {
  const cli = path.join(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js')
  if (!existsSync(cli)) fail('Supabase CLI belum terpasang. Jalankan `npm install`.')
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, stdio: 'inherit' })
  if (result.error) fail(`Gagal menjalankan Supabase CLI: ${result.error.message}`)
  return result.status ?? 1
}

/** "https://abcd1234.supabase.co" -> "abcd1234" (null untuk URL lokal/custom domain). */
export function projectRefFromUrl(url: string): string | null {
  const match = /^https:\/\/([a-z0-9]{15,30})\.supabase\.co\/?$/i.exec(url.trim())
  return match ? match[1] : null
}
