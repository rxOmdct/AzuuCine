import { useEffect } from 'react'

/**
 * Bloque le défilement de la page derrière une fenêtre (fiche, profil, aperçu…).
 * Compteur partagé : avec plusieurs fenêtres empilées, la page ne se débloque qu'à la fermeture de la dernière.
 */
let locks = 0

function apply(on: boolean) {
  for (const el of [document.documentElement, document.body]) {
    el.style.overflow = on ? 'hidden' : ''
    el.style.overscrollBehavior = on ? 'none' : ''
  }
}

export function useScrollLock() {
  useEffect(() => {
    if (locks++ === 0) apply(true)
    return () => {
      if (--locks === 0) apply(false)
    }
  }, [])
}
