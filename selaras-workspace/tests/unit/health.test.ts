/**
 * Klasifikasi health check (dasar GET /api/health) diuji terhadap server HTTP
 * tiruan yang meniru respons PostgREST Supabase.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkSupabaseHealth } from '@/lib/supabase/health'

let server: Server
let baseUrl: string
let respond: (path: string) => { status: number; body: unknown }

beforeAll(async () => {
  server = createServer((req, res) => {
    const { status, body } = respond(req.url ?? '')
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => vi.unstubAllEnvs())

function useSupabase(url: string) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_1234567890abcdef')
}

const READY = {
  database: 'ok',
  server_time: '2026-10-18T15:00:00+00:00',
  tables_expected: 5,
  tables_found: 5,
  enums_expected: 4,
  enums_found: 4,
  rls_enabled_tables: 5,
}

describe('checkSupabaseHealth', () => {
  it('not_configured bila env kosong', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    expect((await checkSupabaseHealth()).state).toBe('not_configured')
  })

  it('connected bila health_check mengembalikan skema lengkap', async () => {
    useSupabase(baseUrl)
    respond = (path) =>
      path.startsWith('/rest/v1/rpc/health_check') ? { status: 200, body: READY } : { status: 404, body: {} }
    const health = await checkSupabaseHealth()
    expect(health.state).toBe('connected')
    if (health.state === 'connected') expect(health.database.tablesFound).toBe(5)
  })

  it('schema_incomplete bila RLS/tabel belum lengkap', async () => {
    useSupabase(baseUrl)
    respond = () => ({ status: 200, body: { ...READY, rls_enabled_tables: 3 } })
    expect((await checkSupabaseHealth()).state).toBe('schema_incomplete')
  })

  it('schema_missing bila fungsi belum ada (migration belum dijalankan)', async () => {
    useSupabase(baseUrl)
    respond = () => ({
      status: 404,
      body: { code: 'PGRST202', message: 'Could not find the function public.health_check without parameters' },
    })
    expect((await checkSupabaseHealth()).state).toBe('schema_missing')
  })

  it('unauthorized bila kunci ditolak', async () => {
    useSupabase(baseUrl)
    respond = () => ({ status: 401, body: { message: 'Invalid API key' } })
    expect((await checkSupabaseHealth()).state).toBe('unauthorized')
  })

  it('unreachable bila server tidak bisa dihubungi', async () => {
    useSupabase('http://127.0.0.1:9') // port discard — koneksi ditolak
    expect((await checkSupabaseHealth()).state).toBe('unreachable')
  })
})
