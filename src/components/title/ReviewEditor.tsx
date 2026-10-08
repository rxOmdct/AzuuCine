import { X } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { useEscape } from '../../lib/escape'
import { LIMITS } from '../../lib/security'

/** Écriture de mon avis, en plein écran pour avoir la place d'écrire. */
export default function ReviewEditor({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (notes: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial)
  useEscape(onClose)
  useBackToClose(onClose)
  const changed = text.trim() !== initial.trim()
  return (
    <div className="sheet sheet-in z-[60]" role="dialog" aria-modal="true" aria-label={t('form.review')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</h2>
          <button onClick={() => onSave(text.trim())} disabled={!changed} className="btn btn-light px-4 py-2 text-sm">
            {t('common.save')}
          </button>
        </div>
      </header>
      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pt-5 pb-[calc(10rem+env(safe-area-inset-bottom))]">
          <span className="eyebrow">{t('form.review')}</span>
          <textarea
            className="field mt-2 min-h-[45dvh] resize-none leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('form.reviewPh')}
            maxLength={LIMITS.notes}
            autoFocus
          />
          <p className="mt-2 text-xs text-ink-3">{t('title.reviewPublicHint')}</p>
        </div>
      </div>
    </div>
  )
}
