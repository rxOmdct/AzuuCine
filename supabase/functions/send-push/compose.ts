// Transforme les notifications d'un compte en messages push courts (regroupés si besoin).
// Module sans API Deno : testé aussi avec Node.

import { fill, MESSAGES } from './messages.ts'

export interface ClaimedItem {
  id: number
  kind: string
  emoji: string | null
  item_id: string | null
  episode: number | null
  ep_count: number | null
  actor: { username: string; display_name: string } | null
  title: string | null
}

export interface PushMessage {
  title: string
  body: string
  /** Écran à ouvrir au clic (paramètre « open » de l'app) */
  open: string
  /** Une notification du même « tag » remplace la précédente sur l'appareil */
  tag: string
}

const EMOJIS = new Set(['👍', '❤️', '🔥', '😂', '😮', '😢'])

/** Texte venu de la base : sans caractères de contrôle ni de direction, longueur bornée. */
export function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const SAFE_USER = /^[a-z0-9_]{3,20}$/

export function compose(items: ClaimedItem[], lang: string): PushMessage[] {
  const tx = MESSAGES[lang] ?? MESSAGES.fr
  const out: PushMessage[] = []
  const eps = items.filter((i) => i.kind === 'new_episode' || i.kind === 'new_season')
  const social = items.filter((i) => i.kind !== 'new_episode' && i.kind !== 'new_season')

  // Épisodes : un message par série, ou un seul résumé s'il y en a plusieurs
  if (eps.length === 1) {
    const e = eps[0]
    const n = Number.isInteger(e.episode) && (e.episode as number) > 0 ? (e.episode as number) : null
    out.push({
      title: clean(e.title, 80) || 'AzuuCine',
      body: e.kind === 'new_season' || n === null ? tx.season : fill(tx.episode, { n }),
      open: e.item_id && SAFE_ID.test(e.item_id) ? `item:${e.item_id}` : 'notifications',
      tag: e.item_id && SAFE_ID.test(e.item_id) ? `ep-${e.item_id}`.slice(0, 64) : 'episodes',
    })
  } else if (eps.length > 1) {
    const titles = [...new Set(eps.map((e) => clean(e.title, 40)).filter(Boolean))]
    out.push({
      title: `${tx.episodesTitle} (${eps.length})`,
      body: clean(titles.join(' · '), 160) || fill(tx.many, { count: eps.length }),
      open: 'notifications',
      tag: 'episodes',
    })
  }

  // Abonnements / réactions : un message chacun (3 au plus), sinon un résumé
  if (social.length > 3) {
    out.push({ title: 'AzuuCine', body: fill(tx.many, { count: social.length }), open: 'notifications', tag: 'social' })
  } else {
    for (const s of social) {
      const name = clean(s.actor?.display_name, 40) || clean(s.actor?.username, 20) || 'AzuuCine'
      const user = s.actor && SAFE_USER.test(s.actor.username) ? s.actor.username : null
      let body: string
      let open = 'notifications'
      let title = 'AzuuCine'
      switch (s.kind) {
        case 'follow_request':
          body = fill(tx.followRequest, { name })
          break
        case 'new_follower':
          body = fill(tx.newFollower, { name })
          if (user) open = `u:${user}`
          break
        case 'follow_accepted':
          body = fill(tx.followAccepted, { name })
          if (user) open = `u:${user}`
          break
        case 'reaction':
          body = fill(tx.reaction, { name, emoji: s.emoji && EMOJIS.has(s.emoji) ? s.emoji : '' }).replace(/\s+/g, ' ')
          title = clean(s.title, 80) || 'AzuuCine'
          break
        case 'review_comment':
          body = fill(tx.comment, { name })
          title = clean(s.title, 80) || 'AzuuCine'
          break
        case 'shared_list_invite':
          body = fill(tx.listInvite, { name, list: clean(s.title, 60) })
          break
        default:
          continue
      }
      out.push({ title, body, open, tag: `n-${s.id}` })
    }
  }
  return out
}
