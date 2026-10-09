import { locale, t } from '../../i18n'
import { Bookmark, Check, ChevronDown, Eye, Heart, Loader2, MessagesSquare, Minus, MoreHorizontal, Pencil, Play, Plus, Share2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getTitleExtras, getTmdbCredits, getTmdbDetails, getTmdbExtras, type SearchResult, type TitleExtras } from '../../lib/catalogApi'
import { CRITERIA, STATUS_BY_VALUE, TYPE_BY_VALUE } from '../../lib/constants'
import { genreLabel } from '../../lib/genres'
import { remotePosterToLocal } from '../../lib/image'
import { airedCount, nextAirDate, useAiringCache } from '../../lib/airing'
import { useBackToClose } from '../../lib/backNav'
import { useEscape } from '../../lib/escape'
import { episodeCap, seasonPosition } from '../../lib/franchise'
import { episodesPatch } from '../../lib/progress'
import { useScrollLock } from '../../lib/scrollLock'
import { backdropSrcSet, tmdbSized } from '../../lib/tmdbImage'
import { renderItemCard, slug } from '../../lib/shareCard'
import { cx, formatDate, formatDuration, formatRating, todayISO } from '../../lib/utils'
import { useMedia } from '../../store'
import { allTags, cleanTag } from '../../lib/bulk'
import { useLibraryActions } from '../library/useLibraryActions'
import TagInput from '../TagInput'
import type { MediaInput, MediaItem, RatingScale, WatchStatus } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import EpisodeList from '../EpisodeList'
import { useSocial } from '../social/SocialProvider'
import { NewListForm } from '../ListsView'
import Poster from '../Poster'
import { RatingInput } from '../Rating'
import SharePreview from '../SharePreview'
import EditDetails from './EditDetails'
import ReviewEditor from './ReviewEditor'
import WhereToWatch from './WhereToWatch'

/** Suivi « vide » d'un titre qu'on ajoute. */
const BLANK: Pick<MediaInput, 'criteria' | 'episodesWatched' | 'genres'> = { criteria: {}, episodesWatched: 0, genres: [] }

interface Props {
  /** Titre déjà dans ma bibliothèque */
  item?: MediaItem
  /** Titre trouvé en ligne (pas encore ajouté) */
  seed?: SearchResult
  onClose: () => void
  onGoToSettings?: () => void
}

/**
 * Fiche d'un titre, façon Letterboxd : tout se fait ici, et chaque geste est enregistré tout de suite.
 * Vu / En cours / À voir, note, coup de cœur, avis, épisodes, casting et note moyenne du public.
 */
export default function TitleSheet({ item: initial, seed, onClose, onGoToSettings }: Props) {
  const { items, settings, add, update, lists, patchMany } = useMedia()
  const actions = useLibraryActions()
  const social = useSocial()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)

  // La fiche suit la version à jour de la bibliothèque (ou celle créée depuis cette fiche)
  const [itemId, setItemId] = useState<string | undefined>(() => initial?.id ?? (seed && items.find((i) => i.externalId === seed.externalId)?.id))
  const item = useMemo(() => (itemId ? items.find((i) => i.id === itemId) : undefined), [items, itemId])

  // Infos du catalogue pour un titre pas encore ajouté
  const [meta, setMeta] = useState<Partial<MediaInput> | undefined>(() => (seed?.source === 'anilist' ? { ...seed.prefill } : undefined))
  const [metaError, setMetaError] = useState<string>()
  useEffect(() => {
    if (!seed || seed.source !== 'tmdb' || item) return
    let alive = true
    getTmdbDetails(seed, settings.tmdbKey ?? '')
      .then((d) => alive && setMeta(d))
      .catch((e: Error) => alive && setMetaError(navigator.onLine ? e.message : t('search.offline')))
    return () => {
      alive = false
    }
  }, [seed, item, settings.tmdbKey])

  const data: Partial<MediaInput> = item ?? { ...meta, title: meta?.title ?? seed?.title, year: meta?.year ?? seed?.year, type: meta?.type ?? seed?.typeGuess }
  const title = data.title ?? seed?.title ?? '?'
  const type = data.type ?? 'film'
  const episodic = TYPE_BY_VALUE[type].episodic
  const externalId = item?.externalId ?? seed?.externalId
  const poster = item?.poster ?? seed?.posterUrl
  const backdrop = item?.backdrop ?? data.backdrop

  // Note moyenne, casting… (en ligne)
  const [extras, setExtras] = useState<TitleExtras>()
  useEffect(() => {
    if (!externalId || !navigator.onLine) return
    let alive = true
    getTitleExtras(externalId, settings.tmdbKey)
      .then((x) => alive && setExtras(x))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [externalId, settings.tmdbKey])

  // Fiche TMDB ajoutée avant le suivi par saison : grande image et saisons récupérées en arrière-plan (et gardées)
  useEffect(() => {
    const key = settings.tmdbKey?.trim()
    if (!item || !item.externalId?.startsWith('tmdb:') || !key || !navigator.onLine) return
    const isTv = item.externalId.startsWith('tmdb:tv:')
    if (item.backdrop && (!isTv || item.seasons)) return
    let alive = true
    getTmdbExtras(item.externalId, key)
      .then(({ seasons, total, backdrop: bd }) => {
        if (!alive) return
        const patch: Partial<MediaInput> = {}
        if (bd && !item.backdrop) patch.backdrop = bd
        if (seasons && !item.seasons) {
          patch.seasons = seasons
          if ((total ?? 0) > (item.episodesTotal ?? 0)) patch.episodesTotal = total
        }
        // Mise à jour d'arrière-plan : ne change pas la date de modification de la fiche (ni l'ordre « récent »)
        if (Object.keys(patch).length) void patchMany([{ id: item.id, patch }])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  // Garde la note du public de la fiche à jour (utilisée par les stats « Moi vs le public »)
  useEffect(() => {
    if (item && extras?.average != null && Math.abs((item.publicRating ?? 0) - extras.average) >= 0.1) void patchMany([{ id: item.id, patch: { publicRating: extras.average } }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extras?.average, item?.id])

  const [busy, setBusy] = useState(false)
  const addingRef = useRef(false)
  const pendingRef = useRef<Partial<MediaInput>>({})
  const [toast, setToast] = useState<string>()
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(undefined), 2200)
    return () => clearTimeout(id)
  }, [toast])

  /** Applique un changement ; ajoute d'abord le titre à la bibliothèque s'il n'y est pas encore. */
  const save = async (patch: Partial<MediaInput>) => {
    if (item) return update(item.id, patch)
    if (!seed) return
    // Ajout déjà en cours (affiche qui se télécharge…) : le geste est gardé et appliqué juste après
    if (addingRef.current) {
      Object.assign(pendingRef.current, patch)
      return
    }
    addingRef.current = true
    setBusy(true)
    try {
      const base: Partial<MediaInput> = { ...(seed.source === 'tmdb' ? meta : seed.prefill) }
      if (seed.source === 'tmdb' && !meta) Object.assign(base, await getTmdbDetails(seed, settings.tmdbKey ?? ''))
      // TMDB autorise la copie locale de l'affiche (visible hors-ligne) ; AniList non, on garde l'adresse.
      if (seed.posterUrl) base.poster = seed.source === 'tmdb' ? await remotePosterToLocal(seed.posterUrl).catch(() => seed.posterUrl) : seed.posterUrl
      if (extras?.average != null) base.publicRating = extras.average
      const created = await add({
        ...BLANK,
        status: 'a_voir',
        ...base,
        title: base.title ?? seed.title,
        type: base.type ?? seed.typeGuess,
        genres: base.genres ?? [],
        ...patch,
      } as MediaInput)
      setItemId(created.id)
      setToast(t('title.added'))
      const pending = pendingRef.current
      pendingRef.current = {}
      if (Object.keys(pending).length) await update(created.id, pending)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      addingRef.current = false
      setBusy(false)
    }
  }

  const status = item?.status
  const setStatus = (s: WatchStatus) => {
    if (s === status) return
    const patch: Partial<MediaInput> = { status: s }
    const today = todayISO()
    if (s === 'a_voir') Object.assign(patch, { startDate: undefined, endDate: undefined })
    // Série : la date de début est celle du premier épisode coché
    if (s === 'en_cours') Object.assign(patch, { startDate: episodic && !item?.episodesWatched ? item?.startDate : (item?.startDate ?? today), endDate: undefined })
    if (s === 'termine') {
      patch.endDate = item?.status === 'termine' && item.endDate ? item.endDate : today
      if (!item?.startDate) patch.startDate = episodic && item?.episodesWatched ? today : patch.endDate
      const cap = episodeCap(item ?? { episodesTotal: data.episodesTotal, seasons: data.seasons })
      if (episodic && cap) patch.episodesWatched = cap
    }
    // Changement de statut d'un titre déjà suivi : « Annuler » remet la fiche telle quelle (dates, épisodes…)
    const before = item
    void save(patch).then(() => {
      if (before) actions.offerUndo(t('toast.status', { title: before.title, status: STATUS_BY_VALUE[s].label }), [before])
    })
  }

  /**
   * Noter un titre pas encore vu le marque comme vu (comme sur Letterboxd),
   * et la date de visionnage devient le jour où l'on note (si elle n'est pas déjà connue).
   */
  const rate = (rating: number | undefined) => {
    const patch: Partial<MediaInput> = { rating }
    if (rating != null) {
      const today = todayISO()
      if (!item || item.status === 'a_voir') {
        patch.status = 'termine'
        const cap = episodeCap(item ?? { episodesTotal: data.episodesTotal, seasons: data.seasons })
        if (episodic && cap) patch.episodesWatched = cap
      }
      // Date de fin seulement pour un titre terminé (noter une série en cours ne la termine pas)
      const finished = (patch.status ?? item?.status) === 'termine'
      if (finished && !item?.endDate) patch.endDate = today
      if (finished && !item?.startDate) patch.startDate = today
    }
    void save(patch)
  }

  /** Nouveaux épisodes vus : le statut et les dates suivent (comme la liste d'épisodes). */
  const setEpisodes = (n: number, season?: number) => {
    if (!item) return
    void update(item.id, episodesPatch(item, n, season))
  }

  // Épisodes déjà sortis (fiche suivie) : on ne coche pas un épisode à venir
  const airingCache = useAiringCache()
  const airingRef = item ? { id: item.id, type: item.type, externalId: item.externalId } : undefined
  const aired = airingRef ? airedCount(airingRef, airingCache) : undefined
  /** Bouton principal des épisodes : « J'ai vu S2 · É3 », « À jour », « Tout vu »… */
  const nextEpisode = (() => {
    if (!item || !episodic) return undefined
    const cap = episodeCap(item)
    if (cap && item.episodesWatched >= cap) return { label: t('hero.allSeen'), done: true }
    if (aired != null && item.episodesWatched >= aired) {
      const date = airingRef ? nextAirDate(airingRef, airingCache) : undefined
      return { label: date ? t('hero.nextOn', { date: formatDate(date) }) : t('hero.upToDate'), done: true }
    }
    const pos = seasonPosition({ ...item, episodesWatched: item.episodesWatched + 1, season: undefined })
    const ep = t('episodes.short', { n: pos ? pos.episode : item.episodesWatched + 1 })
    return { label: t('hero.seenEp', { ep: pos ? `${t('episodes.seasonShort', { n: pos.season })} · ${ep}` : ep }), done: false }
  })()
  const hasEpisodeList = !!item && (!!item.seasons || (!!item.externalId && !!item.episodesTotal))

  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; filename: string }>()
  const [sharing, setSharing] = useState(false)

  const shareCard = async () => {
    if (!item) return
    setSharing(true)
    try {
      let credits
      if (settings.tmdbKey && item.externalId?.startsWith('tmdb:') && navigator.onLine) {
        credits = await getTmdbCredits(item.externalId, settings.tmdbKey).catch(() => undefined)
      }
      const blob = await renderItemCard(item, settings.ratingScale, credits)
      setPreview({ blob, filename: `azuucine-${slug(item.title)}.png` })
    } finally {
      setSharing(false)
    }
  }

  const onDelete = () => {
    if (!item) return
    setConfirmDelete(false)
    // Le message « Supprimé · Annuler » reste affiché après la fermeture de la fiche
    void actions.deleteItems([item.id])
    onClose()
  }

  /** Suivi modifié ; retirer le titre d'une liste propose « Annuler ». */
  const changeTracking = (patch: Partial<MediaInput>) => {
    if (!item) return
    const before = item
    const removed = patch.listIds ? (before.listIds ?? []).filter((id) => !patch.listIds!.includes(id)) : []
    void update(before.id, patch).then(() => {
      const list = removed.length === 1 ? lists.find((l) => l.id === removed[0]) : undefined
      if (list) actions.offerUndo(t('toast.removedFromList', { title: before.title, list: list.name }), [before])
    })
  }

  const heroImage = backdrop ?? extras?.backdrop
  const average = extras?.average ?? data.publicRating
  const source = externalId?.startsWith('anilist:') ? 'AniList' : externalId ? 'TMDB' : undefined
  const runtime = type === 'film' ? (data.duration ?? extras?.runtime) : undefined
  const metaLine = [
    data.year,
    data.subtype ? data.subtype : TYPE_BY_VALUE[type].label,
    runtime ? formatDuration(runtime) : undefined,
    episodic && data.episodesTotal ? t('title.eps', { count: data.episodesTotal }) : undefined,
    episodic && extras?.seasons && extras.seasons > 1 ? t('title.seasons', { count: extras.seasons }) : undefined,
  ].filter(Boolean)

  return (
    <div className="sheet sheet-in" role="dialog" aria-modal="true" aria-label={title}>
      <header className="safe-top border-b border-line bg-bg">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5 lg:max-w-none lg:px-8">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</h2>
          {item ? (
            <button onClick={() => setMoreOpen(true)} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('title.more')}>
              <MoreHorizontal size={22} />
            </button>
          ) : (
            <span className="size-10" />
          )}
        </div>
      </header>

      <div className="sheet-scroll">
        {/* Grande marge en bas : rien ne reste caché sous une barre des tâches ou la barre d'accueil du téléphone */}
        <div className="mx-auto max-w-2xl pb-[calc(10rem+env(safe-area-inset-bottom))] lg:max-w-none">
          {/* Image de scène en grand (nette sur tous les écrans), qui se fond dans le fond, avec l'affiche et le titre posés dessus */}
          {heroImage ? (
            <img
              src={tmdbSized(heroImage, 'w1280')}
              srcSet={backdropSrcSet(heroImage)}
              sizes="100vw"
              alt=""
              className="hero-fade h-[42vh] min-h-56 w-full object-cover object-[center_25%] lg:h-[72vh] lg:max-h-[48rem]"
            />
          ) : (
            <div className="h-6" />
          )}
          <div className={cx('relative flex items-end gap-4 px-4 lg:gap-8 lg:px-10', heroImage && '-mt-28 lg:-mt-64')}>
            <div className="w-28 shrink-0 lg:w-52">
              <Poster src={poster} title={title} />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-2xl leading-tight lg:text-5xl lg:leading-[1.05]">{title}</h1>
              {data.originalTitle && <p className="mt-1 truncate text-sm text-ink-2 lg:text-base">{data.originalTitle}</p>}
              {metaLine.length > 0 && <p className="mt-2 text-xs uppercase tracking-wide text-ink-2 lg:text-sm">{metaLine.join(' · ')}</p>}
              {extras && extras.directors.length > 0 && (
                <p className="mt-2 text-sm text-ink-2 lg:text-base">
                  {extras.directorKind === 'director' ? t('title.directedBy') : t('title.createdBy')} <span className="font-medium text-ink">{extras.directors.join(', ')}</span>
                </p>
              )}
              {status && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-2">
                  <Check size={13} className="text-accent" /> {t('title.inLibrary')} · {STATUS_BY_VALUE[status].label}
                </p>
              )}
              {/* Mes tags perso : discrets, visibles par moi seul */}
              {item?.tags && item.tags.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('tags.label')}>
                  {item.tags.map((tag) => (
                    <li key={tag} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                      #{tag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {metaError && !item && <p className="mx-4 mt-4 text-sm text-accent">{metaError}</p>}

          {/* Téléphone : une colonne. Ordinateur : deux colonnes (infos à gauche, mes actions et épisodes à droite). */}
          <div className="flex flex-col lg:mt-8 lg:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] xl:grid-cols-[minmax(0,1fr)_32rem] lg:items-start lg:gap-6">
          <div className="order-1 lg:col-start-2 lg:row-start-1">
          {/* Note moyenne du public */}
          {source && <PublicRating average={average} votes={extras?.votes} distribution={extras?.distribution} scale={settings.ratingScale} source={source} mine={item?.rating} />}

          {/* Mes actions */}
          <section className="card mx-4 mt-4 p-4">
            <div className="grid grid-cols-3 gap-2">
              <StatusButton icon={<Eye size={22} />} label={t('hero.seen')} on={status === 'termine'} onClick={() => setStatus('termine')} disabled={busy} />
              {episodic ? (
                <StatusButton icon={<Play size={22} />} label={t('status.en_cours')} on={status === 'en_cours'} onClick={() => setStatus('en_cours')} disabled={busy} />
              ) : (
                <StatusButton
                  icon={<Heart size={22} className={item?.favorite ? 'fill-current' : ''} />}
                  label={t('form.favorite')}
                  on={!!item?.favorite}
                  onClick={() => void save({ favorite: !item?.favorite || undefined, ...(item ? {} : { status: 'termine', endDate: todayISO() }) })}
                  disabled={busy}
                />
              )}
              <StatusButton icon={<Bookmark size={22} />} label={t('status.a_voir')} on={status === 'a_voir'} onClick={() => setStatus('a_voir')} disabled={busy} />
            </div>
            {item && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(['pause', 'abandonne'] as const).map((s) => (
                  <button key={s} onClick={() => setStatus(s)} className={cx('chip py-1 text-xs', status === s && 'chip-on')}>
                    {STATUS_BY_VALUE[s].label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow">{t('title.yourRating')}</span>
                {episodic && (
                  <button
                    onClick={() => void save({ favorite: !item?.favorite || undefined })}
                    className={cx('flex items-center gap-1.5 text-xs font-medium', item?.favorite ? 'text-accent' : 'text-ink-3')}
                    aria-pressed={!!item?.favorite}
                  >
                    <Heart size={15} className={item?.favorite ? 'fill-accent' : ''} /> {t('form.favorite')}
                  </button>
                )}
              </div>
              <RatingInput value={item?.rating} onChange={rate} scale={settings.ratingScale} />
              {item?.rating != null && <Criteria item={item} scale={settings.ratingScale} onChange={(criteria) => void update(item.id, { criteria })} />}
            </div>
            {busy && (
              <p className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                <Loader2 size={13} className="animate-spin" /> {t('title.adding')}
              </p>
            )}
          </section>

          {/* Épisodes */}
          {item && episodic && (
            <section className="mx-4 mt-4">
              {nextEpisode && (
                <button
                  onClick={nextEpisode.done ? undefined : () => setEpisodes(item.episodesWatched + 1)}
                  disabled={nextEpisode.done}
                  className={cx('btn mb-3 w-full py-3', nextEpisode.done ? 'btn-ghost' : 'btn-primary')}
                >
                  {nextEpisode.done && <Check size={17} />}
                  {nextEpisode.label}
                </button>
              )}
              {hasEpisodeList ? (
                <EpisodeList form={item} aired={aired} onChange={setEpisodes} />
              ) : (
                <div className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="eyebrow">{t('home.episodesSeen')}</span>
                      <p className="mt-1 text-2xl font-bold tabular-nums">
                        {item.episodesWatched}
                        {episodeCap(item) ? <span className="text-base font-normal text-ink-3"> / {episodeCap(item)}</span> : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEpisodes(item.episodesWatched - 1)} className="grid size-11 place-items-center rounded-full border border-line-strong text-ink-2" aria-label={t('form.minusEp')}>
                        <Minus size={18} />
                      </button>
                      <button onClick={() => setEpisodes(item.episodesWatched + 1)} className="grid size-11 place-items-center rounded-full bg-accent-fill text-on-accent" aria-label={t('form.plusEp')}>
                        <Plus size={18} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                  {episodeCap(item) ? (
                    <div className="mt-3 h-1 rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (item.episodesWatched / episodeCap(item)!) * 100)}%` }} />
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          )}

          </div>

          <div className="order-2 min-w-0 lg:col-start-1 lg:row-start-1">
          {/* Mon avis */}
          <section className="mx-4 mt-4">
            {item?.notes ? (
              <button onClick={() => setReviewing(true)} className="card block w-full p-4 text-left">
                <span className="eyebrow flex items-center justify-between">
                  {t('form.review')} <Pencil size={13} />
                </span>
                <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-ink">{item.notes}</p>
              </button>
            ) : (
              <button onClick={() => setReviewing(true)} disabled={busy} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 text-left text-sm text-ink-2">
                <Pencil size={16} className="text-accent" /> {t('title.writeReview')}
              </button>
            )}
          </section>

          {externalId && social.enabled && (
            <button onClick={() => social.openReviews(externalId, title)} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-2 active:bg-surface-2">
              <MessagesSquare size={16} /> {t('reviews.seeAll')}
            </button>
          )}

          {/* Synopsis et genres */}
          {(extras?.tagline || data.overview || (data.genres?.length ?? 0) > 0) && (
            <section className="mx-4 mt-8">
              {extras?.tagline && <p className="mb-2 text-sm italic text-ink-2">{extras.tagline}</p>}
              {data.overview && <Synopsis text={data.overview} />}
              {(data.genres?.length ?? 0) > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.genres!.map((g) => (
                    <span key={g} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">
                      {genreLabel(g)}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Où regarder (plateformes de streaming) */}
          <WhereToWatch extras={extras} />

          {/* Casting */}
          {extras && extras.cast.length > 0 && (
            <section className="mt-8">
              <h3 className="eyebrow mx-4 mb-3 text-ink-2">{t('title.cast')}</h3>
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
                {extras.cast.map((c, k) => (
                  <div key={c.name + k} className="w-[5.5rem] shrink-0 text-center">
                    {c.photo ? (
                      <img src={c.photo} alt="" loading="lazy" className="mx-auto size-20 rounded-full border border-line bg-surface-2 object-cover" />
                    ) : (
                      <span className="mx-auto grid size-20 place-items-center rounded-full border border-line bg-surface-2 text-lg font-semibold text-ink-3">{c.name.charAt(0)}</span>
                    )}
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{c.name}</p>
                    {(c.role || c.voice) && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3">{c.role ?? t('title.voice', { name: c.voice! })}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Mon suivi : dates, plateforme, listes, revisionnages */}
          {item && <Tracking item={item} lists={lists} tagSuggestions={allTags(items)} onChange={changeTracking} />}
          </div>
          </div>
        </div>
      </div>

      {toast && (
        <div role="status" className="safe-bottom pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
          <span className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg">{toast}</span>
        </div>
      )}

      {moreOpen && item && (
        <MoreMenu onClose={() => setMoreOpen(false)}>
          <MenuButton icon={<Pencil size={18} />} onClick={() => (setMoreOpen(false), setEditing(true))}>
            {t('hero.edit')}
          </MenuButton>
          <MenuButton icon={sharing ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />} onClick={() => (setMoreOpen(false), void shareCard())}>
            {t('form.shareImage')}
          </MenuButton>
          <MenuButton icon={<Trash2 size={18} />} onClick={() => (setMoreOpen(false), setConfirmDelete(true))} danger>
            {t('form.delete')}
          </MenuButton>
        </MoreMenu>
      )}

      {reviewing && (
        <ReviewEditor
          title={title}
          initial={item?.notes ?? ''}
          onClose={() => setReviewing(false)}
          onSave={async (notes) => {
            setReviewing(false)
            // Écrire un avis sur un titre pas encore ajouté le marque comme vu
            await save({ notes: notes || undefined, ...(item ? {} : { status: 'termine' as const, endDate: todayISO() }) })
          }}
        />
      )}
      {editing && item && <EditDetails item={item} onClose={() => setEditing(false)} onGoToSettings={onGoToSettings} />}
      {preview && <SharePreview blob={preview.blob} filename={preview.filename} title={title} onClose={() => setPreview(undefined)} />}
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

function StatusButton({ icon, label, on, onClick, disabled }: { icon: ReactNode; label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cx(
        'flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors active:scale-[0.97] disabled:opacity-50',
        on ? 'border-accent bg-accent-fill text-on-accent' : 'border-line text-ink-2',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Menu « ⋯ » : se ferme avec Échap ou le geste retour, sans fermer la fiche derrière. */
function MoreMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  useBackToClose(onClose)
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div role="menu" className="safe-bottom w-full max-w-md rounded-t-3xl border border-line-strong bg-surface p-3 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function MenuButton({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] active:bg-surface-2', danger ? 'text-accent' : 'text-ink')}>
      {icon}
      {children}
    </button>
  )
}

/** Note moyenne du public, avec la répartition des votes quand la base la donne (AniList). */
function PublicRating({
  average,
  votes,
  distribution,
  scale,
  source,
  mine,
}: {
  average?: number
  votes?: number
  distribution?: { score: number; amount: number }[]
  scale: RatingScale
  source: string
  mine?: number
}) {
  const max = Math.max(1, ...(distribution ?? []).map((d) => d.amount))
  const compact = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 })
  return (
    <section className="mx-4 mt-6 flex items-end justify-between gap-4 border-b border-line pb-4">
      <div className="shrink-0">
        <span className="eyebrow">{t('title.average')}</span>
        {average != null ? (
          <>
            <p className="mt-1 text-4xl font-bold leading-none tabular-nums">
              {formatRating(average, scale)}
              <span className="text-base font-normal text-ink-3">/{scale}</span>
            </p>
            <p className="mt-1.5 text-xs text-ink-3">
              {votes ? `${t('title.votes', { count: votes, n: compact.format(votes) })} · ` : ''}
              {source}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-3">{t('title.noAverage')}</p>
        )}
        {mine != null && average != null && (
          <p className="mt-1 text-xs text-ink-2">
            {t('title.yourRating')} <span className="font-semibold text-ink">{formatRating(mine, scale)}</span>
          </p>
        )}
      </div>
      {distribution && distribution.length > 0 && (
        <div className="flex h-16 max-w-48 flex-1 items-end gap-[3px]" role="img" aria-label={t('title.distribution')}>
          {Array.from({ length: 10 }, (_, k) => {
            const amount = distribution.find((d) => d.score === k + 1)?.amount ?? 0
            return <span key={k} className="flex-1 rounded-t-sm bg-ink-3" style={{ height: `${Math.max(4, (amount / max) * 100)}%`, opacity: amount ? 1 : 0.3 }} />
          })}
        </div>
      )}
    </section>
  )
}

function Criteria({ item, scale, onChange }: { item: MediaItem; scale: RatingScale; onChange: (c: MediaItem['criteria']) => void }) {
  const [open, setOpen] = useState(() => Object.keys(item.criteria).length > 0)
  return (
    <div className="mt-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs text-ink-3" aria-expanded={open}>
        {t('title.detailRating')} <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {CRITERIA.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-2">{c.label}</span>
              <RatingInput
                size="sm"
                label={c.label}
                scale={scale}
                value={item.criteria[c.key]}
                onChange={(v) => {
                  const next = { ...item.criteria }
                  if (v == null) delete next[c.key]
                  else next[c.key] = v
                  onChange(next)
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Synopsis({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 320
  return (
    <div>
      <p className={cx('whitespace-pre-line text-sm leading-relaxed text-ink-2', long && !open && 'line-clamp-5')}>{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-medium text-ink">
          {open ? t('hero.less') : t('hero.more')}
        </button>
      )}
    </div>
  )
}

/** Dates, plateforme, listes et revisionnages : enregistrés dès qu'on les change. */
function Tracking({ item, lists, tagSuggestions, onChange }: { item: MediaItem; lists: { id: string; name: string }[]; tagSuggestions: string[]; onChange: (p: Partial<MediaInput>) => void }) {
  const [open, setOpen] = useState(false)
  // Plus récent en premier (la sauvegarde les range dans l'autre sens)
  const rewatches = [...(item.rewatchDates ?? [])].sort().reverse()
  const summary = [
    item.startDate && `${t('form.startShort')} ${formatDate(item.startDate)}`,
    item.endDate && `${t('form.endShort')} ${formatDate(item.endDate)}`,
    rewatches.length ? t('title.rewatchCount', { count: rewatches.length }) : undefined,
  ].filter(Boolean)

  return (
    <section className="mx-4 mt-8 border-t border-line pt-5">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="eyebrow block text-ink-2">{t('title.myTracking')}</span>
          <span className="mt-1 block text-xs text-ink-3">{summary.length ? summary.join(' · ') : t('title.trackingHint')}</span>
        </span>
        <ChevronDown size={18} className={cx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-5 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('form.startShort')}</span>
              <input className="field" type="date" value={item.startDate ?? ''} max={todayISO()} onChange={(e) => onChange({ startDate: e.target.value || undefined })} />
            </label>
            <label className="block">
              <span className="label">{t('form.endShort')}</span>
              <input className="field" type="date" value={item.endDate ?? ''} max={todayISO()} onChange={(e) => onChange({ endDate: e.target.value || undefined })} />
            </label>
          </div>
          <div>
            <span className="label">{t('lists.myLists')}</span>
            {lists.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {lists.map((l) => {
                  const on = item.listIds?.includes(l.id)
                  return (
                    <button
                      key={l.id}
                      onClick={() => onChange({ listIds: on ? item.listIds!.filter((x) => x !== l.id) : [...(item.listIds ?? []), l.id] })}
                      className={cx('chip', on && 'chip-on')}
                    >
                      {on && <Check size={14} />}
                      {l.name}
                    </button>
                  )
                })}
              </div>
            )}
            <NewListForm onCreated={(l) => onChange({ listIds: [...(item.listIds ?? []), l.id] })} />
          </div>
          <div>
            <span className="label">{t('tags.label')}</span>
            <TagInput
              value={item.tags ?? []}
              onChange={(tags) => onChange({ tags: tags.length ? tags.slice(0, 30) : undefined })}
              suggestions={tagSuggestions}
              placeholder={t('tags.placeholder')}
              normalize={(v) => cleanTag(v, tagSuggestions)}
              showAll
            />
            <p className="mt-1.5 text-xs text-ink-3">{t('tags.private')}</p>
          </div>
          <div>
            <span className="label">{t('form.rewatches')}</span>
            {rewatches.length > 0 && (
              <ul className="mb-3 divide-y divide-line rounded-xl border border-line px-3">
                {rewatches.map((d, k) => (
                  <li key={d + k} className="flex items-center justify-between py-2 text-sm">
                    <span>{formatDate(d)}</span>
                    <button onClick={() => onChange({ rewatchDates: rewatches.filter((_, j) => j !== k).length ? rewatches.filter((_, j) => j !== k) : undefined })} className="grid size-8 place-items-center text-ink-3" aria-label={t('form.removeRewatch')}>
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => rewatches.length < 100 && onChange({ rewatchDates: [todayISO(), ...rewatches].sort().reverse() })}
              className="btn btn-ghost py-2 text-sm"
            >
              <Plus size={16} /> {t('title.rewatchedToday')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
