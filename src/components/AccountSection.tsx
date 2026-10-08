import Avatar from './social/Avatar'
import { useSocial } from './social/SocialProvider'
import { t } from '../i18n'
import { AlertTriangle, Check, CloudOff, KeyRound, Loader2, LogOut, RefreshCw, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PASSWORD_MIN, updatePassword } from '../lib/cloud/auth'
import { timeAgo } from '../lib/timeAgo'
import type { AccountApi } from '../store'
import ConfirmDialog from './ConfirmDialog'
import { SectionTitle } from './ui'
import { cx } from '../lib/utils'

/** Réglages → Mon compte : mot de passe, déconnexion. La synchro tourne en arrière-plan. */
export default function AccountSection({ account, onMessage }: { account: AccountApi; onMessage: (kind: 'ok' | 'error', text: string) => void }) {
  const { sync } = account
  const social = useSocial()
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState<'pw' | 'logout' | 'import' | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)

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
          </span>
        </div>

        {/* État de la synchronisation : visible, surtout quand quelque chose bloque */}
        <div className="flex items-center gap-3.5 px-4 py-3.5" role="status">
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-full bg-surface-2', sync.state === 'error' ? 'text-accent' : 'text-ink-2')}>
            {sync.state === 'syncing' ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : sync.state === 'offline' ? (
              <CloudOff size={18} />
            ) : sync.state === 'error' ? (
              <AlertTriangle size={18} />
            ) : (
              <Check size={18} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cx('block text-sm font-medium', sync.state === 'error' && 'text-accent')}>
              {sync.state === 'syncing'
                ? t('sync.syncing')
                : sync.state === 'offline'
                  ? t('sync.offline')
                  : sync.state === 'error'
                    ? t('sync.error')
                    : sync.lastSyncAt
                      ? t('sync.synced', { when: timeAgo(sync.lastSyncAt) })
                      : t('sync.never')}
            </span>
            {(sync.pending > 0 || (sync.state === 'error' && sync.error)) && (
              <span className="mt-0.5 block truncate text-xs text-ink-3">
                {[sync.pending > 0 ? t('sync.pending', { count: sync.pending }) : '', sync.state === 'error' ? sync.error : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <button
            onClick={() => void account.syncNow().catch(() => {})}
            disabled={sync.state === 'syncing' || sync.state === 'offline'}
            className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs"
          >
            {t('sync.now')}
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
