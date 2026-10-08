import { Check, Loader2, PenLine, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { useEscape } from '../../lib/escape'
import { searchAll, type SearchResult } from '../../lib/catalogApi'
import { findFranchiseItem } from '../../lib/franchise'
import { useScrollLock } from '../../lib/scrollLock'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'

/**
 * « Ajouter » : on cherche le titre (films, séries et animes en une fois), puis on ouvre sa fiche pour le noter / l'ajouter.
 * Si le titre, ou une autre saison de la même série, est déjà dans la bibliothèque, on ouvre directement ma fiche.
 */
export default function AddTitle({
  onClose,
  onPick,
  onOpenItem,
  onManual,
  onGoToSettings,
}: {
  onClose: () => void
  onPick: (r: SearchResult) => void
  onOpenItem: (item: MediaItem) => void
  onManual: (title: string) => void
  onGoToSettings?: () => void
}) {
  const { items, settings } = useMedia()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)
  const hasKey = !!settings.tmdbKey?.trim()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef(0)
  const inLibrary = (r: SearchResult) =>
    items.find((i) => i.externalId === r.externalId) ?? findFranchiseItem(items, [r.title, r.originalTitle, ...(r.altTitles ?? [])], { type: r.typeGuess })

  useEffect(() => {
    const q = query.trim()
    // Toute réponse d'une recherche précédente devient caduque
    const id = ++request.current
    setError(undefined)
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchAll(q, hasKey ? settings.tmdbKey : undefined)
        if (id === request.current) setResults(res)
      } catch (e) {
        if (id === request.current) {
          setResults([])
          setError(navigator.onLine ? (e as Error).message : t('search.offline'))
        }
      } finally {
        if (id === request.current) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, hasKey, settings.tmdbKey])

  const searched = query.trim().length >= 2

  return (
    <div className="sheet sheet-in" role="dialog" aria-modal="true" aria-label={t('title.addTitle')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto max-w-2xl px-3 pb-3 pt-2.5">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
              <X size={22} />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{t('title.addTitle')}</h2>
            <span className="size-10 shrink-0" />
          </div>
          <div className="relative mt-2">
            <Search size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('title.searchPh')}
              className="field ps-10"
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
            />
            {loading && <Loader2 size={17} className="absolute end-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />}
          </div>
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-2">
          {!hasKey && (
            <div className="mt-4 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-2">
              {t('search.animeOnly')}
              {onGoToSettings && (
                <button onClick={onGoToSettings} className="mt-2 block font-medium text-ink">
                  {t('search.openSettings')} <span className="text-accent">→</span>
                </button>
              )}
            </div>
          )}

          {error && <p className="mt-4 text-sm text-accent">{error}</p>}

          {results.length > 0 && (
            <ul className="divide-y divide-line">
              {results.map((r) => {
                const mine = inLibrary(r)
                return (
                <li key={r.externalId}>
                  <button onClick={() => (mine ? onOpenItem(mine) : onPick(r))} className="flex w-full items-center gap-3 py-3 text-start active:bg-surface">
                    {r.thumb ? (
                      <img src={r.thumb} alt="" loading="lazy" className="h-[5.25rem] w-14 shrink-0 rounded-lg border border-line bg-surface-2 object-cover" />
                    ) : (
                      <span className="grid h-[5.25rem] w-14 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-semibold text-ink-3">{r.title.charAt(0)}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.title}</span>
                      {r.originalTitle && <span className="block truncate text-xs text-ink-3">{r.originalTitle}</span>}
                      <span className="mt-1 block text-[11px] uppercase tracking-wide text-ink-3">{[r.year, r.kindLabel].filter(Boolean).join(' · ')}</span>
                      {mine && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-accent">
                          <Check size={12} /> {t('title.inLibrary')}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-accent">→</span>
                  </button>
                </li>
                )
              })}
            </ul>
          )}

          {!loading && !error && searched && results.length === 0 && <p className="mt-6 text-center text-sm text-ink-3">{t('title.noResults')}</p>}

          {!searched && <p className="mt-8 text-center text-sm text-ink-3">{t('title.searchHint')}</p>}

          <button onClick={() => onManual(query.trim())} className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 text-start">
            <PenLine size={18} className="shrink-0 text-accent" />
            <span>
              <span className="block text-sm font-medium">{t('title.manual')}</span>
              <span className="block text-xs text-ink-3">{t('title.manualHint')}</span>
            </span>
          </button>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-3">{t('search.privacy', { source: hasKey ? 'TMDB / AniList' : 'AniList' })}</p>
        </div>
      </div>
    </div>
  )
}
