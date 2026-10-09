import { locale, t } from '../i18n'
import { ArrowLeft, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cx, normalizeText } from '../lib/utils'
import { useMedia } from '../store'
import type { CustomList, MediaItem } from '../types'
import { TypeBadge } from './Badges'
import ConfirmDialog from './ConfirmDialog'
import { MediaCard } from './MediaCard'
import Poster from './Poster'
import { EmptyState } from './ui'
import { SharedListsSection } from './social/SharedLists'

/** Mosaïque 2×2 des premières affiches d'une liste. */
function Mosaic({ items }: { items: MediaItem[] }) {
  const cells = [0, 1, 2, 3].map((i) => items[i])
  return (
    <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-line bg-surface-2">
      {cells.map((item, i) =>
        item?.poster ? (
          <img key={i} src={item.poster} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
        ) : (
          <div key={i} className="aspect-[2/3] w-full bg-surface-2" />
        ),
      )}
    </div>
  )
}

export function NewListForm({ onCreated, autoFocus }: { onCreated?: (list: CustomList) => void; autoFocus?: boolean }) {
  const { createList } = useMedia()
  const [name, setName] = useState('')
  // Pas de <form> ici : ce champ peut vivre à l'intérieur du formulaire d'une fiche
  const submit = () => {
    if (!name.trim()) return
    onCreated?.(createList(name))
    setName('')
  }
  return (
    <div className="flex gap-2">
      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={t('lists.newListPh')}
        autoFocus={autoFocus}
        enterKeyHint="done"
      />
      <button type="button" onClick={submit} disabled={!name.trim()} className="btn btn-light shrink-0 px-4 text-sm">
        {t('lists.create')}
      </button>
    </div>
  )
}

function ListDetail({ list, onBack, onOpen }: { list: CustomList; onBack: () => void; onOpen: (item: MediaItem) => void }) {
  const { items, renameList, deleteList, toggleInList } = useMedia()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(list.name)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState(false)
  const members = items.filter((i) => i.listIds?.includes(list.id))

  const candidates = useMemo(() => {
    const q = normalizeText(query)
    return items
      .filter((i) => !q || normalizeText(`${i.title} ${i.originalTitle ?? ''}`).includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, locale()))
      .slice(0, 80)
  }, [items, query])

  return (
    <>
      <button onClick={onBack} className="mt-2 flex items-center gap-1.5 text-sm text-ink-3">
        <ArrowLeft size={16} /> {t('lists.myLists')}
      </button>

      <div className="mb-5 mt-3 flex items-start justify-between gap-3">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              renameList(list.id, name)
              setRenaming(false)
            }}
          >
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn btn-light shrink-0 px-4 text-sm">OK</button>
          </form>
        ) : (
          <div className="min-w-0">
            <h2 className="text-2xl leading-tight">{list.name}</h2>
            <p className="mt-1 text-sm text-ink-3">
              {t('account.nTitles', { count: members.length })}
            </p>
          </div>
        )}
        {!renaming && (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => setRenaming(true)} className="grid size-10 place-items-center rounded-full border border-line text-ink-2" aria-label={t('lists.rename')}>
              <Pencil size={16} />
            </button>
            <button onClick={() => setConfirm(true)} className="grid size-10 place-items-center rounded-full border border-line text-ink-2" aria-label={t('lists.delete')}>
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      <button onClick={() => setAdding((v) => !v)} className={cx('chip mb-4', adding && 'chip-on')}>
        {adding ? <Check size={14} /> : <Plus size={14} />}
        {adding ? t('lists.done') : t('lists.addRemove')}
      </button>

      {adding ? (
        <div>
          <div className="relative mb-2">
            <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('lists.searchLibrary')} className="field ps-10" autoFocus />
          </div>
          <ul className="divide-y divide-line">
            {candidates.map((item) => {
              const inList = item.listIds?.includes(list.id)
              return (
                <li key={item.id}>
                  <button onClick={() => toggleInList(item.id, list.id)} className="flex w-full items-center gap-3 py-2.5 text-start">
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
                        inList ? 'border-accent-fill bg-accent-fill text-on-accent' : 'border-line-strong text-transparent',
                      )}
                    >
                      <Check size={14} strokeWidth={3} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : members.length ? (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {members.map((item) => (
            <MediaCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('lists.emptyTitle')} text={t('lists.emptyText')} />
      )}

      <ConfirmDialog
        open={confirm}
        title={t('confirm.title')}
        message={t('lists.deleteConfirm', { name: list.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          setConfirm(false)
          await deleteList(list.id)
          onBack()
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}

/** Onglet « Listes » du catalogue. */
export default function ListsView({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, lists } = useMedia()
  const [openId, setOpenId] = useState<string>()
  const [creating, setCreating] = useState(false)
  const open = lists.find((l) => l.id === openId)

  if (open) return <ListDetail list={open} onBack={() => setOpenId(undefined)} onOpen={onOpen} />

  return (
    <div className="mt-2">
      {creating ? (
        <div className="mb-5">
          <NewListForm
            autoFocus
            onCreated={(l) => {
              setCreating(false)
              setOpenId(l.id)
            }}
          />
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="chip mb-5">
          <Plus size={14} /> {t('lists.newList')}
        </button>
      )}

      {lists.length === 0 ? (
        <EmptyState
          title={t('lists.noneTitle')}
          text={t('lists.noneText')}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {lists.map((l) => {
            const members = items.filter((i) => i.listIds?.includes(l.id))
            return (
              <button key={l.id} onClick={() => setOpenId(l.id)} className="text-start">
                <Mosaic items={members} />
                <p className="mt-2 truncate text-sm font-semibold">{l.name}</p>
                <p className="text-xs text-ink-3">
                  {t('account.nTitles', { count: members.length })}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {/* Listes partagées avec d'autres membres (compte requis ; masqué sinon) */}
      <SharedListsSection />
    </div>
  )
}
