import { cleanText, isPlainObject, safeIso } from '../security'
import { cloudFetch } from './api'
import type { ReportReason, ReportTargetType } from './moderation'
import { REPORT_REASONS } from './moderation'
import { safeMediaUrl } from './social'

/**
 * Administration : modération (signalements, comptes suspendus), bugs signalés, erreurs de l'app.
 * Toutes les fonctions SQL appelées ici vérifient is_admin() côté serveur.
 * Les réponses sont relues champ par champ (un contenu signalé peut être piégé).
 */

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await cloudFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: unknown }
    throw new Error(typeof body.message === 'string' ? body.message.slice(0, 120) : `HTTP ${res.status}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
const iso = (v: unknown) => safeIso(v) ?? new Date(0).toISOString()
const list = (v: unknown) => (Array.isArray(v) ? v : [])

export interface AdminCard {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  suspended: boolean
  isAdmin: boolean
}

function toCard(v: unknown): AdminCard | null {
  if (!isPlainObject(v) || typeof v.id !== 'string' || !UUID.test(v.id)) return null
  const username = cleanText(v.username, 20) ?? ''
  return {
    id: v.id,
    username,
    displayName: cleanText(v.display_name, 40) ?? username,
    avatarUrl: safeMediaUrl(v.avatar_url),
    suspended: v.suspended === true,
    isAdmin: v.is_admin === true,
  }
}

/* ------------------------------------------------------------------ Alertes (badge) */

export interface AdminAlerts {
  reports: number
  bugs: number
  errors: number
  suspended: number
}

export async function adminAlerts(): Promise<AdminAlerts> {
  const r = await rpc('admin_alerts')
  const o = isPlainObject(r) ? r : {}
  return { reports: int(o.reports), bugs: int(o.bugs), errors: int(o.errors), suspended: int(o.suspended) }
}

/* ------------------------------------------------------------------ Signalements */

/** Contenu signalé (copie au moment du signalement, ou version actuelle). */
export interface ReportedContent {
  title?: string
  notes?: string
  rating?: number
  username?: string
  displayName?: string
  bio?: string
  avatarUrl?: string
}

export interface ReportEntry {
  reason: ReportReason
  details?: string
  createdAt: string
  reporter: AdminCard | null
}

export interface ReportGroup {
  key: string
  targetType: ReportTargetType
  targetId: string
  targetUser: AdminCard | null
  total: number
  openCount: number
  firstAt: string
  lastAt: string
  status: 'open' | 'resolved' | 'dismissed'
  reasons: Partial<Record<ReportReason, number>>
  reports: ReportEntry[]
  snapshot?: ReportedContent
  /** null : le contenu n'existe plus (effacé) ; undefined : pas d'aperçu pour ce type */
  current?: ReportedContent | null
  /** Nombre de contenus différents de ce compte déjà signalés */
  userReportedTargets: number
}

const TARGETS: ReportTargetType[] = ['review', 'profile', 'comment', 'list']
const isReason = (v: unknown): v is ReportReason => (REPORT_REASONS as readonly unknown[]).includes(v)

function toContent(v: unknown): ReportedContent | undefined {
  if (!isPlainObject(v)) return undefined
  const rating = typeof v.rating === 'number' && v.rating > 0 && v.rating <= 10 ? v.rating : undefined
  return {
    title: cleanText(v.title, 200),
    notes: cleanText(v.notes, 3000),
    rating,
    username: cleanText(v.username, 20),
    displayName: cleanText(v.display_name, 40),
    bio: cleanText(v.bio, 300),
    avatarUrl: safeMediaUrl(v.avatar_url),
  }
}

function toGroup(v: unknown): ReportGroup | null {
  if (!isPlainObject(v)) return null
  const targetType = TARGETS.find((x) => x === v.target_type)
  const targetId = cleanText(v.target_id, 200)
  if (!targetType || !targetId) return null
  const targetUser = toCard(v.target_user)
  const reasons: Partial<Record<ReportReason, number>> = {}
  if (isPlainObject(v.reasons)) for (const r of REPORT_REASONS) if (int(v.reasons[r]) > 0) reasons[r] = int(v.reasons[r])
  const status = v.status === 'resolved' || v.status === 'dismissed' ? v.status : 'open'
  return {
    key: `${targetType}:${targetId}:${targetUser?.id ?? ''}`,
    targetType,
    targetId,
    targetUser,
    total: int(v.total),
    openCount: int(v.open_count),
    firstAt: iso(v.first_at),
    lastAt: iso(v.last_at),
    status,
    reasons,
    reports: list(v.reports).flatMap((r) =>
      isPlainObject(r) && isReason(r.reason) ? [{ reason: r.reason, details: cleanText(r.details, 500), createdAt: iso(r.created_at), reporter: toCard(r.reporter) }] : [],
    ),
    snapshot: toContent(v.snapshot),
    current: targetType === 'review' || targetType === 'profile' ? (toContent(v.current) ?? null) : undefined,
    userReportedTargets: int(v.user_reported_targets),
  }
}

export const REPORTS_PAGE = 30

export async function adminReports(status: 'open' | 'closed', offset = 0): Promise<ReportGroup[]> {
  return list(await rpc('admin_reports', { p_status: status, p_offset: offset }))
    .map(toGroup)
    .filter((g): g is ReportGroup => g !== null)
}

export type ReportAction = 'delete' | 'suspend' | 'unsuspend' | 'dismiss' | 'resolve'

export async function adminReportAction(g: Pick<ReportGroup, 'targetType' | 'targetId' | 'targetUser'>, action: ReportAction): Promise<void> {
  if (!g.targetUser) throw new Error('no target user')
  await rpc('admin_report_action', { p_type: g.targetType, p_target_id: g.targetId, p_target_user: g.targetUser.id, p_action: action })
}

/* ------------------------------------------------------------------ Comptes suspendus */

export interface SuspendedUser extends AdminCard {
  suspendedAt?: string
  suspendedBy?: string
  reports: number
}

export async function adminSuspendedUsers(offset = 0): Promise<SuspendedUser[]> {
  return list(await rpc('admin_suspended_users', { p_offset: offset })).flatMap((r) => {
    const card = toCard(r)
    if (!card || !isPlainObject(r)) return []
    return [{ ...card, suspended: true, suspendedAt: safeIso(r.suspended_at), suspendedBy: cleanText(r.suspended_by, 20), reports: int(r.reports) }]
  })
}

/* ------------------------------------------------------------------ Bugs signalés */

export type BugStatus = 'new' | 'in_progress' | 'fixed'
export const BUG_STATUSES: BugStatus[] = ['new', 'in_progress', 'fixed']

export interface BugReport {
  id: number
  description: string
  context: Record<string, string>
  status: BugStatus
  createdAt: string
  reporter: AdminCard | null
}

export async function adminBugReports(status: BugStatus | null, offset = 0): Promise<BugReport[]> {
  return list(await rpc('admin_bug_reports', { p_status: status, p_offset: offset })).flatMap((r) => {
    if (!isPlainObject(r) || typeof r.id !== 'number') return []
    const description = cleanText(r.description, 2000)
    if (!description) return []
    const context: Record<string, string> = {}
    if (isPlainObject(r.context)) {
      for (const [k, v] of Object.entries(r.context).slice(0, 12)) {
        const val = cleanText(typeof v === 'string' ? v : String(v), 120)
        if (/^[a-z]{1,20}$/.test(k) && val) context[k] = val
      }
    }
    const status = BUG_STATUSES.find((s) => s === r.status) ?? 'new'
    return [{ id: r.id, description, context, status, createdAt: iso(r.created_at), reporter: toCard(r.reporter) }]
  })
}

export async function adminSetBugStatus(id: number, status: BugStatus): Promise<void> {
  await rpc('admin_set_bug_status', { p_id: id, p_status: status })
}

/* ------------------------------------------------------------------ Erreurs de l'app */

export type ErrorStatus = 'new' | 'seen' | 'fixed'

export interface ClientError {
  fingerprint: string
  source: 'error' | 'rejection' | 'render'
  message: string
  stack?: string
  url?: string
  appVersion?: string
  userAgent?: string
  count: number
  status: ErrorStatus
  firstSeen: string
  lastSeen: string
}

export async function adminClientErrors(offset = 0): Promise<ClientError[]> {
  return list(await rpc('admin_client_errors', { p_status: null, p_offset: offset })).flatMap((r) => {
    if (!isPlainObject(r) || typeof r.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(r.fingerprint)) return []
    const message = cleanText(r.message, 500)
    if (!message) return []
    const source = r.source === 'rejection' || r.source === 'render' ? r.source : 'error'
    const status = r.status === 'seen' || r.status === 'fixed' ? r.status : 'new'
    return [
      {
        fingerprint: r.fingerprint,
        source,
        message,
        stack: cleanText(r.stack, 4000),
        url: cleanText(r.url, 300),
        appVersion: cleanText(r.app_version, 40),
        userAgent: cleanText(r.user_agent, 300),
        count: int(r.count),
        status,
        firstSeen: iso(r.first_seen),
        lastSeen: iso(r.last_seen),
      },
    ]
  })
}

/** fingerprint null + 'seen' : tout marquer comme vu. 'delete' : oublie l'erreur (elle revient si elle se reproduit). */
export async function adminSetErrorStatus(fingerprint: string | null, status: ErrorStatus | 'delete'): Promise<void> {
  await rpc('admin_set_error_status', { p_fingerprint: fingerprint, p_status: status })
}
