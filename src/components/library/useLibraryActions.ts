import { t } from '../../i18n'
import { useCallback, useMemo } from 'react'
import { STATUS_BY_VALUE } from '../../lib/constants'
import { hasTag, statusPatch } from '../../lib/bulk'
import { LIMITS } from '../../lib/security'
import { normalizeText } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem, WatchStatus } from '../../types'
import { useToast } from '../Toast'

/**
 * Actions sur la bibliothèque qui proposent « Annuler » (suppression, statut, listes, tags).
 * L'annulation remet les fiches exactement comme avant (voir `restore` dans le store).
 */
export function useLibraryActions() {
  const { items, lists, updateMany, removeMany, restore } = useMedia()
  const toast = useToast()

  const pick = useCallback((ids: Iterable<string>) => {
    const wanted = new Set(ids)
    return items.filter((i) => wanted.has(i.id))
  }, [items])

  const undoable = useCallback(
    (message: string, snapshots: MediaItem[]) => toast.show(message, { undo: () => restore(snapshots) }),
    [toast, restore],
  )

  const listName = useCallback((id: string) => lists.find((l) => l.id === id)?.name ?? '', [lists])

  return useMemo(
    () => ({
      /** Supprime des fiches (avec « Annuler »). */
      async deleteItems(ids: Iterable<string>) {
        const snapshots = pick(ids)
        if (!snapshots.length) return
        await removeMany(snapshots.map((i) => i.id))
        undoable(
          snapshots.length === 1 ? t('toast.deleted', { title: snapshots[0].title }) : t('toast.deletedMany', { count: snapshots.length }),
          snapshots,
        )
      },

      /** Change le statut (dates et épisodes suivent, comme sur la fiche). */
      async setStatus(ids: Iterable<string>, status: WatchStatus) {
        const snapshots = pick(ids).filter((i) => i.status !== status)
        if (!snapshots.length) return
        await updateMany(snapshots.map((i) => ({ id: i.id, patch: statusPatch(i, status) })))
        const label = STATUS_BY_VALUE[status].label
        undoable(
          snapshots.length === 1 ? t('toast.status', { title: snapshots[0].title, status: label }) : t('toast.statusMany', { count: snapshots.length, status: label }),
          snapshots,
        )
      },

      async addToList(ids: Iterable<string>, listId: string, name?: string) {
        const snapshots = pick(ids).filter((i) => !i.listIds?.includes(listId))
        if (!snapshots.length) return
        await updateMany(snapshots.map((i) => ({ id: i.id, patch: { listIds: [...(i.listIds ?? []), listId] } })))
        undoable(t('toast.addedToList', { count: snapshots.length, list: name ?? listName(listId) }), snapshots)
      },

      async removeFromList(ids: Iterable<string>, listId: string) {
        const snapshots = pick(ids).filter((i) => i.listIds?.includes(listId))
        if (!snapshots.length) return
        await updateMany(snapshots.map((i) => ({ id: i.id, patch: { listIds: i.listIds!.filter((x) => x !== listId) } })))
        undoable(
          snapshots.length === 1 ? t('toast.removedFromList', { title: snapshots[0].title, list: listName(listId) }) : t('toast.removedFromListMany', { count: snapshots.length, list: listName(listId) }),
          snapshots,
        )
      },

      async addTag(ids: Iterable<string>, tag: string) {
        const snapshots = pick(ids).filter((i) => !hasTag(i, tag) && (i.tags?.length ?? 0) < LIMITS.tags)
        if (!snapshots.length || !tag) return
        await updateMany(snapshots.map((i) => ({ id: i.id, patch: { tags: [...(i.tags ?? []), tag] } })))
        undoable(t('toast.tagged', { count: snapshots.length, tag }), snapshots)
      },

      async removeTag(ids: Iterable<string>, tag: string) {
        const key = normalizeText(tag)
        const snapshots = pick(ids).filter((i) => hasTag(i, tag))
        if (!snapshots.length) return
        await updateMany(
          snapshots.map((i) => {
            const tags = i.tags!.filter((x) => normalizeText(x) !== key)
            return { id: i.id, patch: { tags: tags.length ? tags : undefined } }
          }),
        )
        undoable(t('toast.untagged', { count: snapshots.length, tag }), snapshots)
      },

      /** « Annuler » pour un changement fait ailleurs (fiche) : remet ces copies. */
      offerUndo: undoable,
    }),
    [pick, removeMany, updateMany, undoable, listName],
  )
}
