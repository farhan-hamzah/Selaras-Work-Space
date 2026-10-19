/**
 * KOREKSI #4 — audit log tersimpan secara terjamin, bukan fire-and-forget.
 */
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asActor, createTestDb, PROJECT, run, TASK, USER_IDS } from './harness'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
})

interface LogRow {
  user_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  description: string
  metadata: Record<string, unknown>
}

const LOGS_FOR = `select user_id, action, resource_type, resource_id, description, metadata
                  from public.activity_logs where resource_id = $1 order by created_at, action`

describe('Pencatatan atomik lewat trigger', () => {
  it('Perubahan status oleh Budi tercatat sebagai TASK_STATUS_CHANGED dengan nilai lama & baru', async () => {
    await asActor(db, 'budi', async (q) => {
      await q(`update public.tasks set status = 'review' where id = $1`, [TASK.T1])
      await q('reset role') // baca log sebagai pemilik DB (staff tidak boleh membaca log)
      const logs = await q<LogRow>(LOGS_FOR, [TASK.T1])
      const last = logs.rows.at(-1)!
      expect(last.action).toBe('TASK_STATUS_CHANGED')
      expect(last.user_id).toBe(USER_IDS.budi)
      expect(last.metadata).toMatchObject({
        project_id: PROJECT.alpha,
        changes: { status: { old: 'in_progress', new: 'review' } },
        actor_role: 'authenticated',
      })
    })
  })

  it('Satu UPDATE dengan beberapa jenis perubahan menghasilkan entri per jenis aksi', async () => {
    await asActor(db, 'rina', async (q) => {
      await q(`update public.tasks set status = 'in_progress', assignee_id = $2, title = 'Backup harian v2' where id = $1`,
        [TASK.T2, USER_IDS.budi])
      await q('reset role')
      const actions = (await q<LogRow>(LOGS_FOR, [TASK.T2])).rows.map((r) => r.action)
      expect(actions).toEqual(expect.arrayContaining(['TASK_STATUS_CHANGED', 'TASK_ASSIGNED', 'TASK_UPDATED']))
    })
  })

  it('UPDATE yang ditolak policy tidak menghasilkan log', async () => {
    await asActor(db, 'dewi', async (q) => {
      await q(`update public.tasks set status = 'done' where id = $1`, [TASK.T3])
      await q('reset role')
      const logs = await q<LogRow>(LOGS_FOR, [TASK.T3])
      expect(logs.rows.map((r) => r.action)).toEqual(['TASK_CREATED'])
    })
  })

  it('Soft delete, perubahan member, dan perubahan role/status akun ikut tercatat', async () => {
    await asActor(db, 'admin', async (q) => {
      await q('select public.soft_delete_task($1)', [TASK.T7])
      await q(`update public.project_members set role = 'member' where project_id = $1 and user_id = $2`, [PROJECT.beta, USER_IDS.budi])
      await q('select public.admin_set_user_active($1, true)', [USER_IDS.fajar])
      const recent = await q<LogRow>(
        `select action, user_id, description from public.activity_logs
         where user_id = $1 order by created_at`, [USER_IDS.admin])
      expect(recent.rows.map((r) => r.action)).toEqual(['TASK_DELETED', 'PROJECT_MEMBER_ROLE_CHANGED', 'USER_ACTIVATED'])
      expect(recent.rows[1].description).toContain('Budi Santoso')
    })
  })
})

describe('Fail-closed: jika log gagal disimpan, perubahan data dibatalkan', () => {
  it('INSERT log yang gagal membuat UPDATE task ikut gagal dan data tidak berubah', async () => {
    await asActor(db, 'postgres', async (q) => {
      // Simulasi kegagalan penyimpanan log (mis. constraint/disk/bug).
      await q('alter table public.activity_logs add constraint simulate_failure check (false) not valid')
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_IDS.budi, role: 'authenticated' })])
      await q('set local role authenticated')

      const res = await q(`update public.tasks set status = 'done' where id = $1`, [TASK.T1])
      expect(res.error?.code).toBe('23514')

      await q('reset role')
      const task = await q<{ status: string }>(`select status from public.tasks where id = $1`, [TASK.T1])
      expect(task.rows[0].status).toBe('in_progress') // tidak berubah
    })
  })
})

describe('Anti-pemalsuan & append-only (FR-LOG-04)', () => {
  it('Role API tidak bisa INSERT langsung ke activity_logs', async () => {
    const r = await run(
      db, 'admin',
      `insert into public.activity_logs (user_id, action, resource_type, description) values ($1, 'USER_LOGIN', 'auth', 'palsu')`,
      [USER_IDS.citra],
    )
    expect(r.error?.code).toBe('42501')
  })

  it('Admin tidak bisa UPDATE atau DELETE log', async () => {
    expect((await run(db, 'admin', `update public.activity_logs set description = 'x'`)).error?.code).toBe('42501')
    expect((await run(db, 'admin', 'delete from public.activity_logs')).error?.code).toBe('42501')
  })

  it('service_role (secret key) pun tidak bisa UPDATE/DELETE/TRUNCATE log', async () => {
    expect((await run(db, 'service_role', `update public.activity_logs set description = 'x'`)).error?.code).toBe('42501')
    expect((await run(db, 'service_role', 'delete from public.activity_logs')).error?.code).toBe('42501')
    expect((await run(db, 'service_role', 'truncate public.activity_logs')).error?.code).toBe('42501')
  })

  it('Pemilik database pun ditolak oleh trigger append-only', async () => {
    const upd = await run(db, 'postgres', `update public.activity_logs set description = 'x'`)
    const del = await run(db, 'postgres', 'delete from public.activity_logs')
    const trunc = await run(db, 'postgres', 'truncate public.activity_logs')
    for (const r of [upd, del, trunc]) {
      expect(r.error?.code).toBe('42501')
      expect(r.error?.message).toContain('append-only')
    }
  })

  it('Hanya Admin yang bisa membaca log', async () => {
    expect((await run(db, 'admin', 'select id from public.activity_logs')).rows.length).toBeGreaterThan(0)
    expect((await run(db, 'rina', 'select id from public.activity_logs')).rows).toHaveLength(0)
  })
})

describe('Event autentikasi lewat public.log_auth_event()', () => {
  it('USER_LOGIN dicatat dengan user_id dari sesi & memperbarui last_login_at', async () => {
    await asActor(db, 'citra', async (q) => {
      expect((await q(`select public.log_auth_event('USER_LOGIN')`)).error).toBeNull()
      await q('reset role')
      const log = await q<LogRow>(`select user_id, action, resource_type from public.activity_logs where action = 'USER_LOGIN'`)
      expect(log.rows).toEqual([{ user_id: USER_IDS.citra, action: 'USER_LOGIN', resource_type: 'auth' }])
      const p = await q<{ last_login_at: string | null }>(`select last_login_at from public.profiles where id = $1`, [USER_IDS.citra])
      expect(p.rows[0].last_login_at).not.toBeNull()
    })
  })

  it('Header request (IP & user agent) ikut tersimpan bila ada', async () => {
    await asActor(db, 'citra', async (q) => {
      await q(`select set_config('request.headers', $1, true)`, [
        JSON.stringify({ 'x-client-ip': '203.0.113.7', 'user-agent': 'Vitest' }),
      ])
      await q(`select public.log_auth_event('USER_LOGOUT')`)
      await q('reset role')
      const log = await q<{ ip_address: string; user_agent: string }>(
        `select host(ip_address) as ip_address, user_agent from public.activity_logs where action = 'USER_LOGOUT'`)
      expect(log.rows[0]).toEqual({ ip_address: '203.0.113.7', user_agent: 'Vitest' })
    })
  })

  it('Header IP yang rusak tidak membatalkan pencatatan', async () => {
    await asActor(db, 'citra', async (q) => {
      await q(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-client-ip': 'bukan-ip' })])
      expect((await q(`select public.log_auth_event('USER_LOGIN')`)).error).toBeNull()
    })
  })

  it('Aksi lain tidak bisa dicatat lewat fungsi ini', async () => {
    expect((await run(db, 'citra', `select public.log_auth_event('TASK_DELETED')`)).error?.code).toBe('22023')
  })

  it('Akun nonaktif dan anon ditolak', async () => {
    expect((await run(db, 'fajar', `select public.log_auth_event('USER_LOGIN')`)).error?.code).toBe('42501')
    expect((await run(db, 'anon', `select public.log_auth_event('USER_LOGIN')`)).error?.code).toBe('42501')
  })
})

describe('Pembanding — v0.2 (INSERT log dibuka untuk authenticated)', () => {
  it('Staff BISA memalsukan log atas nama orang lain', async () => {
    await asActor(db, 'postgres', async (q) => {
      await q('grant insert on public.activity_logs to authenticated')
      await q('create policy v02_insert on public.activity_logs for insert to authenticated with check (true)')
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_IDS.citra, role: 'authenticated' })])
      await q('set local role authenticated')
      const r = await q(
        `insert into public.activity_logs (user_id, action, resource_type, description) values ($1, 'TASK_DELETED', 'task', 'palsu')`,
        [USER_IDS.rina],
      )
      expect(r.error).toBeNull() // berhasil dipalsukan
    })
  })
})
