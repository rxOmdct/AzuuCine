import Avatar from './social/Avatar'
import { useSocial } from './social/SocialProvider'
import { locale, t } from '../i18n'
import { CloudOff, KeyRound, Loader2, LogOut, RefreshCw, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { PASSWORD_MIN, updatePassword } from '../lib/cloud/auth'
import { cx } from '../lib/utils'
import type { AccountApi } from '../store'
import ConfirmDialog from './ConfirmDialog'
import { SectionTitle } from './ui'

function ago(iso?: string): string {
  if (!iso) return t('time.never')
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return t('time.justNow')
  if (s < 3600) return t('time.minutesAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return t('time.hoursAgo', { n: Math.floor(s / 3600) })
  return t('time.onDate', { date: new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) })
}

/** Réglages → Mon compte : état de la synchro, mot de passe, déconnexion. */
export default function AccountSection({ account, onMessage }: { account: AccountApi; onMessage: (kind: 'ok' | 'error', text: string) => void }) {
  const { sync } = account
  const social = useSocial()
  const [, tick] = useState(0)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState<'pw' | 'logout' | 'import' | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)

  // Rafraîchit « il y a x min »
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const statusText =
    sync.state === 'syncing'
      ? t('account.syncing')
      : sync.state === 'offline'
        ? t('account.offline')
        : sync.state === 'error'
          ? t('account.syncError')
          : t('account.synced', { when: ago(sync.lastSyncAt) })

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('pw')
    try {
      await updatePassword(pw)
      setPw('')
      setPwOpen(false)
      onMessage('ok', t('account.passwordChanged'))
    } catch (err) {
      onMessage('error', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const logout = async (force = false) => {
    setBusy('logout')
    try {
      const r = await account.logout(force)
      if (r === 'pending') setConfirmLogout(true)
    } finally {
      setBusy(null)
    }
  }

  const importDevice = async () => {
    setBusy('import')
    try {
      const n = await account.importDeviceData()
      onMessage('ok', t('account.imported', { count: n }))
    } catch {
      onMessage('error', t('account.importFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SectionTitle>{t('account.title')}</SectionTitle>
      <div className="card divide-y divide-line overflow-hidden">
        <div className="flex items-center gap-3.5 px-4 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
            <UserRound size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{account.email}</span>
            <span className={cx('mt-0.5 flex items-center gap-1.5 text-xs', sync.state === 'error' ? 'text-accent' : 'text-ink-3')}>
              {sync.state === 'offline' && <CloudOff size={12} />}
              {statusText}
              {sync.pending > 0 && sync.state !== 'syncing' && ` · ${t('account.pending', { count: sync.pending })}`}
            </span>
          </span>
          <button
            onClick={() => account.syncNow()}
            disabled={sync.state === 'syncing'}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-2"
            aria-label={t('account.syncNow')}
          >
            {sync.state === 'syncing' ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          </button>
        </div>

        <button
          onClick={() => (social.me ? social.openProfile(social.me.username) : social.openSearch())}
          className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2"
        >
          <Avatar url={social.me?.avatarUrl} name={social.me?.displayName ?? account.email} size={22} />
          <span className="flex-1">
            <span className="block font-medium">{t('social.myProfile')}</span>
            {social.me && <span className="mt-0.5 block text-xs text-ink-3">@{social.me.username}</span>}
          </span>
          {social.requests.length > 0 && <span className="rounded-full bg-accent-fill px-2 text-[11px] font-bold text-on-accent">{social.requests.length}</span>}
          <span className="text-ink-3">→</span>
        </button>

        {pwOpen ? (
          <form onSubmit={changePassword} className="space-y-2.5 px-4 py-4">
            <input
              className="field"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t('account.newPasswordPh', { n: PASSWORD_MIN })}
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              maxLength={72}
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPwOpen(false)} className="btn btn-ghost text-sm">
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={busy === 'pw'} className="btn btn-light text-sm">
                {busy === 'pw' && <Loader2 size={15} className="animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setPwOpen(true)} className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2">
            <KeyRound size={19} className="text-ink-2" />
            <span className="flex-1 font-medium">{t('account.changePassword')}</span>
            <span className="text-ink-3">→</span>
          </button>
        )}

        <button onClick={() => logout(false)} disabled={busy === 'logout'} className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2">
          {busy === 'logout' ? <Loader2 size={19} className="animate-spin text-ink-2" /> : <LogOut size={19} className="text-ink-2" />}
          <span className="flex-1">
            <span className="block font-medium">{t('account.logout')}</span>
            <span className="mt-0.5 block text-xs text-ink-3">{t('account.logoutHint')}</span>
          </span>
          <span className="text-ink-3">→</span>
        </button>
      </div>

      {account.deviceData && (
        <div className="card mt-3 space-y-3 border-ink p-4">
          <p className="text-sm">
            {account.deviceData.lists > 0
              ? t('account.deviceDataWithLists', { titles: t('account.nTitles', { count: account.deviceData.items }), lists: t('account.nLists', { count: account.deviceData.lists }) })
              : t('account.deviceData', { titles: t('account.nTitles', { count: account.deviceData.items }) })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={importDevice} disabled={busy === 'import'} className="btn btn-light text-sm">
              {busy === 'import' && <Loader2 size={15} className="animate-spin" />}
              {t('common.add')}
            </button>
            <button onClick={account.dismissDeviceData} className="btn btn-ghost text-sm">
              {t('account.ignore')}
            </button>
          </div>
          <p className="text-xs text-ink-3">{t('account.deviceHint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={confirmLogout}
        title={t('account.unsentTitle')}
        message={t('account.unsentMessage', { count: sync.pending })}
        confirmLabel={t('account.logoutAnyway')}
        onConfirm={() => {
          setConfirmLogout(false)
          void logout(true)
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </>
  )
}
