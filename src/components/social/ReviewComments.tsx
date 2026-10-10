import { Loader2, MessageCircle, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { useBlocked } from '../../lib/cloud/moderation'
import ReportButton from '../moderation/ReportButton'
import { addReviewComment, COMMENT_MAX, CommentsUnavailable, deleteReviewComment, getReviewComments, type ReviewComment } from '../../lib/cloud/comments'
import { timeAgo } from '../../lib/timeAgo'
import { cx } from '../../lib/utils'
import Avatar from './Avatar'
import { useSocial } from './SocialProvider'

/**
 * Bouton « commentaires » (avec leur nombre) placé à côté des réactions, et fil de commentaires
 * qui s'ouvre sous l'avis. `children` = les autres actions de la ligne (réactions).
 */
export default function ReviewComments({
  authorId,
  itemId,
  count: initialCount,
  defaultOpen,
  hidden,
  children,
}: {
  authorId: string
  itemId: string
  /** Nombre connu (sinon chargé à l'ouverture) */
  count?: number | null
  defaultOpen?: boolean
  /** Serveur sans les commentaires (migration pas encore appliquée) : seules les autres actions s'affichent */
  hidden?: boolean
  children?: ReactNode
}) {
  const social = useSocial()
  const { isBlocked } = useBlocked(social.enabled)
  const [open, setOpen] = useState(!!defaultOpen)
  const [count, setCount] = useState(initialCount ?? undefined)
  const [comments, setComments] = useState<ReviewComment[]>()
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Fil chargé à l'ouverture (ou tout de suite si on ne connaît pas encore le nombre)
  const shouldLoad = !hidden && (open || initialCount === undefined)
  useEffect(() => {
    if (!shouldLoad || comments || unavailable) return
    let alive = true
    getReviewComments(authorId, itemId)
      .then((th) => {
        if (!alive) return
        setComments(th.comments)
        setCount(th.comments.length)
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof CommentsUnavailable) setUnavailable(true)
        else setLoadError(true)
      })
    return () => {
      alive = false
    }
  }, [shouldLoad, comments, unavailable, authorId, itemId])

  if (!social.enabled || hidden) return <>{children}</>

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {children}
        {!unavailable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t('comments.toggle', { count: count ?? 0 })}
            className={cx(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-colors active:scale-95',
              open ? 'border-ink/60 text-ink' : 'border-line text-ink-2',
            )}
          >
            <MessageCircle size={15} aria-hidden="true" />
            {(count ?? 0) > 0 && <span className="text-xs font-medium">{count}</span>}
          </button>
        )}
      </div>
      {open && !unavailable && (
        <Thread
          comments={comments?.filter((c) => !isBlocked(c.user.id))}
          error={loadError}
          onOpenProfile={social.openProfile}
          onAdd={async (body) => {
            const c = await addReviewComment(authorId, itemId, body)
            setComments((prev) => [...(prev ?? []), c])
            setCount((n) => (n ?? 0) + 1)
          }}
          onDelete={async (id) => {
            await deleteReviewComment(id)
            setComments((prev) => prev?.filter((c) => c.id !== id))
            setCount((n) => Math.max(0, (n ?? 1) - 1))
          }}
        />
      )}
    </div>
  )
}

function Thread({
  comments,
  error,
  onOpenProfile,
  onAdd,
  onDelete,
}: {
  comments?: ReviewComment[]
  error: boolean
  onOpenProfile: (username: string) => void
  onAdd: (body: string) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [confirmId, setConfirmId] = useState<number>()
  const [deleting, setDeleting] = useState<number>()
  const area = useRef<HTMLTextAreaElement>(null)

  const submit = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setErr(undefined)
    try {
      await onAdd(body)
      setText('')
      if (area.current) area.current.style.height = ''
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    setDeleting(id)
    try {
      await onDelete(id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setDeleting(undefined)
      setConfirmId(undefined)
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {comments === undefined ? (
        error ? (
          <p className="text-xs text-ink-3">{t('comments.loadError')}</p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 size={13} className="animate-spin" /> {t('social.loading')}
          </p>
        )
      ) : comments.length === 0 ? (
        <p className="text-xs text-ink-3">{t('comments.none')}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <button type="button" onClick={() => onOpenProfile(c.user.username)} className="shrink-0" aria-label={c.user.displayName}>
                <Avatar url={c.user.avatarUrl} name={c.user.displayName} size={28} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onOpenProfile(c.user.username)} className="min-w-0 truncate text-start text-[13px] font-semibold text-ink">
                    {c.user.displayName}
                  </button>
                  <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(c.createdAt)}</span>
                  {c.canDelete && confirmId !== c.id && (
                    <button type="button" onClick={() => setConfirmId(c.id)} className="ms-auto grid size-7 shrink-0 place-items-center rounded-full text-ink-3" aria-label={t('comments.delete')}>
                      <Trash2 size={14} />
                    </button>
                  )}
                  {!c.mine && <ReportButton target={{ type: 'comment', id: String(c.id), userId: c.user.id }} className={cx('size-7', !(c.canDelete && confirmId !== c.id) && 'ms-auto')} size={14} />}
                </div>
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink-2">{c.body}</p>
                {confirmId === c.id && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="text-ink-3">{t('comments.deleteConfirm')}</span>
                    <button type="button" onClick={() => void remove(c.id)} disabled={deleting === c.id} className="rounded-full bg-accent-fill px-2.5 py-1 font-semibold text-on-accent disabled:opacity-60">
                      {deleting === c.id ? <Loader2 size={12} className="animate-spin" /> : t('common.delete')}
                    </button>
                    <button type="button" onClick={() => setConfirmId(undefined)} className="rounded-full border border-line px-2.5 py-1 text-ink-2">
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('comments.placeholder')}</span>
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={COMMENT_MAX}
            onChange={(e) => {
              setText(e.target.value)
              // Le champ grandit avec le texte (jusqu'à ~6 lignes)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={t('comments.placeholder')}
            className="field block resize-none py-2 text-sm leading-snug"
          />
        </label>
        <button type="submit" disabled={busy || !text.trim()} className="btn btn-primary size-10 shrink-0 p-0" aria-label={t('comments.send')}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rtl:-scale-x-100" />}
        </button>
      </form>
      {text.length > COMMENT_MAX - 100 && (
        <p className={cx('mt-1 text-end text-[11px]', text.length >= COMMENT_MAX ? 'text-accent' : 'text-ink-3')}>
          {text.length}/{COMMENT_MAX}
        </p>
      )}
      {err && (
        <p role="alert" className="mt-1.5 text-xs text-accent">
          {err}
        </p>
      )}
    </div>
  )
}
