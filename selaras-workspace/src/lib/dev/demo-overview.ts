import 'server-only'
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin'
import type { Enums, Tables } from '@/types/database'

/**
 * Ringkasan data contoh untuk halaman status Fase 0 (HANYA development).
 * Dibaca dengan secret key karena belum ada login (Fase 1); tidak boleh
 * dipakai di halaman production.
 */
export type DemoOverview =
  | { state: 'disabled' | 'no_secret_key' }
  | { state: 'error'; message: string }
  | { state: 'empty' }
  | {
      state: 'ready'
      users: DemoUserRow[]
      projects: DemoProjectRow[]
      logCount: number
      recentLogs: Pick<Tables<'activity_logs'>, 'id' | 'action' | 'description' | 'created_at'>[]
    }

export interface DemoUserRow {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  memberships: { projectName: string; role: Enums<'project_member_role'> }[]
}

export interface DemoProjectRow {
  id: string
  name: string
  status: Enums<'project_status'>
  priority: Enums<'priority_level'>
  tasks: {
    id: string
    title: string
    status: Enums<'task_status'>
    priority: Enums<'priority_level'>
    createdBy: string
    assignee: string | null
  }[]
}

export async function loadDemoOverview(): Promise<DemoOverview> {
  if (process.env.NODE_ENV === 'production') return { state: 'disabled' }
  if (!isAdminClientConfigured()) return { state: 'no_secret_key' }

  try {
    const supabase = createAdminClient()
    const [profiles, projects, members, tasks, logs, users] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, is_active').order('full_name'),
      supabase.from('projects').select('id, name, status, priority').is('deleted_at', null).order('name'),
      supabase.from('project_members').select('project_id, user_id, role'),
      supabase
        .from('tasks')
        .select('id, project_id, title, status, priority, created_by, assignee_id, created_at')
        .is('deleted_at', null)
        .order('created_at'),
      supabase
        .from('activity_logs')
        .select('id, action, description, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ])

    const firstError = [profiles, projects, members, tasks, logs].find((r) => r.error)?.error ?? users.error
    if (firstError) return { state: 'error', message: firstError.message }
    if (!projects.data?.length) return { state: 'empty' }

    const nameOf = new Map(profiles.data!.map((p) => [p.id, p.full_name]))
    const projectName = new Map(projects.data.map((p) => [p.id, p.name]))
    const emailOf = new Map(users.data.users.map((u) => [u.id, u.email ?? '']))

    return {
      state: 'ready',
      users: profiles.data!.map((p) => ({
        id: p.id,
        fullName: p.full_name,
        email: emailOf.get(p.id) ?? '',
        role: p.role,
        isActive: p.is_active,
        memberships: members
          .data!.filter((m) => m.user_id === p.id && projectName.has(m.project_id))
          .map((m) => ({ projectName: projectName.get(m.project_id)!, role: m.role })),
      })),
      projects: projects.data.map((project) => ({
        ...project,
        tasks: tasks
          .data!.filter((t) => t.project_id === project.id)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            createdBy: nameOf.get(t.created_by) ?? t.created_by,
            assignee: t.assignee_id ? (nameOf.get(t.assignee_id) ?? t.assignee_id) : null,
          })),
      })),
      logCount: logs.count ?? 0,
      recentLogs: logs.data ?? [],
    }
  } catch (err) {
    return { state: 'error', message: (err as Error).message }
  }
}
