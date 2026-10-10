import { Ban, Check, CheckCheck, Loader2, RotateCcw, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { reasonLabel } from '../../components/moderation/ReportDialog'
import Avatar from '../../components/social/Avatar'
import { EmptyState } from '../../components/ui'
import { fmtNumber, t, type TKey } from '../../i18n'
import { adminSetSuspended } from '../../lib/cloud/admin'
import {
  adminBugReports,
  adminClientErrors,
  adminReportAction,
  adminReports,
  adminSetBugStatus,
  adminSetErrorStatus,
  adminSuspendedUsers,
  BUG_STATUSES,
  REPORTS_PAGE,
  type AdminCard,
  type BugReport,
  type BugStatus,
  type ClientError,
  type ReportAction,
  type ReportedContent,
  type ReportGroup,
  type SuspendedUser,
} from '../../lib/cloud/adminModeration'
import type { ReportReason } from '../../lib/cloud/moderation'
import { timeAgo } from '../../lib/timeAgo'
import { cx, formatDate } from '../../lib/utils'

/**
 * Onglets de modération de l'administration : signalements, comptes suspendus, bugs, erreurs.
 * Chaque action appelle une fonction SQL qui vérifie is_admin() côté serveur.
 */

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
    </div>
  )
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'strong' }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone === 'accent' ? 'border-accent text-accent' : tone === 'strong' ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2',
      )}
    >
      {children}
    </span>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={cx('chip shrink-0 py-1! text-[13px]', value === o.id && 'chip-on')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ActionButton({ icon, label, onClick, busy, danger }: { icon: ReactNode; label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cx('btn px-3 py-1.5 text-xs', danger ? 'border border-accent text-accent' : 'btn-ghost')}>
      {icon}
      {label}
    </button>
  )
}

function Person({ card, size = 32 }: { card: AdminCard | null; size?: number }) {
  if (!card) return <span className="text-sm text-ink-3">{t('admin.anon')}</span>
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar url={card.avatarUrl} name={card.displayName} size={size} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{card.displayName}</span>
          {card.suspended && <Badge tone="accent">{t('admin.suspendedBadge')}</Badge>}
          {card.isAdmin && <Badge>{t('adminMod.adminBadge')}</Badge>}
        </span>
        {card.username && <span className="block truncate text-xs text-ink-3">@{card.username}</span>}
      </span>
    </span>
  )
}

function LoadMore({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <div className="mt-4 flex justify-center">
      <button type="button" onClick={onClick} disabled={busy} className="btn btn-ghost">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('social.loadMore')}
      </button>
    </div>
  )
}

/** Liste paginée générique (chargement initial, « charger plus », réponse obsolète ignorée). */
function usePaged<T>(load: (offset: number) => Promise<T[]>, pageSize: number, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const req = useRef(0)
  useEffect(() => {
    const id = ++req.current
    setLoading(true)
    setError(false)
    load(0)
      .then((r) => {
        if (req.current !== id) return
        setRows(r)
        setMore(r.length === pageSize)
      })
      .catch(() => req.current === id && (setRows([]), setError(true)))
      .finally(() => req.current === id && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const loadMore = async () => {
    const id = req.current
    setLoadingMore(true)
    try {
      const r = await load(rows.length)
      if (req.current !== id) return
      setRows((p) => [...p, ...r])
      setMore(r.length === pageSize)
    } catch {
      /* on garde la liste */
    } finally {
      setLoadingMore(false)
    }
  }
  return { rows, setRows, loading, error, more, loadingMore, loadMore }
}

/* ------------------------------------------------------------------ Signalements */

const TYPE_LABEL: Record<ReportGroup['targetType'], TKey> = {
  review: 'adminMod.typeReview',
  profile: 'adminMod.typeProfile',
  comment: 'adminMod.typeComment',
  list: 'adminMod.typeList',
}

function ContentPreview({ c, type }: { c: ReportedContent; type: ReportGroup['targetType'] }) {
  if (type === 'profile') {
    return (
      <div className="flex items-start gap-3">
        <Avatar url={c.avatarUrl} name={c.displayName ?? c.username ?? '?'} size={36} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{c.displayName}</p>
          {c.username && <p className="text-xs text-ink-3">@{c.username}</p>}
          {c.bio && <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-2">{c.bio}</p>}
        </div>
      </div>
    )
  }
  return (
    <div>
      {(c.title || c.rating != null) && (
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {c.title}
          {c.rating != null && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-ink-2">
              <Star className="size-3.5 fill-accent text-accent" aria-hidden />
              {fmtNumber(c.rating)}
            </span>
          )}
        </p>
      )}
      {c.notes && <p className="mt-1.5 line-clamp-[12] whitespace-pre-line text-sm leading-relaxed text-ink-2">{c.notes}</p>}
    </div>
  )
}

function ReportCard({ g, onAction, busy }: { g: ReportGroup; onAction: (g: ReportGroup, a: ReportAction) => void; busy: boolean }) {
  const deleted = g.current === null
  const shown = g.current ?? g.snapshot
  const edited = !!g.current && !!g.snapshot && (g.current.notes !== g.snapshot.notes || g.current.bio !== g.snapshot.bio || g.current.displayName !== g.snapshot.displayName)
  const canDelete = (g.targetType === 'review' || g.targetType === 'profile') && !deleted
  const open = g.status === 'open'
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="strong">{t(TYPE_LABEL[g.targetType])}</Badge>
        <Badge tone={g.total > 1 ? 'accent' : 'neutral'}>{t('adminMod.reportCount', { count: g.total })}</Badge>
        {!open && <Badge>{g.status === 'dismissed' ? t('adminMod.statusDismissed') : t('adminMod.statusResolved')}</Badge>}
        <span className="ms-auto text-xs text-ink-3">{timeAgo(g.lastAt)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Person card={g.targetUser} />
        {g.userReportedTargets > 1 && <span className="shrink-0 text-xs text-accent">{t('adminMod.repeat', { count: g.userReportedTargets })}</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(Object.entries(g.reasons) as [ReportReason, number][]).map(([r, n]) => (
          <Badge key={r}>
            {reasonLabel(r)}
            {n > 1 && <span className="text-ink-3">×{n}</span>}
          </Badge>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-line bg-bg p-3">
        {deleted && <p className="mb-2 text-xs font-medium text-accent">{t('adminMod.contentGone')}</p>}
        {shown ? <ContentPreview c={shown} type={g.targetType} /> : <p className="text-sm text-ink-3">{t('adminMod.noPreview', { id: g.targetId })}</p>}
        {edited && g.snapshot && (
          <details className="mt-3 border-t border-line pt-2">
            <summary className="cursor-pointer text-xs text-ink-3">{t('adminMod.editedSince')}</summary>
            <div className="mt-2">
              <ContentPreview c={g.snapshot} type={g.targetType} />
            </div>
          </details>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">{t('adminMod.reportsDetail', { count: g.reports.length })}</summary>
        <ul className="mt-2 space-y-2">
          {g.reports.map((r, k) => (
            <li key={k} className="border-s-2 border-line ps-3 text-xs">
              <p className="text-ink-3">
                <span className="font-medium text-ink-2">{r.reporter ? `@${r.reporter.username}` : t('admin.anon')}</span>
                {' · '}
                {reasonLabel(r.reason)}
                {' · '}
                {formatDate(r.createdAt)}
              </p>
              {r.details && <p className="mt-0.5 whitespace-pre-line text-sm text-ink-2">{r.details}</p>}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        {open && canDelete && (
          <ActionButton
            icon={<Trash2 className="size-4" aria-hidden />}
            label={g.targetType === 'profile' ? t('adminMod.resetProfile') : t('adminMod.deleteContent')}
            onClick={() => onAction(g, 'delete')}
            busy={busy}
            danger
          />
        )}
        {g.targetUser && !g.targetUser.isAdmin && (
          <ActionButton
            icon={g.targetUser.suspended ? <RotateCcw className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
            label={g.targetUser.suspended ? t('admin.unsuspend') : t('admin.suspend')}
            onClick={() => onAction(g, g.targetUser!.suspended ? 'unsuspend' : 'suspend')}
            busy={busy}
            danger={!g.targetUser.suspended}
          />
        )}
        {open && <ActionButton icon={<Check className="size-4" aria-hidden />} label={t('adminMod.resolve')} onClick={() => onAction(g, 'resolve')} busy={busy} />}
        {open && <ActionButton icon={<X className="size-4" aria-hidden />} label={t('adminMod.dismiss')} onClick={() => onAction(g, 'dismiss')} busy={busy} />}
        {busy && <Loader2 className="size-4 animate-spin self-center text-ink-3" aria-hidden />}
      </div>
    </li>
  )
}

export function ReportsTab({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const { rows, setRows, loading, error, more, loadingMore, loadMore } = usePaged((o) => adminReports(status, o), REPORTS_PAGE, [status])
  const [busyKey, setBusyKey] = useState<string>()
  const [confirm, setConfirm] = useState<{ g: ReportGroup; a: ReportAction }>()
  const [failed, setFailed] = useState<string>()

  const run = useCallback(
    async (g: ReportGroup, a: ReportAction) => {
      setConfirm(undefined)
      setBusyKey(g.key)
      setFailed(undefined)
      try {
        await adminReportAction(g, a)
        const suspended = a === 'suspend' ? true : a === 'unsuspend' ? false : undefined
        setRows((prev) =>
          prev
            // Les autres cibles du même compte suivent la suspension
            .map((x) => (suspended !== undefined && x.targetUser?.id === g.targetUser?.id ? { ...x, targetUser: { ...x.targetUser!, suspended } } : x))
            // Dans la file ouverte, une cible traitée disparaît
            .filter((x) => !(status === 'open' && x.key === g.key && a !== 'unsuspend')),
        )
        onChange()
      } catch (e) {
        setFailed((e as Error).message)
      } finally {
        setBusyKey(undefined)
      }
    },
    [onChange, setRows, status],
  )

  const ask = (g: ReportGroup, a: ReportAction) => (a === 'delete' || a === 'suspend' ? setConfirm({ g, a }) : void run(g, a))

  return (
    <div className="mt-6">
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { id: 'open', label: t('adminMod.open') },
          { id: 'closed', label: t('adminMod.closed') },
        ]}
      />
      {failed && <p className="mt-3 rounded-xl border border-accent px-3 py-2 text-sm">{t('adminMod.actionFailed', { error: failed })}</p>}
      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title={t('admin.loadError')} text={t('adminMod.migrationHint')} />
      ) : rows.length === 0 ? (
        <EmptyState title={status === 'open' ? t('adminMod.noOpen') : t('adminMod.noClosed')} />
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {rows.map((g) => (
            <ReportCard key={g.key} g={g} onAction={ask} busy={busyKey === g.key} />
          ))}
        </ul>
      )}
      {more && !loading && <LoadMore onClick={loadMore} busy={loadingMore} />}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.a === 'suspend' ? t('admin.confirmSuspendTitle') : confirm?.g.targetType === 'profile' ? t('adminMod.confirmResetTitle') : t('admin.confirmClearTitle')}
        message={confirm?.a === 'suspend' ? t('admin.confirmSuspendMsg') : confirm?.g.targetType === 'profile' ? t('adminMod.confirmResetMsg') : t('admin.confirmClearMsg')}
        confirmLabel={confirm?.a === 'suspend' ? t('admin.suspend') : t('adminMod.confirm')}
        onConfirm={() => confirm && void run(confirm.g, confirm.a)}
        onCancel={() => setConfirm(undefined)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Comptes suspendus */

export function SuspendedTab({ onChange }: { onChange: () => void }) {
  const { rows, setRows, loading, error, more, loadingMore, loadMore } = usePaged<SuspendedUser>((o) => adminSuspendedUsers(o), 50, [])
  const [busyId, setBusyId] = useState<string>()
  const [confirm, setConfirm] = useState<SuspendedUser>()

  const unsuspend = async (u: SuspendedUser) => {
    setConfirm(undefined)
    setBusyId(u.id)
    try {
      await adminSetSuspended(u.id, false)
      setRows((p) => p.filter((x) => x.id !== u.id))
      onChange()
    } catch {
      /* la ligne reste */
    } finally {
      setBusyId(undefined)
    }
  }

  if (loading) return <Spinner />
  if (error) return <EmptyState title={t('admin.loadError')} text={t('adminMod.migrationHint')} />
  if (rows.length === 0) return <EmptyState title={t('adminMod.noSuspended')} />
  return (
    <div className="mt-6">
      <ul className="grid gap-2 lg:grid-cols-2">
        {rows.map((u) => (
          <li key={u.id} className="card flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Person card={u} size={36} />
              <p className="mt-2 text-xs text-ink-3">
                {u.suspendedAt ? t('adminMod.suspendedOn', { date: formatDate(u.suspendedAt) }) : t('adminMod.suspendedUnknown')}
                {u.suspendedBy ? ` · @${u.suspendedBy}` : ''}
                {u.reports > 0 ? ` · ${t('adminMod.reportCount', { count: u.reports })}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => setConfirm(u)} disabled={busyId === u.id} className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs">
              {busyId === u.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
              {t('admin.unsuspend')}
            </button>
          </li>
        ))}
      </ul>
      {more && <LoadMore onClick={loadMore} busy={loadingMore} />}
      <ConfirmDialog
        open={!!confirm}
        title={t('admin.confirmUnsuspendTitle')}
        message={t('admin.confirmUnsuspendMsg')}
        confirmLabel={t('admin.unsuspend')}
        onConfirm={() => confirm && void unsuspend(confirm)}
        onCancel={() => setConfirm(undefined)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Bugs */

const BUG_LABEL: Record<BugStatus, TKey> = {
  new: 'adminMod.bugNew',
  in_progress: 'adminMod.bugInProgress',
  fixed: 'adminMod.bugFixed',
}

export function BugsTab({ onChange }: { onChange: () => void }) {
  const [filter, setFilter] = useState<BugStatus | 'all'>('all')
  const { rows, setRows, loading, error, more, loadingMore, loadMore } = usePaged<BugReport>((o) => adminBugReports(filter === 'all' ? null : filter, o), 30, [filter])
  const [busyId, setBusyId] = useState<number>()

  const setStatus = async (b: BugReport, s: BugStatus) => {
    if (b.status === s) return
    setBusyId(b.id)
    try {
      await adminSetBugStatus(b.id, s)
      setRows((p) => p.map((x) => (x.id === b.id ? { ...x, status: s } : x)))
      onChange()
    } catch {
      /* inchangé */
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <div className="mt-6">
      <Segmented value={filter} onChange={setFilter} options={[{ id: 'all' as const, label: t('adminMod.all') }, ...BUG_STATUSES.map((s) => ({ id: s, label: t(BUG_LABEL[s]) }))]} />
      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title={t('admin.loadError')} text={t('adminMod.migrationHint')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('adminMod.noBugs')} />
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {rows.map((b) => (
            <li key={b.id} className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <Person card={b.reporter} size={28} />
                <span className="shrink-0 text-xs text-ink-3">{timeAgo(b.createdAt)}</span>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{b.description}</p>
              {Object.keys(b.context).length > 0 && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl border border-line bg-bg p-3 text-[11px]">
                  {Object.entries(b.context).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="min-w-0 break-words text-ink-2" dir="ltr">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-line p-1">
                {BUG_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={b.status === s}
                    disabled={busyId === b.id}
                    onClick={() => void setStatus(b, s)}
                    className={cx('rounded-full py-1.5 text-xs font-medium transition-colors', b.status === s ? 'bg-ink text-bg' : 'text-ink-3')}
                  >
                    {t(BUG_LABEL[s])}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && !loading && <LoadMore onClick={loadMore} busy={loadingMore} />}
    </div>
  )
}

/* ------------------------------------------------------------------ Erreurs */

const SOURCE_LABEL: Record<ClientError['source'], TKey> = {
  error: 'adminMod.srcError',
  rejection: 'adminMod.srcRejection',
  render: 'adminMod.srcRender',
}

export function ErrorsTab({ onChange }: { onChange: () => void }) {
  const { rows, setRows, loading, error, more, loadingMore, loadMore } = usePaged<ClientError>((o) => adminClientErrors(o), 50, [])
  const [busy, setBusy] = useState<string>()
  const marked = useRef(false)

  // À l'ouverture : les nouvelles erreurs sont « vues » (le badge disparaît) — elles restent signalées « Nouveau » ici
  useEffect(() => {
    if (loading || error || marked.current || !rows.some((r) => r.status === 'new')) return
    marked.current = true
    adminSetErrorStatus(null, 'seen')
      .then(onChange)
      .catch(() => {})
  }, [loading, error, rows, onChange])

  const act = async (e: ClientError, s: 'fixed' | 'delete') => {
    setBusy(e.fingerprint)
    try {
      await adminSetErrorStatus(e.fingerprint, s)
      setRows((p) => (s === 'delete' ? p.filter((x) => x.fingerprint !== e.fingerprint) : p.map((x) => (x.fingerprint === e.fingerprint ? { ...x, status: 'fixed' } : x))))
      onChange()
    } catch {
      /* inchangé */
    } finally {
      setBusy(undefined)
    }
  }

  if (loading) return <Spinner />
  if (error) return <EmptyState title={t('admin.loadError')} text={t('adminMod.migrationHint')} />
  if (rows.length === 0) return <EmptyState title={t('adminMod.noErrors')} text={t('adminMod.noErrorsHint')} />
  return (
    <div className="mt-6">
      <ul className="space-y-2">
        {rows.map((e) => (
          <li key={e.fingerprint} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              {e.status === 'new' && <Badge tone="accent">{t('adminMod.errNew')}</Badge>}
              {e.status === 'fixed' && <Badge>{t('adminMod.errFixed')}</Badge>}
              <Badge>{t(SOURCE_LABEL[e.source])}</Badge>
              <Badge tone="strong">×{fmtNumber(e.count)}</Badge>
              <span className="ms-auto text-xs text-ink-3">{timeAgo(e.lastSeen)}</span>
            </div>
            <p className="mt-2 break-words font-mono text-[13px] leading-snug" dir="ltr">
              {e.message}
            </p>
            <p className="mt-1.5 text-xs text-ink-3">
              {t('adminMod.firstSeen', { date: formatDate(e.firstSeen) })}
              {e.appVersion ? ` · v${e.appVersion}` : ''}
              {e.url ? ` · ${e.url}` : ''}
            </p>
            {(e.stack || e.userAgent) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-ink-2">{t('adminMod.stack')}</summary>
                {e.userAgent && (
                  <p className="mt-2 break-words text-[11px] text-ink-3" dir="ltr">
                    {e.userAgent}
                  </p>
                )}
                {e.stack && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-line bg-bg p-3 text-[11px] leading-relaxed text-ink-2" dir="ltr">
                    {e.stack}
                  </pre>
                )}
              </details>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {e.status !== 'fixed' && (
                <ActionButton icon={<CheckCheck className="size-4" aria-hidden />} label={t('adminMod.markFixed')} onClick={() => void act(e, 'fixed')} busy={busy === e.fingerprint} />
              )}
              <ActionButton icon={<Trash2 className="size-4" aria-hidden />} label={t('adminMod.forget')} onClick={() => void act(e, 'delete')} busy={busy === e.fingerprint} />
            </div>
          </li>
        ))}
      </ul>
      {more && <LoadMore onClick={loadMore} busy={loadingMore} />}
    </div>
  )
}
