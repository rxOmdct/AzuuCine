import { t, type TKey } from '../../i18n'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * Connexion aux comptes (Supabase Auth), sans dépendance.
 * La session (jetons) est gardée sur l'appareil pour que l'app s'ouvre même hors-ligne ;
 * le mot de passe, lui, n'est jamais stocké.
 */

export interface Session {
  accessToken: string
  refreshToken: string
  /** Expiration du jeton d'accès (ms) */
  expiresAt: number
  user: { id: string; email: string }
}

export class AuthError extends Error {}

const KEY = 'azuucine:session'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9._~+/=-]{10,8192}$/
export const PASSWORD_MIN = 8

function isSession(v: unknown): v is Session {
  if (!v || typeof v !== 'object') return false
  const s = v as Session
  return (
    typeof s.accessToken === 'string' &&
    TOKEN.test(s.accessToken) &&
    typeof s.refreshToken === 'string' &&
    /^[A-Za-z0-9._~+/=-]{4,1024}$/.test(s.refreshToken) &&
    typeof s.expiresAt === 'number' &&
    Number.isFinite(s.expiresAt) &&
    !!s.user &&
    typeof s.user.id === 'string' &&
    UUID.test(s.user.id) &&
    typeof s.user.email === 'string' &&
    s.user.email.length <= 320
  )
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

let current: Session | null = load()
const listeners = new Set<(s: Session | null) => void>()

function setSession(s: Session | null) {
  const changedUser = current?.user.id !== s?.user.id
  current = s
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  if (changedUser) for (const fn of listeners) fn(s)
}

// Connexion / déconnexion dans un autre onglet
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    const next = load()
    const changedUser = current?.user.id !== next?.user.id
    current = next
    if (changedUser) for (const fn of listeners) fn(next)
  })
}

export const getSession = () => current

export function onSessionChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ───────────────────────────── Appels à Supabase Auth ─────────────────────────────

const CODE_KEYS: Record<string, TKey> = {
  invalid_credentials: 'auth.err.credentials',
  invalid_grant: 'auth.err.credentials',
  email_not_confirmed: 'auth.err.notConfirmed',
  user_already_exists: 'auth.err.exists',
  email_exists: 'auth.err.exists',
  weak_password: 'auth.err.weak',
  same_password: 'auth.err.samePassword',
  over_email_send_rate_limit: 'auth.err.emailRate',
  over_request_rate_limit: 'auth.err.rate',
  signup_disabled: 'auth.err.signupDisabled',
  email_address_invalid: 'auth.err.emailInvalid',
  validation_failed: 'auth.err.invalid',
  session_not_found: 'auth.err.session',
  refresh_token_not_found: 'auth.err.session',
  refresh_token_already_used: 'auth.err.session',
}
const msg = (code: string) => (CODE_KEYS[code] ? t(CODE_KEYS[code], { n: PASSWORD_MIN }) : undefined)

async function gotrue(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: init.method ?? 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    throw new Error(t('common.offline'))
  }
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* réponse vide */
  }
  if (!res.ok) {
    const code = String(data.error_code ?? data.code ?? data.error ?? '')
    const err = new AuthError(msg(code) ?? (res.status === 429 ? t('auth.err.rate') : t('auth.err.status', { status: res.status })))
    ;(err as AuthError & { status: number; code: string }).status = res.status
    ;(err as AuthError & { status: number; code: string }).code = code
    throw err
  }
  return data
}

function toSession(data: Record<string, unknown>): Session | null {
  const user = data.user as { id?: unknown; email?: unknown } | undefined
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const s = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at * 1000 : Date.now() + expiresIn * 1000,
    user: { id: user?.id, email: typeof user?.email === 'string' ? user.email : '' },
  }
  return isSession(s) ? s : null
}

const cleanEmail = (email: string) => email.trim().toLowerCase().slice(0, 320)
const appUrl = () => `${location.origin}${location.pathname}`

export async function signIn(email: string, password: string): Promise<void> {
  const data = await gotrue('/token?grant_type=password', { body: { email: cleanEmail(email), password } })
  const s = toSession(data)
  if (!s) throw new AuthError(t('auth.err.response'))
  setSession(s)
}

/** Crée un compte. Renvoie true si un email de confirmation a été envoyé (pas encore connecté). */
export async function signUp(email: string, password: string): Promise<boolean> {
  if (password.length < PASSWORD_MIN) throw new AuthError(t('auth.err.weak', { n: PASSWORD_MIN }))
  const data = await gotrue(`/signup?redirect_to=${encodeURIComponent(appUrl())}`, { body: { email: cleanEmail(email), password } })
  const s = toSession(data)
  if (s) {
    setSession(s)
    return false
  }
  return true
}

export async function requestPasswordReset(email: string): Promise<void> {
  await gotrue(`/recover?redirect_to=${encodeURIComponent(appUrl())}`, { body: { email: cleanEmail(email) } })
}

export async function updatePassword(password: string): Promise<void> {
  if (password.length < PASSWORD_MIN) throw new AuthError(t('auth.err.weak', { n: PASSWORD_MIN }))
  const token = await getAccessToken()
  if (!token) throw new AuthError(t('auth.err.session'))
  await gotrue('/user', { method: 'PUT', body: { password }, token })
}

/** Déconnexion : invalide la session côté serveur (si possible) et l'efface de l'appareil. */
export async function signOut(): Promise<void> {
  const s = current
  setSession(null)
  if (s && navigator.onLine) {
    try {
      await gotrue('/logout?scope=local', { token: s.accessToken })
    } catch {
      /* jeton déjà expiré : rien à faire */
    }
  }
}

// ───────────────────────────── Connexion avec Google (OAuth + PKCE) ─────────────────────────────
// Google renvoie vers l'app avec un code à usage unique (?code=…) que seul cet appareil peut échanger,
// grâce au « vérificateur » gardé ici le temps de l'aller-retour. Aucun jeton ne passe dans l'adresse.

const VERIFIER_KEY = 'azuucine:pkce'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function signInWithGoogle(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  try {
    localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, at: Date.now() }))
  } catch {
    throw new AuthError(t('auth.err.storage'))
  }
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: appUrl(),
    code_challenge: challenge,
    code_challenge_method: 's256',
  })
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?${params}`)
}

/** Retour de Google : adresse avec ?code=… (ou ?error=…). */
export const hasOAuthRedirect = () => /[?&](code|error)=/.test(location.search)

async function consumeOAuthRedirect(): Promise<{ error?: string }> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code') ?? ''
  const oauthError = params.get('error_description') ?? params.get('error')
  history.replaceState(null, '', `${location.pathname}#/`)
  let saved: { verifier?: string; at?: number } = {}
  try {
    saved = JSON.parse(localStorage.getItem(VERIFIER_KEY) ?? '{}')
    localStorage.removeItem(VERIFIER_KEY)
  } catch {
    /* ignore */
  }
  if (oauthError) return { error: t('auth.err.google') }
  // Vérificateur absent ou trop vieux (> 10 min) : on ne tente rien
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(saved.verifier ?? '') || !saved.at || Date.now() - saved.at > 600_000) {
    return { error: t('auth.err.google') }
  }
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(code)) return { error: t('auth.err.google') }
  try {
    const data = await gotrue('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: saved.verifier } })
    const s = toSession(data)
    if (!s) return { error: t('auth.err.response') }
    setSession(s)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

let refreshing: Promise<Session | null> | null = null

async function refresh(): Promise<Session | null> {
  const s = current
  if (!s) return null
  refreshing ??= (async () => {
    try {
      const data = await gotrue('/token?grant_type=refresh_token', { body: { refresh_token: s.refreshToken } })
      const next = toSession(data)
      if (next && next.user.id === s.user.id) setSession(next)
      return next
    } catch (e) {
      // Jeton de renouvellement refusé (révoqué, compte supprimé…) : on déconnecte
      const status = (e as { status?: number }).status
      if (status === 400 || status === 401 || status === 403) setSession(null)
      return null
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Jeton d'accès valide (renouvelé si besoin). null si déconnecté ou hors-ligne avec un jeton expiré. */
export async function getAccessToken(force = false): Promise<string | null> {
  const s = current
  if (!s) return null
  if (!force && s.expiresAt - 60_000 > Date.now()) return s.accessToken
  const next = await refresh()
  return next?.accessToken ?? null
}

/**
 * Liens reçus par email (confirmation d'inscription, mot de passe oublié) :
 * Supabase renvoie vers l'app avec les jetons après le « # ». On ouvre la session puis on nettoie l'adresse.
 */
export async function consumeAuthRedirect(): Promise<{ type?: string; error?: string }> {
  if (hasOAuthRedirect()) return consumeOAuthRedirect()
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  if (!/(^|&)(access_token|error)=/.test(hash)) return {}
  const params = new URLSearchParams(hash)
  history.replaceState(null, '', `${location.pathname}${location.search}#/`)
  const error = params.get('error_description') ?? params.get('error')
  if (error) {
    const code = params.get('error_code') ?? ''
    return { error: code === 'otp_expired' ? t('auth.err.linkExpired') : t('auth.err.linkUsed') }
  }
  const accessToken = params.get('access_token') ?? ''
  try {
    const user = await gotrue('/user', { method: 'GET', token: accessToken })
    const s = toSession({
      access_token: accessToken,
      refresh_token: params.get('refresh_token'),
      expires_at: Number(params.get('expires_at')) || undefined,
      expires_in: Number(params.get('expires_in')) || 3600,
      user,
    })
    if (!s) return { error: t('auth.err.linkInvalid') }
    setSession(s)
    return { type: params.get('type') ?? undefined }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
