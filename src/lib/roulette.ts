import { formatDuration } from './utils'
import { t } from '../i18n'
import type { MediaItem, MediaType } from '../types'
import { DEFAULT_FILM_MINUTES, MEDIA_TYPES, TYPE_BY_VALUE } from './constants'
import { cleanText, isPlainObject, isSafeId, LIMITS, readStorage } from './security'

/** D'où viennent les titres proposés par la roulette. */
export type RouletteSource = 'a_voir' | 'pause' | 'coups_de_coeur'

/** Temps disponible, en minutes (0 = peu importe). */
export type TimeBudget = 0 | 60 | 90 | 150

export interface RouletteFilters {
  sources: RouletteSource[]
  /** Listes perso à inclure */
  listIds: string[]
  types: MediaType[] // vide = tous
  time: TimeBudget
  genre: string // '' = tous
  platform: string // '' = toutes
}

export const DEFAULT_FILTERS: RouletteFilters = { sources: ['a_voir'], listIds: [], types: [], time: 0, genre: '', platform: '' }

export const SOURCES: { value: RouletteSource; readonly label: string }[] = [
  { value: 'a_voir', get label() { return t('status.a_voir') } },
  { value: 'pause', get label() { return t('status.pause') } },
  { value: 'coups_de_coeur', get label() { return t('roulette.rewatch') } },
]

export const TIME_OPTIONS: { value: TimeBudget; readonly label: string }[] = [
  { value: 0, get label() { return t('roulette.anyTime') } },
  { value: 60, get label() { return `< ${formatDuration(60)}` } },
  { value: 90, get label() { return `< ${formatDuration(90)}` } },
  { value: 150, get label() { return `< ${formatDuration(150)}` } },
]

const STORAGE_KEY = 'azuucine:roulette'

export function loadFilters(): RouletteFilters {
  const raw = readStorage(STORAGE_KEY, null)
  if (!isPlainObject(raw)) return DEFAULT_FILTERS
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const sources = SOURCES.map((s) => s.value).filter((v) => arr(raw.sources).includes(v))
  const listIds = arr(raw.listIds).filter(isSafeId).slice(0, 100)
  const types = MEDIA_TYPES.map((t) => t.value).filter((v) => arr(raw.types).includes(v))
  const time = TIME_OPTIONS.some((o) => o.value === raw.time) ? (raw.time as TimeBudget) : 0
  return {
    sources: sources.length || listIds.length ? sources : DEFAULT_FILTERS.sources,
    listIds,
    types,
    time,
    genre: cleanText(raw.genre, LIMITS.shortText) ?? '',
    platform: cleanText(raw.platform, LIMITS.shortText) ?? '',
  }
}

export function saveFilters(f: RouletteFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

/** Durée d'une « séance » : le film entier, ou un épisode. */
export function sessionMinutes(item: MediaItem): number {
  if (!TYPE_BY_VALUE[item.type].episodic) return item.duration || DEFAULT_FILM_MINUTES
  return item.episodeDuration || TYPE_BY_VALUE[item.type].episodeMinutes
}

const isLoved = (i: MediaItem) => i.status === 'termine' && (i.favorite || !!i.top || (i.rating ?? 0) >= 8)

/** Titres correspondant aux sources choisies (avant les autres filtres). */
export function sourcePool(items: MediaItem[], sources: RouletteSource[], listIds: string[] = []): MediaItem[] {
  return items.filter(
    (i) =>
      (listIds.length > 0 && !!i.listIds?.some((l) => listIds.includes(l))) ||
      (sources.includes('a_voir') && i.status === 'a_voir') ||
      (sources.includes('pause') && i.status === 'pause') ||
      (sources.includes('coups_de_coeur') && isLoved(i)),
  )
}

export function buildPool(items: MediaItem[], f: RouletteFilters): MediaItem[] {
  return sourcePool(items, f.sources, f.listIds).filter(
    (i) =>
      (!f.types.length || f.types.includes(i.type)) &&
      (!f.time || sessionMinutes(i) <= f.time) &&
      (!f.genre || i.genres.includes(f.genre)) &&
      (!f.platform || i.platform === f.platform),
  )
}

/** Tire un titre au hasard en évitant ceux déjà sortis (sauf s'il n'y a plus le choix). */
export function pickRandom(pool: MediaItem[], avoid: Set<string>): MediaItem | undefined {
  if (!pool.length) return undefined
  const fresh = pool.filter((i) => !avoid.has(i.id))
  const from = fresh.length ? fresh : pool
  return from[Math.floor(Math.random() * from.length)]
}
