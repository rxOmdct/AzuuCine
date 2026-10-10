import { t } from '../../i18n'
import { cleanText, isPlainObject, safeIso } from '../security'
import { cloudFetch } from './api'
import { safeMediaUrl } from './social'

/** Notifications (cloche) : abonnements, demandes acceptées, réactions reçues. */

export type NotificationKind =
  | 'follow_request'
  | 'follow_accepted'
  | 'new_follower'
  | 'reaction'
  | 'new_episode'
  | 'new_season'
  | 'review_comment'
  | 'shared_list_invite'

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
  /** Titre de la fiche concernée (réactions, commentaires, épisodes) ou nom de la liste partagée */
  title: string | null
  /** Invitation à une liste partagée : en attente, acceptée, ou plus valable (null) */
  invite_status: 'pending' | 'accepted' | null
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

const KINDS: NotificationKind[] = ['follow_request', 'follow_accepted', 'new_follower', 'reaction', 'new_episode', 'new_season', 'review_comment', 'shared_list_invite']
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Réponse du serveur relue champ par champ (adresses d'images comprises), comme pour les profils. */
function toNotification(v: unknown): AppNotification | null {
  if (!isPlainObject(v) || typeof v.id !== 'number' || !KINDS.includes(v.kind as NotificationKind)) return null
  const created = safeIso(v.created_at)
  if (!created) return null
  const a = isPlainObject(v.actor) ? v.actor : null
  const username = a && typeof a.username === 'string' && /^[a-z0-9_]{3,20}$/.test(a.username) ? a.username : null
  return {
    id: v.id,
    kind: v.kind as NotificationKind,
    created_at: created,
    read_at: safeIso(v.read_at) ?? null,
    emoji: cleanText(v.emoji, 8) ?? null,
    item_id: cleanText(v.item_id, 64) ?? null,
    episode: num(v.episode),
    ep_count: num(v.ep_count),
    actor: username ? { username, display_name: cleanText(a!.display_name, 40) ?? username, avatar_url: safeMediaUrl(a!.avatar_url) ?? null } : null,
    title: cleanText(v.title, 300) ?? null,
    invite_status: v.invite_status === 'pending' || v.invite_status === 'accepted' ? v.invite_status : null,
  }
}

export const listNotifications = async (offset = 0): Promise<AppNotification[]> => {
  const raw = await rpc<unknown>('get_notifications', { p_offset: offset })
  return (Array.isArray(raw) ? raw : []).map(toNotification).filter((n): n is AppNotification => n !== null)
}

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
