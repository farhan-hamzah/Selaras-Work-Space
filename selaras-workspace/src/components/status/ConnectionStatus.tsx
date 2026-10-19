import type { ReactNode } from 'react'
import { connection } from 'next/server'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { formatDateTime } from '@/lib/labels'
import { checkSupabaseHealth, type SupabaseHealth } from '@/lib/supabase/health'

const STATE_BADGE: Record<SupabaseHealth['state'], { tone: BadgeTone; label: string }> = {
  connected: { tone: 'success', label: 'Terhubung' },
  schema_incomplete: { tone: 'warning', label: 'Skema belum lengkap' },
  schema_missing: { tone: 'warning', label: 'Migration belum dijalankan' },
  not_configured: { tone: 'neutral', label: 'Belum dikonfigurasi' },
  unauthorized: { tone: 'danger', label: 'Kunci ditolak' },
  unreachable: { tone: 'danger', label: 'Tidak terjangkau' },
  error: { tone: 'danger', label: 'Error' },
}

export async function ConnectionStatus() {
  await connection()
  const health = await checkSupabaseHealth()
  const badge = STATE_BADGE[health.state]

  return (
    <Card
      title="Koneksi Supabase"
      description={
        <>
          Sumber yang sama dengan <code className="font-mono">GET /api/health</code>.
        </>
      }
      aside={<Badge tone={badge.tone}>{badge.label}</Badge>}
    >
      {health.state === 'not_configured' ? (
        <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <p>{health.message}</p>
          <ul className="list-inside list-disc font-mono text-xs">
            {health.missing.map((name) => (
              <li key={name}>{name} — belum diisi</li>
            ))}
            {health.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p>
            Salin <code className="font-mono">.env.example</code> menjadi <code className="font-mono">.env.local</code>, isi
            nilainya, lalu jalankan ulang <code className="font-mono">npm run dev</code>.
          </p>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Project">{health.project.host}</Item>
          <Item label="Jenis kunci">{health.project.keyType}</Item>
          {'latencyMs' in health ? <Item label="Latensi health check">{health.latencyMs} ms</Item> : null}
          {'database' in health && health.database.serverTime ? (
            <Item label="Waktu server database">{formatDateTime(health.database.serverTime)}</Item>
          ) : null}
          {'database' in health ? (
            <div className="sm:col-span-2">
              <dt className="text-zinc-500 dark:text-zinc-400">Skema</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                <Check ok={health.database.tablesFound === health.database.tablesExpected}>
                  Tabel inti {health.database.tablesFound}/{health.database.tablesExpected}
                </Check>
                <Check ok={health.database.enumsFound === health.database.enumsExpected}>
                  Enum {health.database.enumsFound}/{health.database.enumsExpected}
                </Check>
                <Check ok={health.database.rlsEnabledTables === health.database.tablesExpected}>
                  RLS aktif {health.database.rlsEnabledTables}/{health.database.tablesExpected}
                </Check>
              </dd>
            </div>
          ) : null}
          {'message' in health ? (
            <p className="text-zinc-700 sm:col-span-2 dark:text-zinc-300">{health.message}</p>
          ) : null}
        </dl>
      )}
    </Card>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  )
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <Badge tone={ok ? 'success' : 'warning'}>{ok ? '✓' : '!'} {children}</Badge>
}
