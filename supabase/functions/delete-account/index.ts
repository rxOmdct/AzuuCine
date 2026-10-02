// Suppression définitive du compte connecté (et de toutes ses données, par cascade).
// Utilise la clé « service role », disponible uniquement côté serveur.

import { corsHeaders, getUserId, json, rateLimited } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })

  const userId = await getUserId(req)
  if (!userId) return json(req, 401, { error: 'auth' })
  if (rateLimited('delete:' + userId, 3, 60_000)) return json(req, 429, { error: 'rate' })

  let body: { confirm?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* corps vide */
  }
  if (body.confirm !== 'SUPPRIMER') return json(req, 400, { error: 'confirm' })

  // Photos de profil et bannières (le stockage n'est pas effacé automatiquement avec le compte)
  try {
    const admin = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
    const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/profile-media`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ prefix: userId, limit: 1000 }),
    })
    const files = list.ok ? ((await list.json()) as { name?: string }[]) : []
    const prefixes = files.filter((f) => typeof f.name === 'string').map((f) => `${userId}/${f.name}`)
    if (prefixes.length) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/profile-media`, { method: 'DELETE', headers: admin, body: JSON.stringify({ prefixes }) })
    }
  } catch {
    /* on supprime le compte quand même */
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) return json(req, 500, { error: 'delete' })
  return json(req, 200, { ok: true })
})
