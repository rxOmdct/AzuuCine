import { locale, t } from '../i18n'
import { Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DEFAULT_FILM_MINUTES, TYPE_BY_VALUE } from '../lib/constants'
import { watchMinutes } from '../lib/stats'
import { cx, formatDuration, formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem } from '../types'
import { TypeBadge } from './Badges'
import Poster from './Poster'
import { EmptyState } from './ui'

type Kind = 'fini' | 'revu' | 'commence' | 'abandonne'

interface Entry {
  date: string
  item: MediaItem
  kind: Kind
  minutes: number
}

const kindLabel = (k: Kind) => (k === 'fini' ? t('status.termine') : k === 'revu' ? t('journal.rewatched') : k === 'commence' ? t('journal.started') : t('status.abandonne'))

/** Toutes les dates de visionnage de la bibliothèque, de la plus récente à la plus ancienne. */
function buildEntries(items: MediaItem[]): Entry[] {
  const out: Entry[] = []
  for (const item of items) {
    if (item.status === 'termine' && item.endDate) out.push({ date: item.endDate, item, kind: 'fini', minutes: watchMinutes(item) - rewatchMinutes(item) })
    else if ((item.status === 'en_cours' || item.status === 'pause') && item.startDate) out.push({ date: item.startDate, item, kind: 'commence', minutes: 0 })
    else if (item.status === 'abandonne' && (item.endDate || item.startDate)) out.push({ date: (item.endDate || item.startDate)!, item, kind: 'abandonne', minutes: 0 })
    for (const d of item.rewatchDates ?? []) out.push({ date: d, item, kind: 'revu', minutes: TYPE_BY_VALUE[item.type].episodic ? 0 : item.duration || DEFAULT_FILM_MINUTES })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.item.title.localeCompare(b.item.title, locale()))
}

const rewatchMinutes = (i: MediaItem) => (TYPE_BY_VALUE[i.type].episodic ? 0 : (i.rewatchDates?.length ?? 0) * (i.duration || DEFAULT_FILM_MINUTES))

/** Onglet « Journal » du catalogue : chronologie groupée par mois. */
export default function JournalView({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, settings } = useMedia()
  const entries = useMemo(() => buildEntries(items), [items])
  const years = useMemo(() => [...new Set(entries.map((e) => e.date.slice(0, 4)))], [entries])
  const [year, setYear] = useState('')
  const [shown, setShown] = useState(6)

  const months = useMemo(() => {
    const list = year ? entries.filter((e) => e.date.startsWith(year)) : entries
    const map = new Map<string, Entry[]>()
    for (const e of list) map.set(e.date.slice(0, 7), [...(map.get(e.date.slice(0, 7)) ?? []), e])
    return [...map.entries()]
  }, [entries, year])

  if (!entries.length) {
    return <EmptyState title={t('journal.emptyTitle')} text={t('journal.emptyText')} />
  }

  return (
    <div className="mt-2">
      <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
        {['', ...years].map((y) => (
          <button
            key={y || 'all'}
            onClick={() => {
              setYear(y)
              setShown(6)
            }}
            className={cx('chip py-1! text-[13px]', year === y && 'chip-on')}
          >
            {y || t('common.all')}
          </button>
        ))}
      </div>

      {months.slice(0, shown).map(([key, list]) => {
        const label = new Date(key + '-15T12:00:00').toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
        const minutes = list.reduce((s, e) => s + e.minutes, 0)
        const finished = list.filter((e) => e.kind === 'fini' || e.kind === 'revu').length
        return (
          <section key={key} className="mt-7">
            <div className="mb-1 flex items-baseline justify-between border-b border-line pb-2">
              <h3 className="text-lg font-bold capitalize">{label}</h3>
              <span className="text-xs text-ink-3">
                {t('journal.seen', { count: finished })}
                {minutes > 0 && ` · ${formatDuration(minutes)}`}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((e) => {
                const d = new Date(e.date + 'T12:00:00')
                return (
                  <li key={e.item.id + e.date + e.kind}>
                    <button onClick={() => onOpen(e.item)} className="flex w-full items-center gap-3 py-2.5 text-start">
                      <span className="w-9 shrink-0 text-center">
                        <span className="block text-xl font-bold leading-none tabular-nums">{d.getDate()}</span>
                        <span className="block text-[10px] uppercase text-ink-3">{d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '')}</span>
                      </span>
                      <div className="w-10 shrink-0">
                        <Poster src={e.item.poster} title={e.item.title} />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{e.item.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <TypeBadge item={e.item} />
                          {e.kind !== 'fini' && (
                            <span className={cx('text-[11px] font-semibold', e.kind === 'revu' ? 'text-accent' : 'text-ink-3')}>{kindLabel(e.kind)}</span>
                          )}
                        </span>
                      </span>
                      {e.item.rating ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                          <Star size={12} className="fill-accent text-accent" />
                          {formatRating(e.item.rating, settings.ratingScale)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {months.length > shown && (
        <button onClick={() => setShown((n) => n + 6)} className="btn btn-ghost mt-6 w-full">
          {t('journal.more')}
        </button>
      )}
    </div>
  )
}
