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

describe('Konteks request pada log perubahan data', () => {
  it('IP & user agent pengguna akhir (header dari server Next.js) ikut tersimpan', async () => {
    await asActor(db, 'budi', async (q) => {
      await q(`select set_config('request.headers', $1, true)`, [
        JSON.stringify({ 'x-client-ip': '203.0.113.7', 'x-client-user-agent': 'Vitest' }),
      ])
      await q(`update public.tasks set status = 'review' where id = $1`, [TASK.T1])
      await q('reset role')
      const log = await q<{ ip_address: string; user_agent: string }>(
        `select host(ip_address) as ip_address, user_agent from public.activity_logs
         where resource_id = $1 and action = 'TASK_STATUS_CHANGED'`, [TASK.T1])
      expect(log.rows[0]).toEqual({ ip_address: '203.0.113.7', user_agent: 'Vitest' })
    })
  })

  it('Header IP yang rusak tidak membatalkan perubahan maupun pencatatan', async () => {
    await asActor(db, 'budi', async (q) => {
      await q(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-client-ip': 'bukan-ip' })])
      const r = await q(`update public.tasks set status = 'review' where id = $1`, [TASK.T1])
      expect(r.error).toBeNull()
      expect(r.affected).toBe(1)
    })
  })
})

/**
 * Revisi poin 2 — login/logout dicatat dari auth.sessions, yang hanya ditulis
 * server Supabase Auth (actor 'supabase_auth'). Baris sesi di sini meniru apa
 * yang ditulis Auth saat login (INSERT) dan logout (DELETE).
 */
describe('Revisi poin 2 — USER_LOGIN/USER_LOGOUT hanya dari sesi Supabase Auth', () => {
  const SESSION_A = '5e55e55e-0000-4000-8000-00000000000a'
  const SESSION_B = '5e55e55e-0000-4000-8000-00000000000b'
  const createSession = `insert into auth.sessions (id, user_id, created_at, updated_at, aal, ip, user_agent, not_after)
                         values ($1, $2, now(), now(), 'aal1', $3, $4, $5)`
  const AUTH_LOGS = `select user_id, action, resource_type, metadata, host(ip_address) as ip, user_agent
                     from public.activity_logs where action in ('USER_LOGIN', 'USER_LOGOUT') order by created_at`

  interface AuthLogRow {
    user_id: string
    action: string
    resource_type: string
    metadata: Record<string, unknown>
    ip: string | null
    user_agent: string | null
  }

  it('Login (Auth membuat sesi) mencatat USER_LOGIN dengan session_id, IP & user agent dari Auth', async () => {
    await asActor(db, 'supabase_auth', async (q) => {
      const r = await q(createSession, [SESSION_A, USER_IDS.citra, '203.0.113.7', 'Vitest', null])
      expect(r.error).toBeNull()
      await q('reset role')
      const logs = await q<AuthLogRow>(AUTH_LOGS)
      expect(logs.rows).toEqual([
        {
          user_id: USER_IDS.citra,
          action: 'USER_LOGIN',
          resource_type: 'auth',
          metadata: { session_id: SESSION_A, aal: 'aal1', account_active: true, actor_role: 'supabase_auth' },
          ip: '203.0.113.7',
          user_agent: 'Vitest',
        },
      ])
      const p = await q<{ last_login_at: string | null }>(`select last_login_at from public.profiles where id = $1`, [USER_IDS.citra])
      expect(p.rows[0].last_login_at).not.toBeNull()
    })
  })

  it('Logout (Auth menghapus sesi) mencatat USER_LOGOUT untuk sesi tersebut', async () => {
    await asActor(db, 'supabase_auth', async (q) => {
      await q(createSession, [SESSION_A, USER_IDS.citra, '203.0.113.7', 'Vitest', null])
      expect((await q('delete from auth.sessions where id = $1', [SESSION_A])).affected).toBe(1)
      await q('reset role')
      const logs = await q<AuthLogRow>(AUTH_LOGS)
      expect(logs.rows.map((l) => [l.action, l.metadata.session_id])).toEqual([
        ['USER_LOGIN', SESSION_A],
        ['USER_LOGOUT', SESSION_A],
      ])
      expect(logs.rows[1]).toMatchObject({ user_id: USER_IDS.citra, resource_type: 'auth' })
    })
  })

  it('Logout global (semua sesi pengguna dihapus) mencatat satu USER_LOGOUT per sesi', async () => {
    await asActor(db, 'supabase_auth', async (q) => {
      await q(createSession, [SESSION_A, USER_IDS.citra, null, null, null])
      await q(createSession, [SESSION_B, USER_IDS.citra, null, null, null])
      await q('delete from auth.sessions where user_id = $1', [USER_IDS.citra])
      await q('reset role')
      const logouts = (await q<AuthLogRow>(AUTH_LOGS)).rows.filter((l) => l.action === 'USER_LOGOUT')
      expect(logouts.map((l) => l.metadata.session_id).sort()).toEqual([SESSION_A, SESSION_B])
    })
  })

  it('Sesi kedaluwarsa yang dibersihkan Auth tidak dicatat sebagai logout', async () => {
    await asActor(db, 'supabase_auth', async (q) => {
      await q(createSession, [SESSION_A, USER_IDS.citra, null, null, new Date(Date.now() - 4 * 86_400_000).toISOString()])
      await q('delete from auth.sessions where id = $1', [SESSION_A])
      await q('reset role')
      expect((await q<AuthLogRow>(AUTH_LOGS)).rows.map((l) => l.action)).toEqual(['USER_LOGIN'])
    })
  })

  it('Pengguna tidak bisa mencatat USER_LOGOUT/USER_LOGIN tanpa proses autentikasi', async () => {
    await asActor(db, 'citra', async (q) => {
      // RPC lama sudah dihapus.
      expect((await q(`select public.log_auth_event('USER_LOGOUT')`)).error?.code).toBe('42883')
      // Menulis log langsung ditolak.
      const forged = await q(
        `insert into public.activity_logs (user_id, action, resource_type, description) values ($1, 'USER_LOGOUT', 'auth', 'palsu')`,
        [USER_IDS.citra],
      )
      expect(forged.error?.code).toBe('42501')
      // Tabel sesi milik Auth tidak bisa disentuh role API.
      expect((await q(createSession, [SESSION_A, USER_IDS.citra, null, null, null])).error?.code).toBe('42501')
      expect((await q('delete from auth.sessions')).error?.code).toBe('42501')
      await q('reset role')
      expect((await q<AuthLogRow>(AUTH_LOGS)).rows).toHaveLength(0)
    })
  })

  it('Login akun nonaktif tetap tercatat dan ditandai account_active = false', async () => {
    await asActor(db, 'supabase_auth', async (q) => {
      await q(createSession, [SESSION_A, USER_IDS.fajar, null, null, null])
      await q('reset role')
      const [log] = (await q<AuthLogRow>(AUTH_LOGS)).rows
      expect(log).toMatchObject({ user_id: USER_IDS.fajar, action: 'USER_LOGIN', metadata: { account_active: false } })
    })
  })

  it('Fail-closed: bila log gagal disimpan, login (pembuatan sesi) ikut gagal', async () => {
    await asActor(db, 'postgres', async (q) => {
      await q('alter table public.activity_logs add constraint simulate_failure check (false) not valid')
      await q('set local role supabase_auth_admin')
      const r = await q(createSession, [SESSION_A, USER_IDS.citra, null, null, null])
      expect(r.error?.code).toBe('23514')
      await q('reset role')
      expect((await q('select id from auth.sessions where id = $1', [SESSION_A])).rows).toHaveLength(0)
    })
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
