import { BellRing, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { enablePush, disablePush, getPushState, PushError, type PushState } from '../lib/push'
import { cx } from '../lib/utils'

/** Réglages → Notifications : « Notifications sur cet appareil » (Web Push, même app fermée). */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getPushState().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [])

  if (state === null) return null
  const on = state === 'on'
  const available = state === 'on' || state === 'off'

  const toggle = async () => {
    if (busy || !available) return
    setBusy(true)
    setError(null)
    try {
      if (on) {
        await disablePush()
        setState('off')
      } else {
        // La permission n'est demandée qu'ici, au clic
        setState(await enablePush())
      }
    } catch (e) {
      const code = e instanceof PushError ? e.code : 'failed'
      if (code === 'denied') setState('denied')
      else setError(code === 'not-ready' ? t('push.notReady') : t('push.error'))
    } finally {
      setBusy(false)
    }
  }

  const hint =
    state === 'needs-install'
      ? t('push.iosInstall')
      : state === 'unsupported'
        ? t('push.unsupported')
        : state === 'denied'
          ? t('push.denied')
          : t('push.deviceHint')

  return (
    <div className="card mb-3 overflow-hidden">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={!available || busy}
        onClick={() => void toggle()}
        className={cx('flex w-full items-center gap-3.5 px-4 py-3.5 text-start', !available && 'cursor-default')}
      >
        <span className={cx('grid size-10 shrink-0 place-items-center rounded-full bg-surface-2', on ? 'text-accent' : 'text-ink-2')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <BellRing size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t('push.device')}</span>
          <span className={cx('mt-0.5 block text-xs', state === 'denied' ? 'text-accent' : 'text-ink-3')}>{hint}</span>
        </span>
        {available && (
          <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-accent-fill' : 'border border-line-strong bg-surface-2')}>
            <span className={cx('absolute top-0.5 size-5 rounded-full bg-ink transition-all', on ? 'start-[22px] bg-on-accent' : 'start-0.5')} />
          </span>
        )}
      </button>
      {error && (
        <p role="alert" className="border-t border-line px-4 py-2.5 text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  )
}
