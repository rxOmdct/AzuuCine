// Notifications push (Web Push).
//  - GET  : renvoie la clé publique VAPID (pour que l'app puisse s'abonner).
//  - POST : appelé par la base à chaque nouvelle notification (déclencheur + pg_net),
//           avec l'en-tête « x-push-secret ». Prend les notifications non envoyées du compte,
//           applique ses préférences, les regroupe et les envoie à tous ses appareils.
// Secrets (supabase secrets set …) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET.
// Voir supabase/PUSH_SETUP.md.

import { corsHeaders, json } from '../_shared/auth.ts'
import { isAllowedPushEndpoint, sendWebPush, type VapidKeys } from '../_shared/webpush.ts'
import { compose, type ClaimedItem } from './compose.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const VAPID: VapidKeys = {
  publicKey: (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim(),
  privateKey: (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').trim(),
  subject: (Deno.env.get('VAPID_SUBJECT') ?? '').trim(),
}
const vapidReady = /^B[A-Za-z0-9_-]{86}$/.test(VAPID.publicKey) && /^[A-Za-z0-9_-]{43}$/.test(VAPID.privateKey) && /^(mailto:|https:\/\/)/.test(VAPID.subject)

const enc = new TextEncoder()

/** Comparaison en temps constant (le secret ne peut pas être deviné caractère par caractère). */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!given || expected.length < 32 || given.length > 512) return false
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const [a, b] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(given)), crypto.subtle.sign('HMAC', key, enc.encode(expected))])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

interface Sub {
  endpoint: string
  p256dh: string
  auth: string
  lang: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })

  // Clé publique : elle n'a rien de secret (elle est envoyée au service push du navigateur)
  if (req.method === 'GET') {
    if (!vapidReady) return json(req, 503, { error: 'not-configured' })
    return json(req, 200, { publicKey: VAPID.publicKey }, { 'Cache-Control': 'public, max-age=3600' })
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })

  // Appel réservé à la base de données
  if (!WEBHOOK_SECRET || !(await sameSecret(req.headers.get('x-push-secret') ?? '', WEBHOOK_SECRET))) {
    return json(req, 401, { error: 'auth' })
  }
  if (!vapidReady || !SERVICE_KEY || !SUPABASE_URL) return json(req, 503, { error: 'not-configured' })

  let userId = ''
  try {
    const body = (await req.json()) as { user_id?: unknown }
    if (typeof body.user_id === 'string' && UUID.test(body.user_id)) userId = body.user_id
  } catch {
    /* corps invalide */
  }
  if (!userId) return json(req, 400, { error: 'user' })

  let claim: { subs?: Sub[]; items?: ClaimedItem[] }
  try {
    claim = (await rpc<typeof claim>('push_claim', { p_user: userId })) ?? {}
  } catch {
    return json(req, 502, { error: 'claim' })
  }
  const subs = (claim.subs ?? []).filter((s) => isAllowedPushEndpoint(s.endpoint)).slice(0, 10)
  const items = (claim.items ?? []).slice(0, 100)
  if (!subs.length || !items.length) return json(req, 200, { sent: 0 })

  const gone: string[] = []
  const ok: string[] = []
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      const messages = compose(items, s.lang).slice(0, 4)
      let alive = true
      for (const m of messages) {
        if (!alive) break
        const payload = JSON.stringify({ title: m.title, body: m.body, tag: m.tag, url: `/?open=${encodeURIComponent(m.open)}` })
        const r = await sendWebPush(s, payload, VAPID, 24 * 3600, m.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32))
        if (r === 'gone') {
          gone.push(s.endpoint)
          alive = false
        } else if (r === 'ok') {
          sent++
          if (!ok.includes(s.endpoint)) ok.push(s.endpoint)
        }
      }
    }),
  )
  try {
    await rpc('push_done', { p_user: userId, p_gone: gone, p_ok: ok })
  } catch {
    /* le ménage se fera au prochain envoi */
  }
  return json(req, 200, { sent, gone: gone.length })
})
