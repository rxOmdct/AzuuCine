import type { MediaInput, MediaType } from '../types'
import { region, t, tmdbLanguage } from '../i18n'
import { tmdbViaCloud } from './cloud/api'
import { TYPE_BY_VALUE } from './constants'
import { subtypeLabel, tmdbGenres } from './genres'
import { franchiseKey } from './franchise'
import { cleanText, isSafeExternalId, isSafeTmdbPath, LIMITS, safeCountries, safePosterUrl, safeSeasons, safeStringList } from './security'

/**
 * Recherche dans les bases publiques :
 *  - TMDB   : films, séries, K-dramas, C-dramas, documentaires… (clé API gratuite requise)
 *  - AniList : animes (aucune clé nécessaire)
 * Seul le texte recherché est envoyé ; la bibliothèque reste sur l'appareil.
 */

export type Source = 'tmdb' | 'anilist'

export interface SearchResult {
  source: Source
  /** ex. « tmdb:movie:496243 », « tmdb:tv:1396 », « anilist:154587 » */
  externalId: string
  title: string
  originalTitle?: string
  year?: number
  /** Petite image pour la liste de résultats */
  thumb?: string
  kindLabel: string
  typeGuess: MediaType
  /** Données déjà complètes (AniList) — sinon on va chercher le détail */
  prefill?: Partial<MediaInput>
  /** URL de l'affiche en bonne qualité */
  posterUrl?: string
  /** Autres titres connus (romaji…), pour repérer les doublons */
  altTitles?: string[]
}

// ─────────────────────────── Nettoyage des réponses ───────────────────────────

const TYPES = new Set<MediaType>(['film', 'serie', 'anime', 'kdrama', 'cdrama', 'autre'])
const count = (n: unknown, max: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : undefined)

/** Les réponses des API sont non fiables : on borne et on filtre chaque champ. */
export function sanitizeMeta(d: Partial<MediaInput>): Partial<MediaInput> {
  const genres = safeStringList(d.genres, LIMITS.genres)
  return {
    title: cleanText(d.title, LIMITS.title),
    originalTitle: cleanText(d.originalTitle, LIMITS.title),
    type: d.type && TYPES.has(d.type) ? d.type : undefined,
    subtype: cleanText(d.subtype, LIMITS.shortText),
    year: typeof d.year === 'number' && d.year >= 1870 && d.year <= 2200 ? Math.round(d.year) : undefined,
    overview: cleanText(d.overview, LIMITS.overview),
    genres: genres.length ? genres : undefined,
    platform: cleanText(d.platform, LIMITS.shortText),
    duration: count(d.duration, 6000),
    episodesTotal: count(d.episodesTotal, 100000),
    seasons: safeSeasons(d.seasons),
    episodeDuration: count(d.episodeDuration, 1440),
    externalId: isSafeExternalId(d.externalId) ? d.externalId : undefined,
    countries: safeCountries(d.countries),
    poster: safePosterUrl(d.poster),
    publicRating:
      typeof d.publicRating === 'number' && d.publicRating > 0 && d.publicRating <= 10 ? Math.round(d.publicRating * 10) / 10 : undefined,
  }
}

/** Note TMDB sur 10, seulement s'il y a assez de votes pour qu'elle veuille dire quelque chose. */
export function tmdbPublicRating(avg?: number, count?: number): number | undefined {
  return typeof avg === 'number' && avg > 0 && avg <= 10 && (count ?? 0) >= 20 ? Math.round(avg * 10) / 10 : undefined
}

function safeResult(r: SearchResult): SearchResult | null {
  const title = cleanText(r.title, LIMITS.title)
  if (!title || !isSafeExternalId(r.externalId)) return null
  return {
    ...r,
    title,
    originalTitle: cleanText(r.originalTitle, LIMITS.title),
    year: typeof r.year === 'number' && r.year >= 1870 && r.year <= 2200 ? r.year : undefined,
    thumb: safePosterUrl(r.thumb),
    posterUrl: safePosterUrl(r.posterUrl),
    kindLabel: cleanText(r.kindLabel, 40) ?? '',
    altTitles: r.altTitles?.map((x) => cleanText(x, LIMITS.title)).filter((x): x is string => !!x).slice(0, 3),
    prefill: r.prefill ? sanitizeMeta(r.prefill) : undefined,
  }
}

// ─────────────────────────── TMDB ───────────────────────────

const TMDB = 'https://api.themoviedb.org/3'
const TMDB_IMG = 'https://image.tmdb.org/t/p'

interface TmdbItem {
  id: number
  media_type?: 'movie' | 'tv' | 'person'
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  genre_ids?: number[]
  origin_country?: string[]
  original_language?: string
  vote_average?: number
  vote_count?: number
  popularity?: number
}

/** Clé v3 (32 caractères hexadécimaux) ou jeton de lecture v4 (JWT). */
export function isPlausibleTmdbKey(key: string): boolean {
  const k = key.trim()
  return /^[a-f0-9]{32}$/i.test(k) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k)
}

/** Seules ces adresses de l'API TMDB peuvent être appelées. */
const TMDB_PATHS = /^\/(search\/multi|configuration|discover\/(movie|tv)|(movie|tv)\/\d{1,10}(\/recommendations|\/season\/\d{1,3})?)$/

/** « Clé » spéciale : avec un compte, les requêtes passent par le serveur qui détient la vraie clé TMDB. */
export const CLOUD_TMDB = 'cloud-proxy'

async function tmdbFetch<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T> {
  const k = key.trim()
  if (!TMDB_PATHS.test(path)) throw new Error(t('err.tmdbRefused'))
  if (k === CLOUD_TMDB) return tmdbViaCloud<T>(path, { language: tmdbLanguage(), ...params })
  if (!isPlausibleTmdbKey(k)) throw new Error(t('err.tmdbKeyRefused'))
  const isBearer = k.length > 40 // jeton de lecture v4 (JWT) vs clé v3 (32 caractères)
  const url = new URL(TMDB + path)
  url.searchParams.set('language', tmdbLanguage())
  for (const [p, v] of Object.entries(params)) url.searchParams.set(p, v)
  if (!isBearer) url.searchParams.set('api_key', k)
  const res = await fetch(url, {
    headers: isBearer ? { Authorization: `Bearer ${k}` } : {},
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  })
  if (res.status === 401) throw new Error(t('err.tmdbKeyRefused'))
  if (!res.ok) throw new Error(t('err.tmdbStatus', { status: res.status }))
  return res.json() as Promise<T>
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined)

/** Devine le type AzuuCine à partir des métadonnées TMDB. */
function guessTmdbType(kind: 'movie' | 'tv', genreIds: number[], countries: string[], lang?: string): { type: MediaType; subtype?: string } {
  const has = (c: string) => countries.includes(c)
  if (genreIds.includes(99)) return { type: 'autre', subtype: 'Documentaire' }
  if (kind === 'movie') return { type: 'film' }
  if (genreIds.includes(10764)) return { type: 'autre', subtype: 'Télé-réalité' }
  if (genreIds.includes(16) && (has('JP') || lang === 'ja')) return { type: 'anime' }
  if (has('KR') || lang === 'ko') return { type: 'kdrama' }
  if (has('CN') || has('TW') || has('HK') || lang === 'zh' || lang === 'cn') return { type: 'cdrama' }
  return { type: 'serie' }
}

const kindLabel = (type: MediaType, subtype?: string) => (subtype ? subtypeLabel(subtype) : TYPE_BY_VALUE[type].label)

function tmdbToResult(r: TmdbItem, kind: 'movie' | 'tv'): SearchResult | null {
  if (!Number.isInteger(r.id)) return null
  const poster = isSafeTmdbPath(r.poster_path) ? r.poster_path : undefined
  const guess = guessTmdbType(kind, r.genre_ids ?? [], r.origin_country ?? [], r.original_language)
  const title = (kind === 'movie' ? r.title : r.name) ?? '?'
  const original = kind === 'movie' ? r.original_title : r.original_name
  return safeResult({
    source: 'tmdb',
    externalId: `tmdb:${kind}:${r.id}`,
    title,
    originalTitle: original && original !== title ? original : undefined,
    year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date),
    thumb: poster ? `${TMDB_IMG}/w92${poster}` : undefined,
    posterUrl: poster ? `${TMDB_IMG}/w342${poster}` : undefined,
    kindLabel: kindLabel(guess.type, guess.subtype),
    typeGuess: guess.type,
  })
}

export async function searchTmdb(query: string, key: string): Promise<SearchResult[]> {
  const data = await tmdbFetch<{ results: TmdbItem[] }>('/search/multi', key, { query: query.slice(0, LIMITS.searchQuery), include_adult: 'false' })
  return (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 15)
    .map((r) => tmdbToResult(r, r.media_type as 'movie' | 'tv'))
    .filter((r): r is SearchResult => r !== null)
}

/** Titres recommandés par TMDB à partir d'un film / d'une série. */
export async function tmdbRecommendations(externalId: string, key: string): Promise<SearchResult[]> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('tmdb:')) return []
  const [, kind, id] = externalId.split(':') as ['tmdb', 'movie' | 'tv', string]
  const data = await tmdbFetch<{ results: TmdbItem[] }>(`/${kind}/${id}/recommendations`, key)
  return (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r.poster_path)
    .slice(0, 15)
    .map((r) => tmdbToResult(r, r.media_type === 'movie' || r.media_type === 'tv' ? r.media_type : kind))
    .filter((r): r is SearchResult => r !== null)
}

interface TmdbDetails {
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  runtime?: number
  episode_run_time?: number[]
  number_of_episodes?: number
  number_of_seasons?: number
  genres?: { id: number; name: string }[]
  origin_country?: string[]
  production_countries?: { iso_3166_1: string }[]
  original_language?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  last_episode_to_air?: { runtime?: number } | null
  seasons?: { season_number?: number; episode_count?: number }[]
  vote_average?: number
  vote_count?: number
  'watch/providers'?: { results?: Record<string, { flatrate?: { provider_name: string }[] }> }
}

const PROVIDER_NAMES: Record<string, string> = {
  'Amazon Prime Video': 'Prime Video',
  'Amazon Prime Video with Ads': 'Prime Video',
  'Disney Plus': 'Disney+',
  'Apple TV Plus': 'Apple TV+',
  'Apple TV+': 'Apple TV+',
  'Canal+ Séries': 'Canal+',
  'Paramount Plus': 'Paramount+',
  'Netflix Standard with Ads': 'Netflix',
  'Netflix basic with Ads': 'Netflix',
  'Rakuten Viki': 'Viki',
  'Animation Digital Network': 'ADN',
}

const GENRE_ALIASES: Record<string, string> = {
  'Science-Fiction': 'Sci-Fi',
  'Science Fiction': 'Sci-Fi',
  'Sci-Fi': 'Sci-Fi',
  Adventure: 'Aventure',
  Fantasy: 'Fantasy',
  Fantastique: 'Fantasy',
  War: 'Guerre',
  Politics: 'Politique',
  Kids: 'Enfants',
  Musique: 'Musical',
  Crime: 'Policier',
}

/**
 * Découpe les genres combinés de TMDB (« Science-Fiction & Fantastique », « Action & Adventure »),
 * harmonise les noms et retire les doublons.
 */
export function splitGenres(names: string[], keepAnimation = false): string[] {
  const out = new Set<string>()
  for (const n of names) {
    for (const part of n.split('&')) {
      const g = part.trim()
      if (!g) continue
      if (g === 'Animation' && !keepAnimation) continue // déjà exprimé par le type
      out.add(GENRE_ALIASES[g] ?? g)
    }
  }
  return [...out]
}

export async function getTmdbDetails(result: SearchResult, key: string): Promise<Partial<MediaInput>> {
  if (!isSafeExternalId(result.externalId) || !result.externalId.startsWith('tmdb:')) throw new Error(t('err.tmdbRef'))
  const [, kind, id] = result.externalId.split(':') as ['tmdb', 'movie' | 'tv', string]
  const d = await tmdbFetch<TmdbDetails>(`/${kind}/${id}`, key, { append_to_response: 'watch/providers' })
  const guess = guessTmdbType(kind, (d.genres ?? []).map((g) => g.id), d.origin_country ?? [], d.original_language)
  const providers = d['watch/providers']?.results
  const provider = (providers?.[region()] ?? providers?.FR)?.flatrate?.[0]?.provider_name
  const title = (kind === 'movie' ? d.title : d.name) ?? result.title
  const original = kind === 'movie' ? d.original_title : d.original_name
  const epRuntime = d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || undefined

  return sanitizeMeta({
    title,
    originalTitle: original && original !== title ? original : undefined,
    type: guess.type,
    subtype: guess.subtype,
    year: yearOf(kind === 'movie' ? d.release_date : d.first_air_date),
    overview: d.overview || undefined,
    genres: tmdbGenres((d.genres ?? []).map((g) => g.id)).filter((g) => guess.type === 'film' || g !== 'Animation'),
    platform: provider ? (PROVIDER_NAMES[provider] ?? provider) : undefined,
    duration: kind === 'movie' ? d.runtime || undefined : undefined,
    episodesTotal: kind === 'tv' ? Math.max(d.number_of_episodes || 0, sumSeasons(tmdbSeasons(d))) || undefined : undefined,
    seasons: kind === 'tv' ? tmdbSeasons(d) : undefined,
    episodeDuration: kind === 'tv' ? epRuntime : undefined,
    externalId: result.externalId,
    countries: d.origin_country?.length ? d.origin_country : d.production_countries?.map((c) => c.iso_3166_1).slice(0, 3),
    publicRating: tmdbPublicRating(d.vote_average, d.vote_count),
  })
}

/** Épisodes par saison (hors épisodes spéciaux « saison 0 », et saisons annoncées sans épisode). */
function tmdbSeasons(d: TmdbDetails): number[] | undefined {
  const list = (Array.isArray(d.seasons) ? d.seasons : [])
    .filter((s) => typeof s.season_number === 'number' && s.season_number > 0 && typeof s.episode_count === 'number' && s.episode_count > 0)
    .sort((a, b) => a.season_number! - b.season_number!)
    .map((s) => s.episode_count!)
  return safeSeasons(list)
}
const sumSeasons = (s?: number[]) => (s ?? []).reduce((a, b) => a + b, 0)

/** Saisons d'une série déjà dans la bibliothèque (pour les fiches ajoutées avant le suivi par saison). */
export async function getTmdbSeasons(externalId: string, key: string): Promise<{ seasons?: number[]; total?: number }> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('tmdb:tv:')) return {}
  const d = await tmdbFetch<TmdbDetails>(`/tv/${externalId.split(':')[2]}`, key)
  const seasons = tmdbSeasons(d)
  return { seasons, total: Math.max(d.number_of_episodes || 0, sumSeasons(seasons)) || undefined }
}

/** Vérifie qu'une clé TMDB fonctionne. */
export async function testTmdbKey(key: string): Promise<boolean> {
  try {
    await tmdbFetch('/configuration', key)
    return true
  } catch {
    return false
  }
}

// ─────────────────────────── AniList ───────────────────────────

const ANILIST = 'https://graphql.anilist.co'

const ANILIST_FIELDS = `
      id
      format
      episodes
      duration
      genres
      seasonYear
      startDate { year }
      title { romaji english native }
      coverImage { medium large }
      countryOfOrigin
      averageScore
      description(asHtml: false)`

const ANILIST_QUERY = `
query ($search: String) {
  Page(perPage: 15) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {${ANILIST_FIELDS}
    }
  }
}`

interface AniMedia {
  id: number
  format?: string | null
  episodes?: number | null
  duration?: number | null
  genres?: string[]
  seasonYear?: number | null
  startDate?: { year?: number | null }
  title: { romaji?: string | null; english?: string | null; native?: string | null }
  coverImage?: { medium?: string | null; large?: string | null }
  description?: string | null
  countryOfOrigin?: string | null
  averageScore?: number | null
}

const ANILIST_GENRES: Record<string, string> = {
  Action: 'Action',
  Adventure: 'Aventure',
  Comedy: 'Comédie',
  Drama: 'Drame',
  Ecchi: 'Ecchi',
  Fantasy: 'Fantasy',
  Horror: 'Horreur',
  'Mahou Shoujo': 'Magical Girl',
  Mecha: 'Mecha',
  Music: 'Musical',
  Mystery: 'Mystère',
  Psychological: 'Psychologique',
  Romance: 'Romance',
  'Sci-Fi': 'Sci-Fi',
  'Slice of Life': 'Slice of Life',
  Sports: 'Sport',
  Supernatural: 'Surnaturel',
  Thriller: 'Thriller',
}

const aniFormat = (f?: string | null): string =>
  f === 'TV_SHORT' ? t('anilist.short') : f === 'MOVIE' ? t('anilist.movie') : f === 'SPECIAL' ? t('anilist.special') : f === 'MUSIC' ? t('anilist.music') : f === 'OVA' || f === 'ONA' ? f : t('type.anime')

function cleanDescription(html?: string | null): string | undefined {
  if (!html) return undefined
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function searchAniList(query: string): Promise<SearchResult[]> {
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query.slice(0, LIMITS.searchQuery) } }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  })
  if (res.status === 429) throw new Error(t('err.anilistRate'))
  if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
  const json = (await res.json()) as { data?: { Page?: { media?: AniMedia[] } } }
  const list = Array.isArray(json.data?.Page?.media) ? json.data!.Page!.media! : []

  return list.map(aniToResult).filter((r): r is SearchResult => r !== null)
}

function aniToResult(m: AniMedia): SearchResult | null {
  if (!m || !Number.isInteger(m.id)) return null
  const isMovie = m.format === 'MOVIE'
  const title = m.title.english || m.title.romaji || m.title.native || '?'
  const original = m.title.native || m.title.romaji || undefined
  const year = m.seasonYear ?? m.startDate?.year ?? undefined
  const type: MediaType = isMovie ? 'film' : 'anime'
  return safeResult({
    source: 'anilist' as const,
    externalId: `anilist:${m.id}`,
    title,
    originalTitle: original && original !== title ? original : undefined,
    altTitles: [m.title.romaji, m.title.english, m.title.native].filter((x): x is string => !!x).slice(0, 3),
    year: year ?? undefined,
    thumb: m.coverImage?.medium ?? undefined,
    posterUrl: m.coverImage?.large ?? m.coverImage?.medium ?? undefined,
    kindLabel: aniFormat(m.format),
    typeGuess: type,
    prefill: {
      title,
      originalTitle: original && original !== title ? original : undefined,
      type,
      year: year ?? undefined,
      overview: cleanDescription(m.description),
      genres: [...(isMovie ? ['Anime'] : []), ...(m.genres ?? []).map((g) => ANILIST_GENRES[g] ?? g)],
      episodesTotal: isMovie ? undefined : (m.episodes ?? undefined),
      episodeDuration: isMovie ? undefined : (m.duration ?? undefined),
      duration: isMovie ? (m.duration ?? undefined) : undefined,
      externalId: `anilist:${m.id}`,
      countries: m.countryOfOrigin ? [m.countryOfOrigin] : undefined,
      publicRating: typeof m.averageScore === 'number' && m.averageScore > 0 ? m.averageScore / 10 : undefined,
    },
  })
}

const titlesOf = (r: SearchResult) => [r.title, r.originalTitle, ...(r.altTitles ?? [])].filter((x): x is string => !!x)
const exactKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Recherche unique : films, séries et animes.
 * TMDB d'abord (il regroupe toutes les saisons d'une série sous une seule fiche), puis les animes
 * d'AniList qu'il ne connaît pas. Les saisons séparées d'AniList (« … Season 2 ») ne sont pas répétées.
 */
export async function searchAll(query: string, key?: string): Promise<SearchResult[]> {
  const [tm, an] = await Promise.allSettled([key ? searchTmdb(query, key) : Promise.resolve([]), searchAniList(query)])
  if (tm.status === 'rejected' && an.status === 'rejected') throw tm.reason
  const tmdb = tm.status === 'fulfilled' ? tm.value : []
  const ani = an.status === 'fulfilled' ? an.value : []

  const seriesKeys = new Set(tmdb.filter((r) => r.typeGuess !== 'film').flatMap(titlesOf).map(franchiseKey))
  const movieKeys = new Set(tmdb.filter((r) => r.typeGuess === 'film').flatMap(titlesOf).map(exactKey))
  const seen = new Set<string>()
  const extra = ani.filter((r) => {
    const titles = titlesOf(r)
    if (r.typeGuess === 'film') return !titles.some((x) => movieKeys.has(exactKey(x)))
    const keys = titles.map(franchiseKey)
    if (keys.some((k) => seriesKeys.has(k) || seen.has(k))) return false
    keys.forEach((k) => seen.add(k))
    return true
  })
  return [...tmdb, ...extra]
}

/** Retrouve sur TMDB la série (toutes saisons) correspondant à une saison d'anime AniList. */
export async function findTmdbSeries(titles: (string | undefined)[], key: string): Promise<SearchResult | undefined> {
  const keys = new Set(titles.filter((x): x is string => !!x).map(franchiseKey))
  for (const q of titles.filter((x): x is string => !!x).slice(0, 2)) {
    const found = (await searchTmdb(q, key)).find((r) => r.typeGuess !== 'film' && r.externalId.startsWith('tmdb:tv:') && titlesOf(r).some((x) => keys.has(franchiseKey(x))))
    if (found) return found
  }
  return undefined
}

/** Animes recommandés par AniList à partir d'un anime. */
export async function aniListRecommendations(externalId: string): Promise<SearchResult[]> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('anilist:')) return []
  const id = Number(externalId.split(':')[1])
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($id: Int) { Media(id: $id) { recommendations(sort: RATING_DESC, perPage: 15) { nodes { mediaRecommendation { ${ANILIST_FIELDS} } } } } }`,
      variables: { id },
    }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
  const json = (await res.json()) as { data?: { Media?: { recommendations?: { nodes?: { mediaRecommendation?: AniMedia | null }[] } } } }
  const nodes = json.data?.Media?.recommendations?.nodes
  return (Array.isArray(nodes) ? nodes : [])
    .map((n) => n.mediaRecommendation)
    .filter((m): m is AniMedia => !!m)
    .map(aniToResult)
    .filter((r): r is SearchResult => r !== null)
}

// ─────────────────────────── Générique (pour les affiches partagées) ───────────────────────────

export interface Credits {
  /** Réalisateur·rices (films) ou créateur·rices (séries) */
  directors: string[]
  producers: string[]
  cast: string[]
  runtime?: number
  /** Image de scène (paysage) en haute définition, sinon l'affiche en HD */
  image?: string
}

interface TmdbCredits {
  runtime?: number
  backdrop_path?: string | null
  poster_path?: string | null
  created_by?: { name?: string }[]
  credits?: {
    cast?: { name?: string; order?: number }[]
    crew?: { name?: string; job?: string }[]
  }
}

const names = (list: (string | undefined)[], max: number) =>
  [...new Set(list.map((n) => cleanText(n, 60)).filter((n): n is string => !!n))].slice(0, max)

/** Réalisation, production et casting principal depuis TMDB. */
export async function getTmdbCredits(externalId: string, key: string): Promise<Credits | undefined> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('tmdb:')) return undefined
  const [, kind, id] = externalId.split(':') as ['tmdb', 'movie' | 'tv', string]
  const d = await tmdbFetch<TmdbCredits>(`/${kind}/${id}`, key, { append_to_response: 'credits' })
  const crew = Array.isArray(d.credits?.crew) ? d.credits!.crew! : []
  const cast = Array.isArray(d.credits?.cast) ? d.credits!.cast! : []
  return {
    directors:
      kind === 'movie'
        ? names(crew.filter((c) => c.job === 'Director').map((c) => c.name), 2)
        : names((Array.isArray(d.created_by) ? d.created_by : []).map((c) => c.name), 2),
    producers: names(crew.filter((c) => c.job === 'Producer').map((c) => c.name), 3),
    cast: names([...cast].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((c) => c.name), 4),
    runtime: typeof d.runtime === 'number' && d.runtime > 0 && d.runtime < 6000 ? Math.round(d.runtime) : undefined,
    image: isSafeTmdbPath(d.backdrop_path)
      ? `${TMDB_IMG}/w1280${d.backdrop_path}`
      : isSafeTmdbPath(d.poster_path)
        ? `${TMDB_IMG}/w780${d.poster_path}`
        : undefined,
  }
}

// ─────────────────────────── Notes du public ───────────────────────────

/** Note moyenne TMDB d'un film / d'une série (undefined si trop peu de votes). */
export async function getTmdbPublicRating(externalId: string, key: string): Promise<number | undefined> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('tmdb:')) return undefined
  const [, kind, id] = externalId.split(':') as ['tmdb', 'movie' | 'tv', string]
  const d = await tmdbFetch<TmdbDetails>(`/${kind}/${id}`, key)
  return tmdbPublicRating(d.vote_average, d.vote_count)
}

/** Notes moyennes AniList (sur 10) pour plusieurs animes d'un coup. */
export async function getAniListPublicRatings(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500)
  for (let i = 0; i < clean.length; i += 50) {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      body: JSON.stringify({
        query: 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id averageScore } } }',
        variables: { ids: clean.slice(i, i + 50) },
      }),
    })
    if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
    const json = (await res.json()) as { data?: { Page?: { media?: { id: number; averageScore?: number | null }[] } } }
    const media = json.data?.Page?.media
    for (const m of Array.isArray(media) ? media : []) {
      if (Number.isInteger(m?.id) && typeof m.averageScore === 'number' && m.averageScore > 0 && m.averageScore <= 100) {
        out.set(m.id, Math.round(m.averageScore) / 10)
      }
    }
  }
  return out
}

// ─────────────────────────── Dates de sortie (calendrier) ───────────────────────────

export interface ReleaseInfo {
  date: string // AAAA-MM-JJ
  label: string
}

interface TmdbReleaseDetails {
  release_date?: string
  first_air_date?: string
  next_episode_to_air?: { air_date?: string; episode_number?: number; season_number?: number } | null
  release_dates?: { results?: { iso_3166_1?: string; release_dates?: { release_date?: string; type?: number }[] }[] }
}

const day = (v?: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined)

/** Prochaine date utile pour un titre « à voir » : sortie ciné en France, sortie en ligne, 1er épisode… */
export async function getTmdbRelease(externalId: string, key: string): Promise<ReleaseInfo | undefined> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('tmdb:')) return undefined
  const [, kind, id] = externalId.split(':') as ['tmdb', 'movie' | 'tv', string]
  if (kind === 'movie') {
    const d = await tmdbFetch<TmdbReleaseDetails>(`/movie/${id}`, key, { append_to_response: 'release_dates' })
    const results = Array.isArray(d.release_dates?.results) ? d.release_dates!.results! : []
    const local = results.find((r) => r.iso_3166_1 === region())?.release_dates ?? []
    const pick = (type: number) => day(local.filter((r) => r.type === type).map((r) => r.release_date ?? '').sort()[0])
    const cinema = pick(3) ?? pick(2)
    const online = pick(4)
    const today = new Date().toISOString().slice(0, 10)
    if (cinema && cinema >= today) return { date: cinema, label: t('release.cinema') }
    if (online && online >= today) return { date: online, label: t('release.online') }
    const primary = day(d.release_date)
    return cinema ? { date: cinema, label: t('release.cinema') } : primary ? { date: primary, label: t('release.release') } : undefined
  }
  const d = await tmdbFetch<TmdbReleaseDetails>(`/tv/${id}`, key)
  const nx = d.next_episode_to_air
  const nextDay = day(nx?.air_date)
  if (nextDay) {
    const ep = Number.isInteger(nx?.episode_number) ? nx!.episode_number! : undefined
    const season = Number.isInteger(nx?.season_number) ? nx!.season_number! : undefined
    return { date: nextDay, label: ep === 1 && season ? t('release.season', { season }) : ep ? t('release.episode', { ep }) : t('release.newEpisode') }
  }
  const first = day(d.first_air_date)
  return first ? { date: first, label: t('release.firstEpisode') } : undefined
}

/** Dates de sortie AniList (1er épisode ou prochain épisode) pour plusieurs animes. */
export async function getAniListReleases(ids: number[]): Promise<Map<number, ReleaseInfo>> {
  const out = new Map<number, ReleaseInfo>()
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500)
  for (let i = 0; i < clean.length; i += 50) {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      body: JSON.stringify({
        query:
          'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id startDate { year month day } nextAiringEpisode { episode airingAt } } } }',
        variables: { ids: clean.slice(i, i + 50) },
      }),
    })
    if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
    type M = { id: number; startDate?: { year?: number; month?: number; day?: number }; nextAiringEpisode?: { episode?: number; airingAt?: number } | null }
    const json = (await res.json()) as { data?: { Page?: { media?: M[] } } }
    const media = json.data?.Page?.media
    for (const m of Array.isArray(media) ? media : []) {
      if (!Number.isInteger(m?.id)) continue
      const nx = m.nextAiringEpisode
      if (nx && typeof nx.airingAt === 'number' && nx.airingAt > 0 && nx.airingAt < 4102444800) {
        out.set(m.id, { date: new Date(nx.airingAt * 1000).toISOString().slice(0, 10), label: nx.episode === 1 ? t('release.firstEpisode') : nx.episode ? t('release.episode', { ep: nx.episode }) : t('release.newEpisode') })
      } else if (m.startDate?.year && m.startDate.month && m.startDate.day) {
        const d = `${m.startDate.year}-${String(m.startDate.month).padStart(2, '0')}-${String(m.startDate.day).padStart(2, '0')}`
        if (day(d)) out.set(m.id, { date: d, label: t('release.firstEpisode') })
      }
    }
  }
  return out
}


// ─────────────────────────── Sorties globales (calendrier) ───────────────────────────

export type ReleaseCategory = 'film' | 'serie' | 'anime' | 'kdrama' | 'cdrama'

/** Une sortie (film au cinéma ou épisode) venant des bases publiques, pas forcément dans ma bibliothèque. */
export interface GlobalRelease {
  date: string // AAAA-MM-JJ (heure locale)
  externalId: string
  title: string
  originalTitle?: string
  year?: number
  poster?: string
  label: string
  cat: ReleaseCategory
  /** Popularité normalisée 0–100, pour trier les sorties d'un même jour */
  pop: number
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function safeRelease(r: GlobalRelease): GlobalRelease | null {
  const title = cleanText(r.title, LIMITS.title)
  const date = day(r.date)
  if (!title || !date || !isSafeExternalId(r.externalId)) return null
  return {
    date,
    externalId: r.externalId,
    title,
    originalTitle: cleanText(r.originalTitle, LIMITS.title),
    year: typeof r.year === 'number' && r.year >= 1870 && r.year <= 2200 ? r.year : undefined,
    poster: safePosterUrl(r.poster),
    label: cleanText(r.label, 40) ?? '',
    cat: r.cat,
    pop: Math.max(0, Math.min(100, Math.round(r.pop || 0))),
  }
}
export { safeRelease }

const popScore = (p?: number) => (typeof p === 'number' && p > 0 ? Math.min(100, Math.log10(p + 1) * 30) : 0)

/** Films qui sortent au cinéma en France entre deux dates (les plus attendus d'abord). */
export async function tmdbMovieReleases(key: string, from: string, to: string, pages = 2): Promise<GlobalRelease[]> {
  const out: GlobalRelease[] = []
  const toCheck: TmdbItem[] = []
  for (let page = 1; page <= pages; page++) {
    const data = await tmdbFetch<{ results?: TmdbItem[]; total_pages?: number }>('/discover/movie', key, {
      region: region(),
      'release_date.gte': from,
      'release_date.lte': to,
      with_release_type: '2|3',
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page: String(page),
    })
    for (const r of Array.isArray(data.results) ? data.results : []) {
      if (!Number.isInteger(r.id) || (r.genre_ids ?? []).includes(99)) continue
      const primary = day(r.release_date)
      if (primary && primary >= from && primary <= to) out.push(movieRelease(r, primary))
      else toCheck.push(r)
    }
    if ((data.total_pages ?? 1) <= page) break
  }
  // Date de sortie française quand elle diffère de la date mondiale
  for (let k = 0; k < Math.min(toCheck.length, 24); k += 4) {
    await Promise.all(
      toCheck.slice(k, k + 4).map(async (r) => {
        try {
          const info = await getTmdbRelease(`tmdb:movie:${r.id}`, key)
          if (info && info.date >= from && info.date <= to) out.push(movieRelease(r, info.date))
        } catch {
          /* ignore ce film */
        }
      }),
    )
  }
  return out.map(safeRelease).filter((x): x is GlobalRelease => !!x)
}

function movieRelease(r: TmdbItem, date: string): GlobalRelease {
  const poster = isSafeTmdbPath(r.poster_path) ? `${TMDB_IMG}/w342${r.poster_path}` : undefined
  return {
    date,
    externalId: `tmdb:movie:${r.id}`,
    title: r.title ?? '?',
    originalTitle: r.original_title !== r.title ? r.original_title : undefined,
    year: yearOf(r.release_date),
    poster,
    label: t('release.cinema'),
    cat: 'film',
    pop: popScore(r.popularity),
  }
}

const TV_FILTERS: Record<'serie' | 'kdrama' | 'cdrama', { countries: string; shows: number }> = {
  serie: { countries: 'US|GB|FR|CA|AU|IE|NZ|ES|DE|IT|BE|SE|DK|NO', shows: 20 },
  kdrama: { countries: 'KR', shows: 12 },
  cdrama: { countries: 'CN|TW|HK', shows: 12 },
}

interface TmdbEpisode {
  air_date?: string
  episode_number?: number
  season_number?: number
}

/** Épisodes des séries populaires (ou K-dramas / C-dramas) diffusés entre deux dates. */
export async function tmdbEpisodeReleases(
  key: string,
  cat: 'serie' | 'kdrama' | 'cdrama',
  from: string,
  to: string,
): Promise<GlobalRelease[]> {
  const f = TV_FILTERS[cat]
  const data = await tmdbFetch<{ results?: TmdbItem[] }>('/discover/tv', key, {
    'air_date.gte': from,
    'air_date.lte': to,
    with_origin_country: f.countries,
    without_genres: '16|10763|10764|10767',
    sort_by: 'popularity.desc',
    include_adult: 'false',
  })
  const shows = (Array.isArray(data.results) ? data.results : []).filter((r) => Number.isInteger(r.id)).slice(0, f.shows)
  const out: GlobalRelease[] = []
  for (let k = 0; k < shows.length; k += 4) {
    await Promise.all(
      shows.slice(k, k + 4).map(async (show) => {
        try {
          const d = await tmdbFetch<{ next_episode_to_air?: TmdbEpisode | null; last_episode_to_air?: TmdbEpisode | null }>(`/tv/${show.id}`, key)
          const seasons = new Set<number>()
          for (const e of [d.last_episode_to_air, d.next_episode_to_air]) {
            const dd = day(e?.air_date)
            if (e && Number.isInteger(e.season_number) && e.season_number! > 0 && dd && dd >= shiftDay(from, -120)) seasons.add(e.season_number!)
          }
          for (const n of [...seasons].slice(0, 2)) {
            const season = await tmdbFetch<{ episodes?: TmdbEpisode[] }>(`/tv/${show.id}/season/${n}`, key)
            // Regroupe les épisodes sortis le même jour (séries mises en ligne d'un bloc)
            const byDay = new Map<string, number[]>()
            for (const e of Array.isArray(season.episodes) ? season.episodes : []) {
              const dd = day(e.air_date)
              if (!dd || dd < from || dd > to || !Number.isInteger(e.episode_number)) continue
              byDay.set(dd, [...(byDay.get(dd) ?? []), e.episode_number!])
            }
            for (const [date, eps] of byDay) out.push(episodeRelease(show, cat, date, n, eps))
          }
        } catch {
          /* ignore cette série */
        }
      }),
    )
  }
  return out.map(safeRelease).filter((x): x is GlobalRelease => !!x)
}

function shiftDay(d: string, days: number) {
  const x = new Date(d + 'T12:00:00')
  x.setDate(x.getDate() + days)
  return localDay(x)
}

function episodeLabel(season: number | undefined, eps: number[]): string {
  const sorted = [...eps].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === 1 && season === 1) return sorted.length > 1 ? t('release.newSeriesN', { count: sorted.length }) : t('release.firstEpisode')
  if (first === 1) return sorted.length > 1 ? t('release.seasonN', { season: season ?? 1, count: sorted.length }) : t('release.seasonEp1', { season: season ?? 1 })
  if (!season) return sorted.length > 1 ? t('release.episodes', { first, last }) : t('release.episode', { ep: first })
  return sorted.length > 1 ? t('release.sEpisodes', { season, first, last }) : t('release.sEpisode', { season, ep: first })
}

function episodeRelease(show: TmdbItem, cat: ReleaseCategory, date: string, season: number, eps: number[]): GlobalRelease {
  return {
    date,
    externalId: `tmdb:tv:${show.id}`,
    title: show.name ?? '?',
    originalTitle: show.original_name !== show.name ? show.original_name : undefined,
    year: yearOf(show.first_air_date),
    poster: isSafeTmdbPath(show.poster_path) ? `${TMDB_IMG}/w342${show.poster_path}` : undefined,
    label: episodeLabel(season, eps),
    cat,
    pop: popScore(show.popularity),
  }
}

/** Tous les épisodes d'anime diffusés entre deux dates (AniList, sans clé). */
export async function aniListAiring(from: string, to: string, minPopularity = 4000): Promise<GlobalRelease[]> {
  const start = Math.floor(new Date(from + 'T00:00:00').getTime() / 1000) - 1
  const end = Math.floor(new Date(to + 'T23:59:59').getTime() / 1000) + 1
  type S = {
    airingAt?: number
    episode?: number
    media?: {
      id?: number
      title?: { romaji?: string | null; english?: string | null; native?: string | null }
      coverImage?: { large?: string | null; medium?: string | null }
      popularity?: number
      isAdult?: boolean
      countryOfOrigin?: string
      format?: string
      episodes?: number | null
      seasonYear?: number | null
    }
  }
  const byKey = new Map<string, { s: S; eps: number[] }>()
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      body: JSON.stringify({
        query: `query ($start: Int, $end: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) { airingAt episode
            media { id title { romaji english native } coverImage { large medium } popularity isAdult countryOfOrigin format episodes seasonYear } } } }`,
        variables: { start, end, page },
      }),
    })
    if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
    const json = (await res.json()) as { data?: { Page?: { pageInfo?: { hasNextPage?: boolean }; airingSchedules?: S[] } } }
    const list = json.data?.Page?.airingSchedules
    for (const s of Array.isArray(list) ? list : []) {
      const m = s.media
      if (!m || !Number.isInteger(m.id) || m.isAdult || m.countryOfOrigin !== 'JP' || (m.popularity ?? 0) < minPopularity) continue
      if (typeof s.airingAt !== 'number' || !Number.isInteger(s.episode)) continue
      const date = localDay(new Date(s.airingAt * 1000))
      const k = `${m.id}|${date}`
      const cur = byKey.get(k)
      if (cur) cur.eps.push(s.episode!)
      else byKey.set(k, { s, eps: [s.episode!] })
    }
    if (!json.data?.Page?.pageInfo?.hasNextPage) break
  }
  const out: GlobalRelease[] = []
  for (const [k, { s, eps }] of byKey) {
    const m = s.media!
    const sorted = eps.sort((a, b) => a - b)
    const total = Number.isInteger(m.episodes) ? m.episodes! : undefined
    const isFinal = total != null && sorted[sorted.length - 1] === total
    const label =
      m.format === 'MOVIE'
        ? t('release.filmJapan')
        : sorted[0] === 1
          ? t('release.firstEpisode')
          : sorted.length > 1
            ? t('release.episodes', { first: sorted[0], last: sorted[sorted.length - 1] })
            : isFinal
              ? t('release.episodeFinal', { ep: sorted[0] })
              : t('release.episode', { ep: sorted[0] })
    out.push({
      date: k.split('|')[1],
      externalId: `anilist:${m.id}`,
      title: m.title?.english || m.title?.romaji || m.title?.native || '?',
      originalTitle: m.title?.romaji || undefined,
      year: m.seasonYear ?? undefined,
      poster: m.coverImage?.large ?? m.coverImage?.medium ?? undefined,
      label,
      cat: 'anime',
      pop: popScore(m.popularity) - 20,
    })
  }
  return out.map(safeRelease).filter((x): x is GlobalRelease => !!x)
}

/** Fiche AniList complète à partir de son identifiant (ajout depuis le calendrier). */
export async function getAniListById(externalId: string): Promise<SearchResult | null> {
  if (!isSafeExternalId(externalId) || !externalId.startsWith('anilist:')) return null
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    body: JSON.stringify({
      query: `query ($id: Int) { Media(id: $id, type: ANIME) {${ANILIST_FIELDS} } }`,
      variables: { id: Number(externalId.split(':')[1]) },
    }),
  })
  if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
  const json = (await res.json()) as { data?: { Media?: AniMedia } }
  return json.data?.Media ? aniToResult(json.data.Media) : null
}

/** Résultat « recherche » TMDB minimal à partir d'une sortie (pour l'ajout rapide). */
export function releaseToResult(r: GlobalRelease): SearchResult | null {
  if (!r.externalId.startsWith('tmdb:')) return null
  const type: MediaType = r.cat
  return safeResult({
    source: 'tmdb',
    externalId: r.externalId,
    title: r.title,
    originalTitle: r.originalTitle,
    year: r.year,
    thumb: r.poster,
    posterUrl: r.poster,
    kindLabel: kindLabel(type),
    typeGuess: type,
  })
}
