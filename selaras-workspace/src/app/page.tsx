import { Suspense } from 'react'
import { ConnectionStatus } from '@/components/status/ConnectionStatus'
import { DemoData } from '@/components/status/DemoData'
import { Card, CardSkeleton } from '@/components/ui/Card'

const COMMANDS: { command: string; purpose: string }[] = [
  { command: 'npm run dev', purpose: 'Jalankan aplikasi di http://localhost:3000' },
  { command: 'npm run db:push', purpose: 'Terapkan migration ke database Supabase (SUPABASE_DB_URL)' },
  { command: 'npm run db:seed', purpose: 'Isi data contoh: 7 akun demo, 2 project, 7 task' },
  { command: 'npm run verify:supabase', purpose: 'Cek koneksi, skema, dan permission langsung ke Supabase' },
  { command: 'npm run test:db', purpose: 'Uji RLS & audit log (Postgres in-memory, tanpa internet)' },
]

/** Halaman status Fase 0 — diganti dashboard di Fase 1/2. */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Fase 0 · Setup &amp; Fondasi</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
          IT Selaras Workspace
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Halaman ini memastikan Next.js terhubung ke Supabase, skema database sudah ter-migrate, dan data contoh
          tersedia. Login, permission di aplikasi, dan fitur project/task dibangun mulai Fase 1.
        </p>
      </header>

      <div className="space-y-6">
        <Suspense fallback={<CardSkeleton title="Koneksi Supabase" />}>
          <ConnectionStatus />
        </Suspense>

        <Suspense fallback={<CardSkeleton title="Data contoh" lines={5} />}>
          <DemoData />
        </Suspense>

        <Card title="Perintah" description="Panduan lengkap ada di README.md.">
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {COMMANDS.map(({ command, purpose }) => (
              <li key={command} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-4">
                <code className="shrink-0 font-mono text-xs text-zinc-900 sm:w-52 dark:text-zinc-100">{command}</code>
                <span className="text-zinc-600 dark:text-zinc-400">{purpose}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </main>
  )
}
