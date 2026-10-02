import { t } from '../i18n'
import { Heart, Plus } from 'lucide-react'
import { TYPE_BY_VALUE } from '../lib/constants'
import { useMedia } from '../store'
import type { MediaItem } from '../types'
import { StatusPill, TypeBadge } from './Badges'
import Poster from './Poster'
import { RatingBadge } from './Rating'

function Progress({ item }: { item: MediaItem }) {
  if (!TYPE_BY_VALUE[item.type].episodic || (!item.episodesWatched && !item.episodesTotal)) return null
  const pct = item.episodesTotal ? Math.min(100, (item.episodesWatched / item.episodesTotal) * 100) : 0
  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-[10.5px] text-ink-3">
        <span>
          {item.season ? `S${item.season} · ` : ''}{t('card.ep', { n: item.episodesWatched })}
          {item.episodesTotal ? `/${item.episodesTotal}` : ''}
        </span>
      </div>
      {item.episodesTotal ? (
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
    (!item.episodesTotal || item.episodesWatched < item.episodesTotal)

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

/** Ligne horizontale (accueil : « En cours »), avec compteur +1. */
export function MediaRow({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const { settings, incrementEpisode } = useMedia()
  const episodic = TYPE_BY_VALUE[item.type].episodic
  const done = !!item.episodesTotal && item.episodesWatched >= item.episodesTotal

  return (
    <article className="card flex items-center gap-3.5 p-3">
      <button onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="w-14 shrink-0">
          <Poster src={item.poster} title={item.title} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TypeBadge item={item} />
            <RatingBadge value={item.rating} scale={settings.ratingScale} />
          </div>
          <h3 className="mt-1.5 truncate text-[15px] font-semibold leading-tight">{item.title}</h3>
          {episodic ? <Progress item={item} /> : <StatusPill status={item.status} />}
        </div>
      </button>
      {episodic && !done && (
        <button
          onClick={() => incrementEpisode(item.id)}
          className="flex h-10 shrink-0 items-center gap-0.5 rounded-full border border-accent px-3.5 text-sm text-accent transition-colors active:bg-accent-fill active:text-on-accent"
          aria-label={t('card.plusOne', { title: item.title })}
        >
          <Plus size={14} strokeWidth={2.5} />1
        </button>
      )}
    </article>
  )
}
