import { useEffect, useState } from 'react'
import { tmdbLanguage } from '../i18n'
import type { MediaItem } from '../types'
import { CLOUD_TMDB, isPlausibleTmdbKey } from './catalogApi'
import { tmdbViaCloud } from './cloud/api'
import { TYPE_BY_VALUE } from './constants'
import { isPlainObject, isSafeExternalId, isSafeId, isSafeTmdbPath, readStorage, remoteImage, safeDay, safeIso, safeSeasons } from './security'
import { episodeCap } from './franchise'
import { localDay } from './utils'

/**
 * Suivi des nouveaux épisodes.
 * Pour chaque série / anime suivi, on demande à TMDB ou AniList combien d'épisodes
 * sont déjà sortis, et quand sort le prochain. Le résultat est gardé en cache local.
 */

export interface AiringInfo {
  /** Épisodes déjà diffusés */
  aired: number
  /** Prochain épisode annoncé */
  next?: { episode: number; season?: number; date: string }
  /** Série terminée / annulée : plus besoin de vérifier souvent */
  ended: boolean
  seasons?: number
  /** Épisodes de chaque saison (TMDB) */
  seasonSizes?: number[]
  /** Grande image (TMDB) */
  backdrop?: string
  checkedAt: string
}

export type AiringCache = Record<string, AiringInfo>

const KEY = 'azuucine:airing'
const RECHECK_MS = 12 * 3600 * 1000
const RECHECK_ENDED_MS = 30 * 24 * 3600 * 1000
/** Date d'arrivée du suivi par saison (les vérifications plus anciennes n'ont pas le découpage) */
const SEASONS_SINCE = '2026-10-04T10:00:00.000Z'

const n0 = (v: unknown, max = 100000) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : 0)

// Dernière lecture (le cache est relu par chaque carte : on évite de le réanalyser à chaque fois)
let memo: { raw: string | null; cache: AiringCache } | undefined

/** Relit le cache en ne gardant que des entrées bien formées. */
export function loadAiring(): AiringCache {
  let text: string | null = null
  try {
    text = localStorage.getItem(KEY)
  } catch {
    /* stockage indisponible */
  }
  if (memo && memo.raw === text) return memo.cache
  const cache = parseAiring()
  memo = { raw: text, cache }
  return cache
}

function parseAiring(): AiringCache {
  const raw = readStorage(KEY, {})
  const out: AiringCache = {}
  if (!isPlainObject(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isSafeId(id) || !isPlainObject(v)) continue
    const checkedAt = safeIso(v.checkedAt)
    if (!checkedAt) continue
    const next = isPlainObject(v.next) && safeDay(v.next.date) ? { episode: n0(v.next.episode), season: n0(v.next.season) || undefined, date: v.next.date as string } : undefined
    out[id] = { aired: n0(v.aired), ended: v.ended === true, seasons: n0(v.seasons) || undefined, seasonSizes: safeSeasons(v.seasonSizes), backdrop: remoteImage(v.backdrop), next, checkedAt }
  }
  return out
}

/** Émis quand le cache des sorties change (pastille du calendrier). */
export const CACHE_EVENT = 'azuucine:schedule'

export function saveAiring(cache: AiringCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CACHE_EVENT))
}

/** Fiches à surveiller : séries/animes liés à TMDB ou AniList, en cours, en pause ou terminés. */
export function trackable(items: MediaItem[]): MediaItem[] {
  return items.filter(
    (i) =>
      TYPE_BY_VALUE[i.type].episodic &&
      (i.status === 'en_cours' || i.status === 'pause' || i.status === 'termine') &&
      isSafeExternalId(i.externalId) &&
      (i.externalId.startsWith('tmdb:tv:') || i.externalId.startsWith('anilist:')),
  )
}

export function needsCheck(item: MediaItem, cache: AiringCache, force = false): boolean {
  const info = cache[item.id]
  if (!info || force) return true
  // Fiche TMDB vérifiée avant le suivi par saison : on récupère le découpage une fois
  if (item.externalId?.startsWith('tmdb:tv:') && (!info.backdrop || (!info.seasonSizes && (info.seasons ?? 0) > 1)) && info.checkedAt < SEASONS_SINCE) return true
  const age = Date.now() - new Date(info.checkedAt).getTime()
  // Le prochain épisode annoncé est sorti depuis la dernière vérification : on revérifie (au plus toutes les heures)
  if (info.next && info.next.date <= localDay() && localDay(new Date(info.checkedAt)) <= info.next.date && age > 3600_000) return true
  return age > (info.ended ? RECHECK_ENDED_MS : RECHECK_MS)
}

type AiringItem = Pick<MediaItem, 'id' | 'type' | 'externalId'>

const followed = (item: AiringItem) =>
  TYPE_BY_VALUE[item.type]?.episodic && isSafeExternalId(item.externalId) && (item.externalId.startsWith('tmdb:tv:') || item.externalId.startsWith('anilist:'))

/**
 * Nombre d'épisodes déjà sortis (toutes saisons), ou undefined si on ne sait pas (fiche manuelle, pas encore vérifiée).
 * Un épisode annoncé dont la date est passée compte comme sorti, même avant la prochaine vérification.
 */
export function airedCount(item: AiringItem, cache: AiringCache = loadAiring()): number | undefined {
  const info = cache[item.id]
  if (!info || !info.aired || !followed(item)) return undefined
  return info.next && info.next.date <= localDay() ? info.aired + 1 : info.aired
}

/** Date du prochain épisode s'il n'est pas encore sorti. */
export function nextAirDate(item: AiringItem, cache: AiringCache = loadAiring()): string | undefined {
  const d = cache[item.id]?.next?.date
  return d && d > localDay() ? d : undefined
}

/** Peut-on cocher un épisode de plus ? (non si le suivant n'est pas encore sorti) */
export function canWatchMore(item: MediaItem, cache: AiringCache = loadAiring()): boolean {
  const cap = episodeCap(item)
  if (cap && item.episodesWatched >= cap) return false
  const aired = airedCount(item, cache)
  return aired == null || item.episodesWatched < aired
}

/**
 * À jour : j'ai vu tous les épisodes sortis et la série continue.
 * La fiche quitte « Continuer », puis revient dès que le prochain épisode sort.
 */
export function isCaughtUp(item: MediaItem, cache: AiringCache): boolean {
  const aired = airedCount(item, cache)
  if (aired == null || !trackable([item]).length) return false
  const cap = episodeCap(item)
  return item.episodesWatched >= aired && !(cap && item.episodesWatched >= cap && cache[item.id]?.ended)
}

/** Cache des sorties, relu quand il change (pour l'affichage). */
export function useAiringCache(): AiringCache {
  const [cache, setCache] = useState(loadAiring)
  useEffect(() => {
    const reload = () => setCache(loadAiring())
    window.addEventListener(CACHE_EVENT, reload)
    return () => window.removeEventListener(CACHE_EVENT, reload)
  }, [])
  return cache
}

// ───────── TMDB ─────────

interface TmdbTv {
  number_of_episodes?: number
  number_of_seasons?: number
  status?: string
  last_episode_to_air?: { season_number: number; episode_number: number } | null
  next_episode_to_air?: { season_number: number; episode_number: number; air_date?: string } | null
  seasons?: { season_number: number; episode_count: number }[]
  backdrop_path?: string | null
}

async function checkTmdb(tvId: string, key: string): Promise<Omit<AiringInfo, 'checkedAt'>> {
  const k = key.trim()
  if (!/^\d{1,10}$/.test(tvId) || (k !== CLOUD_TMDB && !isPlausibleTmdbKey(k))) throw new Error('Requête refusée')
  let d: TmdbTv
  if (k === CLOUD_TMDB) {
    d = await tmdbViaCloud<TmdbTv>(`/tv/${tvId}`, { language: tmdbLanguage() })
  } else {
    const bearer = k.length > 40
    const url = new URL(`https://api.themoviedb.org/3/tv/${tvId}`)
    url.searchParams.set('language', tmdbLanguage())
    if (!bearer) url.searchParams.set('api_key', k)
    const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${k}` } : {}, referrerPolicy: 'no-referrer', credentials: 'omit' })
    if (!res.ok) throw new Error(`TMDB ${res.status}`)
    d = (await res.json()) as TmdbTv
  }
  // Épisodes diffusés = épisodes des saisons terminées + position du dernier épisode diffusé
  let aired = n0(d.number_of_episodes)
  const last = d.last_episode_to_air
  if (last && Array.isArray(d.seasons) && d.seasons.length) {
    aired = n0(
      d.seasons
        .filter((s) => n0(s.season_number) > 0 && n0(s.season_number) < n0(last.season_number))
        .reduce((sum, s) => sum + n0(s.episode_count), 0) + n0(last.episode_number),
    )
  }
  const nx = d.next_episode_to_air
  const nextDate = safeDay(nx?.air_date)
  return {
    aired,
    seasons: n0(d.number_of_seasons) || undefined,
    seasonSizes: safeSeasons(
      (Array.isArray(d.seasons) ? d.seasons : [])
        .filter((s) => n0(s.season_number) > 0 && n0(s.episode_count) > 0)
        .sort((a, b) => a.season_number - b.season_number)
        .map((s) => n0(s.episode_count)),
    ),
    backdrop: isSafeTmdbPath(d.backdrop_path) ? `https://image.tmdb.org/t/p/w780${d.backdrop_path}` : undefined,
    ended: d.status === 'Ended' || d.status === 'Canceled',
    next: nx && nextDate ? { episode: n0(nx.episode_number), season: n0(nx.season_number) || undefined, date: nextDate } : undefined,
  }
}

// ───────── AniList (une seule requête pour tous les animes) ─────────

async function checkAniList(ids: number[]): Promise<Map<number, Omit<AiringInfo, 'checkedAt'>>> {
  const out = new Map<number, Omit<AiringInfo, 'checkedAt'>>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      body: JSON.stringify({
        query: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id episodes status nextAiringEpisode { episode airingAt } } } }`,
        variables: { ids: chunk },
      }),
    })
    if (!res.ok) throw new Error(`AniList ${res.status}`)
    const json = (await res.json()) as {
      data?: { Page?: { media?: { id: number; episodes?: number | null; status?: string; nextAiringEpisode?: { episode: number; airingAt: number } | null }[] } }
    }
    const media = json.data?.Page?.media
    for (const m of Array.isArray(media) ? media : []) {
      if (!Number.isInteger(m?.id)) continue
      const nx = m.nextAiringEpisode
      const ts = n0(nx?.airingAt, 4102444800) // borne : an 2100
      out.set(m.id, {
        aired: nx ? Math.max(0, n0(nx.episode) - 1) : n0(m.episodes),
        ended: m.status === 'FINISHED' || m.status === 'CANCELLED',
        next: nx && ts ? { episode: n0(nx.episode), date: localDay(new Date(ts * 1000)) } : undefined,
      })
    }
  }
  return out
}

/** Vérifie les fiches qui en ont besoin et renvoie le cache mis à jour. */
export async function refreshAiring(items: MediaItem[], cache: AiringCache, tmdbKey?: string, force = false): Promise<AiringCache> {
  const now = new Date().toISOString()
  const next: AiringCache = { ...cache }
  const todo = trackable(items).filter((i) => needsCheck(i, cache, force))

  const ani = todo.filter((i) => i.externalId!.startsWith('anilist:')).slice(0, 500)
  if (ani.length) {
    try {
      const res = await checkAniList(ani.map((i) => Number(i.externalId!.split(':')[1])))
      for (const i of ani) {
        const info = res.get(Number(i.externalId!.split(':')[1]))
        if (info) next[i.id] = { ...info, checkedAt: now }
      }
    } catch {
      /* réseau indisponible : on réessaiera plus tard */
    }
  }

  if (tmdbKey?.trim()) {
    const tv = todo.filter((i) => i.externalId!.startsWith('tmdb:tv:')).slice(0, 300)
    // 4 requêtes en parallèle maximum
    for (let i = 0; i < tv.length; i += 4) {
      await Promise.all(
        tv.slice(i, i + 4).map(async (item) => {
          try {
            next[item.id] = { ...(await checkTmdb(item.externalId!.split(':')[2], tmdbKey)), checkedAt: now }
          } catch {
            /* ignore cette fiche */
          }
        }),
      )
    }
  }
  return next
}

export interface Novelty {
  item: MediaItem
  info: AiringInfo
  /** Épisodes sortis que je n'ai pas encore vus */
  unwatched: number
  kind: 'new_episodes' | 'new_season' | 'upcoming'
}

/** Ce qu'il faut signaler sur l'accueil. */
export function novelties(items: MediaItem[], cache: AiringCache): Novelty[] {
  const out: Novelty[] = []
  const soon = Date.now() + 14 * 24 * 3600 * 1000
  for (const item of trackable(items)) {
    const info = cache[item.id]
    if (!info) continue
    const unwatched = Math.max(0, info.aired - item.episodesWatched)
    // Série terminée depuis (ex. Friends) : les épisodes non vus ne sont pas des nouveautés,
    // et une « nouvelle saison » n'y est qu'un décalage de numérotation entre TMDB et AniList.
    if (info.ended) continue
    if (item.status === 'termine') {
      // Terminé de mon côté, mais de nouveaux épisodes sont sortis depuis → nouvelle saison
      if (unwatched > 0 && episodeCap(item) && info.aired > episodeCap(item)!) out.push({ item, info, unwatched, kind: 'new_season' })
    } else if (unwatched > 0) {
      out.push({ item, info, unwatched, kind: 'new_episodes' })
    } else if (info.next && new Date(info.next.date).getTime() < soon) {
      out.push({ item, info, unwatched: 0, kind: 'upcoming' })
    }
  }
  const order = { new_season: 0, new_episodes: 1, upcoming: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.info.next?.date ?? '').localeCompare(b.info.next?.date ?? ''))
}
