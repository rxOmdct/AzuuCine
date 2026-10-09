// Web Push sans dépendance : chiffrement « aes128gcm » (RFC 8188 + RFC 8291) et
// authentification VAPID (RFC 8292, jeton JWT ES256), uniquement avec WebCrypto.
// Aucune API propre à Deno ici : le module est aussi testé avec Node (vecteurs de la RFC 8291).

const enc = new TextEncoder()
/** Octets adossés à un ArrayBuffer (exigé par les types WebCrypto / fetch récents) */
export type Bytes = Uint8Array<ArrayBuffer>

export function b64urlEncode(bytes: Bytes): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(str: string): Bytes {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(str)) throw new Error('base64url invalide')
  const b64 = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** Clé publique P-256 brute (65 octets, 0x04 || X || Y) → JWK. */
function rawToJwk(raw: Bytes, d?: Bytes): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('clé publique P-256 invalide')
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(raw.slice(1, 33)),
    y: b64urlEncode(raw.slice(33, 65)),
    ...(d ? { d: b64urlEncode(d) } : {}),
    ext: true,
  }
}

export interface EncryptOptions {
  /** Pour les tests uniquement : paire éphémère et sel imposés (vecteurs RFC 8291). */
  asPrivate?: Bytes
  asPublic?: Bytes
  salt?: Bytes
  /** Taille d'enregistrement annoncée (4096 par défaut) */
  rs?: number
}

/**
 * Chiffre un message pour un abonnement push (Content-Encoding: aes128gcm).
 * @param uaPublic clé « p256dh » de l'abonnement (65 octets)
 * @param authSecret clé « auth » de l'abonnement (16 octets)
 */
export async function encryptPayload(
  plaintext: Bytes,
  uaPublic: Bytes,
  authSecret: Bytes,
  opts: EncryptOptions = {},
): Promise<Bytes> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh invalide')
  if (authSecret.length < 16) throw new Error('auth invalide')
  const rs = opts.rs ?? 4096
  // Un seul enregistrement : le message (+ 1 octet de délimitation + 16 octets de tag) doit tenir dedans
  if (plaintext.length + 1 + 16 > rs) throw new Error('message trop long')

  // Paire de clés éphémère du serveur d'application
  let asPriv: CryptoKey
  let asPublic: Bytes
  if (opts.asPrivate && opts.asPublic) {
    asPriv = await crypto.subtle.importKey('jwk', rawToJwk(opts.asPublic, opts.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    asPublic = opts.asPublic
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPriv = pair.privateKey
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256))

  // RFC 8291 §3.3-3.4 (HKDF écrit avec HMAC, une seule itération suffit pour ≤ 32 octets)
  const prkKey = await hmac(authSecret, ecdhSecret)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  if (salt.length !== 16) throw new Error('sel invalide')
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12)

  // Dernier (et seul) enregistrement : délimiteur 0x02, sans remplissage
  const record = concat(plaintext, new Uint8Array([2]))
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, record))

  // En-tête RFC 8188 : sel (16) || rs (4, gros-boutiste) || idlen (1) || keyid (clé publique éphémère)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs, false)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

export interface VapidKeys {
  /** Clé publique brute en base64url (65 octets) */
  publicKey: string
  /** Clé privée (scalaire « d », 32 octets) en base64url */
  privateKey: string
  /** « mailto:… » ou « https://… » */
  subject: string
}

const signingKeys = new Map<string, Promise<CryptoKey>>()

function vapidSigningKey(v: VapidKeys): Promise<CryptoKey> {
  const cacheKey = v.publicKey
  let p = signingKeys.get(cacheKey)
  if (!p) {
    p = crypto.subtle.importKey('jwk', rawToJwk(b64urlDecode(v.publicKey), b64urlDecode(v.privateKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    signingKeys.set(cacheKey, p)
  }
  return p
}

/** En-tête Authorization VAPID pour un point d'envoi donné (jeton valable 12 h). */
export async function vapidAuthorization(endpoint: string, v: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: v.subject })))
  const unsigned = `${header}.${claims}`
  // WebCrypto renvoie la signature au format r || s (64 octets), celui attendu par JWS
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(v), enc.encode(unsigned)))
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${v.publicKey}`
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushResult = 'ok' | 'gone' | 'error'

/** Envoie un message chiffré à un abonnement. « gone » = abonnement expiré (à supprimer). */
export async function sendWebPush(target: PushTarget, payload: string, v: VapidKeys, ttl = 24 * 3600, topic?: string): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(payload), b64urlDecode(target.p256dh), b64urlDecode(target.auth))
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, v),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: 'normal',
  }
  // « Topic » : un message plus récent du même sujet remplace celui encore en attente
  if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(target.endpoint, { method: 'POST', headers, body, signal: ctrl.signal, redirect: 'error' })
    await res.body?.cancel()
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  } finally {
    clearTimeout(timer)
  }
}

/** Mêmes hôtes que la vérification côté base (anti-SSRF, double contrôle). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  const h = u.hostname.toLowerCase()
  return (
    h === 'fcm.googleapis.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h === 'web.push.apple.com' ||
    /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.push\.apple\.com$/.test(h) ||
    /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.notify\.windows\.com$/.test(h)
  )
}
