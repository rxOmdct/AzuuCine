import { locale, t } from '../i18n'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { TOP_CATEGORIES } from '../lib/constants'
import { cx, formatRating, normalizeText } from '../lib/utils'
import { useMedia } from '../store'
import type { TopCategory } from '../types'
import { TypeBadge } from './Badges'
import Poster from './Poster'
import { useScrollLock } from '../lib/scrollLock'

interface Props {
  category: TopCategory
  onClose: () => void
}

/** Composer son Top 5 : 5 places, ajout depuis la bibliothèque, réordonnancement. */
export default function TopFiveEditor({ category: initialCategory, onClose }: Props) {
  const { items, settings, setTopList } = useMedia()
  const [category, setCategory] = useState(initialCategory)
  const currentIds = (cat: TopCategory) =>
    items
      .filter((i) => i.top?.category === cat)
      .sort((a, b) => a.top!.rank - b.top!.rank)
      .map((i) => i.id)
  const [ids, setIds] = useState<string[]>(() => currentIds(initialCategory))
  const [query, setQuery] = useState('')
  const [allTypes, setAllTypes] = useState(false)
  const [saving, setSaving] = useState(false)
  const catInfo = TOP_CATEGORIES.find((c) => c.value === category)!
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  useScrollLock()

  /** Changer de catégorie enregistre d'abord celle en cours. */
  const switchCategory = async (cat: TopCategory) => {
    if (cat === category) return
    await setTopList(category, ids)
    setCategory(cat)
    setIds(currentIds(cat).filter((id) => !ids.includes(id)))
    setQuery('')
  }

  const candidates = useMemo(() => {
    const q = normalizeText(query)
    return items
      .filter((i) => !ids.includes(i.id))
      .filter((i) => allTypes || q || i.type === category)
      .filter((i) => !q || normalizeText(`${i.title} ${i.originalTitle ?? ''}`).includes(q))
      .sort((a, b) => Number(b.type === category) - Number(a.type === category) || (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title, locale()))
      .slice(0, 60)
  }, [items, ids, query, allTypes, category])

  const move = (index: number, delta: number) =>
    setIds((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const save = async () => {
    setSaving(true)
    await setTopList(category, ids)
    setSaving(false)
    onClose()
  }

  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t('top.editLabel')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">
            Top <span className="text-accent">5</span> · {catInfo.plural}
          </h2>
          <button onClick={save} disabled={saving} className="btn btn-light px-4 py-2 text-sm">
            {t('common.save')}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="safe-bottom mx-auto max-w-2xl space-y-6 px-4 py-5 pb-16">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {TOP_CATEGORIES.filter((c) => c.value === category || settings.topCategories.includes(c.value)).map((c) => (
              <button key={c.value} onClick={() => switchCategory(c.value)} className={cx('chip py-1! text-[13px]', category === c.value && 'chip-on')}>
                {c.plural}
              </button>
            ))}
          </div>

          {/* Les 5 places */}
          <ol className="space-y-2">
            {[0, 1, 2, 3, 4].map((index) => {
              const item = ids[index] ? byId.get(ids[index]) : undefined
              return (
                <li key={index} className={cx('flex items-center gap-3 rounded-2xl border p-2.5', item ? 'border-line bg-surface' : 'border-dashed border-line-strong')}>
                  <span className={cx('w-8 text-center text-3xl font-black', index === 0 ? 'text-accent' : 'text-ink-3')}>{index + 1}</span>
                  {item ? (
                    <>
                      <div className="w-10 shrink-0">
                        <Poster src={item.poster} title={item.title} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-ink-3">
                          {[item.year, item.rating ? `${formatRating(item.rating, settings.ratingScale)}/${settings.ratingScale}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <button onClick={() => move(index, -1)} disabled={index === 0} className="grid size-9 place-items-center text-ink-2 disabled:opacity-20" aria-label={t('common.moveUp')}>
                          <ChevronUp size={18} />
                        </button>
                        <button onClick={() => move(index, 1)} disabled={index >= ids.length - 1} className="grid size-9 place-items-center text-ink-2 disabled:opacity-20" aria-label={t('common.moveDown')}>
                          <ChevronDown size={18} />
                        </button>
                        <button onClick={() => setIds((p) => p.filter((id) => id !== item.id))} className="grid size-9 place-items-center text-ink-3" aria-label={t('common.removeX', { name: item.title })}>
                          <X size={17} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className="py-3 text-sm text-ink-3">{t('top.freeSlot')}</span>
                  )}
                </li>
              )
            })}
          </ol>

          {/* Ajout depuis la bibliothèque */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="eyebrow text-ink-2">{t('top.addFromLibrary')}</h3>
              <button onClick={() => setAllTypes((v) => !v)} className={cx('chip py-0.5! text-xs', allTypes && 'chip-on')}>
                {t('top.allTypes')}
              </button>
            </div>
            <div className="relative mb-2">
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('top.searchTitle')} className="field pl-10" />
            </div>
            {ids.length >= 5 && <p className="py-2 text-xs text-ink-3">{t('top.full')}</p>}
            <ul className="divide-y divide-line">
              {candidates.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => setIds((p) => (p.length < 5 ? [...p, item.id] : p))}
                    disabled={ids.length >= 5}
                    className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-40"
                  >
                    <div className="w-9 shrink-0">
                      <Poster src={item.poster} title={item.title} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                        <TypeBadge item={item} />
                        {item.rating ? `${formatRating(item.rating, settings.ratingScale)}/${settings.ratingScale}` : ''}
                        {item.top && item.top.category !== category && (
                          <span className="text-accent">
                            {t('top.number', { rank: item.top.rank })} {TOP_CATEGORIES.find((c) => c.value === item.top!.category)?.plural}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-accent">+</span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && <li className="py-4 text-sm text-ink-3">{t('top.noCandidates')}</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
