import { t } from '../../i18n'
import { Check } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { cx } from '../../lib/utils'

interface Props {
  title: string
  selecting: boolean
  selected: boolean
  onToggle: () => void
  /** Appui long (téléphone) ou case à cocher (ordinateur) : entre en mode sélection avec ce titre. */
  onStartSelect: () => void
  children: ReactNode
}

const LONG_PRESS_MS = 450

/**
 * Enveloppe d'une carte du catalogue pour la sélection multiple :
 *  - téléphone : appui long sur la carte ;
 *  - ordinateur : case à cocher au survol ;
 *  - en mode sélection, toucher la carte la coche / décoche (au lieu d'ouvrir la fiche).
 */
export default function SelectableCard({ title, selecting, selected, onToggle, onStartSelect, children }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number }>(undefined)
  const fired = useRef(false)

  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    origin.current = undefined
  }

  return (
    <div
      className="group relative select-none [-webkit-touch-callout:none]"
      onPointerDown={(e) => {
        fired.current = false
        if (selecting || e.pointerType === 'mouse') return
        origin.current = { x: e.clientX, y: e.clientY }
        timer.current = setTimeout(() => {
          fired.current = true
          timer.current = undefined
          navigator.vibrate?.(12)
          onStartSelect()
        }, LONG_PRESS_MS)
      }}
      onPointerMove={(e) => {
        // Le doigt glisse (défilement) : ce n'est pas un appui long
        if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => {
        // Pas de menu « Enregistrer l'image » pendant l'appui long
        if (fired.current || timer.current) e.preventDefault()
      }}
      onClickCapture={(e) => {
        // Le « clic » qui suit un appui long ne doit pas ouvrir la fiche
        if (fired.current) {
          e.preventDefault()
          e.stopPropagation()
          fired.current = false
        }
      }}
    >
      {children}

      {selecting ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={t('select.toggle', { title })}
          className={cx('absolute -inset-1 z-10 rounded-2xl transition-colors', selected ? 'bg-accent-fill/15 ring-2 ring-accent' : 'active:bg-ink/5')}
        >
          <span
            className={cx(
              'absolute end-3 top-3 grid size-7 place-items-center rounded-full border-2 transition-colors',
              selected ? 'border-accent-fill bg-accent-fill text-on-accent' : 'border-ink/70 bg-bg/70 text-transparent',
            )}
          >
            <Check size={15} strokeWidth={3} />
          </span>
        </button>
      ) : (
        // Ordinateur : case à cocher au survol (ou au clavier) pour commencer une sélection
        <button
          type="button"
          onClick={onStartSelect}
          aria-label={t('select.toggle', { title })}
          className="absolute end-2 top-2 z-10 hidden size-7 place-items-center rounded-full border-2 border-ink/70 bg-bg/85 text-transparent opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-fine:grid"
        >
          <Check size={15} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}
