import { STATUS_BY_VALUE, TYPE_BY_VALUE } from '../lib/constants'
import { subtypeLabel } from '../lib/genres'
import { cx } from '../lib/utils'
import type { MediaItem, WatchStatus } from '../types'

/** Type du média en petite étiquette sobre (pas de couleur). */
export function TypeBadge({ item, className }: { item: Pick<MediaItem, 'type' | 'subtype'>; className?: string }) {
  const info = TYPE_BY_VALUE[item.type]
  return (
    <span className={cx('inline-flex items-center rounded-full border border-line-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-2', className)}>
      {item.type === 'autre' && item.subtype ? subtypeLabel(item.subtype) : info.label}
    </span>
  )
}

export function StatusDot({ status, className }: { status: WatchStatus; className?: string }) {
  return <span className={cx('inline-block size-1.5 shrink-0 rounded-full', STATUS_BY_VALUE[status].dot, className)} />
}

export function StatusPill({ status }: { status: WatchStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <StatusDot status={status} />
      {STATUS_BY_VALUE[status].label}
    </span>
  )
}
