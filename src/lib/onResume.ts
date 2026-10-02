import { useEffect, useRef } from 'react'

/**
 * Relance `fn` quand l'app revient au premier plan (onglet réaffiché, PWA rouverte, réseau retrouvé),
 * au plus une fois toutes les `minGapMs`.
 */
export function useOnResume(fn: () => void, enabled = true, minGapMs = 20_000) {
  const last = useRef(Date.now())
  const cb = useRef(fn)
  cb.current = fn
  useEffect(() => {
    if (!enabled) return
    const run = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      if (Date.now() - last.current < minGapMs) return
      last.current = Date.now()
      cb.current()
    }
    document.addEventListener('visibilitychange', run)
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    return () => {
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('focus', run)
      window.removeEventListener('online', run)
    }
  }, [enabled, minGapMs])
}
