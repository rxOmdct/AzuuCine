import type { MediaInput, MediaItem, WatchStatus } from '../types'
import { TYPE_BY_VALUE } from './constants'
import { episodeCap } from './franchise'
import { LIMITS } from './security'
import { normalizeText, todayISO } from './utils'

/**
 * Nouveau statut → ce qui change sur la fiche (mêmes règles que les boutons de la fiche) :
 * « À voir » efface les dates, « Vu » date la fin (et coche tous les épisodes connus)…
 */
export function statusPatch(item: MediaItem, s: WatchStatus): Partial<MediaInput> {
  const patch: Partial<MediaInput> = { status: s }
  const episodic = TYPE_BY_VALUE[item.type].episodic
  const today = todayISO()
  if (s === 'a_voir') Object.assign(patch, { startDate: undefined, endDate: undefined })
  if (s === 'en_cours') Object.assign(patch, { startDate: episodic && !item.episodesWatched ? item.startDate : (item.startDate ?? today), endDate: undefined })
  if (s === 'termine') {
    patch.endDate = item.status === 'termine' && item.endDate ? item.endDate : today
    if (!item.startDate) patch.startDate = episodic && item.episodesWatched ? today : patch.endDate
    const cap = episodeCap(item)
    if (episodic && cap) patch.episodesWatched = cap
  }
  return patch
}

/** Tag saisi → tag enregistré : sans « # », espaces simplifiés, et même écriture qu'un tag existant. */
export function cleanTag(input: string, existing: string[] = []): string {
  const s = input.replace(/\s+/g, ' ').replace(/^#+/, '').trim().slice(0, LIMITS.tagLength)
  const key = normalizeText(s)
  return existing.find((e) => normalizeText(e) === key) ?? s
}

/** Tous les tags utilisés dans la bibliothèque, du plus fréquent au moins fréquent. */
export function allTags(items: MediaItem[]): string[] {
  const count = new Map<string, number>()
  for (const i of items) for (const tag of i.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}

export const hasTag = (item: MediaItem, tag: string) => {
  const key = normalizeText(tag)
  return !!item.tags?.some((x) => normalizeText(x) === key)
}
