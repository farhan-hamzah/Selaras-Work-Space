import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeKey, legacyJwtRole, readPublicEnv } from '@/lib/env'

const fakeJwt = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.')

afterEach(() => vi.unstubAllEnvs())

describe('readPublicEnv', () => {
  it('melaporkan variabel yang belum diisi', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    const result = readPublicEnv()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])
  })

  it('menerima publishable key dan merapikan URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co/')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_1234567890abcdef')
    expect(readPublicEnv()).toEqual({
      ok: true,
      env: { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_1234567890abcdef' },
    })
  })

  it('menolak secret key yang tertaruh di variabel NEXT_PUBLIC_', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_1234567890abcdef')
    const result = readPublicEnv()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join()).toContain('SECRET KEY')
  })

  it('menolak legacy service_role key yang tertaruh di variabel NEXT_PUBLIC_', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', fakeJwt({ role: 'service_role' }))
    expect(readPublicEnv().ok).toBe(false)
  })
})

describe('describeKey', () => {
  it('mengenali jenis kunci tanpa membocorkan isinya', () => {
    expect(describeKey('sb_publishable_abc')).toContain('publishable')
    expect(describeKey(fakeJwt({ role: 'anon' }))).toContain('role: anon')
    expect(legacyJwtRole('bukan.jwt')).toBeNull()
  })
})
