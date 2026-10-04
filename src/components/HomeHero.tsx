import { Check, Info, Plus } from 'lucide-react'
import { t } from '../i18n'
import { TYPE_BY_VALUE } from '../lib/constants'
import { episodeCap, seasonPosition } from '../lib/franchise'
import { genreLabel } from '../lib/genres'
import { useMedia } from '../store'
import type { MediaItem } from '../types'

/** Où j'en suis : « S2 · É3 » (épisode suivant à voir) */
export function nextEpisodeLabel(item: MediaItem): string | undefined {
  if (!TYPE_BY_VALUE[item.type].episodic) return undefined
  const cap = episodeCap(item)
  if (cap && item.episodesWatched >= cap) return undefined
  const pos = seasonPosition({ ...item, episodesWatched: item.episodesWatched + 1, season: undefined })
  const ep = t('episodes.short', { n: pos ? pos.episode : item.episodesWatched + 1 })
  return pos ? `S${pos.season} · ${ep}` : ep
}

/** Grande bannière de l'accueil : le titre que je regarde en ce moment (ou le prochain à voir). */
export default function HomeHero({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const { incrementEpisode } = useMedia()
  const image = item.backdrop ?? item.poster
  const next = nextEpisodeLabel(item)
  const episodic = TYPE_BY_VALUE[item.type].episodic
  const meta = [TYPE_BY_VALUE[item.type].label, item.year, ...item.genres.slice(0, 2).map(genreLabel)].filter(Boolean).join(' · ')

  return (
    <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
      <button onClick={() => onOpen(item)} className="relative block aspect-[4/3] w-full bg-surface-2 sm:aspect-video" aria-label={t('card.open', { title: item.title })}>
        {image && <img src={image} alt="" className={item.backdrop ? 'size-full object-cover' : 'size-full scale-110 object-cover blur-md'} />}
        <span className="absolute inset-0 bg-bg/50" />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
        <p className="eyebrow text-ink-2">{item.status === 'en_cours' ? t('homeHero.continue') : t('homeHero.next')}</p>
        <h2 className="mt-1.5 line-clamp-2 text-[1.9rem] font-bold leading-[1.1]">{item.title}</h2>
        {meta && <p className="mt-1.5 text-xs text-ink-2">{meta}</p>}
        <div className="pointer-events-auto mt-4 flex gap-2">
          {episodic && next ? (
            <button onClick={() => incrementEpisode(item.id)} className="btn btn-primary px-5">
              <Plus size={17} strokeWidth={2.5} /> {t('hero.seenEp', { ep: next })}
            </button>
          ) : episodic ? (
            <span className="btn btn-ghost px-5">
              <Check size={17} /> {t('hero.allSeen')}
            </span>
          ) : null}
          <button onClick={() => onOpen(item)} className="btn btn-ghost bg-bg/60 px-4">
            <Info size={17} /> {t('homeHero.details')}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Carte horizontale « Reprendre » : image, barre de progression, prochain épisode. */
export function ContinueCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const { incrementEpisode } = useMedia()
  const image = item.backdrop ?? item.poster
  const pos = seasonPosition(item)
  const cap = episodeCap(item)
  const done = pos ? pos.episode : item.episodesWatched
  const size = pos ? pos.size : cap
  const pct = size ? Math.min(100, (done / size) * 100) : 0
  const next = nextEpisodeLabel(item)

  return (
    <article className="w-60 shrink-0">
      <div className="relative">
        <button onClick={() => onOpen(item)} className="relative block aspect-video w-full overflow-hidden rounded-xl border border-line bg-surface-2" aria-label={t('card.open', { title: item.title })}>
          {image && <img src={image} alt="" loading="lazy" className="size-full object-cover" />}
          {size ? (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-bg/70">
              <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
        </button>
        {next && (
          <button
            onClick={() => incrementEpisode(item.id)}
            className="absolute bottom-3 right-2 flex h-8 items-center gap-0.5 rounded-full bg-accent-fill px-3 text-xs font-semibold text-on-accent transition active:scale-90"
            aria-label={t('card.plusOne', { title: item.title })}
          >
            <Plus size={13} strokeWidth={2.5} />1
          </button>
        )}
      </div>
      <button onClick={() => onOpen(item)} className="mt-2 block w-full text-left">
        <span className="block truncate text-sm font-semibold">{item.title}</span>
        <span className="block text-xs text-ink-3">{next ? t('homeHero.nextUp', { ep: next }) : t('hero.allSeen')}</span>
      </button>
    </article>
  )
}
