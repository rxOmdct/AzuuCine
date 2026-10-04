import { locale, t } from '../i18n'
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadAiring, refreshAiring, saveAiring } from '../lib/airing'
import { findTmdbSeries, getAniListById, getTmdbDetails, releaseToResult, type GlobalRelease, type ReleaseCategory } from '../lib/catalogApi'
import { findFranchiseItem } from '../lib/franchise'
import { cachedMonth, isBrowsableMonth, loadMonth, RELEASE_CATEGORIES } from '../lib/globalReleases'
import { remotePosterToLocal } from '../lib/image'
import { calendarEvents, loadReleases, refreshReleases } from '../lib/releases'
import { readStorage } from '../lib/security'
import { useScrollLock } from '../lib/scrollLock'
import { cx, normalizeText, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput, MediaItem, MediaType } from '../types'
import { TypeBadge } from './Badges'
import Poster from './Poster'

// Initiales des jours, du lundi au dimanche, dans la langue choisie (le 1er janvier 2024 est un lundi)
const weekdays = () => Array.from({ length: 7 }, (_, k) => new Date(2024, 0, 1 + k).toLocaleDateString(locale(), { weekday: 'narrow' }))
const PER_DAY = 20
const PREFS_KEY = 'azuucine:calendar-prefs'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthId = (d: Date) => iso(d).slice(0, 7)
const niceDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

type Mode = 'all' | 'mine'

interface Entry {
  key: string
  date: string
  title: string
  poster?: string
  label: string
  type: MediaType
  item?: MediaItem
  release?: GlobalRelease
  pop: number
}

function loadPrefs(): { mode: Mode; cats: ReleaseCategory[] } {
  const raw = readStorage(PREFS_KEY, {}) as { mode?: unknown; cats?: unknown }
  const valid = RELEASE_CATEGORIES.map((c) => c.value)
  const cats = Array.isArray(raw?.cats) ? valid.filter((c) => (raw.cats as unknown[]).includes(c)) : valid
  return { mode: raw?.mode === 'mine' ? 'mine' : 'all', cats: cats.length ? cats : valid }
}

function EntryRow({ e, onOpen, onAdd, busy, added }: { e: Entry; onOpen: (i: MediaItem) => void; onAdd: (e: Entry) => void; busy: boolean; added: boolean }) {
  const mine = !!e.item
  const body = (
    <>
      <div className="w-11 shrink-0">
        <Poster src={e.item?.poster ?? e.poster} title={e.title} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{e.title}</p>
        <p className={cx('mt-0.5 truncate text-xs', mine ? 'text-accent' : 'text-ink-2')}>{e.label}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <TypeBadge item={{ type: e.type, subtype: e.item?.subtype }} />
          {mine && <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-accent">{t('calendar.inMyList')}</span>}
        </div>
      </div>
    </>
  )
  if (mine) {
    return (
      <button onClick={() => onOpen(e.item!)} className="flex w-full items-center gap-3 py-2.5 text-left">
        {body}
        <ChevronRight size={16} className="shrink-0 text-ink-3" />
      </button>
    )
  }
  return (
    <div className="flex w-full items-center gap-3 py-2.5">
      {body}
      <button
        onClick={() => onAdd(e)}
        disabled={busy || added}
        className={cx(
          'flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition active:scale-95',
          added ? 'text-accent' : 'border border-line-strong text-ink-2',
        )}
        aria-label={added ? t('reco.added', { title: e.title }) : t('reco.addLabel', { title: e.title })}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : added ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
        {added ? t('reco.addedShort') : t('status.a_voir')}
      </button>
    </div>
  )
}

/** Calendrier des sorties : toutes les sorties (films, séries, animes, dramas) + celles de ma bibliothèque. */
export default function CalendarView({ onClose, onOpen }: { onClose: () => void; onOpen: (item: MediaItem) => void }) {
  const { items, settings, patchMany, add } = useMedia()
  const hasKey = !!settings.tmdbKey?.trim()
  const [prefs, setPrefs] = useState(loadPrefs)
  const [releases, setReleases] = useState(loadReleases)
  const [loadingMine, setLoadingMine] = useState(false)
  const today = todayISO()
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState<string>()
  const [global, setGlobal] = useState<GlobalRelease[]>([])
  const [loadingGlobal, setLoadingGlobal] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string>()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const request = useRef(0)

  useScrollLock()

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* ignore */
    }
  }, [prefs])

  // Mes titres : prochains épisodes suivis + sorties de « À voir »
  const refreshMine = useCallback(
    async (force = false) => {
      if (!navigator.onLine) return
      setLoadingMine(true)
      try {
        const [airing, rel] = await Promise.all([refreshAiring(items, loadAiring(), settings.tmdbKey, force), refreshReleases(items, settings.tmdbKey, force)])
        saveAiring(airing)
        setReleases(rel)
        const patches = items
          .filter((i) => i.status !== 'termine' && airing[i.id] && airing[i.id].aired > (i.episodesTotal ?? 0))
          .map((i) => ({ id: i.id, patch: { episodesTotal: airing[i.id].aired } }))
        if (patches.length) await patchMany(patches)
      } finally {
        setLoadingMine(false)
      }
    },
    [items, settings.tmdbKey, patchMany],
  )

  // Toutes les sorties du mois affiché (+ le mois suivant quand on regarde le mois en cours, pour les 2 prochaines semaines)
  const monthsToLoad = useMemo(() => {
    const list = [month]
    if (monthId(month) === todayISO().slice(0, 7)) list.push(new Date(month.getFullYear(), month.getMonth() + 1, 1))
    return list
  }, [month])
  const refreshGlobal = useCallback(
    async (force = false) => {
      const id = ++request.current
      setGlobal(monthsToLoad.flatMap(cachedMonth))
      setFailed(false)
      setLoadingGlobal(true)
      try {
        const all: GlobalRelease[] = []
        let anyFailed = false
        for (const m of monthsToLoad) {
          if (!isBrowsableMonth(monthId(m))) continue
          const res = await loadMonth(
            m,
            RELEASE_CATEGORIES.map((c) => c.value),
            settings.tmdbKey,
            force,
          )
          if (id !== request.current) return
          all.push(...res.releases)
          anyFailed ||= res.failed.length > 0
          setGlobal([...all, ...monthsToLoad.slice(monthsToLoad.indexOf(m) + 1).flatMap(cachedMonth)])
        }
        setFailed(anyFailed)
      } finally {
        if (id === request.current) setLoadingGlobal(false)
      }
    },
    [monthsToLoad, settings.tmdbKey],
  )

  useEffect(() => {
    void refreshMine(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void refreshGlobal(false)
  }, [refreshGlobal])

  // Correspondance avec ma bibliothèque (identifiant de base, sinon titre)
  const byExt = useMemo(() => new Map(items.filter((i) => i.externalId).map((i) => [i.externalId!, i])), [items])
  const byTitle = useMemo(() => {
    const m = new Map<string, MediaItem>()
    for (const i of items) for (const t of [i.title, i.originalTitle]) if (t) m.set(normalizeText(t), i)
    return m
  }, [items])

  const entries = useMemo(() => {
    const map = new Map<string, Entry>()
    for (const ev of calendarEvents(items, releases)) {
      const key = `${ev.item.externalId ?? ev.item.id}|${ev.date}`
      map.set(key, { key, date: ev.date, title: ev.item.title, label: ev.label, type: ev.item.type, item: ev.item, pop: 200 })
    }
    for (const r of global) {
      const key = `${r.externalId}|${r.date}`
      const item =
        byExt.get(r.externalId) ??
        byTitle.get(normalizeText(r.title)) ??
        (r.originalTitle ? byTitle.get(normalizeText(r.originalTitle)) : undefined) ??
        // « Black Clover Season 2 » sur AniList = ma fiche « Black Clover »
        (r.cat !== 'film' ? findFranchiseItem(items, [r.title, r.originalTitle], { type: r.cat }) : undefined)
      map.set(key, {
        key,
        date: r.date,
        title: item?.title ?? r.title,
        poster: r.poster,
        label: r.label,
        type: item?.type ?? r.cat,
        item,
        release: r,
        pop: item ? 200 : r.pop,
      })
    }
    const cats = new Set<string>(prefs.cats)
    return [...map.values()]
      .filter((e) => (prefs.mode === 'mine' ? !!e.item : true))
      .filter((e) => e.type === 'autre' || cats.has(e.type))
      .sort((a, b) => a.date.localeCompare(b.date) || b.pop - a.pop || a.title.localeCompare(b.title, locale()))
  }, [items, releases, global, byExt, byTitle, prefs])

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [entries])

  // Grille du mois (semaines commençant le lundi)
  const cells = useMemo(() => {
    const first = new Date(month)
    const offset = (first.getDay() + 6) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
    return Array.from({ length: 42 }, (_, k) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k)
      return { date: iso(d), day: d.getDate(), inMonth: d.getMonth() === month.getMonth() }
    }).filter((c, k, all) => k < 35 || all.slice(35).some((x) => x.inMonth))
  }, [month])

  const mid = monthId(month)
  const isCurrent = mid === today.slice(0, 7)
  // Mois en cours : les 14 prochains jours (même s'ils débordent sur le mois suivant) ; sinon tout le mois
  const lastDay = isCurrent ? iso(new Date(Date.now() + 13 * 86400000)) : `${mid}-31`
  const days = [...byDay.keys()].filter((d) => (isCurrent ? d >= today : d.startsWith(mid)) && d <= lastDay).sort()
  const tomorrow = iso(new Date(Date.now() + 86400000))
  const dayTitle = (d: string) => (d === today ? t('time.today') : d === tomorrow ? t('time.tomorrow') : niceDate(d))

  const changeMonth = (delta: number) => {
    setSelected(undefined)
    setExpanded(new Set())
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))
  }
  const toggleCat = (c: ReleaseCategory) =>
    setPrefs((p) => {
      const on = p.cats.includes(c)
      const cats = on ? p.cats.filter((x) => x !== c) : [...p.cats, c]
      return { ...p, cats: cats.length ? cats : p.cats }
    })

  const addToWatchlist = async (e: Entry) => {
    const r = e.release
    if (!r) return
    setBusy(e.key)
    try {
      let data: Partial<MediaInput> = {}
      let poster: string | undefined
      // Anime : on préfère la fiche TMDB, qui regroupe toutes les saisons (sinon chaque saison AniList ferait une fiche)
      const series = r.externalId.startsWith('anilist:') && hasKey ? await findTmdbSeries([r.title, r.originalTitle], settings.tmdbKey!).catch(() => undefined) : undefined
      if (series) {
        data = await getTmdbDetails(series, settings.tmdbKey!)
        poster = series.posterUrl ? await remotePosterToLocal(series.posterUrl) : undefined
      } else if (r.externalId.startsWith('anilist:')) {
        const res = await getAniListById(r.externalId)
        data = { ...res?.prefill }
        poster = res?.posterUrl ?? r.poster
      } else {
        const res = releaseToResult(r)
        if (res && hasKey) data = await getTmdbDetails(res, settings.tmdbKey!)
        poster = r.poster ? await remotePosterToLocal(r.poster) : undefined
      }
      await add({
        title: r.title,
        type: r.cat,
        status: 'a_voir',
        criteria: {},
        episodesWatched: 0,
        genres: [],
        year: r.year,
        externalId: r.externalId,
        ...data,
        poster,
      })
      setAdded((s) => new Set(s).add(r.externalId))
    } catch {
      /* réseau : le bouton reste disponible */
    } finally {
      setBusy(undefined)
    }
  }

  const renderList = (list: Entry[], day: string) => {
    const open = expanded.has(day)
    const shown = open ? list : list.slice(0, PER_DAY)
    return (
      <>
        <div className="divide-y divide-line">
          {shown.map((e) => (
            <EntryRow key={e.key} e={e} onOpen={onOpen} onAdd={addToWatchlist} busy={busy === e.key} added={!!e.release && added.has(e.release.externalId)} />
          ))}
        </div>
        {list.length > shown.length && (
          <button onClick={() => setExpanded((s) => new Set(s).add(day))} className="mt-1 w-full py-2 text-xs font-medium text-ink-3">
            {t('calendar.seeMore', { count: list.length - shown.length })} <span className="text-accent">→</span>
          </button>
        )}
      </>
    )
  }

  const loading = loadingGlobal || loadingMine
  const browsable = isBrowsableMonth(mid)

  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t('calendar.title')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">
            {t('calendar.heading')}<span className="text-accent">{t('calendar.headingAccent')}</span>
          </h2>
          <button
            onClick={() => {
              void refreshMine(true)
              void refreshGlobal(true)
            }}
            disabled={loading}
            className="grid size-10 place-items-center rounded-full text-ink-2"
            aria-label={t('calendar.refresh')}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="safe-bottom mx-auto max-w-2xl px-4 pb-16 pt-4">
          {/* Toutes les sorties / mes titres */}
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-full border border-line p-1">
            {(['all', 'mine'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPrefs((p) => ({ ...p, mode: m }))}
                className={cx('rounded-full py-2 text-sm font-medium transition-colors', prefs.mode === m ? 'bg-ink text-bg' : 'text-ink-3')}
              >
                {m === 'all' ? t('calendar.all') : t('calendar.mine')}
              </button>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
            {RELEASE_CATEGORIES.map((c) => (
              <button key={c.value} onClick={() => toggleCat(c.value)} className={cx('chip shrink-0 py-1! text-[13px]', prefs.cats.includes(c.value) && 'chip-on')}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Mois */}
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => changeMonth(-1)} className="grid size-9 place-items-center rounded-full border border-line text-ink-2" aria-label={t('calendar.prevMonth')}>
              <ChevronLeft size={18} />
            </button>
            <span className="text-lg font-bold capitalize">{month.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => changeMonth(1)} className="grid size-9 place-items-center rounded-full border border-line text-ink-2" aria-label={t('calendar.nextMonth')}>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays().map((w, k) => (
              <span key={k} className="eyebrow py-1">
                {w}
              </span>
            ))}
            {cells.map((c) => {
              const evs = byDay.get(c.date) ?? []
              const mine = evs.filter((e) => e.item).length
              const isSel = c.date === selected
              const isToday = c.date === today
              return (
                <button
                  key={c.date}
                  onClick={() => setSelected(isSel ? undefined : c.date)}
                  className={cx(
                    'relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-colors',
                    !c.inMonth && 'text-ink-3/50',
                    c.inMonth && !isSel && 'text-ink-2',
                    isSel && 'bg-ink font-bold text-bg',
                    !isSel && isToday && 'border border-accent font-bold text-ink',
                    !isSel && evs.length > 0 && 'bg-surface-2',
                    !isSel && mine > 0 && 'font-bold text-ink',
                  )}
                  aria-label={evs.length ? `${c.date} : ${t('calendar.releases', { count: evs.length })}` : c.date}
                >
                  {c.day}
                  {evs.length > 0 && (
                    <span className="absolute bottom-1.5 flex gap-0.5">
                      {Array.from({ length: Math.min(3, evs.length) }, (_, k) => (
                        <span key={k} className={cx('size-1 rounded-full', isSel ? 'bg-bg' : k < mine ? 'bg-accent' : 'bg-ink-3')} />
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="mt-2 flex items-center justify-center gap-4 text-[11px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-accent" /> {t('calendar.inMyListLegend')}
            </span>
            {prefs.mode === 'all' && (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ink-3" /> {t('calendar.others')}
              </span>
            )}
          </p>

          {prefs.mode === 'all' && !hasKey && (
            <p className="mt-4 rounded-xl border border-line px-3 py-2.5 text-xs leading-relaxed text-ink-2">
              {t('calendar.needKey')}
            </p>
          )}
          {prefs.mode === 'all' && !browsable && (
            <p className="mt-4 text-center text-xs text-ink-3">{t('calendar.range')}</p>
          )}
          {failed && <p className="mt-4 text-center text-xs text-ink-3">{t('calendar.failed')}</p>}

          {/* Détail du jour choisi, ou liste jour par jour */}
          {selected ? (
            <section className="mt-6">
              <h3 className="mb-1 border-b border-line pb-2 text-sm font-bold first-letter:uppercase">{dayTitle(selected)}</h3>
              {byDay.get(selected)?.length ? renderList(byDay.get(selected)!, selected) : <p className="py-3 text-sm text-ink-3">{t('calendar.nothingThatDay')}</p>}
            </section>
          ) : days.length ? (
            <>
            {isCurrent && <h3 className="eyebrow mt-7 text-ink-2">{t('calendar.next14')}</h3>}
            {days.map((d) => (
              <section key={d} className="mt-6">
                <h3 className="mb-1 flex items-baseline justify-between border-b border-line pb-2">
                  <span className="text-sm font-bold first-letter:uppercase">{dayTitle(d)}</span>
                  <span className="text-xs font-semibold text-accent">{byDay.get(d)!.length}</span>
                </h3>
                {renderList(byDay.get(d)!, d)}
              </section>
            ))}
            </>
          ) : (
            <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-ink-3">
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t('calendar.loading')}
                </>
              ) : prefs.mode === 'mine' ? (
                isCurrent ? t('calendar.noneMine14') : t('calendar.noneMineMonth')
              ) : (
                isCurrent ? t('calendar.none14') : t('calendar.noneMonth')
              )}
            </p>
          )}

          <p className="mt-8 text-xs leading-relaxed text-ink-3">
            {t('calendar.footer')}
          </p>
        </div>
      </div>
    </div>
  )
}
