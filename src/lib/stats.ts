import { locale } from '../i18n'
import type { MediaItem, MediaType, WatchStatus } from '../types'
import { DEFAULT_FILM_MINUTES, MEDIA_TYPES, STATUSES, TYPE_BY_VALUE } from './constants'

/** Temps estimé (minutes) passé sur une fiche. */
export function watchMinutes(item: MediaItem): number {
  const epMin = item.episodeDuration || TYPE_BY_VALUE[item.type].episodeMinutes
  if (item.type === 'film') return item.status === 'termine' ? (item.duration || DEFAULT_FILM_MINUTES) * (1 + (item.rewatchDates?.length ?? 0)) : 0
  if (item.episodesWatched > 0) return item.episodesWatched * epMin
  if (item.status === 'termine') return item.episodesTotal ? item.episodesTotal * epMin : item.duration || 0
  return 0
}

export interface Count {
  label: string
  value: number
}

export interface LibraryStats {
  total: number
  completed: number
  inProgress: number
  toWatch: number
  totalMinutes: number
  episodesWatched: number
  avgRating?: number
  ratedCount: number
  byType: (Count & { type: MediaType; completed: number; minutes: number })[]
  byStatus: (Count & { status: WatchStatus })[]
  topGenres: Count[]
  topPlatforms: Count[]
  /** Répartition des notes : 10 tranches sur l'échelle /10 (0,5–1, 1,5–2, …). */
  ratingBuckets: number[]
  completedThisYear: number
}

function top(map: Map<string, number>, n: number): Count[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, value]) => ({ label, value }))
}

export function computeStats(items: MediaItem[]): LibraryStats {
  const year = String(new Date().getFullYear())
  const genres = new Map<string, number>()
  const platforms = new Map<string, number>()
  const ratingBuckets = new Array(10).fill(0) as number[]
  let totalMinutes = 0
  let episodesWatched = 0
  let ratingSum = 0
  let ratedCount = 0
  let completedThisYear = 0

  const byType = MEDIA_TYPES.map((t) => ({ type: t.value, label: t.label, value: 0, completed: 0, minutes: 0 }))
  const typeIndex = Object.fromEntries(byType.map((t, i) => [t.type, i]))
  const byStatus = STATUSES.map((s) => ({ status: s.value, label: s.label, value: 0 }))
  const statusIndex = Object.fromEntries(byStatus.map((s, i) => [s.status, i]))

  for (const item of items) {
    const minutes = watchMinutes(item)
    totalMinutes += minutes
    episodesWatched += item.episodesWatched
    const t = byType[typeIndex[item.type]]
    t.value++
    t.minutes += minutes
    if (item.status === 'termine') {
      t.completed++
      if ((item.endDate ?? item.updatedAt).startsWith(year)) completedThisYear++
    }
    byStatus[statusIndex[item.status]].value++

    if (item.status !== 'a_voir') {
      for (const g of item.genres) genres.set(g, (genres.get(g) ?? 0) + 1)
      if (item.platform) platforms.set(item.platform, (platforms.get(item.platform) ?? 0) + 1)
    }
    if (item.rating != null && item.rating > 0) {
      ratingSum += item.rating
      ratedCount++
      ratingBuckets[Math.min(9, Math.ceil(item.rating) - 1)]++
    }
  }

  return {
    total: items.length,
    completed: byStatus[statusIndex.termine].value,
    inProgress: byStatus[statusIndex.en_cours].value,
    toWatch: byStatus[statusIndex.a_voir].value,
    totalMinutes,
    episodesWatched,
    avgRating: ratedCount ? ratingSum / ratedCount : undefined,
    ratedCount,
    byType,
    byStatus,
    topGenres: top(genres, 8),
    topPlatforms: top(platforms, 6),
    ratingBuckets,
    completedThisYear,
  }
}

/** Date à laquelle je rattache un visionnage (fin si terminé, sinon début). */
export function watchDate(item: MediaItem): string | undefined {
  if (item.status === 'termine') return item.endDate ?? item.startDate ?? item.updatedAt.slice(0, 10)
  if (item.status === 'a_voir') return undefined
  return item.startDate ?? item.updatedAt.slice(0, 10)
}

/** Années pour lesquelles j'ai des visionnages, de la plus récente à la plus ancienne. */
export function availableYears(items: MediaItem[]): string[] {
  return [...new Set(items.map((i) => watchDate(i)?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse()
}

/** Garde les fiches rattachées à l'année (ou toutes si year = ''). « À voir » compte toujours. */
export function itemsForPeriod(items: MediaItem[], year: string): MediaItem[] {
  if (!year) return items
  return items.filter((i) => watchDate(i)?.startsWith(year))
}

export interface MonthBucket {
  key: string // AAAA-MM
  label: string // « janv. »
  initial: string // « J »
  count: number
  minutes: number
}

/** Titres terminés et temps par mois : les 12 mois de l'année choisie, ou les 12 derniers mois. */
export function monthly(items: MediaItem[], year: string): MonthBucket[] {
  const months: string[] = []
  if (year) {
    for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, '0')}`)
  } else {
    const d = new Date()
    d.setDate(1)
    for (let k = 11; k >= 0; k--) {
      const x = new Date(d.getFullYear(), d.getMonth() - k, 1)
      months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`)
    }
  }
  return months.map((key) => {
    const date = new Date(`${key}-15T12:00:00`)
    const inMonth = items.filter((i) => i.status === 'termine' && watchDate(i)?.startsWith(key))
    const label = date.toLocaleDateString(locale(), { month: 'short' })
    return {
      key,
      label,
      // Initiale du mois (J, F, M…) ; chiffre du mois pour les langues sans alphabet latin (1月…)
      initial: /^\p{Script=Latin}/u.test(label) ? label.charAt(0).toUpperCase() : String(date.getMonth() + 1),
      count: inMonth.length,
      minutes: inMonth.reduce((s, i) => s + watchMinutes(i), 0),
    }
  })
}

export interface CountryCount {
  code: string
  name: string
  flag: string
  count: number
}

const flagOf = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🏳️'

/** Pays d'origine (premier pays de chaque fiche vue). */
export function countries(items: MediaItem[]): { list: CountryCount[]; missing: number } {
  const names = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames([locale()], { type: 'region' }) : null
  const map = new Map<string, number>()
  let missing = 0
  for (const i of items) {
    if (i.status === 'a_voir') continue
    const c = i.countries?.[0]?.toUpperCase()
    if (!c) {
      missing++
      continue
    }
    map.set(c, (map.get(c) ?? 0) + 1)
  }
  const list = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count, flag: flagOf(code), name: names?.of(code) ?? code }))
  return { list, missing }
}

export interface Records {
  marathon?: { item: MediaItem; episodes: number }
  longestFilm?: MediaItem
  bestRated?: MediaItem[]
}

export function records(items: MediaItem[]): Records {
  const seen = items.filter((i) => i.status !== 'a_voir')
  const series = seen.filter((i) => TYPE_BY_VALUE[i.type].episodic && i.episodesWatched > 0)
  const marathonItem = series.sort((a, b) => b.episodesWatched - a.episodesWatched)[0]
  const films = seen.filter((i) => i.type === 'film' && i.status === 'termine' && i.duration)
  return {
    marathon: marathonItem ? { item: marathonItem, episodes: marathonItem.episodesWatched } : undefined,
    longestFilm: films.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0],
    bestRated: seen
      .filter((i) => (i.rating ?? 0) > 0)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (watchDate(b) ?? '').localeCompare(watchDate(a) ?? ''))
      .slice(0, 12),
  }
}
