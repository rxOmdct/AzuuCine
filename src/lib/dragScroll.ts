/**
 * Carrousels horizontaux sur ordinateur : sans écran tactile, on ne peut pas les faire défiler
 * (la barre de défilement est masquée et la molette fait défiler la page).
 * On ajoute donc, pour tous les carrousels de l'app :
 *  - la molette verticale → défilement horizontal quand la souris est sur un carrousel,
 *  - le glisser-déposer à la souris (un simple clic reste un clic).
 */

function scroller(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? (target as HTMLElement) : null
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return el
    }
    el = el.parentElement
  }
  return null
}

export function enableDesktopCarousels() {
  // Molette
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const el = scroller(e.target)
      if (!el) return
      const max = el.scrollWidth - el.clientWidth
      const canMove = (e.deltaY > 0 && el.scrollLeft < max - 1) || (e.deltaY < 0 && el.scrollLeft > 1)
      if (!canMove) return // au bout du carrousel : la page reprend la main
      e.preventDefault()
      el.scrollLeft += e.deltaY
    },
    { passive: false },
  )

  // Glisser à la souris
  let drag: { el: HTMLElement; x: number; left: number; moved: boolean; id: number } | null = null
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if ((e.target as Element).closest?.('input, textarea, select')) return
    const el = scroller(e.target)
    if (el) drag = { el, x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId }
  })
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 6) return
    if (!drag.moved) {
      drag.moved = true
      drag.el.style.cursor = 'grabbing'
      drag.el.style.userSelect = 'none'
    }
    drag.el.scrollLeft = drag.left - dx
  })
  const end = () => {
    if (!drag) return
    const { el, moved } = drag
    el.style.cursor = ''
    el.style.userSelect = ''
    drag = null
    if (moved) {
      // Le relâchement après un glissement ne doit pas ouvrir la fiche sous la souris
      const stop = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
    }
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  // Les images ne doivent pas être « attrapées » par le navigateur pendant le glissement
  window.addEventListener('dragstart', (e) => {
    if (scroller(e.target)) e.preventDefault()
  })
}
