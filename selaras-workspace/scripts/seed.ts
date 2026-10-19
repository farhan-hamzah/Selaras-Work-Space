/**
 * npm run db:seed            — buat akun demo + data contoh (dilewati bila sudah ada)
 * npm run db:seed -- --reset — hapus project/task demo lalu buat ulang
 *
 * Akun dibuat lewat Supabase Auth Admin API (bukan INSERT ke auth.users) agar
 * berjalan sama di Supabase Cloud maupun lokal. Profile dibuat otomatis oleh
 * trigger handle_new_user(); setiap langkah tercatat di activity_logs oleh
 * trigger audit (actor_role = service_role).
 */
import {
  DEMO_CHANGES,
  DEMO_MEMBERSHIPS,
  DEMO_PROJECTS,
  DEMO_TASKS,
  DEMO_USERS,
  demoEmail,
  type DemoUserKey,
} from './demo-data'
import { createAdmin, fail, requireVars } from './lib/script-env'

const env = requireVars(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SEED_DEMO_PASSWORD'])
const domain = process.env.SEED_EMAIL_DOMAIN || 'selaras.test'
const reset = process.argv.includes('--reset')

if (env.SEED_DEMO_PASSWORD.length < 12) {
  fail('SEED_DEMO_PASSWORD minimal 12 karakter — akun demo ada di project yang bisa diakses dari internet.')
}

const supabase = createAdmin(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

function check<T>(label: string, result: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (result.error) fail(`${label}: ${result.error.message}${result.error.code ? ` (${result.error.code})` : ''}`)
  return result.data as T
}

async function main() {
  console.log(`→ Seed data contoh ke ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}`)

  const health = await supabase.rpc('health_check')
  if (health.error) {
    fail(
      health.error.code === 'PGRST202'
        ? 'Migration belum diterapkan. Jalankan `npm run db:push` dulu.'
        : `Tidak bisa terhubung: ${health.error.message}`,
    )
  }

  const userIds = await ensureUsers()

  const projectIds = Object.values(DEMO_PROJECTS).map((p) => p.id)
  if (reset) {
    console.log('→ --reset: menghapus project & task demo lama')
    check('Hapus project demo', await supabase.from('projects').delete().in('id', projectIds))
    for (const u of DEMO_USERS) {
      check(`Reset profile ${u.key}`, await supabase.from('profiles').update({ role: 'staff', is_active: true }).eq('id', userIds[u.key]))
    }
  } else {
    const existing = check('Cek data', await supabase.from('projects').select('id').in('id', projectIds))
    if (existing.length > 0) {
      console.log('✓ Data contoh sudah ada — dilewati (pakai `npm run db:seed -- --reset` untuk membuat ulang).')
      printSummary()
      return
    }
  }

  for (const u of DEMO_USERS.filter((u) => u.globalRole === 'admin')) {
    check(`Set role admin ${u.key}`, await supabase.from('profiles').update({ role: 'admin' }).eq('id', userIds[u.key]))
  }

  check(
    'Buat project',
    await supabase.from('projects').insert(
      Object.values(DEMO_PROJECTS).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        priority: p.priority,
        start_date: p.startDate,
        due_date: p.dueDate,
        created_by: userIds.admin,
      })),
    ),
  )

  check(
    'Tambah member',
    await supabase.from('project_members').insert(
      DEMO_MEMBERSHIPS.map((m) => ({ project_id: DEMO_PROJECTS[m.project].id, user_id: userIds[m.user], role: m.role })),
    ),
  )

  check(
    'Buat task',
    await supabase.from('tasks').insert(
      DEMO_TASKS.map((t) => ({
        id: t.id,
        project_id: DEMO_PROJECTS[t.project].id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        created_by: userIds[t.createdBy],
        assignee_id: t.assignee ? userIds[t.assignee] : null,
        due_date: t.dueDate,
      })),
    ),
  )

  // Kejadian setelah data awal: Dewi diturunkan jadi viewer, Fajar dinonaktifkan.
  const demote = DEMO_CHANGES.demoteToViewer
  check(
    'Turunkan role Dewi',
    await supabase
      .from('project_members')
      .update({ role: 'viewer' })
      .eq('project_id', DEMO_PROJECTS[demote.project].id)
      .eq('user_id', userIds[demote.user]),
  )
  check(
    'Nonaktifkan Fajar',
    await supabase.from('profiles').update({ is_active: false }).eq('id', userIds[DEMO_CHANGES.deactivate]),
  )

  console.log('✓ Data contoh dibuat: 2 project, 8 keanggotaan, 7 task.')
  printSummary()
}

/** Buat akun demo bila belum ada; bila sudah ada, samakan password & nama. */
async function ensureUsers(): Promise<Record<DemoUserKey, string>> {
  const existing = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) fail(`Gagal membaca daftar user: ${error.message}`)
    data.users.forEach((u) => u.email && existing.set(u.email.toLowerCase(), u.id))
    if (data.users.length < 1000) break
  }

  const ids = {} as Record<DemoUserKey, string>
  for (const u of DEMO_USERS) {
    const email = demoEmail(u.localPart, domain)
    const found = existing.get(email.toLowerCase())
    if (found) {
      const { error } = await supabase.auth.admin.updateUserById(found, {
        password: process.env.SEED_DEMO_PASSWORD,
        user_metadata: { full_name: u.fullName },
      })
      if (error) fail(`Gagal memperbarui ${email}: ${error.message}`)
      ids[u.key] = found
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: process.env.SEED_DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.fullName },
      })
      if (error || !data.user) {
        fail(
          `Gagal membuat ${email}: ${error?.message}` +
            (error?.code === 'email_address_invalid' ? '\n  Ganti SEED_EMAIL_DOMAIN ke domain lain di .env.local.' : ''),
        )
      }
      ids[u.key] = data.user.id
    }
  }

  const profiles = check('Cek profile', await supabase.from('profiles').select('id').in('id', Object.values(ids)))
  if (profiles.length !== DEMO_USERS.length) {
    fail('Profile tidak terbuat otomatis — trigger handle_new_user belum ada? Jalankan `npm run db:push`.')
  }
  console.log(`✓ ${DEMO_USERS.length} akun demo siap (@${domain}).`)
  return ids
}

function printSummary() {
  console.log('\nAkun demo (password = SEED_DEMO_PASSWORD):')
  console.table(
    DEMO_USERS.map((u) => ({
      email: demoEmail(u.localPart, domain),
      role: u.globalRole,
      status: u.isActive ? 'aktif' : 'NONAKTIF',
      catatan: u.note,
    })),
  )
}

main().catch((err) => fail((err as Error).message))
