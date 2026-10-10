import { Bug, Check, ExternalLink, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, type TKey } from '../../i18n'
import { techInfo } from '../../lib/appInfo'
import { useBackToClose } from '../../lib/backNav'
import { BUG_DESCRIPTION_MAX, BUG_DESCRIPTION_MIN, submitBugReport } from '../../lib/cloud/moderation'
import { useEscape } from '../../lib/escape'
import { useScrollLock } from '../../lib/scrollLock'
import { useMedia } from '../../store'

/** Contact de l'éditeur (sans compte, le formulaire n'est pas disponible). */
export const SUPPORT_URL = 'https://rdacet.fr'

const INFO_LABEL: Record<string, TKey> = {
  version: 'bug.info.version',
  browser: 'bug.info.browser',
  os: 'bug.info.os',
  lang: 'bug.info.lang',
  theme: 'bug.info.theme',
  screen: 'bug.info.screen',
  viewport: 'bug.info.viewport',
  route: 'bug.info.route',
  standalone: 'bug.info.standalone',
  online: 'bug.info.online',
}

/** Ligne « Signaler un bug » de la section « À propos » des réglages. */
export function BugReportRow() {
  const { account } = useMedia()
  const [open, setOpen] = useState(false)
  if (!account) {
    return (
      <a href={SUPPORT_URL} target="_blank" rel="noopener" className="flex items-center gap-3.5 px-4 py-4 transition-colors active:bg-surface-2">
        <Bug size={19} className="text-ink-2" />
        <span className="flex-1">
          <span className="block font-medium">{t('bug.title')}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{t('bug.hintLocal')}</span>
        </span>
        <ExternalLink size={16} className="text-ink-3" />
      </a>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors active:bg-surface-2">
        <Bug size={19} className="text-ink-2" />
        <span className="flex-1">
          <span className="block font-medium">{t('bug.title')}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{t('bug.hint')}</span>
        </span>
        <span className="text-ink-3">→</span>
      </button>
      {open && createPortal(<BugReportDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

/** Formulaire « Signaler un bug » : description + infos techniques (montrées avant l'envoi, rien de personnel). */
export default function BugReportDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useMedia()
  const info = useMemo(() => techInfo(settings.themeMode), [settings.themeMode])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)

  const tooShort = text.trim().length < BUG_DESCRIPTION_MIN

  const submit = async () => {
    if (tooShort || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await submitBugReport(text, info)
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex touch-none items-end justify-center overscroll-none bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-title"
        className="sheet-in safe-bottom max-h-[92dvh] w-full max-w-lg touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl border border-line-strong bg-surface p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="grid size-12 place-items-center rounded-full border border-line-strong text-accent">
              <Check size={22} />
            </span>
            <h2 id="bug-title" className="mt-4 text-lg font-semibold">
              {t('bug.thanks')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{t('bug.thanksText')}</p>
            <button type="button" onClick={onClose} className="btn btn-ghost mt-6 w-full" autoFocus>
              {t('common.close')}
            </button>
          </div>
        ) : (
          <>
            <h2 id="bug-title" className="flex items-center gap-2 text-lg font-semibold">
              <Bug size={18} className="text-accent" />
              {t('bug.title')}
            </h2>
            <p className="mt-1.5 text-sm text-ink-3">{t('bug.intro')}</p>

            <label className="mt-4 block">
              <span className="label">{t('bug.description')}</span>
              <textarea
                className="field min-h-32 resize-y text-sm"
                maxLength={BUG_DESCRIPTION_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('bug.placeholder')}
                autoFocus
              />
              <span className="mt-1 block text-end text-[11px] tabular-nums text-ink-3">
                {text.length}/{BUG_DESCRIPTION_MAX}
              </span>
            </label>

            <details className="mt-2 rounded-xl border border-line px-3.5 py-2.5 text-sm" open>
              <summary className="cursor-pointer font-medium text-ink-2">{t('bug.techTitle')}</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                {Object.entries(info).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-3">{INFO_LABEL[k] ? t(INFO_LABEL[k]) : k}</dt>
                    <dd className="min-w-0 break-words text-ink-2" dir="ltr">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{t('bug.techPrivacy')}</p>
            </details>

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-accent px-3 py-2 text-sm text-ink">
                {error}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={submit} disabled={tooShort || busy} className="btn btn-primary">
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('bug.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
