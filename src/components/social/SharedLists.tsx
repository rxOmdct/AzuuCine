import { Check, Loader2, LogOut, Pencil, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { locale, t } from '../../i18n'
import {
  addSharedListItem,
  createSharedList,
  deleteSharedList,
  getSharedList,
  getSharedLists,
  inviteCandidates,
  inviteToSharedList,
  leaveSharedList,
  removeSharedListItem,
  removeSharedListMember,
  renameSharedList,
  respondToInvite,
  SHARED_LIST_NAME_MAX,
  SharedListsUnavailable,
  snapshotOf,
  type SharedList,
  type SharedListCard,
  type SharedListInvite,
  type SharedListItem,
} from '../../lib/cloud/sharedLists'
import type { ProfileCard } from '../../lib/cloud/social'
import { TYPE_BY_VALUE } from '../../lib/constants'
import { cx, normalizeText } from '../../lib/utils'
import { useMedia } from '../../store'
import { TypeBadge } from '../Badges'
import ConfirmDialog from '../ConfirmDialog'
import Poster from '../Poster'
import { EmptyState } from '../ui'
import Avatar from './Avatar'
import PersonRow from './PersonRow'
import Sheet from './Sheet'
import { useSocial } from './SocialProvider'

/** Mosaïque 2×2 des dernières affiches d'une liste partagée. */
function PosterMosaic({ posters }: { posters: string[] }) {
  return (
    <div className="relative grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-line bg-surface-2">
      {[0, 1, 2, 3].map((i) =>
        posters[i] ? (
          <img key={i} src={posters[i]} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
        ) : (
          <div key={i} className="aspect-[2/3] w-full bg-surface-2" />
        ),
      )}
      <span className="absolute bottom-1.5 end-1.5 grid size-7 place-items-center rounded-full bg-bg/85 text-ink" aria-hidden="true">
        <Users size={14} />
      </span>
    </div>
  )
}

/** Champ « nom de liste » + bouton (création, renommage). */
function NameForm({ initial = '', submitLabel, onSubmit, onCancel, autoFocus }: { initial?: string; submitLabel: string; onSubmit: (name: string) => Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setErr(undefined)
    try {
      await onSubmit(name.trim())
      setName('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="field"
          value={name}
          maxLength={SHARED_LIST_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
            if (e.key === 'Escape' && onCancel) {
              e.stopPropagation()
              onCancel()
            }
          }}
          placeholder={t('shared.namePh')}
          autoFocus={autoFocus}
          enterKeyHint="done"
          aria-label={t('shared.namePh')}
        />
        <button type="button" onClick={() => void submit()} disabled={!name.trim() || busy} className="btn btn-light shrink-0 px-4 text-sm">
          {busy ? <Loader2 size={15} className="animate-spin" /> : submitLabel}
        </button>
      </div>
      {err && (
        <p role="alert" className="mt-1.5 text-xs text-accent">
          {err}
        </p>
      )}
    </div>
  )
}

// ════════════════════════ Section « Listes partagées » (onglet Listes) ════════════════════════

export function SharedListsSection() {
  const social = useSocial()
  const [data, setData] = useState<{ lists: SharedListCard[]; invites: SharedListInvite[] }>()
  const [unavailable, setUnavailable] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyInvite, setBusyInvite] = useState<string>()

  useEffect(() => {
    if (!social.enabled) return
    let alive = true
    getSharedLists()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return
        if (e instanceof SharedListsUnavailable) setUnavailable(true)
        else setData((prev) => prev ?? { lists: [], invites: [] })
      })
    return () => {
      alive = false
    }
  }, [social.enabled, social.sharedTick])

  // Sans compte, ou serveur pas encore à jour : la section n'existe pas
  if (!social.enabled || unavailable) return null

  const respond = async (inv: SharedListInvite, accept: boolean) => {
    setBusyInvite(inv.id)
    try {
      await respondToInvite(inv.id, accept)
      social.bumpShared()
      if (accept) social.openSharedList(inv.id)
    } catch {
      /* l'invitation reste affichée */
    } finally {
      setBusyInvite(undefined)
    }
  }

  return (
    <section className="mt-10 border-t border-line pt-6" aria-labelledby="shared-lists-title">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="shared-lists-title" className="flex items-center gap-2 text-lg">
          <Users size={18} className="text-accent" aria-hidden="true" /> {t('shared.title')}
        </h2>
      </div>
      <p className="mb-4 text-sm text-ink-3">{t('shared.hint')}</p>

      {creating ? (
        <div className="mb-5">
          <NameForm
            autoFocus
            submitLabel={t('lists.create')}
            onCancel={() => setCreating(false)}
            onSubmit={async (name) => {
              const id = await createSharedList(name)
              setCreating(false)
              social.bumpShared()
              social.openSharedList(id)
            }}
          />
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="chip mb-5">
          <Plus size={14} /> {t('shared.new')}
        </button>
      )}

      {/* Invitations reçues */}
      {data && data.invites.length > 0 && (
        <ul className="mb-6 space-y-2">
          {data.invites.map((inv) => (
            <li key={inv.id} className="card p-3.5 sm:flex sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar url={inv.owner?.avatarUrl} name={inv.owner?.displayName ?? '?'} size={36} />
              <p className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
                <b className="text-ink">{inv.owner?.displayName ?? t('notif.someone')}</b> {t('shared.invitesYou')} <b className="text-ink">{inv.name}</b>
              </p>
              </div>
              <div className="mt-3 flex shrink-0 justify-end gap-2 sm:mt-0">
                <button onClick={() => void respond(inv, false)} disabled={busyInvite === inv.id} className="btn btn-ghost px-3.5 py-1.5 text-sm">
                  {t('shared.decline')}
                </button>
                <button onClick={() => void respond(inv, true)} disabled={busyInvite === inv.id} className="btn btn-primary px-3.5 py-1.5 text-sm">
                  {busyInvite === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('shared.accept')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data === undefined ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 size={14} className="animate-spin" /> {t('social.loading')}
        </p>
      ) : data.lists.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-3">{t('shared.none')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {data.lists.map((l) => (
            <button key={l.id} onClick={() => social.openSharedList(l.id)} className="text-start">
              <PosterMosaic posters={l.posters} />
              <p className="mt-2 truncate text-sm font-semibold">{l.name}</p>
              <p className="truncate text-xs text-ink-3">
                {t('account.nTitles', { count: l.count })} · {t('shared.nMembers', { count: l.members })}
              </p>
              {!l.isOwner && l.owner && <p className="truncate text-[11px] text-ink-3">{t('shared.by', { name: l.owner.displayName })}</p>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ════════════════════════ Une liste partagée (plein écran) ════════════════════════

export function SharedListSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const social = useSocial()
  const [list, setList] = useState<SharedList | null>()
  const [error, setError] = useState<string>()
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null)
  const [busyKey, setBusyKey] = useState<string>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    getSharedList(id)
      .then((l) => alive && setList(l))
      .catch((e) => alive && (setError((e as Error).message), setList(null)))
    return () => {
      alive = false
    }
  }, [id, reload, social.sharedTick])

  const refresh = () => setReload((n) => n + 1)

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key)
    setError(undefined)
    try {
      await fn()
      refresh()
      social.bumpShared()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyKey(undefined)
    }
  }

  const accepted = list?.members.filter((m) => m.status === 'accepted') ?? []
  const pending = list?.members.filter((m) => m.status === 'pending') ?? []

  return (
    <Sheet title={list?.name ?? t('shared.title')} label={list?.name ?? t('shared.title')} onClose={onClose} wide>
      {list === undefined ? (
        <p className="flex items-center justify-center py-16 text-ink-3">
          <Loader2 size={20} className="animate-spin" />
        </p>
      ) : list === null ? (
        <div className="px-4">
          <EmptyState title={t('shared.notFound')} text={error} />
        </div>
      ) : (
        <div className="px-4 pt-5 lg:px-8">
          {/* Nom + compteurs */}
          <div className="flex items-start justify-between gap-3">
            {renaming ? (
              <div className="flex-1">
                <NameForm
                  autoFocus
                  initial={list.name}
                  submitLabel="OK"
                  onCancel={() => setRenaming(false)}
                  onSubmit={async (name) => {
                    await renameSharedList(list.id, name)
                    setRenaming(false)
                    refresh()
                    social.bumpShared()
                  }}
                />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="eyebrow flex items-center gap-1.5">
                  <Users size={12} aria-hidden="true" /> {t('shared.badge')}
                </p>
                <h2 className="mt-1 text-2xl leading-tight">{list.name}</h2>
                <p className="mt-1 text-sm text-ink-3">
                  {t('account.nTitles', { count: list.items.length })} · {t('shared.nMembers', { count: accepted.length })}
                </p>
              </div>
            )}
            {list.isOwner && !renaming && (
              <button onClick={() => setRenaming(true)} className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-2" aria-label={t('lists.rename')}>
                <Pencil size={16} />
              </button>
            )}
          </div>

          {/* Membres */}
          <section className="mt-5" aria-label={t('shared.members')}>
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">{t('shared.members')}</span>
              {list.isOwner && (
                <button onClick={() => social.openInvite(list.id, list.name)} className="chip py-1 text-xs">
                  <UserPlus size={13} /> {t('shared.invite')}
                </button>
              )}
            </div>
            <ul className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
              {[...accepted, ...pending].map((m) => (
                <li key={m.id} className="relative w-16 shrink-0 text-center">
                  <button onClick={() => social.openProfile(m.username)} className="block w-full" aria-label={m.displayName}>
                    <Avatar url={m.avatarUrl} name={m.displayName} size={52} className={cx('mx-auto', m.status === 'pending' && 'opacity-50')} />
                    <span className="mt-1.5 block truncate text-[11px] font-medium text-ink-2">{m.displayName}</span>
                    <span className="block truncate text-[10px] text-ink-3">{m.isOwner ? t('shared.owner') : m.status === 'pending' ? t('shared.pending') : ' '}</span>
                  </button>
                  {list.isOwner && !m.isOwner && (
                    <button
                      onClick={() => void act(`m:${m.id}`, () => removeSharedListMember(list.id, m.id))}
                      disabled={busyKey === `m:${m.id}`}
                      className="absolute -top-1 end-0 grid size-6 place-items-center rounded-full border border-line-strong bg-surface text-ink-2"
                      aria-label={t('shared.removeMember', { name: m.displayName })}
                    >
                      {busyKey === `m:${m.id}` ? <Loader2 size={11} className="animate-spin" /> : <X size={12} />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {error && (
            <p role="alert" className="mt-3 text-sm text-accent">
              {error}
            </p>
          )}

          {/* Titres */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button onClick={() => setEditing((v) => !v)} className={cx('chip', editing && 'chip-on')}>
              {editing ? <Check size={14} /> : <Plus size={14} />}
              {editing ? t('lists.done') : t('lists.addRemove')}
            </button>
          </div>

          {editing && <LibraryPicker list={list} onChanged={refresh} />}

          {list.items.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={t('lists.emptyTitle')} text={t('shared.emptyText')} />
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {list.items.map((it) => (
                <SharedItemCard
                  key={it.externalId}
                  item={it}
                  editing={editing}
                  busy={busyKey === `i:${it.externalId}`}
                  onOpen={() => social.openTitle(it)}
                  onRemove={() => void act(`i:${it.externalId}`, () => removeSharedListItem(list.id, it.externalId))}
                />
              ))}
            </div>
          )}

          {/* Quitter / supprimer */}
          <div className="mt-10 border-t border-line pt-5">
            {list.isOwner ? (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-2 text-sm font-medium text-accent">
                <Trash2 size={16} /> {t('shared.delete')}
              </button>
            ) : (
              <button onClick={() => setConfirm('leave')} className="flex items-center gap-2 text-sm font-medium text-accent">
                <LogOut size={16} className="rtl:-scale-x-100" /> {t('shared.leave')}
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={t('confirm.title')}
        message={list ? (confirm === 'delete' ? t('shared.deleteConfirm', { name: list.name }) : t('shared.leaveConfirm', { name: list.name })) : undefined}
        confirmLabel={confirm === 'delete' ? t('common.delete') : t('shared.leaveShort')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!list) return
          const kind = confirm
          setConfirm(null)
          try {
            if (kind === 'delete') await deleteSharedList(list.id)
            else await leaveSharedList(list.id)
            social.bumpShared()
            onClose()
          } catch (e) {
            setError((e as Error).message)
          }
        }}
      />
    </Sheet>
  )
}

function SharedItemCard({ item, editing, busy, onOpen, onRemove }: { item: SharedListItem; editing: boolean; busy: boolean; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="relative">
      <button onClick={onOpen} className="block w-full text-start">
        <Poster src={item.poster} title={item.title} />
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{item.title}</p>
        <p className="mt-0.5 text-xs text-ink-3">{[item.year, TYPE_BY_VALUE[item.type].label].filter(Boolean).join(' · ')}</p>
      </button>
      {item.addedBy && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Avatar url={item.addedBy.avatarUrl} name={item.addedBy.displayName} size={16} />
          <span className="truncate">{t('shared.addedBy', { name: item.addedBy.displayName })}</span>
        </p>
      )}
      {editing && (
        <button
          onClick={onRemove}
          disabled={busy}
          className="absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-full border border-line-strong bg-bg/90 text-ink"
          aria-label={t('shared.removeTitle', { title: item.title })}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
        </button>
      )}
    </div>
  )
}

/** Ajouter / retirer des titres de ma bibliothèque (ceux qui ont une référence TMDB / AniList). */
function LibraryPicker({ list, onChanged }: { list: SharedList; onChanged: () => void }) {
  const { items } = useMedia()
  const social = useSocial()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<string>()
  const inList = useMemo(() => new Set(list.items.map((i) => i.externalId)), [list.items])

  const candidates = useMemo(() => {
    const q = normalizeText(query)
    return items
      .filter((i) => i.externalId && (!q || normalizeText(`${i.title} ${i.originalTitle ?? ''}`).includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, locale()))
      .slice(0, 60)
  }, [items, query])

  const toggle = async (item: (typeof items)[number]) => {
    const snap = snapshotOf(item)
    if (!snap) return
    setBusy(item.id)
    setErr(undefined)
    try {
      if (inList.has(snap.externalId)) await removeSharedListItem(list.id, snap.externalId)
      else await addSharedListItem(list.id, snap)
      onChanged()
      social.bumpShared()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line p-3">
      <div className="relative mb-2">
        <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('lists.searchLibrary')} className="field ps-10" aria-label={t('lists.searchLibrary')} />
      </div>
      {err && (
        <p role="alert" className="mb-2 text-xs text-accent">
          {err}
        </p>
      )}
      <ul className="max-h-80 divide-y divide-line overflow-y-auto overscroll-contain">
        {candidates.map((item) => {
          const on = inList.has(item.externalId!)
          return (
            <li key={item.id}>
              <button onClick={() => void toggle(item)} disabled={busy === item.id} className="flex w-full items-center gap-3 py-2.5 text-start">
                <div className="w-9 shrink-0">
                  <Poster src={item.poster} title={item.title} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <div className="mt-1">
                    <TypeBadge item={item} />
                  </div>
                </div>
                <span
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-full border',
                    on ? 'border-accent-fill bg-accent-fill text-on-accent' : 'border-line-strong text-transparent',
                  )}
                >
                  {busy === item.id ? <Loader2 size={13} className="animate-spin text-ink-3" /> : <Check size={14} strokeWidth={3} />}
                </span>
              </button>
            </li>
          )
        })}
        {candidates.length === 0 && <li className="py-4 text-center text-sm text-ink-3">{t('shared.noCandidates')}</li>}
      </ul>
    </div>
  )
}

// ════════════════════════ Inviter des membres ════════════════════════

export function InvitePeople({ listId, listName, onClose }: { listId: string; listName: string; onClose: () => void }) {
  const social = useSocial()
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<ProfileCard[]>()
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<string>()

  useEffect(() => {
    let alive = true
    const timer = setTimeout(
      () => {
        inviteCandidates(listId, q)
          .then((r) => alive && setPeople(r))
          .catch((e) => alive && (setPeople([]), setErr((e as Error).message)))
      },
      q ? 250 : 0,
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [listId, q])

  const invite = async (p: ProfileCard) => {
    setBusy(p.id)
    setErr(undefined)
    try {
      await inviteToSharedList(listId, p.id)
      setInvited((s) => new Set(s).add(p.id))
      social.bumpShared()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Sheet title={t('shared.inviteTitle')} label={t('shared.inviteTitle')} onClose={onClose}>
      <div className="px-4 pt-4">
        <p className="text-sm text-ink-3">{t('shared.inviteHint', { name: listName })}</p>
        <div className="relative mt-3">
          <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shared.searchPeople')} className="field ps-10" autoFocus aria-label={t('shared.searchPeople')} />
        </div>
        {err && (
          <p role="alert" className="mt-2 text-xs text-accent">
            {err}
          </p>
        )}
        {people === undefined ? (
          <p className="flex justify-center py-10 text-ink-3">
            <Loader2 size={18} className="animate-spin" />
          </p>
        ) : people.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">{t('shared.noPeople')}</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {people.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                actions={
                  <button
                    onClick={() => void invite(p)}
                    disabled={busy === p.id || invited.has(p.id)}
                    className={cx(
                      'flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition active:scale-95',
                      invited.has(p.id) ? 'border border-line-strong text-ink-2' : 'bg-accent-fill text-on-accent',
                    )}
                  >
                    {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : invited.has(p.id) ? <Check size={13} /> : <UserPlus size={13} />}
                    {invited.has(p.id) ? t('shared.invited') : t('shared.inviteShort')}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
