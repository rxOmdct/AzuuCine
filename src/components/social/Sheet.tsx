import { X } from 'lucide-react'
import { type ReactNode } from 'react'
import { t } from '../../i18n'
import { useScrollLock } from '../../lib/scrollLock'
import { useEscape } from '../../lib/escape'
import { cx } from '../../lib/utils'

/** Écran plein (profil, recherche…) avec en-tête et bouton fermer. */
export default function Sheet({ title, onClose, right, children, label, elevated }: { title: ReactNode; onClose: () => void; right?: ReactNode; children: ReactNode; label: string; elevated?: boolean }) {
  useScrollLock()
  useEscape(onClose)
  return (
    <div className={cx('sheet-in fixed inset-0 flex flex-col bg-bg', elevated ? 'z-[70]' : 'z-50')} role="dialog" aria-modal="true" aria-label={label}>
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
