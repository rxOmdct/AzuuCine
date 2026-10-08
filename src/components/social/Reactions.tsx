import { useState } from 'react'
import { REACTION_EMOJIS, reactToReview, unreactReview, type ReactionEmoji } from '../../lib/cloud/reviews'
import { cx } from '../../lib/utils'

/** Barre de réactions (emoji) sur un avis. Une seule réaction par personne ; retoucher la sienne l'enlève. */
export default function Reactions({
  authorId,
  itemId,
  reactions: initial,
  mine: initialMine,
}: {
  authorId: string
  itemId: string
  reactions: Record<string, number>
  mine: string | null
}) {
  const [reactions, setReactions] = useState<Record<string, number>>(initial)
  const [mine, setMine] = useState<string | null>(initialMine)
  const [busy, setBusy] = useState(false)

  const toggle = async (emoji: ReactionEmoji) => {
    if (busy) return
    const prev = { reactions, mine }
    const next: Record<string, number> = { ...reactions }
    if (mine === emoji) {
      next[emoji] = Math.max(0, (next[emoji] ?? 0) - 1)
      setReactions(next)
      setMine(null)
    } else {
      if (mine) next[mine] = Math.max(0, (next[mine] ?? 0) - 1)
      next[emoji] = (next[emoji] ?? 0) + 1
      setReactions(next)
      setMine(emoji)
    }
    setBusy(true)
    try {
      if (prev.mine === emoji) await unreactReview(authorId, itemId)
      else await reactToReview(authorId, itemId, emoji)
    } catch {
      setReactions(prev.reactions)
      setMine(prev.mine)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {REACTION_EMOJIS.map((emoji) => {
        const count = reactions[emoji] ?? 0
        const on = mine === emoji
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => void toggle(emoji)}
            disabled={busy}
            aria-pressed={on}
            className={cx(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-colors active:scale-95 disabled:opacity-60',
              on ? 'border-accent bg-accent-fill/10 text-ink' : 'border-line text-ink-2',
            )}
          >
            <span>{emoji}</span>
            {count > 0 && <span className="text-xs font-medium">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
