import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { describeKey, readPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

const TIMEOUT_MS = 5_000

export interface DatabaseStatus {
  serverTime: string
  tablesFound: number
  tablesExpected: number
  enumsFound: number
  enumsExpected: number
  rlsEnabledTables: number
}

export type SupabaseHealth =
  | { state: 'not_configured'; message: string; missing: string[]; problems: string[] }
  | { state: 'unreachable' | 'unauthorized' | 'schema_missing' | 'error'; message: string; project: ProjectInfo }
  | { state: 'schema_incomplete'; message: string; project: ProjectInfo; latencyMs: number; database: DatabaseStatus }
  | { state: 'connected'; project: ProjectInfo; latencyMs: number; database: DatabaseStatus }

export interface ProjectInfo {
  host: string
  keyType: string
}

/**
 * Cek koneksi ke Supabase memakai publishable key (tanpa sesi), lewat RPC
 * public.health_check(). Membedakan: belum dikonfigurasi, tidak terjangkau,
 * kunci ditolak, migration belum dijalankan, dan siap.
 */
export async function checkSupabaseHealth(): Promise<SupabaseHealth> {
  const config = readPublicEnv()
  if (!config.ok) {
    return {
      state: 'not_configured',
      message: 'Variabel Supabase di .env.local belum lengkap.',
      missing: config.missing,
      problems: config.problems,
    }
  }

  const { supabaseUrl, publishableKey } = config.env
  const project: ProjectInfo = { host: new URL(supabaseUrl).host, keyType: describeKey(publishableKey) }
  const supabase = createClient<Database>(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const started = performance.now()
  let response
  try {
    response = await supabase.rpc('health_check').abortSignal(AbortSignal.timeout(TIMEOUT_MS))
  } catch (err) {
    return { state: 'unreachable', message: `Supabase tidak terjangkau: ${(err as Error).message}`, project }
  }
  const latencyMs = Math.round(performance.now() - started)
  const { data, error, status } = response

  if (error) {
    if (status === 401 || status === 403) {
      return { state: 'unauthorized', message: `Kunci ditolak Supabase (HTTP ${status}): ${error.message}`, project }
    }
    if (error.code === 'PGRST202') {
      return {
        state: 'schema_missing',
        message: 'Terhubung, tetapi migration belum dijalankan (fungsi health_check belum ada). Jalankan `npm run db:push`.',
        project,
      }
    }
    if (status === 0 || /fetch failed|abort|timeout|network/i.test(error.message)) {
      return { state: 'unreachable', message: `Supabase tidak terjangkau: ${error.message}`, project }
    }
    return { state: 'error', message: `${error.code ?? `HTTP ${status}`}: ${error.message}`, project }
  }

  const database = toDatabaseStatus(data)
  const complete =
    database.tablesFound === database.tablesExpected &&
    database.enumsFound === database.enumsExpected &&
    database.rlsEnabledTables === database.tablesExpected
  if (!complete) {
    return {
      state: 'schema_incomplete',
      message: 'Terhubung, tetapi skema belum lengkap. Jalankan ulang `npm run db:push`.',
      project,
      latencyMs,
      database,
    }
  }
  return { state: 'connected', project, latencyMs, database }
}

function toDatabaseStatus(data: unknown): DatabaseStatus {
  const d = (data ?? {}) as Record<string, unknown>
  const num = (key: string) => (typeof d[key] === 'number' ? (d[key] as number) : 0)
  return {
    serverTime: typeof d.server_time === 'string' ? d.server_time : '',
    tablesFound: num('tables_found'),
    tablesExpected: num('tables_expected') || 5,
    enumsFound: num('enums_found'),
    enumsExpected: num('enums_expected') || 4,
    rlsEnabledTables: num('rls_enabled_tables'),
  }
}
