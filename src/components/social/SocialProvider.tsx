import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getFollowRequests, getMyProfile, type Profile, type ProfileCard } from '../../lib/cloud/social'
import { markNotificationsRead, unreadCount } from '../../lib/cloud/notifications'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import EditProfile from './EditProfile'
import FollowList from './FollowList'
import ItemPeek, { type PeekOwner } from './ItemPeek'
import PeopleSearch from './PeopleSearch'
import ProfileView from './ProfileView'
import TitleReviews from './TitleReviews'
import Notifications from './Notifications'
import { useOnResume } from '../../lib/onResume'
import WelcomeProfile, { RANDOM_USERNAME } from './WelcomeProfile'

interface SocialApi {
  /** Réseau disponible (compte connecté) */
  enabled: boolean
  me: Profile | null
  requests: ProfileCard[]
  refresh: () => Promise<void>
  openProfile: (username: string) => void
  openSearch: () => void
  openEdit: () => void
  openFollowList: (profile: Profile, kind: 'followers' | 'following') => void
  /** Tous les avis sur un titre (amis / autres) */
  openReviews: (externalId: string, title: string) => void
  /** Panneau des notifications */
  openNotifications: () => void
  /** Notifications non lues */
  unread: number
  peek: (item: MediaItem, owner?: PeekOwner) => void
  /** Ouvre la fiche si elle est à moi, sinon l'aperçu */
  openItem: (item: MediaItem, owner?: PeekOwner) => void
}

const SocialContext = createContext<SocialApi>({
  enabled: false,
  me: null,
  requests: [],
  refresh: async () => {},
  openProfile: () => {},
  openSearch: () => {},
  openEdit: () => {},
  openFollowList: () => {},
  openReviews: () => {},
  openNotifications: () => {},
  unread: 0,
  peek: () => {},
  openItem: () => {},
})

export const useSocial = () => useContext(SocialContext)

type Overlay =
  | { kind: 'profile'; username: string }
  | { kind: 'search' }
  | { kind: 'edit' }
  | { kind: 'follows'; profile: Profile; list: 'followers' | 'following' }
  | { kind: 'reviews'; externalId: string; title: string }
  | { kind: 'notifications' }

/** Profils, recherche et aperçus : affichés par-dessus l'app, empilés (le bouton fermer revient au précédent). */
export function SocialProvider({ children, onOpenOwnItem }: { children: ReactNode; onOpenOwnItem: (item: MediaItem) => void }) {
  const { account, items } = useMedia()
  const enabled = !!account
  const [me, setMe] = useState<Profile | null>(null)
  const [requests, setRequests] = useState<ProfileCard[]>([])
  const [unread, setUnread] = useState(0)
  const [stack, setStack] = useState<Overlay[]>([])
  const [peeked, setPeeked] = useState<{ item: MediaItem; owner?: PeekOwner }>()
  // « Plus tard » sur le choix du pseudo : redemandé au prochain lancement
  const [welcomeLater, setWelcomeLater] = useState(() => {
    try {
      return sessionStorage.getItem('azuucine:welcome-later') === '1'
    } catch {
      return false
    }
  })
  const later = useCallback(() => {
    setWelcomeLater(true)
    try {
      sessionStorage.setItem('azuucine:welcome-later', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || !navigator.onLine) return
    try {
      const [p, r, u] = await Promise.all([getMyProfile(), getFollowRequests(), unreadCount()])
      setMe(p)
      setRequests(r)
      setUnread(u)
    } catch {
      /* hors-ligne / serveur pas encore à jour : le reste de l'app fonctionne */
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])
  // Nouvelles demandes d'abonnement, compteurs… mis à jour au retour sur l'app
  useOnResume(() => void refresh(), enabled)

  const push = useCallback((o: Overlay) => setStack((s) => [...s.slice(-8), o]), [])
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), [])

  // Lien partagé « #/u/pseudo »
  useEffect(() => {
    if (!enabled) return
    const check = () => {
      const m = location.hash.match(/^#\/u\/([a-z0-9_]{3,20})$/i)
      if (!m) return
      history.replaceState(null, '', `${location.pathname}${location.search}#/home`)
      push({ kind: 'profile', username: m[1].toLowerCase() })
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [enabled, push])

  const openItem = useCallback(
    (item: MediaItem, owner?: PeekOwner) => {
      const mine = !owner || owner.username === me?.username
      const local = mine ? items.find((i) => i.id === item.id) : undefined
      if (local) onOpenOwnItem(local)
      else setPeeked({ item, owner })
    },
    [items, me?.username, onOpenOwnItem],
  )

  const api = useMemo<SocialApi>(
    () => ({
      enabled,
      me,
      requests,
      refresh,
      openProfile: (username) => push({ kind: 'profile', username }),
      openSearch: () => push({ kind: 'search' }),
      openEdit: () => push({ kind: 'edit' }),
      openFollowList: (profile, list) => push({ kind: 'follows', profile, list }),
      openReviews: (externalId, title) => push({ kind: 'reviews', externalId, title }),
      openNotifications: () => {
        setUnread(0)
        void markNotificationsRead().catch(() => {})
        push({ kind: 'notifications' })
      },
      unread,
      peek: (item, owner) => setPeeked({ item, owner }),
      openItem,
    }),
    [enabled, me, requests, unread, refresh, push, openItem],
  )

  return (
    <SocialContext.Provider value={api}>
      {/* Les écrans sociaux sont placés avant l'app : une fiche ouverte depuis un profil passe au-dessus */}
      {enabled &&
        stack.map((o, k) =>
          o.kind === 'profile' ? (
            <ProfileView key={k} username={o.username} onClose={pop} />
          ) : o.kind === 'search' ? (
            <PeopleSearch key={k} onClose={pop} />
          ) : o.kind === 'edit' ? (
            <EditProfile key={k} onClose={pop} />
          ) : o.kind === 'follows' ? (
            <FollowList key={k} profile={o.profile} initial={o.list} onClose={pop} />
          ) : o.kind === 'reviews' ? (
            <TitleReviews key={k} externalId={o.externalId} title={o.title} onClose={pop} onOpenProfile={(u) => push({ kind: 'profile', username: u })} />
          ) : (
            <Notifications
              key={k}
              onClose={pop}
              onOpenProfile={(u) => push({ kind: 'profile', username: u })}
              onOpenItem={(id) => {
                const it = items.find((i) => i.id === id)
                if (it) {
                  pop()
                  onOpenOwnItem(it)
                }
              }}
            />
          ),
        )}
      {children}
      {enabled && me && RANDOM_USERNAME.test(me.username) && !welcomeLater && <WelcomeProfile onLater={later} />}
      {enabled && peeked && <ItemPeek item={peeked.item} owner={peeked.owner} onClose={() => setPeeked(undefined)} />}
    </SocialContext.Provider>
  )
}
