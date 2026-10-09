import type { MediaInput, MediaItem, MediaType, WatchStatus } from '../../types'
import { normalizeItem } from '../backup'
import { TYPE_BY_VALUE } from '../constants'
import { episodeCap, findFranchiseItem, franchiseKey, seasonPosition } from '../franchise'
import { cleanText, LIMITS } from '../security'
import { uid } from '../utils'
import type { Match } from './resolve'
import { titleKey, type ImportEntry } from './sources'

/**
 * Transforme les entrées trouvées en fiches AzuuCine et les fusionne avec la bibliothèque :
 *  - pas de doublon (même référence TMDB / AniList, même film, ou autre saison de la même série) ;
 *  - une fiche existante n'est jamais écrasée : on complète ce qui manque, et le statut / la progression
 *    n'avancent que si l'activité importée est plus récente que la dernière modification de la fiche.
 */

export interface ImportPlan {
  /** Nouvelles fiches */
  added: MediaItem[]
  /** Fiches existantes complétées */
  updated: MediaItem[]
  /** Titres déjà dans la bibliothèque, sans rien de nouveau */
  unchanged: number
  /** Entrées sans correspondance */
  notFound: ImportEntry[]
}

const RANK: Record<WatchStatus, number> = { a_voir: 0, pause: 1, abandonne: 1, en_cours: 2, termine: 3 }
const episodic = (type: MediaType) => TYPE_BY_VALUE[type]?.episodic ?? false
const typeOfKind = (e: ImportEntry): MediaType => (e.kind === 'movie' ? 'film' : e.kind === 'anime' ? (e.format === 'MOVIE' ? 'film' : 'anime') : 'serie')

interface Candidate {
  /** Fiche à créer (sans id définitif) */
  item: MediaItem
  /** Toutes les références externes couvertes (saisons AniList regroupées) */
  externalIds: string[]
  titles: string[]
  /** L'activité importée a une date connue */
  dated: boolean
  entries: ImportEntry[]
}

/** Fiche à partir d'une entrée (et de sa correspondance, si trouvée). */
function entryToItem(e: ImportEntry, match: Match | undefined, now: string): MediaItem {
  const meta: Partial<MediaInput> = match?.meta ?? { title: e.title, year: e.year, type: typeOfKind(e), genres: [] }
  const type = meta.type ?? typeOfKind(e)
  const isFilm = !episodic(type)
  const seasons = meta.seasons
  const cap = episodeCap({ episodesTotal: meta.episodesTotal, seasons })

  let status = e.status
  let episodesWatched = 0
  let season: number | undefined
  let { startDate, endDate } = e
  if (!isFilm) {
    if (e.seen) {
      // TV Time : épisodes cochés un par un
      episodesWatched = cap ? Math.min(cap, e.seen.size) : e.seen.size
      if (episodesWatched === 0) status = e.archived ? 'abandonne' : 'a_voir'
      else if (cap && episodesWatched >= cap) status = 'termine'
      else status = e.archived ? 'abandonne' : 'en_cours'
      if (status !== 'termine') endDate = undefined
      if (!seasons || seasons.length < 2) {
        const last = Math.max(0, ...[...e.seen].map((k) => Number(k.split(':')[0])))
        if (last > 0) season = last
      }
    } else {
      episodesWatched = e.episodesWatched ?? 0
      if (status === 'termine' && cap && episodesWatched < cap) episodesWatched = cap
      if (cap) episodesWatched = Math.min(cap, episodesWatched)
    }
    season = seasonPosition({ episodesWatched, seasons, season: undefined })?.season ?? season
  }
  if (status !== 'termine' && !isFilm) endDate = undefined
  if (status === 'a_voir') startDate = undefined

  return {
    ...meta,
    id: uid(),
    title: meta.title ?? e.title,
    type,
    genres: meta.genres ?? [],
    criteria: {},
    status,
    rating: status === 'a_voir' ? undefined : e.rating,
    favorite: e.favorite || undefined,
    episodesWatched,
    season,
    startDate,
    endDate: status === 'termine' || isFilm ? endDate : undefined,
    rewatchDates: e.rewatchDates,
    notes: e.notes,
    createdAt: e.firstSeen ?? now,
    updatedAt: e.activity ?? now,
  }
}

/** Saisons AniList d'une même série (« … Season 2 ») regroupées en une fiche, comme dans l'appli. */
function groupAnimeSeasons(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = []
  const groups = new Map<string, Candidate[]>()
  for (const c of cands) {
    const e = c.entries[0]
    const isAniSeries = (e.media || e.malId) && c.item.type === 'anime' && c.externalIds[0]?.startsWith('anilist:')
    if (!isAniSeries) {
      out.push(c)
      continue
    }
    const romaji = e.media?.title?.romaji ?? c.item.originalTitle ?? c.item.title
    const k = franchiseKey(romaji)
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0])
      continue
    }
    list.sort((a, b) => (a.item.year ?? 9999) - (b.item.year ?? 9999) || Number(a.externalIds[0].split(':')[1]) - Number(b.externalIds[0].split(':')[1]))
    const first = list[0].item
    const sizes = list.map((c) => c.item.episodesTotal)
    const allKnown = sizes.every((n): n is number => !!n)
    const statuses = list.map((c) => c.item.status)
    const status: WatchStatus = statuses.every((s) => s === 'termine')
      ? 'termine'
      : statuses.every((s) => s === 'a_voir')
        ? 'a_voir'
        : statuses.includes('en_cours') || (statuses.includes('termine') && statuses.includes('a_voir'))
          ? 'en_cours'
          : statuses.includes('pause')
            ? 'pause'
            : statuses.includes('abandonne')
              ? 'abandonne'
              : 'en_cours'
    const seasons = allKnown ? (sizes as number[]) : undefined
    const watched = list.reduce((sum, c) => sum + c.item.episodesWatched, 0)
    const rated = [...list].reverse().find((c) => c.item.rating != null)
    const days = (pickDay: (i: MediaItem) => string | undefined) => list.map((c) => pickDay(c.item)).filter((d): d is string => !!d).sort()
    const item: MediaItem = {
      ...first,
      status,
      seasons,
      episodesTotal: allKnown ? (sizes as number[]).reduce((a, b) => a + b, 0) : first.episodesTotal,
      episodesWatched: watched,
      season: seasonPosition({ episodesWatched: watched, seasons, season: undefined })?.season,
      rating: status === 'a_voir' ? undefined : rated?.item.rating,
      favorite: list.some((c) => c.item.favorite) || undefined,
      startDate: status === 'a_voir' ? undefined : days((i) => i.startDate)[0],
      endDate: status === 'termine' ? days((i) => i.endDate).pop() : undefined,
      notes: cleanText(list.map((c) => c.item.notes).filter(Boolean).join('\n\n'), LIMITS.notes),
      createdAt: list.map((c) => c.item.createdAt).sort()[0],
      updatedAt: list.map((c) => c.item.updatedAt).sort().pop()!,
    }
    out.push({
      item,
      externalIds: list.flatMap((c) => c.externalIds),
      titles: list.flatMap((c) => c.titles),
      dated: list.some((c) => c.dated),
      entries: list.flatMap((c) => c.entries),
    })
  }
  return out
}

/** Même film déjà dans la bibliothèque, ou même série (n'importe quelle saison). */
function findExisting(library: MediaItem[], c: Candidate): MediaItem | undefined {
  const byRef = library.find((i) => i.externalId && c.externalIds.includes(i.externalId))
  if (byRef) return byRef
  const keys = new Set(c.titles.map(titleKey).filter(Boolean))
  if (!episodic(c.item.type)) {
    return library.find(
      (i) =>
        !episodic(i.type) &&
        [i.title, i.originalTitle].some((x) => x && keys.has(titleKey(x))) &&
        (!i.year || !c.item.year || Math.abs(i.year - c.item.year) <= 1),
    )
  }
  return findFranchiseItem(library, c.titles, { type: c.item.type })
}

/** Complète une fiche existante sans jamais écraser ce que l'utilisateur a saisi. Renvoie null si rien ne change. */
function mergeInto(existing: MediaItem, c: Candidate, now: string): MediaItem | null {
  const inc = c.item
  const next: MediaItem = { ...existing }
  let changed = false
  const set = <K extends keyof MediaItem>(k: K, v: MediaItem[K]) => {
    next[k] = v
    changed = true
  }
  // L'activité importée est-elle plus récente que la dernière modification de ma fiche ?
  const newer = c.dated && inc.updatedAt > existing.updatedAt
  const canAdvance = existing.status === 'a_voir' || newer

  if (RANK[inc.status] > RANK[existing.status] && canAdvance) set('status', inc.status)
  if (episodic(existing.type) && inc.episodesWatched > existing.episodesWatched && canAdvance && (!existing.externalId || existing.externalId === inc.externalId)) {
    const cap = episodeCap(existing)
    set('episodesWatched', cap ? Math.min(cap, inc.episodesWatched) : inc.episodesWatched)
    const pos = seasonPosition({ episodesWatched: next.episodesWatched, seasons: existing.seasons, season: undefined })
    if (pos) next.season = pos.season
  }
  if (existing.rating == null && inc.rating != null) set('rating', inc.rating)
  if (!existing.favorite && inc.favorite) set('favorite', true)
  if (!existing.notes && inc.notes) set('notes', inc.notes)
  if (!existing.startDate && inc.startDate && next.status !== 'a_voir') set('startDate', inc.startDate)
  if (!existing.endDate && inc.endDate && next.status === 'termine') set('endDate', inc.endDate)
  if (inc.rewatchDates?.length) {
    const all = [...new Set([...(existing.rewatchDates ?? []), ...inc.rewatchDates])].filter((d) => d !== next.endDate).sort()
    if (all.length !== (existing.rewatchDates?.length ?? 0)) set('rewatchDates', all.slice(-200))
  }
  // Métadonnées manquantes (fiche saisie à la main) : on les complète
  if (!existing.externalId && inc.externalId && !refInUse(inc.externalId)) set('externalId', inc.externalId)
  if (!existing.poster && inc.poster) set('poster', inc.poster)
  if (!existing.overview && inc.overview) set('overview', inc.overview)
  if (!existing.year && inc.year) set('year', inc.year)
  if (!existing.genres.length && inc.genres.length) set('genres', inc.genres)
  if (!changed) return null
  next.updatedAt = now
  return normalizeItem(next)
}

// Références déjà utilisées par une autre fiche (évite deux fiches avec la même référence)
let usedRefs = new Set<string>()
const refInUse = (ref: string) => usedRefs.has(ref)

/** Prépare l'import (sans rien écrire). */
export function buildImportPlan(entries: ImportEntry[], matches: Map<string, Match>, library: MediaItem[], opts: { includeUnmatched: boolean }): ImportPlan {
  const now = new Date().toISOString()
  usedRefs = new Set(library.map((i) => i.externalId).filter((x): x is string => !!x))
  const notFound: ImportEntry[] = []
  const byRef = new Map<string, Candidate>()
  const loose: Candidate[] = []

  for (const e of entries) {
    const match = matches.get(e.key)
    if (!match && !opts.includeUnmatched) {
      notFound.push(e)
      continue
    }
    if (!match) notFound.push(e)
    const item = entryToItem(e, match, now)
    const ref = match?.result.externalId
    const cand: Candidate = {
      item,
      externalIds: ref ? [ref] : [],
      titles: [item.title, item.originalTitle, e.title, ...(match?.result.altTitles ?? [])].filter((x): x is string => !!x),
      dated: !!e.activity,
      entries: [e],
    }
    if (!ref) {
      loose.push(cand)
      continue
    }
    // Deux lignes du même titre (ex. deux années saisies différemment) : une seule fiche
    const prev = byRef.get(ref)
    if (prev) {
      const merged = mergeInto(prev.item, cand, prev.item.updatedAt)
      if (merged) prev.item = { ...merged, updatedAt: [prev.item.updatedAt, cand.item.updatedAt].sort().pop()! }
      prev.entries.push(e)
    } else byRef.set(ref, cand)
  }

  const cands = groupAnimeSeasons([...byRef.values()]).concat(loose)
  const added: MediaItem[] = []
  const updated = new Map<string, MediaItem>()
  let unchanged = 0
  const pool = [...library]
  for (const c of cands) {
    const existing = findExisting(pool, c)
    if (existing) {
      const base = updated.get(existing.id) ?? existing
      const merged = mergeInto(base, c, now)
      if (merged) {
        updated.set(existing.id, merged)
        const k = pool.indexOf(existing)
        if (k >= 0) pool[k] = merged
        if (merged.externalId) usedRefs.add(merged.externalId)
      } else if (!updated.has(existing.id)) unchanged++
      continue
    }
    const item = normalizeItem(c.item)
    if (!item) continue
    added.push(item)
    pool.push(item)
    if (item.externalId) usedRefs.add(item.externalId)
  }
  return { added, updated: [...updated.values()], unchanged, notFound }
}

/** Nombre de fiches par grande catégorie (aperçu). */
export function countByKind(items: MediaItem[]): { films: number; series: number; anime: number } {
  let films = 0
  let series = 0
  let anime = 0
  for (const i of items) {
    if (i.type === 'film') films++
    else if (i.type === 'anime') anime++
    else series++
  }
  return { films, series, anime }
}
