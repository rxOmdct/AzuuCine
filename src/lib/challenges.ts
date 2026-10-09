import { locale, t } from '../i18n'
import type { Challenge, MediaItem, MediaType, Settings } from '../types'
import { MEDIA_TYPES, TYPE_BY_VALUE } from './constants'
import { cleanText, isPlainObject, isSafeId, safeDay } from './security'
import { localDay } from './utils'

/**
 * Défis de visionnage.
 *
 * Progression calculée à partir de la bibliothèque :
 *  - « titres terminés » : fiches « Terminé » dont la date de fin tombe dans la période, plus chaque revisionnage daté ;
 *  - « épisodes vus » : journal des épisodes cochés jour par jour (`episodeLog`, rempli depuis l'arrivée des défis).
 *    Les épisodes vus avant (ou saisis sans journal) n'ont pas de date : on les répartit uniformément entre la date
 *    de début et la date de fin de la fiche (ou, sans date de fin, jusqu'au premier jour journalisé / la dernière
 *    modification). Sans aucune date, ils ne sont pas comptés. Le résultat est alors marqué « estimation ».
 */

export const MAX_CHALLENGES = 15
export const NAME_MAX = 40
export const TARGET_MAX = 10000

type Media = Challenge['media']
const MEDIA_SET = new Set<string>(['all', ...MEDIA_TYPES.map((m) => m.value)])

// ─── Dates (jours entiers, sans fuseau) ───

const DAY = 86400000
const toNum = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, day) / DAY)
}
const fromNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
const asDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

/** Bornes de la période en cours (semaine du lundi au dimanche). */
export function periodBounds(period: Exclude<Challenge['period'], 'custom'>, today = localDay()): { start: string; end: string } {
  const [y, m] = today.split('-').map(Number)
  if (period === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` }
  if (period === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const mm = String(m).padStart(2, '0')
    return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${last}` }
  }
  const n = toNum(today)
  const weekday = (new Date(n * DAY).getUTCDay() + 6) % 7 // lundi = 0
  return { start: fromNum(n - weekday), end: fromNum(n - weekday + 6) }
}

// ─── Validation (réglages synchronisés, import) ───

export function normalizeChallenges(v: unknown): Challenge[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Challenge[] = []
  for (const r of v.slice(0, MAX_CHALLENGES * 2)) {
    if (out.length >= MAX_CHALLENGES) break
    if (!isPlainObject(r) || !isSafeId(r.id) || out.some((c) => c.id === r.id)) continue
    const target = typeof r.target === 'number' && Number.isFinite(r.target) ? Math.round(r.target) : NaN
    const start = safeDay(r.start)
    const end = safeDay(r.end)
    if (!(target >= 1 && target <= TARGET_MAX) || !start || !end || end < start) continue
    if (!MEDIA_SET.has(r.media as string)) continue
    const unit = r.unit === 'episodes' ? 'episodes' : r.unit === 'titles' ? 'titles' : null
    const period = r.period === 'week' || r.period === 'month' || r.period === 'year' || r.period === 'custom' ? r.period : null
    if (!unit || !period) continue
    const c: Challenge = { id: r.id, target, media: r.media as Media, unit, period, start, end }
    const name = cleanText(r.name, NAME_MAX)
    if (name) c.name = name
    if (r.archived === true) c.archived = true
    out.push(c)
  }
  return out
}

/** Import en mode « fusion » : on ajoute les défis inconnus sans écraser ceux de l'appareil. */
export function mergeImportedSettings(incoming: Partial<Settings>, current: Settings): Partial<Settings> {
  if (!incoming.challenges) return incoming
  const mine = current.challenges ?? []
  const ids = new Set(mine.map((c) => c.id))
  return { ...incoming, challenges: [...mine, ...incoming.challenges.filter((c) => !ids.has(c.id))].slice(0, MAX_CHALLENGES) }
}

export const newChallengeId = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0')

// ─── Journal des épisodes ───

const LOG_MAX_DAYS = 400

/** Nouveau journal après un changement du nombre d'épisodes vus (aujourd'hui). */
export function logEpisodes(log: Record<string, number> | undefined, delta: number, day = localDay()): Record<string, number> | undefined {
  if (!delta) return log
  const next = { ...(log ?? {}) }
  const value = Math.max(0, (next[day] ?? 0) + delta)
  if (value) next[day] = Math.min(value, 100000)
  else delete next[day]
  const days = Object.keys(next).sort()
  for (const d of days.slice(0, Math.max(0, days.length - LOG_MAX_DAYS))) delete next[d]
  return Object.keys(next).length ? next : undefined
}

export function normalizeEpisodeLog(v: unknown): Record<string, number> | undefined {
  if (!isPlainObject(v)) return undefined
  const entries = Object.entries(v)
    .slice(0, LOG_MAX_DAYS * 2)
    .filter(([d, n]) => safeDay(d) && typeof n === 'number' && Number.isFinite(n) && n >= 1)
    .map(([d, n]) => [d, Math.min(100000, Math.round(n as number))] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-LOG_MAX_DAYS)
  return entries.length ? Object.fromEntries(entries) : undefined
}

// ─── Progression ───

export interface CountedEntry {
  item: MediaItem
  /** Date (titres) ou dernier jour compté (épisodes) */
  date: string
  /** Nombre compté pour cette fiche (1 par titre, n épisodes) */
  amount: number
  rewatch?: boolean
  /** Une partie est estimée (épisodes sans date) */
  estimated?: boolean
}

export interface ChallengeProgress {
  count: number
  entries: CountedEntry[]
  estimated: boolean
  done: boolean
  /** Jour où l'objectif a été atteint */
  doneAt?: string
  state: 'upcoming' | 'active' | 'done' | 'missed'
  /** Écart avec le rythme régulier (positif : en avance) */
  pace: number
  daysLeft: number
  /** Jours avant le début (défi à venir) */
  startsIn: number
  /** Part de la période écoulée (0 → 1) */
  elapsed: number
}

const matches = (item: MediaItem, media: Media) => media === 'all' || item.type === media

/** Nombre compté par jour (pour la date de réussite et le rythme). */
function dailyCounts(c: Pick<Challenge, 'media' | 'unit' | 'start' | 'end'>, items: MediaItem[]) {
  const s = toNum(c.start)
  const e = toNum(c.end)
  const perDay = new Map<number, number>()
  const add = (day: number, n: number) => perDay.set(day, (perDay.get(day) ?? 0) + n)
  const entries: CountedEntry[] = []
  let estimated = false

  for (const item of items) {
    if (!matches(item, c.media)) continue
    if (c.unit === 'titles') {
      if (item.status === 'termine' && item.endDate && item.endDate >= c.start && item.endDate <= c.end) {
        entries.push({ item, date: item.endDate, amount: 1 })
        add(toNum(item.endDate), 1)
      }
      for (const d of item.rewatchDates ?? []) {
        if (d >= c.start && d <= c.end) {
          entries.push({ item, date: d, amount: 1, rewatch: true })
          add(toNum(d), 1)
        }
      }
      continue
    }

    // Épisodes (les films n'en ont pas)
    if (!TYPE_BY_VALUE[item.type].episodic || item.episodesWatched <= 0) continue
    let amount = 0
    let last = ''
    let partEstimated = false
    const log = item.episodeLog ?? {}
    const logDays = Object.keys(log).sort()
    let logged = 0
    for (const d of logDays) {
      logged += log[d]
      if (d >= c.start && d <= c.end) {
        amount += log[d]
        add(toNum(d), log[d])
        if (d > last) last = d
      }
    }
    const unlogged = Math.max(0, item.episodesWatched - logged)
    const from = item.startDate ?? item.endDate
    if (unlogged > 0 && from) {
      let to = item.endDate ?? (logDays[0] ? fromNum(toNum(logDays[0]) - 1) : item.updatedAt.slice(0, 10))
      if (!safeDay(to) || to < from) to = from
      const a = toNum(from)
      const b = toNum(to)
      const lo = Math.max(a, s)
      const hi = Math.min(b, e)
      if (hi >= lo) {
        const rate = unlogged / (b - a + 1)
        for (let d = lo; d <= hi; d++) add(d, rate)
        amount += rate * (hi - lo + 1)
        partEstimated = true
        const lastEst = fromNum(hi)
        if (lastEst > last) last = lastEst
      }
    }
    if (amount > 0.05) {
      if (partEstimated) estimated = true
      entries.push({ item, date: last, amount: partEstimated ? Math.max(1, Math.round(amount)) : amount, estimated: partEstimated })
    }
  }
  return { perDay, entries, estimated }
}

export function computeProgress(c: Challenge, items: MediaItem[], today = localDay()): ChallengeProgress {
  const { perDay, entries, estimated } = dailyCounts(c, items)
  const s = toNum(c.start)
  const e = toNum(c.end)
  const now = toNum(today)

  // Cumul jour par jour : date de réussite
  let total = 0
  let doneAt: string | undefined
  const days = [...perDay.keys()].sort((a, b) => a - b)
  for (const d of days) {
    total += perDay.get(d)!
    if (!doneAt && total + 1e-6 >= c.target) doneAt = fromNum(d)
  }
  const count = Math.round(total)
  const done = count >= c.target
  if (!done) doneAt = undefined
  else if (!doneAt) doneAt = fromNum(Math.min(now, e))

  const length = e - s + 1
  const elapsedDays = Math.min(length, Math.max(0, now - s + 1))
  const elapsed = elapsedDays / length
  const pace = count - c.target * elapsed
  const state: ChallengeProgress['state'] = done ? 'done' : now < s ? 'upcoming' : now > e ? 'missed' : 'active'

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.item.title.localeCompare(b.item.title, locale()))
  return { count, entries, estimated, done, doneAt, state, pace, daysLeft: Math.max(0, e - now), startsIn: Math.max(0, s - now), elapsed }
}

// ─── Textes ───

/** « 52 films », « 1 épisode », « 3 animes »… */
export function quantity(count: number, media: Media, unit: Challenge['unit']): string {
  if (unit === 'episodes') return t('challenges.qty.episode', { count })
  switch (media) {
    case 'film':
      return t('challenges.qty.film', { count })
    case 'serie':
      return t('challenges.qty.serie', { count })
    case 'anime':
      return t('challenges.qty.anime', { count })
    case 'kdrama':
      return t('challenges.qty.kdrama', { count })
    case 'cdrama':
      return t('challenges.qty.cdrama', { count })
    case 'autre':
      return t('challenges.qty.autre', { count })
    default:
      return t('challenges.qty.title', { count })
  }
}

export function mediaLabel(media: Media): string {
  return media === 'all' ? t('common.all') : TYPE_BY_VALUE[media as MediaType].label
}

const fmtYear = (d: string) => new Intl.NumberFormat(locale(), { useGrouping: false }).format(Number(d.slice(0, 4)))
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1)

export function periodLabel(c: Pick<Challenge, 'period' | 'start' | 'end'>): string {
  const loc = locale()
  try {
    if (c.period === 'year' && c.start.endsWith('-01-01') && c.end === `${c.start.slice(0, 4)}-12-31`) return fmtYear(c.start)
    if (c.period === 'month') return capitalize(new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(asDate(c.start)))
    if (c.period === 'week') return t('challenges.weekOf', { date: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', calendar: 'gregory' }).format(asDate(c.start)) })
    const sameYear = c.start.slice(0, 4) === c.end.slice(0, 4)
    const f = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric', calendar: 'gregory' })
    const fs = sameYear ? new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', calendar: 'gregory' }) : f
    return `${fs.format(asDate(c.start))} – ${f.format(asDate(c.end))}`
  } catch {
    return `${c.start} – ${c.end}`
  }
}

/** Titre affiché : nom choisi, sinon « 52 films · 2026 ». */
export function challengeTitle(c: Challenge): string {
  if (c.name) return c.name
  const parts = [quantity(c.target, c.media, c.unit)]
  if (c.unit === 'episodes' && c.media !== 'all') parts.push(TYPE_BY_VALUE[c.media as MediaType].label)
  return parts.join(' · ')
}

export function formatDay(d: string): string {
  try {
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', calendar: 'gregory' }).format(asDate(d))
  } catch {
    return d
  }
}

/** Modèles prêts à l'emploi */
export interface ChallengeTemplate {
  target: number
  media: Media
  unit: Challenge['unit']
  period: Exclude<Challenge['period'], 'custom'>
}

export const TEMPLATES: ChallengeTemplate[] = [
  { target: 52, media: 'film', unit: 'titles', period: 'year' },
  { target: 4, media: 'anime', unit: 'titles', period: 'month' },
  { target: 20, media: 'all', unit: 'episodes', period: 'week' },
  { target: 10, media: 'kdrama', unit: 'titles', period: 'year' },
  { target: 100, media: 'all', unit: 'titles', period: 'year' },
  { target: 5, media: 'film', unit: 'titles', period: 'month' },
  { target: 12, media: 'serie', unit: 'titles', period: 'year' },
  { target: 6, media: 'cdrama', unit: 'titles', period: 'year' },
]

export function fromTemplate(tpl: ChallengeTemplate, today = localDay()): Challenge {
  return { id: newChallengeId(), target: tpl.target, media: tpl.media, unit: tpl.unit, period: tpl.period, ...periodBounds(tpl.period, today) }
}

/** Même défi sur la période en cours (« Recommencer »). */
export function renewed(c: Challenge, today = localDay()): Challenge {
  const bounds = c.period === 'custom' ? (() => {
    const len = toNum(c.end) - toNum(c.start)
    return { start: today, end: fromNum(toNum(today) + len) }
  })() : periodBounds(c.period, today)
  return { ...c, id: newChallengeId(), archived: undefined, ...bounds }
}

// ─── Célébration (une fois par défi et par appareil) ───

const CELEBRATED_KEY = 'azuucine:challenges-celebrated'

export function celebrated(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-200) : [])
  } catch {
    return new Set()
  }
}

export function markCelebrated(id: string) {
  try {
    const set = celebrated()
    set.add(id)
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...set].slice(-200)))
  } catch {
    /* ignore */
  }
}
