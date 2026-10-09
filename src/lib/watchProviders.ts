import { useSyncExternalStore } from 'react'
import { locale, region } from '../i18n'
import { cleanText, isHexColor, isPlainObject, isSafeTmdbPath, remoteImage, storageGet, storageSet } from './security'

/**
 * « Où regarder » : plateformes de streaming d'un titre.
 *  - TMDB fournit, pour chaque pays, les offres d'abonnement / location / achat / gratuites (données JustWatch).
 *  - AniList fournit des liens directs vers les plateformes (Crunchyroll, Netflix, ADN…).
 * Les réponses des API ne sont pas fiables : chaque champ est vérifié et borné.
 */

export interface WatchProvider {
  id: number
  name: string
  /** Logo carré (image.tmdb.org) */
  logo?: string
}

export type OfferKind = 'flatrate' | 'free' | 'rent' | 'buy'
export const OFFER_KINDS: OfferKind[] = ['flatrate', 'free', 'rent', 'buy']

export interface WatchRegion {
  /** Page « Où regarder » de TMDB pour ce pays (liens JustWatch vers chaque plateforme) */
  link?: string
  flatrate: WatchProvider[]
  free: WatchProvider[]
  rent: WatchProvider[]
  buy: WatchProvider[]
}

/** Lien direct vers une plateforme (AniList). */
export interface StreamLink {
  site: string
  url: string
  icon?: string
  color?: string
  language?: string
}

const TMDB_IMG = 'https://image.tmdb.org/t/p'
const MAX_PER_KIND = 24
const MAX_REGIONS = 250

/** Lien HTTPS « propre » (sans identifiants ni port exotique), d'un site autorisé si une liste est donnée. */
export function safeLink(value: unknown, hosts?: string[]): string | undefined {
  if (typeof value !== 'string' || value.length > 400) return undefined
  try {
    const u = new URL(value.trim())
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined
    if (hosts && !hosts.includes(u.hostname)) return undefined
    return u.toString()
  } catch {
    return undefined
  }
}

function providers(list: unknown): WatchProvider[] {
  if (!Array.isArray(list)) return []
  const out: (WatchProvider & { order: number })[] = []
  for (const p of list.slice(0, 60)) {
    if (!isPlainObject(p)) continue
    const id = p.provider_id
    const name = cleanText(p.provider_name, 60)
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !name || out.some((x) => x.id === id)) continue
    const logo = isSafeTmdbPath(p.logo_path) ? `${TMDB_IMG}/w92${p.logo_path}` : undefined
    out.push({ id, name, logo, order: typeof p.display_priority === 'number' ? p.display_priority : 999 })
  }
  // Ordre de TMDB (les plateformes les plus courantes du pays d'abord)
  return out
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_PER_KIND)
    .map(({ id, name, logo }) => ({ id, name, logo }))
}

/** Réponse TMDB `watch/providers` → offres par pays (codes ISO à 2 lettres). */
export function parseTmdbProviders(raw: unknown): Record<string, WatchRegion> | undefined {
  const results = isPlainObject(raw) && isPlainObject(raw.results) ? raw.results : undefined
  if (!results) return undefined
  const out: Record<string, WatchRegion> = {}
  let n = 0
  for (const [code, r] of Object.entries(results)) {
    if (n >= MAX_REGIONS) break
    if (!/^[A-Z]{2}$/.test(code) || !isPlainObject(r)) continue
    const free = providers([...(Array.isArray(r.free) ? r.free : []), ...(Array.isArray(r.ads) ? r.ads : [])])
    const region: WatchRegion = {
      link: safeLink(r.link, ['www.themoviedb.org', 'themoviedb.org']),
      flatrate: providers(r.flatrate),
      free,
      rent: providers(r.rent),
      buy: providers(r.buy),
    }
    if (OFFER_KINDS.some((k) => region[k].length)) {
      out[code] = region
      n++
    }
  }
  return out
}

/** `externalLinks` d'AniList → liens de streaming (dédoublonnés par site). */
export function parseAniListLinks(raw: unknown): StreamLink[] {
  if (!Array.isArray(raw)) return []
  const out: StreamLink[] = []
  for (const l of raw.slice(0, 40)) {
    if (!isPlainObject(l) || l.type !== 'STREAMING') continue
    const site = cleanText(l.site, 40)
    const url = safeLink(l.url)
    if (!site || !url) continue
    const language = cleanText(l.language, 30)
    // Même plateforme dans plusieurs langues : une seule pastille (la première donnée par AniList)
    if (out.some((x) => x.site === site)) continue
    out.push({ site, url, icon: remoteImage(l.icon), color: isHexColor(l.color) ? l.color : undefined, language })
    if (out.length >= 16) break
  }
  return out
}

// ─────────────────────────── Pays choisi ───────────────────────────

const STORAGE_KEY = 'azuucine:watchRegion'
const listeners = new Set<() => void>()

/** Pays par défaut : celui de la langue du navigateur (« fr-BE » → BE), sinon celui de l'app, sinon la France. */
export function defaultWatchRegion(): string {
  try {
    for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const m = /^[a-z]{2,3}[-_]([A-Z]{2})\b/i.exec(tag ?? '')
      if (m) return m[1].toUpperCase()
    }
  } catch {
    /* ignore */
  }
  const r = region()
  return r && /^[A-Z]{2}$/.test(r) ? r : 'FR'
}

/** Pays choisi à la main (ou undefined = automatique). */
function chosenRegion(): string | undefined {
  const v = storageGet(STORAGE_KEY)
  return v && /^[A-Z]{2}$/.test(v) ? v : undefined
}

export const getWatchRegion = () => chosenRegion() ?? defaultWatchRegion()

/** Change le pays (null = revenir au pays automatique). */
export function setWatchRegion(code: string | null) {
  storageSet(STORAGE_KEY, code && /^[A-Z]{2}$/.test(code) ? code : null)
  listeners.forEach((f) => f())
}

/** Pays utilisé pour « Où regarder », mis à jour quand on le change. */
export function useWatchRegion(): string {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    getWatchRegion,
    getWatchRegion,
  )
}

/** Nom du pays dans la langue de l'app (« FR » → « France »). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
