import { useEffect, useRef } from 'react'

/**
 * Bouton / geste « retour » (swipe depuis le bord sur iPhone, bouton retour Android) :
 * chaque fenêtre ouverte (fiche, profil, recherche…) a son entrée dans l'historique,
 * et revenir en arrière ferme la fenêtre du dessus au lieu de laisser la page « rebondir ».
 *
 * L'entrée de l'historique porte la profondeur de la pile (`azuuDepth`) : on compare
 * simplement cette profondeur au nombre de fenêtres réellement ouvertes.
 */
type CloseFn = () => void

const stack: { close: CloseFn }[] = []
/** Retours déclenchés par nous (fermeture par la croix) : à ne pas traiter comme un geste. */
let ignorePops = 0
let syncTimer = 0
let listening = false

// Page rechargée avec une fenêtre ouverte : l'entrée d'historique n'a plus de fenêtre derrière elle
if (typeof history !== 'undefined' && history.state && typeof history.state === 'object' && 'azuuDepth' in history.state) {
  const { azuuDepth: _old, ...rest } = history.state as Record<string, unknown>
  history.replaceState(rest, '')
}

const depthOf = (state: unknown) => {
  const d = (state as { azuuDepth?: unknown } | null)?.azuuDepth
  return typeof d === 'number' ? d : 0
}

/** Retire de l'historique les entrées des fenêtres fermées autrement que par « retour ». */
function scheduleSync() {
  if (syncTimer) return
  syncTimer = window.setTimeout(() => {
    syncTimer = 0
    const extra = depthOf(history.state) - stack.length
    if (extra > 0) {
      ignorePops++
      history.go(-extra)
    }
  }, 0)
}

function onPop(e: PopStateEvent) {
  if (ignorePops > 0) {
    ignorePops--
    return
  }
  const depth = depthOf(e.state)
  // Ferme les fenêtres au-dessus de l'entrée atteinte (la plus haute d'abord)
  while (stack.length > depth) stack.pop()!.close()
  // Entrée laissée par une fenêtre déjà fermée : on la saute
  scheduleSync()
}

/** Ferme la fenêtre avec le geste / bouton retour du téléphone. */
export function useBackToClose(onClose: CloseFn, active = true) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!active) return
    if (!listening) {
      window.addEventListener('popstate', onPop)
      listening = true
    }
    const entry = { close: () => closeRef.current() }
    stack.push(entry)
    // Une entrée existe déjà à cette profondeur (fenêtre remontée aussitôt) : on la réutilise
    if (depthOf(history.state) < stack.length) {
      const base = history.state && typeof history.state === 'object' ? history.state : {}
      history.pushState({ ...base, azuuDepth: stack.length }, '')
    }
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      scheduleSync()
    }
  }, [active])
}
