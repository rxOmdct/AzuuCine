import { getLang } from '../i18n'
import { cloudFetch } from './cloud/api'
import { cloudEnabled } from './cloud/config'
import { detectPlatform } from './pwa'
import { scopedKey } from './scope'
import { isPlainObject, storageGet, storageSet } from './security'

/**
 * Notifications push (Web Push) sur cet appareil :
 *  - la permission n'est demandée qu'au clic sur l'interrupteur (jamais au chargement) ;
 *  - l'abonnement du navigateur est enregistré sur le serveur (register_push_subscription) ;
 *  - le serveur envoie ensuite les notifications de la cloche, même app fermée.
 */

export type PushSupport = 'ok' | 'unsupported' | 'needs-install'
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

export class PushError extends Error {
  constructor(public code: 'denied' | 'not-ready' | 'failed') {
    super(code)
  }
}

/** Dernier enregistrement réussi (par compte) */
const storeKey = () => scopedKey('push')
const REFRESH_MS = 7 * 24 * 3600 * 1000

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

/** Ce navigateur sait-il recevoir des notifications push ? (iPhone : seulement l'app installée, iOS 16.4+) */
export function pushSupport(): PushSupport {
  if (!cloudEnabled || typeof window === 'undefined') return 'unsupported'
  const api = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (detectPlatform() === 'ios' && (!isStandalone() || !api)) return 'needs-install'
  return api ? 'ok' : 'unsupported'
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PushError('failed')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Service worker actif (absent en mode développement : on n'attend pas indéfiniment). */
const registration = () => withTimeout(navigator.serviceWorker.ready, 8000)

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function getPushState(): Promise<PushState> {
  const support = pushSupport()
  if (support !== 'ok') return support
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  try {
    return (await currentSubscription()) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Clé publique VAPID du serveur (la clé privée ne quitte jamais Supabase). */
async function serverKey(): Promise<string> {
  let res: Response
  try {
    res = await cloudFetch('/functions/v1/send-push')
  } catch {
    throw new PushError('failed')
  }
  if (res.status === 404 || res.status === 503) throw new PushError('not-ready')
  if (!res.ok) throw new PushError('failed')
  const body = (await res.json().catch(() => null)) as unknown
  const key = isPlainObject(body) && typeof body.publicKey === 'string' ? body.publicKey : ''
  if (!/^B[A-Za-z0-9_-]{86}$/.test(key)) throw new PushError('not-ready')
  return key
}

/** Petit libellé de l'appareil (« Chrome · Android ») pour s'y retrouver côté serveur. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Web'
  const p = detectPlatform()
  const os = p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux|CrOS/.test(ua) ? 'Linux' : ''
  return os ? `${browser} · ${os}` : browser
}

async function register(sub: PushSubscription): Promise<void> {
  const lang = getLang()
  const res = await cloudFetch('/rest/v1/rpc/register_push_subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_endpoint: sub.endpoint,
      p_p256dh: bytesToB64url(sub.getKey('p256dh')),
      p_auth: bytesToB64url(sub.getKey('auth')),
      p_lang: lang,
      p_ua: deviceLabel(),
    }),
  })
  if (res.status === 404) throw new PushError('not-ready')
  if (!res.ok) throw new PushError('failed')
  storageSet(storeKey(), JSON.stringify({ endpoint: sub.endpoint, lang, at: Date.now() }))
}

/** Active les notifications push sur cet appareil. À appeler uniquement depuis un clic. */
export async function enablePush(): Promise<PushState> {
  const support = pushSupport()
  if (support !== 'ok') return support
  const permission = await Notification.requestPermission()
  if (permission === 'denied') throw new PushError('denied')
  if (permission !== 'granted') return 'off'

  const key = await serverKey()
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  // Abonnement créé avec une autre clé serveur (clés VAPID changées) : on le refait
  if (sub && sub.options.applicationServerKey && bytesToB64url(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) })
    } catch {
      throw new PushError(Notification.permission === 'denied' ? 'denied' : 'failed')
    }
  }
  try {
    await register(sub)
  } catch (e) {
    await sub.unsubscribe().catch(() => false)
    throw e instanceof PushError ? e : new PushError('failed')
  }
  return 'on'
}

/** Coupe les notifications push sur cet appareil (et retire l'appareil du serveur). */
export async function disablePush(): Promise<void> {
  if (pushSupport() !== 'ok') return
  const sub = await currentSubscription().catch(() => null)
  storageSet(storeKey(), null)
  if (!sub) return
  try {
    await cloudFetch('/rest/v1/rpc/unregister_push_subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_endpoint: sub.endpoint }),
    })
  } catch {
    /* hors-ligne : le serveur oubliera l'abonnement au premier envoi refusé (410) */
  }
  await sub.unsubscribe().catch(() => false)
}

/** Désabonne seulement le navigateur (compte supprimé : le serveur a déjà tout effacé). */
export async function forgetPushLocally(): Promise<void> {
  storageSet(storeKey(), null)
  if (pushSupport() !== 'ok') return
  const sub = await currentSubscription().catch(() => null)
  await sub?.unsubscribe().catch(() => false)
}

/**
 * Au lancement : réenregistre l'abonnement si le navigateur l'a renouvelé, si la langue a changé,
 * ou une fois par semaine (le serveur garde ainsi les appareils réellement utilisés).
 */
export async function keepPushFresh(): Promise<void> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted' || !navigator.onLine) return
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  let saved: unknown = null
  try {
    saved = JSON.parse(storageGet(storeKey()) ?? 'null')
  } catch {
    /* ignore */
  }
  // Pas d'enregistrement connu : l'abonnement n'a pas été créé par ce compte, on n'y touche pas
  if (!isPlainObject(saved)) return
  const fresh = saved.endpoint === sub.endpoint && saved.lang === getLang() && typeof saved.at === 'number' && Date.now() - saved.at < REFRESH_MS
  if (!fresh) await register(sub).catch(() => {})
}
