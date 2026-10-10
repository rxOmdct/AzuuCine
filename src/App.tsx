import { SocialProvider } from './components/social/SocialProvider'
import { ToastProvider } from './components/Toast'
import { useEffect, useState } from 'react'
import BottomNav, { type Tab } from './components/BottomNav'
import SideNav from './components/SideNav'
import AddTitle from './components/title/AddTitle'
import EditDetails from './components/title/EditDetails'
import TitleSheet from './components/title/TitleSheet'
import PersonSheet from './components/person/PersonSheet'
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

/**
 * Fenêtres ouvertes les unes sur les autres : fiche d'un titre (de ma bibliothèque, ou résultat pas encore ajouté)
 * ou page d'une personne. Titre → acteur → autre titre → … : « retour » remonte d'un cran.
 */
type Layer =
  | { kind: 'title'; item: MediaItem; seed?: undefined }
  | { kind: 'title'; seed: SearchResult; item?: undefined }
  | { kind: 'person'; personId: string; name?: string; photo?: string }
let layerUid = 0

export default function App() {
  const { error } = useMedia()
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [layers, setLayers] = useState<(Layer & { uid: number })[]>([])
  const pushLayer = (l: Layer) => setLayers((ls) => [...ls.slice(-11), { ...l, uid: ++layerUid }])
  const closeLayer = (uid: number) => setLayers((ls) => ls.filter((x) => x.uid !== uid))
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

  const openItem = (item: MediaItem) => pushLayer({ kind: 'title', item })
  const openSeed = (seed: SearchResult) => pushLayer({ kind: 'title', seed })
  const openPerson = (p: { id: string; name?: string; photo?: string }) => pushLayer({ kind: 'person', personId: p.id, name: p.name, photo: p.photo })
  const openNew = () => setAdding(true)
  const toSettings = () => {
    setLayers([])
    setAdding(false)
    setManual(null)
    // Laisse les fenêtres retirer leur entrée d'historique avant de changer d'onglet
    setTimeout(() => go('settings'), 50)
  }

  return (
    <ToastProvider>
    <SocialProvider onOpenOwnItem={openItem} onOpenSeed={openSeed}>
    <SideNav current={navTab} onChange={go} onAdd={openNew} />
    <div className="mx-auto min-h-dvh max-w-2xl lg:max-w-none lg:ps-60">
      <main className="safe-top px-4 pb-32 lg:px-10 lg:pb-10 2xl:px-14">
        {error && <p className="mt-4 rounded-xl border border-accent p-3 text-sm text-ink">{error}</p>}
        {route === 'home' && <HomePage onOpen={openItem} onAdd={openNew} onNavigate={go} onRoulette={() => setRoulette(true)} onCalendar={() => setCalendar(true)} />}
        {route === 'catalog' && <CatalogPage onOpen={openItem} onAdd={openNew} />}
        {route === 'stats' && <StatsPage onOpen={openItem} />}
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
          onPick={openSeed}
          onOpenItem={openItem}
          onOpenPerson={openPerson}
          onManual={(title) => setManual(title)}
          onGoToSettings={toSettings}
        />
      )}
      {layers.map((l) =>
        l.kind === 'title' ? (
          <TitleSheet
            key={l.uid}
            item={l.item}
            seed={l.seed}
            onClose={() => closeLayer(l.uid)}
            onGoToSettings={toSettings}
            onOpenPerson={openPerson}
          />
        ) : (
          <PersonSheet
            key={l.uid}
            personId={l.personId}
            name={l.name}
            photo={l.photo}
            onClose={() => closeLayer(l.uid)}
            onOpenItem={openItem}
            onOpenSeed={openSeed}
          />
        ),
      )}
      {manual !== null && (
        <EditDetails
          initialTitle={manual}
          onClose={() => setManual(null)}
          onCreated={(item) => {
            setManual(null)
            setAdding(false)
            openItem(item)
          }}
        />
      )}
    </div>
    </SocialProvider>
    </ToastProvider>
  )
}
