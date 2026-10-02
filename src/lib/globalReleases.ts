import { t } from '../i18n'
import { aniListAiring, safeRelease, tmdbEpisodeReleases, tmdbMovieReleases, type GlobalRelease, type ReleaseCategory } from './catalogApi'
import { isPlainObject, readStorage, safeIso } from './security'

/**
 * Sorties « globales » du calendrier : films au cinéma en France, épisodes des séries populaires,
 * des K-dramas / C-dramas (TMDB) et de tous les animes diffusés (AniList).
 * Mises en cache par mois et par catégorie sur l'appareil (12 h pour le mois en cours et à venir).
 */

export const RELEASE_CATEGORIES: { value: ReleaseCategory; readonly label: string; needsKey: boolean }[] = [
  { value: 'film', get label() { return t('typePlural.film') }, needsKey: true },
  { value: 'serie', get label() { return t('typePlural.serie') }, needsKey: true },
  { value: 'anime', get label() { return t('typePlural.anime') }, needsKey: false },
  { value: 'kdrama', get label() { return t('typePlural.kdrama') }, needsKey: true },
  { value: 'cdrama', get label() { return t('typePlural.cdrama') }, needsKey: true },
]
const CAT_SET = new Set<string>(RELEASE_CATEGORIES.map((c) => c.value))

const KEY = 'azuucine:global-releases'
const FRESH_MS = 12 * 3600 * 1000
const PAST_FRESH_MS = 7 * 24 * 3600 * 1000
/** Mois consultables : le précédent et les 6 suivants. */
export const MONTHS_BACK = 1
export const MONTHS_AHEAD = 6

const inflight = new Map<string, Promise<GlobalRelease[]>>()

type Cache = Record<string, Partial<Record<ReleaseCategory, { at: string; list: GlobalRelease[] }>>>

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function monthOffset(key: string): number {
  const [y, m] = key.split('-').map(Number)
  const now = new Date()
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())
}

export const isBrowsableMonth = (key: string) => {
  const o = monthOffset(key)
  return o >= -MONTHS_BACK && o <= MONTHS_AHEAD
}

function load(): Cache {
  const raw = readStorage(KEY, {})
  const out: Cache = {}
  if (!isPlainObject(raw)) return out
  for (const [month, cats] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !isPlainObject(cats)) continue
    for (const [cat, v] of Object.entries(cats)) {
      if (!CAT_SET.has(cat) || !isPlainObject(v) || !Array.isArray(v.list)) continue
      const at = safeIso(v.at)
      if (!at) continue
      const list = v.list
        .slice(0, 800)
        .map((r) => (isPlainObject(r) ? safeRelease({ ...(r as unknown as GlobalRelease), cat: cat as ReleaseCategory }) : null))
        .filter((r): r is GlobalRelease => !!r && r.date.startsWith(month))
      ;(out[month] ??= {})[cat as ReleaseCategory] = { at, list }
    }
  }
  return out
}

function save(cache: Cache) {
  // On ne garde que les mois consultables
  for (const m of Object.keys(cache)) if (!isBrowsableMonth(m)) delete cache[m]
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // stockage plein : on repart d'un cache vide plutôt que de bloquer
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }
}

/** Sorties déjà en cache pour un mois (affichage immédiat). */
export function cachedMonth(month: Date): GlobalRelease[] {
  const entry = load()[monthKey(month)] ?? {}
  return Object.values(entry).flatMap((v) => v?.list ?? [])
}

/** Récupère (si besoin) les sorties d'un mois pour les catégories demandées. */
export async function loadMonth(
  month: Date,
  cats: ReleaseCategory[],
  tmdbKey: string | undefined,
  force = false,
): Promise<{ releases: GlobalRelease[]; failed: ReleaseCategory[] }> {
  const key = monthKey(month)
  const cache = load()
  const entry = (cache[key] ??= {})
  const failed: ReleaseCategory[] = []
  if (isBrowsableMonth(key) && navigator.onLine) {
    const ttl = monthOffset(key) < 0 ? PAST_FRESH_MS : FRESH_MS
    const from = `${key}-01`
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const to = `${key}-${String(last).padStart(2, '0')}`
    const stale = cats.filter((c) => {
      const e = entry[c]
      if (c !== 'anime' && !tmdbKey) return false
      return force || !e || Date.now() - new Date(e.at).getTime() > ttl
    })
    const fetchCat = async (c: ReleaseCategory) => {
      // Une seule requête à la fois par mois et par catégorie (double ouverture, double rendu…)
      const id = `${key}|${c}`
      let job: Promise<GlobalRelease[]> | undefined = inflight.get(id)
      if (!job) {
        const created = c === 'anime' ? aniListAiring(from, to) : c === 'film' ? tmdbMovieReleases(tmdbKey!, from, to) : tmdbEpisodeReleases(tmdbKey!, c, from, to)
        inflight.set(id, created)
        created.finally(() => inflight.delete(id)).catch(() => {})
        job = created
      }
      try {
        entry[c] = { at: new Date().toISOString(), list: await job }
      } catch {
        failed.push(c)
      }
    }
    // AniList en parallèle ; les requêtes TMDB les unes après les autres pour rester raisonnable
    await Promise.all([
      stale.includes('anime') ? fetchCat('anime') : Promise.resolve(),
      (async () => {
        for (const c of stale.filter((x) => x !== 'anime')) await fetchCat(c)
      })(),
    ])
    if (stale.length) save(cache)
  }
  return { releases: cats.flatMap((c) => entry[c]?.list ?? []), failed }
}
