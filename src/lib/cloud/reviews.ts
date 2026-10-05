import { t } from '../../i18n'
import { cloudFetch } from './api'

/** Avis des autres membres sur un même titre, et réactions (emoji). */

export const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export interface ReviewAuthor {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  is_private: boolean
  relation: string
}

export interface TitleReview {
  user: ReviewAuthor
  user_id: string
  item_id: string
  updated_at: string
  rating: number | null
  notes: string
  /** emoji -> nombre */
  reactions: Record<string, number>
  total: number
  /** mon emoji sur cet avis, ou null */
  mine: string | null
}

export interface TitleReviews {
  friends: TitleReview[]
  others: TitleReview[]
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

/** Tous les avis publics sur un titre (séparés : amis / autres). */
export const titleReviews = (externalId: string, offset = 0) =>
  rpc<TitleReviews>('title_reviews', { p_external_id: externalId, p_offset: offset })

export async function reactToReview(author: string, item: string, emoji: ReactionEmoji): Promise<void> {
  await rpc('react_to_review', { p_author: author, p_item: item, p_emoji: emoji })
}

export async function unreactReview(author: string, item: string): Promise<void> {
  await rpc('unreact_review', { p_author: author, p_item: item })
}
