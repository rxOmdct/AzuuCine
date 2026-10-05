import { Loader2, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { REACTION_EMOJIS, reactToReview, titleReviews, unreactReview, type ReactionEmoji, type TitleReview, type TitleReviews as TitleReviewsData } from '../../lib/cloud/reviews'
import { cx, formatRating } from '../../lib/utils'
import { useMedia } from '../../store'
import Avatar from './Avatar'
import Sheet from './Sheet'

/** Écran plein : tous les avis sur un même titre (amis / autres membres) avec réactions. */
export default function TitleReviews({ externalId, title, onClose, onOpenProfile }: { externalId: string; title: string; onClose: () => void; onOpenProfile: (username: string) => void }) {
  const [data, setData] = useState<TitleReviewsData>()
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    titleReviews(externalId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [externalId])

  const bothEmpty = !!data && data.friends.length === 0 && data.others.length === 0

  return (
    <Sheet title={title} label={t('reviews.title')} onClose={onClose}>
      <p className="eyebrow px-4 pt-4">{t('reviews.title')}</p>
      {data === undefined && !error ? (
        <p className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-ink-3">
          <Loader2 size={16} className="animate-spin" /> {t('social.loading')}
        </p>
      ) : !data || error || bothEmpty ? (
        <p className="px-4 py-16 text-center text-sm text-ink-3">{t('reviews.none')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 pt-4 sm:grid-cols-2">
          <ReviewColumn heading={t('reviews.friends')} empty={t('reviews.noneFriends')} list={data.friends} onOpenProfile={onOpenProfile} />
          <ReviewColumn heading={t('reviews.others')} empty={t('reviews.noneOthers')} list={data.others} onOpenProfile={onOpenProfile} />
        </div>
      )}
    </Sheet>
  )
}

function ReviewColumn({ heading, empty, list, onOpenProfile }: { heading: string; empty: string; list: TitleReview[]; onOpenProfile: (username: string) => void }) {
  return (
    <section>
      <p className="eyebrow mb-2">{heading}</p>
      {list.length === 0 ? (
        <p className="text-sm text-ink-3">{empty}</p>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <ReviewCard key={`${r.user_id}-${r.item_id}`} r={r} onOpenProfile={onOpenProfile} />
          ))}
        </div>
      )}
    </section>
  )
}

function ReviewCard({ r, onOpenProfile }: { r: TitleReview; onOpenProfile: (username: string) => void }) {
  const { settings } = useMedia()
  const [reactions, setReactions] = useState<Record<string, number>>(r.reactions)
  const [mine, setMine] = useState<string | null>(r.mine)
  const [busy, setBusy] = useState(false)

  const toggle = async (emoji: ReactionEmoji) => {
    if (busy) return
    const prev = { reactions, mine }
    const next: Record<string, number> = { ...reactions }
    if (mine === emoji) {
      next[emoji] = Math.max(0, (next[emoji] ?? 0) - 1)
      setReactions(next)
      setMine(null)
    } else {
      if (mine) next[mine] = Math.max(0, (next[mine] ?? 0) - 1)
      next[emoji] = (next[emoji] ?? 0) + 1
      setReactions(next)
      setMine(emoji)
    }
    setBusy(true)
    try {
      if (prev.mine === emoji) await unreactReview(r.user_id, r.item_id)
      else await reactToReview(r.user_id, r.item_id, emoji)
    } catch {
      setReactions(prev.reactions)
      setMine(prev.mine)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar url={r.user.avatar_url ?? undefined} name={r.user.display_name} size={34} />
        <button onClick={() => onOpenProfile(r.user.username)} className="min-w-0 flex-1 text-start">
          <p className="truncate text-sm font-semibold">{r.user.display_name}</p>
          <p className="truncate text-xs text-ink-3">@{r.user.username}</p>
        </button>
        {r.rating != null && (
          <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-ink-2">
            <Star size={12} className="fill-accent text-accent" />
            {formatRating(r.rating, settings.ratingScale)}
          </span>
        )}
      </div>
      {r.notes && <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-ink-2">{r.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {REACTION_EMOJIS.map((emoji) => {
          const count = reactions[emoji] ?? 0
          const on = mine === emoji
          return (
            <button
              key={emoji}
              onClick={() => void toggle(emoji)}
              disabled={busy}
              aria-pressed={on}
              className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-sm transition-colors disabled:opacity-60', on ? 'border-accent text-ink' : 'border-line text-ink-2')}
            >
              <span>{emoji}</span>
              {count > 0 && <span className="text-xs font-medium">{count}</span>}
            </button>
          )
        })}
      </div>
    </article>
  )
}
