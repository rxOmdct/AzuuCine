import { useEffect } from 'react'

/**
 * Bloque le défilement de la page derrière une fenêtre (fiche, profil, aperçu…).
 * Sur iPhone, `overflow: hidden` ne suffit pas : la page derrière continuait de glisser et la
 * fiche « bougeait ». On fige donc le corps de la page à sa position, puis on la rend à la fermeture.
 * Compteur partagé : avec plusieurs fenêtres empilées, la page ne se débloque qu'à la fermeture de la dernière.
 */
let locks = 0
let savedY = 0

function apply(on: boolean) {
  const html = document.documentElement
  const body = document.body
  if (on) {
    savedY = window.scrollY
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    Object.assign(body.style, { position: 'fixed', top: `-${savedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' })
  } else {
    html.style.overflow = ''
    html.style.overscrollBehavior = ''
    Object.assign(body.style, { position: '', top: '', left: '', right: '', width: '', overflow: '' })
    window.scrollTo(0, savedY)
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
