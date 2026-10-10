import { Check, Loader2, MessageCircle, Tv, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { listNotifications, markNotificationsRead, type AppNotification, type NotificationKind } from '../../lib/cloud/notifications'
import { cx, formatDate } from '../../lib/utils'
import { EmptyState } from '../ui'
import Avatar from './Avatar'
import { respondToInvite } from '../../lib/cloud/sharedLists'
import { useSocial } from './SocialProvider'
import Sheet from './Sheet'

const PAGE = 30
const FOLLOW_KINDS: NotificationKind[] = ['follow_request', 'follow_accepted', 'new_follower']
const EPISODE_KINDS: NotificationKind[] = ['new_episode', 'new_season']

const VERB: Record<NotificationKind, () => string> = {
  follow_request: () => t('notif.follow_request'),
  follow_accepted: () => t('notif.follow_accepted'),
  new_follower: () => t('notif.new_follower'),
  reaction: () => t('notif.reaction'),
  new_episode: () => '',
  new_season: () => '',
  review_comment: () => t('notif.review_comment'),
  shared_list_invite: () => t('notif.shared_list_invite'),
}

/** Liste des notifications (abonnements, réactions, nouveaux épisodes). Marque comme lues à l'ouverture. */
export default function Notifications({
  onClose,
  onOpenProfile,
  onOpenItem,
  onOpenComments,
  onOpenSharedList,
}: {
  onClose: () => void
  onOpenProfile: (username: string) => void
  onOpenItem: (itemId: string) => void
  onOpenComments?: (itemId: string, title: string) => void
  onOpenSharedList?: (listId: string) => void
}) {
  const [items, setItems] = useState<AppNotification[] | undefined>(undefined)
  const [done, setDone] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await listNotifications(0)
        if (!alive) return
        setItems(page)
        setDone(page.length < PAGE)
      } catch {
        if (alive) {
          setItems([])
          setDone(true)
        }
      }
      markNotificationsRead().catch(() => {})
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadMore = async () => {
    if (!items || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listNotifications(items.length)
      setItems((prev) => [...(prev ?? []), ...page])
      setDone(page.length < PAGE)
    } catch {
      setDone(true)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Sheet title={t('notif.title')} label={t('notif.title')} onClose={onClose} elevated>
      {items === undefined ? (
        <p className="flex items-center justify-center py-16 text-ink-3">
          <Loader2 size={20} className="animate-spin" />
        </p>
      ) : items.length === 0 ? (
        <div className="px-4">
          <EmptyState title={t('notif.empty')} />
        </div>
      ) : (
        <ul>
          {items.map((n) => (
            <Row key={n.id} n={n} onOpenProfile={onOpenProfile} onOpenItem={onOpenItem} onOpenComments={onOpenComments} onOpenSharedList={onOpenSharedList} />
          ))}
          {!done && (
            <li className="p-4">
              <button onClick={loadMore} disabled={loadingMore} className="btn btn-ghost w-full">
                {loadingMore ? <Loader2 size={15} className="animate-spin" /> : t('social.loadMore')}
              </button>
            </li>
          )}
        </ul>
      )}
    </Sheet>
  )
}

function Row({
  n,
  onOpenProfile,
  onOpenItem,
  onOpenComments,
  onOpenSharedList,
}: {
  n: AppNotification
  onOpenProfile: (username: string) => void
  onOpenItem: (itemId: string) => void
  onOpenComments?: (itemId: string, title: string) => void
  onOpenSharedList?: (listId: string) => void
}) {
  const unread = n.read_at === null
  const isEpisode = EPISODE_KINDS.includes(n.kind)
  const base = cx('flex items-center gap-3 border-b border-line px-4 py-3 text-start', unread && 'bg-surface-2')

  // ── Nouvel épisode / nouvelle saison ──
  if (isEpisode) {
    const title = n.title ?? '—'
    const inner = (
      <>
        {unread && <span className="size-2 shrink-0 rounded-full bg-accent-fill" aria-hidden="true" />}
        <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-surface-2 text-accent">
          <Tv size={18} />
        </span>
        <span className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
          <b className="text-ink">{t(n.kind === 'new_season' ? 'notif.new_season' : 'notif.new_episode', { title })}</b>
          {n.episode != null && <span className="text-ink-3"> · {t('episodes.short', { n: n.episode })}</span>}
        </span>
        <span className="shrink-0 text-xs text-ink-3">{formatDate(n.created_at)}</span>
      </>
    )
    return (
      <li>
        {n.item_id ? (
          <button onClick={() => onOpenItem(n.item_id!)} className={cx(base, 'w-full')}>
            {inner}
          </button>
        ) : (
          <div className={base}>{inner}</div>
        )}
      </li>
    )
  }

  // ── Commentaire sur mon avis / invitation à une liste partagée ──
  if (n.kind === 'review_comment' || n.kind === 'shared_list_invite') {
    return <SocialRow n={n} base={base} unread={unread} onOpenProfile={onOpenProfile} onOpenComments={onOpenComments} onOpenSharedList={onOpenSharedList} />
  }

  // ── Abonnements / réactions ──
  const actor = n.actor
  const actorName = actor?.display_name ?? t('notif.someone')
  const username = actor?.username
  const target = username != null && FOLLOW_KINDS.includes(n.kind) ? username : null

  const inner = (
    <>
      {unread && <span className="size-2 shrink-0 rounded-full bg-accent-fill" aria-hidden="true" />}
      <Avatar url={actor?.avatar_url ?? undefined} name={actorName} size={38} />
      <span className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
        <b className="text-ink">{actorName}</b> {VERB[n.kind]()}
        {n.kind === 'reaction' && (
          <>
            {n.emoji ? ` ${n.emoji}` : ''}
            {n.title ? ` ${t('notif.on', { title: n.title })}` : ''}
          </>
        )}
      </span>
      <span className="shrink-0 text-xs text-ink-3">{formatDate(n.created_at)}</span>
    </>
  )

  return (
    <li>
      {target != null ? (
        <button onClick={() => onOpenProfile(target)} className={cx(base, 'w-full')}>
          {inner}
        </button>
      ) : (
        <div className={base}>{inner}</div>
      )}
    </li>
  )
}

function SocialRow({
  n,
  base,
  unread,
  onOpenProfile,
  onOpenComments,
  onOpenSharedList,
}: {
  n: AppNotification
  base: string
  unread: boolean
  onOpenProfile: (username: string) => void
  onOpenComments?: (itemId: string, title: string) => void
  onOpenSharedList?: (listId: string) => void
}) {
  const social = useSocial()
  const [status, setStatus] = useState(n.invite_status)
  const [busy, setBusy] = useState(false)
  const actor = n.actor
  const actorName = actor?.display_name ?? t('notif.someone')
  const isInvite = n.kind === 'shared_list_invite'

  const respond = async (accept: boolean) => {
    if (!n.item_id) return
    setBusy(true)
    try {
      await respondToInvite(n.item_id, accept)
      setStatus(accept ? 'accepted' : null)
      social.bumpShared()
      if (accept) onOpenSharedList?.(n.item_id)
    } catch {
      /* invitation expirée ou réseau : rien ne change */
    } finally {
      setBusy(false)
    }
  }

  // Où mène un tap sur la ligne
  const open =
    !isInvite && n.item_id && onOpenComments
      ? () => onOpenComments(n.item_id!, n.title ?? '')
      : isInvite && status === 'accepted' && n.item_id && onOpenSharedList
        ? () => onOpenSharedList(n.item_id!)
        : null

  const text = (
    <span className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
      <b className="text-ink">{actorName}</b> {VERB[n.kind]()}
      {isInvite ? (
        n.title ? (
          <>
            {' '}
            <b className="text-ink">{n.title}</b>
          </>
        ) : (
          ` (${t('shared.expired')})`
        )
      ) : n.title ? (
        ` ${t('notif.on', { title: n.title })}`
      ) : (
        ''
      )}
    </span>
  )

  return (
    <li>
      <div className={cx(base, 'flex-wrap')}>
        {unread && <span className="size-2 shrink-0 rounded-full bg-accent-fill" aria-hidden="true" />}
        <button type="button" onClick={() => actor && onOpenProfile(actor.username)} className="shrink-0" aria-label={actorName} disabled={!actor}>
          <Avatar url={actor?.avatar_url ?? undefined} name={actorName} size={38} />
        </button>
        {open ? (
          <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2 text-start">
            {isInvite ? <Users size={14} className="shrink-0 text-accent" aria-hidden="true" /> : <MessageCircle size={14} className="shrink-0 text-accent" aria-hidden="true" />}
            {text}
          </button>
        ) : (
          text
        )}
        <span className="shrink-0 text-xs text-ink-3">{formatDate(n.created_at)}</span>
        {isInvite && status === 'pending' && n.title && (
          <div className="flex w-full justify-end gap-2 ps-[3.25rem]">
            <button type="button" onClick={() => void respond(false)} disabled={busy} className="btn btn-ghost px-3.5 py-1.5 text-sm">
              {t('shared.decline')}
            </button>
            <button type="button" onClick={() => void respond(true)} disabled={busy} className="btn btn-primary px-3.5 py-1.5 text-sm">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('shared.accept')}
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
