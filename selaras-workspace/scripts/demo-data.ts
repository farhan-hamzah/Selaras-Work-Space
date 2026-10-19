/**
 * Data contoh Fase 0 — satu sumber untuk:
 *   - scripts/seed.ts        (seed ke project Supabase sungguhan via Admin API)
 *   - tests/db/harness.ts    (seed ke Postgres in-memory untuk uji RLS)
 *
 * Skenario sengaja memuat kasus-kasus koreksi #1:
 *   - Dewi pernah member, membuat & mengerjakan task, lalu diturunkan jadi VIEWER.
 *   - Fajar member yang di-assign task, lalu akunnya DINONAKTIFKAN.
 *   - Admin bukan member project mana pun (uji D1: tetap melihat semua).
 *   - Eko owner di project Beta saja (uji D4: tidak punya akses ke Alpha).
 */

export type DemoUserKey = 'admin' | 'rina' | 'budi' | 'citra' | 'dewi' | 'eko' | 'fajar'
export type ProjectRole = 'owner' | 'member' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface DemoUser {
  key: DemoUserKey
  localPart: string
  fullName: string
  globalRole: 'admin' | 'staff'
  /** Status akhir setelah seed selesai. */
  isActive: boolean
  note: string
}

export const DEMO_USERS: readonly DemoUser[] = [
  { key: 'admin', localPart: 'admin', fullName: 'Arif Pratama', globalRole: 'admin', isActive: true, note: 'Admin global, bukan member project mana pun (uji D1)' },
  { key: 'rina', localPart: 'rina', fullName: 'Rina Wulandari', globalRole: 'staff', isActive: true, note: 'Owner Alpha, member Beta' },
  { key: 'budi', localPart: 'budi', fullName: 'Budi Santoso', globalRole: 'staff', isActive: true, note: 'Member Alpha, viewer Beta' },
  { key: 'citra', localPart: 'citra', fullName: 'Citra Lestari', globalRole: 'staff', isActive: true, note: 'Member Alpha' },
  { key: 'dewi', localPart: 'dewi', fullName: 'Dewi Anggraini', globalRole: 'staff', isActive: true, note: 'Viewer Alpha — creator & assignee task T3 (uji koreksi #1a)' },
  { key: 'eko', localPart: 'eko', fullName: 'Eko Saputra', globalRole: 'staff', isActive: true, note: 'Owner Beta, tidak punya akses Alpha (uji D4)' },
  { key: 'fajar', localPart: 'fajar', fullName: 'Fajar Nugroho', globalRole: 'staff', isActive: false, note: 'Member Alpha, akun NONAKTIF — assignee task T4 (uji koreksi #1b)' },
]

export const DEMO_PROJECTS = {
  alpha: {
    id: 'a1a1a1a1-0000-4000-8000-000000000001',
    name: 'Migrasi Server Internal',
    description: 'Memindahkan layanan internal dari server fisik ke infrastruktur cloud.',
    status: 'active',
    priority: 'high',
    startDate: '2026-10-01',
    dueDate: '2026-12-15',
  },
  beta: {
    id: 'b2b2b2b2-0000-4000-8000-000000000002',
    name: 'Portal Helpdesk IT',
    description: 'Portal tiket untuk permintaan bantuan IT seluruh divisi.',
    status: 'planning',
    priority: 'medium',
    startDate: '2026-11-01',
    dueDate: '2027-02-28',
  },
} as const

export type DemoProjectKey = keyof typeof DEMO_PROJECTS

/** Keanggotaan AWAL (sebelum langkah "perubahan" di bawah). */
export const DEMO_MEMBERSHIPS: readonly { project: DemoProjectKey; user: DemoUserKey; role: ProjectRole }[] = [
  { project: 'alpha', user: 'rina', role: 'owner' },
  { project: 'alpha', user: 'budi', role: 'member' },
  { project: 'alpha', user: 'citra', role: 'member' },
  { project: 'alpha', user: 'dewi', role: 'member' },
  { project: 'alpha', user: 'fajar', role: 'member' },
  { project: 'beta', user: 'eko', role: 'owner' },
  { project: 'beta', user: 'rina', role: 'member' },
  { project: 'beta', user: 'budi', role: 'viewer' },
]

export interface DemoTask {
  key: string
  id: string
  project: DemoProjectKey
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  createdBy: DemoUserKey
  assignee: DemoUserKey | null
  dueDate: string | null
}

export const DEMO_TASKS: readonly DemoTask[] = [
  { key: 'T1', id: 'c3c3c3c3-0000-4000-8000-000000000001', project: 'alpha', title: 'Inventaris server lama', description: 'Catat spesifikasi, layanan, dan pemilik tiap server.', status: 'in_progress', priority: 'high', createdBy: 'rina', assignee: 'budi', dueDate: '2026-10-25' },
  { key: 'T2', id: 'c3c3c3c3-0000-4000-8000-000000000002', project: 'alpha', title: 'Konfigurasi backup harian', description: 'Backup database & file share ke object storage.', status: 'todo', priority: 'high', createdBy: 'budi', assignee: 'citra', dueDate: '2026-11-05' },
  { key: 'T3', id: 'c3c3c3c3-0000-4000-8000-000000000003', project: 'alpha', title: 'Dokumentasi topologi jaringan', description: 'Diagram jaringan kantor pusat dan cabang.', status: 'review', priority: 'medium', createdBy: 'dewi', assignee: 'dewi', dueDate: '2026-10-30' },
  { key: 'T4', id: 'c3c3c3c3-0000-4000-8000-000000000004', project: 'alpha', title: 'Uji failover database', description: 'Simulasi primary mati dan ukur waktu pemulihan.', status: 'todo', priority: 'critical', createdBy: 'citra', assignee: 'fajar', dueDate: '2026-11-20' },
  { key: 'T5', id: 'c3c3c3c3-0000-4000-8000-000000000005', project: 'alpha', title: 'Daftar kebutuhan migrasi', description: 'Kumpulkan kebutuhan dari tiap divisi.', status: 'done', priority: 'medium', createdBy: 'rina', assignee: 'citra', dueDate: '2026-10-10' },
  { key: 'T6', id: 'c3c3c3c3-0000-4000-8000-000000000006', project: 'beta', title: 'Rancang alur tiket helpdesk', description: 'Alur dari tiket masuk sampai selesai, termasuk eskalasi.', status: 'todo', priority: 'medium', createdBy: 'eko', assignee: 'rina', dueDate: '2026-11-15' },
  { key: 'T7', id: 'c3c3c3c3-0000-4000-8000-000000000007', project: 'beta', title: 'Bandingkan platform helpdesk', description: 'Shortlist 3 platform beserta estimasi biaya.', status: 'todo', priority: 'low', createdBy: 'rina', assignee: null, dueDate: null },
]

/** Perubahan setelah data awal dibuat — meniru kejadian nyata. */
export const DEMO_CHANGES = {
  demoteToViewer: { project: 'alpha' as DemoProjectKey, user: 'dewi' as DemoUserKey },
  deactivate: 'fajar' as DemoUserKey,
}

export function demoEmail(localPart: string, domain: string): string {
  return `${localPart}@${domain}`
}
