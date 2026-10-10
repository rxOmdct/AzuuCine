import { Flag, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import type { ReportTarget } from '../../lib/cloud/moderation'
import { useEscape } from '../../lib/escape'
import { cx } from '../../lib/utils'
import ReportDialog from './ReportDialog'

export interface MenuAction {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}

/**
 * Bouton « ⋯ » réutilisable : ouvre un petit menu avec « Signaler » (+ actions en plus,
 * ex. « Bloquer »), puis la fenêtre de signalement. Cible générique : avis, profil, commentaire, liste.
 */
export default function ReportButton({
  target,
  actions = [],
  className,
  size = 18,
  label,
}: {
  target: ReportTarget
  actions?: MenuAction[]
  className?: string
  size?: number
  /** Nom accessible du bouton (par défaut « Plus d'options ») */
  label?: string
}) {
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setMenu(true)
        }}
        aria-label={label ?? t('report.more')}
        aria-haspopup="menu"
        className={cx('grid size-9 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:text-ink active:bg-surface-2', className)}
      >
        <MoreHorizontal size={size} />
      </button>
      {/* Portail : un parent animé (transform) piégerait sinon les fenêtres « fixed » dans sa boîte */}
      {menu &&
        createPortal(
          <ActionMenu onClose={() => setMenu(false)}>
            {actions.map((a) => (
              <MenuItem
                key={a.label}
                icon={a.icon}
                danger={a.danger}
                onClick={() => {
                  setMenu(false)
                  a.onClick()
                }}
              >
                {a.label}
              </MenuItem>
            ))}
            <MenuItem
              icon={<Flag size={18} />}
              danger
              onClick={() => {
                setMenu(false)
                setReport(true)
              }}
            >
              {t('report.action')}
            </MenuItem>
          </ActionMenu>,
          document.body,
        )}
      {report && createPortal(<ReportDialog target={target} onClose={() => setReport(false)} />, document.body)}
    </>
  )
}

/** Menu en bas d'écran (comme le « ⋯ » de la fiche) : Échap / geste retour le ferment, sans fermer l'écran derrière. */
function ActionMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  useBackToClose(onClose)
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div role="menu" className="sheet-in safe-bottom w-full max-w-md rounded-t-3xl border border-line-strong bg-surface p-3 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
        <button type="button" onClick={onClose} className="mt-1 w-full rounded-xl px-3 py-3 text-center text-sm text-ink-3 active:bg-surface-2">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-start text-[15px] active:bg-surface-2', danger ? 'text-accent' : 'text-ink')}
    >
      {icon}
      {children}
    </button>
  )
}
