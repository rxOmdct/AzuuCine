import { t } from '../../i18n'
import { CircleDot, ListPlus, Minus, Plus, Tag, Trash2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useBackToClose } from '../../lib/backNav'
import { allTags, cleanTag, hasTag } from '../../lib/bulk'
import { STATUSES } from '../../lib/constants'
import { useEscape } from '../../lib/escape'
import { cx, normalizeText } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem, WatchStatus } from '../../types'
import { StatusDot } from '../Badges'
import ConfirmDialog from '../ConfirmDialog'
import { NewListForm } from '../ListsView'
import { useLibraryActions } from './useLibraryActions'

type Panel = null | 'status' | 'list' | 'tag' | 'delete'

interface Props {
  /** Fiches sélectionnées */
  selected: MediaItem[]
  /** Action terminée : on quitte le mode sélection */
  onDone: () => void
}

/** Barre d'actions groupées (en bas, à la place de la barre de navigation). */
export default function SelectionBar({ selected, onDone }: Props) {
  const actions = useLibraryActions()
  const [panel, setPanel] = useState<Panel>(null)
  const ids = selected.map((i) => i.id)
  const none = selected.length === 0

  const run = async (fn: () => Promise<void>) => {
    setPanel(null)
    await fn()
    onDone()
  }

  return (
    <>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-md lg:start-60 lg:bottom-6 lg:mx-auto lg:max-w-xl lg:rounded-2xl lg:border lg:pb-0">
        <div className="mx-auto grid max-w-2xl grid-cols-4 px-2" role="toolbar" aria-label={t('select.actions')}>
          <BarButton icon={<CircleDot size={21} />} label={t('select.status')} onClick={() => setPanel('status')} disabled={none} />
          <BarButton icon={<ListPlus size={21} />} label={t('select.list')} onClick={() => setPanel('list')} disabled={none} />
          <BarButton icon={<Tag size={21} />} label={t('select.tag')} onClick={() => setPanel('tag')} disabled={none} />
          <BarButton icon={<Trash2 size={21} />} label={t('common.delete')} onClick={() => setPanel('delete')} disabled={none} danger />
        </div>
      </div>

      {panel === 'status' && (
        <PickerSheet title={t('select.statusTitle', { count: selected.length })} onClose={() => setPanel(null)}>
          {STATUSES.map((s) => {
            const already = selected.every((i) => i.status === s.value)
            return (
              <button
                key={s.value}
                onClick={() => void run(() => actions.setStatus(ids, s.value as WatchStatus))}
                disabled={already}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-start text-[15px] text-ink active:bg-surface-2 disabled:opacity-40"
              >
                <StatusDot status={s.value} className="size-2.5" />
                {s.label}
              </button>
            )
          })}
        </PickerSheet>
      )}

      {panel === 'list' && <ListPicker selected={selected} onClose={() => setPanel(null)} run={run} />}
      {panel === 'tag' && <TagPicker selected={selected} onClose={() => setPanel(null)} run={run} />}

      <ConfirmDialog
        open={panel === 'delete'}
        title={t('confirm.title')}
        message={t('select.deleteConfirm', { count: selected.length })}
        confirmLabel={t('common.delete')}
        onConfirm={() => void run(() => actions.deleteItems(ids))}
        onCancel={() => setPanel(null)}
      />
    </>
  )
}

function BarButton({ icon, label, onClick, disabled, danger }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx('flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-medium transition-colors disabled:opacity-35', danger ? 'text-accent' : 'text-ink')}
    >
      {icon}
      {label}
    </button>
  )
}

/** Petite feuille en bas de l'écran ; Échap ou le geste retour la ferment sans quitter la sélection. */
function PickerSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  useBackToClose(onClose)
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-in safe-bottom max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border border-line-strong bg-surface p-3 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between gap-2 ps-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-3" aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

type Run = (fn: () => Promise<void>) => Promise<void>

function ListPicker({ selected, onClose, run }: { selected: MediaItem[]; onClose: () => void; run: Run }) {
  const { lists } = useMedia()
  const actions = useLibraryActions()
  const ids = selected.map((i) => i.id)
  return (
    <PickerSheet title={t('select.listTitle', { count: selected.length })} onClose={onClose}>
      {lists.length === 0 && <p className="px-3 pb-3 text-sm text-ink-3">{t('select.noLists')}</p>}
      <ul className="divide-y divide-line">
        {lists.map((l) => {
          const inside = selected.filter((i) => i.listIds?.includes(l.id)).length
          return (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{l.name}</p>
                <p className="text-xs text-ink-3">{t('select.inList', { n: inside, total: selected.length })}</p>
              </div>
              <button
                onClick={() => void run(() => actions.removeFromList(ids, l.id))}
                disabled={inside === 0}
                className="grid size-9 place-items-center rounded-full border border-line text-ink-2 disabled:opacity-30"
                aria-label={t('select.removeFrom', { list: l.name })}
              >
                <Minus size={16} />
              </button>
              <button
                onClick={() => void run(() => actions.addToList(ids, l.id))}
                disabled={inside === selected.length}
                className="grid size-9 place-items-center rounded-full bg-accent-fill text-on-accent disabled:opacity-30"
                aria-label={t('select.addTo', { list: l.name })}
              >
                <Plus size={16} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 px-1 pb-1">
        <NewListForm onCreated={(l) => void run(() => actions.addToList(ids, l.id, l.name))} />
      </div>
    </PickerSheet>
  )
}

function TagPicker({ selected, onClose, run }: { selected: MediaItem[]; onClose: () => void; run: Run }) {
  const { items } = useMedia()
  const actions = useLibraryActions()
  const ids = selected.map((i) => i.id)
  const existing = useMemo(() => allTags(items), [items])
  // Tags déjà portés par au moins une fiche sélectionnée (pour les retirer)
  const present = useMemo(() => allTags(selected), [selected])
  const [text, setText] = useState('')
  const q = normalizeText(text)
  const suggestions = existing.filter((tag) => !selected.every((i) => hasTag(i, tag)) && (!q || normalizeText(tag).includes(q))).slice(0, 16)
  const add = (raw: string) => {
    const tag = cleanTag(raw, existing)
    if (tag) void run(() => actions.addTag(ids, tag))
  }

  return (
    <PickerSheet title={t('select.tagTitle', { count: selected.length })} onClose={onClose}>
      <form
        className="flex gap-2 px-1"
        onSubmit={(e) => {
          e.preventDefault()
          add(text)
        }}
      >
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('tags.placeholder')} maxLength={40} autoFocus enterKeyHint="done" aria-label={t('tags.label')} />
        <button disabled={!cleanTag(text)} className="btn btn-light shrink-0 px-4 text-sm">
          {t('common.add')}
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 px-1">
          {suggestions.map((tag) => (
            <button key={tag} onClick={() => add(tag)} className="chip py-1! text-xs">
              + {tag}
            </button>
          ))}
        </div>
      )}
      {present.length > 0 && (
        <div className="mt-5 border-t border-line px-1 pt-3">
          <span className="label">{t('select.removeTag')}</span>
          <div className="flex flex-wrap gap-1.5">
            {present.map((tag) => (
              <button key={tag} onClick={() => void run(() => actions.removeTag(ids, tag))} className="chip py-1! text-xs" aria-label={t('common.removeX', { name: tag })}>
                #{tag} <X size={13} />
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-4 px-1 pb-1 text-xs text-ink-3">{t('tags.private')}</p>
    </PickerSheet>
  )
}
