import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import {
  DEMO_CHANGES,
  DEMO_MEMBERSHIPS,
  DEMO_PROJECTS,
  DEMO_TASKS,
  DEMO_USERS,
  type DemoUserKey,
} from '../../scripts/demo-data'

const HERE = import.meta.dirname
const ROOT = path.resolve(HERE, '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

/** UUID tetap per user demo agar test mudah dibaca. */
export const USER_IDS: Record<DemoUserKey, string> = {
  admin: '00000000-0000-4000-8000-0000000000a0',
  rina: '00000000-0000-4000-8000-0000000000a1',
  budi: '00000000-0000-4000-8000-0000000000a2',
  citra: '00000000-0000-4000-8000-0000000000a3',
  dewi: '00000000-0000-4000-8000-0000000000a4',
  eko: '00000000-0000-4000-8000-0000000000a5',
  fajar: '00000000-0000-4000-8000-0000000000a6',
}

export const PROJECT = { alpha: DEMO_PROJECTS.alpha.id, beta: DEMO_PROJECTS.beta.id }
export const TASK = Object.fromEntries(DEMO_TASKS.map((t) => [t.key, t.id])) as Record<string, string>

/**
 * Siapa yang menjalankan query:
 *   - DemoUserKey      -> role "authenticated" dengan klaim JWT user tsb (seperti PostgREST)
 *   - 'anon'           -> role "anon" tanpa sesi
 *   - 'service_role'   -> role "service_role" (secret key; bypass RLS)
 *   - 'postgres'       -> pemilik database (SQL editor / migration)
 */
export type Actor = DemoUserKey | 'anon' | 'service_role' | 'postgres'

export interface Outcome<T = Record<string, unknown>> {
  rows: T[]
  affected: number
  error: { code?: string; message: string } | null
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(path.join(HERE, 'supabase-stub.sql'), 'utf8'))

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} gagal: ${(err as Error).message}`)
    }
  }

  await seedDemoData(db)
  return db
}

/** Seed yang sama dengan scripts/seed.ts, tetapi langsung lewat SQL. */
async function seedDemoData(db: PGlite) {
  for (const u of DEMO_USERS) {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [USER_IDS[u.key], `${u.localPart}@selaras.test`, JSON.stringify({ full_name: u.fullName })],
    )
  }
  for (const u of DEMO_USERS.filter((u) => u.globalRole === 'admin')) {
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [USER_IDS[u.key]])
  }
  for (const p of Object.values(DEMO_PROJECTS)) {
    await db.query(
      `insert into public.projects (id, name, description, status, priority, start_date, due_date, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.id, p.name, p.description, p.status, p.priority, p.startDate, p.dueDate, USER_IDS.admin],
    )
  }
  for (const m of DEMO_MEMBERSHIPS) {
    await db.query(
      `insert into public.project_members (project_id, user_id, role) values ($1, $2, $3)`,
      [DEMO_PROJECTS[m.project].id, USER_IDS[m.user], m.role],
    )
  }
  for (const t of DEMO_TASKS) {
    await db.query(
      `insert into public.tasks (id, project_id, title, description, status, priority, created_by, assignee_id, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        t.id, DEMO_PROJECTS[t.project].id, t.title, t.description, t.status, t.priority,
        USER_IDS[t.createdBy], t.assignee ? USER_IDS[t.assignee] : null, t.dueDate,
      ],
    )
  }
  const demote = DEMO_CHANGES.demoteToViewer
  await db.query(
    `update public.project_members set role = 'viewer' where project_id = $1 and user_id = $2`,
    [DEMO_PROJECTS[demote.project].id, USER_IDS[demote.user]],
  )
  await db.query(`update public.profiles set is_active = false where id = $1`, [USER_IDS[DEMO_CHANGES.deactivate]])
}

/**
 * Jalankan `fn` sebagai `actor` di dalam transaksi yang SELALU di-rollback,
 * sehingga setiap test berdiri sendiri dan data contoh tidak berubah.
 */
export async function asActor<T>(
  db: PGlite,
  actor: Actor,
  fn: (q: <R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<Outcome<R>>) => Promise<T>,
): Promise<T> {
  await db.exec('begin')
  try {
    await enterRole(db, actor)
    return await fn(async <R,>(sql: string, params: readonly unknown[] = []) => {
      await db.exec('savepoint attempt')
      try {
        const res = await db.query<R>(sql, [...params])
        await db.exec('release savepoint attempt')
        return { rows: res.rows, affected: res.affectedRows ?? 0, error: null }
      } catch (err) {
        await db.exec('rollback to savepoint attempt')
        const e = err as { code?: string; message: string }
        return { rows: [], affected: 0, error: { code: e.code, message: e.message } }
      }
    })
  } finally {
    await db.exec('rollback')
  }
}

async function enterRole(db: PGlite, actor: Actor) {
  if (actor === 'postgres') return
  if (actor === 'anon') {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
    await db.exec('set local role anon')
    return
  }
  if (actor === 'service_role') {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })])
    await db.exec('set local role service_role')
    return
  }
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: USER_IDS[actor], role: 'authenticated' }),
  ])
  await db.exec('set local role authenticated')
}

/** Jalankan satu query sebagai actor (transaksi di-rollback). */
export function run<R = Record<string, unknown>>(db: PGlite, actor: Actor, sql: string, params: readonly unknown[] = []) {
  return asActor(db, actor, (q) => q<R>(sql, params))
}
