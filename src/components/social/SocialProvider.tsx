import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getFollowRequests, getMyProfile, type Profile, type ProfileCard } from '../../lib/cloud/social'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import EditProfile from './EditProfile'
import FollowList from './FollowList'
import ItemPeek, { type PeekOwner } from './ItemPeek'
import PeopleSearch from './PeopleSearch'
import ProfileView from './ProfileView'

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
  peek: () => {},
  openItem: () => {},
})

export const useSocial = () => useContext(SocialContext)

type Overlay =
  | { kind: 'profile'; username: string }
  | { kind: 'search' }
  | { kind: 'edit' }
  | { kind: 'follows'; profile: Profile; list: 'followers' | 'following' }

/** Profils, recherche et aperçus : affichés par-dessus l'app, empilés (le bouton fermer revient au précédent). */
export function SocialProvider({ children, onOpenOwnItem }: { children: ReactNode; onOpenOwnItem: (item: MediaItem) => void }) {
  const { account, items } = useMedia()
  const enabled = !!account
  const [me, setMe] = useState<Profile | null>(null)
  const [requests, setRequests] = useState<ProfileCard[]>([])
  const [stack, setStack] = useState<Overlay[]>([])
  const [peeked, setPeeked] = useState<{ item: MediaItem; owner?: PeekOwner }>()

  const refresh = useCallback(async () => {
    if (!enabled || !navigator.onLine) return
    try {
      const [p, r] = await Promise.all([getMyProfile(), getFollowRequests()])
      setMe(p)
      setRequests(r)
    } catch {
      /* hors-ligne / serveur pas encore à jour : le reste de l'app fonctionne */
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
      peek: (item, owner) => setPeeked({ item, owner }),
      openItem,
    }),
    [enabled, me, requests, refresh, push, openItem],
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
          ) : (
            <FollowList key={k} profile={o.profile} initial={o.list} onClose={pop} />
          ),
        )}
      {children}
      {enabled && peeked && <ItemPeek item={peeked.item} owner={peeked.owner} onClose={() => setPeeked(undefined)} />}
    </SocialContext.Provider>
  )
}
