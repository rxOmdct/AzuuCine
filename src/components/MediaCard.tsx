import { t } from '../i18n'
import { Heart, Plus } from 'lucide-react'
import { TYPE_BY_VALUE } from '../lib/constants'
import { canWatchMore } from '../lib/airing'
import { episodeCap, seasonPosition } from '../lib/franchise'
import { useMedia } from '../store'
import type { MediaItem } from '../types'
import { StatusPill, TypeBadge } from './Badges'
import Poster from './Poster'
import { RatingBadge } from './Rating'

function Progress({ item }: { item: MediaItem }) {
  const cap = episodeCap(item)
  if (!TYPE_BY_VALUE[item.type].episodic || (!item.episodesWatched && !cap)) return null
  // Série en plusieurs saisons : progression dans la saison en cours
  const pos = seasonPosition(item)
  const done = pos ? pos.episode : item.episodesWatched
  const size = pos ? pos.size : cap
  const pct = size ? Math.min(100, (done / size) * 100) : 0
  const season = pos?.season ?? item.season
  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-[10.5px] text-ink-3">
        <span>
          {season ? `${t('episodes.seasonShort', { n: season })} · ` : ''}{t('card.ep', { n: done })}
          {size ? `/${size}` : ''}
        </span>
      </div>
      {size ? (
        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/** Carte verticale (grille du catalogue). */
export function MediaCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const { settings, incrementEpisode } = useMedia()
  const canIncrement =
    TYPE_BY_VALUE[item.type].episodic &&
    item.status === 'en_cours' &&
    canWatchMore(item)

  return (
    <article>
      <div className="relative">
        <button onClick={() => onOpen(item)} className="block w-full" aria-label={t('card.open', { title: item.title })}>
          <Poster src={item.poster} title={item.title} />
        </button>
        <TypeBadge item={item} className="pointer-events-none absolute left-2 top-2 border-transparent bg-bg/85" />
        {item.favorite && (
          <Heart size={15} className="pointer-events-none absolute right-2 top-2 fill-accent text-accent" />
        )}
        {canIncrement && (
          <button
            onClick={() => incrementEpisode(item.id)}
            className="absolute bottom-2 right-2 flex h-8 items-center gap-0.5 rounded-full bg-accent-fill px-3 text-xs font-medium text-on-accent transition active:scale-90"
            aria-label={t('card.plusOne', { title: item.title })}
          >
            <Plus size={13} strokeWidth={2.5} />1
          </button>
        )}
      </div>
      <button onClick={() => onOpen(item)} className="block w-full text-left">
        <h3 className="mt-2.5 line-clamp-2 font-sans text-sm font-semibold leading-snug tracking-normal">{item.title}</h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <StatusPill status={item.status} />
          <RatingBadge value={item.rating} scale={settings.ratingScale} />
        </div>
        <Progress item={item} />
      </button>
    </article>
  )
}
