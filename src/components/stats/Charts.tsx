import type { ReactNode } from 'react'
import { cx } from '../../lib/utils'

/**
 * Petites briques de graphiques, sans bibliothèque.
 * Une seule série par graphique → une seule couleur (l'accent du thème), valeurs écrites en encre (jamais en couleur),
 * grille et axes discrets, survol / focus qui affiche la valeur exacte.
 */

/** Grand chiffre + libellé (pas besoin d'un graphique pour une seule valeur). */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tracking-tight lg:text-3xl">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-ink-2">{hint}</p>}
    </div>
  )
}

/** Barres horizontales triées (classements : genres, pays, types…). Valeur écrite au bout de chaque barre. */
export function BarList({ rows, format = String }: { rows: { key: string; label: ReactNode; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-2">
              {format(r.value)}
              {r.sub && <span className="ms-1.5 text-xs text-ink-3">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-2 rounded-full bg-accent-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Colonnes verticales (évolution dans le temps, répartition des notes).
 * Chaque colonne est focalisable : survol / clavier → bulle avec la valeur exacte.
 */
export function Columns({
  bars,
  height = 140,
  label,
}: {
  bars: { key: string; axis: string; value: number; tip: string; highlight?: boolean }[]
  height?: number
  /** Nom du graphique (lecteurs d'écran) */
  label: string
}) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <figure aria-label={label}>
      <div className="relative flex items-end gap-[2px] border-b border-line" style={{ height }}>
        {/* Repère discret à mi-hauteur */}
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: height / 2 }} aria-hidden="true" />
        {bars.map((b) => (
          <div key={b.key} tabIndex={0} aria-label={b.tip} className="group relative flex h-full flex-1 items-end justify-center outline-none">
            <div
              className={cx('w-full max-w-9 rounded-t-[4px] transition-opacity', b.value > 0 ? 'bg-accent-fill' : 'bg-transparent', !b.highlight && 'opacity-80 group-hover:opacity-100 group-focus-visible:opacity-100')}
              style={{ height: b.value > 0 ? `${Math.max(3, (b.value / max) * 100)}%` : 0 }}
            />
            <span className="pointer-events-none absolute bottom-full z-10 mb-1.5 hidden whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink shadow-sm group-hover:block group-focus-visible:block">
              {b.tip}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.key} className={cx('flex-1 truncate text-center text-[10px] text-ink-3', b.highlight && 'font-semibold text-ink')}>
            {b.axis}
          </span>
        ))}
      </div>
    </figure>
  )
}

/** Bloc titré de la page. */
export function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card p-4 lg:p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="eyebrow text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
