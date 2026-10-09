import { t } from '../i18n'
import type { BackupFile, Criteria, CustomList, MediaItem, MediaType, NotifPrefs, Settings, TopCategory, TopEntry, WatchStatus } from '../types'
import { ALL_TOP_CATEGORIES, MEDIA_TYPES, STATUSES } from './constants'
import { episodeCap } from './franchise'
import { convertLegacyBackup, isLegacyBackup } from './legacyImport'
import {
  cleanText,
  isHexColor,
  isPlainObject,
  isSafeExternalId,
  isSafeId,
  LIMITS,
  safeCountries,
  safeDay,
  safeIso,
  remoteImage,
  safePosterUrl,
  safeSeasons,
  safeStringList,
} from './security'
import { normalizeText, todayISO, uid } from './utils'
import { normalizeChallenges, normalizeEpisodeLog } from './challenges'

const TYPES = new Set<string>(MEDIA_TYPES.map((t) => t.value))
const STATUS_SET = new Set<string>(STATUSES.map((s) => s.value))

const num = (v: unknown, min = 0, max = 1e6): number | undefined => {
  const n = typeof v === 'string' && v.length < 20 ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}
const int = (v: unknown, min = 0, max = 1e6) => {
  const n = num(v, min, max)
  return n == null ? undefined : Math.round(n)
}
const rating = (v: unknown) => {
  const n = num(v, 0, 10)
  return n == null || n === 0 ? undefined : Math.round(n * 2) / 2
}

const isTopCategory = (v: unknown): v is TopCategory => ALL_TOP_CATEGORIES.includes(v as TopCategory)

function normalizeTop(v: unknown): TopEntry | undefined {
  if (!isPlainObject(v)) return undefined
  const rank = Number(v.rank)
  return isTopCategory(v.category) && Number.isInteger(rank) && rank >= 1 && rank <= 5 ? { category: v.category, rank } : undefined
}

export function normalizeLists(v: unknown): CustomList[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: CustomList[] = []
  for (const l of v.slice(0, LIMITS.lists)) {
    if (!isPlainObject(l) || !isSafeId(l.id) || out.some((x) => x.id === l.id)) continue
    const name = cleanText(l.name, LIMITS.shortText)
    if (name) out.push({ id: l.id, name, createdAt: safeIso(l.createdAt) ?? new Date().toISOString() })
  }
  return out
}

/** Liste de dates AAAA-MM-JJ valides, triées, sans doublon (200 max). */
function safeDates(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = [...new Set(v.slice(0, 500).map(safeDay).filter((d): d is string => !!d))].sort().slice(-200)
  return out.length ? out : undefined
}

/** Tags perso : texte court, sans doublon (casse et accents ignorés), 30 max. */
export function safeTags(v: unknown): string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of safeStringList(v, LIMITS.tags * 2, LIMITS.tagLength)) {
    const s = tag.replace(/\s+/g, ' ').replace(/^#+/, '').trim()
    const key = normalizeText(s)
    if (!s || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= LIMITS.tags) break
  }
  return out.length ? out : undefined
}

/** Valide et nettoie une fiche (import, synchro, écriture locale). Renvoie null si inutilisable. */
export function normalizeItem(raw: unknown): MediaItem | null {
  if (!isPlainObject(raw)) return null
  const r = raw
  const title = cleanText(r.title, LIMITS.title)
  if (!title) return null
  const now = new Date().toISOString()
  const criteriaRaw = isPlainObject(r.criteria) ? r.criteria : {}
  const criteria: Criteria = {}
  for (const k of ['story', 'cast', 'direction', 'ost'] as const) {
    const v = rating(criteriaRaw[k])
    if (v != null) criteria[k] = v
  }
  const type = (TYPES.has(r.type as string) ? r.type : 'autre') as MediaType
  const episodesTotal = int(r.episodesTotal, 0, 100000) || undefined
  const seasons = safeSeasons(r.seasons)
  let episodesWatched = int(r.episodesWatched, 0, 100000) ?? 0
  // Plafond : toutes les saisons connues (la fiche peut en avoir plus que le total enregistré)
  const cap = episodeCap({ episodesTotal, seasons })
  if (cap && episodesWatched > cap) episodesWatched = cap
  const listIds = safeStringList(r.listIds, LIMITS.lists, 64).filter(isSafeId)
  const tags = safeTags(r.tags)
  return {
    id: isSafeId(r.id) ? r.id : uid(),
    title,
    originalTitle: cleanText(r.originalTitle, LIMITS.title),
    type,
    subtype: type === 'autre' ? cleanText(r.subtype, LIMITS.shortText) : undefined,
    year: int(r.year, 1870, 2200),
    status: (STATUS_SET.has(r.status as string) ? r.status : 'a_voir') as WatchStatus,
    rating: rating(r.rating),
    criteria,
    favorite: r.favorite === true || undefined,
    episodesWatched,
    episodesTotal,
    season: int(r.season, 0, 1000) || undefined,
    seasons,
    episodeDuration: int(r.episodeDuration, 0, 1440) || undefined,
    duration: int(r.duration, 0, 6000) || undefined,
    startDate: safeDay(r.startDate),
    endDate: safeDay(r.endDate),
    genres: safeStringList(r.genres, LIMITS.genres),
    platform: cleanText(r.platform, LIMITS.shortText),
    notes: cleanText(r.notes, LIMITS.notes),
    notesSpoiler: (r.notesSpoiler === true && !!cleanText(r.notes, LIMITS.notes)) || undefined,
    poster: safePosterUrl(r.poster),
    backdrop: remoteImage(r.backdrop),
    overview: cleanText(r.overview, LIMITS.overview),
    externalId: isSafeExternalId(r.externalId) ? r.externalId : undefined,
    top: normalizeTop(r.top),
    listIds: listIds.length ? listIds : undefined,
    tags,
    countries: safeCountries(r.countries),
    rewatchDates: safeDates(r.rewatchDates),
    episodeLog: normalizeEpisodeLog(r.episodeLog),
    publicRating: (() => {
      const n = num(r.publicRating, 0, 10)
      return n ? Math.round(n * 10) / 10 : undefined
    })(),
    createdAt: safeIso(r.createdAt) ?? now,
    updatedAt: safeIso(r.updatedAt) ?? now,
  }
}

/** Réglages importés : seules les valeurs connues et valides sont gardées. */
export function normalizeSettings(raw: unknown): Partial<Settings> | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: Partial<Settings> = {}
  if (raw.ratingScale === '5' || raw.ratingScale === '10') out.ratingScale = raw.ratingScale
  if (Array.isArray(raw.topCategories)) out.topCategories = ALL_TOP_CATEGORIES.filter((c) => (raw.topCategories as unknown[]).includes(c))
  if (isHexColor(raw.accentColor)) out.accentColor = raw.accentColor.toLowerCase()
  if (raw.themeMode === 'auto' || raw.themeMode === 'light' || raw.themeMode === 'dark' || raw.themeMode === 'night' || raw.themeMode === 'starfield') out.themeMode = raw.themeMode
  if (isPlainObject(raw.notifPrefs)) {
    const np: NotifPrefs = {}
    for (const k of ['episodes', 'follows', 'accepted', 'reactions', 'comments', 'lists'] as const) if (typeof raw.notifPrefs[k] === 'boolean') np[k] = raw.notifPrefs[k] as boolean
    out.notifPrefs = np
  }
  const challenges = normalizeChallenges(raw.challenges)
  if (challenges) out.challenges = challenges
  return out
}

/** Garde une seule fiche par identifiant (la dernière). */
function dedupe(items: MediaItem[]): MediaItem[] {
  return [...new Map(items.map((i) => [i.id, i])).values()]
}

export function buildBackup(items: MediaItem[], settings: Settings, lists: CustomList[] = []): BackupFile {
  // La clé TMDB n'est jamais incluse dans la sauvegarde
  const { tmdbKey: _omit, ...safeSettings } = settings
  return { app: 'AzuuCine', version: 1, exportedAt: new Date().toISOString(), settings: safeSettings, items, lists }
}

/**
 * Enregistre la sauvegarde. Sur mobile, ouvre la feuille de partage si possible
 * (iOS : « Enregistrer dans Fichiers »), sinon télécharge le fichier.
 */
export async function exportBackup(items: MediaItem[], settings: Settings, lists: CustomList[] = []): Promise<'shared' | 'downloaded'> {
  const json = JSON.stringify(buildBackup(items, settings, lists), null, 2)
  const filename = `azuucine-sauvegarde-${todayISO()}.json`
  const file = new File([json], filename, { type: 'application/json' })

  const isTouch = window.matchMedia?.('(pointer: coarse)').matches
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t('backup.shareTitle') })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e
      /* sinon : on retombe sur le téléchargement */
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

export interface ParsedBackup {
  items: MediaItem[]
  settings?: Partial<Settings>
  lists?: CustomList[]
  skipped: number
  /** Format reconnu */
  format: 'azuucine' | 'legacy'
}

/** Accepte le format AzuuCine, un simple tableau de fiches, ou une sauvegarde de l'ancienne appli. */
export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  if (file.size > LIMITS.importFileBytes) throw new Error(t('backup.tooBig'))
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(t('backup.notJson'))
  }
  if (isLegacyBackup(data)) {
    const legacy = convertLegacyBackup(data)
    return { items: dedupe(legacy.items), skipped: legacy.skipped, format: 'legacy' }
  }
  const rawItems = Array.isArray(data) ? data : isPlainObject(data) && Array.isArray(data.items) ? data.items : null
  if (!rawItems) throw new Error(t('backup.noItems'))
  if (rawItems.length > LIMITS.items) throw new Error(t('backup.tooMany', { n: LIMITS.items }))
  const items = dedupe(rawItems.map(normalizeItem).filter((i): i is MediaItem => i !== null))
  const settings = isPlainObject(data) ? normalizeSettings(data.settings) : undefined
  const lists = isPlainObject(data) ? normalizeLists(data.lists) : undefined
  return { items, settings, lists, skipped: rawItems.length - items.length, format: 'azuucine' }
}
