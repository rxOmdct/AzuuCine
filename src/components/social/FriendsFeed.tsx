import { Loader2, Star, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { getFeed, type FeedEntry } from '../../lib/cloud/social'
import { timeAgo } from '../../lib/timeAgo'
import { formatRating } from '../../lib/utils'
import { useMedia } from '../../store'
import Poster from '../Poster'
import { LinkArrow, SectionTitle } from '../ui'
import Avatar from './Avatar'
import { useSocial } from './SocialProvider'

const VERB = { finished: 'feed.finished', started: 'feed.started', rewatched: 'feed.rewatched', added: 'feed.added' } as const

/** Accueil : ce que regardent mes abonnements. */
export default function FriendsFeed() {
  const social = useSocial()
  const { settings } = useMedia()
  const [entries, setEntries] = useState<FeedEntry[]>()
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [shown, setShown] = useState(6)

  const load = useCallback(async () => {
    try {
      const list = await getFeed()
      setEntries(list)
      setMore(list.length >= 30)
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    if (social.enabled && navigator.onLine) void load()
  }, [social.enabled, load])

  if (!social.enabled) return null

  const loadMore = async () => {
    if (!entries) return
    if (shown < entries.length) return setShown((n) => n + 10)
    setLoadingMore(true)
    try {
      const next = await getFeed(entries[entries.length - 1]?.createdAt)
      setEntries([...entries, ...next])
      setMore(next.length >= 30)
      setShown((n) => n + 10)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <SectionTitle action={<LinkArrow onClick={social.openSearch}>{t('social.findFriends')}</LinkArrow>}>{t('feed.title')}</SectionTitle>
      {entries === undefined ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 size={14} className="animate-spin" /> {t('social.loading')}
        </p>
      ) : entries.length === 0 ? (
        <button onClick={social.openSearch} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong p-4 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-accent">
            <UserPlus size={18} />
          </span>
          <span className="text-sm text-ink-2">{t('feed.empty')}</span>
        </button>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {entries.slice(0, shown).map((e) => (
              <li key={`${e.id}-${e.createdAt}`} className="flex items-center gap-3 py-2.5">
                <button onClick={() => social.openProfile(e.user.username)} aria-label={e.user.displayName}>
                  <Avatar url={e.user.avatarUrl} name={e.user.displayName} size={36} />
                </button>
                <button onClick={() => social.openItem(e.item, e.user)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm leading-snug text-ink-2">
                      <span className="font-semibold text-ink">{e.user.displayName}</span> {t(VERB[e.kind])}{' '}
                      <span className="font-semibold text-ink">{e.item.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                      {e.item.rating != null && e.kind !== 'added' && (
                        <span className="flex items-center gap-0.5 font-semibold text-ink-2">
                          <Star size={10} className="fill-accent text-accent" />
                          {formatRating(e.item.rating, settings.ratingScale)}
                        </span>
                      )}
                      {e.item.notes && e.item.notesPublic && <span>{t('feed.review')}</span>}
                      <span>{timeAgo(e.createdAt)}</span>
                    </span>
                  </span>
                  <span className="w-10 shrink-0">
                    <Poster src={e.item.poster} title={e.item.title} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(shown < entries.length || more) && (
            <button onClick={loadMore} disabled={loadingMore} className="mt-2 w-full py-2 text-xs font-medium text-ink-3">
              {loadingMore ? <Loader2 size={13} className="mx-auto animate-spin" /> : (
                <>
                  {t('social.loadMore')} <span className="text-accent">→</span>
                </>
              )}
            </button>
          )}
        </>
      )}
    </>
  )
}
