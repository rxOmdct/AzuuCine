import { t } from '../i18n'
import type { ReactNode } from 'react'
import { cx } from '../lib/utils'

/** En-tête de page : titre en gras, moitié blanc / moitié rouge. */
export function PageHeader({ title, accent, subtitle, action }: { title: string; accent?: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-5 pt-7">
      <div className="min-w-0">
        <h1 className="text-[1.9rem] leading-tight">
          {title}
          {accent && <span className="text-accent">{accent}</span>}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function StatTile({ label, value, hint, className }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cx('card p-4', className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-bold leading-none tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-ink-3">{hint}</div>}
    </div>
  )
}

/** Titre de section façon Letterboxd : petites capitales grises + filet. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 mt-9 flex items-center justify-between gap-3 border-b border-line pb-2">
      <h2 className="eyebrow text-ink-2">{children}</h2>
      {action}
    </div>
  )
}

export function LinkArrow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="shrink-0 text-xs font-medium text-ink-3 transition-colors hover:text-ink">
      {children} <span className="text-accent">→</span>
    </button>
  )
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card mt-4 flex flex-col items-center px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="mt-2 max-w-xs text-sm text-ink-2">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
