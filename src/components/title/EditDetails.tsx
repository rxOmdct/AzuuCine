import { ImagePlus, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { useEscape } from '../../lib/escape'
import { DEFAULT_FILM_MINUTES, MEDIA_TYPES, TYPE_BY_VALUE } from '../../lib/constants'
import { canonicalGenre, canonicalSubtype, genreLabel, genreSuggestions as defaultGenres, subtypeLabel, subtypeSuggestions } from '../../lib/genres'
import { fileToPosterDataURL } from '../../lib/image'
import { useScrollLock } from '../../lib/scrollLock'
import { cx } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaInput, MediaItem } from '../../types'
import Poster from '../Poster'
import TagInput from '../TagInput'

const toNum = (v: string) => (v === '' ? undefined : Math.max(0, Math.round(Number(v))))

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

type Draft = Pick<MediaInput, 'title' | 'originalTitle' | 'type' | 'subtype' | 'year' | 'poster' | 'episodesTotal' | 'season' | 'episodeDuration' | 'duration' | 'genres' | 'overview'>

/**
 * Infos d'un titre (titre, type, affiche, épisodes…).
 * Sert à corriger une fiche, ou à créer un titre introuvable en ligne (`item` absent).
 */
export default function EditDetails({
  item,
  initialTitle = '',
  onClose,
  onCreated,
}: {
  item?: MediaItem
  initialTitle?: string
  onClose: () => void
  onCreated?: (item: MediaItem) => void
  onGoToSettings?: () => void
}) {
  const { items, add, update } = useMedia()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)
  const [draft, setDraft] = useState<Draft>(() => ({
    title: item?.title ?? initialTitle,
    originalTitle: item?.originalTitle,
    type: item?.type ?? 'film',
    subtype: item?.subtype,
    year: item?.year,
    poster: item?.poster,
    episodesTotal: item?.episodesTotal,
    season: item?.season,
    episodeDuration: item?.episodeDuration,
    duration: item?.duration,
    genres: item?.genres ?? [],
    overview: item?.overview,
  }))
  const [saving, setSaving] = useState(false)
  const [posterError, setPosterError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const typeInfo = TYPE_BY_VALUE[draft.type]
  const genreSuggestions = useMemo(() => [...new Set([...items.flatMap((i) => i.genres.map(genreLabel)), ...defaultGenres()])], [items])

  const pickImage = async (file?: File) => {
    if (!file) return
    setPosterError(undefined)
    try {
      set('poster', await fileToPosterDataURL(file))
    } catch (e) {
      setPosterError((e as Error).message)
    }
  }

  const submit = async () => {
    if (!draft.title.trim() || saving) return
    setSaving(true)
    const clean: Draft = {
      ...draft,
      title: draft.title.trim(),
      originalTitle: draft.originalTitle?.trim() || undefined,
      subtype: draft.type === 'autre' && draft.subtype?.trim() ? canonicalSubtype(draft.subtype) : undefined,
      overview: draft.overview?.trim() || undefined,
      poster: draft.poster || undefined,
    }
    try {
      if (item) {
        const patch: Partial<MediaInput> = { ...clean }
        if (clean.episodesTotal && item.episodesWatched > clean.episodesTotal) patch.episodesWatched = clean.episodesTotal
        await update(item.id, patch)
        onClose()
      } else {
        const created = await add({ ...clean, status: 'a_voir', criteria: {}, episodesWatched: 0 })
        onCreated?.(created)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet sheet-in z-[60]" role="dialog" aria-modal="true" aria-label={t('hero.edit')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{item ? t('hero.edit') : t('title.manualTitle')}</h2>
          <button onClick={submit} disabled={!draft.title.trim() || saving} className="btn btn-light px-4 py-2 text-sm">
            {item ? t('common.save') : t('common.add')}
          </button>
        </div>
      </header>

      <form
        className="sheet-scroll"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="mx-auto max-w-2xl space-y-7 px-4 pt-6 pb-[calc(10rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-4">
            <div className="w-28 shrink-0">
              <button type="button" onClick={() => fileRef.current?.click()} className="relative block w-full" aria-label={t('form.pickPoster')}>
                <Poster src={draft.poster} title={draft.title || '?'} />
                <span className="absolute bottom-2 end-2 grid size-8 place-items-center rounded-full bg-bg/85 text-ink">
                  <ImagePlus size={15} />
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
              {draft.poster && (
                <button type="button" onClick={() => set('poster', undefined)} className="mt-2 w-full text-xs text-ink-3">
                  {t('form.removeImage')}
                </button>
              )}
              {posterError && <p className="mt-2 text-xs text-accent">{posterError}</p>}
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <Field label={t('form.title')}>
                <input className="field" value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={t('form.titlePh')} required autoFocus={!item} />
              </Field>
              <Field label={t('form.originalTitle')}>
                <input className="field" value={draft.originalTitle ?? ''} onChange={(e) => set('originalTitle', e.target.value)} placeholder={t('form.originalTitlePh')} />
              </Field>
            </div>
          </div>

          <div>
            <span className="label">{t('form.type')}</span>
            <div className="flex flex-wrap gap-2">
              {MEDIA_TYPES.map((mt) => (
                <button key={mt.value} type="button" onClick={() => set('type', mt.value)} className={cx('chip', draft.type === mt.value && 'chip-on')}>
                  {mt.label}
                </button>
              ))}
            </div>
            {draft.type === 'autre' && (
              <Field label={t('form.subtype')} className="mt-4">
                <input className="field" list="subtypes" value={draft.subtype ? subtypeLabel(draft.subtype) : ''} onChange={(e) => set('subtype', e.target.value)} placeholder={t('form.subtypePh')} />
                <datalist id="subtypes">
                  {subtypeSuggestions().map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('form.year')}>
              <input className="field" type="number" inputMode="numeric" value={draft.year ?? ''} onChange={(e) => set('year', toNum(e.target.value))} placeholder="2024" />
            </Field>
            {typeInfo.episodic ? (
              <>
                <Field label={t('form.total')} className="col-span-2">
                  <input className="field" type="number" inputMode="numeric" min={0} value={draft.episodesTotal ?? ''} onChange={(e) => set('episodesTotal', toNum(e.target.value))} placeholder="?" />
                </Field>
              </>
            ) : (
              <Field label={t('form.durationMin')} className="col-span-2">
                <input className="field" type="number" inputMode="numeric" min={0} value={draft.duration ?? ''} onChange={(e) => set('duration', toNum(e.target.value))} placeholder={String(DEFAULT_FILM_MINUTES)} />
              </Field>
            )}
          </div>
          {typeInfo.episodic && (
            <Field label={t('form.season')} className="w-1/3">
              <input className="field" type="number" inputMode="numeric" min={0} value={draft.season ?? ''} onChange={(e) => set('season', toNum(e.target.value))} placeholder="1" />
            </Field>
          )}

          <div>
            <span className="label">{t('form.genres')}</span>
            <TagInput value={draft.genres} onChange={(g) => set('genres', g)} suggestions={genreSuggestions} placeholder={t('form.genresPh')} display={genreLabel} normalize={canonicalGenre} />
          </div>

          <Field label={t('form.synopsis')}>
            <textarea className="field min-h-28 resize-y" value={draft.overview ?? ''} onChange={(e) => set('overview', e.target.value)} />
          </Field>
        </div>
      </form>
    </div>
  )
}
