import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { cleanText, isPlainObject } from '../security'
import { cloudFetch } from './api'
import { getSession } from './auth'
import { safeMediaUrl } from './social'

/**
 * Signalements, blocages et « Signaler un bug » (côté membre).
 * Tout passe par des fonctions SQL `security definer` qui vérifient les droits et limitent les abus
 * (voir supabase/migrations/20261009160000_moderation.sql et 20261009160100_bugs_errors.sql).
 */

/** Types de contenus signalables. 'comment' et 'list' : branchés par les fonctionnalités correspondantes. */
export type ReportTargetType = 'review' | 'profile' | 'comment' | 'list'

export interface ReportTarget {
  type: ReportTargetType
  /** Identifiant du contenu : id de la fiche (avis), id du compte (profil), id du commentaire / de la liste */
  id: string
  /** Auteur du contenu */
  userId: string
}

export const REPORT_REASONS = ['spoiler', 'harassment', 'hate', 'sexual', 'spam', 'impersonation', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const REPORT_DETAILS_MAX = 500
export const BUG_DESCRIPTION_MIN = 10
export const BUG_DESCRIPTION_MAX = 2000

/** Erreur renvoyée par le serveur, avec son code court (« rate limited », « not found »…). */
export class ModerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: unknown }
    const code = typeof body.message === 'string' ? body.message.slice(0, 40) : `http ${res.status}`
    const msg =
      code === 'rate limited' ? t('report.errRate') : code === 'not found' ? t('report.errNotFound') : res.status === 404 ? t('report.errUnavailable') : t('social.err.server', { status: res.status })
    throw new ModerationError(msg, code)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/* ------------------------------------------------------------------ Signalements */

/** Signale un contenu. `duplicate` : déjà signalé par moi (rien n'est ajouté). */
export async function reportContent(target: ReportTarget, reason: ReportReason, details: string): Promise<{ duplicate: boolean }> {
  const res = await rpc<unknown>('report_content', {
    p_type: target.type,
    p_target_id: target.id,
    p_target_user: target.userId,
    p_reason: reason,
    p_details: details.trim().slice(0, REPORT_DETAILS_MAX) || null,
  })
  return { duplicate: isPlainObject(res) && res.duplicate === true }
}

/* ------------------------------------------------------------------ Blocages */

export interface BlockedUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let blocked: BlockedUser[] = []
let loaded: Promise<void> | null = null
/** Compte pour lequel la liste a été chargée (changement de compte = rechargement) */
let loadedFor: string | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

/** Charge (une fois par session) la liste des comptes que j'ai bloqués. Silencieux si le serveur n'est pas à jour. */
export function loadBlocks(force = false): Promise<void> {
  const uid = getSession()?.user.id
  if (loaded && !force && loadedFor === uid) return loaded
  if (loadedFor !== uid) blocked = []
  loadedFor = uid
  loaded = rpc<unknown>('my_blocks')
    .then((rows) => {
      blocked = (Array.isArray(rows) ? rows : []).flatMap((r) => {
        if (!isPlainObject(r) || typeof r.id !== 'string' || !UUID.test(r.id)) return []
        const username = cleanText(r.username, 20) ?? ''
        return [{ id: r.id, username, displayName: cleanText(r.display_name, 40) ?? username, avatarUrl: safeMediaUrl(r.avatar_url) }]
      })
      emit()
    })
    .catch(() => {
      /* fonction pas encore déployée / hors-ligne : rien n'est masqué */
    })
  return loaded
}

export const isBlocked = (userId: string | undefined | null) => !!userId && loadedFor === getSession()?.user.id && blocked.some((b) => b.id === userId)

/** Liste des comptes bloqués, tenue à jour (pour masquer avis / commentaires). */
export function useBlocked(enabled = true): { blocked: BlockedUser[]; isBlocked: (userId: string | undefined | null) => boolean } {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const fn = () => setTick((n) => n + 1)
    listeners.add(fn)
    void loadBlocks()
    return () => {
      listeners.delete(fn)
    }
  }, [enabled])
  return { blocked: enabled ? blocked : [], isBlocked: (id) => enabled && isBlocked(id) }
}

export async function blockUser(user: BlockedUser): Promise<void> {
  await rpc('block_user', { p_user: user.id })
  if (!isBlocked(user.id)) blocked = [user, ...blocked]
  emit()
}

export async function unblockUser(userId: string): Promise<void> {
  await rpc('unblock_user', { p_user: userId })
  blocked = blocked.filter((b) => b.id !== userId)
  emit()
}

/* ------------------------------------------------------------------ Signaler un bug */

export async function submitBugReport(description: string, context: Record<string, string>): Promise<void> {
  await rpc('submit_bug_report', { p_description: description.trim().slice(0, BUG_DESCRIPTION_MAX), p_context: context })
}
