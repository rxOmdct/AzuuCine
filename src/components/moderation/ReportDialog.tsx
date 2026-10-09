import { Check, Flag, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { t, type TKey } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { REPORT_DETAILS_MAX, REPORT_REASONS, reportContent, type ReportReason, type ReportTarget } from '../../lib/cloud/moderation'
import { useEscape } from '../../lib/escape'
import { useScrollLock } from '../../lib/scrollLock'
import { cx } from '../../lib/utils'

const REASON_LABEL: Record<ReportReason, TKey> = {
  spoiler: 'report.reason.spoiler',
  harassment: 'report.reason.harassment',
  hate: 'report.reason.hate',
  sexual: 'report.reason.sexual',
  spam: 'report.reason.spam',
  impersonation: 'report.reason.impersonation',
  other: 'report.reason.other',
}
export const reasonLabel = (r: ReportReason) => t(REASON_LABEL[r])

const TITLE: Record<ReportTarget['type'], TKey> = {
  review: 'report.titleReview',
  profile: 'report.titleProfile',
  comment: 'report.titleComment',
  list: 'report.titleList',
}

/**
 * Fenêtre « Signaler » générique (avis, profil, commentaire, liste partagée) :
 * motif + précision facultative (500 caractères), envoyée à l'équipe de modération.
 */
export default function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>()
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<'sent' | 'duplicate'>()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)

  const submit = async () => {
    if (!reason || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const r = await reportContent(target, reason, details)
      setDone(r.duplicate ? 'duplicate' : 'sent')
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
        aria-labelledby="report-title"
        className="sheet-in safe-bottom max-h-[90dvh] w-full max-w-md touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl border border-line-strong bg-surface p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="grid size-12 place-items-center rounded-full border border-line-strong text-accent">
              <Check size={22} />
            </span>
            <h2 id="report-title" className="mt-4 text-lg font-semibold">
              {done === 'sent' ? t('report.thanks') : t('report.already')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{t('report.thanksText')}</p>
            <button type="button" onClick={onClose} className="btn btn-ghost mt-6 w-full" autoFocus>
              {t('common.close')}
            </button>
          </div>
        ) : (
          <>
            <h2 id="report-title" className="flex items-center gap-2 text-lg font-semibold">
              <Flag size={18} className="text-accent" />
              {t(TITLE[target.type])}
            </h2>
            <p className="mt-1.5 text-sm text-ink-3">{t('report.intro')}</p>

            <fieldset className="mt-4">
              <legend className="label">{t('report.reason')}</legend>
              <div className="space-y-1.5">
                {REPORT_REASONS.map((r) => (
                  <label
                    key={r}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                      reason === r ? 'border-accent text-ink' : 'border-line text-ink-2',
                    )}
                  >
                    <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-accent-fill" />
                    {reasonLabel(r)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="label">{t('report.details')}</span>
              <textarea
                className="field min-h-24 resize-y text-sm"
                maxLength={REPORT_DETAILS_MAX}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t('report.detailsPlaceholder')}
              />
              <span className="mt-1 block text-end text-[11px] tabular-nums text-ink-3">
                {details.length}/{REPORT_DETAILS_MAX}
              </span>
            </label>

            {error && (
              <p role="alert" className="mt-2 rounded-xl border border-accent px-3 py-2 text-sm text-ink">
                {error}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={submit} disabled={!reason || busy} className="btn btn-primary">
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('report.send')}
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-3">{t('report.privacy')}</p>
          </>
        )}
      </div>
    </div>
  )
}
