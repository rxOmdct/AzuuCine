import type { MediaItem, MediaType, TopCategory, TopEntry, WatchStatus } from '../types'
import { ALL_TOP_CATEGORIES } from './constants'
import { cleanText, isSafeExternalId, isSafeTmdbPath, LIMITS, safeCountries, safeDay, safeIso, safeStringList } from './security'
import { splitGenres } from './catalogApi'
import { normalizeText } from './utils'

/**
 * Conversion des sauvegardes de l'ancienne appli (format TMDB) :
 * { items: [...], episodes: [...], tags: [...], item_tags: [...], top5: [...] }
 */

interface LegacyItem {
  id: number
  tmdb_id?: number
  media_type?: 'movie' | 'tv' | string
  title?: string
  original_title?: string
  poster_path?: string | null
  overview?: string
  release_date?: string
  note?: number
  comment?: string
  date_added?: string
  runtime?: number
  genres?: string | string[]
  countries?: string | string[]
  status?: string
  director?: string
  number_of_seasons?: number
  number_of_episodes?: number
  watch_date?: string
}

interface LegacyEpisode {
  item_id: number
  season_number?: number
  episode_number?: number
  watched?: number | boolean
  watch_date?: string
}

interface LegacyFile {
  items: LegacyItem[]
  episodes?: LegacyEpisode[]
  tags?: { id: number; name: string }[]
  item_tags?: { item_id: number; tag_id: number }[]
  top5?: { category: string; position: number; item_id: number }[]
}

/** Reconnaît le format de l'ancienne appli. */
export function isLegacyBackup(data: unknown): data is LegacyFile {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const items = (data as LegacyFile).items
  return Array.isArray(items) && items.length > 0 && typeof items[0] === 'object' && items[0] !== null && ('tmdb_id' in items[0] || 'media_type' in items[0] || 'poster_path' in items[0])
}

const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim() && v.length < 20000) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return v.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

/** « 2026-07-26 17:57:29 » ou « 2026-07-29T13:38:42.905588 » → ISO */
const toISO = (v?: string): string | undefined =>
  typeof v === 'string' ? safeIso(v.includes('T') ? v : v.replace(' ', 'T')) : undefined
const toDay = (v?: string) => (typeof v === 'string' ? safeDay(v.slice(0, 10)) : undefined)
const positive = (n?: number, max = 100000) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : undefined)

function mapStatus(raw?: string): WatchStatus {
  const s = normalizeText(typeof raw === 'string' ? raw.slice(0, 40) : '')
  if (s === 'vu' || s.startsWith('termin') || s === 'fini' || s === 'watched') return 'termine'
  if (s.includes('cours') || s === 'watching') return 'en_cours'
  if (s.includes('pause')) return 'pause'
  if (s.includes('aband') || s === 'dropped') return 'abandonne'
  return 'a_voir' // wishlist, à voir…
}

function guessType(kind: string | undefined, countries: string[], genres: string[]): { type: MediaType; subtype?: string } {
  const has = (g: string) => genres.some((x) => x.includes(g))
  if (has('Documentaire')) return { type: 'autre', subtype: 'Documentaire' }
  if (has('Télé-réalité') || has('Reality')) return { type: 'autre', subtype: 'Télé-réalité' }
  if (kind === 'movie') return { type: 'film' }
  const main = countries[0]
  if (has('Animation') && countries.includes('JP')) return { type: 'anime' }
  if (main === 'KR') return { type: 'kdrama' }
  if (main === 'CN' || main === 'TW' || main === 'HK') return { type: 'cdrama' }
  return { type: 'serie' }
}

export function convertLegacyBackup(data: LegacyFile): { items: MediaItem[]; skipped: number } {
  const now = new Date().toISOString()

  // Épisodes vus par fiche
  const eps = new Map<number, LegacyEpisode[]>()
  for (const e of data.episodes ?? []) {
    if (!e || !(e.watched === 1 || e.watched === true)) continue
    const list = eps.get(e.item_id) ?? []
    list.push(e)
    eps.set(e.item_id, list)
  }

  // Tags perso
  const tagNames = new Map(
    (Array.isArray(data.tags) ? data.tags : [])
      .filter((t) => t && Number.isInteger(t.id))
      .map((t) => [t.id, cleanText(t.name, LIMITS.shortText)] as const),
  )
  const itemTags = new Map<number, string[]>()
  for (const it of data.item_tags ?? []) {
    const name = tagNames.get(it.tag_id)
    if (!name) continue
    itemTags.set(it.item_id, [...(itemTags.get(it.item_id) ?? []), name])
  }

  // Tops 5 par catégorie
  const tops = new Map<number, TopEntry>()
  for (const t of data.top5 ?? []) {
    if (ALL_TOP_CATEGORIES.includes(t.category as TopCategory) && t.position >= 1 && t.position <= 5) {
      tops.set(t.item_id, { category: t.category as TopCategory, rank: t.position })
    }
  }

  const items: MediaItem[] = []
  let skipped = 0
  for (const r of data.items.slice(0, LIMITS.items)) {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.id) || r.id < 0) {
      skipped++
      continue
    }
    const title = cleanText(r.title, LIMITS.title)
    if (!title) {
      skipped++
      continue
    }
    const rawGenres = safeStringList(parseList(r.genres), LIMITS.genres)
    const countries = safeCountries(parseList(r.countries)) ?? []
    const { type, subtype } = guessType(r.media_type, countries, rawGenres)
    const status = mapStatus(r.status)
    const isFilm = type === 'film' || r.media_type === 'movie'

    const watched = eps.get(r.id) ?? []
    const epDates = watched.map((e) => toDay(e.watch_date)).filter((d): d is string => !!d).sort()
    const total = isFilm ? undefined : positive(r.number_of_episodes)
    let episodesWatched = watched.length
    if (!isFilm && status === 'termine' && episodesWatched === 0 && total) episodesWatched = total
    if (total && episodesWatched > total) episodesWatched = total
    const currentSeason = watched.reduce((m, e) => Math.max(m, e.season_number ?? 0), 0)

    const watchDay = toDay(r.watch_date)
    const lastEp = epDates[epDates.length - 1]
    let startDate: string | undefined
    let endDate: string | undefined
    if (status === 'termine') {
      // date de fin = la plus récente entre la date « vu » et le dernier épisode coché
      endDate = [watchDay, lastEp].filter((d): d is string => !!d).sort().pop()
      startDate = epDates[0] && endDate && epDates[0] < endDate ? epDates[0] : undefined
    } else if (status !== 'a_voir') {
      startDate = epDates[0] ?? watchDay
    }

    const genres = splitGenres(rawGenres, isFilm)
    if (isFilm && type === 'film' && countries.includes('JP') && rawGenres.includes('Animation')) genres.unshift('Anime')
    for (const t of itemTags.get(r.id) ?? []) if (!genres.includes(t) && genres.length < LIMITS.genres) genres.push(t)

    const note = typeof r.note === 'number' && Number.isFinite(r.note) && r.note > 0 ? Math.min(10, Math.round(r.note * 2 * 2) / 2) : undefined
    const created = toISO(r.date_added) ?? now

    items.push({
      id: `legacy-${r.id}`,
      title,
      originalTitle: r.original_title && r.original_title !== title ? r.original_title : undefined,
      type,
      subtype,
      year: r.release_date && /^\d{4}/.test(r.release_date) ? Number(r.release_date.slice(0, 4)) : undefined,
      status,
      rating: note,
      criteria: {},
      top: tops.get(r.id),
      countries: countries.length ? countries : undefined,
      episodesWatched: isFilm ? 0 : episodesWatched,
      episodesTotal: total,
      season: !isFilm && currentSeason > 0 ? currentSeason : undefined,
      episodeDuration: isFilm ? undefined : positive(r.runtime),
      duration: isFilm ? positive(r.runtime) : undefined,
      startDate,
      endDate,
      genres,
      notes: cleanText(
        [cleanText(r.comment, LIMITS.notes), cleanText(r.director, LIMITS.shortText) ? `Réalisation : ${cleanText(r.director, LIMITS.shortText)}` : '']
          .filter(Boolean)
          .join('\n\n'),
        LIMITS.notes,
      ),
      poster: isSafeTmdbPath(r.poster_path) ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : undefined,
      overview: cleanText(r.overview, LIMITS.overview),
      externalId: (() => {
        const ext = `tmdb:${r.media_type}:${r.tmdb_id}`
        return isSafeExternalId(ext) ? ext : undefined
      })(),
      createdAt: created,
      updatedAt: toISO(r.watch_date) ?? created,
    })
  }
  return { items, skipped }
}
