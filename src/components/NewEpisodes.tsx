import { locale, t } from '../i18n'
import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadAiring, needsCheck, novelties, refreshAiring, saveAiring, trackable, type AiringCache } from '../lib/airing'
import { formatDate, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem } from '../types'
import Poster from './Poster'
import { SectionTitle } from './ui'

const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  const diff = Math.round((d.getTime() - new Date(todayISO() + 'T12:00:00').getTime()) / 86400000)
  if (diff <= 0) return t('time.today')
  if (diff === 1) return t('time.tomorrow')
  if (diff < 7) return d.toLocaleDateString(locale(), { weekday: 'long' })
  return t('time.onDate', { date: formatDate(iso) })
}

/** Section « Nouveautés » de l'accueil : nouveaux épisodes et nouvelles saisons. */
export default function NewEpisodes({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, loading, settings, patchMany, update } = useMedia()
  const [cache, setCache] = useState<AiringCache>(loadAiring)
  const [checking, setChecking] = useState(false)
  const started = useRef(false)

  const check = useCallback(
    async (force = false) => {
      setChecking(true)
      try {
        const next = await refreshAiring(items, loadAiring(), settings.tmdbKey, force)
        saveAiring(next)
        setCache(next)
        // Met à jour le nombre total d'épisodes des séries en cours si de nouveaux sont sortis
        const patches = trackable(items)
          .filter((i) => i.status !== 'termine' && next[i.id] && next[i.id].aired > (i.episodesTotal ?? 0))
          .map((i) => ({ id: i.id, patch: { episodesTotal: next[i.id].aired } }))
        if (patches.length) await patchMany(patches)
      } finally {
        setChecking(false)
      }
    },
    [items, settings.tmdbKey, patchMany],
  )

  // Vérification automatique au plus toutes les 12 h, au lancement
  useEffect(() => {
    if (loading || started.current || !navigator.onLine) return
    started.current = true
    const c = loadAiring()
    if (trackable(items).some((i) => needsCheck(i, c))) void check()
  }, [loading, items, check])

  const list = useMemo(() => novelties(items, cache), [items, cache])
  const tracked = trackable(items).length
  const hasAniList = trackable(items).some((i) => i.externalId!.startsWith('anilist:'))
  if (!tracked) return null

  const resume = (item: MediaItem, aired: number) =>
    update(item.id, { status: 'en_cours', episodesTotal: aired, startDate: item.startDate ?? todayISO(), endDate: undefined })

  return (
    <>
      <SectionTitle
        action={
          <button onClick={() => check(true)} disabled={checking} className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
            {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {checking ? t('settings.checking') : t('newEp.check')}
          </button>
        }
      >
        {t('newEp.title')}
      </SectionTitle>

      {list.length === 0 ? (
        <p className="text-sm text-ink-3">
          {checking
            ? t('newEp.checking')
            : !settings.tmdbKey && !hasAniList
              ? t('newEp.needKey')
              : t('newEp.nothing', { count: tracked })}
          {!checking && !settings.tmdbKey && hasAniList && ` ${t('newEp.needKeyAlso')}`}
        </p>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {list.map(({ item, info, unwatched, kind }) => (
            <div key={item.id} className="card flex w-64 shrink-0 gap-3 p-2.5">
              <button onClick={() => onOpen(item)} className="w-14 shrink-0">
                <Poster src={item.poster} title={item.title} />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="eyebrow text-accent">
                  {kind === 'new_season' ? t('newEp.newSeason') : kind === 'new_episodes' ? t('newEp.catchUp') : t('newEp.soon')}
                </span>
                <button onClick={() => onOpen(item)} className="mt-1 truncate text-left text-sm font-semibold">
                  {item.title}
                </button>
                <span className="mt-0.5 text-xs text-ink-2">
                  {kind === 'upcoming'
                    ? t('newEp.epWhen', { ep: info.next!.episode, when: dayLabel(info.next!.date) })
                    : t('newEp.available', { count: unwatched })}
                </span>
                {kind !== 'upcoming' && info.next && (
                  <span className="text-[11px] text-ink-3">
                    {t('newEp.next', { ep: info.next.episode, when: dayLabel(info.next.date) })}
                  </span>
                )}
                {kind === 'new_season' && (
                  <button onClick={() => resume(item, info.aired)} className="mt-auto self-start pt-1.5 text-xs font-semibold text-accent">
                    {t('newEp.resume')} →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
