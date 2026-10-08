import { t } from '../i18n'
import { useBackToClose } from '../lib/backNav'
import { useEscape } from '../lib/escape'

interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Fenêtre « Êtes-vous sûr ? » intégrée à l'app (plus fiable que window.confirm sur mobile). */
export default function ConfirmDialog({ open, title, message, confirmLabel = t('common.confirm'), onConfirm, onCancel }: Props) {
  useEscape(onCancel, open)
  useBackToClose(onCancel, open)

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="sheet-in safe-bottom w-full max-w-sm rounded-3xl border border-line-strong bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg">
          {title}
        </h2>
        {message && <p className="mt-2 text-sm leading-relaxed text-ink-2">{message}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="btn btn-ghost">
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm} className="btn btn-primary" autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
