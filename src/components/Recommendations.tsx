import { t } from '../i18n'
import { Check, Loader2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { aniListRecommendations, getTmdbDetails, searchAniList, tmdbRecommendations, type SearchResult } from '../lib/catalogApi'
import { remotePosterToLocal } from '../lib/image'
import { normalizeText } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput, MediaItem } from '../types'
import Poster from './Poster'
import { LinkArrow, SectionTitle } from './ui'

// Cache en mémoire le temps de la session (évite de refaire les requêtes)
const cache = new Map<string, SearchResult[]>()

const isLoved = (i: MediaItem) =>
  (i.status === 'termine' || i.status === 'en_cours') && !!i.externalId && (!!i.top || i.favorite || (i.rating ?? 0) >= 8)

async function recommendationsFor(seed: MediaItem, tmdbKey?: string): Promise<SearchResult[]> {
  const ext = seed.externalId!
  if (cache.has(seed.id)) return cache.get(seed.id)!
  let recs: SearchResult[] = []
  if (ext.startsWith('anilist:')) recs = await aniListRecommendations(ext)
  else if (tmdbKey) recs = await tmdbRecommendations(ext, tmdbKey)
  else if (seed.type === 'anime') {
    // Sans clé TMDB : on retrouve l'anime sur AniList par son titre
    const found = (await searchAniList(seed.originalTitle || seed.title))[0]
    if (found) recs = await aniListRecommendations(found.externalId)
  }
  cache.set(seed.id, recs)
  return recs
}

/** « Si tu as aimé X » : suggestions à partir de mes titres préférés, ajoutables en un clic. */
export default function Recommendations() {
  const { items, settings, add } = useMedia()
  const hasKey = !!settings.tmdbKey?.trim()

  // Titres « graines » : mes préférés, dans un ordre aléatoire fixé pour la session
  const seeds = useMemo(() => {
    const loved = items.filter((i) => isLoved(i) && (hasKey || i.externalId!.startsWith('anilist:') || i.type === 'anime'))
    return loved.map((i) => ({ i, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, hasKey])

  const [index, setIndex] = useState(0)
  const [recs, setRecs] = useState<SearchResult[]>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const seed = seeds.length ? seeds[index % seeds.length] : undefined
  // Déjà dans ma bibliothèque : même identifiant, ou même titre (les fiches importées viennent parfois d'une autre base)
  const owned = useMemo(() => new Set(items.map((i) => i.externalId).filter(Boolean)), [items])
  const ownedTitles = useMemo(
    () => new Set(items.flatMap((i) => [i.title, i.originalTitle]).filter((s): s is string => !!s).map(normalizeText)),
    [items],
  )

  useEffect(() => {
    if (!seed || !navigator.onLine) return
    let alive = true
    setRecs(undefined)
    setError(undefined)
    recommendationsFor(seed, settings.tmdbKey)
      .then((r) => alive && setRecs(r))
      .catch(() => alive && setError(t('reco.error')))
    return () => {
      alive = false
    }
  }, [seed, settings.tmdbKey])

  if (!seed) {
    if (!hasKey && items.some((i) => (i.rating ?? 0) >= 8))
      return (
        <>
          <SectionTitle>{t('reco.title')}</SectionTitle>
          <p className="text-sm text-ink-3">{t('reco.needKey')}</p>
        </>
      )
    return null
  }

  const visible = (recs ?? [])
    .filter(
      (r) =>
        added.has(r.externalId) ||
        (!owned.has(r.externalId) && !ownedTitles.has(normalizeText(r.title)) && !(r.originalTitle && ownedTitles.has(normalizeText(r.originalTitle)))),
    )
    .slice(0, 10)

  const addToWatchlist = async (r: SearchResult) => {
    setBusy(r.externalId)
    try {
      const data = r.source === 'tmdb' ? await getTmdbDetails(r, settings.tmdbKey!) : { ...r.prefill }
      const poster = r.posterUrl ? (r.source === 'tmdb' ? await remotePosterToLocal(r.posterUrl) : r.posterUrl) : undefined
      const input: MediaInput = {
        title: r.title,
        type: r.typeGuess,
        status: 'a_voir',
        criteria: {},
        episodesWatched: 0,
        genres: [],
        ...data,
        poster,
      }
      await add(input)
      setAdded((s) => new Set(s).add(r.externalId))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <SectionTitle action={seeds.length > 1 ? <LinkArrow onClick={() => setIndex((i) => i + 1)}>{t('reco.other')}</LinkArrow> : undefined}>
        {t('reco.ifYouLiked')} <span className="normal-case tracking-normal text-accent">{seed.title}</span>
      </SectionTitle>

      {error ? (
        <p className="text-sm text-ink-3">{error}</p>
      ) : !recs ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 size={14} className="animate-spin" /> {t('reco.loading')}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ink-3">{t('reco.none')}</p>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {visible.map((r) => {
            const done = added.has(r.externalId)
            return (
              <div key={r.externalId} className="w-28 shrink-0">
                <div className="relative">
                  <Poster src={r.posterUrl ?? r.thumb} title={r.title} />
                  <button
                    onClick={() => addToWatchlist(r)}
                    disabled={done || !!busy}
                    className="absolute bottom-2 end-2 flex h-8 items-center gap-1 rounded-full bg-accent-fill px-2.5 text-xs font-semibold text-on-accent transition active:scale-90 disabled:opacity-90"
                    aria-label={done ? t('reco.added', { title: r.title }) : t('reco.addLabel', { title: r.title })}
                  >
                    {busy === r.externalId ? <Loader2 size={13} className="animate-spin" /> : done ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
                    {done ? t('reco.addedShort') : t('status.a_voir')}
                  </button>
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-ink-2">{r.title}</p>
                <p className="text-[11px] text-ink-3">{[r.kindLabel, r.year].filter(Boolean).join(' · ')}</p>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
