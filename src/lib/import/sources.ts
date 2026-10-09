import type { WatchStatus } from '../../types'
import type { AniMedia } from '../catalogApi'
import { cleanText, LIMITS, safeDay, safeIso } from '../security'
import { parseCsv, pick, type CsvRow, type TextFile } from './files'

/**
 * Lecture des exports d'autres applis (Letterboxd, TV Time, MyAnimeList, AniList)
 * vers un format commun, avant la recherche des fiches correspondantes.
 */

export type ImportSource = 'letterboxd' | 'tvtime' | 'mal' | 'anilist'
export type EntryKind = 'movie' | 'tv' | 'anime'

export interface ImportEntry {
  /** Identifiant unique dans l'import */
  key: string
  kind: EntryKind
  title: string
  year?: number
  /** Identifiants externes connus */
  tvdbId?: string
  imdbId?: string
  anilistId?: number
  malId?: number
  /** Fiche AniList déjà fournie (import AniList) */
  media?: AniMedia
  /** Format AniList / MAL (« MOVIE », « TV »…) */
  format?: string
  status: WatchStatus
  /** Note sur 10 (pas de 0,5) */
  rating?: number
  favorite?: boolean
  /** Nombre d'épisodes vus (MAL / AniList) */
  episodesWatched?: number
  /** Épisodes vus « saison:épisode » (TV Time) */
  seen?: Set<string>
  /** Série mise de côté dans TV Time */
  archived?: boolean
  startDate?: string
  endDate?: string
  rewatchDates?: string[]
  notes?: string
  /** Date de la dernière activité connue (ISO) — sert à ne jamais écraser une donnée plus récente */
  activity?: string
  /** Date de la première activité connue (ISO) */
  firstSeen?: string
}

/** Clé de comparaison d'un titre : sans accents, casse ni ponctuation. */
export const titleKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')

const yearOf = (v?: string) => {
  const n = v && /^\d{4}$/.test(v.trim()) ? Number(v) : NaN
  return n >= 1870 && n <= 2200 ? n : undefined
}

/** « 2024-03-05 », « 2024-03-05 18:22:01 », « 2024-03-05T18:22:01Z » → AAAA-MM-JJ */
export const toDay = (v?: string) => (v ? safeDay(v.trim().slice(0, 10)) : undefined)
/** Date → ISO (pour comparer avec la date de modification des fiches) */
export const toIso = (v?: string) => {
  if (!v) return undefined
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return safeIso(s + 'T12:00:00Z')
  return safeIso(s.includes('T') ? s : s.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z'))
}

/** Garde la date la plus ancienne / la plus récente vue pour une entrée. */
function touch(e: ImportEntry, raw?: string) {
  const iso = toIso(raw)
  if (!iso) return
  if (!e.activity || iso > e.activity) e.activity = iso
  if (!e.firstSeen || iso < e.firstSeen) e.firstSeen = iso
}

const appendNote = (prev: string | undefined, add?: string) => cleanText([prev, add].filter(Boolean).join('\n\n'), LIMITS.notes)

// ─────────────────────────── Letterboxd ───────────────────────────

const basename = (p: string) => p.split('/').pop() ?? p

/** Fichiers Letterboxd reconnus (on ignore les dossiers « deleted », « orphaned » et les listes). */
export function letterboxdRole(path: string): 'watched' | 'ratings' | 'diary' | 'reviews' | 'watchlist' | 'likes' | undefined {
  if (/(^|\/)(deleted|orphaned|lists)\//.test(path)) return undefined
  if (/(^|\/)likes\/films\.csv$/.test(path)) return 'likes'
  const b = basename(path)
  // Fichier déposé seul (hors archive) : likes/films.csv arrive sous le nom « films.csv »
  if (b === path && b === 'films.csv') return 'likes'
  if (b === 'watched.csv') return 'watched'
  if (b === 'ratings.csv') return 'ratings'
  if (b === 'diary.csv') return 'diary'
  if (b === 'reviews.csv') return 'reviews'
  if (b === 'watchlist.csv') return 'watchlist'
  return undefined
}

export function parseLetterboxd(files: TextFile[]): ImportEntry[] {
  const order = ['watched', 'ratings', 'diary', 'reviews', 'watchlist', 'likes'] as const
  const byRole = new Map<string, CsvRow[]>()
  for (const f of files) {
    const role = letterboxdRole(f.path)
    if (role) byRole.set(role, [...(byRole.get(role) ?? []), ...parseCsv(f.text).rows])
  }
  const films = new Map<string, ImportEntry>()
  const views = new Map<string, { day: string; rewatch: boolean }[]>()
  const get = (row: CsvRow) => {
    const title = cleanText(row.name, LIMITS.title)
    if (!title) return undefined
    const year = yearOf(row.year)
    const key = `lb:${titleKey(title)}|${year ?? ''}`
    let e = films.get(key)
    if (!e) {
      if (films.size >= LIMITS.items) return undefined
      e = { key, kind: 'movie', title, year, status: 'a_voir' }
      films.set(key, e)
    }
    touch(e, row.date)
    return e
  }
  const ratingOf = (v?: string) => {
    const n = Number(v)
    return v && Number.isFinite(n) && n > 0 && n <= 5 ? Math.min(10, Math.round(n * 2 * 2) / 2) : undefined
  }
  for (const role of order) {
    for (const row of byRole.get(role) ?? []) {
      const e = get(row)
      if (!e) continue
      if (role === 'watched') e.status = 'termine'
      else if (role === 'ratings') {
        e.rating = ratingOf(row.rating) ?? e.rating
        e.status = 'termine'
      } else if (role === 'diary' || role === 'reviews') {
        e.status = 'termine'
        if (e.rating == null) e.rating = ratingOf(row.rating)
        const day = toDay(row.watched_date) ?? (role === 'diary' ? toDay(row.date) : undefined)
        touch(e, row.watched_date)
        if (day) views.set(e.key, [...(views.get(e.key) ?? []), { day, rewatch: /^(yes|true|1)$/i.test(row.rewatch ?? '') }])
        if (role === 'reviews') e.notes = appendNote(e.notes, cleanText(row.review, LIMITS.notes))
      } else if (role === 'likes') e.favorite = true
      // watchlist : « à voir » par défaut, sauf si déjà vu
    }
  }
  // Premier visionnage = date de fin, les suivants = revisionnages
  for (const [key, list] of views) {
    const e = films.get(key)!
    const sorted = [...new Map(list.sort((a, b) => a.day.localeCompare(b.day)).map((v) => [v.day, v])).values()]
    const first = sorted.find((v) => !v.rewatch)
    if (first && first === sorted[0]) e.endDate = first.day
    const rewatches = sorted.filter((v) => v.day !== e.endDate).map((v) => v.day)
    if (rewatches.length) e.rewatchDates = rewatches.slice(-200)
  }
  return [...films.values()]
}

// ─────────────────────────── TV Time ───────────────────────────

const SHOW_NAME = ['tv_show_name', 'series_name', 'show_name', 'serie_name', 'series_title', 'show_title', 'tv_show_title']
const SHOW_ID = ['tv_show_id', 'tvdb_show_id', 'series_id', 'serie_id', 'show_id', 'tvdb_id', 's_id', 'tvdb']
const MOVIE_NAME = ['movie_name', 'movie_title', 'film_name']
const SEASON = ['episode_season_number', 'season_number', 'season_num', 'season']
const EPISODE = ['episode_number', 'episode_num', 'number', 'episode']
const DATE = ['watched_at', 'seen_at', 'watch_date', 'created_at', 'updated_at', 'date']
const KIND = ['entity_type', 'media_type', 'object_type', 'item_type', 'type']

export function parseTvTime(files: TextFile[]): ImportEntry[] {
  type Row = { row: CsvRow; path: string; generic: boolean }
  const rows: Row[] = []
  for (const f of files) {
    if (!/\.(csv|txt)$/.test(f.path)) continue
    const { columns, rows: list } = parseCsv(f.text)
    const specific = columns.some((c) => SHOW_NAME.includes(c) || SHOW_ID.includes(c) || MOVIE_NAME.includes(c))
    // Colonne « name » / « title » générique : seulement dans un fichier qui parle de séries ou de films
    const generic = !specific && (columns.includes('name') || columns.includes('title')) && /(show|serie|series|tv|movie|film)/.test(basename(f.path))
    if (!specific && !generic) continue
    for (const row of list) rows.push({ row, path: basename(f.path), generic })
  }

  // Les fichiers n'ont pas tous l'identifiant : on relie les noms aux identifiants TVDB connus
  const nameToId = new Map<string, string>()
  const showName = (r: Row) => cleanText(pick(r.row, r.generic ? [...SHOW_NAME, 'name', 'title'] : SHOW_NAME), LIMITS.title)
  const showId = (r: Row) => {
    const v = pick(r.row, SHOW_ID)
    return v && /^\d{1,10}$/.test(v) && v !== '0' ? v : undefined
  }
  for (const r of rows) {
    const name = showName(r)
    const id = showId(r)
    if (name && id && !nameToId.has(titleKey(name))) nameToId.set(titleKey(name), id)
  }

  const out = new Map<string, ImportEntry>()
  for (const r of rows) {
    const kindRaw = (pick(r.row, KIND) ?? '').toLowerCase()
    const movieName = cleanText(pick(r.row, MOVIE_NAME), LIMITS.title)
    const date = pick(r.row, DATE)
    const isMovie = !!movieName || /movie|film/.test(kindRaw) || /movie|film/.test(r.path)
    if (isMovie) {
      const title = movieName ?? showName(r)
      if (!title) continue
      const imdb = pick(r.row, ['imdb_id', 'imdb'])
      const key = `tvt:m:${titleKey(title)}`
      const e = out.get(key) ?? { key, kind: 'movie' as const, title, status: 'a_voir' as WatchStatus }
      if (imdb && /^tt\d{1,10}$/.test(imdb)) e.imdbId = imdb
      e.year ??= yearOf(pick(r.row, ['year', 'release_year', 'movie_year']))
      if (/watch|seen|view/.test(kindRaw + ' ' + r.path + ' ' + (pick(r.row, ['type', 'action', 'status']) ?? '').toLowerCase())) {
        e.status = 'termine'
        const day = toDay(date)
        if (day && (!e.endDate || day < e.endDate)) e.endDate = day
      }
      touch(e, date)
      if (out.size < LIMITS.items) out.set(key, e)
      continue
    }
    const name = showName(r)
    const id = showId(r) ?? (name ? nameToId.get(titleKey(name)) : undefined)
    if (!name && !id) continue
    const key = id ? `tvt:${id}` : `tvt:n:${titleKey(name!)}`
    let e = out.get(key)
    if (!e) {
      if (out.size >= LIMITS.items) continue
      e = { key, kind: 'tv', title: name ?? `#${id}`, tvdbId: id, status: 'a_voir', seen: new Set() }
      out.set(key, e)
    } else if (name && e.title.startsWith('#')) e.title = name
    const season = Number(pick(r.row, SEASON))
    const episode = Number(pick(r.row, EPISODE))
    if (Number.isInteger(season) && Number.isInteger(episode) && season >= 1 && season < 1000 && episode >= 1 && episode < 10000) {
      if (e.seen!.size < 20000) e.seen!.add(`${season}:${episode}`)
      const day = toDay(date)
      if (day && (!e.startDate || day < e.startDate)) e.startDate = day
      if (day && (!e.endDate || day > e.endDate)) e.endDate = day
    }
    if (/^(1|true|yes)$/i.test(pick(r.row, ['is_archived', 'archived']) ?? '')) e.archived = true
    touch(e, date)
  }
  return [...out.values()]
}

// ─────────────────────────── MyAnimeList ───────────────────────────

const MAL_STATUS: Record<string, WatchStatus> = {
  watching: 'en_cours',
  '1': 'en_cours',
  completed: 'termine',
  '2': 'termine',
  'on-hold': 'pause',
  onhold: 'pause',
  '3': 'pause',
  dropped: 'abandonne',
  '4': 'abandonne',
  'plan to watch': 'a_voir',
  plantowatch: 'a_voir',
  '6': 'a_voir',
}

export function parseMal(xml: string): ImportEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('xml')
  const out: ImportEntry[] = []
  const nodes = Array.from(doc.getElementsByTagName('anime')).slice(0, LIMITS.items)
  for (const n of nodes) {
    const get = (tag: string) => n.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
    const malId = Number(get('series_animedb_id'))
    const title = cleanText(get('series_title'), LIMITS.title)
    if (!title || !Number.isInteger(malId) || malId <= 0) continue
    const score = Number(get('my_score'))
    const watched = Number(get('my_watched_episodes'))
    const updated = Number(get('my_last_updated'))
    const e: ImportEntry = {
      key: `mal:${malId}`,
      kind: 'anime',
      title,
      malId,
      format: get('series_type').toUpperCase() || undefined,
      status: MAL_STATUS[get('my_status').toLowerCase()] ?? 'a_voir',
      rating: Number.isFinite(score) && score > 0 && score <= 10 ? score : undefined,
      episodesWatched: Number.isInteger(watched) && watched > 0 ? Math.min(watched, 100000) : undefined,
      startDate: toDay(get('my_start_date')),
      endDate: toDay(get('my_finish_date')),
      notes: cleanText(get('my_comments'), LIMITS.notes),
    }
    if (Number.isFinite(updated) && updated > 0) touch(e, new Date(updated * 1000).toISOString())
    touch(e, e.startDate)
    touch(e, e.endDate)
    out.push(e)
  }
  return out
}

// ─────────────────────────── AniList (réponse déjà téléchargée) ───────────────────────────

export interface AniListEntry {
  status?: string | null
  score?: number | null
  progress?: number | null
  repeat?: number | null
  notes?: string | null
  updatedAt?: number | null
  startedAt?: { year?: number | null; month?: number | null; day?: number | null } | null
  completedAt?: { year?: number | null; month?: number | null; day?: number | null } | null
  media?: AniMedia | null
}

const ANILIST_STATUS: Record<string, WatchStatus> = {
  CURRENT: 'en_cours',
  REPEATING: 'en_cours',
  COMPLETED: 'termine',
  PAUSED: 'pause',
  DROPPED: 'abandonne',
  PLANNING: 'a_voir',
}

const fuzzyDay = (d?: AniListEntry['startedAt']) => {
  if (!d?.year || !d.month || !d.day) return undefined
  return safeDay(`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`)
}

/** Entrées d'une liste AniList (score demandé en POINT_100). */
export function anilistEntries(list: AniListEntry[]): ImportEntry[] {
  const out = new Map<string, ImportEntry>()
  for (const x of list.slice(0, LIMITS.items)) {
    const m = x?.media
    if (!m || !Number.isInteger(m.id) || m.id <= 0) continue
    const title = cleanText(m.title?.english || m.title?.romaji || m.title?.native, LIMITS.title)
    if (!title) continue
    const score = typeof x.score === 'number' && x.score > 0 ? Math.min(10, Math.round(x.score / 10 * 2) / 2) : undefined
    const e: ImportEntry = {
      key: `al:${m.id}`,
      kind: 'anime',
      title,
      year: m.seasonYear ?? m.startDate?.year ?? undefined,
      anilistId: m.id,
      media: m,
      format: m.format ?? undefined,
      status: ANILIST_STATUS[x.status ?? ''] ?? 'a_voir',
      rating: score || undefined,
      episodesWatched: typeof x.progress === 'number' && x.progress > 0 ? Math.min(100000, Math.round(x.progress)) : undefined,
      startDate: fuzzyDay(x.startedAt),
      endDate: fuzzyDay(x.completedAt),
      notes: cleanText(x.notes, LIMITS.notes),
    }
    if (typeof x.updatedAt === 'number' && x.updatedAt > 0) touch(e, new Date(x.updatedAt * 1000).toISOString())
    touch(e, e.startDate)
    touch(e, e.endDate)
    out.set(e.key, e)
  }
  return [...out.values()]
}
