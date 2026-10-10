import { t } from '../../i18n'
import type { MediaItem, MediaType } from '../../types'
import { cleanText, isPlainObject, isSafeExternalId, remoteImage, safeIso } from '../security'
import { cloudFetch } from './api'
import { safeMediaUrl, type ProfileCard } from './social'

/**
 * Listes partagées / collaboratives (côté serveur, réservées aux membres).
 * Différentes des listes perso (privées, synchronisées avec la bibliothèque) : un titre y est un
 * simple instantané (référence TMDB/AniList, titre, affiche, type, année) ajouté par un membre.
 * Tout passe par les fonctions de la base, qui vérifient l'appartenance à chaque appel.
 */

export interface MiniUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

export interface SharedListCard {
  id: string
  name: string
  isOwner: boolean
  owner: MiniUser | null
  count: number
  members: number
  posters: string[]
  /** Le titre demandé (p_external_id) est déjà dans la liste */
  has: boolean
}

export interface SharedListInvite {
  id: string
  name: string
  owner: MiniUser | null
  members: number
  createdAt: string
}

export interface SharedListMember extends MiniUser {
  status: 'pending' | 'accepted'
  isOwner: boolean
}

export interface SharedListItem {
  externalId: string
  title: string
  poster?: string
  type: MediaType
  year?: number
  addedAt: string
  addedBy: MiniUser | null
}

export interface SharedList {
  id: string
  name: string
  isOwner: boolean
  members: SharedListMember[]
  items: SharedListItem[]
}

/** Les tables / fonctions n'existent pas encore côté serveur : la fonctionnalité se masque. */
export class SharedListsUnavailable extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME = /^[a-z0-9_]{3,20}$/
const TYPES = new Set<MediaType>(['film', 'serie', 'anime', 'kdrama', 'cdrama', 'autre'])
export const SHARED_LIST_NAME_MAX = 80

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (res.ok) return res.json()
  if (res.status === 404) throw new SharedListsUnavailable(t('shared.unavailable'))
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  const msg = typeof body.message === 'string' ? body.message : ''
  if (msg.includes('rate limit')) throw new Error(t('shared.err.rate'))
  if (msg.includes('too many members')) throw new Error(t('shared.err.members'))
  if (msg.includes('too many lists')) throw new Error(t('shared.err.lists'))
  if (msg.includes('list full')) throw new Error(t('shared.err.full'))
  if (msg.includes('not connected')) throw new Error(t('shared.err.notConnected'))
  if (msg.includes('forbidden') || msg.includes('invite not found')) throw new Error(t('shared.err.forbidden'))
  throw new Error(t('social.err.server', { status: res.status }))
}

function toUser(v: unknown): MiniUser | null {
  if (!isPlainObject(v) || typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.username !== 'string' || !USERNAME.test(v.username)) return null
  return { id: v.id, username: v.username, displayName: cleanText(v.display_name, 40) ?? v.username, avatarUrl: safeMediaUrl(v.avatar_url) }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 100000) : 0)
const listId = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)

function toCard(v: unknown): SharedListCard | null {
  if (!isPlainObject(v)) return null
  const id = listId(v.id)
  const name = cleanText(v.name, SHARED_LIST_NAME_MAX)
  if (!id || !name) return null
  return {
    id,
    name,
    isOwner: v.is_owner === true,
    owner: toUser(v.owner),
    count: count(v.count),
    members: count(v.members),
    posters: (Array.isArray(v.posters) ? v.posters.slice(0, 4) : []).map(remoteImage).filter((p): p is string => !!p),
    has: v.has === true,
  }
}

function toInvite(v: unknown): SharedListInvite | null {
  if (!isPlainObject(v)) return null
  const id = listId(v.id)
  const name = cleanText(v.name, SHARED_LIST_NAME_MAX)
  if (!id || !name) return null
  return { id, name, owner: toUser(v.owner), members: count(v.members), createdAt: safeIso(v.created_at) ?? new Date(0).toISOString() }
}

function toItem(v: unknown): SharedListItem | null {
  if (!isPlainObject(v) || !isSafeExternalId(v.external_id)) return null
  const title = cleanText(v.title, 300)
  if (!title) return null
  const year = typeof v.year === 'number' && Number.isInteger(v.year) && v.year >= 1870 && v.year <= 2200 ? v.year : undefined
  return {
    externalId: v.external_id,
    title,
    poster: remoteImage(v.poster),
    type: TYPES.has(v.type as MediaType) ? (v.type as MediaType) : 'autre',
    year,
    addedAt: safeIso(v.added_at) ?? new Date(0).toISOString(),
    addedBy: toUser(v.added_by),
  }
}

function toMember(v: unknown): SharedListMember | null {
  const u = toUser(v)
  if (!u || !isPlainObject(v)) return null
  return { ...u, status: v.status === 'accepted' ? 'accepted' : 'pending', isOwner: v.is_owner === true }
}

const list = <T>(v: unknown, map: (x: unknown) => T | null, max = 500): T[] => (Array.isArray(v) ? v.slice(0, max) : []).map(map).filter((x): x is T => x !== null)

// ─── Lecture ───

export async function getSharedLists(externalId?: string): Promise<{ lists: SharedListCard[]; invites: SharedListInvite[] }> {
  const raw = await rpc('get_shared_lists', { p_external_id: externalId && isSafeExternalId(externalId) ? externalId : null })
  if (!isPlainObject(raw)) return { lists: [], invites: [] }
  return { lists: list(raw.lists, toCard, 200), invites: list(raw.invites, toInvite, 100) }
}

export async function getSharedList(id: string): Promise<SharedList | null> {
  if (!UUID.test(id)) return null
  const raw = await rpc('get_shared_list', { p_list: id })
  if (!isPlainObject(raw)) return null
  const name = cleanText(raw.name, SHARED_LIST_NAME_MAX)
  if (!name) return null
  return { id, name, isOwner: raw.is_owner === true, members: list(raw.members, toMember, 50), items: list(raw.items, toItem, 500) }
}

/** Personnes invitables (abonnés / abonnements), filtrées par pseudo ou nom. */
export async function inviteCandidates(id: string, q: string): Promise<ProfileCard[]> {
  if (!UUID.test(id)) return []
  const raw = await rpc('shared_list_candidates', { p_list: id, p_q: q.trim().slice(0, 40) })
  return list(raw, (v) => {
    const u = toUser(v)
    return u && isPlainObject(v) ? { ...u, isPrivate: v.is_private === true, relation: 'none' as const } : null
  }, 50)
}

// ─── Écriture ───

export async function createSharedList(name: string): Promise<string> {
  const raw = await rpc('create_shared_list', { p_name: name.trim().slice(0, SHARED_LIST_NAME_MAX) })
  const id = isPlainObject(raw) ? listId(raw.id) : null
  if (!id) throw new Error(t('social.err.server', { status: 500 }))
  return id
}

export const renameSharedList = (id: string, name: string) => rpc('rename_shared_list', { p_list: id, p_name: name.trim().slice(0, SHARED_LIST_NAME_MAX) })
export const deleteSharedList = (id: string) => rpc('delete_shared_list', { p_list: id })
export const inviteToSharedList = (id: string, userId: string) => rpc('invite_to_shared_list', { p_list: id, p_user: userId })
export const respondToInvite = (id: string, accept: boolean) => rpc('respond_shared_list_invite', { p_list: id, p_accept: accept })
export const leaveSharedList = (id: string) => rpc('leave_shared_list', { p_list: id })
export const removeSharedListMember = (id: string, userId: string) => rpc('remove_shared_list_member', { p_list: id, p_user: userId })
export const removeSharedListItem = (id: string, externalId: string) => rpc('remove_shared_list_item', { p_list: id, p_external_id: externalId })

/** Instantané minimal d'un titre (jamais d'image embarquée : seulement une adresse TMDB/AniList). */
export interface TitleSnapshot {
  externalId: string
  title: string
  poster?: string
  type: MediaType
  year?: number
}

export function snapshotOf(item: Pick<MediaItem, 'externalId' | 'title' | 'poster' | 'type' | 'year'>, posterFallback?: string): TitleSnapshot | null {
  if (!isSafeExternalId(item.externalId)) return null
  return { externalId: item.externalId, title: item.title, poster: remoteImage(item.poster) ?? remoteImage(posterFallback), type: item.type, year: item.year }
}

export const addSharedListItem = (id: string, s: TitleSnapshot) =>
  rpc('add_shared_list_item', {
    p_list: id,
    p_item: { external_id: s.externalId, title: s.title.slice(0, 300), poster: s.poster ?? null, type: s.type, year: s.year ?? null },
  })
