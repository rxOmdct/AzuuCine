import { Check, Loader2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { getTmdbPosterUrl } from '../../lib/catalogApi'
import { addSharedListItem, getSharedLists, removeSharedListItem, snapshotOf, type SharedListCard } from '../../lib/cloud/sharedLists'
import { cx } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import { useSocial } from './SocialProvider'

/**
 * « Ajouter à une liste » côté listes partagées, dans la fiche d'un titre.
 * N'apparaît que si j'ai au moins une liste partagée (et si le serveur les gère déjà).
 */
export default function SharedListPicker({ snapshot, posterFallback }: { snapshot: Pick<MediaItem, 'externalId' | 'title' | 'type' | 'year' | 'poster'>; posterFallback?: string }) {
  const social = useSocial()
  const { settings } = useMedia()
  const [lists, setLists] = useState<SharedListCard[]>()
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<string>()
  const externalId = snapshot.externalId

  useEffect(() => {
    if (!social.enabled || !externalId) return
    let alive = true
    getSharedLists(externalId)
      .then((d) => alive && setLists(d.lists))
      .catch(() => alive && setLists([]))
    return () => {
      alive = false
    }
  }, [social.enabled, externalId, social.sharedTick])

  if (!social.enabled || !lists?.length) return null

  const toggle = async (l: SharedListCard) => {
    const snap = snapshotOf(snapshot, posterFallback)
    if (!snap) return
    setBusy(l.id)
    setErr(undefined)
    try {
      if (l.has) await removeSharedListItem(l.id, snap.externalId)
      else {
        // L'affiche gardée hors-ligne (copie locale) ne se partage pas : on reprend l'adresse TMDB
        if (!snap.poster && snap.externalId.startsWith('tmdb:') && settings.tmdbKey && navigator.onLine) {
          snap.poster = await getTmdbPosterUrl(snap.externalId, settings.tmdbKey).catch(() => undefined)
        }
        await addSharedListItem(l.id, snap)
      }
      setLists((prev) => prev?.map((x) => (x.id === l.id ? { ...x, has: !l.has, count: x.count + (l.has ? -1 : 1) } : x)))
      social.bumpShared()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className="mx-4 mt-8 border-t border-line pt-5" aria-labelledby="shared-picker-title">
      <h3 id="shared-picker-title" className="eyebrow mb-3 flex items-center gap-1.5 text-ink-2">
        <Users size={13} aria-hidden="true" /> {t('shared.addTo')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {lists.map((l) => (
          <button key={l.id} onClick={() => void toggle(l)} disabled={busy === l.id} aria-pressed={l.has} className={cx('chip', l.has && 'chip-on')}>
            {busy === l.id ? <Loader2 size={14} className="animate-spin" /> : l.has ? <Check size={14} /> : <Users size={14} />}
            {l.name}
          </button>
        ))}
      </div>
      {err && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {err}
        </p>
      )}
    </section>
  )
}
