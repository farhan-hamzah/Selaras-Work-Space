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
 * data dan tanpa menambah log. Keluar dengan kode 1 bila ada yang tidak sesuai.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { DEMO_PROJECTS, DEMO_TASKS, DEMO_USERS, demoEmail, type DemoUserKey } from './demo-data'
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

const sessions = new Map<DemoUserKey, { client: Client; id: string }>()

async function login(key: DemoUserKey) {
  const cached = sessions.get(key)
  if (cached) return cached
  const user = DEMO_USERS.find((u) => u.key === key)!
  const client = createAnon(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const { data, error } = await client.auth.signInWithPassword({
    email: demoEmail(user.localPart, domain),
    password: env.SEED_DEMO_PASSWORD,
  })
  if (error || !data.user) fail(`Login sebagai ${key} gagal: ${error?.message}. Sudah \`npm run db:seed\`?`)
  const session = { client, id: data.user.id }
  sessions.set(key, session)
  return session
}

const admin = createAdmin(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

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

  // 3b. Audit log (koreksi #4) ---------------------------------------------------
  const forged = await budi.client
    .from('activity_logs')
    .insert({ action: 'TASK_DELETED', resource_type: 'task', description: 'palsu', user_id: (await login('rina')).id })
  record('Koreksi #4', 'Budi INSERT log palsu', 'error 42501', forged.error ? `error ${forged.error.code}` : 'berhasil')
  const budiLogs = await budi.client.from('activity_logs').select('id')
  record('Koreksi #4', 'Staff membaca audit log', '0', String(budiLogs.data?.length ?? 'error'))

  const citra = await login('citra')
  const logged = await citra.client.rpc('log_auth_event', { p_action: 'USER_LOGIN' })
  record('Koreksi #4', 'log_auth_event(USER_LOGIN) di-await', 'tersimpan', logged.error ? `error ${logged.error.code}` : 'tersimpan')
  const adminSession = await login('admin')
  const lastLogin = await adminSession.client
    .from('activity_logs')
    .select('user_id, action')
    .eq('action', 'USER_LOGIN')
    .eq('user_id', citra.id)
    .order('created_at', { ascending: false })
    .limit(1)
  record('Koreksi #4', 'Admin melihat USER_LOGIN milik Citra', 'ada', lastLogin.data?.length === 1 ? 'ada' : 'tidak ada')
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
