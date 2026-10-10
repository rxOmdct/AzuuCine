import { Archive, ArchiveRestore, ArrowLeft, Info, Minus, Pencil, Plus, RotateCcw, Trash2, Trophy, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { fmtNumber, t } from '../../i18n'
import {
  challengeTitle,
  computeProgress,
  formatDay,
  fromTemplate,
  MAX_CHALLENGES,
  mediaLabel,
  NAME_MAX,
  newChallengeId,
  periodBounds,
  periodLabel,
  quantity,
  renewed,
  TARGET_MAX,
  TEMPLATES,
  type ChallengeProgress,
} from '../../lib/challenges'
import { MEDIA_TYPES } from '../../lib/constants'
import { useEscape } from '../../lib/escape'
import { useScrollLock } from '../../lib/scrollLock'
import { cx, todayISO } from '../../lib/utils'
import { useMedia } from '../../store'
import type { Challenge, MediaItem } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import Poster from '../Poster'
import { ChallengeSummary, daysText, paceText, ProgressRing } from './ChallengeBits'

export type ChallengesView = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'detail'; id: string }

interface Props {
  initial?: ChallengesView
  onClose: () => void
  onOpen: (item: MediaItem) => void
}

/** Gestion des défis : liste, création / modification, détail (titres comptés). */
export default function ChallengesSheet({ initial = { kind: 'list' }, onClose, onOpen }: Props) {
  const { items, settings, updateSettings } = useMedia()
  const challenges = useMemo(() => settings.challenges ?? [], [settings.challenges])
  const [stack, setStack] = useState<ChallengesView[]>([initial])
  const view = stack[stack.length - 1]
  const push = (v: ChallengesView) => setStack((s) => [...s, v])
  const back = () => (stack.length > 1 ? setStack((s) => s.slice(0, -1)) : onClose())
  const replace = (v: ChallengesView) => setStack((s) => [...s.slice(0, -1), v])

  useScrollLock()
  useEscape(back)

  const save = (list: Challenge[]) => updateSettings({ challenges: list.slice(0, MAX_CHALLENGES) })
  const upsert = (c: Challenge) => save(challenges.some((x) => x.id === c.id) ? challenges.map((x) => (x.id === c.id ? c : x)) : [...challenges, c])
  const full = challenges.length >= MAX_CHALLENGES

  const current = view.kind === 'edit' || view.kind === 'detail' ? challenges.find((c) => c.id === view.id) : undefined

  let title: string
  let body: ReactNode
  if (view.kind === 'new' || (view.kind === 'edit' && current)) {
    title = view.kind === 'new' ? t('challenges.new') : t('challenges.edit')
    body = (
      <ChallengeForm
        key={view.kind === 'edit' ? view.id : 'new'}
        initial={view.kind === 'edit' ? current : undefined}
        items={items}
        onSave={(c) => {
          upsert(c)
          if (view.kind === 'new') replace({ kind: 'detail', id: c.id })
          else back()
        }}
      />
    )
  } else if (view.kind === 'detail' && current) {
    title = t('challenges.title')
    body = (
      <ChallengeDetail
        c={current}
        items={items}
        onOpen={onOpen}
        onEdit={() => push({ kind: 'edit', id: current.id })}
        onArchive={() => upsert({ ...current, archived: current.archived ? undefined : true })}
        onRenew={
          full
            ? undefined
            : () => {
                const next = renewed(current)
                save([...challenges.map((x) => (x.id === current.id ? { ...x, archived: true } : x)), next])
                replace({ kind: 'detail', id: next.id })
              }
        }
        onDelete={() => {
          save(challenges.filter((x) => x.id !== current.id))
          back()
        }}
      />
    )
  } else {
    title = t('challenges.title')
    body = (
      <ChallengeList
        challenges={challenges}
        items={items}
        full={full}
        onNew={() => push({ kind: 'new' })}
        onPick={(id) => push({ kind: 'detail', id })}
        onTemplate={(c) => {
          upsert(c)
          push({ kind: 'detail', id: c.id })
        }}
      />
    )
  }

  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={title}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={back} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={stack.length > 1 ? t('challenges.back') : t('common.close')}>
            {stack.length > 1 ? <ArrowLeft size={22} className="rtl:rotate-180" /> : <X size={22} />}
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</h2>
          <span className="size-10" />
        </div>
      </header>
      <div key={stack.length + view.kind} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl px-4 py-5 pb-[calc(10rem+env(safe-area-inset-bottom))]">{body}</div>
      </div>
    </div>
  )
}

// ─── Liste ───

/** Avec un nom perso, on rappelle ce qui est compté. */
function mediaLabelIfNamed(c: Challenge) {
  return c.name ? challengeTitle({ ...c, name: undefined }) : null
}

function ChallengeList({ challenges, items, full, onNew, onPick, onTemplate }: { challenges: Challenge[]; items: MediaItem[]; full: boolean; onNew: () => void; onPick: (id: string) => void; onTemplate: (c: Challenge) => void }) {
  const rows = useMemo(() => challenges.map((c) => ({ c, p: computeProgress(c, items) })), [challenges, items])
  const today = todayISO()
  const active = rows.filter((r) => !r.c.archived && r.c.end >= today)
  const finished = rows.filter((r) => !r.c.archived && r.c.end < today)
  const archived = rows.filter((r) => r.c.archived)
  // Modèles pas encore utilisés sur la période en cours
  const templates = TEMPLATES.map((tpl) => fromTemplate(tpl)).filter(
    (tpl) => !challenges.some((c) => !c.archived && c.target === tpl.target && c.media === tpl.media && c.unit === tpl.unit && c.start === tpl.start && c.end === tpl.end),
  )

  const section = (label: string, list: typeof rows) =>
    list.length > 0 && (
      <section className="mt-7">
        <h3 className="eyebrow mb-2">{label}</h3>
        <div className="card divide-y divide-line overflow-hidden">
          {list.map(({ c, p }) => (
            <ChallengeSummary key={c.id} c={c} p={p} ring={52} onClick={() => onPick(c.id)} />
          ))}
        </div>
      </section>
    )

  return (
    <>
      <button onClick={onNew} disabled={full} className="btn btn-primary w-full">
        <Plus size={18} /> {t('challenges.new')}
      </button>
      {full && <p className="mt-2 text-center text-xs text-ink-3">{t('challenges.limit', { n: MAX_CHALLENGES })}</p>}

      {!full && templates.length > 0 && (
        <section className="mt-6">
          <h3 className="eyebrow mb-2">{t('challenges.templates')}</h3>
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <button key={`${tpl.target}-${tpl.media}-${tpl.unit}-${tpl.period}`} onClick={() => onTemplate({ ...tpl, id: newChallengeId() })} className="chip">
                <Plus size={14} className="text-accent" />
                {challengeTitle(tpl)} · {periodLabel(tpl)}
              </button>
            ))}
          </div>
        </section>
      )}

      {section(t('challenges.active'), active)}
      {section(t('challenges.finished'), finished)}
      {section(t('challenges.archived'), archived)}
    </>
  )
}

// ─── Détail ───

function ChallengeDetail({ c, items, onOpen, onEdit, onArchive, onRenew, onDelete }: { c: Challenge; items: MediaItem[]; onOpen: (item: MediaItem) => void; onEdit: () => void; onArchive: () => void; onRenew?: () => void; onDelete: () => void }) {
  const p = useMemo(() => computeProgress(c, items), [c, items])
  const [confirm, setConfirm] = useState(false)
  const days = daysText(p)
  const ended = c.end < todayISO()
  return (
    <>
      <div className="flex flex-col items-center text-center">
        <ProgressRing value={p.count / c.target} size={132} stroke={9}>
          <span className="flex flex-col items-center leading-none">
            <span className="text-3xl font-black tabular-nums">{fmtNumber(p.count)}</span>
            <span className="mt-1 text-xs text-ink-3 tabular-nums">/ {fmtNumber(c.target)}</span>
          </span>
        </ProgressRing>
        <h3 className="mt-4 text-xl font-semibold">{challengeTitle(c)}</h3>
        <p className="mt-1 text-sm text-ink-3">{[mediaLabelIfNamed(c), periodLabel(c)].filter(Boolean).join(' · ')}</p>
        {p.done ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent-fill px-3 py-1 text-sm font-semibold text-on-accent">
            <Trophy size={15} /> {paceText(c, p)}
          </span>
        ) : (
          <p className="mt-3 text-sm text-ink-2">{[paceText(c, p), days].filter(Boolean).join(' · ')}</p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button onClick={onEdit} className="btn btn-ghost px-3 text-sm">
          <Pencil size={16} /> {t('common.edit')}
        </button>
        <button onClick={onArchive} className="btn btn-ghost px-3 text-sm">
          {c.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {c.archived ? t('challenges.unarchive') : t('challenges.archive')}
        </button>
        {ended && onRenew && (
          <button onClick={onRenew} className="btn btn-ghost px-3 text-sm">
            <RotateCcw size={16} /> {t('challenges.renew')}
          </button>
        )}
        <button onClick={() => setConfirm(true)} className={cx('btn px-3 text-sm text-ink-2', !(ended && onRenew) && 'col-span-2')}>
          <Trash2 size={16} /> {t('common.delete')}
        </button>
      </div>

      <h3 className="eyebrow mt-8 mb-2">
        {t('challenges.counted')} · {fmtNumber(p.entries.length)}
      </h3>
      {p.entries.length === 0 ? (
        <p className="card p-4 text-sm text-ink-3">{t('challenges.countedEmpty')}</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {p.entries.map((e) => (
            <li key={`${e.item.id}-${e.date}-${e.rewatch ? 'r' : ''}`}>
              <button onClick={() => onOpen(e.item)} className="flex w-full items-center gap-3 p-2.5 text-start transition-colors active:bg-surface-2">
                <span className="w-10 shrink-0">
                  <Poster src={e.item.poster} title={e.item.title} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.item.title}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {[mediaLabel(e.item.type), formatDay(e.date)].join(' · ')}
                  </span>
                </span>
                {e.rewatch && <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-2">{t('challenges.rewatch')}</span>}
                {c.unit === 'episodes' && (
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">
                    {e.estimated ? '≈ ' : ''}
                    {quantity(Math.round(e.amount), 'all', 'episodes')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {p.estimated && (
        <p className="mt-3 flex gap-2 text-xs leading-relaxed text-ink-3">
          <Info size={14} className="mt-0.5 shrink-0" /> {t('challenges.estimated')}
        </p>
      )}

      <ConfirmDialog
        open={confirm}
        title={t('challenges.deleteTitle')}
        message={t('challenges.deleteText')}
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          onDelete()
        }}
      />
    </>
  )
}

// ─── Formulaire ───

const UNITS: Challenge['unit'][] = ['titles', 'episodes']
const PERIODS: Challenge['period'][] = ['week', 'month', 'year', 'custom']

function ChallengeForm({ initial, items, onSave }: { initial?: Challenge; items: MediaItem[]; onSave: (c: Challenge) => void }) {
  const [draft, setDraft] = useState<Challenge>(() => initial ?? { id: newChallengeId(), target: 12, media: 'film', unit: 'titles', period: 'year', ...periodBounds('year') })
  const [targetText, setTargetText] = useState(String(draft.target))
  const set = (patch: Partial<Challenge>) => setDraft((d) => ({ ...d, ...patch }))

  const setTarget = (n: number) => {
    const v = Math.min(TARGET_MAX, Math.max(1, Math.round(n) || 1))
    set({ target: v })
    setTargetText(String(v))
  }
  const setPeriod = (period: Challenge['period']) => {
    if (period === draft.period) return
    if (period === 'custom') set({ period })
    else set({ period, ...periodBounds(period) })
  }
  const setMedia = (media: Challenge['media']) => set(media === 'film' ? { media, unit: 'titles' } : { media })

  const valid = draft.target >= 1 && !!draft.start && !!draft.end && draft.end >= draft.start
  const preview = useMemo(() => (valid ? computeProgress(draft, items) : null), [draft, items, valid])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        const name = draft.name?.trim().slice(0, NAME_MAX)
        onSave({ ...draft, name: name || undefined })
      }}
      className="space-y-6"
    >
      <div>
        <span className="label">{t('challenges.target')}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTarget(draft.target - 1)} className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-2 active:bg-surface-2" aria-label="−1">
            <Minus size={18} />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={TARGET_MAX}
            value={targetText}
            onChange={(e) => {
              setTargetText(e.target.value)
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1) set({ target: Math.min(TARGET_MAX, Math.round(n)) })
            }}
            onBlur={() => setTarget(Number(targetText))}
            className="field w-24 text-center text-lg font-semibold tabular-nums"
            aria-label={t('challenges.target')}
          />
          <button type="button" onClick={() => setTarget(draft.target + 1)} className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-2 active:bg-surface-2" aria-label="+1">
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div>
        <span className="label">{t('challenges.media')}</span>
        <div className="flex flex-wrap gap-2">
          {(['all', ...MEDIA_TYPES.map((m) => m.value)] as Challenge['media'][]).map((m) => (
            <button type="button" key={m} onClick={() => setMedia(m)} className={cx('chip', draft.media === m && 'chip-on')} aria-pressed={draft.media === m}>
              {mediaLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">{t('challenges.unit')}</span>
        <div className="flex flex-wrap gap-2">
          {UNITS.map((u) => (
            <button
              type="button"
              key={u}
              disabled={u === 'episodes' && draft.media === 'film'}
              onClick={() => set({ unit: u })}
              className={cx('chip disabled:opacity-40', draft.unit === u && 'chip-on')}
              aria-pressed={draft.unit === u}
            >
              {t(u === 'titles' ? 'challenges.unit.titles' : 'challenges.unit.episodes')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">{t('challenges.period')}</span>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button type="button" key={p} onClick={() => setPeriod(p)} className={cx('chip', draft.period === p && 'chip-on')} aria-pressed={draft.period === p}>
              {t(`challenges.period.${p}`)}
            </button>
          ))}
        </div>
        {draft.period === 'custom' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label>
              <span className="label">{t('challenges.from')}</span>
              <input type="date" value={draft.start} max={draft.end || undefined} onChange={(e) => set({ start: e.target.value })} className="field" />
            </label>
            <label>
              <span className="label">{t('challenges.to')}</span>
              <input type="date" value={draft.end} min={draft.start || undefined} onChange={(e) => set({ end: e.target.value })} className="field" />
            </label>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">{periodLabel(draft)}</p>
        )}
      </div>

      <label className="block">
        <span className="label">{t('challenges.name')}</span>
        <input type="text" value={draft.name ?? ''} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder={challengeTitle({ ...draft, name: undefined })} className="field" />
      </label>

      {preview && (
        <div className="card flex items-center gap-3 p-3.5">
          <ProgressRing value={preview.count / draft.target} done={preview.done} size={44} stroke={4} animate={false} />
          <p className="text-sm text-ink-2">{t('challenges.preview', { what: quantity(preview.count, draft.media, draft.unit) })}</p>
        </div>
      )}

      <button type="submit" disabled={!valid} className="btn btn-primary w-full">
        {initial ? t('common.save') : t('challenges.create')}
      </button>
    </form>
  )
}
