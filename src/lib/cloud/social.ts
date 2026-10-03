import { t } from '../../i18n'
import type { MediaItem } from '../../types'
import { normalizeItem } from '../backup'
import { cleanText, isPlainObject, safeIso } from '../security'
import { cloudFetch } from './api'
import { getSession } from './auth'
import { SUPABASE_URL } from './config'

/**
 * Profils, abonnements et fil d'activité.
 * Toutes les lectures passent par les fonctions de la base (get_profile, get_feed…) qui vérifient
 * les droits d'accès ; tout ce qui revient du serveur est revalidé ici avant d'être affiché.
 */

export type Relation = 'none' | 'pending' | 'accepted'

export interface ProfileCard {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  isPrivate: boolean
  relation: Relation
}

export interface ProfileStats {
  total: number
  finished: number
  finishedYear: number
  films: number
  series: number
  episodes: number
  rated: number
}

export interface Profile extends ProfileCard {
  bio: string
  bannerUrl?: string
  isMe: boolean
  followsMe: boolean
  followers: number
  following: number
  visible: boolean
  stats?: ProfileStats
  top: MediaItem[]
  recent: MediaItem[]
  watching: MediaItem[]
  watchlist: MediaItem[]
}

export interface FeedEntry {
  id: number
  kind: 'finished' | 'started' | 'rewatched' | 'added'
  createdAt: string
  user: { username: string; displayName: string; avatarUrl?: string }
  item: MediaItem
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEDIA_PREFIX = () => `${SUPABASE_URL}/storage/v1/object/public/profile-media/`

/** Photo / bannière : uniquement depuis le stockage de l'app. */
export function safeMediaUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 500 || !SUPABASE_URL) return undefined
  const prefix = MEDIA_PREFIX()
  if (!v.startsWith(prefix)) return undefined
  return /^[0-9a-f-]{36}\/[A-Za-z0-9_.-]{1,80}$/i.test(v.slice(prefix.length)) ? v : undefined
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 10_000_000) : 0)
const relation = (v: unknown): Relation => (v === 'pending' || v === 'accepted' ? v : 'none')
const username = (v: unknown) => (typeof v === 'string' && USERNAME_RE.test(v) ? v : undefined)

function toCard(raw: unknown): ProfileCard | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id)) return null
  const name = username(raw.username)
  if (!name) return null
  return {
    id: raw.id,
    username: name,
    displayName: cleanText(raw.display_name, 40) ?? name,
    avatarUrl: safeMediaUrl(raw.avatar_url),
    isPrivate: raw.is_private === true,
    relation: relation(raw.relation),
  }
}

const toItems = (v: unknown): MediaItem[] =>
  Array.isArray(v) ? v.slice(0, 200).map(normalizeItem).filter((i): i is MediaItem => i !== null) : []

function toProfile(raw: unknown): Profile | null {
  const card = toCard(raw)
  if (!card || !isPlainObject(raw)) return null
  const s = isPlainObject(raw.stats) ? raw.stats : null
  return {
    ...card,
    bio: cleanText(raw.bio, 300) ?? '',
    bannerUrl: safeMediaUrl(raw.banner_url),
    isMe: raw.is_me === true,
    followsMe: raw.follows_me === true,
    followers: count(raw.followers),
    following: count(raw.following),
    visible: raw.visible === true,
    stats: s
      ? {
          total: count(s.total),
          finished: count(s.finished),
          finishedYear: count(s.finished_year),
          films: count(s.films),
          series: count(s.series),
          episodes: count(s.episodes),
          rated: count(s.rated),
        }
      : undefined,
    top: toItems(raw.top),
    recent: toItems(raw.recent),
    watching: toItems(raw.watching),
    watchlist: toItems(raw.watchlist),
  }
}

function me(): string {
  const id = getSession()?.user.id
  if (!id) throw new Error(t('auth.err.session'))
  return id
}

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(t('social.err.server', { status: res.status }))
  return res.json()
}

// ─── Lecture ───

export async function getProfile(name: string): Promise<Profile | null> {
  const clean = name.trim().toLowerCase().replace(/^@/, '')
  if (!USERNAME_RE.test(clean)) return null
  return toProfile(await rpc('get_profile', { p_username: clean }))
}

/** Mon profil (pseudo, nom, photo…) — lu directement dans la table. */
export async function getMyProfile(): Promise<Profile | null> {
  const res = await cloudFetch(`/rest/v1/profiles?id=eq.${me()}&select=username`)
  if (!res.ok) throw new Error(t('social.err.server', { status: res.status }))
  const [row] = (await res.json()) as { username?: string }[]
  return row?.username ? getProfile(row.username) : null
}

export async function getProfileItems(userId: string, status: string | null, offset: number): Promise<MediaItem[]> {
  if (!UUID.test(userId)) return []
  return toItems(await rpc('get_profile_items', { p_user: userId, p_status: status, p_offset: offset, p_limit: 48 }))
}

export async function getFeed(before?: string): Promise<FeedEntry[]> {
  const raw = await rpc('get_feed', { p_before: before ?? null, p_limit: 30 })
  if (!Array.isArray(raw)) return []
  const out: FeedEntry[] = []
  for (const r of raw.slice(0, 50)) {
    if (!isPlainObject(r) || !isPlainObject(r.user)) continue
    const item = normalizeItem(r.item)
    const name = username(r.user.username)
    const createdAt = safeIso(r.created_at)
    const kind = r.kind
    if (!item || !name || !createdAt || (kind !== 'finished' && kind !== 'started' && kind !== 'rewatched' && kind !== 'added')) continue
    out.push({
      id: typeof r.id === 'number' ? r.id : out.length,
      kind,
      createdAt,
      user: { username: name, displayName: cleanText(r.user.display_name, 40) ?? name, avatarUrl: safeMediaUrl(r.user.avatar_url) },
      item,
    })
  }
  return out
}

const toCards = (raw: unknown) => (Array.isArray(raw) ? raw.slice(0, 100).map(toCard).filter((c): c is ProfileCard => c !== null) : [])

export const searchProfiles = async (q: string) => (q.trim().length < 2 ? [] : toCards(await rpc('search_profiles', { q: q.trim().slice(0, 40) })))
export const getFollowList = async (userId: string, kind: 'followers' | 'following', offset = 0) =>
  UUID.test(userId) ? toCards(await rpc('get_follow_list', { p_user: userId, p_kind: kind, p_offset: offset })) : []
export const getFollowRequests = async () => toCards(await rpc('get_follow_requests'))

// ─── Abonnements ───

async function ok(res: Response) {
  if (!res.ok) throw new Error(t('social.err.server', { status: res.status }))
}

/** S'abonner. Renvoie « pending » si le compte est privé (demande envoyée). */
export async function follow(userId: string): Promise<Relation> {
  if (!UUID.test(userId)) return 'none'
  const res = await cloudFetch('/rest/v1/follows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ following_id: userId }),
  })
  if (res.status !== 409) await ok(res)
  const rows =
    res.status === 409
      ? await (await cloudFetch(`/rest/v1/follows?follower_id=eq.${me()}&following_id=eq.${userId}&select=status`)).json()
      : await res.json().catch(() => [])
  const [row] = (Array.isArray(rows) ? rows : []) as { status?: string }[]
  return relation(row?.status)
}

/** Se désabonner (ou annuler une demande). */
export async function unfollow(userId: string) {
  if (!UUID.test(userId)) return
  await ok(await cloudFetch(`/rest/v1/follows?follower_id=eq.${me()}&following_id=eq.${userId}`, { method: 'DELETE' }))
}

/** Retirer un abonné (ou refuser sa demande). */
export async function removeFollower(userId: string) {
  if (!UUID.test(userId)) return
  await ok(await cloudFetch(`/rest/v1/follows?follower_id=eq.${userId}&following_id=eq.${me()}`, { method: 'DELETE' }))
}

export async function acceptFollower(userId: string) {
  if (!UUID.test(userId)) return
  await ok(
    await cloudFetch(`/rest/v1/follows?follower_id=eq.${userId}&following_id=eq.${me()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    }),
  )
}

// ─── Modifier mon profil ───

export interface ProfilePatch {
  username?: string
  display_name?: string
  bio?: string
  is_private?: boolean
  avatar_url?: string | null
  banner_url?: string | null
}

export async function updateProfile(patch: ProfilePatch): Promise<void> {
  const res = await cloudFetch(`/rest/v1/profiles?id=eq.${me()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  if (body.code === '23505') throw new Error(t('social.err.usernameTaken'))
  if (body.message?.includes('reserved')) throw new Error(t('social.err.usernameReserved'))
  if (body.code === '23514') throw new Error(t('social.err.invalid'))
  throw new Error(t('social.err.server', { status: res.status }))
}

/** Envoie une photo (déjà recadrée) dans mon dossier et renvoie son adresse publique. */
export async function uploadProfileImage(kind: 'avatar' | 'banner', blob: Blob): Promise<string> {
  const path = `${me()}/${kind}-${Date.now()}.jpg`
  const res = await cloudFetch(`/storage/v1/object/profile-media/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': '31536000' },
    body: blob,
  })
  if (res.status === 413) throw new Error(t('image.tooBig'))
  await ok(res)
  return MEDIA_PREFIX() + path
}

/** Supprime une ancienne photo (sans erreur si elle n'existe plus). */
export async function deleteProfileImage(url?: string) {
  const safe = safeMediaUrl(url)
  if (!safe) return
  const path = safe.slice(MEDIA_PREFIX().length)
  if (!path.startsWith(me() + '/')) return
  await cloudFetch(`/storage/v1/object/profile-media/${path}`, { method: 'DELETE' }).catch(() => undefined)
}

/** Lien public vers un profil. */
export const profileLink = (name: string) => `${location.origin}${location.pathname}#/u/${name}`
