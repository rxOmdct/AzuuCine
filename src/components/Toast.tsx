import { t } from '../i18n'
import { Undo2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Petits messages en bas de l'écran (« Supprimé · Annuler »), au-dessus de la barre de navigation.
 * Un seul à la fois : un nouveau message remplace le précédent (dont l'annulation n'est plus proposée).
 */
export interface ToastOptions {
  /** Bouton « Annuler » : remet les choses comme avant. */
  undo?: () => void | Promise<void>
  /** Durée d'affichage en ms (6 s avec « Annuler », 3 s sinon). */
  duration?: number
}

interface ToastApi {
  show: (message: string, opts?: ToastOptions) => void
  dismiss: () => void
}

interface ToastState extends ToastOptions {
  id: number
  message: string
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seq = useRef(0)

  const dismiss = useCallback(() => setToast(null), [])
  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    seq.current += 1
    setToast({ id: seq.current, message, ...opts })
  }, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toast={toast} onDismiss={dismiss} onShow={show} />
    </ToastContext.Provider>
  )
}

/** Accès aux messages. Hors du fournisseur (tests, aperçu), les appels ne font rien. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}
const NOOP: ToastApi = { show: () => {}, dismiss: () => {} }

function ToastViewport({ toast, onDismiss, onShow }: { toast: ToastState | null; onDismiss: () => void; onShow: ToastApi['show'] }) {
  const [paused, setPaused] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const remaining = useRef(0)
  const startedAt = useRef(0)

  // Nouveau message : compte à rebours complet
  useEffect(() => {
    if (!toast) return
    remaining.current = toast.duration ?? (toast.undo ? 6000 : 3000)
    setUndoing(false)
  }, [toast])

  // Le compte à rebours s'arrête tant que le doigt / la souris / le clavier est sur le message
  useEffect(() => {
    if (!toast || paused) return
    startedAt.current = Date.now()
    const id = setTimeout(onDismiss, remaining.current)
    return () => {
      clearTimeout(id)
      remaining.current = Math.max(1500, remaining.current - (Date.now() - startedAt.current))
    }
  }, [toast, paused, onDismiss])

  const undo = async () => {
    if (!toast?.undo || undoing) return
    setUndoing(true)
    try {
      await toast.undo()
      onShow(t('toast.undone'))
    } catch {
      onShow(t('toast.undoFailed'))
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 lg:bottom-6 lg:ps-64"
    >
      {toast && (
        <div
          key={toast.id}
          className="sheet-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink py-2.5 ps-4 pe-2 text-bg shadow-lg"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{toast.message}</p>
          {toast.undo && (
            <button
              onClick={() => void undo()}
              disabled={undoing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-bg/30 px-3 py-1.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
            >
              <Undo2 size={15} /> {t('toast.undo')}
            </button>
          )}
          <button onClick={onDismiss} className="grid size-8 shrink-0 place-items-center rounded-full opacity-70" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
