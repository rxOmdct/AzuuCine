import { useEffect, useRef } from 'react'

/**
 * Touche Échap : seule la fenêtre ouverte en dernier se ferme
 * (sinon une confirmation par-dessus une fiche fermait les deux d'un coup).
 */
const stack: { current: () => void }[] = []

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return
    e.preventDefault()
    stack[stack.length - 1].current()
  })
}

export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape)
  ref.current = onEscape
  useEffect(() => {
    if (!active) return
    const entry = { current: () => ref.current() }
    stack.push(entry)
    return () => {
      const k = stack.indexOf(entry)
      if (k >= 0) stack.splice(k, 1)
    }
  }, [active])
}
