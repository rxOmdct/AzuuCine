import { t } from '../../i18n'
import { cloudFetch } from './api'

/**
 * Accès à la partie administration (réservée aux comptes de la table `admins`).
 * Toutes les fonctions appellent des RPC Supabase verrouillées côté serveur par is_admin() :
 * même en forçant l'URL, un non-admin reçoit une erreur.
 */

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(t('social.err.server', { status: res.status }))
  return res.json() as Promise<T>
}

export interface AdminOverview {
  users: number
  profiles: number
  public_profiles: number
  private_profiles: number
  suspended: number
  items: number
  reviews: number
  films: number
  series: number
  follows: number
  pending_follows: number
  media_files: number
  signups_7d: number
  signups_30d: number
  active_7d: number
  new_items_7d: number
  signups_by_day: { day: string; n: number }[]
}

export interface AdminUser {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  username: string | null
  display_name: string | null
  is_private: boolean | null
  suspended: boolean
  items: number
  reviews: number
  followers: number
}

export interface AdminReview {
  item_id: string
  user_id: string
  updated_at: string
  username: string | null
  display_name: string | null
  suspended: boolean
  title: string | null
  type: string | null
  notes: string | null
  rating: number | null
}

/** Le compte connecté est-il administrateur ? (false si l'app est en mode local sans compte) */
export async function isAdmin(): Promise<boolean> {
  try {
    return (await rpc<boolean>('is_admin')) === true
  } catch {
    return false
  }
}

export const adminOverview = () => rpc<AdminOverview>('admin_overview')
export const adminUsers = (q: string, offset = 0) => rpc<AdminUser[]>('admin_users', { q: q || null, p_offset: offset })
export const adminRecentReviews = (offset = 0) => rpc<AdminReview[]>('admin_recent_reviews', { p_offset: offset })

export async function adminSetSuspended(userId: string, value: boolean): Promise<void> {
  await rpc('admin_set_suspended', { p_user: userId, p_value: value })
}

export async function adminClearReview(userId: string, itemId: string): Promise<void> {
  await rpc('admin_clear_review', { p_user: userId, p_item: itemId })
}
