import type { Enums } from '@/types/database'

export const TASK_STATUS_LABEL: Record<Enums<'task_status'>, string> = {
  todo: 'To do',
  in_progress: 'Dikerjakan',
  review: 'Review',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
}

export const PRIORITY_LABEL: Record<Enums<'priority_level'>, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
}

export const PROJECT_STATUS_LABEL: Record<Enums<'project_status'>, string> = {
  planning: 'Perencanaan',
  active: 'Aktif',
  on_hold: 'Ditunda',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

export const PROJECT_ROLE_LABEL: Record<Enums<'project_member_role'>, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
}

const dateTime = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
})

export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `${dateTime.format(date)} WIB`
}
