import { locale, t } from '../i18n'
import { Check, ChevronDown, Heart, ImagePlus, Loader2, Minus, Plus, Share2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CRITERIA, DEFAULT_FILM_MINUTES, MEDIA_TYPES, platformSuggestions as defaultPlatforms, STATUSES, TYPE_BY_VALUE } from '../lib/constants'
import { canonicalGenre, canonicalSubtype, genreLabel, genreSuggestions as defaultGenres, subtypeLabel, subtypeSuggestions } from '../lib/genres'
import { fileToPosterDataURL } from '../lib/image'
import { getTmdbCredits, getTmdbSeasons } from '../lib/catalogApi'
import { episodesBeforeSeason, seasonPosition } from '../lib/franchise'
import { renderItemCard, slug } from '../lib/shareCard'
import { useScrollLock } from '../lib/scrollLock'
import { cx, formatRating, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput, MediaItem, RatingScale, WatchStatus } from '../types'
import { StatusDot } from './Badges'
import ConfirmDialog from './ConfirmDialog'
import SharePreview from './SharePreview'
import DatabaseSearch from './DatabaseSearch'
import { NewListForm } from './ListsView'
import Poster from './Poster'
import { RatingInput } from './Rating'
import TagInput from './TagInput'

const EMPTY: MediaInput = {
  title: '',
  type: 'film',
  status: 'a_voir',
  criteria: {},
  episodesWatched: 0,
  genres: [],
}

/** Champs « catalogue » qu'une recherche TMDB/AniList peut remplir. Le reste (statut, note, avis…) n'est jamais touché. */
const METADATA_KEYS = [
  'title',
  'originalTitle',
  'type',
  'subtype',
  'year',
  'overview',
  'duration',
  'episodesTotal',
  'seasons',
  'episodeDuration',
  'poster',
  'externalId',
  'countries',
  'publicRating',
] as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title && <h3 className="eyebrow text-ink-2">{title}</h3>}
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

/** input number → nombre ou undefined si vide */
const toNum = (v: string) => (v === '' ? undefined : Math.max(0, Number(v)))

interface Props {
  item?: MediaItem
  onClose: () => void
  onGoToSettings?: () => void
  /** Ouvre une autre fiche (titre déjà dans la bibliothèque) */
  onOpenItem?: (item: MediaItem) => void
}

/** Choix de la saison : « S2 » = la saison 1 est vue, on commence la 2. */
function SeasonPicker({ seasons, watched, season, onChange }: { seasons: number[]; watched: number; season?: number; onChange: (episodesWatched: number, season: number) => void }) {
  const current = seasonPosition({ episodesWatched: watched, seasons, season })!
  return (
    <div>
      <span className="label">{t('form.season')}</span>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {seasons.map((size, k) => {
          const n = k + 1
          const start = episodesBeforeSeason(seasons, n)
          const done = watched >= start + size
          const on = n === current.season
          return (
            <button
              key={n}
              type="button"
              onClick={() => !on && (n < current.season ? onChange(start + size, n) : onChange(start, n))}
              className={cx('chip shrink-0', on && 'chip-on')}
              aria-pressed={on}
              title={t('form.seasonEpisodes', { count: size })}
            >
              {done && !on && <Check size={13} />}
              S{n}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** « Moi vs le public » : ma note comparée à la moyenne TMDB / AniList. */
function PublicCompare({ mine, pub, scale, source }: { mine?: number; pub: number; scale: RatingScale; source: string }) {
  const gap = mine != null ? mine - pub : undefined
  const show = (v: number) => formatRating(v, scale) + (scale === '5' ? '/5' : '/10')
  const gapText =
    gap == null
      ? undefined
      : Math.abs(gap) < 0.5
        ? t('public.agree')
        : gap > 0
          ? t('public.more', { gap: formatRating(Math.abs(gap), scale) })
          : t('public.less', { gap: formatRating(Math.abs(gap), scale) })
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
      <span className="text-ink-2">
        {t('public.label')} <span className="font-semibold text-ink">{show(pub)}</span> <span className="text-xs text-ink-3">· {source}</span>
      </span>
      {gapText && <span className={cx('text-right text-xs font-semibold', gap! >= 0.5 ? 'text-accent' : 'text-ink-3')}>{gapText}</span>}
    </div>
  )
}

/** Liste des dates de revisionnage (films comme séries). */
function Rewatches({ dates, onChange }: { dates: string[]; onChange: (d: string[]) => void }) {
  const [draft, setDraft] = useState(todayISO())
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || dates.length >= 100) return
    onChange([...dates, draft].sort().reverse())
  }
  return (
    <div className="card p-4">
      {dates.length > 0 ? (
        <ul className="mb-3 divide-y divide-line">
          {dates.map((d, k) => (
            <li key={d + k} className="flex items-center justify-between py-2 text-sm">
              <span className="capitalize">{new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <button type="button" onClick={() => onChange(dates.filter((_, j) => j !== k))} className="grid size-8 place-items-center rounded-full text-ink-3" aria-label={t('form.removeRewatch')}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink-3">{t('form.rewatchHint')}</p>
      )}
      <div className="flex gap-2">
        <input className="field flex-1" type="date" value={draft} max={todayISO()} onChange={(e) => setDraft(e.target.value)} aria-label={t('form.rewatchDate')} />
        <button type="button" onClick={add} className="btn btn-ghost shrink-0">
          <Plus size={16} /> {t('journal.rewatched')}
        </button>
      </div>
    </div>
  )
}

export default function MediaForm({ item, onClose, onGoToSettings, onOpenItem }: Props) {
  const { add, update, remove, items, settings, lists } = useMedia()
  const [form, setForm] = useState<MediaInput>(() => {
    if (!item) return EMPTY
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = item
    return rest
  })
  const [saving, setSaving] = useState(false)
  const [criteriaOpen] = useState(() => Object.keys(item?.criteria ?? {}).length > 0)
  const [showSearch, setShowSearch] = useState(!item)
  const [filledFrom, setFilledFrom] = useState<string>()
  const [posterError, setPosterError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const [showInfo, setShowInfo] = useState(false)
  const typeInfo = TYPE_BY_VALUE[form.type]
  const pos = typeInfo.episodic ? seasonPosition(form) : undefined

  // Bloque le défilement de la page derrière la feuille
  useScrollLock()

  // Série TMDB ajoutée avant le suivi par saison : on récupère le découpage en arrière-plan
  const extId = form.externalId
  useEffect(() => {
    const key = settings.tmdbKey?.trim()
    if (!extId?.startsWith('tmdb:tv:') || form.seasons || !key || !navigator.onLine) return
    let alive = true
    getTmdbSeasons(extId, key)
      .then(({ seasons, total }) => {
        if (!alive || !seasons) return
        setForm((f) => (f.externalId === extId && !f.seasons ? { ...f, seasons, episodesTotal: Math.max(f.episodesTotal ?? 0, total ?? 0) || f.episodesTotal } : f))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extId])

  const set = <K extends keyof MediaInput>(key: K, value: MediaInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Suggestions = listes par défaut + ce que j'ai déjà utilisé
  const genreSuggestions = useMemo(() => [...new Set([...items.flatMap((i) => i.genres.map(genreLabel)), ...defaultGenres()])], [items])
  const platformSuggestions = useMemo(
    () => [...new Set([...items.map((i) => i.platform).filter(Boolean), ...defaultPlatforms()])] as string[],
    [items],
  )

  /** Applique les infos trouvées en ligne sans écraser mon suivi (statut, note, épisodes vus, avis…). */
  const applyMetadata = (data: Partial<MediaInput>) => {
    setForm((f) => {
      const next: MediaInput = { ...f }
      for (const key of METADATA_KEYS) {
        if (data[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = data[key]
      }
      // Découpage par saison : celui de la nouvelle source (ou aucun)
      next.seasons = data.seasons
      if (data.type && data.type !== 'autre') next.subtype = undefined
      if (data.genres?.length) next.genres = [...new Set([...f.genres, ...data.genres])]
      if (data.platform && !f.platform) next.platform = data.platform
      if (next.episodesTotal && next.episodesWatched > next.episodesTotal) next.episodesWatched = next.episodesTotal
      return next
    })
    setFilledFrom(data.externalId?.startsWith('anilist') ? 'AniList' : 'TMDB')
    setShowSearch(false)
  }

  const setStatus = (status: WatchStatus) =>
    setForm((f) => {
      const next = { ...f, status }
      // « À voir » : pas encore regardé, donc pas de dates
      if (status === 'a_voir') {
        next.startDate = undefined
        next.endDate = undefined
      }
      if (status === 'en_cours' && !f.startDate) next.startDate = todayISO()
      if (status === 'termine') {
        if (!f.endDate) next.endDate = todayISO()
        if (f.episodesTotal && TYPE_BY_VALUE[f.type].episodic) next.episodesWatched = f.episodesTotal
      }
      return next
    })

  const changeEpisodes = (delta: number) =>
    setForm((f) => {
      let n = Math.max(0, f.episodesWatched + delta)
      if (f.episodesTotal) n = Math.min(n, f.episodesTotal)
      return { ...f, episodesWatched: n }
    })

  const onPickImage = async (file?: File) => {
    if (!file) return
    setPosterError(undefined)
    try {
      set('poster', await fileToPosterDataURL(file))
    } catch (e) {
      setPosterError((e as Error).message)
    }
  }

  const submit = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    const clean: MediaInput = {
      ...form,
      title: form.title.trim(),
      originalTitle: form.originalTitle?.trim() || undefined,
      subtype: form.type === 'autre' ? (form.subtype?.trim() ? canonicalSubtype(form.subtype) : undefined) : undefined,
      platform: form.platform?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      poster: form.poster?.trim() || undefined,
      overview: form.overview?.trim() || undefined,
    }
    const pos = seasonPosition(clean)
    if (pos) clean.season = pos.season
    try {
      if (item) await update(item.id, clean)
      else await add(clean)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; filename: string }>()
  const shareCard = async () => {
    if (!item) return
    setSharing(true)
    try {
      // Générique (réalisation, production, casting) depuis TMDB si possible
      let credits
      if (settings.tmdbKey && form.externalId?.startsWith('tmdb:') && navigator.onLine) {
        credits = await getTmdbCredits(form.externalId, settings.tmdbKey).catch(() => undefined)
      }
      const blob = await renderItemCard({ ...item, ...form }, settings.ratingScale, credits)
      setPreview({ blob, filename: `azuucine-${slug(form.title)}.png` })
    } finally {
      setSharing(false)
    }
  }
  const onDelete = async () => {
    if (!item) return
    setConfirmDelete(false)
    await remove(item.id)
    onClose()
  }

  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={item ? t('common.edit') : t('common.add')}>
      {/* En-tête */}
      <header className="safe-top border-b border-line bg-bg">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">
            {item ? t('form.editTitle') : t('form.newTitle')}
            <span className="text-accent">{item ? t('form.editAccent') : t('form.newAccent')}</span>
          </h2>
          <button onClick={submit} disabled={!form.title.trim() || saving} className="btn btn-light px-4 py-2 text-sm">
            {t('common.save')}
          </button>
        </div>
      </header>

      <form
        className="flex-1 overflow-y-auto overscroll-contain"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="safe-bottom mx-auto max-w-2xl space-y-9 px-4 py-6 pb-16">
          {/* Recherche en ligne */}
          {showSearch ? (
            <DatabaseSearch
              onPick={applyMetadata}
              initialQuery={item ? form.title : ''}
              currentExternalId={item?.externalId}
              onGoToSettings={onGoToSettings}
              onOpenExisting={!item && onOpenItem ? onOpenItem : undefined}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-line-strong px-4 py-3 text-left text-sm text-ink-2"
            >
              <span>
                {filledFrom ? (
                  <>
                    {t('form.filledFrom')} <span className="text-ink">{filledFrom}</span> — {t('form.canEdit')}
                  </>
                ) : (
                  t('form.fillFromDb')
                )}
              </span>
              <span className="text-accent">→</span>
            </button>
          )}

          {/* Affiche + titres */}
          <div className="flex gap-4">
            <div className="w-28 shrink-0">
              <button type="button" onClick={() => fileRef.current?.click()} className="relative block w-full" aria-label={t('form.pickPoster')}>
                <Poster src={form.poster} title={form.title || '?'} />
                <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-bg/85 text-ink">
                  <ImagePlus size={15} />
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPickImage(e.target.files?.[0])} />
              {form.poster && (
                <button type="button" onClick={() => set('poster', undefined)} className="mt-2 w-full text-xs text-ink-3">
                  {t('form.removeImage')}
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <Field label={t('form.title')}>
                <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('form.titlePh')} required />
              </Field>
              <Field label={t('form.originalTitle')}>
                <input className="field" value={form.originalTitle ?? ''} onChange={(e) => set('originalTitle', e.target.value)} placeholder={t('form.originalTitlePh')} />
              </Field>
            </div>
          </div>
          {form.overview && (
            <details className="-mt-3 text-sm text-ink-2">
              <summary className="eyebrow cursor-pointer select-none">{t('form.synopsis')}</summary>
              <p className="mt-2 whitespace-pre-line leading-relaxed">{form.overview}</p>
            </details>
          )}

          {/* Type */}
          <Section title={t('form.type')}>
            <div className="flex flex-wrap gap-2">
              {MEDIA_TYPES.map((mt) => (
                <button key={mt.value} type="button" onClick={() => set('type', mt.value)} className={cx('chip', form.type === mt.value && 'chip-on')}>
                  {mt.label}
                </button>
              ))}
            </div>
            {form.type === 'autre' && (
              <Field label={t('form.subtype')}>
                <input className="field" list="subtypes" value={form.subtype ? subtypeLabel(form.subtype) : ''} onChange={(e) => set('subtype', e.target.value)} placeholder={t('form.subtypePh')} />
                <datalist id="subtypes">
                  {subtypeSuggestions().map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            )}
          </Section>

          {/* Statut */}
          <Section title={t('form.status')}>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s.value} type="button" onClick={() => setStatus(s.value)} className={cx('chip', form.status === s.value && 'chip-on')}>
                  <StatusDot status={s.value} />
                  {s.label}
                </button>
              ))}
            </div>
          </Section>

          {/* Note */}
          <Section title={t('form.myRating')}>
            <div className="card space-y-4 p-4">
              <RatingInput value={form.rating} onChange={(v) => set('rating', v)} scale={settings.ratingScale} />
              {form.publicRating != null && <PublicCompare mine={form.rating} pub={form.publicRating} scale={settings.ratingScale} source={form.externalId?.startsWith('anilist:') ? 'AniList' : 'TMDB'} />}
              <button type="button" onClick={() => set('favorite', !form.favorite)} className={cx('chip', form.favorite && 'border-accent text-ink')}>
                <Heart size={15} className={form.favorite ? 'fill-accent text-accent' : ''} />
                {t('form.favorite')}
              </button>
              <details className="border-t border-line pt-3" open={criteriaOpen}>
                <summary className="cursor-pointer select-none text-sm text-ink-2">{t('form.criteria')}</summary>
                <div className="mt-4 space-y-4">
                  {CRITERIA.map((c) => (
                    <div key={c.key}>
                      <span className="eyebrow mb-1.5 block">{c.label}</span>
                      <RatingInput
                        size="sm"
                        label={c.label}
                        scale={settings.ratingScale}
                        value={form.criteria[c.key]}
                        onChange={(v) =>
                          setForm((f) => {
                            const criteria = { ...f.criteria }
                            if (v == null) delete criteria[c.key]
                            else criteria[c.key] = v
                            return { ...f, criteria }
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </Section>

          {/* Épisodes / durée */}
          {typeInfo.episodic ? (
            <Section title={t('form.episodes')}>
              <div className="card space-y-5 p-4">
                {pos && form.seasons ? (
                  <SeasonPicker seasons={form.seasons} watched={form.episodesWatched} season={form.season} onChange={(n, season) => setForm((f) => ({ ...f, episodesWatched: n, season }))} />
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink-2">{pos ? t('form.episodesOfSeason', { season: pos.season }) : t('home.episodesSeen')}</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => changeEpisodes(-1)} className="grid size-10 place-items-center rounded-full border border-line-strong text-ink-2" aria-label={t('form.minusEp')}>
                      <Minus size={17} />
                    </button>
                    <span className="min-w-16 text-center text-2xl font-bold tabular-nums">
                      {pos ? pos.episode : form.episodesWatched}
                      {pos ? <span className="text-base text-ink-3">/{pos.size}</span> : form.episodesTotal ? <span className="text-base text-ink-3">/{form.episodesTotal}</span> : null}
                    </span>
                    <button type="button" onClick={() => changeEpisodes(1)} className="grid size-10 place-items-center rounded-full bg-accent-fill text-on-accent" aria-label={t('form.plusEp')}>
                      <Plus size={17} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
                {pos ? (
                  <div className="flex items-end justify-between gap-3">
                    <p className="pb-2 text-xs text-ink-3">{t('form.seasonsTotal', { seasons: form.seasons!.length, count: form.episodesTotal ?? 0 })}</p>
                    <div className="w-28 shrink-0">
                      <Field label={t('form.minPerEp')}>
                        <input className="field" type="number" inputMode="numeric" min={0} value={form.episodeDuration ?? ''} onChange={(e) => set('episodeDuration', toNum(e.target.value))} placeholder={String(typeInfo.episodeMinutes)} />
                      </Field>
                    </div>
                  </div>
                ) : (
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t('form.total')}>
                    <input className="field" type="number" inputMode="numeric" min={0} value={form.episodesTotal ?? ''} onChange={(e) => set('episodesTotal', toNum(e.target.value))} placeholder="?" />
                  </Field>
                  <Field label={t('form.season')}>
                    <input className="field" type="number" inputMode="numeric" min={0} value={form.season ?? ''} onChange={(e) => set('season', toNum(e.target.value))} placeholder="1" />
                  </Field>
                  <Field label={t('form.minPerEp')}>
                    <input className="field" type="number" inputMode="numeric" min={0} value={form.episodeDuration ?? ''} onChange={(e) => set('episodeDuration', toNum(e.target.value))} placeholder={String(typeInfo.episodeMinutes)} />
                  </Field>
                </div>
                )}
              </div>
            </Section>
          ) : (
            <Section title={t('form.duration')}>
              <Field label={t('form.durationMin')}>
                <input className="field" type="number" inputMode="numeric" min={0} value={form.duration ?? ''} onChange={(e) => set('duration', toNum(e.target.value))} placeholder={String(DEFAULT_FILM_MINUTES)} />
              </Field>
            </Section>
          )}

          {/* Infos : repliées par défaut (dates remplies selon le statut, année et genres par la recherche) */}
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-expanded={showInfo}
            className="flex w-full items-center justify-between border-t border-line pt-5 text-left"
          >
            <span>
              <span className="eyebrow block text-ink-2">{t('form.info')}</span>
              <span className="mt-1 block text-xs text-ink-3">{t('form.infoHint')}</span>
            </span>
            <ChevronDown size={18} className={cx('shrink-0 text-ink-3 transition-transform', showInfo && 'rotate-180')} />
          </button>
          {showInfo && (
          <Section title="">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('form.start')}>
                <input className="field" type="date" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || undefined)} />
              </Field>
              <Field label={t('form.end')}>
                <input className="field" type="date" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
              </Field>
              <Field label={t('form.year')}>
                <input className="field" type="number" inputMode="numeric" value={form.year ?? ''} onChange={(e) => set('year', toNum(e.target.value))} placeholder="2024" />
              </Field>
              <Field label={t('form.platform')}>
                <input className="field" list="platforms" value={form.platform ?? ''} onChange={(e) => set('platform', e.target.value)} placeholder="Netflix…" />
                <datalist id="platforms">
                  {platformSuggestions.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
            </div>
            <div>
              <span className="label">{t('form.genres')}</span>
              <TagInput
                value={form.genres}
                onChange={(g) => set('genres', g)}
                suggestions={genreSuggestions}
                placeholder={t('form.genresPh')}
                display={genreLabel}
                normalize={canonicalGenre}
              />
            </div>
          </Section>
          )}

          {(form.status === 'termine' || (form.rewatchDates?.length ?? 0) > 0) && (
            <Section title={t('form.rewatches')}>
              <Rewatches dates={form.rewatchDates ?? []} onChange={(d) => set('rewatchDates', d.length ? d : undefined)} />
            </Section>
          )}

          <Section title={t('lists.myLists')}>
            {lists.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {lists.map((l) => {
                  const on = form.listIds?.includes(l.id)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        set('listIds', on ? form.listIds!.filter((x) => x !== l.id) : [...(form.listIds ?? []), l.id])
                      }
                      className={cx('chip', on && 'chip-on')}
                    >
                      {on && <Check size={14} />}
                      {l.name}
                    </button>
                  )
                })}
              </div>
            )}
            <NewListForm onCreated={(l) => set('listIds', [...(form.listIds ?? []), l.id])} />
          </Section>

          <Section title={t('form.review')}>
            <textarea className="field min-h-32 resize-y" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder={t('form.reviewPh')} />
          </Section>

          <div className="space-y-2 border-t border-line pt-6">
            <button type="submit" disabled={!form.title.trim() || saving} className="btn btn-primary w-full py-3">
              {item ? t('form.saveChanges') : t('form.addToLibrary')} <span aria-hidden>→</span>
            </button>
            {item && (
              <button type="button" onClick={shareCard} disabled={sharing} className="btn btn-ghost w-full">
                {sharing ? <Loader2 size={17} className="animate-spin" /> : <Share2 size={17} />} {t('form.shareImage')}
              </button>
            )}
            {item && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="btn w-full text-ink-3">
                <Trash2 size={17} /> {t('form.delete')}
              </button>
            )}
          </div>
        </div>
      </form>

      {preview && <SharePreview blob={preview.blob} filename={preview.filename} title={form.title} onClose={() => setPreview(undefined)} />}

      <ConfirmDialog
        open={confirmDelete}
        title={t('confirm.title')}
        message={item ? t('form.deleteConfirm', { title: item.title }) : undefined}
        confirmLabel={t('common.delete')}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
