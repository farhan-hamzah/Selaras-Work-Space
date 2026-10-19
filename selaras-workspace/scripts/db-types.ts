/**
 * npm run db:types
 * Regenerate src/types/database.ts dari skema database (NFR-REL-03) — jalankan
 * setiap kali ada migration baru.
 *
 * Default memakai SUPABASE_DB_URL (sama dengan db:push; tanpa Docker/login).
 * Bila SUPABASE_DB_URL kosong, memakai Management API via project ref
 * (butuh `npx supabase login` sekali).
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fail, loadEnv, projectRefFromUrl, ROOT } from './lib/script-env'

const HEADER = `/**
 * Tipe skema database — DIHASILKAN oleh \`npm run db:types\` (supabase gen types).
 * Jangan diedit manual; ubah migration lalu generate ulang (NFR-REL-03).
 */
`

loadEnv()
const source = process.env.SUPABASE_DB_URL
  ? ['--db-url', process.env.SUPABASE_DB_URL]
  : (() => {
      const ref =
        process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
      if (!ref) fail('Isi SUPABASE_DB_URL (disarankan) atau SUPABASE_PROJECT_REF di .env.local.')
      return ['--project-id', ref]
    })()

const cli = path.join(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js')
const result = spawnSync(process.execPath, [cli, 'gen', 'types', 'typescript', ...source, '--schema', 'public'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 20 * 1024 * 1024,
})
if (result.status !== 0 || !result.stdout.includes('export type Database')) {
  fail('Gagal generate types. Periksa SUPABASE_DB_URL (atau `npx supabase login` bila memakai project ref).')
}

const target = path.join(ROOT, 'src', 'types', 'database.ts')
writeFileSync(target, HEADER + result.stdout)

const oxfmt = path.join(ROOT, 'node_modules', 'oxfmt', 'bin', 'oxfmt')
spawnSync(process.execPath, [oxfmt, target], { cwd: ROOT, stdio: 'ignore' })
console.log(`✓ Types ditulis ke ${path.relative(ROOT, target)}`)
