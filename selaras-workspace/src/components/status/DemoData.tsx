import { connection } from 'next/server'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { loadDemoOverview } from '@/lib/dev/demo-overview'
import {
  formatDateTime,
  PRIORITY_LABEL,
  PROJECT_ROLE_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
} from '@/lib/labels'
import type { Enums } from '@/types/database'

const ROLE_TONE: Record<Enums<'project_member_role'>, BadgeTone> = { owner: 'info', member: 'neutral', viewer: 'warning' }

export async function DemoData() {
  await connection()
  const overview = await loadDemoOverview()

  if (overview.state === 'disabled') return null

  if (overview.state !== 'ready') {
    const message = {
      no_secret_key: 'Isi SUPABASE_SECRET_KEY di .env.local untuk menampilkan data contoh (dibaca di server saja).',
      empty: 'Belum ada data contoh. Jalankan `npm run db:seed`.',
      error: overview.state === 'error' ? `Gagal memuat data: ${overview.message}` : '',
    }[overview.state]
    return (
      <Card title="Data contoh" description="Hanya tampil di mode development.">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card
        title="Akun demo"
        description="Dibuat oleh npm run db:seed. Password semua akun = SEED_DEMO_PASSWORD di .env.local. Login baru tersedia di Fase 1."
      >
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-2 font-medium">Nama</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role global</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Role per project</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {overview.users.map((user) => (
                <tr key={user.id}>
                  <td className="px-5 py-2 font-medium text-zinc-900 dark:text-zinc-100">{user.fullName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{user.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>{user.role}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'aktif' : 'nonaktif'}</Badge>
                  </td>
                  <td className="px-5 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {user.memberships.length === 0 ? (
                        <span className="text-zinc-500">{user.role === 'admin' ? 'semua project (D1)' : '—'}</span>
                      ) : (
                        user.memberships.map((m) => (
                          <Badge key={m.projectName} tone={ROLE_TONE[m.role]}>
                            {m.projectName}: {PROJECT_ROLE_LABEL[m.role]}
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {overview.projects.map((project) => (
        <Card
          key={project.id}
          title={project.name}
          description={`${project.tasks.length} task`}
          aside={
            <div className="flex gap-2">
              <Badge tone="info">{PROJECT_STATUS_LABEL[project.status]}</Badge>
              <Badge>Prioritas {PRIORITY_LABEL[project.priority]}</Badge>
            </div>
          }
        >
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-5 py-2 font-medium">Task</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Prioritas</th>
                  <th className="px-3 py-2 font-medium">Dibuat oleh</th>
                  <th className="px-5 py-2 font-medium">Assignee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {project.tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="px-5 py-2 text-zinc-900 dark:text-zinc-100">{task.title}</td>
                    <td className="px-3 py-2">
                      <Badge tone={task.status === 'done' ? 'success' : 'neutral'}>{TASK_STATUS_LABEL[task.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{PRIORITY_LABEL[task.priority]}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{task.createdBy}</td>
                    <td className="px-5 py-2 text-zinc-700 dark:text-zinc-300">{task.assignee ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card
        title="Audit log"
        description={`${overview.logCount} entri tersimpan. Ditulis oleh trigger database di transaksi yang sama dengan perubahan data (koreksi #4).`}
      >
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
          {overview.recentLogs.map((log) => (
            <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="flex items-baseline gap-2">
                <code className="font-mono text-xs text-zinc-500">{log.action}</code>
                <span className="text-zinc-800 dark:text-zinc-200">{log.description}</span>
              </span>
              <time className="text-xs text-zinc-500" dateTime={log.created_at}>
                {formatDateTime(log.created_at)}
              </time>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
