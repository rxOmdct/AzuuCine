import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { t } from '../../i18n'

/** Écran plein (profil, recherche…) avec en-tête et bouton fermer. */
export default function Sheet({ title, onClose, right, children, label }: { title: ReactNode; onClose: () => void; right?: ReactNode; children: ReactNode; label: string }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={label}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</h2>
          <span className="flex size-10 items-center justify-end">{right}</span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="safe-bottom mx-auto max-w-2xl pb-16">{children}</div>
      </div>
    </div>
  )
}
