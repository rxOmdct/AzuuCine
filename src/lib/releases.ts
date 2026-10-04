import { locale, t } from '../i18n'
import type { MediaItem } from '../types'
import { loadAiring, trackable, CACHE_EVENT } from './airing'
import { getAniListReleases, getTmdbRelease, type ReleaseInfo } from './catalogApi'
import { isPlainObject, isSafeExternalId, isSafeId, readStorage, safeDay, safeIso } from './security'
import { localDay, todayISO } from './utils'

/**
 * Calendrier des sorties :
 *  - prochains épisodes des séries / animes suivis (cache du suivi des épisodes),
 *  - dates de sortie des titres « À voir » (films au cinéma / en ligne, séries, animes).
 */

export interface CalendarEvent {
  date: string // AAAA-MM-JJ
  item: MediaItem
  label: string
  kind: 'episode' | 'release'
}

type ReleaseCache = Record<string, ReleaseInfo & { checkedAt: string }>

const KEY = 'azuucine:releases'
const RECHECK_MS = 3 * 24 * 3600 * 1000

export function loadReleases(): ReleaseCache {
  const raw = readStorage(KEY, {})
  const out: ReleaseCache = {}
  if (!isPlainObject(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isSafeId(id) || !isPlainObject(v)) continue
    const date = safeDay(v.date)
    const checkedAt = safeIso(v.checkedAt)
    const label = typeof v.label === 'string' ? v.label.slice(0, 40) : ''
    if (date && checkedAt) out[id] = { date, label, checkedAt }
  }
  return out
}

function saveReleases(c: ReleaseCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CACHE_EVENT))
}

/** Titres « À voir » récents ou à venir, reliés à une base. */
function watchlistCandidates(items: MediaItem[]): MediaItem[] {
  const year = new Date().getFullYear()
  return items.filter((i) => i.status === 'a_voir' && isSafeExternalId(i.externalId) && (!i.year || i.year >= year - 1))
}

export async function refreshReleases(items: MediaItem[], tmdbKey?: string, force = false): Promise<ReleaseCache> {
  const cache = loadReleases()
  const now = new Date().toISOString()
  const todo = watchlistCandidates(items).filter(
    (i) => force || !cache[i.id] || Date.now() - new Date(cache[i.id].checkedAt).getTime() > RECHECK_MS,
  )

  const ani = todo.filter((i) => i.externalId!.startsWith('anilist:'))
  if (ani.length) {
    try {
      const map = await getAniListReleases(ani.map((i) => Number(i.externalId!.split(':')[1])))
      for (const i of ani) {
        const r = map.get(Number(i.externalId!.split(':')[1]))
        if (r) cache[i.id] = { ...r, checkedAt: now }
      }
    } catch {
      /* réseau */
    }
  }
  if (tmdbKey) {
    const tmdb = todo.filter((i) => i.externalId!.startsWith('tmdb:')).slice(0, 200)
    for (let k = 0; k < tmdb.length; k += 4) {
      await Promise.all(
        tmdb.slice(k, k + 4).map(async (i) => {
          try {
            const r = await getTmdbRelease(i.externalId!, tmdbKey)
            if (r) cache[i.id] = { ...r, checkedAt: now }
          } catch {
            /* ignore */
          }
        }),
      )
    }
  }
  saveReleases(cache)
  return cache
}

/** Tous les évènements connus, triés par date (à partir d'il y a 7 jours). */
export function calendarEvents(items: MediaItem[], releases: ReleaseCache = loadReleases()): CalendarEvent[] {
  const from = localDay(new Date(Date.now() - 7 * 86400000))
  const airing = loadAiring()
  const events: CalendarEvent[] = []
  for (const item of trackable(items)) {
    const nx = airing[item.id]?.next
    if (nx && nx.date >= from) {
      const label = nx.episode === 1 && nx.season ? t('release.season', { season: nx.season }) : t('release.episode', { ep: nx.episode })
      events.push({ date: nx.date, item, label, kind: 'episode' })
    }
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const [id, r] of Object.entries(releases)) {
    const item = byId.get(id)
    if (item && item.status === 'a_voir' && r.date >= from) events.push({ date: r.date, item, label: r.label, kind: 'release' })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title, locale()))
}

export const isToday = (d: string) => d === todayISO()
