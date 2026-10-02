/**
 * Configuration des comptes (Supabase), lue dans le fichier .env au moment de la compilation.
 * Sans .env, l'app fonctionne comme avant : 100 % locale, sans compte.
 */
// On accepte aussi une adresse copiée avec « /rest/v1/ » (ou autre chemin) à la fin
const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/^(https?:\/\/[^/]+).*$/, '$1')
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(rawUrl) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(rawUrl)
const validKey = /^(sb_publishable_[A-Za-z0-9_-]{10,200}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(rawKey)

export const SUPABASE_URL = validUrl ? rawUrl : ''
export const SUPABASE_ANON_KEY = validKey ? rawKey : ''
/** Les comptes sont activés quand le .env contient une configuration valide. */
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

if (!cloudEnabled && (rawUrl || rawKey)) {
  console.warn('[AzuuCine] .env incomplet ou invalide : les comptes sont désactivés (mode local). Vérifie VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.')
}
