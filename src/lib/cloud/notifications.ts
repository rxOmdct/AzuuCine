import { t } from '../../i18n'
import { cloudFetch } from './api'

/** Notifications (cloche) : abonnements, demandes acceptées, réactions reçues. */

export type NotificationKind = 'follow_request' | 'follow_accepted' | 'new_follower' | 'reaction' | 'new_episode' | 'new_season'

export interface AppNotification {
  id: number
  kind: NotificationKind
  created_at: string
  read_at: string | null
  emoji: string | null
  item_id: string | null
  /** Numéro du dernier épisode sorti (épisodes) */
  episode: number | null
  /** Nombre de nouveaux épisodes (épisodes) */
  ep_count: number | null
  actor: { username: string; display_name: string; avatar_url: string | null } | null
  /** Titre de la fiche concernée (réactions, épisodes) */
  title: string | null
}

/** Épisode/saison à signaler (envoyé après la vérification des sorties). */
export interface EpisodeNotice {
  item_id: string
  kind: 'new_episode' | 'new_season'
  /** Dernier épisode sorti */
  episode: number
  /** Nombre de nouveaux épisodes */
  count: number
}

/** Enregistre les nouveaux épisodes des séries suivies (dédoublonné côté serveur). Renvoie le nombre créé. */
export async function addEpisodeNotifications(list: EpisodeNotice[]): Promise<number> {
  if (!list.length) return 0
  try {
    const n = await rpc<number>('add_episode_notifications', { p_list: list })
    return typeof n === 'number' ? n : 0
  } catch {
    return 0
  }
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
