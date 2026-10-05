import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { listNotifications, markNotificationsRead, type AppNotification, type NotificationKind } from '../../lib/cloud/notifications'
import { cx, formatDate } from '../../lib/utils'
import { EmptyState } from '../ui'
import Avatar from './Avatar'
import Sheet from './Sheet'

const PAGE = 30
const FOLLOW_KINDS: NotificationKind[] = ['follow_request', 'follow_accepted', 'new_follower']

const VERB: Record<NotificationKind, () => string> = {
  follow_request: () => t('notif.follow_request'),
  follow_accepted: () => t('notif.follow_accepted'),
  new_follower: () => t('notif.new_follower'),
  reaction: () => t('notif.reaction'),
}

/** Liste des notifications (abonnements, demandes acceptées, réactions). Marque comme lues à l'ouverture. */
export default function Notifications({ onClose, onOpenProfile }: { onClose: () => void; onOpenProfile: (username: string) => void }) {
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
      // Marque comme lu (feu et oubli) pour vider le badge
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
    <Sheet title={t('notif.title')} label={t('notif.title')} onClose={onClose}>
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
            <Row key={n.id} n={n} onOpenProfile={onOpenProfile} />
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

function Row({ n, onOpenProfile }: { n: AppNotification; onOpenProfile: (username: string) => void }) {
  const actor = n.actor
  const actorName = actor?.display_name ?? t('notif.someone')
  const unread = n.read_at === null
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

  const base = cx('flex items-center gap-3 border-b border-line px-4 py-3 text-start', unread && 'bg-surface-2')

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
