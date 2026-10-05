import { SocialProvider } from './components/social/SocialProvider'
import { useEffect, useState } from 'react'
import BottomNav, { type Tab } from './components/BottomNav'
import SideNav from './components/SideNav'
import MediaForm from './components/MediaForm'
import Roulette from './components/Roulette'
import CalendarView from './components/CalendarView'
import HomePage from './pages/HomePage'
import CatalogPage from './pages/CatalogPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import { useMedia } from './store'
import type { MediaItem } from './types'

const TABS: Tab[] = ['home', 'catalog', 'stats', 'settings']
// L'administration a sa propre route (#/admin), hors de la navigation principale
type Route = Tab | 'admin'

function routeFromHash(): Route {
  const h = window.location.hash.replace('#/', '')
  if (h === 'admin') return 'admin'
  return (TABS as string[]).includes(h) ? (h as Tab) : 'home'
}

/** Formulaire ouvert : null = fermé, 'new' = ajout, sinon la fiche à éditer. */
export type EditorState = null | 'new' | MediaItem

export default function App() {
  const { error } = useMedia()
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [editor, setEditor] = useState<EditorState>(null)
  const [roulette, setRoulette] = useState(false)
  const [calendar, setCalendar] = useState(false)

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Route) => {
    window.location.hash = `/${t}`
    window.scrollTo({ top: 0 })
  }
  // Dans la barre de navigation, l'administration reste rattachée à « Réglages »
  const navTab: Tab = route === 'admin' ? 'settings' : route

  const openItem = (item: MediaItem) => setEditor(item)
  const openNew = () => setEditor('new')

  return (
    <SocialProvider onOpenOwnItem={openItem}>
    <SideNav current={navTab} onChange={go} onAdd={openNew} />
    <div className="mx-auto min-h-dvh max-w-2xl lg:max-w-5xl lg:ps-60">
      <main className="safe-top px-4 pb-32 lg:pb-10">
        {error && <p className="mt-4 rounded-xl border border-accent p-3 text-sm text-ink">{error}</p>}
        {route === 'home' && <HomePage onOpen={openItem} onAdd={openNew} onNavigate={go} onRoulette={() => setRoulette(true)} onCalendar={() => setCalendar(true)} />}
        {route === 'catalog' && <CatalogPage onOpen={openItem} onAdd={openNew} />}
        {route === 'stats' && <StatsPage />}
        {route === 'settings' && <SettingsPage onOpenAdmin={() => go('admin')} />}
        {route === 'admin' && <AdminPage onBack={() => go('settings')} />}
      </main>

      <BottomNav current={navTab} onChange={go} onAdd={openNew} />

      {roulette && <Roulette onClose={() => setRoulette(false)} onOpen={openItem} />}
      {calendar && <CalendarView onClose={() => setCalendar(false)} onOpen={openItem} />}

      {editor && (
        <MediaForm
          key={editor === 'new' ? 'new' : editor.id}
          item={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onOpenItem={(i) => setEditor(i)}
          onGoToSettings={() => {
            setEditor(null)
            go('settings')
          }}
        />
      )}
    </div>
    </SocialProvider>
  )
}
