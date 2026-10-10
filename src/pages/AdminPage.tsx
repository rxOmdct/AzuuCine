import { ArrowLeft, Ban, Loader2, MessageSquareOff, RotateCcw, Search, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { EmptyState, PageHeader, SectionTitle, StatTile } from '../components/ui'
import { fmtNumber, t } from '../i18n'
import {
  adminClearReview,
  adminOverview,
  adminRecentReviews,
  adminSetSuspended,
  adminUsers,
  isAdmin,
  type AdminOverview,
  type AdminReview,
  type AdminUser,
} from '../lib/cloud/admin'
import { cx, formatDate } from '../lib/utils'
import { useAdminAlerts } from '../components/moderation/useAdminAlerts'
import { BugsTab, ErrorsTab, ReportsTab, SuspendedTab } from './admin/ModerationTabs'

type Tab = 'overview' | 'reports' | 'users' | 'suspended' | 'reviews' | 'bugs' | 'errors'

const USERS_PAGE = 50
const REVIEWS_PAGE = 30

/** Nom affichable d'un compte (nom, sinon pseudo, sinon « sans profil »). */
function personName(p: { display_name: string | null; username: string | null }): string {
  return p.display_name || p.username || t('admin.anon')
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
    </div>
  )
}

/* ------------------------------------------------------------------ Vue d'ensemble */

function OverviewTab() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    adminOverview()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <EmptyState title={t('admin.loadError')} />
  if (!data) return <Spinner />

  const max = data.signups_by_day.reduce((m, d) => Math.max(m, d.n), 1)
  const days = data.signups_by_day

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label={t('admin.users')}
          value={fmtNumber(data.users)}
          hint={`${fmtNumber(data.public_profiles)} ${t('admin.public')} · ${fmtNumber(data.private_profiles)} ${t('admin.private')}`}
        />
        <StatTile
          label={t('admin.items')}
          value={fmtNumber(data.items)}
          hint={`${fmtNumber(data.films)} ${t('admin.films')} · ${fmtNumber(data.series)} ${t('admin.series')}`}
        />
        <StatTile label={t('admin.reviews')} value={fmtNumber(data.reviews)} />
        <StatTile label={t('admin.follows')} value={fmtNumber(data.follows)} hint={`${fmtNumber(data.pending_follows)} ${t('admin.pending')}`} />
        <StatTile label={t('admin.media')} value={fmtNumber(data.media_files)} />
        <StatTile label={t('admin.suspended')} value={fmtNumber(data.suspended)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('admin.signups7')} value={fmtNumber(data.signups_7d)} />
        <StatTile label={t('admin.signups30')} value={fmtNumber(data.signups_30d)} />
        <StatTile label={t('admin.active7')} value={fmtNumber(data.active_7d)} />
        <StatTile label={t('admin.newItems7')} value={fmtNumber(data.new_items_7d)} />
      </div>

      <SectionTitle>{t('admin.signupsChart')}</SectionTitle>
      <div className="card p-4">
        <div className="flex h-32 items-end gap-1">
          {days.map((d) => (
            <div
              key={d.day}
              className="min-h-[2px] flex-1 rounded-t bg-accent-fill"
              style={{ height: `${Math.max((d.n / max) * 100, 2)}%` }}
              title={`${d.day}: ${fmtNumber(d.n)}`}
            />
          ))}
        </div>
        {days.length > 0 && (
          <div className="mt-2 flex justify-between text-xs text-ink-3">
            <span>{formatDate(days[0].day)}</span>
            <span>{formatDate(days[days.length - 1].day)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Utilisateurs */

function UsersTab() {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null)
  const reqId = useRef(0)

  // Recherche débattue : chaque frappe relance une requête après 350 ms,
  // et un `reqId` évite qu'une réponse en retard n'écrase une plus récente.
  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const rows = await adminUsers(q, 0)
        if (reqId.current !== id) return
        setUsers(rows)
        setHasMore(rows.length === USERS_PAGE)
      } catch {
        if (reqId.current === id) setUsers([])
      } finally {
        if (reqId.current === id) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [q])

  const loadMore = async () => {
    const id = reqId.current
    setLoadingMore(true)
    try {
      const rows = await adminUsers(q, users.length)
      if (reqId.current !== id) return
      setUsers((prev) => [...prev, ...rows])
      setHasMore(rows.length === USERS_PAGE)
    } catch {
      /* on garde la liste en l'état */
    } finally {
      if (reqId.current === id) setLoadingMore(false)
    }
  }

  const applySuspend = async (u: AdminUser) => {
    const next = !u.suspended
    setConfirmUser(null)
    setBusyId(u.id)
    try {
      await adminSetSuspended(u.id, next)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, suspended: next } : x)))
    } catch {
      /* on laisse la ligne telle quelle */
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          className="field pl-10"
          placeholder={t('admin.searchUsers')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState title={t('admin.noUsers')} />
      ) : (
        <ul className="mt-4 space-y-2">
          {users.map((u) => (
            <li key={u.id} className="card flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{personName(u)}</span>
                  {u.suspended && (
                    <span className="shrink-0 rounded-full border border-accent px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t('admin.suspendedBadge')}
                    </span>
                  )}
                </div>
                {(u.username || u.email) && (
                  <div className="mt-0.5 truncate text-xs text-ink-3">
                    {u.username ? `@${u.username}` : ''}
                    {u.username && u.email ? ' · ' : ''}
                    {u.email ?? ''}
                  </div>
                )}
                <div className="mt-1.5 text-xs text-ink-2">
                  {`${fmtNumber(u.items)} ${t('admin.statItems')} · ${fmtNumber(u.reviews)} ${t('admin.statReviews')} · ${fmtNumber(u.followers)} ${t('admin.statFollowers')}`}
                </div>
                <div className="mt-0.5 text-xs text-ink-3">{t('admin.joined', { date: formatDate(u.created_at) })}</div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmUser(u)}
                disabled={busyId === u.id}
                className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs"
              >
                {busyId === u.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : u.suspended ? (
                  <RotateCcw className="size-4" aria-hidden />
                ) : (
                  <Ban className="size-4" aria-hidden />
                )}
                {u.suspended ? t('admin.unsuspend') : t('admin.suspend')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn btn-ghost">
            {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('social.loadMore')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmUser !== null}
        title={confirmUser?.suspended ? t('admin.confirmUnsuspendTitle') : t('admin.confirmSuspendTitle')}
        message={confirmUser?.suspended ? t('admin.confirmUnsuspendMsg') : t('admin.confirmSuspendMsg')}
        confirmLabel={confirmUser?.suspended ? t('admin.unsuspend') : t('admin.suspend')}
        onConfirm={() => confirmUser && applySuspend(confirmUser)}
        onCancel={() => setConfirmUser(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Avis */

function ReviewsTab() {
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmRev, setConfirmRev] = useState<AdminReview | null>(null)

  const keyOf = (r: AdminReview) => `${r.user_id}:${r.item_id}`

  useEffect(() => {
    let alive = true
    adminRecentReviews(0)
      .then((rows) => {
        if (!alive) return
        setReviews(rows)
        setHasMore(rows.length === REVIEWS_PAGE)
      })
      .catch(() => alive && setReviews([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const rows = await adminRecentReviews(reviews.length)
      setReviews((prev) => [...prev, ...rows])
      setHasMore(rows.length === REVIEWS_PAGE)
    } catch {
      /* on garde la liste en l'état */
    } finally {
      setLoadingMore(false)
    }
  }

  const applyClear = async (r: AdminReview) => {
    const key = keyOf(r)
    setConfirmRev(null)
    setBusyKey(key)
    try {
      await adminClearReview(r.user_id, r.item_id)
      setReviews((prev) => prev.filter((x) => keyOf(x) !== key))
    } catch {
      /* on laisse la carte en place */
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <Spinner />
  if (reviews.length === 0) return <EmptyState title={t('admin.noReviews')} />

  return (
    <div className="mt-6">
      <ul className="space-y-2">
        {reviews.map((r) => {
          const key = keyOf(r)
          return (
            <li key={key} className="card flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{r.title || t('admin.anon')}</span>
                  {r.type && <span className="text-xs uppercase tracking-wide text-ink-3">{r.type}</span>}
                  {r.rating != null && (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                      <Star className="size-3.5 text-accent" aria-hidden />
                      {fmtNumber(r.rating)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {personName(r)}
                  {r.username ? ` · @${r.username}` : ''}
                </div>
                {r.notes && <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink-2">{r.notes}</p>}
              </div>
              <button
                type="button"
                onClick={() => setConfirmRev(r)}
                disabled={busyKey === key}
                aria-label={t('admin.clearReview')}
                title={t('admin.clearReview')}
                className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs"
              >
                {busyKey === key ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageSquareOff className="size-4" aria-hidden />}
              </button>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn btn-ghost">
            {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('social.loadMore')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRev !== null}
        title={t('admin.confirmClearTitle')}
        message={t('admin.confirmClearMsg')}
        confirmLabel={t('admin.clearReview')}
        onConfirm={() => confirmRev && applyClear(confirmRev)}
        onCancel={() => setConfirmRev(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Page */

const TABS: { id: Tab; label: () => string; alert?: 'reports' | 'bugs' | 'errors' | 'suspended' }[] = [
  { id: 'overview', label: () => t('admin.tabOverview') },
  { id: 'reports', label: () => t('adminMod.tabReports'), alert: 'reports' },
  { id: 'users', label: () => t('admin.tabUsers') },
  { id: 'suspended', label: () => t('adminMod.tabSuspended'), alert: 'suspended' },
  { id: 'reviews', label: () => t('admin.tabReviews') },
  { id: 'bugs', label: () => t('adminMod.tabBugs'), alert: 'bugs' },
  { id: 'errors', label: () => t('adminMod.tabErrors'), alert: 'errors' },
]

export default function AdminPage({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  // Compteurs « à traiter » (signalements ouverts, nouveaux bugs, nouvelles erreurs), relus après chaque action
  const [alertsKey, setAlertsKey] = useState(0)
  const alerts = useAdminAlerts(allowed === true, alertsKey)
  const refreshAlerts = useCallback(() => setAlertsKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    isAdmin()
      .then((ok) => alive && setAllowed(ok))
      .catch(() => alive && setAllowed(false))
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <button type="button" onClick={onBack} className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t('settings.admin')}
      </button>

      <PageHeader title={t('admin.title')} />

      {allowed === null ? (
        <Spinner />
      ) : !allowed ? (
        <EmptyState title={t('admin.title')} text={t('admin.loadError')} />
      ) : (
        <>
          <div role="tablist" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {TABS.map((tb) => {
              const on = tab === tb.id
              const n = tb.alert && alerts ? alerts[tb.alert] : 0
              return (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(tb.id)}
                  className={cx('chip shrink-0', on && 'chip-on')}
                >
                  {tb.label()}
                  {n > 0 && (
                    <span className={cx('min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums', tb.alert === 'suspended' ? (on ? 'bg-bg/20' : 'bg-surface-2 text-ink-2') : 'bg-accent-fill text-on-accent')}>
                      {fmtNumber(n)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {tab === 'overview' && <OverviewTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'reviews' && <ReviewsTab />}
          {tab === 'reports' && <ReportsTab onChange={refreshAlerts} />}
          {tab === 'suspended' && <SuspendedTab onChange={refreshAlerts} />}
          {tab === 'bugs' && <BugsTab onChange={refreshAlerts} />}
          {tab === 'errors' && <ErrorsTab onChange={refreshAlerts} />}
        </>
      )}
    </>
  )
}
