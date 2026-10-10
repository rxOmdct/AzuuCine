import { useEffect, useRef, useState } from 'react'
import { keepPushFresh } from '../lib/push'
import { useMedia } from '../store'
import { useSocial } from './social/SocialProvider'

/** Écrans qu'une notification push peut ouvrir (« /?open=… », voir public/push-sw.js). */
const OPEN_RE = /^(notifications|item:[A-Za-z0-9_-]{1,64}|u:[a-z0-9_]{3,20})$/

/** Lit (et retire de l'adresse) l'écran demandé par une notification au lancement de l'app. */
function takeOpenParam(): string | null {
  try {
    const params = new URLSearchParams(location.search)
    const open = params.get('open')
    if (open === null) return null
    params.delete('open')
    const q = params.toString()
    history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`)
    return OPEN_RE.test(open) ? open : null
  } catch {
    return null
  }
}

/**
 * Lien entre les notifications push et l'app : ouvre le bon écran au clic sur une notification
 * (app lancée, ou déjà ouverte : message du service worker), met à jour la cloche quand
 * une notification arrive, et garde l'abonnement de l'appareil à jour côté serveur.
 */
export default function PushBridge() {
  const { account, items, loading } = useMedia()
  const social = useSocial()
  const [target, setTarget] = useState<string | null>(takeOpenParam)
  const socialRef = useRef(social)
  socialRef.current = social

  // Messages du service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; open?: unknown } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'azuu:open' && typeof data.open === 'string' && OPEN_RE.test(data.open)) setTarget(data.open)
      else if (data.type === 'azuu:push') void socialRef.current.refresh()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  // Ouvre l'écran demandé une fois le compte et la bibliothèque chargés
  useEffect(() => {
    if (!target) return
    if (!account) {
      // Pas (ou plus) connecté : rien à ouvrir
      if (!loading) setTarget(null)
      return
    }
    if (!social.enabled || loading) return
    setTarget(null)
    if (target === 'notifications') social.openNotifications()
    else if (target.startsWith('u:')) social.openProfile(target.slice(2))
    else {
      const item = items.find((i) => i.id === target.slice(5))
      if (item) social.openItem(item)
      else social.openNotifications()
    }
  }, [target, account, social, loading, items])

  // Abonnement push renouvelé par le navigateur, langue changée… : on le signale au serveur
  const accountOn = !!account
  useEffect(() => {
    if (accountOn) void keepPushFresh()
  }, [accountOn])

  return null
}
