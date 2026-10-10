import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { locale, t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { MEDIA_TYPES, TYPE_BY_VALUE } from '../../lib/constants'
import { approxPatch, bulkDays, dateQuality, endLabel, needsFix, type DateQuality } from '../../lib/dating'
import { useEscape } from '../../lib/escape'
import { useScrollLock } from '../../lib/scrollLock'
import { cx, formatDate } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem, MediaType } from '../../types'
import Poster from '../Poster'

type Tab = 'fix' | 'approx'

/**
 * « Dates à corriger » : les titres terminés dont la date de fin est celle d'un ajout en lot (ou absente).
 * On en sélectionne plusieurs et on leur donne une année (et un mois si on s'en souvient), ou « je ne sais plus ».
 */
export default function DatesSheet({ onClose }: { onClose: () => void }) {
  const { items, updateMany } = useMedia()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)

  // Les jours d'ajout en lot sont figés à l'ouverture : corriger une partie des titres ne fait pas « disparaître » le lot
  const [bulk] = useState(() => bulkDays(items))
  const [tab, setTab] = useState<Tab>('fix')
  const [type, setType] = useState<MediaType | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [busy, setBusy] = useState(false)

  const all = useMemo(
    () =>
      items
        .filter((i) => i.status === 'termine')
        .map((i) => ({ item: i, q: dateQuality(i, bulk) }))
        .filter(({ q }) => q !== 'exact'),
    [items, bulk],
  )
  const toFix = all.filter(({ q }) => needsFix(q))
  const approx = all.filter(({ q }) => !needsFix(q))
  const pool = tab === 'fix' ? toFix : approx
  const types = MEDIA_TYPES.filter((m) => pool.some(({ item }) => item.type === m.value))
  // Filtre devenu vide (tous ses titres corrigés) : on revient à « Tout »
  const activeType = type && types.some((m) => m.value === type) ? type : ''
  const list = pool.filter(({ item }) => !activeType || item.type === activeType).sort((a, b) => a.item.title.localeCompare(b.item.title, locale()))

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allOn = list.length > 0 && list.every(({ item }) => selected.has(item.id))

  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: thisYear - 1949 }, (_, k) => thisYear - k)
  const months = Array.from({ length: 12 }, (_, k) => k + 1).filter((m) => Number(year) !== thisYear || m <= new Date().getMonth() + 1)
  const monthName = (m: number) => new Date(2000, m - 1, 15).toLocaleDateString(locale(), { month: 'long' })

  const apply = async (choice: { year: number; month?: number } | 'unknown') => {
    const chosen = items.filter((i) => selected.has(i.id))
    if (!chosen.length) return
    setBusy(true)
    try {
      await updateMany(chosen.map((i) => ({ id: i.id, patch: approxPatch(i, choice) })))
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  const statusText = (item: MediaItem, q: DateQuality) =>
    q === 'bulk' ? t('dates.bulk', { date: formatDate(item.endDate) }) : q === 'missing' ? t('dates.missing') : endLabel(item)

  return (
    <div className="sheet sheet-in" role="dialog" aria-modal="true" aria-label={t('dates.title')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto max-w-2xl px-3 pb-3 pt-2.5 lg:max-w-none lg:px-10">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
              <X size={22} />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{t('dates.title')}</h2>
            <span className="size-10 shrink-0" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-full border border-line p-1" role="tablist">
            {(['fix', 'approx'] as const).map((x) => (
              <button
                key={x}
                role="tab"
                aria-selected={tab === x}
                onClick={() => {
                  setTab(x)
                  setType('')
                  setSelected(new Set())
                }}
                className={cx('rounded-full py-2 text-sm font-medium transition-colors', tab === x ? 'bg-ink text-bg' : 'text-ink-3')}
              >
                {x === 'fix' ? t('dates.tabFix') : t('dates.tabApprox')} <span className="opacity-60">{x === 'fix' ? toFix.length : approx.length}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(16rem+env(safe-area-inset-bottom))] pt-4 lg:max-w-none lg:px-10">
          {tab === 'fix' && toFix.length > 0 && <p className="text-sm leading-relaxed text-ink-2">{t('dates.hint')}</p>}

          {list.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={() => setType('')} className={cx('chip', !activeType && 'chip-on')}>
                {t('search.tabAll')}
              </button>
              {types.length > 1 &&
                types.map((m) => (
                  <button key={m.value} onClick={() => setType(m.value)} className={cx('chip', activeType === m.value && 'chip-on')}>
                    {TYPE_BY_VALUE[m.value].label}
                  </button>
                ))}
              <button
                onClick={() => setSelected(allOn ? new Set() : new Set(list.map(({ item }) => item.id)))}
                className="ms-auto text-sm font-medium text-ink-2"
              >
                {allOn ? t('dates.selectNone') : t('dates.selectAll')}
              </button>
            </div>
          )}

          {list.length === 0 ? (
            <p className="mt-12 text-center text-sm text-ink-3">{tab === 'fix' ? t('dates.empty') : t('dates.emptyApprox')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 xl:grid-cols-3">
              {list.map(({ item, q }) => {
                const on = selected.has(item.id)
                return (
                  <li key={item.id} className="lg:border-b lg:border-line">
                    <button onClick={() => toggle(item.id)} aria-pressed={on} className="flex w-full items-center gap-3 py-2.5 text-start">
                      <span className={cx('grid size-6 shrink-0 place-items-center rounded-md border', on ? 'border-accent bg-accent-fill text-on-accent' : 'border-line-strong')}>
                        {on && <Check size={15} strokeWidth={2.6} />}
                      </span>
                      <span className="w-10 shrink-0">
                        <Poster src={item.poster} title={item.title} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="block truncate text-xs text-ink-3">{[item.year, TYPE_BY_VALUE[item.type].label].filter(Boolean).join(' · ')}</span>
                        <span className={cx('block truncate text-xs', needsFix(q) ? 'text-accent' : 'text-ink-2')}>{statusText(item, q)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Barre d'action : apparaît dès qu'un titre est sélectionné */}
      {selected.size > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 backdrop-blur-md">
          <div className="mx-auto max-w-2xl space-y-2.5 px-4 py-3 lg:max-w-3xl">
            <p className="text-sm font-medium">{t('dates.selected', { count: selected.size })}</p>
            <div className="flex gap-2">
              <select value={year} onChange={(e) => setYear(e.target.value)} className="field min-w-0 flex-1 py-2 text-sm" aria-label={t('dates.yearPh')}>
                <option value="">{t('dates.yearPh')}</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year} className="field min-w-0 flex-1 py-2 text-sm" aria-label={t('dates.monthPh')}>
                <option value="">{t('dates.monthPh')}</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void apply('unknown')} disabled={busy} className="btn btn-ghost py-2.5 text-sm">
                {t('dates.dunno')}
              </button>
              <button
                onClick={() => void apply({ year: Number(year), month: month && months.includes(Number(month)) ? Number(month) : undefined })}
                disabled={busy || !year}
                className="btn btn-primary py-2.5 text-sm"
              >
                {t('dates.apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
