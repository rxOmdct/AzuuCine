import { Check } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { fmtNumber, t } from '../../i18n'
import { formatDay, mediaLabel, periodLabel, quantity, type ChallengeProgress } from '../../lib/challenges'
import { cx } from '../../lib/utils'
import type { Challenge } from '../../types'

/** Anneau de progression (piste discrète, arc à la couleur d'accent). */
export function ProgressRing({ value, size = 56, stroke = 5, done, children, animate = true, label }: { label?: string; value: number; size?: number; stroke?: number; done?: boolean; children?: ReactNode; animate?: boolean }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const target = Math.max(0, Math.min(1, value))
  // L'arc se remplit à l'apparition (sauf mouvement réduit, géré par le CSS de transition)
  const [shown, setShown] = useState(animate ? 0 : target)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(target))
    return () => cancelAnimationFrame(id)
  }, [target])
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          className="text-accent transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        {done ? (
          <span className="grid size-[60%] place-items-center rounded-full bg-accent-fill text-on-accent">
            <Check size={Math.round(size * 0.3)} strokeWidth={3} />
          </span>
        ) : (
          children
        )}
      </span>
    </span>
  )
}

export const percent = (p: ChallengeProgress, c: Challenge) => Math.min(100, Math.floor((p.count / c.target) * 100))

/** « 3 films d'avance », « Réussi le 4 octobre »… */
export function paceText(c: Challenge, p: ChallengeProgress): string {
  if (p.state === 'done') return p.doneAt ? t('challenges.doneOn', { date: formatDay(p.doneAt) }) : t('challenges.done')
  if (p.state === 'missed') return t('challenges.missed')
  if (p.state === 'upcoming') return t('challenges.startsIn', { count: p.startsIn })
  if (p.pace >= 1) return t('challenges.ahead', { what: quantity(Math.floor(p.pace), c.media, c.unit) })
  if (p.pace <= -1) return t('challenges.behind', { what: quantity(Math.floor(-p.pace), c.media, c.unit) })
  return t('challenges.onPace')
}

export function daysText(p: ChallengeProgress): string | null {
  if (p.state !== 'active') return null
  return p.daysLeft === 0 ? t('challenges.lastDay') : t('challenges.daysLeft', { count: p.daysLeft })
}

/** « 12 / 52 films » */
export function CountLine({ c, p, className }: { c: Challenge; p: ChallengeProgress; className?: string }) {
  return (
    <span className={cx('tabular-nums', className)}>
      <span className="font-semibold text-ink">{fmtNumber(p.count)}</span>
      <span className="text-ink-3"> / </span>
      {quantity(c.target, c.media, c.unit)}
    </span>
  )
}

/** Ligne de défi (accueil et liste) : anneau, progression, période, rythme. */
export function ChallengeSummary({ c, p, onClick, ring = 56 }: { c: Challenge; p: ChallengeProgress; onClick: () => void; ring?: number }) {
  const days = daysText(p)
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 p-4 text-start transition-colors active:bg-surface-2">
      <ProgressRing value={p.count / c.target} done={p.done} size={ring} label={t('challenges.progress', { count: p.count, target: c.target })}>
        <span className="text-xs font-semibold tabular-nums text-ink-2">{fmtNumber(percent(p, c) / 100, { style: 'percent' })}</span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        {c.name ? (
          <>
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="mt-0.5 block truncate text-sm text-ink-2">
              <CountLine c={c} p={p} /> <span className="text-ink-3">· {periodLabel(c)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="block truncate">
              <CountLine c={c} p={p} className="text-[15px] text-ink-2" />
              {c.unit === 'episodes' && c.media !== 'all' && <span className="text-sm text-ink-3"> · {mediaLabel(c.media)}</span>}
            </span>
            <span className="mt-0.5 block truncate text-sm text-ink-3">{periodLabel(c)}</span>
          </>
        )}
        <span className="mt-1 block truncate text-xs">
          <span className={cx(p.state === 'done' ? 'font-semibold text-accent' : p.state === 'active' && p.pace >= 1 ? 'font-medium text-ink' : 'text-ink-2')}>{paceText(c, p)}</span>
          {days && <span className="text-ink-3"> · {days}</span>}
        </span>
      </span>
    </button>
  )
}
