import { t } from '../../i18n'
import { AuthError, getAccessToken } from './auth'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/** Appel authentifié à Supabase (base de données ou fonctions serveur). Réessaie une fois si le jeton a expiré. */
export async function cloudFetch(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(attempt > 0)
    if (!token) throw new AuthError(t('auth.err.session'))
    const res = await fetch(SUPABASE_URL + path, {
      ...init,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (res.status !== 401) return res
  }
  throw new AuthError(t('auth.err.session'))
}

/** Proxy TMDB : la clé TMDB reste sur le serveur. */
export async function tmdbViaCloud<T>(path: string, params: Record<string, string>): Promise<T> {
  const q = new URLSearchParams({ path, ...params })
  const res = await cloudFetch(`/functions/v1/tmdb?${q}`)
  if (res.status === 429) throw new Error(t('err.searchRate'))
  if (!res.ok) throw new Error(t('err.tmdbStatus', { status: res.status }))
  return res.json() as Promise<T>
}

export type ProxyState = 'ok' | 'missing-key' | 'not-deployed' | 'offline' | 'error'

/** Vérifie que le proxy TMDB est déployé et que la clé TMDB est bien enregistrée côté serveur. */
export async function checkTmdbProxy(): Promise<ProxyState> {
  if (!navigator.onLine) return 'offline'
  try {
    const res = await cloudFetch(`/functions/v1/tmdb?${new URLSearchParams({ path: '/configuration' })}`)
    if (res.ok) return 'ok'
    if (res.status === 404) return 'not-deployed'
    const body = (await res.json().catch(() => ({}))) as { error?: string; status?: number }
    if (res.status === 500 && body.error?.includes('TMDB_API_KEY')) return 'missing-key'
    if (res.status === 502 && body.status === 401) return 'missing-key'
    return 'error'
  } catch {
    return navigator.onLine ? 'not-deployed' : 'offline'
  }
}
