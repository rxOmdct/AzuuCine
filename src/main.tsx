import { enableDesktopCarousels } from './lib/dragScroll'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { initialLang, loadLang } from './i18n'
import { LangProvider } from './i18n/react'
import Root from './Root'
import { applySavedTheme } from './lib/theme'
// Polices embarquées dans l'app (jeu « latin », suffisant pour le français) : aucun appel à Google Fonts, fonctionne hors-ligne
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './index.css'

// Thème choisi (couleur + clair/sombre/étoilé) appliqué tout de suite, sans attendre le chargement de l'app
applySavedTheme()

// Service worker : cache l'app pour un fonctionnement hors-ligne et la met à jour automatiquement.
registerSW({ immediate: true })

// Carrousels : molette et glisser à la souris sur ordinateur
enableDesktopCarousels()

// La langue est chargée avant le premier affichage (le français est inclus, les autres arrivent en un instant)
loadLang(initialLang())
  .catch(() => loadLang('fr'))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <LangProvider>
          <Root />
        </LangProvider>
      </StrictMode>,
    )
  })
