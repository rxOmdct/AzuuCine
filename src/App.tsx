import { SocialProvider } from './components/social/SocialProvider'
import { ToastProvider } from './components/Toast'
import { useEffect, useState } from 'react'
import BottomNav, { type Tab } from './components/BottomNav'
import SideNav from './components/SideNav'
import AddTitle from './components/title/AddTitle'
import EditDetails from './components/title/EditDetails'
import TitleSheet from './components/title/TitleSheet'
import Roulette from './components/Roulette'
import CalendarView from './components/CalendarView'
import HomePage from './pages/HomePage'
import CatalogPage from './pages/CatalogPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import NotFoundPage from './pages/NotFoundPage'
import PushBridge from './components/PushBridge'
import SyncIndicator from './components/SyncIndicator'
import { useMedia } from './store'
import type { SearchResult } from './lib/catalogApi'
import type { MediaItem } from './types'

const TABS: Tab[] = ['home', 'catalog', 'stats', 'settings']
// L'administration a sa propre route (#/admin), hors de la navigation principale
type Route = Tab | 'admin' | 'notfound'

function routeFromHash(): Route {
  const hash = window.location.hash
  // Pas de route (ou retour de connexion « #access_token=… ») : accueil
  if (!hash.startsWith('#/')) return 'home'
  const h = hash.slice(2)
  if (h === '' || h.startsWith('u/')) return 'home'
  if (h === 'admin') return 'admin'
  return (TABS as string[]).includes(h) ? (h as Tab) : 'notfound'
}

/** Fiche ouverte : un titre de ma bibliothèque, ou un résultat de recherche pas encore ajouté. */
type Opened = { item: MediaItem; seed?: undefined } | { seed: SearchResult; item?: undefined }

export default function App() {
  const { error } = useMedia()
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [adding, setAdding] = useState(false)
  const [manual, setManual] = useState<string | null>(null)
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
  const navTab: Tab = route === 'admin' ? 'settings' : route === 'notfound' ? 'home' : route

  const openItem = (item: MediaItem) => setOpened({ item })
  const openNew = () => setAdding(true)
  const toSettings = () => {
    setOpened(null)
    setAdding(false)
    setManual(null)
    // Laisse les fenêtres retirer leur entrée d'historique avant de changer d'onglet
    setTimeout(() => go('settings'), 50)
  }

  return (
    <ToastProvider>
    <SocialProvider onOpenOwnItem={openItem}>
    <SideNav current={navTab} onChange={go} onAdd={openNew} />
    <div className="mx-auto min-h-dvh max-w-2xl lg:max-w-none lg:ps-60">
      <main className="safe-top px-4 pb-32 lg:px-10 lg:pb-10 2xl:px-14">
        {error && <p className="mt-4 rounded-xl border border-accent p-3 text-sm text-ink">{error}</p>}
        {route === 'home' && <HomePage onOpen={openItem} onAdd={openNew} onNavigate={go} onRoulette={() => setRoulette(true)} onCalendar={() => setCalendar(true)} />}
        {route === 'catalog' && <CatalogPage onOpen={openItem} onAdd={openNew} />}
        {route === 'stats' && <StatsPage />}
        {route === 'settings' && <SettingsPage onOpenAdmin={() => go('admin')} />}
        {route === 'admin' && <AdminPage onBack={() => go('settings')} />}
        {route === 'notfound' && <NotFoundPage onHome={() => go('home')} />}
      </main>

      <BottomNav current={navTab} onChange={go} onAdd={openNew} />
      <SyncIndicator />
      <PushBridge />

      {roulette && <Roulette onClose={() => setRoulette(false)} onOpen={openItem} />}
      {calendar && <CalendarView onClose={() => setCalendar(false)} onOpen={openItem} />}

      {adding && (
        <AddTitle
          onClose={() => setAdding(false)}
          onPick={(seed) => setOpened({ seed })}
          onOpenItem={openItem}
          onManual={(title) => setManual(title)}
          onGoToSettings={toSettings}
        />
      )}
      {opened && (
        <TitleSheet
          key={opened.item ? opened.item.id : opened.seed.externalId}
          item={opened.item}
          seed={opened.seed}
          onClose={() => setOpened(null)}
          onGoToSettings={toSettings}
        />
      )}
      {manual !== null && (
        <EditDetails
          initialTitle={manual}
          onClose={() => setManual(null)}
          onCreated={(item) => {
            setManual(null)
            setAdding(false)
            setOpened({ item })
          }}
        />
      )}
    </div>
    </SocialProvider>
    </ToastProvider>
  )
}
