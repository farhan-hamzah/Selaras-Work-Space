/**
 * Fase 0 DoD #4 — seluruh tabel inti & enum ter-migrate; RLS aktif; health check.
 */
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, run } from './harness'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
})

describe('Skema inti', () => {
  it('5 tabel & 4 enum ada, RLS aktif di semua tabel (health_check, dipanggil sebagai anon)', async () => {
    const r = await run<{ h: Record<string, unknown> }>(db, 'anon', 'select public.health_check() as h')
    expect(r.error).toBeNull()
    expect(r.rows[0].h).toMatchObject({
      database: 'ok',
      tables_expected: 5,
      tables_found: 5,
      enums_expected: 4,
      enums_found: 4,
      rls_enabled_tables: 5,
    })
  })

  it('Index yang diminta SRS 6.6 tersedia', async () => {
    const r = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' order by indexname`)
    const names = r.rows.map((x) => x.indexname)
    for (const idx of [
      'idx_tasks_project_id', 'idx_tasks_assignee_id', 'idx_tasks_status', 'idx_project_members_user',
      'idx_activity_logs_user_id', 'idx_activity_logs_created', 'idx_activity_logs_resource',
    ]) {
      expect(names).toContain(idx)
    }
  })

  it('Profile dibuat otomatis untuk user baru dengan role staff (metadata role diabaikan)', async () => {
    await db.exec('begin')
    try {
      await db.query(
        `insert into auth.users (email, raw_user_meta_data) values ('baru@selaras.test', $1)`,
        [JSON.stringify({ full_name: 'User Baru', role: 'admin' })],
      )
      const p = await db.query<{ full_name: string; role: string; is_active: boolean }>(
        `select full_name, role, is_active from public.profiles p join auth.users u on u.id = p.id where u.email = 'baru@selaras.test'`)
      expect(p.rows[0]).toEqual({ full_name: 'User Baru', role: 'staff', is_active: true })
    } finally {
      await db.exec('rollback')
    }
  })

  it('Fungsi helper di schema private tidak bisa dipanggil anon', async () => {
    const r = await run(db, 'anon', 'select private.is_admin()')
    expect(r.error?.code).toBe('42501')
  })

  it('Fungsi admin/RPC tidak bisa dipanggil anon', async () => {
    for (const sql of [
      `select public.admin_set_user_role('00000000-0000-4000-8000-0000000000a2', 'admin')`,
      `select public.soft_delete_task('00000000-0000-4000-8000-000000000000')`,
    ]) {
      expect((await run(db, 'anon', sql)).error?.code).toBe('42501')
    }
  })
})
