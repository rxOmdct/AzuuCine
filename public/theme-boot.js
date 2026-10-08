/*
 * AzuuCine — thème posé avant le premier affichage (script bloquant, chargé dans <head>).
 * Reprend les couleurs calculées au dernier lancement (voir applyTheme dans src/lib/theme.ts),
 * pour ne jamais voir le thème par défaut le temps que l'app démarre.
 */
;(function () {
  try {
    var raw = localStorage.getItem('azuucine:theme-css')
    if (!raw) return
    var v = JSON.parse(raw)
    var hex = /^#[0-9a-f]{6}$/i
    var modes = { light: 1, dark: 1, night: 1, starfield: 1 }
    if (!v || !modes[v.theme] || !hex.test(v.accent) || !hex.test(v.fill) || !hex.test(v.on) || !hex.test(v.canvas)) return
    var root = document.documentElement
    root.setAttribute('data-theme', v.theme)
    root.style.setProperty('--color-accent', v.accent)
    root.style.setProperty('--color-accent-fill', v.fill)
    root.style.setProperty('--color-on-accent', v.on)
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', v.canvas)
    var scheme = document.querySelector('meta[name="color-scheme"]')
    if (scheme) scheme.setAttribute('content', v.theme === 'light' ? 'light' : 'dark')
  } catch (e) {
    /* stockage indisponible : thème par défaut */
  }
})()
