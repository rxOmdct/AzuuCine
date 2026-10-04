import { t } from '../i18n'
import { Check, Loader2, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getTmdbDetails, searchAll, type SearchResult } from '../lib/catalogApi'
import { findFranchiseItem } from '../lib/franchise'
import { remotePosterToLocal } from '../lib/image'
import { cx } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput, MediaItem } from '../types'

interface Props {
  /** Reçoit les métadonnées trouvées (titre, type, genres, épisodes, affiche…). */
  onPick: (data: Partial<MediaInput>) => void
  initialQuery?: string
  /** Identifiant externe de la fiche en cours d'édition (pour ne pas la signaler comme doublon). */
  currentExternalId?: string
  onGoToSettings?: () => void
  /** Nouvelle fiche : si le titre (ou une autre saison) est déjà dans la bibliothèque, on ouvre la fiche existante. */
  onOpenExisting?: (item: MediaItem) => void
}

/** Recherche un titre (films, séries et animes en une seule fois) et remplit la fiche automatiquement. */
export default function DatabaseSearch({ onPick, initialQuery = '', currentExternalId, onGoToSettings, onOpenExisting }: Props) {
  const { items, settings } = useMedia()
  const hasKey = !!settings.tmdbKey?.trim()
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState<string>()
  const [error, setError] = useState<string>()
  const requestId = useRef(0)

  const others = items.filter((i) => !currentExternalId || i.externalId !== currentExternalId)
  /** Déjà dans ma bibliothèque : même référence, ou une autre saison de la même série. */
  const inLibrary = (r: SearchResult) =>
    others.find((i) => i.externalId === r.externalId) ??
    findFranchiseItem(others, [r.title, r.originalTitle, ...(r.altTitles ?? [])], { type: r.typeGuess })

  // Recherche avec un petit délai pendant la frappe
  useEffect(() => {
    const q = query.trim()
    // Toute réponse d'une recherche précédente devient caduque
    const id = ++requestId.current
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
        if (id === requestId.current) setResults(res)
      } catch (e) {
        if (id === requestId.current) {
          setResults([])
          setError(navigator.onLine ? (e as Error).message : t('search.offline'))
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [query, hasKey, settings.tmdbKey])

  const pick = async (r: SearchResult) => {
    const mine = onOpenExisting && inLibrary(r)
    if (mine) return onOpenExisting(mine)
    setPicking(r.externalId)
    setError(undefined)
    try {
      const data = r.source === 'tmdb' ? await getTmdbDetails(r, settings.tmdbKey!) : { ...r.prefill }
      // TMDB autorise la copie locale de l'affiche (visible hors-ligne) ; AniList non, on garde l'URL.
      if (r.posterUrl) data.poster = r.source === 'tmdb' ? await remotePosterToLocal(r.posterUrl) : r.posterUrl
      onPick(data)
      setResults([])
      setQuery('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPicking(undefined)
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="eyebrow">{t('search.fillFrom')}</span>
        <span className="text-[11px] text-ink-3">{t('search.allKinds')}</span>
      </div>

      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Parasite, Frieren, Crash Landing on You…"
          className="field pl-10"
          enterKeyHint="search"
          autoComplete="off"
        />
        {loading && <Loader2 size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />}
      </div>

      {!hasKey && (
        <div className="mt-2 text-xs text-ink-3">
          {t('search.animeOnly')}
          {onGoToSettings && (
            <button type="button" onClick={onGoToSettings} className="ml-1 font-medium text-ink">
              {t('search.openSettings')} <span className="text-accent">→</span>
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {results.length > 0 && (
        <ul className="-mx-1 mt-3 max-h-[22rem] divide-y divide-line overflow-y-auto overscroll-contain">
          {results.map((r) => {
            const mine = inLibrary(r)
            const already = !!mine
            return (
              <li key={r.externalId}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  disabled={!!picking}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors active:bg-surface-2 disabled:opacity-60"
                >
                  {r.thumb ? (
                    <img src={r.thumb} alt="" loading="lazy" className="h-[4.2rem] w-11 shrink-0 rounded-md border border-line object-cover" />
                  ) : (
                    <span className="grid h-[4.2rem] w-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-ink-3">
                      {r.title.charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    {r.originalTitle && <span className="block truncate text-xs text-ink-3">{r.originalTitle}</span>}
                    <span className="mt-1 block text-[10.5px] uppercase text-ink-3">
                      {[r.kindLabel, r.year].filter(Boolean).join(' · ')}
                      {already && <span className="text-accent"> · {mine.externalId === r.externalId ? t('search.already') : t('search.alreadySeries')}</span>}
                    </span>
                  </span>
                  {picking === r.externalId ? (
                    <Loader2 size={18} className="shrink-0 animate-spin text-ink-3" />
                  ) : (
                    <span className="shrink-0 text-accent">→</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-3 text-sm text-ink-3">{t('search.noResults')}</p>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
        <Check size={12} className="mt-0.5 shrink-0" />
        {t('search.privacy', { source: hasKey ? 'TMDB / AniList' : 'AniList' })}
      </p>
    </div>
  )
}
