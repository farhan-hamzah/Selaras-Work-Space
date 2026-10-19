import type { ReactNode } from 'react'

interface CardProps {
  title: string
  description?: ReactNode
  aside?: ReactNode
  children: ReactNode
}

export function Card({ title, description, aside, children }: CardProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          {description ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function CardSkeleton({ title, lines = 3 }: { title: string; lines?: number }) {
  return (
    <Card title={title} description="Memuat…">
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </Card>
  )
}
