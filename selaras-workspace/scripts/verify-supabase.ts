/**
 * npm run verify:supabase
 *
 * Verifikasi LANGSUNG ke project Supabase (bukan simulasi):
 *   1. Koneksi & kelengkapan skema (publishable key)
 *   2. Data contoh tersedia
 *   3. Login sungguhan sebagai akun demo, lalu mencoba aksi sesuai matriks
 *      permission (koreksi #1) dan pencatatan audit (koreksi #4).
 *
 * Probe "edit" memakai UPDATE tanpa perubahan nilai (title = title lama):
 * lolos/tidaknya RLS terlihat dari jumlah baris yang kembali, tanpa mengubah
 * data dan tanpa menambah log. Probe revisi poin 1 mengeluarkan lalu
 * menambahkan kembali Dewi; keanggotaannya selalu dikembalikan ke viewer.
 * Keluar dengan kode 1 bila ada yang tidak sesuai.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { DEMO_CHANGES, DEMO_PROJECTS, DEMO_TASKS, DEMO_USERS, demoEmail, type DemoUserKey } from './demo-data'
import { createAdmin, createAnon, fail, requireVars } from './lib/script-env'

const env = requireVars([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SEED_DEMO_PASSWORD',
])
const domain = process.env.SEED_EMAIL_DOMAIN || 'selaras.test'
const task = Object.fromEntries(DEMO_TASKS.map((t) => [t.key, t])) as Record<string, (typeof DEMO_TASKS)[number]>

type Client = SupabaseClient<Database>
interface Result {
  area: string
  check: string
  expected: string
  actual: string
  ok: boolean
}
const results: Result[] = []

function record(area: string, check: string, expected: string, actual: string) {
  results.push({ area, check, expected, actual, ok: expected === actual })
}

interface Session {
  client: Client
  id: string
  /** Klaim session_id = auth.sessions.id, yang dicatat trigger audit login/logout. */
  sessionId: string
}
const sessions = new Map<DemoUserKey, Session>()

function sessionIdOf(accessToken: string): string {
  const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { session_id?: string }
  if (!claims.session_id) fail('Access token tidak memuat klaim session_id.')
  return claims.session_id
}

/** Login sungguhan lewat Supabase Auth — setiap panggilan membuat sesi baru. */
async function signIn(key: DemoUserKey): Promise<Session> {
  const user = DEMO_USERS.find((u) => u.key === key)!
  const client = createAnon(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const { data, error } = await client.auth.signInWithPassword({
    email: demoEmail(user.localPart, domain),
    password: env.SEED_DEMO_PASSWORD,
  })
  if (error || !data.user || !data.session) fail(`Login sebagai ${key} gagal: ${error?.message}. Sudah \`npm run db:seed\`?`)
  return { client, id: data.user.id, sessionId: sessionIdOf(data.session.access_token) }
}

async function login(key: DemoUserKey) {
  const cached = sessions.get(key)
  if (cached) return cached
  const session = await signIn(key)
  sessions.set(key, session)
  return session
}

const admin = createAdmin(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

/**
 * Revisi poin 1: owner mengeluarkan Dewi (viewer), mencoba menambahkannya lagi
 * sebagai member (harus ditolak), lalu sebagai viewer (role sama, harus boleh).
 * Apa pun hasilnya, keanggotaan Dewi dikembalikan ke viewer dengan secret key.
 */
async function probeReAddWithOtherRole(owner: Client, userId: string) {
  const projectId = DEMO_PROJECTS[DEMO_CHANGES.demoteToViewer.project].id
  const outcome = (r: { error: { code: string } | null }) => (r.error ? `error ${r.error.code}` : 'berhasil')
  try {
    const removed = await owner.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId).select('user_id')
    if (removed.error || removed.data.length !== 1) {
      const why = removed.error ? `hapus: error ${removed.error.code}` : 'hapus: tidak ada baris'
      return { asMember: why, asViewer: why }
    }
    const asMember = outcome(await owner.from('project_members').insert({ project_id: projectId, user_id: userId, role: 'member' }))
    const asViewer = outcome(await owner.from('project_members').insert({ project_id: projectId, user_id: userId, role: 'viewer' }))
    return { asMember, asViewer }
  } finally {
    const restore = await admin
      .from('project_members')
      .upsert({ project_id: projectId, user_id: userId, role: 'viewer' }, { onConflict: 'project_id,user_id' })
    if (restore.error) console.error(`⚠ Gagal mengembalikan keanggotaan Dewi: ${restore.error.message}. Jalankan \`npm run db:seed -- --reset\`.`)
  }
}

/** UPDATE tanpa perubahan nilai: 'diizinkan' bila baris lolos RLS, 'ditolak' bila tidak. */
async function probeTaskEdit(key: DemoUserKey, taskKey: string) {
  const { client } = await login(key)
  const id = task[taskKey].id
  // Judul terkini dibaca dengan secret key agar UPDATE benar-benar tidak mengubah apa pun.
  const current = await admin.from('tasks').select('title').eq('id', id).single()
  if (current.error) fail(`Gagal membaca task ${taskKey}: ${current.error.message}`)
  const { data, error } = await client.from('tasks').update({ title: current.data.title }).eq('id', id).select('id')
  if (error) return `error ${error.code}`
  return data.length === 1 ? 'diizinkan' : 'ditolak'
}

async function main() {
  console.log(`→ Verifikasi ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}\n`)

  // 1. Koneksi & skema ---------------------------------------------------------
  const anon = createAnon(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const health = await anon.rpc('health_check')
  if (health.error) fail(`health_check gagal: ${health.error.message} (${health.error.code})`)
  const h = health.data as Record<string, number>
  record('Fase 0', 'Tabel inti ter-migrate', '5', String(h.tables_found))
  record('Fase 0', 'Enum ter-migrate', '4', String(h.enums_found))
  record('Fase 0', 'RLS aktif', '5', String(h.rls_enabled_tables))
  const anonRead = await anon.from('tasks').select('id')
  record('Fase 0', 'Anon membaca tasks', 'ditolak', anonRead.error ? 'ditolak' : `terbaca ${anonRead.data.length}`)

  // 2. Data contoh -------------------------------------------------------------
  const seeded = await admin.from('tasks').select('id').in('id', DEMO_TASKS.map((t) => t.id))
  if (seeded.error) fail(`Gagal membaca data: ${seeded.error.message}`)
  record('Fase 0', 'Data contoh (task demo)', String(DEMO_TASKS.length), String(seeded.data.length))
  if (seeded.data.length !== DEMO_TASKS.length) return

  // 3a. Matriks permission (koreksi #1) -----------------------------------------
  const projectIds = async (key: DemoUserKey) => {
    const { client } = await login(key)
    const { data } = await client.from('projects').select('name').order('name')
    return (data ?? []).map((p) => p.name).join(', ') || '(tidak ada)'
  }
  const allProjects = Object.values(DEMO_PROJECTS).map((p) => p.name).sort().join(', ')
  record('D1', 'Admin melihat project', allProjects, await projectIds('admin'))
  record('D4', 'Eko (owner Beta) melihat project', DEMO_PROJECTS.beta.name, await projectIds('eko'))

  record('D2', 'Budi (member, creator T2) edit T2', 'diizinkan', await probeTaskEdit('budi', 'T2'))
  record('D2', 'Citra (member, assignee T2) edit T2', 'diizinkan', await probeTaskEdit('citra', 'T2'))
  record('D2', 'Citra (member lain) edit T1', 'ditolak', await probeTaskEdit('citra', 'T1'))
  record('D3', 'Rina (owner Alpha) edit T2', 'diizinkan', await probeTaskEdit('rina', 'T2'))
  record('Koreksi #1a', 'Dewi (VIEWER, creator+assignee T3) edit T3', 'ditolak', await probeTaskEdit('dewi', 'T3'))

  const fajar = await login('fajar') // login berhasil: akun nonaktif sengaja tidak di-ban di seed
  const fajarTasks = await fajar.client.from('tasks').select('id')
  record('Koreksi #1b', 'Fajar (NONAKTIF, JWT valid) membaca task', '0', String(fajarTasks.data?.length ?? 'error'))
  record('Koreksi #1b', 'Fajar (NONAKTIF, assignee T4) edit T4', 'ditolak', await probeTaskEdit('fajar', 'T4'))

  const budi = await login('budi')
  const selfRole = await budi.client.from('profiles').update({ role: 'admin' }).eq('id', budi.id).select('id')
  record('Koreksi #1c', 'Budi mengubah role sendiri via UPDATE', 'error 42501', selfRole.error ? `error ${selfRole.error.code}` : 'berhasil')
  const selfRpc = await budi.client.rpc('admin_set_user_role', { p_user_id: budi.id, p_role: 'admin' })
  record('Koreksi #1c', 'Budi memanggil admin_set_user_role', 'error 42501', selfRpc.error ? `error ${selfRpc.error.code}` : 'berhasil')

  const reAdd = await probeReAddWithOtherRole((await login('rina')).client, (await login('dewi')).id)
  record('Revisi #1', 'Rina (owner) keluarkan Dewi (viewer) lalu tambah lagi sbg member', 'error 42501', reAdd.asMember)
  record('Revisi #1', 'Rina tambahkan Dewi kembali sbg viewer (role sama)', 'berhasil', reAdd.asViewer)

  // 3b. Audit log (koreksi #4) ---------------------------------------------------
  const forged = await budi.client
    .from('activity_logs')
    .insert({ action: 'TASK_DELETED', resource_type: 'task', description: 'palsu', user_id: (await login('rina')).id })
  record('Koreksi #4', 'Budi INSERT log palsu', 'error 42501', forged.error ? `error ${forged.error.code}` : 'berhasil')
  const budiLogs = await budi.client.from('activity_logs').select('id')
  record('Koreksi #4', 'Staff membaca audit log', '0', String(budiLogs.data?.length ?? 'error'))

  // 3c. Login/logout dicatat dari sesi Supabase Auth (revisi poin 2) -------------
  const adminSession = await login('admin')
  const authLogCount = async (action: 'USER_LOGIN' | 'USER_LOGOUT', sessionId: string) => {
    const { data, error } = await adminSession.client
      .from('activity_logs')
      .select('id')
      .eq('action', action)
      .contains('metadata', { session_id: sessionId })
    return error ? `error ${error.code}` : String(data.length)
  }

  const citra = await login('citra')
  record('Revisi #2', 'Login Citra tercatat USER_LOGIN untuk sesinya', '1', await authLogCount('USER_LOGIN', citra.sessionId))

  // RPC lama sudah dihapus; tipe Database tidak lagi memuatnya.
  const forgedLogout = await budi.client.rpc('log_auth_event' as never, { p_action: 'USER_LOGOUT' } as never)
  record('Revisi #2', 'Budi memanggil log_auth_event (RPC lama)', 'error PGRST202', forgedLogout.error ? `error ${forgedLogout.error.code}` : 'berhasil')
  record('Revisi #2', 'USER_LOGOUT untuk sesi Budi yang masih aktif', '0', await authLogCount('USER_LOGOUT', budi.sessionId))

  const extra = await signIn('citra') // sesi terpisah khusus uji logout
  const signedOut = await extra.client.auth.signOut({ scope: 'local' })
  record(
    'Revisi #2', 'Citra logout tercatat USER_LOGOUT untuk sesinya', '1',
    signedOut.error ? `error ${signedOut.error.code}` : await authLogCount('USER_LOGOUT', extra.sessionId),
  )

  const tamper = await adminSession.client.from('activity_logs').delete().eq('user_id', citra.id).select('id')
  record('Koreksi #4', 'Admin menghapus log (append-only)', 'error 42501', tamper.error ? `error ${tamper.error.code}` : `terhapus ${tamper.data.length}`)
}

main()
  .catch((err) => fail((err as Error).message))
  .finally(async () => {
    await Promise.all([...sessions.values()].map((s) => s.client.auth.signOut({ scope: 'local' })))
    if (results.length === 0) return
    console.table(
      results.map((r) => ({ '': r.ok ? '✓' : '✗', area: r.area, cek: r.check, harapan: r.expected, hasil: r.actual })),
    )
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      console.error(`\n✗ ${failed.length} dari ${results.length} pemeriksaan tidak sesuai.\n`)
      process.exit(1)
    }
    console.log(`\n✓ Semua ${results.length} pemeriksaan sesuai.\n`)
  })
