import { TYPE_BY_VALUE } from './constants'
import type { MediaItem, MediaType } from '../types'

/**
 * Saisons et « franchises » de séries.
 *
 * TMDB range toutes les saisons d'une série sous une seule fiche ; AniList, lui, crée une entrée par saison
 * (« Black Clover », « Black Clover Season 2 »…). Pour éviter les doublons, on compare les titres
 * débarrassés de leurs marqueurs de saison.
 */

const SEASON_MARKERS = [
  /\b(season|saison|temporada|stagione|staffel|part|partie|cour)\s*\d+\b/g,
  /\b\d+(st|nd|rd|th|e|eme|ème)\s*(season|saison|part)\b/g,
  /\b(the\s+)?(final|last)\s*season\b/g,
  /第\s*\d+\s*(期|シーズン|部)/g,
  /\s(ii|iii|iv|v|vi)$/g,
]

/** « Black Clover Season 2 », « Aoashi 2nd Season » → « blackclover », « aoashi ». */
export function franchiseKey(title: string): string {
  let s = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  for (const re of SEASON_MARKERS) s = s.replace(re, ' ')
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  // « Black Clover 2 » : nombre final isolé (mais « 86 » reste « 86 »)
  const stripped = s.replace(/\s\d{1,2}$/, '').trim()
  return (stripped || s).replace(/\s+/g, '')
}

const episodic = (type: MediaType) => TYPE_BY_VALUE[type]?.episodic ?? false

/** Fiche de ma bibliothèque qui correspond à la même série (n'importe quelle saison). */
export function findFranchiseItem(items: MediaItem[], titles: (string | undefined)[], opts: { type?: MediaType; excludeId?: string } = {}): MediaItem | undefined {
  if (opts.type && !episodic(opts.type)) return undefined
  const keys = new Set(titles.filter((x): x is string => !!x).map(franchiseKey).filter((k) => k.length >= 2))
  if (!keys.size) return undefined
  return items.find(
    (i) => i.id !== opts.excludeId && episodic(i.type) && [i.title, i.originalTitle].some((x) => x && keys.has(franchiseKey(x))),
  )
}

export interface SeasonPosition {
  /** Saison en cours (1 = première) */
  season: number
  /** Épisodes vus dans cette saison */
  episode: number
  /** Nombre d'épisodes de la saison */
  size: number
  /** Épisodes des saisons précédentes */
  before: number
}

/**
 * Où en est-on, saison par saison ? (à partir du nombre total d'épisodes vus)
 * À la fin exacte d'une saison, on reste sur cette saison (« S1 · 24/24 ») : l'épisode suivant fait passer à la S2…
 * sauf si la saison suivante a été choisie (`season`), auquel cas on affiche « S2 · 0/24 ».
 */
export function seasonPosition(item: Pick<MediaItem, 'episodesWatched' | 'seasons' | 'season'>): SeasonPosition | undefined {
  const seasons = item.seasons
  if (!seasons || seasons.length < 2) return undefined
  const chosen = item.season
  if (chosen && chosen >= 2 && chosen <= seasons.length) {
    const start = episodesBeforeSeason(seasons, chosen)
    if (item.episodesWatched === start) return { season: chosen, episode: 0, size: seasons[chosen - 1], before: start }
  }
  let before = 0
  for (let k = 0; k < seasons.length; k++) {
    const size = seasons[k]
    if (item.episodesWatched <= before + size || k === seasons.length - 1) {
      return { season: k + 1, episode: Math.min(size, Math.max(0, item.episodesWatched - before)), size, before }
    }
    before += size
  }
  return undefined
}

/** Nombre d'épisodes vus au début de la saison n (1 = première). */
export const episodesBeforeSeason = (seasons: number[], n: number) => seasons.slice(0, Math.max(0, n - 1)).reduce((a, b) => a + b, 0)

/** Nombre maximum d'épisodes : toutes les saisons connues, sinon le total enregistré. */
export function episodeCap(item: Pick<MediaItem, 'episodesTotal' | 'seasons'>): number | undefined {
  const sum = item.seasons?.reduce((a, b) => a + b, 0) ?? 0
  return Math.max(sum, item.episodesTotal ?? 0) || undefined
}
