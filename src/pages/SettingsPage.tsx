import { t } from '../i18n'
import { LanguageSelect } from '../i18n/react'
import { Check, Download, ExternalLink, Eye, EyeOff, HardDrive, Import, ShieldCheck, Smartphone, Trash2, Upload, UserX } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import AccountSection from '../components/AccountSection'
import PushToggle from '../components/PushToggle'
import ConfirmDialog from '../components/ConfirmDialog'
import ImportWizard from '../components/ImportWizard'
import { PageHeader, SectionTitle } from '../components/ui'
import { exportBackup, parseBackupFile, type ParsedBackup } from '../lib/backup'
import { testTmdbKey } from '../lib/catalogApi'
import { checkTmdbProxy, type ProxyState } from '../lib/cloud/api'
import { ALL_TOP_CATEGORIES, TOP_CATEGORIES } from '../lib/constants'
import { isHexColor, THEME_MODES, THEME_PRESETS } from '../lib/theme'
import { detectPlatform, useInstallPrompt } from '../lib/pwa'
import { isAdmin } from '../lib/cloud/admin'
import type { NotifPrefs } from '../types'
import { cx } from '../lib/utils'
import { useEscape } from '../lib/escape'
import { useBackToClose } from '../lib/backNav'
import { useMedia } from '../store'
import { mergeImportedSettings } from '../lib/challenges'
import { BugReportRow } from '../components/moderation/BugReport'
import { alertsSummary, useAdminAlerts } from '../components/moderation/useAdminAlerts'

type Message = { kind: 'ok' | 'error'; text: string }

const NOTIF_PREFS: { key: keyof NotifPrefs; readonly label: () => string }[] = [
  { key: 'episodes', label: () => t('settings.notifEpisodes') },
  { key: 'follows', label: () => t('settings.notifFollows') },
  { key: 'accepted', label: () => t('settings.notifAccepted') },
  { key: 'reactions', label: () => t('settings.notifReactions') },
]

function Row({ icon, title, hint, onClick, danger }: { icon: ReactNode; title: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2', danger && 'text-accent')}>
      <span className={danger ? 'text-accent' : 'text-ink-2'}>{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
      </span>
      <span className={danger ? 'text-accent' : 'text-ink-3'}>→</span>
    </button>
  )
}

export default function SettingsPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const { items, settings, updateSettings, importItems, clearAll, lists, mergeLists, account } = useMedia()
  const { canInstall, installed, install } = useInstallPrompt()
  const [admin, setAdmin] = useState(false)
  // Une seule vérification par connexion (et pas à chaque changement d'état de la synchro)
  const signedIn = !!account
  useEffect(() => {
    if (signedIn) void isAdmin().then(setAdmin)
    else setAdmin(false)
  }, [signedIn])
  const adminHint = alertsSummary(useAdminAlerts(admin))
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ParsedBackup>()
  const [message, setMessage] = useState<Message>()
  const [confirm, setConfirm] = useState<null | 'reset' | 'replace' | 'delete-account'>(null)
  const [deleting, setDeleting] = useState(false)
  const [usage, setUsage] = useState<string>()
  const [keyDraft, setKeyDraft] = useState(settings.tmdbKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [keyState, setKeyState] = useState<'idle' | 'testing' | 'ok' | 'bad'>(settings.tmdbKey ? 'ok' : 'idle')

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then(({ usage: u }) => u != null && setUsage(u < 1e6 ? t('common.kb', { n: Math.max(1, Math.round(u / 1e3)) }) : t('common.mb', { n: (u / 1e6).toFixed(1).replace('.', t('common.decimalSep')) })))
      .catch(() => {})
  }, [items.length])

  // Avec un compte : vérifie que le proxy TMDB fonctionne vraiment
  const [proxy, setProxy] = useState<ProxyState | 'checking'>('checking')
  const runProxyCheck = async () => {
    setProxy('checking')
    setProxy(await checkTmdbProxy())
  }
  useEffect(() => {
    if (account) void runProxyCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!account])

  const saveKey = async () => {
    const key = keyDraft.trim()
    if (!key) {
      updateSettings({ tmdbKey: undefined })
      setKeyState('idle')
      return
    }
    setKeyState('testing')
    const ok = await testTmdbKey(key)
    setKeyState(ok ? 'ok' : 'bad')
    if (ok) updateSettings({ tmdbKey: key })
  }

  const onExport = async () => {
    try {
      const how = await exportBackup(items, settings, lists)
      setMessage({ kind: 'ok', text: how === 'shared' ? t('settings.backupShared') : t('settings.backupDownloaded') })
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') setMessage({ kind: 'error', text: t('settings.exportFailed') })
    }
  }

  const onFile = async (file?: File) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    try {
      const parsed = await parseBackupFile(file)
      if (!parsed.items.length) throw new Error(t('settings.noValidItems'))
      setPending(parsed)
      setMessage(undefined)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  // Le message s'affiche en bas de l'écran puis disparaît (visible même en bas de page)
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(undefined), 3500)
    return () => clearTimeout(timer)
  }, [message])

  const confirmImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return
    setConfirm(null)
    await importItems(pending.items, mode)
    if (pending.settings) updateSettings(mode === 'merge' ? mergeImportedSettings(pending.settings, settings) : pending.settings)
    if (pending.lists) mergeLists(pending.lists, mode)
    setMessage({
      kind: 'ok',
      text: pending.skipped ? t('settings.importedSkipped', { n: pending.items.length, skipped: pending.skipped }) : t('settings.imported', { count: pending.items.length }),
    })
    setPending(undefined)
  }

  const onDeleteAccount = async () => {
    if (!account) return
    setConfirm(null)
    setDeleting(true)
    try {
      await account.deleteAccount()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setDeleting(false)
    }
  }

  const onReset = async () => {
    setConfirm(null)
    await clearAll()
    setMessage({ kind: 'ok', text: t('settings.cleared') })
  }

  const [showImport, setShowImport] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  useEscape(() => setShowInstall(false), showInstall)
  useBackToClose(() => setShowInstall(false), showInstall)
  const platform = detectPlatform()

  const doNativeInstall = async () => {
    const ok = await install()
    setShowInstall(false)
    if (ok) setMessage({ kind: 'ok', text: t('settings.installed') })
  }

  return (
    <>
      <PageHeader title={t('settings.pageTitle')} accent={t('settings.pageAccent')} />

      {message && (
        <p
          role="status"
          className={cx(
            'sheet-in fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-2xl border bg-surface-2 p-3.5 text-sm text-ink',
            message.kind === 'ok' ? 'border-line-strong' : 'border-accent',
          )}
        >
          {message.text}
        </p>
      )}

      {account && <AccountSection account={account} onMessage={(kind, text) => setMessage({ kind, text })} />}

      {admin && (
        <>
          <SectionTitle>{t('settings.admin')}</SectionTitle>
          <div className="card overflow-hidden">
            <Row icon={<ShieldCheck size={19} />} title={t('admin.title')} hint={adminHint} onClick={onOpenAdmin} />
          </div>
        </>
      )}

      <SectionTitle>{t('settings.language')}</SectionTitle>
      <LanguageSelect />
      <p className="mt-2.5 text-xs text-ink-3">{t('settings.languageHint')}</p>

      <SectionTitle>{t('settings.rating')}</SectionTitle>
      <div className="grid grid-cols-2 gap-1 rounded-full border border-line p-1">
        {(['5', '10'] as const).map((scale) => (
          <button
            key={scale}
            onClick={() => updateSettings({ ratingScale: scale })}
            className={cx('rounded-full py-2.5 text-sm font-medium transition-colors', settings.ratingScale === scale ? 'bg-ink text-bg' : 'text-ink-3')}
          >
            {scale === '5' ? t('settings.scale5') : t('settings.scale10')}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">{t('settings.ratingHint')}</p>

      <SectionTitle>{t('settings.appearance')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {THEME_MODES.map(({ value, label }) => {
          const on = settings.themeMode === value
          return (
            <button key={value} onClick={() => updateSettings({ themeMode: value })} className={cx('chip', on && 'chip-on')} aria-pressed={on}>
              {on && <Check size={14} />}
              {label}
            </button>
          )
        })}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">{t('settings.appearanceHint')}</p>

      <SectionTitle>{t('settings.accentColor')}</SectionTitle>
      <div className="grid grid-cols-6 gap-3">
        {THEME_PRESETS.map((p) => {
          const on = settings.accentColor.toLowerCase() === p.color
          return (
            <button
              key={p.color}
              onClick={() => updateSettings({ accentColor: p.color })}
              className="flex flex-col items-center gap-1.5"
              aria-pressed={on}
              aria-label={t('settings.themeX', { name: p.name })}
            >
              <span
                className={cx('grid size-10 place-items-center rounded-full transition', on ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : '')}
                style={{ background: p.color }}
              >
                {on && <Check size={17} strokeWidth={3} className="text-on-accent" />}
              </span>
              <span className={cx('text-[11px]', on ? 'text-ink' : 'text-ink-3')}>{p.name}</span>
            </button>
          )
        })}
      </div>
      <label className="mt-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
        <span className="relative size-8 shrink-0 overflow-hidden rounded-full border border-line-strong" style={{ background: settings.accentColor }}>
          <input
            type="color"
            value={settings.accentColor}
            onChange={(e) => isHexColor(e.target.value) && updateSettings({ accentColor: e.target.value })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={t('settings.pickColor')}
          />
        </span>
        <span className="flex-1 text-sm">
          {t('settings.freeColor')}
          <span className="block text-xs text-ink-3">{t('settings.freeColorHint')}</span>
        </span>
        <span className="text-xs uppercase text-ink-3">{settings.accentColor}</span>
      </label>

      <SectionTitle>{t('settings.installApp')}</SectionTitle>
      <div className="card overflow-hidden">
        {installed ? (
          <div className="flex w-full items-center gap-3.5 px-4 py-4 text-start">
            <span className="text-ink-2"><Check size={19} /></span>
            <span className="flex-1 font-medium text-ink-3">{t('settings.installed')}</span>
          </div>
        ) : (
          <button onClick={() => setShowInstall(true)} className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2">
            <span className="text-ink-2"><Smartphone size={19} /></span>
            <span className="flex-1 font-medium">{t('settings.installApp')}</span>
            <span className="text-ink-3">→</span>
          </button>
        )}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">{t('settings.installHint')}</p>

      {showInstall && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={() => setShowInstall(false)}>
          <div role="dialog" aria-modal="true" className="sheet-in safe-bottom w-full max-w-sm rounded-3xl border border-line-strong bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="flex items-center gap-2 text-lg"><Smartphone size={20} className="text-accent" /> {t('install.title')}</h2>
            <ol className="mt-4 space-y-3">
              {t(`install.${platform}`).split('\n').map((step, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-ink">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex gap-2">
              {canInstall && (
                <button onClick={doNativeInstall} className="btn btn-primary flex-1">
                  <Download size={17} /> {t('settings.installApp')}
                </button>
              )}
              <button onClick={() => setShowInstall(false)} className={cx('btn', canInstall ? 'btn-ghost px-5' : 'btn-light flex-1')}>
                {t('install.gotIt')}
              </button>
            </div>
          </div>
        </div>
      )}

      {account && (
        <>
          <SectionTitle>{t('settings.notifs')}</SectionTitle>
          <p className="mb-3 text-xs text-ink-3">{t('settings.notifsHint')}</p>
          <PushToggle />
          <div className="card divide-y divide-line overflow-hidden">
            {NOTIF_PREFS.map(({ key, label }) => {
              const on = settings.notifPrefs?.[key] !== false
              return (
                <button
                  key={key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => updateSettings({ notifPrefs: { ...settings.notifPrefs, [key]: !on } })}
                  className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start"
                >
                  <span className="flex-1 text-sm font-medium">{label()}</span>
                  <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-accent-fill' : 'border border-line-strong bg-surface-2')}>
                    <span className={cx('absolute top-0.5 size-5 rounded-full bg-ink transition-all', on ? 'start-[22px] bg-on-accent' : 'start-0.5')} />
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}

      <SectionTitle>{t('settings.databases')}</SectionTitle>
      <div className="card space-y-4 p-4">
        <div>
          <div className="flex items-center justify-between">
            <span className="font-medium">AniList</span>
            <span className="eyebrow">{t('settings.anilistActive')}</span>
          </div>
          <p className="mt-1 text-xs text-ink-3">{t('settings.noConfig')}</p>
        </div>
        {account ? (
          <div className="border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">TMDB</span>
              <span className={cx('eyebrow', proxy === 'ok' && 'text-ink', (proxy === 'missing-key' || proxy === 'not-deployed' || proxy === 'error') && 'text-accent')}>
                {proxy === 'ok'
                  ? t('settings.tmdbActive')
                  : proxy === 'checking'
                    ? t('settings.checking')
                    : proxy === 'offline'
                      ? t('settings.offline')
                      : proxy === 'missing-key'
                        ? t('settings.proxyMissingKey')
                        : proxy === 'not-deployed'
                          ? t('settings.proxyNotDeployed')
                          : t('settings.unavailable')}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {proxy === 'missing-key'
                ? t('settings.proxyMissingKeyHint')
                : proxy === 'not-deployed'
                  ? t('settings.proxyNotDeployedHint')
                  : proxy === 'error'
                    ? t('settings.proxyErrorHint')
                    : t('settings.proxyOkHint')}
            </p>
            {proxy !== 'ok' && proxy !== 'checking' && (
              <button onClick={() => void runProxyCheck()} className="mt-2 text-xs font-medium text-ink-3">
                {t('settings.recheck')} <span className="text-accent">→</span>
              </button>
            )}
          </div>
        ) : (
          <div className="border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">TMDB</span>
              <span className={cx('eyebrow', keyState === 'ok' && 'text-ink', keyState === 'bad' && 'text-accent')}>
                {keyState === 'ok' ? t('settings.tmdbActive') : keyState === 'bad' ? t('settings.keyRefused') : keyState === 'testing' ? t('settings.checking') : t('settings.notConfigured')}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              {t('settings.tmdbHelp')}
            </p>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <input
                  className="field pe-11 text-sm"
                  type={showKey ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={(e) => {
                    setKeyDraft(e.target.value)
                    setKeyState('idle')
                  }}
                  placeholder={t('settings.tmdbKey')}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-3" aria-label={showKey ? t('settings.hideKey') : t('settings.showKey')}>
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <button onClick={saveKey} disabled={keyState === 'testing'} className="btn btn-light px-4 text-sm">
                {keyDraft.trim() ? t('settings.validate') : t('settings.remove')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">{t('settings.keyLocal')}</p>
          </div>
        )}
      </div>

      <SectionTitle>Top 5</SectionTitle>
      <p className="mb-3 text-xs text-ink-3">{t('settings.topHint')}</p>
      <div className="flex flex-wrap gap-2">
        {TOP_CATEGORIES.map((c) => {
          const on = settings.topCategories.includes(c.value)
          return (
            <button
              key={c.value}
              onClick={() =>
                updateSettings({
                  topCategories: on
                    ? settings.topCategories.filter((v) => v !== c.value)
                    : ALL_TOP_CATEGORIES.filter((v) => v === c.value || settings.topCategories.includes(v)),
                })
              }
              className={cx('chip', on && 'chip-on')}
              aria-pressed={on}
            >
              {on && <Check size={14} />}
              {c.plural}
            </button>
          )
        })}
      </div>
      {settings.topCategories.length === 0 && <p className="mt-2 text-xs text-ink-3">{t('settings.topNone')}</p>}

      <SectionTitle>{t('settings.backup')}</SectionTitle>
      <div className="card divide-y divide-line overflow-hidden">
        <Row icon={<Download size={19} />} title={t('settings.export')} hint={t('settings.exportHint', { count: items.length })} onClick={onExport} />
        <Row icon={<Upload size={19} />} title={t('settings.import')} hint={t('settings.importHint')} onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <Row icon={<Import size={19} />} title={t('import.row')} hint={t('import.rowHint')} onClick={() => setShowImport(true)} />
      </div>
      {showImport && <ImportWizard onClose={() => setShowImport(false)} />}

      {pending && (
        <div className="card mt-3 space-y-3 border-ink p-4">
          <p className="text-sm">
            {pending.format === 'legacy' && <span className="eyebrow mb-2 block text-ink">{t('settings.legacyDetected')}</span>}
            {pending.skipped ? t('settings.foundSkipped', { n: pending.items.length, skipped: pending.skipped }) : t('settings.found', { count: pending.items.length })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => confirmImport('merge')} className="btn btn-light text-sm">
              {t('settings.merge')}
            </button>
            <button onClick={() => setConfirm('replace')} className="btn btn-ghost text-sm">
              {t('settings.replaceAll')}
            </button>
          </div>
          <p className="text-xs text-ink-3">{t('settings.mergeHint')}</p>
          <button onClick={() => setPending(undefined)} className="w-full text-xs text-ink-3">
            {t('common.cancel')}
          </button>
        </div>
      )}

      <SectionTitle>{t('settings.storage')}</SectionTitle>
      <div className="card space-y-3.5 p-4 text-sm">
        <div className="flex items-center gap-3">
          <HardDrive size={18} className="text-ink-3" />
          <span className="flex-1 text-ink-2">{t('settings.used')}</span>
          <span className="text-xs">{usage ?? '—'}</span>
        </div>
        <p className="border-t border-line pt-3.5 text-xs leading-relaxed text-ink-3">
          {account
            ? t('settings.storageCloud')
            : t('settings.storageLocal')}
        </p>
      </div>

      <SectionTitle>{t('settings.danger')}</SectionTitle>
      <div className="card overflow-hidden">
        <Row icon={<Trash2 size={19} />} title={t('settings.clearAll')} hint={account ? t('settings.clearAllHintCloud', { count: items.length }) : t('settings.clearAllHint', { count: items.length })} onClick={() => setConfirm('reset')} danger />
        {account && (
          <div className="border-t border-line">
            <Row
              icon={<UserX size={19} />}
              title={deleting ? t('settings.deleting') : t('settings.deleteAccount')}
              hint={t('settings.deleteAccountHint')}
              onClick={() => !deleting && setConfirm('delete-account')}
              danger
            />
          </div>
        )}
      </div>

      <SectionTitle>{t('settings.about')}</SectionTitle>
      <div className="card divide-y divide-line overflow-hidden">
        <BugReportRow />
        {(
          [
            ['/privacy.html', t('legal.privacy')],
            ['/legal.html#conditions', t('legal.terms')],
            ['/legal.html#mentions', t('legal.notice')],
            ['/legal.html#credits', t('legal.credits')],
          ] as const
        ).map(([href, label]) => (
          <a key={href} href={href} target="_blank" rel="noopener" className="flex items-center gap-3.5 px-4 py-4 font-medium transition-colors active:bg-surface-2">
            <span className="flex-1">{label}</span>
            <ExternalLink size={16} className="text-ink-3" />
          </a>
        ))}
      </div>
      <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">{t('legal.tmdb')}</p>

      <p className="mt-10 text-center text-xs text-ink-3">AzuuCine v2.2 · {account ? t('settings.footerCloud') : t('settings.footerLocal')}</p>

      <ConfirmDialog
        open={confirm === 'reset'}
        title={t('confirm.title')}
        message={account ? t('settings.clearConfirmCloud', { count: items.length }) : t('settings.clearConfirm', { count: items.length })}
        confirmLabel={t('settings.clearAllConfirm')}
        onConfirm={onReset}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete-account'}
        title={t('settings.deleteAccountTitle')}
        message={t('settings.deleteAccountMessage')}
        confirmLabel={t('settings.deleteForever')}
        onConfirm={onDeleteAccount}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'replace'}
        title={t('confirm.title')}
        message={t('settings.replaceConfirm')}
        confirmLabel={t('settings.replace')}
        onConfirm={() => confirmImport('replace')}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
