import { t } from '../../i18n'
import { cleanText, isPlainObject, safeIso } from '../security'
import { cloudFetch } from './api'
import { safeMediaUrl } from './social'

/**
 * Commentaires sous les avis. Lecture / écriture uniquement via les fonctions de la base
 * (get_review_comments, add_review_comment, delete_review_comment) qui vérifient les droits :
 * mêmes règles de visibilité que l'avis, anti-spam, suppression par l'auteur, l'auteur de l'avis ou un admin.
 */

export const COMMENT_MAX = 500

export interface CommentAuthor {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

export interface ReviewComment {
  id: number
  body: string
  createdAt: string
  user: CommentAuthor
  mine: boolean
  canDelete: boolean
}

export interface CommentThread {
  /** L'avis existe et je peux le voir */
  visible: boolean
  /** Je peux supprimer tous les commentaires (auteur de l'avis ou admin) */
  canModerate: boolean
  comments: ReviewComment[]
}

/** La base n'a pas encore les commentaires (migration pas appliquée) : la fonctionnalité se masque. */
export class CommentsUnavailable extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME = /^[a-z0-9_]{3,20}$/

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (res.ok) return res.json()
  if (res.status === 404) throw new CommentsUnavailable(t('comments.unavailable'))
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  const msg = typeof body.message === 'string' ? body.message : ''
  if (msg.includes('rate limit')) throw new Error(t('comments.err.rate'))
  if (msg.includes('review not found')) throw new Error(t('comments.err.gone'))
  if (msg.includes('invalid comment')) throw new Error(t('comments.err.invalid'))
  throw new Error(t('social.err.server', { status: res.status }))
}

function toComment(v: unknown): ReviewComment | null {
  if (!isPlainObject(v) || typeof v.id !== 'number' || !isPlainObject(v.user)) return null
  const u = v.user
  const body = cleanText(v.body, COMMENT_MAX)
  const createdAt = safeIso(v.created_at)
  if (!body || !createdAt || typeof u.id !== 'string' || !UUID.test(u.id) || typeof u.username !== 'string' || !USERNAME.test(u.username)) return null
  return {
    id: v.id,
    body,
    createdAt,
    user: { id: u.id, username: u.username, displayName: cleanText(u.display_name, 40) ?? u.username, avatarUrl: safeMediaUrl(u.avatar_url) },
    mine: v.mine === true,
    canDelete: v.can_delete === true,
  }
}

export async function getReviewComments(authorId: string, itemId: string): Promise<CommentThread> {
  if (!UUID.test(authorId)) return { visible: false, canModerate: false, comments: [] }
  const raw = await rpc('get_review_comments', { p_author: authorId, p_item: itemId })
  if (!isPlainObject(raw)) return { visible: false, canModerate: false, comments: [] }
  return {
    visible: raw.visible === true,
    canModerate: raw.can_moderate === true,
    comments: (Array.isArray(raw.comments) ? raw.comments.slice(0, 300) : []).map(toComment).filter((c): c is ReviewComment => c !== null),
  }
}

export async function addReviewComment(authorId: string, itemId: string, body: string): Promise<ReviewComment> {
  const text = body.trim().slice(0, COMMENT_MAX)
  const c = toComment(await rpc('add_review_comment', { p_author: authorId, p_item: itemId, p_body: text }))
  if (!c) throw new Error(t('social.err.server', { status: 500 }))
  return c
}

export async function deleteReviewComment(id: number): Promise<void> {
  await rpc('delete_review_comment', { p_id: id })
}
