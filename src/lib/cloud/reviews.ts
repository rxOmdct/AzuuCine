import { t } from '../../i18n'
import { cleanText, isPlainObject, safeIso } from '../security'
import { cloudFetch } from './api'
import { safeMediaUrl } from './social'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Avis relu champ par champ : une réponse inattendue n'est ni affichée telle quelle ni source de plantage. */
function toReview(v: unknown): TitleReview | null {
  if (!isPlainObject(v) || !isPlainObject(v.user) || typeof v.user_id !== 'string' || !UUID.test(v.user_id)) return null
  const u = v.user
  const username = typeof u.username === 'string' && /^[a-z0-9_]{3,20}$/.test(u.username) ? u.username : null
  const notes = cleanText(v.notes, 20000)
  if (!username || !notes) return null
  const reactions: Record<string, number> = {}
  if (isPlainObject(v.reactions)) {
    for (const e of REACTION_EMOJIS) {
      const n = v.reactions[e]
      if (typeof n === 'number' && n > 0) reactions[e] = Math.floor(n)
    }
  }
  return {
    user: {
      id: typeof u.id === 'string' ? u.id : v.user_id,
      username,
      display_name: cleanText(u.display_name, 40) ?? username,
      avatar_url: safeMediaUrl(u.avatar_url) ?? null,
      is_private: u.is_private === true,
      relation: typeof u.relation === 'string' ? u.relation : 'none',
    },
    user_id: v.user_id,
    item_id: cleanText(v.item_id, 64) ?? '',
    updated_at: safeIso(v.updated_at) ?? new Date(0).toISOString(),
    rating: typeof v.rating === 'number' && v.rating > 0 && v.rating <= 10 ? v.rating : null,
    notes,
    reactions,
    total: Object.values(reactions).reduce((a, b) => a + b, 0),
    mine: (REACTION_EMOJIS as readonly string[]).includes(v.mine as string) ? (v.mine as string) : null,
  }
}

const toReviews = (v: unknown) => (Array.isArray(v) ? v : []).map(toReview).filter((r): r is TitleReview => r !== null)

/** Tous les avis publics sur un titre (séparés : amis / autres). */
export async function titleReviews(externalId: string, offset = 0): Promise<TitleReviews> {
  const raw = await rpc<unknown>('title_reviews', { p_external_id: externalId, p_offset: offset })
  return isPlainObject(raw) ? { friends: toReviews(raw.friends), others: toReviews(raw.others) } : { friends: [], others: [] }
}

export async function reactToReview(author: string, item: string, emoji: ReactionEmoji): Promise<void> {
  await rpc('react_to_review', { p_author: author, p_item: item, p_emoji: emoji })
}

export async function unreactReview(author: string, item: string): Promise<void> {
  await rpc('unreact_review', { p_author: author, p_item: item })
}
