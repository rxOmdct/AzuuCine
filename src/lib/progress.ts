import type { MediaInput, MediaItem } from '../types'
import { episodeCap, seasonPosition } from './franchise'
import { todayISO } from './utils'

/**
 * Nouveau nombre d'épisodes vus → ce qui change sur la fiche.
 * Les dates se remplissent toutes seules :
 *  - premier épisode coché = date de début ;
 *  - dernier épisode coché = date de fin (et « Terminé ») ;
 *  - tout décoché = plus de date de début.
 */
export function episodesPatch(
  item: Pick<MediaItem, 'episodesWatched' | 'episodesTotal' | 'seasons' | 'season' | 'status' | 'startDate' | 'endDate'>,
  n: number,
  season?: number,
): Partial<MediaInput> {
  const cap = episodeCap(item)
  const watched = Math.max(0, cap ? Math.min(n, cap) : n)
  const patch: Partial<MediaInput> = { episodesWatched: watched }
  if (item.seasons) patch.season = season ?? seasonPosition({ ...item, episodesWatched: watched, season: undefined })?.season
  const today = todayISO()

  if (watched > 0) {
    if (!item.startDate || item.episodesWatched === 0) patch.startDate = item.episodesWatched === 0 ? today : item.startDate ?? today
    if (item.status === 'a_voir' || item.status === 'pause') patch.status = 'en_cours'
  } else {
    patch.startDate = undefined
    if (item.status === 'termine') patch.status = 'en_cours'
    patch.endDate = undefined
  }

  if (cap && watched >= cap) {
    patch.status = 'termine'
    // Date de fin = le jour où l'on coche le dernier épisode
    patch.endDate = item.status === 'termine' && item.endDate ? item.endDate : today
  } else if (watched > 0 && item.status === 'termine' && watched < item.episodesWatched) {
    patch.status = 'en_cours'
    patch.endDate = undefined
  }
  return patch
}
