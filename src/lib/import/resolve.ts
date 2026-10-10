import { t } from '../../i18n'
import { ANILIST, ANILIST_FIELDS, aniToResult, CLOUD_TMDB, getTmdbDetails, tmdbFindExternal, tmdbImportSearch, type AniMedia, type SearchResult } from '../catalogApi'
import type { MediaInput } from '../../types'
import { anilistEntries, titleKey, type AniListEntry, type ImportEntry } from './sources'

/**
 * Recherche des fiches correspondantes (TMDB pour les films et séries, AniList pour les animes).
 *  - petites rafales : 4 requêtes en parallèle au plus ;
 *  - avec un compte, TMDB passe par le serveur (600 requêtes / 10 min) : on étale les requêtes ;
 *  - AniList (90 requêtes / min) : les identifiants sont demandés par lots de 50 ;
 *  - les correspondances trouvées sont gardées en cache (un nouvel essai ne refait pas tout).
 */

export interface Match {
  result: SearchResult
  /** Métadonnées prêtes pour la fiche (titre, type, affiche, saisons…) */
  meta: Partial<MediaInput>
}

export interface Progress {
  done: number
  total: number
  /** Pause imposée par la limite de débit : reprise à cette heure (ms) */
  waitUntil?: number
}

export interface CancelToken {
  cancelled: boolean
}

export class CancelledError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Cache des correspondances (données publiques uniquement) ───

const CACHE_KEY = 'azuucine:import-match'
const CACHE_MAX = 4000
let cache: Record<string, SearchResult> | null = null

function loadCache(): Record<string, SearchResult> {
  if (cache) return cache
  cache = Object.create(null) as Record<string, SearchResult>
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v && typeof v === 'object' && typeof (v as SearchResult).externalId === 'string') cache[k] = v as SearchResult
      }
    }
  } catch {
    /* cache illisible : on repart de zéro */
  }
  return cache
}

function saveCache() {
  if (!cache) return
  try {
    const keys = Object.keys(cache)
    if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k]
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* stockage plein ou bloqué : tant pis pour le cache */
  }
}

// ─── Limite de débit ───

/** Seau à jetons : `burst` requêtes d'un coup, puis une toutes les `everyMs`. */
function limiter(burst: number, everyMs: number) {
  let tokens = burst
  let last = Date.now()
  return async (token: CancelToken) => {
    for (;;) {
      if (token.cancelled) throw new CancelledError()
      const now = Date.now()
      tokens = Math.min(burst, tokens + (now - last) / everyMs)
      last = now
      if (tokens >= 1) {
        tokens -= 1
        return
      }
      await sleep(Math.min(1000, (1 - tokens) * everyMs))
    }
  }
}

const isRateError = (e: unknown) => {
  const msg = (e as Error)?.message ?? ''
  return msg === t('err.searchRate') || msg === t('err.anilistRate') || msg === t('err.tmdbStatus', { status: 429 }) || msg === 'rate'
}

/** Exécute les tâches avec au plus `size` en parallèle. */
async function pool<T>(list: T[], size: number, token: CancelToken, fn: (x: T) => Promise<void>) {
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      if (token.cancelled) throw new CancelledError()
      await fn(list[i++])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker))
}

// ─── TMDB ───

/** Meilleur candidat : bon type, même année (± 1), titre identique en priorité. */
export function bestTmdbMatch(results: SearchResult[], entry: Pick<ImportEntry, 'kind' | 'title' | 'year'>): SearchResult | undefined {
  const prefix = entry.kind === 'movie' ? 'tmdb:movie:' : 'tmdb:tv:'
  const cands = results.filter((r) => r.externalId.startsWith(prefix))
  const want = titleKey(entry.title)
  const same = (r: SearchResult) => [r.title, r.originalTitle].some((x) => x && titleKey(x) === want)
  if (entry.year) {
    const y = entry.year
    const exact = cands.filter((r) => r.year === y)
    const close = cands.filter((r) => r.year != null && Math.abs(r.year - y) <= 1)
    return exact.find(same) ?? close.find(same) ?? exact[0] ?? close[0]
  }
  return cands.find(same) ?? cands[0]
}

/** Requête TMDB avec reprise automatique quand la limite de débit est atteinte. */
async function withRetry<T>(fn: () => Promise<T>, token: CancelToken, onWait: (until?: number) => void): Promise<T> {
  let delay = 15_000
  for (let attempt = 0; ; attempt++) {
    if (token.cancelled) throw new CancelledError()
    try {
      return await fn()
    } catch (e) {
      if (!isRateError(e) || attempt >= 30) throw e
      const until = Date.now() + delay
      onWait(until)
      while (Date.now() < until) {
        if (token.cancelled) throw new CancelledError()
        await sleep(500)
      }
      onWait(undefined)
      delay = Math.min(60_000, delay * 1.5)
    }
  }
}

// ─── AniList ───

async function anilistPost<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 429) throw new Error('rate')
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string; status?: number }[] }
  if (!res.ok || !json.data) {
    const msg = json.errors?.[0]?.message ?? ''
    if (res.status === 404 || /not found|private/i.test(msg)) throw new Error('anilist-user')
    throw new Error(t('err.anilistStatus', { status: res.status }))
  }
  return json.data
}

/** Nom d'utilisateur AniList valide (lettres et chiffres, 2 à 20 caractères). */
export const isAniListUserName = (v: string) => /^[A-Za-z0-9_-]{2,20}$/.test(v.trim())

/** Liste d'animes publique d'un membre AniList (sans connexion). */
export async function fetchAniListUser(userName: string): Promise<{ entries: ImportEntry[]; adult: number }> {
  const name = userName.trim()
  if (!isAniListUserName(name)) throw new Error('anilist-user')
  const query = `query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME, forceSingleCompletedList: true) {
    lists { isCustomList entries {
      status score(format: POINT_100) progress repeat notes updatedAt
      startedAt { year month day } completedAt { year month day }
      media { isAdult ${ANILIST_FIELDS} }
    } }
  }
}`
  const data = await anilistPost<{ MediaListCollection?: { lists?: { isCustomList?: boolean; entries?: (AniListEntry & { media?: AniMedia & { isAdult?: boolean } })[] }[] } }>(query, {
    name,
  })
  const lists = Array.isArray(data.MediaListCollection?.lists) ? data.MediaListCollection!.lists! : []
  const all = lists.filter((l) => !l.isCustomList).flatMap((l) => (Array.isArray(l.entries) ? l.entries : []))
  const adult = all.filter((e) => e.media?.isAdult).length
  return { entries: anilistEntries(all.filter((e) => !e.media?.isAdult)), adult }
}

/** Fiches AniList à partir d'identifiants MyAnimeList, par lots de 50. */
async function aniListByMal(ids: number[], token: CancelToken, onBatch: (found: Map<number, AniMedia>, count: number) => void, onWait: (until?: number) => void) {
  const query = `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal isAdult ${ANILIST_FIELDS} } } }`
  const rate = limiter(2, 900) // ~66 requêtes / min, sous la limite d'AniList
  for (let i = 0; i < ids.length; i += 50) {
    await rate(token)
    const chunk = ids.slice(i, i + 50)
    const data = await withRetry(() => anilistPost<{ Page?: { media?: (AniMedia & { idMal?: number; isAdult?: boolean })[] } }>(query, { ids: chunk }), token, onWait)
    const found = new Map<number, AniMedia>()
    for (const m of Array.isArray(data.Page?.media) ? data.Page!.media! : []) {
      if (m && Number.isInteger(m.idMal) && !m.isAdult) found.set(m.idMal!, m)
    }
    onBatch(found, chunk.length)
  }
}

// ─── Résolution ───

export interface ResolveOptions {
  /** Clé TMDB (ou CLOUD_TMDB avec un compte) ; sans elle, films et séries ne sont pas cherchés */
  tmdbKey?: string
  token: CancelToken
  onProgress: (p: Progress) => void
}

/** Cherche la fiche de chaque entrée. Renvoie les correspondances par clé d'entrée. */
export async function resolveEntries(entries: ImportEntry[], opts: ResolveOptions): Promise<Map<string, Match>> {
  const { token } = opts
  const found = new Map<string, Match>()
  const progress: Progress = { done: 0, total: entries.length }
  const emit = () => opts.onProgress({ ...progress })
  const step = (n = 1) => {
    progress.done += n
    emit()
  }
  const onWait = (until?: number) => {
    progress.waitUntil = until
    emit()
  }
  emit()

  // 1. Animes déjà fournis par AniList
  const viaMal: ImportEntry[] = []
  const viaTmdb: ImportEntry[] = []
  let alreadyDone = 0
  for (const e of entries) {
    if (e.media) {
      const result = aniToResult(e.media)
      if (result) found.set(e.key, { result, meta: { ...result.prefill, poster: result.posterUrl } })
      alreadyDone++
    } else if (e.malId) viaMal.push(e)
    else if (e.kind !== 'anime') viaTmdb.push(e)
    else alreadyDone++
  }
  step(alreadyDone)

  // 2. MyAnimeList → AniList par lots d'identifiants
  if (viaMal.length) {
    const byMal = new Map(viaMal.map((e) => [e.malId!, e]))
    await aniListByMal([...byMal.keys()], token, (media, count) => {
      for (const [malId, m] of media) {
        const e = byMal.get(malId)
        const result = e && aniToResult(m)
        if (e && result) found.set(e.key, { result, meta: { ...result.prefill, poster: result.posterUrl } })
      }
      step(count)
    }, onWait)
  }

  // 3. Films et séries → TMDB
  const key = opts.tmdbKey?.trim()
  if (!key) {
    step(viaTmdb.length)
    return found
  }
  const cloud = key === CLOUD_TMDB
  // Avec un compte, le serveur accepte 600 requêtes / 10 min : rafale de 150 puis ~1 par seconde
  const rate = cloud ? limiter(150, 1050) : limiter(20, 60)
  const c = loadCache()
  let sinceSave = 0
  const lang = document.documentElement.lang || 'x'

  await pool(viaTmdb, 4, token, async (e) => {
    try {
      const cacheKey = e.tvdbId ? `tvdb:${e.tvdbId}:${lang}` : e.imdbId ? `imdb:${e.imdbId}:${lang}` : `${e.kind}:${titleKey(e.title)}|${e.year ?? ''}:${lang}`
      let result: SearchResult | undefined = c[cacheKey]
      if (!result && (e.tvdbId || e.imdbId)) {
        await rate(token)
        result = await withRetry(() => tmdbFindExternal(e.tvdbId ?? e.imdbId!, e.tvdbId ? 'tvdb_id' : 'imdb_id', key), token, onWait).catch((err) => {
          if (err instanceof CancelledError) throw err
          return undefined // ancien serveur sans /find, ou identifiant inconnu : recherche par titre
        })
      }
      if (!result && !e.title.startsWith('#')) {
        await rate(token)
        const list = await withRetry(() => tmdbImportSearch(e.title, key), token, onWait)
        result = bestTmdbMatch(list, e)
      }
      if (!result) return
      if (!c[cacheKey]) {
        c[cacheKey] = result
        if (++sinceSave >= 25) {
          sinceSave = 0
          saveCache()
        }
      }
      let meta: Partial<MediaInput> = { ...result.prefill, poster: result.posterUrl }
      // Séries : saisons et nombre d'épisodes, pour reprendre la progression
      if (result.externalId.startsWith('tmdb:tv:')) {
        await rate(token)
        const details = await withRetry(() => getTmdbDetails(result!, key), token, onWait).catch((err) => {
          if (err instanceof CancelledError) throw err
          return undefined
        })
        if (details) meta = { ...meta, ...details, poster: result.posterUrl ?? meta.poster }
      }
      found.set(e.key, { result, meta })
    } catch (err) {
      if (err instanceof CancelledError) throw err
      if (!navigator.onLine) throw new Error(t('search.offline'))
      // Erreur ponctuelle sur un titre : il sera compté comme « non trouvé »
    } finally {
      step()
    }
  }).finally(saveCache)
  return found
}
