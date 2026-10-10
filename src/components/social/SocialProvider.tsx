import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getFollowRequests, getMyProfile, type Profile, type ProfileCard } from '../../lib/cloud/social'
import { unreadCount } from '../../lib/cloud/notifications'
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
import CommentsSheet from './CommentsSheet'
import { InvitePeople, SharedListSheet } from './SharedLists'
import { getAniListById, type SearchResult } from '../../lib/catalogApi'
import { TYPE_BY_VALUE } from '../../lib/constants'
import type { SharedListItem } from '../../lib/cloud/sharedLists'

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
  /** Fil de commentaires d'un avis, en plein écran (depuis une notification) */
  openComments: (authorId: string, itemId: string, title: string) => void
  /** Liste partagée */
  openSharedList: (id: string) => void
  /** Inviter des membres dans une liste partagée */
  openInvite: (listId: string, listName: string) => void
  /** Fiche d'un titre d'une liste partagée : la mienne si je l'ai, sinon la fiche du catalogue (ajout possible) */
  openTitle: (title: SharedListItem) => void
  /** Change à chaque modification des listes partagées (pour recharger les écrans qui les affichent) */
  sharedTick: number
  bumpShared: () => void
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
  openComments: () => {},
  openSharedList: () => {},
  openInvite: () => {},
  openTitle: () => {},
  sharedTick: 0,
  bumpShared: () => {},
})

export const useSocial = () => useContext(SocialContext)

type Overlay =
  | { kind: 'profile'; username: string }
  | { kind: 'search' }
  | { kind: 'edit' }
  | { kind: 'follows'; profile: Profile; list: 'followers' | 'following' }
  | { kind: 'reviews'; externalId: string; title: string }
  | { kind: 'notifications' }
  | { kind: 'comments'; authorId: string; itemId: string; title: string }
  | { kind: 'sharedList'; id: string }
  | { kind: 'invite'; listId: string; listName: string }

/** Profils, recherche et aperçus : affichés par-dessus l'app, empilés (le bouton fermer revient au précédent). */
export function SocialProvider({
  children,
  onOpenOwnItem,
  onOpenSeed,
}: {
  children: ReactNode
  onOpenOwnItem: (item: MediaItem) => void
  /** Ouvre la fiche d'un titre pas encore dans ma bibliothèque */
  onOpenSeed?: (seed: SearchResult) => void
}) {
  const { account, items } = useMedia()
  const enabled = !!account
  const [me, setMe] = useState<Profile | null>(null)
  const [requests, setRequests] = useState<ProfileCard[]>([])
  const [unread, setUnread] = useState(0)
  const [stack, setStack] = useState<Overlay[]>([])
  const [peeked, setPeeked] = useState<{ item: MediaItem; owner?: PeekOwner }>()
  const [sharedTick, setSharedTick] = useState(0)
  const bumpShared = useCallback(() => setSharedTick((n) => n + 1), [])
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

  const openTitle = useCallback(
    async (s: SharedListItem) => {
      const local = items.find((i) => i.externalId === s.externalId)
      if (local) return onOpenOwnItem(local)
      const anilist = s.externalId.startsWith('anilist:')
      // AniList : fiche complète si possible (sinon l'instantané de la liste suffit pour l'ouvrir)
      const full = anilist && navigator.onLine ? await getAniListById(s.externalId).catch(() => null) : null
      onOpenSeed?.(
        full ?? {
          source: anilist ? 'anilist' : 'tmdb',
          externalId: s.externalId,
          title: s.title,
          year: s.year,
          thumb: s.poster,
          posterUrl: s.poster,
          kindLabel: TYPE_BY_VALUE[s.type].label,
          typeGuess: s.type,
          prefill: anilist ? { title: s.title, year: s.year, type: s.type, externalId: s.externalId, genres: [] } : undefined,
        },
      )
    },
    [items, onOpenOwnItem, onOpenSeed],
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
        // La liste se marque lue elle-même, après chargement (sinon les « non lu » n'étaient jamais visibles)
        setUnread(0)
        push({ kind: 'notifications' })
      },
      unread,
      peek: (item, owner) => setPeeked({ item, owner }),
      openItem,
      openComments: (authorId, itemId, title) => push({ kind: 'comments', authorId, itemId, title }),
      openSharedList: (id) => push({ kind: 'sharedList', id }),
      openInvite: (listId, listName) => push({ kind: 'invite', listId, listName }),
      openTitle: (s) => void openTitle(s),
      sharedTick,
      bumpShared,
    }),
    [enabled, me, requests, unread, refresh, push, openItem, openTitle, sharedTick, bumpShared],
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
          ) : o.kind === 'comments' ? (
            <CommentsSheet key={k} authorId={o.authorId} itemId={o.itemId} title={o.title} onClose={pop} />
          ) : o.kind === 'sharedList' ? (
            <SharedListSheet key={k} id={o.id} onClose={pop} />
          ) : o.kind === 'invite' ? (
            <InvitePeople key={k} listId={o.listId} listName={o.listName} onClose={pop} />
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
              onOpenComments={(itemId, title) => {
                if (!me) return
                pop()
                push({ kind: 'comments', authorId: me.id, itemId, title })
              }}
              onOpenSharedList={(id) => {
                pop()
                push({ kind: 'sharedList', id })
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
