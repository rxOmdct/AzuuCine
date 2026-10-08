import { Check, Loader2, MessagesSquare, Plus, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { genreLabel } from '../../lib/genres'
import { useScrollLock } from '../../lib/scrollLock'
import { titleReviews, type TitleReview } from '../../lib/cloud/reviews'
import { useSocial } from './SocialProvider'
import { cx, formatDate, formatRating, normalizeText } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaInput, MediaItem } from '../../types'
import { StatusPill, TypeBadge } from '../Badges'
import Poster from '../Poster'
import Avatar from './Avatar'
import Reactions from './Reactions'
import { useEscape } from '../../lib/escape'

export interface PeekOwner {
  username: string
  displayName: string
  avatarUrl?: string
}

/** Aperçu d'un titre de quelqu'un d'autre : sa note, son avis public, et ajout à ma liste « À voir ». */
export default function ItemPeek({ item, owner, onClose }: { item: MediaItem; owner?: PeekOwner; onClose: () => void }) {
  const { items, add, settings } = useMedia()
  const social = useSocial()
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  // Avis d'un autre membre : on récupère les réactions pour pouvoir réagir ici même
  const [review, setReview] = useState<TitleReview>()
  const canReact = !!owner && owner.username !== social.me?.username && !!item.notes && !!item.externalId
  useEffect(() => {
    if (!canReact) return
    let alive = true
    titleReviews(item.externalId!)
      .then((d) => {
        if (!alive) return
        const all = [...d.friends, ...d.others]
        setReview(all.find((r) => r.user.username === owner!.username))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [canReact, item.externalId, owner])
  const owned = items.some(
    (i) => (item.externalId && i.externalId === item.externalId) || normalizeText(i.title) === normalizeText(item.title),
  )

  useScrollLock()

  useEscape(onClose)

  const addToWatchlist = async () => {
    setBusy(true)
    try {
      const input: MediaInput = {
        title: item.title,
        originalTitle: item.originalTitle,
        type: item.type,
        subtype: item.subtype,
        year: item.year,
        status: 'a_voir',
        criteria: {},
        episodesWatched: 0,
        episodesTotal: item.episodesTotal,
        seasons: item.seasons,
        episodeDuration: item.episodeDuration,
        duration: item.duration,
        genres: item.genres,
        platform: item.platform,
        poster: item.poster,
        backdrop: item.backdrop,
        overview: item.overview,
        externalId: item.externalId,
        countries: item.countries,
        publicRating: item.publicRating,
      }
      await add(input)
      setAdded(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex touch-none items-end justify-center overscroll-none bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="sheet-in safe-bottom max-h-[88dvh] w-full max-w-md touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl border border-line-strong bg-surface p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          <div className="w-24 shrink-0">
            <Poster src={item.poster} title={item.title} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug">{item.title}</h2>
            {item.originalTitle && <p className="truncate text-sm text-ink-3">{item.originalTitle}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <TypeBadge item={item} />
              {item.year && <span>{item.year}</span>}
            </div>
            {item.genres.length > 0 && <p className="mt-2 line-clamp-1 text-xs text-ink-3">{item.genres.slice(0, 3).map(genreLabel).join(' · ')}</p>}
          </div>
        </div>

        {owner && (
          <div className="mt-5 rounded-2xl border border-line p-3.5">
            <div className="flex items-center gap-2.5">
              <Avatar url={owner.avatarUrl} name={owner.displayName} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{owner.displayName}</span>
              {item.rating != null && (
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <Star size={14} className="fill-accent text-accent" />
                  {formatRating(item.rating, settings.ratingScale)}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              <StatusPill status={item.status} />
              {item.endDate && item.status === 'termine' && <span>{formatDate(item.endDate)}</span>}
              {item.favorite && <span className="text-accent">♥ {t('form.favorite')}</span>}
            </div>
            {item.notes && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-2">{item.notes}</p>}
            {canReact && review && (
              <div className="mt-3 border-t border-line pt-3">
                <Reactions authorId={review.user_id} itemId={review.item_id} reactions={review.reactions} mine={review.mine} />
              </div>
            )}
          </div>
        )}

        {item.externalId && (
          <button onClick={() => { onClose(); social.openReviews(item.externalId!, item.title) }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-2 transition-colors active:bg-surface-2">
            <MessagesSquare size={16} /> {t('reviews.seeAll')}
          </button>
        )}

        {item.overview && <p className="mt-4 line-clamp-5 text-sm leading-relaxed text-ink-2">{item.overview}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="btn btn-ghost">
            {t('common.close')}
          </button>
          <button onClick={addToWatchlist} disabled={busy || added || owned} className={cx('btn', added || owned ? 'btn-ghost' : 'btn-primary')}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : added || owned ? <Check size={16} /> : <Plus size={16} />}
            {added ? t('reco.addedShort') : owned ? t('social.inLibrary') : t('social.addToWatch')}
          </button>
        </div>
      </div>
    </div>
  )
}
