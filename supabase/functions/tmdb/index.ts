// Proxy TMDB : l'app appelle cette fonction, qui ajoute TA clé TMDB côté serveur.
// La clé est un « secret » Supabase (supabase secrets set TMDB_API_KEY=...) : elle n'est
// jamais dans le code, jamais envoyée au navigateur, et seuls les comptes connectés peuvent s'en servir.

import { corsHeaders, getUserId, json, rateLimited } from '../_shared/auth.ts'

const TMDB_KEY = Deno.env.get('TMDB_API_KEY') ?? ''

// Mêmes adresses que dans l'app — tout le reste est refusé
const PATHS = /^\/(search\/multi|configuration|discover\/(movie|tv)|(movie|tv)\/\d{1,10}(\/recommendations|\/season\/\d{1,3})?)$/

// Paramètres autorisés et forme de leur valeur
const PARAMS: Record<string, RegExp> = {
  language: /^(fr-FR|en-US|es-ES|it-IT|de-DE|pt-BR|zh-CN|ja-JP|ko-KR)$/,
  query: /^[^\u0000-\u001f]{1,100}$/,
  include_adult: /^false$/,
  page: /^[1-9]\d?$/,
  // Une ou plusieurs sous-réponses connues, séparées par des virgules (ex. « credits,watch/providers » pour la fiche)
  append_to_response: /^(watch\/providers|credits|release_dates)(,(watch\/providers|credits|release_dates)){0,2}$/,
  region: /^[A-Z]{2}$/,
  'release_date.gte': /^\d{4}-\d{2}-\d{2}$/,
  'release_date.lte': /^\d{4}-\d{2}-\d{2}$/,
  'air_date.gte': /^\d{4}-\d{2}-\d{2}$/,
  'air_date.lte': /^\d{4}-\d{2}-\d{2}$/,
  with_release_type: /^[1-6](\|[1-6]){0,5}$/,
  sort_by: /^popularity\.desc$/,
  with_origin_country: /^[A-Z]{2}(\|[A-Z]{2}){0,20}$/,
  without_genres: /^\d{1,6}(\|\d{1,6}){0,10}$/,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'GET') return json(req, 405, { error: 'method' })
  if (!TMDB_KEY) return json(req, 500, { error: 'TMDB_API_KEY manquante' })

  const userId = await getUserId(req)
  if (!userId) return json(req, 401, { error: 'auth' })
  if (rateLimited(userId, 600, 10 * 60_000)) return json(req, 429, { error: 'rate' })

  const url = new URL(req.url)
  const path = url.searchParams.get('path') ?? ''
  if (!PATHS.test(path)) return json(req, 400, { error: 'path' })

  const target = new URL('https://api.themoviedb.org/3' + path)
  for (const [k, v] of url.searchParams) {
    if (k === 'path') continue
    const rule = PARAMS[k]
    if (!rule || !rule.test(v)) return json(req, 400, { error: 'param', name: k.slice(0, 40) })
    target.searchParams.set(k, v)
  }
  // Clé v3 (32 caractères) en paramètre, jeton v4 en en-tête
  const isBearer = TMDB_KEY.length > 40
  if (!isBearer) target.searchParams.set('api_key', TMDB_KEY)

  const res = await fetch(target, { headers: isBearer ? { Authorization: `Bearer ${TMDB_KEY}` } : {} })
  if (!res.ok) return json(req, res.status === 404 ? 404 : 502, { error: 'tmdb', status: res.status })
  const body = await res.text()
  if (body.length > 2_000_000) return json(req, 502, { error: 'size' })
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      // Le navigateur garde la réponse 1 h (moins de requêtes vers TMDB)
      'Cache-Control': 'private, max-age=3600',
    },
  })
})
