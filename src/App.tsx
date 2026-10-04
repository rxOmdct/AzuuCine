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
import { useMedia } from './store'
import type { MediaItem } from './types'

const TABS: Tab[] = ['home', 'catalog', 'stats', 'settings']

function tabFromHash(): Tab {
  const h = window.location.hash.replace('#/', '') as Tab
  return TABS.includes(h) ? h : 'home'
}

/** Formulaire ouvert : null = fermé, 'new' = ajout, sinon la fiche à éditer. */
export type EditorState = null | 'new' | MediaItem

export default function App() {
  const { error } = useMedia()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [editor, setEditor] = useState<EditorState>(null)
  const [roulette, setRoulette] = useState(false)
  const [calendar, setCalendar] = useState(false)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    window.location.hash = `/${t}`
    window.scrollTo({ top: 0 })
  }

  const openItem = (item: MediaItem) => setEditor(item)
  const openNew = () => setEditor('new')

  return (
    <SocialProvider onOpenOwnItem={openItem}>
    <SideNav current={tab} onChange={go} onAdd={openNew} />
    <div className="mx-auto min-h-dvh max-w-2xl lg:max-w-5xl lg:ps-60">
      <main className="safe-top px-4 pb-32 lg:pb-10">
        {error && <p className="mt-4 rounded-xl border border-accent p-3 text-sm text-ink">{error}</p>}
        {tab === 'home' && <HomePage onOpen={openItem} onAdd={openNew} onNavigate={go} onRoulette={() => setRoulette(true)} onCalendar={() => setCalendar(true)} />}
        {tab === 'catalog' && <CatalogPage onOpen={openItem} onAdd={openNew} />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <BottomNav current={tab} onChange={go} onAdd={openNew} />

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
