import { Check, CloudOff, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/utils'
import { useMedia } from '../store'

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

type Kind = 'offline' | 'offline-local' | 'pending' | 'synced'

/**
 * Petite pastille discrète : hors-ligne, ou modifications pas encore envoyées au compte.
 * Mobile : juste au-dessus de la barre de navigation ; ordinateur : en bas de la barre latérale.
 * Elle disparaît une fois tout synchronisé (après un bref « Synchronisé »).
 * L'état vient du moteur de synchro (useMedia().account.sync) : rien n'est recalculé ici.
 */
export default function SyncIndicator() {
  const { account } = useMedia()
  const online = useOnline()
  const pending = account?.sync.pending ?? 0
  const syncing = account?.sync.state === 'syncing'
  const failed = account?.sync.state === 'error'

  // Une modification part normalement en 1-2 s : on ne signale l'attente que si elle dure
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (pending === 0) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), failed ? 0 : 4000)
    return () => clearTimeout(timer)
  }, [pending > 0, failed])

  // Sans compte, l'app marche hors-ligne : message rassurant, que l'on peut masquer
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (online) setDismissed(false)
  }, [online])

  const base: Kind | null = !online
    ? account
      ? 'offline'
      : dismissed
        ? null
        : 'offline-local'
    : account && pending > 0 && slow
      ? 'pending'
      : null

  // Bref « Synchronisé » quand la pastille d'attente disparaît
  const [flash, setFlash] = useState(false)
  const shown = useRef<Kind | null>(null)
  useEffect(() => {
    const was = shown.current
    shown.current = base
    if (base) {
      setFlash(false)
      return
    }
    if (account && was === 'pending' && pending === 0 && online) setFlash(true)
  }, [base, account, pending, online])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(false), 2200)
    return () => clearTimeout(timer)
  }, [flash])
  const kind: Kind | null = base ?? (flash ? 'synced' : null)
  if (!kind) return null

  const text =
    kind === 'offline'
      ? pending > 0
        ? `${t('sync.offline')} · ${t('sync.pending', { count: pending })}`
        : t('netPill.offlineSync')
      : kind === 'offline-local'
        ? t('netPill.offlineLocal')
        : kind === 'pending'
          ? syncing
            ? `${t('sync.syncing')} · ${t('sync.pending', { count: pending })}`
            : t('sync.pending', { count: pending })
          : t('netPill.synced')

  const icon =
    kind === 'synced' ? (
      <Check size={14} className="shrink-0 text-accent" />
    ) : kind === 'pending' ? (
      <RefreshCw size={14} className={cx('shrink-0', syncing && 'animate-spin', failed && 'text-accent')} />
    ) : (
      <CloudOff size={14} className="shrink-0" />
    )

  const pill = 'pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 shadow-lg lg:w-full lg:rounded-xl lg:px-3 lg:py-2 lg:text-start'

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 lg:inset-x-auto lg:start-0 lg:bottom-5 lg:z-[31] lg:w-60 lg:justify-start"
      role="status"
      aria-live="polite"
      data-testid="sync-indicator"
      data-kind={kind}
    >
      {kind === 'pending' ? (
        // Envoi en attente : un appui relance la synchro
        <button type="button" onClick={() => void account?.syncNow().catch(() => {})} className={pill} title={t('sync.now')}>
          {icon}
          <span className="truncate lg:overflow-visible lg:whitespace-normal">{text}</span>
        </button>
      ) : kind === 'offline-local' ? (
        <span className={pill}>
          {icon}
          <span className="truncate lg:overflow-visible lg:whitespace-normal">{text}</span>
          <button type="button" onClick={() => setDismissed(true)} aria-label={t('netPill.hide')} className="-me-1 ms-0.5 grid size-5 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink">
            <X size={12} />
          </button>
        </span>
      ) : (
        <span className={pill}>
          {icon}
          <span className="truncate lg:overflow-visible lg:whitespace-normal">{text}</span>
        </span>
      )}
    </div>
  )
}
