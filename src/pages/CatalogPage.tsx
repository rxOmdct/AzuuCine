import { genreLabel, subtypeLabel } from '../lib/genres'
import { locale, t } from '../i18n'
import { Heart, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { StatusDot } from '../components/Badges'
import JournalView from '../components/JournalView'
import ListsView from '../components/ListsView'
import { MediaCard } from '../components/MediaCard'
import { EmptyState, PageHeader } from '../components/ui'
import { MEDIA_TYPES, STATUSES } from '../lib/constants'
import { cx, normalizeText } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem, MediaType, WatchStatus } from '../types'

type SortKey = 'recent' | 'rating' | 'title' | 'watched'

const SORTS: { value: SortKey; readonly label: string }[] = [
  { value: 'recent', get label() { return t('catalog.sortRecent') } },
  { value: 'watched', get label() { return t('catalog.sortWatched') } },
  { value: 'rating', get label() { return t('catalog.sortRating') } },
  { value: 'title', get label() { return t('catalog.sortTitle') } },
]

interface Props {
  onOpen: (item: MediaItem) => void
  onAdd: () => void
}

export default function CatalogPage({ onOpen, onAdd }: Props) {
  const { items, settings, lists } = useMedia()
  const [view, setView] = useState<'titles' | 'journal' | 'lists'>('titles')
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<Set<MediaType>>(new Set())
  const [status, setStatus] = useState<WatchStatus | ''>('')
  const [genre, setGenre] = useState('')
  const [minRating, setMinRating] = useState(0)
  const [favOnly, setFavOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('recent')
  const [showFilters, setShowFilters] = useState(false)

  const allGenres = useMemo(
    () => [...new Set(items.flatMap((i) => i.genres))].sort((a, b) => a.localeCompare(b, locale())),
    [items],
  )

  const toggleType = (t: MediaType) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const results = useMemo(() => {
    const q = normalizeText(query)
    const filtered = items.filter((i) => {
      if (types.size && !types.has(i.type)) return false
      if (status && i.status !== status) return false
      if (genre && !i.genres.includes(genre)) return false
      if (minRating && (i.rating ?? 0) < minRating) return false
      if (favOnly && !i.favorite) return false
      if (q) {
        const haystack = normalizeText([i.title, i.originalTitle, i.subtype, i.subtype && subtypeLabel(i.subtype), i.platform, ...i.genres, ...i.genres.map(genreLabel)].filter(Boolean).join(' '))
        if (!haystack.includes(q)) return false
      }
      return true
    })
    const sorted = [...filtered]
    if (sort === 'rating') sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, locale()))
    else if (sort === 'watched')
      sorted.sort((a, b) => (b.endDate ?? b.startDate ?? '').localeCompare(a.endDate ?? a.startDate ?? ''))
    return sorted
  }, [items, query, types, status, genre, minRating, favOnly, sort])

  const activeAdvanced = (genre ? 1 : 0) + (minRating ? 1 : 0) + (favOnly ? 1 : 0)
  const anyFilter = query || types.size || status || activeAdvanced
  const resetAll = () => {
    setQuery('')
    setTypes(new Set())
    setStatus('')
    setGenre('')
    setMinRating(0)
    setFavOnly(false)
  }

  // Options de note minimale selon l'échelle affichée (valeurs internes sur 10)
  const ratingOptions = settings.ratingScale === '5' ? [2, 4, 6, 8, 9, 10] : [5, 6, 7, 8, 9, 10]

  return (
    <>
      <PageHeader
        title={t('catalog.pageTitle')}
        accent={t('catalog.pageAccent')}
        subtitle={
          view === 'journal'
            ? t('catalog.journalSubtitle')
            : view === 'lists'
              ? t('account.nLists', { count: lists.length })
              : anyFilter
                ? t('catalog.filteredCount', { count: results.length })
                : t('account.nTitles', { count: results.length })
        }
      />
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-full border border-line p-1">
        {(['titles', 'journal', 'lists'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cx('rounded-full py-2 text-sm font-medium transition-colors', view === v ? 'bg-ink text-bg' : 'text-ink-3')}
          >
            {v === 'titles' ? t('catalog.titles') : v === 'journal' ? t('catalog.journal') : t('catalog.lists')}
          </button>
        ))}
      </div>

      {view === 'journal' ? (
        <JournalView onOpen={onOpen} />
      ) : view === 'lists' ? (
        <ListsView onOpen={onOpen} />
      ) : (
        <>

      {/* Recherche + filtres (collants en haut) */}
      <div className="sticky top-0 z-20 -mx-4 space-y-3 bg-bg/90 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('catalog.searchPh')}
              className="field ps-10"
              enterKeyHint="search"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cx('relative grid w-12 place-items-center rounded-xl border border-line bg-surface transition-colors', showFilters && 'border-ink text-ink')}
            aria-label={t('catalog.moreFilters')}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={18} />
            {activeAdvanced > 0 && (
              <span className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-accent-fill text-[10px] text-on-accent">{activeAdvanced}</span>
            )}
          </button>
        </div>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <button onClick={() => setTypes(new Set())} className={cx('chip', types.size === 0 && 'chip-on')}>
            {t('catalog.all')}
          </button>
          {MEDIA_TYPES.map((mt) => (
            <button key={mt.value} onClick={() => toggleType(mt.value)} className={cx('chip', types.has(mt.value) && 'chip-on')}>
              {mt.label}
            </button>
          ))}
        </div>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {STATUSES.map((s) => (
            <button key={s.value} onClick={() => setStatus(status === s.value ? '' : s.value)} className={cx('chip text-xs', status === s.value && 'chip-on')}>
              <StatusDot status={s.value} />
              {s.label}
            </button>
          ))}
        </div>

        {showFilters && (
          <div className="card grid grid-cols-2 gap-3 p-3">
            <label className="block">
              <span className="label">{t('catalog.genre')}</span>
              <select className="field" value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">{t('catalog.all')}</option>
                {allGenres.map((g) => (
                  <option key={g} value={g}>
                    {genreLabel(g)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{t('catalog.minRating')}</span>
              <select className="field" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
                <option value={0}>{t('catalog.allRatings')}</option>
                {ratingOptions.map((r) => (
                  <option key={r} value={r}>
                    ≥ {settings.ratingScale === '5' ? r / 2 : r}/{settings.ratingScale}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block">
              <span className="label">{t('catalog.sortBy')}</span>
              <select className="field" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setFavOnly((v) => !v)} className={cx('chip justify-center', favOnly && 'chip-on')}>
              <Heart size={14} className={favOnly ? 'fill-accent-fill text-accent-fill' : ''} /> {t('catalog.favorites')}
            </button>
            <button onClick={resetAll} className="chip justify-center">
              <X size={14} /> {t('catalog.reset')}
            </button>
          </div>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={items.length ? t('catalog.noResults') : t('catalog.nothingYet')}
          text={items.length ? t('catalog.noResultsHint') : t('catalog.nothingYetHint')}
          action={
            items.length ? (
              <button onClick={resetAll} className="btn btn-ghost">{t('catalog.clearFilters')}</button>
            ) : (
              <button onClick={onAdd} className="btn btn-primary">{t('nav.addTitle')}</button>
            )
          }
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3">
          {results.map((item) => (
            <MediaCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
        </>
      )}
    </>
  )
}
