/**
 * KOREKSI #1 — policy database = matriks permission (SRS 3.7, D1–D4).
 *
 * Setiap test menjalankan SQL persis seperti PostgREST: SET ROLE authenticated
 * + klaim JWT pengguna, lalu transaksi di-rollback. "affected = 0" pada UPDATE
 * berarti baris tidak lolos policy (RLS menyaring diam-diam, tanpa error).
 */
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asActor, createTestDb, PROJECT, run, TASK, USER_IDS } from './harness'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
})

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id).sort()

const updateTaskTitle = (taskKey: string) =>
  [`update public.tasks set title = title || ' (edit)' where id = $1`, [TASK[taskKey]]] as const
const updateTaskStatus = (taskKey: string, status: string) =>
  [`update public.tasks set status = $2 where id = $1`, [TASK[taskKey], status]] as const

describe('Koreksi #1a — Viewer tidak bisa edit walaupun creator/assignee', () => {
  it('Dewi (viewer Alpha, creator & assignee T3) tidak bisa mengedit T3', async () => {
    const r = await run(db, 'dewi', ...updateTaskTitle('T3'))
    expect(r.error).toBeNull()
    expect(r.affected).toBe(0)
  })

  it('Dewi tidak bisa mengubah status T3', async () => {
    const r = await run(db, 'dewi', ...updateTaskStatus('T3', 'done'))
    expect(r.affected).toBe(0)
  })

  it('Dewi tidak bisa membuat task baru', async () => {
    const r = await run(
      db, 'dewi',
      `insert into public.tasks (project_id, title, created_by) values ($1, 'Task viewer', $2)`,
      [PROJECT.alpha, USER_IDS.dewi],
    )
    expect(r.error?.code).toBe('42501') // new row violates row-level security policy
  })

  it('Dewi tetap bisa MELIHAT task di Alpha (viewer = read-only)', async () => {
    const r = await run(db, 'dewi', `select id from public.tasks where project_id = $1`, [PROJECT.alpha])
    expect(r.rows).toHaveLength(5)
  })

  it('Budi (viewer di Beta) tidak bisa mengedit task Beta mana pun', async () => {
    const r = await run(db, 'budi', `update public.tasks set title = title || '!' where project_id = $1`, [PROJECT.beta])
    expect(r.affected).toBe(0)
  })
})

describe('Koreksi #1b — akun nonaktif ditolak walaupun JWT masih valid', () => {
  it('Fajar (nonaktif) tidak melihat project, task, profile, maupun member', async () => {
    await asActor(db, 'fajar', async (q) => {
      expect((await q('select id from public.projects')).rows).toHaveLength(0)
      expect((await q('select id from public.tasks')).rows).toHaveLength(0)
      expect((await q('select id from public.profiles')).rows).toHaveLength(0)
      expect((await q('select id from public.project_members')).rows).toHaveLength(0)
    })
  })

  it('Fajar tidak bisa mengedit T4 walaupun dia assignee-nya', async () => {
    const r = await run(db, 'fajar', ...updateTaskStatus('T4', 'in_progress'))
    expect(r.affected).toBe(0)
  })

  it('Fajar tidak bisa membuat task', async () => {
    const r = await run(
      db, 'fajar',
      `insert into public.tasks (project_id, title, created_by) values ($1, 'x', $2)`,
      [PROJECT.alpha, USER_IDS.fajar],
    )
    expect(r.error?.code).toBe('42501')
  })

  it('Admin yang dinonaktifkan kehilangan seluruh hak admin', async () => {
    await asActor(db, 'postgres', async (q) => {
      await q(`update public.profiles set is_active = false where id = $1`, [USER_IDS.admin])
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_IDS.admin, role: 'authenticated' })])
      await q('set local role authenticated')
      expect((await q('select id from public.projects')).rows).toHaveLength(0)
      expect((await q('select id from public.activity_logs')).rows).toHaveLength(0)
      const r = await q(`select public.admin_set_user_role($1, 'admin')`, [USER_IDS.budi])
      expect(r.error?.code).toBe('42501')
    })
  })
})

describe('Koreksi #1c — Staff tidak bisa mengubah role/status sendiri', () => {
  it('Budi tidak bisa UPDATE role miliknya (kolom tidak di-grant)', async () => {
    const r = await run(db, 'budi', `update public.profiles set role = 'admin' where id = $1`, [USER_IDS.budi])
    expect(r.error?.code).toBe('42501')
  })

  it('Budi tidak bisa UPDATE is_active / last_login_at miliknya', async () => {
    const a = await run(db, 'budi', `update public.profiles set is_active = true where id = $1`, [USER_IDS.budi])
    const b = await run(db, 'budi', `update public.profiles set last_login_at = now() where id = $1`, [USER_IDS.budi])
    expect(a.error?.code).toBe('42501')
    expect(b.error?.code).toBe('42501')
  })

  it('Budi tidak bisa memanggil fungsi admin untuk menaikkan role sendiri', async () => {
    const r = await run(db, 'budi', `select public.admin_set_user_role($1, 'admin')`, [USER_IDS.budi])
    expect(r.error?.code).toBe('42501')
  })

  it('Lapis kedua: walau GRANT kolom keliru dibuka, guard trigger tetap menolak', async () => {
    await asActor(db, 'postgres', async (q) => {
      await q('grant update on public.profiles to authenticated') // simulasi salah konfigurasi
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_IDS.budi, role: 'authenticated' })])
      await q('set local role authenticated')
      const r = await q(`update public.profiles set role = 'admin' where id = $1`, [USER_IDS.budi])
      expect(r.error?.code).toBe('42501')
      expect(r.error?.message).toContain('hanya bisa diubah Admin')
    })
  })

  it('Budi tetap boleh mengubah nama tampilannya sendiri', async () => {
    const r = await run(db, 'budi', `update public.profiles set display_name = 'Budi S.' where id = $1`, [USER_IDS.budi])
    expect(r.error).toBeNull()
    expect(r.affected).toBe(1)
  })

  it('Budi tidak bisa mengubah profile orang lain', async () => {
    const r = await run(db, 'budi', `update public.profiles set display_name = 'x' where id = $1`, [USER_IDS.citra])
    expect(r.affected).toBe(0)
  })

  it('Admin bisa mengubah role orang lain lewat fungsi admin', async () => {
    await asActor(db, 'admin', async (q) => {
      const r = await q(`select public.admin_set_user_role($1, 'admin')`, [USER_IDS.budi])
      expect(r.error).toBeNull()
      const p = await q<{ role: string }>(`select role from public.profiles where id = $1`, [USER_IDS.budi])
      expect(p.rows[0].role).toBe('admin')
    })
  })

  it('Admin tidak bisa menurunkan role atau menonaktifkan dirinya sendiri', async () => {
    const a = await run(db, 'admin', `select public.admin_set_user_role($1, 'staff')`, [USER_IDS.admin])
    const b = await run(db, 'admin', `select public.admin_set_user_active($1, false)`, [USER_IDS.admin])
    expect(a.error?.code).toBe('22023')
    expect(b.error?.code).toBe('22023')
  })

  it('Owner project pun tidak bisa mengubah role per-project member (khusus Admin)', async () => {
    const r = await run(
      db, 'rina',
      `update public.project_members set role = 'owner' where project_id = $1 and user_id = $2`,
      [PROJECT.alpha, USER_IDS.budi],
    )
    expect(r.affected).toBe(0)
  })
})

describe('Matriks Projects (SRS 3.7)', () => {
  it('Lihat: Admin melihat SEMUA project walau bukan member (D1)', async () => {
    const r = await run(db, 'admin', 'select id from public.projects')
    expect(ids(r.rows)).toEqual([PROJECT.alpha, PROJECT.beta].sort())
  })

  it('Lihat: Staff hanya melihat project tempat ia terdaftar (D4)', async () => {
    expect(ids((await run(db, 'eko', 'select id from public.projects')).rows)).toEqual([PROJECT.beta])
    expect(ids((await run(db, 'citra', 'select id from public.projects')).rows)).toEqual([PROJECT.alpha])
    expect(ids((await run(db, 'dewi', 'select id from public.projects')).rows)).toEqual([PROJECT.alpha])
  })

  it('Anon tidak punya akses sama sekali', async () => {
    const r = await run(db, 'anon', 'select id from public.projects')
    expect(r.error?.code).toBe('42501')
  })

  it('Buat project: hanya Admin', async () => {
    const sql = `insert into public.projects (name, created_by) values ('Baru', $1)`
    expect((await run(db, 'admin', sql, [USER_IDS.admin])).error).toBeNull()
    expect((await run(db, 'rina', sql, [USER_IDS.rina])).error?.code).toBe('42501')
  })

  it('Edit detail: Admin & Owner YES; Member, Viewer, owner project lain NO', async () => {
    const sql = `update public.projects set name = name || ' v2' where id = $1`
    expect((await run(db, 'admin', sql, [PROJECT.alpha])).affected).toBe(1)
    expect((await run(db, 'rina', sql, [PROJECT.alpha])).affected).toBe(1)
    expect((await run(db, 'budi', sql, [PROJECT.alpha])).affected).toBe(0)
    expect((await run(db, 'dewi', sql, [PROJECT.alpha])).affected).toBe(0)
    expect((await run(db, 'eko', sql, [PROJECT.alpha])).affected).toBe(0)
  })

  it('Hapus project: hanya Admin (soft delete); hard DELETE ditolak untuk semua', async () => {
    expect((await run(db, 'rina', 'select public.soft_delete_project($1)', [PROJECT.alpha])).error?.code).toBe('42501')
    expect((await run(db, 'eko', 'select public.soft_delete_project($1)', [PROJECT.alpha])).error?.code).toBe('P0002')
    expect((await run(db, 'admin', 'delete from public.projects where id = $1', [PROJECT.alpha])).error?.code).toBe('42501')
    await asActor(db, 'admin', async (q) => {
      expect((await q('select public.soft_delete_project($1)', [PROJECT.alpha])).error).toBeNull()
      expect((await q('select id from public.projects')).rows).toHaveLength(1)
    })
  })

  it('Tambah/hapus member: Admin & Owner YES (owner hanya member/viewer); Member NO', async () => {
    const add = `insert into public.project_members (project_id, user_id, role) values ($1, $2, $3)`
    expect((await run(db, 'rina', add, [PROJECT.alpha, USER_IDS.eko, 'member'])).error).toBeNull()
    expect((await run(db, 'rina', add, [PROJECT.alpha, USER_IDS.eko, 'owner'])).error?.code).toBe('42501')
    expect((await run(db, 'budi', add, [PROJECT.alpha, USER_IDS.eko, 'viewer'])).error?.code).toBe('42501')
    expect((await run(db, 'admin', add, [PROJECT.alpha, USER_IDS.eko, 'owner'])).error).toBeNull()

    const remove = `delete from public.project_members where project_id = $1 and user_id = $2`
    expect((await run(db, 'rina', remove, [PROJECT.alpha, USER_IDS.citra])).affected).toBe(1)
    expect((await run(db, 'budi', remove, [PROJECT.alpha, USER_IDS.citra])).affected).toBe(0)
    expect((await run(db, 'admin', remove, [PROJECT.alpha, USER_IDS.citra])).affected).toBe(1)
  })
})

describe('Matriks Tasks (SRS 3.7, D2)', () => {
  it('Lihat: Admin semua; anggota hanya project-nya', async () => {
    expect((await run(db, 'admin', 'select id from public.tasks')).rows).toHaveLength(7)
    expect((await run(db, 'eko', 'select id from public.tasks')).rows).toHaveLength(2)
    expect((await run(db, 'citra', 'select id from public.tasks')).rows).toHaveLength(5)
  })

  it('Buat: Admin, Owner, Member YES; Viewer & non-member NO', async () => {
    const sql = `insert into public.tasks (project_id, title, created_by) values ($1, 'Task baru', $2)`
    expect((await run(db, 'admin', sql, [PROJECT.alpha, USER_IDS.admin])).error).toBeNull()
    expect((await run(db, 'rina', sql, [PROJECT.alpha, USER_IDS.rina])).error).toBeNull()
    expect((await run(db, 'citra', sql, [PROJECT.alpha, USER_IDS.citra])).error).toBeNull()
    expect((await run(db, 'dewi', sql, [PROJECT.alpha, USER_IDS.dewi])).error?.code).toBe('42501')
    expect((await run(db, 'eko', sql, [PROJECT.alpha, USER_IDS.eko])).error?.code).toBe('42501')
  })

  it('Buat: tidak bisa memalsukan created_by', async () => {
    const r = await run(
      db, 'citra',
      `insert into public.tasks (project_id, title, created_by) values ($1, 'x', $2)`,
      [PROJECT.alpha, USER_IDS.rina],
    )
    expect(r.error?.code).toBe('42501')
  })

  it.each([
    ['admin', 'T2', 1],
    ['rina', 'T2', 1], // owner
    ['budi', 'T2', 1], // member, creator
    ['citra', 'T2', 1], // member, assignee
    ['citra', 'T1', 0], // member lain
    ['dewi', 'T3', 0], // viewer, creator+assignee
    ['eko', 'T1', 0], // owner project lain
  ] as const)('Edit: %s mengedit %s -> %i baris', async (actor, task, expected) => {
    expect((await run(db, actor, ...updateTaskTitle(task))).affected).toBe(expected)
  })

  it('Ubah status: assignee (Budi di T1) boleh; member lain (Citra di T1) tidak', async () => {
    expect((await run(db, 'budi', ...updateTaskStatus('T1', 'review'))).affected).toBe(1)
    expect((await run(db, 'citra', ...updateTaskStatus('T1', 'review'))).affected).toBe(0)
  })

  it('Hapus: hanya Admin & Owner; creator/assignee member tidak', async () => {
    const sql = 'select public.soft_delete_task($1)'
    expect((await run(db, 'admin', sql, [TASK.T2])).error).toBeNull()
    expect((await run(db, 'rina', sql, [TASK.T2])).error).toBeNull()
    expect((await run(db, 'budi', sql, [TASK.T2])).error?.code).toBe('42501')
    expect((await run(db, 'citra', sql, [TASK.T2])).error?.code).toBe('42501')
    expect((await run(db, 'dewi', sql, [TASK.T3])).error?.code).toBe('42501')
    expect((await run(db, 'eko', sql, [TASK.T2])).error?.code).toBe('P0002') // tidak bocorkan keberadaan
    expect((await run(db, 'rina', 'delete from public.tasks where id = $1', [TASK.T2])).error?.code).toBe('42501')
  })

  it('Assign/reassign: hanya Admin & Owner (FR-TASK-06)', async () => {
    const sql = `update public.tasks set assignee_id = $2 where id = $1`
    expect((await run(db, 'rina', sql, [TASK.T2, USER_IDS.budi])).affected).toBe(1)
    expect((await run(db, 'admin', sql, [TASK.T2, USER_IDS.budi])).affected).toBe(1)
    expect((await run(db, 'budi', sql, [TASK.T2, USER_IDS.budi])).error?.code).toBe('42501') // creator
    expect((await run(db, 'citra', sql, [TASK.T2, null])).error?.code).toBe('42501') // assignee
  })

  it('Member boleh membuat task tanpa assignee atau untuk dirinya, tidak untuk orang lain', async () => {
    const sql = `insert into public.tasks (project_id, title, created_by, assignee_id) values ($1, 'x', $2, $3)`
    expect((await run(db, 'citra', sql, [PROJECT.alpha, USER_IDS.citra, USER_IDS.citra])).error).toBeNull()
    expect((await run(db, 'citra', sql, [PROJECT.alpha, USER_IDS.citra, USER_IDS.budi])).error?.code).toBe('42501')
  })

  it('Assignee baru harus owner/member AKTIF di project tersebut', async () => {
    const sql = `update public.tasks set assignee_id = $2 where id = $1`
    expect((await run(db, 'rina', sql, [TASK.T2, USER_IDS.dewi])).error?.code).toBe('23514') // viewer
    expect((await run(db, 'rina', sql, [TASK.T2, USER_IDS.fajar])).error?.code).toBe('23514') // nonaktif
    expect((await run(db, 'rina', sql, [TASK.T2, USER_IDS.eko])).error?.code).toBe('23514') // bukan member
  })

  it('Kolom yang tidak boleh diubah (project_id, created_by, deleted_at) ditolak', async () => {
    const a = await run(db, 'rina', `update public.tasks set project_id = $2 where id = $1`, [TASK.T2, PROJECT.beta])
    const b = await run(db, 'rina', `update public.tasks set created_by = $2 where id = $1`, [TASK.T2, USER_IDS.rina])
    const c = await run(db, 'rina', `update public.tasks set deleted_at = now() where id = $1`, [TASK.T2])
    expect([a.error?.code, b.error?.code, c.error?.code]).toEqual(['42501', '42501', '42501'])
  })

  it('completed_at terisi otomatis saat status menjadi done', async () => {
    await asActor(db, 'budi', async (q) => {
      await q(`update public.tasks set status = 'done' where id = $1`, [TASK.T1])
      const r = await q<{ completed_at: string | null }>(`select completed_at from public.tasks where id = $1`, [TASK.T1])
      expect(r.rows[0].completed_at).not.toBeNull()
    })
  })
})

describe('Visibilitas profile', () => {
  it('Staff melihat dirinya + rekan satu project saja', async () => {
    const r = await run<{ id: string }>(db, 'citra', 'select id from public.profiles')
    expect(r.rows.map((x) => x.id).sort()).toEqual(
      [USER_IDS.rina, USER_IDS.budi, USER_IDS.citra, USER_IDS.dewi, USER_IDS.fajar].sort(),
    )
  })

  it('Admin melihat semua profile', async () => {
    expect((await run(db, 'admin', 'select id from public.profiles')).rows).toHaveLength(7)
  })
})

/**
 * Pembanding: memasang kembali policy dari Implementation Plan v0.2 (di dalam
 * transaksi yang di-rollback) untuk membuktikan celahnya nyata — dan bahwa
 * test di atas memang sensitif terhadap celah tersebut.
 */
describe('Pembanding — policy v0.2 (sebelum koreksi) memang bocor', () => {
  const asUser = (user: keyof typeof USER_IDS) => [
    `select set_config('request.jwt.claims', '${JSON.stringify({ sub: USER_IDS[user], role: 'authenticated' })}', true)`,
    'set local role authenticated',
  ]

  it('v0.2 "Creator or assignee can update their task": Viewer & akun nonaktif BISA edit', async () => {
    await asActor(db, 'postgres', async (q) => {
      await q(`create policy v02_creator_or_assignee on public.tasks for update
               using (assignee_id = auth.uid() or created_by = auth.uid())`)
      // SELECT v0.2 "Members can view tasks in their project" + policy keanggotaan
      // sendiri (v0.2 tidak mendefinisikan policy project_members; ini rekonstruksi
      // paling umum). Tidak ada pemeriksaan is_active di mana pun pada v0.2.
      await q(`create policy v02_own_membership on public.project_members for select using (user_id = auth.uid())`)
      await q(`create policy v02_members_view_tasks on public.tasks for select
               using (project_id in (select project_id from public.project_members where user_id = auth.uid()))`)
      for (const s of asUser('dewi')) await q(s)
      expect((await q(...updateTaskTitle('T3'))).affected).toBe(1) // viewer berhasil edit
      await q('reset role')
      for (const s of asUser('fajar')) await q(s)
      expect((await q(...updateTaskStatus('T4', 'done'))).affected).toBe(1) // akun nonaktif berhasil edit
    })
  })

  it('v0.2 "user baca/ubah baris sendiri" + grant default Supabase: Staff BISA jadi admin', async () => {
    await asActor(db, 'postgres', async (q) => {
      // Kondisi v0.2: grant default Supabase (ALL), policy "ubah baris sendiri", tanpa guard.
      await q('drop trigger guard_profile_update on public.profiles')
      await q('grant update on public.profiles to authenticated')
      await q(`create policy v02_update_own on public.profiles for update using (id = auth.uid())`)
      for (const s of asUser('budi')) await q(s)
      const r = await q(`update public.profiles set role = 'admin' where id = $1`, [USER_IDS.budi])
      expect(r.affected).toBe(1)
    })
  })
})
