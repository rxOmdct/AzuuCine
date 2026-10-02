import type { MediaInput, MediaItem } from '../types'
import { getAniListPublicRatings, getTmdbPublicRating } from './catalogApi'
import { isSafeExternalId, readStorage } from './security'

/**
 * Récupère la note moyenne du public (TMDB / AniList) pour les fiches qui n'en ont pas.
 * Les titres sans note fiable (trop peu de votes) sont mémorisés pour ne pas être redemandés à chaque fois.
 */

const CHECKED_KEY = 'azuucine:public-checked'
const RECHECK_MS = 30 * 24 * 3600 * 1000

function loadChecked(): Record<string, number> {
  const raw = readStorage(CHECKED_KEY, {})
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number') out[k] = v
  }
  return out
}

function saveChecked(c: Record<string, number>) {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

/** Fiches notées par moi, reliées à une base, sans note publique (et pas vérifiées récemment). */
export function missingPublic(items: MediaItem[], tmdbKey?: string): MediaItem[] {
  const checked = loadChecked()
  const now = Date.now()
  return items.filter(
    (i) =>
      i.publicRating == null &&
      isSafeExternalId(i.externalId) &&
      (i.externalId.startsWith('anilist:') || !!tmdbKey) &&
      !(checked[i.id] && now - checked[i.id] < RECHECK_MS),
  )
}

export async function fetchPublicRatings(
  items: MediaItem[],
  tmdbKey: string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<{ id: string; patch: Partial<MediaInput> }[]> {
  const todo = missingPublic(items, tmdbKey).slice(0, 400)
  const patches: { id: string; patch: Partial<MediaInput> }[] = []
  const checked = loadChecked()
  let done = 0
  const total = todo.length

  const ani = todo.filter((i) => i.externalId!.startsWith('anilist:'))
  if (ani.length) {
    try {
      const map = await getAniListPublicRatings(ani.map((i) => Number(i.externalId!.split(':')[1])))
      for (const i of ani) {
        const r = map.get(Number(i.externalId!.split(':')[1]))
        if (r) patches.push({ id: i.id, patch: { publicRating: r } })
        checked[i.id] = Date.now()
      }
    } catch {
      /* réseau : on réessaiera */
    }
    done += ani.length
    onProgress?.(done, total)
  }

  if (tmdbKey) {
    const tmdb = todo.filter((i) => i.externalId!.startsWith('tmdb:'))
    for (let k = 0; k < tmdb.length; k += 4) {
      await Promise.all(
        tmdb.slice(k, k + 4).map(async (i) => {
          try {
            const r = await getTmdbPublicRating(i.externalId!, tmdbKey)
            if (r) patches.push({ id: i.id, patch: { publicRating: r } })
            checked[i.id] = Date.now()
          } catch {
            /* ignore ce titre */
          }
        }),
      )
      done += tmdb.slice(k, k + 4).length
      onProgress?.(done, total)
    }
  }
  saveChecked(checked)
  return patches
}
