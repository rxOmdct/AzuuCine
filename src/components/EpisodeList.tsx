import { Check, Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { locale, t } from '../i18n'
import { getTmdbSeasonEpisodes, type EpisodeInfo } from '../lib/catalogApi'
import { episodeCap, episodesBeforeSeason, seasonPosition } from '../lib/franchise'
import { cx, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput } from '../types'

interface Props {
  form: Pick<MediaInput, 'externalId' | 'episodesWatched' | 'episodesTotal' | 'seasons' | 'season'>
  /** Nouveau nombre d'épisodes vus (et saison choisie) */
  onChange: (episodesWatched: number, season?: number) => void
}

const MAX_GENERIC = 500

/**
 * Liste des épisodes, saison par saison (façon plateforme de streaming).
 * Toucher un épisode le marque comme vu, ainsi que tous ceux d'avant ; retoucher le dernier vu l'annule.
 */
export default function EpisodeList({ form, onChange }: Props) {
  const { settings } = useMedia()
  const seasons = form.seasons
  const pos = seasonPosition(form)
  const [viewSeason, setViewSeason] = useState(pos?.season ?? 1)
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>()
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const today = todayISO()
  const key = settings.tmdbKey?.trim()
  const isTmdb = !!form.externalId?.startsWith('tmdb:tv:') && !!key

  // Taille de la saison affichée (ou de toute la série si on ne connaît pas le découpage)
  const before = seasons ? episodesBeforeSeason(seasons, viewSeason) : 0
  const size = seasons ? seasons[viewSeason - 1] : Math.min(episodeCap(form) ?? 0, MAX_GENERIC)

  useEffect(() => {
    if (!isTmdb || !navigator.onLine) return setEpisodes(undefined)
    let alive = true
    setLoading(true)
    getTmdbSeasonEpisodes(form.externalId!, seasons ? viewSeason : 1, key!)
      .then((list) => alive && setEpisodes(list.length ? list : undefined))
      .catch(() => alive && setEpisodes(undefined))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [isTmdb, form.externalId, viewSeason, seasons, key])

  // Les infos TMDB complètent la liste ; sans elles (AniList, hors-ligne), on numérote simplement
  const count = Math.max(size, seasons ? 0 : (episodes?.length ?? 0))
  const rows: EpisodeInfo[] = Array.from({ length: count }, (_, k) => episodes?.find((e) => e.number === k + 1) ?? { number: k + 1 })
  const watchedHere = Math.max(0, Math.min(count, form.episodesWatched - before))

  // Ouvre la liste au niveau du prochain épisode à voir
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ep="${Math.min(count, watchedHere + 1)}"]`)
    if (el && listRef.current) listRef.current.scrollTop = Math.max(0, el.offsetTop - listRef.current.offsetTop - 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSeason, count, episodes])

  const toggle = (n: number) => {
    const target = before + n
    // Retoucher le dernier épisode vu = l'annuler
    const next = form.episodesWatched === target ? target - 1 : target
    onChange(Math.max(0, next), seasons ? viewSeason : undefined)
  }

  const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: d.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })

  if (!count) return null

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        {seasons ? (
          <select
            value={viewSeason}
            onChange={(e) => setViewSeason(Number(e.target.value))}
            className="field w-auto py-2 pr-9 text-sm font-semibold"
            aria-label={t('form.season')}
          >
            {seasons.map((n, k) => (
              <option key={k} value={k + 1}>
                {t('episodes.seasonOption', { season: k + 1, count: n })}
              </option>
            ))}
          </select>
        ) : (
          <span className="eyebrow">{t('form.episodes')}</span>
        )}
        <span className="flex items-center gap-2 text-xs text-ink-3">
          {loading && <Loader2 size={13} className="animate-spin" />}
          {t('episodes.seen', { done: watchedHere, total: count })}
        </span>
      </div>

      <div ref={listRef} className="max-h-[26rem] space-y-1 overflow-y-auto overscroll-contain pr-1">
        {rows.map((e) => {
          const seen = e.number <= watchedHere
          const upcoming = !!e.date && e.date > today
          return (
            <button
              key={e.number}
              type="button"
              data-ep={e.number}
              onClick={() => toggle(e.number)}
              aria-pressed={seen}
              className={cx('flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors active:bg-surface-2', upcoming && 'opacity-50')}
            >
              <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
                {e.still ? (
                  <img src={e.still} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center text-sm font-semibold text-ink-3">{e.number}</span>
                )}
                {seen && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  {t('episodes.short', { n: e.number })}
                  {e.date && ` · ${upcoming ? t('episodes.upcoming', { date: fmtDate(e.date) }) : fmtDate(e.date)}`}
                </span>
                <span className={cx('mt-0.5 line-clamp-2 text-sm leading-snug', seen ? 'text-ink-3' : 'text-ink')}>
                  {e.name && !/^(episode|épisode|episodio|folge|第)\s*\d+/i.test(e.name) ? e.name : t('episodes.nameless', { n: e.number })}
                </span>
              </span>
              <span
                className={cx(
                  'grid size-7 shrink-0 place-items-center rounded-full border transition-colors',
                  seen ? 'border-accent bg-accent-fill text-on-accent' : 'border-line-strong text-transparent',
                )}
              >
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
