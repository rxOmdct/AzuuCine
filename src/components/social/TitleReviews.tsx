import { Loader2, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { useBlocked } from '../../lib/cloud/moderation'
import { titleReviews, type TitleReview, type TitleReviews as TitleReviewsData } from '../../lib/cloud/reviews'
import { formatRating } from '../../lib/utils'
import { useMedia } from '../../store'
import ReportButton from '../moderation/ReportButton'
import Avatar from './Avatar'
import Reactions from './Reactions'
import ReviewComments from './ReviewComments'
import ReviewText from './ReviewText'
import Sheet from './Sheet'

/** Écran plein : tous les avis sur un même titre (amis / autres membres) avec réactions. */
export default function TitleReviews({ externalId, title, onClose, onOpenProfile }: { externalId: string; title: string; onClose: () => void; onOpenProfile: (username: string) => void }) {
  const [data, setData] = useState<TitleReviewsData>()
  const [error, setError] = useState(false)
  // Avis des comptes que j'ai bloqués : masqués
  const { isBlocked } = useBlocked()

  useEffect(() => {
    let alive = true
    titleReviews(externalId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [externalId])

  const friends = data?.friends.filter((r) => !isBlocked(r.user_id)) ?? []
  const others = data?.others.filter((r) => !isBlocked(r.user_id)) ?? []
  const bothEmpty = !!data && friends.length === 0 && others.length === 0

  return (
    <Sheet title={title} label={t('reviews.title')} onClose={onClose} elevated>
      <p className="eyebrow px-4 pt-4">{t('reviews.title')}</p>
      {data === undefined && !error ? (
        <p className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-ink-3">
          <Loader2 size={16} className="animate-spin" /> {t('social.loading')}
        </p>
      ) : !data || error || bothEmpty ? (
        <p className="px-4 py-16 text-center text-sm text-ink-3">{t('reviews.none')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 pt-4 sm:grid-cols-2">
          <ReviewColumn heading={t('reviews.friends')} empty={t('reviews.noneFriends')} list={friends} onOpenProfile={onOpenProfile} />
          <ReviewColumn heading={t('reviews.others')} empty={t('reviews.noneOthers')} list={others} onOpenProfile={onOpenProfile} />
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
        <ReportButton target={{ type: 'review', id: r.item_id, userId: r.user_id }} className="-me-1.5" size={16} />
      </div>
      {r.notes && <ReviewText text={r.notes} spoiler={r.spoiler} />}
      <div className="mt-3">
        <ReviewComments authorId={r.user_id} itemId={r.item_id} count={r.comments} hidden={r.comments === null}>
          <Reactions authorId={r.user_id} itemId={r.item_id} reactions={r.reactions} mine={r.mine} />
        </ReviewComments>
      </div>
    </article>
  )
}
