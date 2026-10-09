import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './cloud/config'

/**
 * Remontée des erreurs de l'app (équivalent Sentry minimal, sans service tiers).
 *  - capte window.onerror, les promesses rejetées non gérées et les plantages d'affichage React ;
 *  - aucune donnée personnelle : e-mails, jetons, identifiants et paramètres d'URL sont retirés
 *    (ici ET côté serveur), aucun identifiant de compte n'est envoyé ;
 *  - dédoublonnage par empreinte (message + 1re ligne de pile) et 10 envois max par session ;
 *  - le serveur (log_client_error) regroupe, compte et limite le débit par empreinte.
 */

export type ErrorSource = 'error' | 'rejection' | 'render'

const MAX_PER_SESSION = 10
const sent = new Set<string>()
let budget = MAX_PER_SESSION
let installed = false

/** Envoi activé : en production (ou en dev avec VITE_REPORT_ERRORS=1), et seulement avec Supabase. */
const enabled = () => cloudEnabled && (import.meta.env.PROD || import.meta.env.VITE_REPORT_ERRORS === '1')

/** Retire ce qui pourrait identifier quelqu'un. */
export function scrub(text: string, max: number): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?/g, '[token]')
      .replace(/(sb_(publishable|secret)_|sk_|pk_)[A-Za-z0-9_-]+/g, '[key]')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
      // Adresses : ni paramètres ni ancre (#/u/pseudo, ?code=…)
      .replace(/(https?:\/\/[^\s?#'"()]+)[?#][^\s'"()]*/g, '$1')
      .replace(/[A-Za-z0-9_-]{40,}/g, '[token]')
      .slice(0, max)
  )
}

/** Petite empreinte locale (dédoublonnage dans la session ; le serveur recalcule la sienne). */
function fingerprint(source: ErrorSource, message: string, stack: string): string {
  const frame = stack.split('\n').find((l) => /^\s*at |@/.test(l)) ?? ''
  const key = `${source}|${message.toLowerCase().replace(/\d+/g, '0')}|${frame.replace(/:\d+(:\d+)?/g, '')}`
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Erreurs sans intérêt (réseau coupé, extensions du navigateur, bruit connu des navigateurs). */
function isNoise(message: string, stack: string): boolean {
  if (!message || message === 'Script error.' || message === 'Script error') return true
  if (/ResizeObserver loop|AbortError|The operation was aborted|NetworkError when attempting|Failed to fetch$|Load failed$|cancelled|annulé/i.test(message)) return true
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)) return true
  return false
}

function toParts(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack ?? '' }
  if (typeof err === 'string') return { message: err, stack: '' }
  try {
    return { message: `Non-Error: ${JSON.stringify(err)?.slice(0, 200) ?? String(err)}`, stack: '' }
  } catch {
    return { message: 'Non-Error value', stack: '' }
  }
}

/** Remonte une erreur (sans jamais lever d'erreur elle-même). */
export function reportError(err: unknown, source: ErrorSource = 'error', extraStack = ''): void {
  try {
    if (!enabled() || budget <= 0) return
    const parts = toParts(err)
    const message = scrub(parts.message, 500).trim()
    const stack = scrub([parts.stack, extraStack].filter(Boolean).join('\n--- component stack ---\n'), 4000)
    if (isNoise(message, stack)) return
    if (!navigator.onLine) return
    const fp = fingerprint(source, message, stack)
    if (sent.has(fp)) return
    sent.add(fp)
    budget--
    const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
    // Ancienne clé « anon » (JWT) : elle sert aussi de jeton. Les clés « sb_publishable_ » se passent de ce champ.
    if (SUPABASE_ANON_KEY.split('.').length === 3) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/log_client_error`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_message: message,
        p_stack: stack || null,
        p_url: `${location.origin}${location.pathname}`,
        p_version: __APP_VERSION__,
        p_ua: navigator.userAgent.slice(0, 300),
        p_source: source,
      }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* la remontée d'erreurs ne doit jamais casser l'app */
  }
}

/** À appeler une fois au démarrage. */
export function installErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    // Erreurs de chargement de ressources (image cassée…) : ignorées
    if (!(e instanceof ErrorEvent)) return
    reportError(e.error ?? e.message, 'error')
  })
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'rejection'))
}
