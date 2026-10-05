import { t } from '../../i18n'
import { cloudFetch } from './api'

/** Notifications (cloche) : abonnements, demandes acceptées, réactions reçues. */

export type NotificationKind = 'follow_request' | 'follow_accepted' | 'new_follower' | 'reaction'

export interface AppNotification {
  id: number
  kind: NotificationKind
  created_at: string
  read_at: string | null
  emoji: string | null
  item_id: string | null
  actor: { username: string; display_name: string; avatar_url: string | null } | null
  /** Titre de la fiche concernée (réactions) */
  title: string | null
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(t('social.err.server', { status: res.status }))
  return res.json() as Promise<T>
}

export const listNotifications = (offset = 0) => rpc<AppNotification[]>('get_notifications', { p_offset: offset })

export async function unreadCount(): Promise<number> {
  try {
    const n = await rpc<number>('notifications_unread')
    return typeof n === 'number' ? n : 0
  } catch {
    return 0
  }
}

export async function markNotificationsRead(): Promise<void> {
  await rpc('mark_notifications_read')
}
