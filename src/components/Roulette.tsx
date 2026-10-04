import { genreLabel } from '../lib/genres'
import { locale, t } from '../i18n'
import { Check, Dices, RotateCcw, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TransitionEvent } from 'react'
import { MEDIA_TYPES, TYPE_BY_VALUE } from '../lib/constants'
import { episodeCap } from '../lib/franchise'
import {
  buildPool,
  loadFilters,
  pickRandom,
  saveFilters,
  sessionMinutes,
  SOURCES,
  sourcePool,
  TIME_OPTIONS,
  type RouletteFilters,
} from '../lib/roulette'
import { cx, formatDuration, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem } from '../types'
import { TypeBadge } from './Badges'
import Poster from './Poster'
import { RatingBadge } from './Rating'
import { useScrollLock } from '../lib/scrollLock'

const CARD = 112 // largeur d'une affiche dans le rouleau (w-28)
const GAP = 12
const STEP = CARD + GAP
const TARGET = 30 // position du gagnant dans le rouleau
const SPIN_MS = 3800

interface Props {
  onClose: () => void
  onOpen: (item: MediaItem) => void
}

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Roulette({ onClose, onOpen }: Props) {
  const { items, settings, update, lists } = useMedia()
  const [filters, setFilters] = useState<RouletteFilters>(loadFilters)
  const pool = useMemo(() => buildPool(items, filters), [items, filters])
  const base = useMemo(() => sourcePool(items, filters.sources, filters.listIds), [items, filters.sources, filters.listIds])
  const genres = useMemo(() => [...new Set(base.flatMap((i) => i.genres))].sort((a, b) => a.localeCompare(b, locale())), [base])
  const platforms = useMemo(() => [...new Set(base.map((i) => i.platform).filter(Boolean) as string[])].sort(), [base])

  const [reel, setReel] = useState<MediaItem[]>([])
  const [offset, setOffset] = useState(0)
  const [animate, setAnimate] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<MediaItem>()
  const [started, setStarted] = useState(false)
  const rolled = useRef(new Set<string>())
  const viewport = useRef<HTMLDivElement>(null)
  const pending = useRef<MediaItem | undefined>(undefined)
  const spinningRef = useRef(false)
  const resultRef = useRef<MediaItem | undefined>(undefined)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((x) => clearTimeout(x)), [])
  resultRef.current = result

  const xFor = (index: number, jitter = 0) => {
    const w = viewport.current?.clientWidth ?? 360
    return w / 2 - (index * STEP + CARD / 2) + jitter
  }

  // Bloque le défilement derrière + mémorise les filtres
  useScrollLock()
  useEffect(() => saveFilters(filters), [filters])

  // Changer les filtres efface le tirage en cours
  useEffect(() => {
    setResult(undefined)
    setStarted(false)
  }, [filters])

  // Rouleau « au repos » : les affiches possibles, centrées (sans toucher à un tirage affiché)
  useLayoutEffect(() => {
    if (spinning || resultRef.current) return
    if (!pool.length) {
      setReel([])
      return
    }
    let idle = shuffle(pool)
    while (idle.length < 9) idle = idle.concat(shuffle(pool))
    setAnimate(false)
    setReel(idle)
    setOffset(xFor(4))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, result === undefined])

  const setF = (patch: Partial<RouletteFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const spin = () => {
    const winner = pickRandom(pool, rolled.current)
    if (!winner || spinning) return
    rolled.current.add(winner.id)
    pending.current = winner
    setResult(undefined)
    setStarted(false)

    const strip = Array.from({ length: TARGET + 5 }, () => pool[Math.floor(Math.random() * pool.length)])
    strip[TARGET] = winner
    setReel(strip)

    // L'animation est le cœur de la roulette : on la joue toujours,
    // même si Windows / le téléphone a les « effets d'animation » désactivés.
    setSpinning(true)
    spinningRef.current = true
    setAnimate(false)
    setOffset(xFor(2))
    // On place le rouleau au départ, puis on lance l'animation juste après
    timers.current.forEach((x) => clearTimeout(x))
    timers.current = [
      window.setTimeout(() => {
        setAnimate(true)
        setOffset(xFor(TARGET, (Math.random() - 0.5) * (CARD - 30)))
      }, 40),
      // Filet de sécurité si l'événement de fin d'animation n'arrive pas (onglet en arrière-plan…)
      window.setTimeout(finishSpin, SPIN_MS + 400),
    ]
  }

  const finishSpin = () => {
    if (!spinningRef.current) return
    spinningRef.current = false
    setSpinning(false)
    setResult(pending.current)
    navigator.vibrate?.(35)
  }

  const onSpinEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return
    finishSpin()
  }

  const watchIt = async () => {
    if (!result) return
    if (result.status === 'a_voir' || result.status === 'pause') {
      await update(result.id, { status: 'en_cours', startDate: result.startDate ?? todayISO() })
    }
    setStarted(true)
  }

  const winnerIndex = result ? reel.indexOf(result, reel.length > TARGET ? TARGET : 0) : -1

  return (
    <div className="sheet-in fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t('roulette.name')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">
            {t('roulette.heading')}<span className="text-accent">{t('roulette.headingAccent')}</span>
          </h2>
          <span className="size-10" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="safe-bottom mx-auto max-w-2xl pb-16">
          {/* Rouleau d'affiches */}
          <div ref={viewport} className="relative mt-6 h-[184px] overflow-hidden">
            {reel.length > 0 ? (
              <div
                className="flex gap-3"
                style={{
                  transform: `translateX(${offset}px)`,
                  transition: animate ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.72, 0.1, 1)` : 'none',
                }}
                onTransitionEnd={onSpinEnd}
              >
                {reel.map((item, i) => (
                  <div
                    key={i}
                    className={cx(
                      'w-28 shrink-0 transition-opacity duration-300',
                      result && i !== winnerIndex && 'opacity-30',
                    )}
                  >
                    <div className={cx('rounded-xl', result && i === winnerIndex && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}>
                      <Poster src={item.poster} title={item.title} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-3 opacity-40">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="grid aspect-[2/3] w-28 place-items-center rounded-xl border border-dashed border-line-strong text-3xl font-bold text-ink-3">
                    ?
                  </div>
                ))}
              </div>
            )}
            {/* Repère central */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent/70" />
            <div className="pointer-events-none absolute left-1/2 top-0 size-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-accent" />
            <div className="pointer-events-none absolute bottom-0 left-1/2 size-0 -translate-x-1/2 border-x-[7px] border-b-[9px] border-x-transparent border-b-accent" />
          </div>

          <div className="space-y-8 px-4">
            {/* Bouton / résultat */}
            {result && !spinning ? (
              <div className="sheet-in card mt-6 p-4">
                <span className="eyebrow text-accent">{t('roulette.tonight')}</span>
                <h3 className="mt-2 text-xl leading-tight">{result.title}</h3>
                {result.originalTitle && <p className="text-sm text-ink-3">{result.originalTitle}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <TypeBadge item={result} />
                  {result.year && <span>{result.year}</span>}
                  <span>
                    {TYPE_BY_VALUE[result.type].episodic
                      ? `${episodeCap(result) ? `${t('roulette.nEps', { n: episodeCap(result)! })} · ` : ''}${t('roulette.perEp', { duration: formatDuration(sessionMinutes(result)) })}`
                      : formatDuration(sessionMinutes(result))}
                  </span>
                  {result.platform && <span>· {result.platform}</span>}
                  <RatingBadge value={result.rating} scale={settings.ratingScale} />
                </div>
                {result.status === 'pause' && (
                  <p className="mt-2 text-xs text-ink-2">
                    {episodeCap(result)
                      ? t('roulette.stoppedAtOf', { ep: result.episodesWatched, total: episodeCap(result)! })
                      : t('roulette.stoppedAt', { ep: result.episodesWatched })}
                  </p>
                )}
                {result.overview && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-ink-2">{result.overview}</p>}
                {result.genres.length > 0 && <p className="mt-2 text-xs text-ink-3">{result.genres.slice(0, 4).map(genreLabel).join(' · ')}</p>}

                {started ? (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Check size={16} className="text-accent" /> {t('roulette.enjoy')}
                    </span>
                    <button onClick={onClose} className="font-medium text-ink">
                      {t('common.close')} <span className="text-accent">→</span>
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={watchIt} className="btn btn-primary">
                      {t('roulette.watchIt')}
                    </button>
                    <button onClick={spin} className="btn btn-ghost">
                      <RotateCcw size={16} /> {t('roulette.again')}
                    </button>
                  </div>
                )}
                <button onClick={() => onOpen(result)} className="mt-3 w-full text-center text-xs font-medium text-ink-3">
                  {t('roulette.seeItem')}
                </button>
              </div>
            ) : (
              <div className="mt-6 text-center">
                <button onClick={spin} disabled={!pool.length || spinning} className="btn btn-primary px-8 py-3.5 text-base">
                  <Dices size={20} className={spinning ? 'animate-spin' : ''} />
                  {spinning ? t('roulette.spinning') : t('roulette.spin')}
                </button>
                <p className="mt-2.5 text-xs text-ink-3">
                  {pool.length
                    ? t('roulette.poolSize', { count: pool.length })
                    : t('roulette.empty')}
                </p>
              </div>
            )}

            {/* Filtres */}
            <section className="space-y-5 border-t border-line pt-6">
              <h3 className="eyebrow text-ink-2">{t('roulette.inside')}</h3>

              <div>
                <span className="label">{t('roulette.pickFrom')}</span>
                <div className="flex flex-wrap gap-2">
                  {SOURCES.map((s) => {
                    const on = filters.sources.includes(s.value)
                    const count = sourcePool(items, [s.value]).length
                    return (
                      <button
                        key={s.value}
                        onClick={() => {
                          const next = toggle(filters.sources, s.value)
                          if (next.length || filters.listIds.length) setF({ sources: next, genre: '', platform: '' })
                        }}
                        disabled={spinning}
                        className={cx('chip', on && 'chip-on')}
                        aria-pressed={on}
                      >
                        {s.label}
                        <span className={cx('text-xs', on ? 'opacity-60' : 'text-ink-3')}>{count}</span>
                      </button>
                    )
                  })}
                  {lists.map((l) => {
                    const on = filters.listIds.includes(l.id)
                    const count = items.filter((i) => i.listIds?.includes(l.id)).length
                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          const next = toggle(filters.listIds, l.id)
                          if (next.length || filters.sources.length) setF({ listIds: next, genre: '', platform: '' })
                        }}
                        disabled={spinning}
                        className={cx('chip', on && 'chip-on')}
                        aria-pressed={on}
                      >
                        {l.name}
                        <span className={cx('text-xs', on ? 'opacity-60' : 'text-ink-3')}>{count}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-3">{t('roulette.rewatchHint')}</p>
              </div>

              <div>
                <span className="label">{t('form.type')}</span>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setF({ types: [] })} disabled={spinning} className={cx('chip', !filters.types.length && 'chip-on')}>
                    {t('catalog.all')}
                  </button>
                  {MEDIA_TYPES.map((mt) => (
                    <button
                      key={mt.value}
                      onClick={() => setF({ types: toggle(filters.types, mt.value) })}
                      disabled={spinning}
                      className={cx('chip', filters.types.includes(mt.value) && 'chip-on')}
                    >
                      {mt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="label">{t('roulette.time')}</span>
                <div className="grid grid-cols-4 gap-1 rounded-full border border-line p-1">
                  {TIME_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setF({ time: o.value })}
                      disabled={spinning}
                      className={cx('rounded-full py-2 text-xs font-medium transition-colors', filters.time === o.value ? 'bg-ink text-bg' : 'text-ink-3')}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {(genres.length > 0 || platforms.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">{t('catalog.genre')}</span>
                    <select className="field" value={filters.genre} onChange={(e) => setF({ genre: e.target.value })} disabled={spinning}>
                      <option value="">{t('catalog.all')}</option>
                      {genres.map((g) => (
                        <option key={g} value={g}>
                          {genreLabel(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">{t('form.platform')}</span>
                    <select className="field" value={filters.platform} onChange={(e) => setF({ platform: e.target.value })} disabled={spinning}>
                      <option value="">{t('catalog.allRatings')}</option>
                      {platforms.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
