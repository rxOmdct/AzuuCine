// Outils partagés par les fonctions serveur d'AzuuCine (Deno / Supabase Edge Functions).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** Origines autorisées à appeler les fonctions (ton site), séparées par des virgules. */
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const ok = ALLOWED.length === 0 ? /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) : ALLOWED.includes(origin)
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extra },
  })
}

// Petit cache jeton → utilisateur (évite de revérifier le même jeton à chaque requête)
const verified = new Map<string, { id: string; until: number }>()

/** Vérifie le jeton de connexion auprès de Supabase Auth. Renvoie l'id de l'utilisateur, ou null. */
export async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token || token.length > 4096 || token === ANON_KEY) return null
  const cached = verified.get(token)
  if (cached && cached.until > Date.now()) return cached.id
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const user = (await res.json()) as { id?: string }
  if (typeof user.id !== 'string') return null
  if (verified.size > 5000) verified.clear()
  verified.set(token, { id: user.id, until: Date.now() + 60_000 })
  return user.id
}

// Limite de requêtes par compte (fenêtre glissante, par instance)
const hits = new Map<string, number[]>()
export function rateLimited(userId: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const list = (hits.get(userId) ?? []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(userId, list)
  if (hits.size > 10000) hits.clear()
  return list.length > max
}
