import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { BarList, Columns, Panel, StatTile } from '../components/stats/Charts'
import Poster from '../components/Poster'
import DatesSheet from '../components/stats/DatesSheet'
import { bulkDays, dateQuality, knowsMonth, needsFix } from '../lib/dating'
import { EmptyState, PageHeader } from '../components/ui'
import { STATUSES, TYPE_BY_VALUE } from '../lib/constants'
import { genreLabel } from '../lib/genres'
import { availableYears, computeStats, countries, itemsForPeriod, monthly, records, watchMinutes } from '../lib/stats'
import { cx, formatDuration, formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem, MediaType } from '../types'

/** Onglets : tout, puis un par grande famille (les dramas coréens / chinois vont avec les séries). */
type Scope = 'all' | 'film' | 'series' | 'anime' | 'other'
const SCOPE_TYPES: Record<Exclude<Scope, 'all'>, MediaType[]> = {
  film: ['film'],
  series: ['serie', 'kdrama', 'cdrama'],
  anime: ['anime'],
  other: ['autre'],
}
const scopeLabel = (s: Scope) =>
  s === 'all' ? t('stats.tabAll') : s === 'film' ? t('typePlural.film') : s === 'series' ? t('typePlural.serie') : s === 'anime' ? t('typePlural.anime') : t('stats.tabOther')

/** Statistiques : vue générale, puis films, séries, animes et autres formats. */
export default function StatsPage({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, settings } = useMedia()
  const [scope, setScope] = useState<Scope>('all')
  const [year, setYear] = useState('')
  const [fixing, setFixing] = useState(false)
  // Jours d'ajout en lot, repérés sur toute la bibliothèque
  const bulk = useMemo(() => bulkDays(items), [items])

  const scoped = useMemo(() => (scope === 'all' ? items : items.filter((i) => SCOPE_TYPES[scope].includes(i.type))), [items, scope])
  const years = useMemo(() => availableYears(scoped, bulk), [scoped, bulk])
  const period = year && years.includes(year) ? year : ''
  const list = useMemo(() => itemsForPeriod(scoped, period, bulk), [scoped, period, bulk])

  // Onglets : « Général », « Films », « Séries » toujours ; les autres seulement s'ils ont des titres
  const scopes: Scope[] = (['all', 'film', 'series', 'anime', 'other'] as Scope[]).filter(
    (s) => s === 'all' || s === 'film' || s === 'series' || items.some((i) => SCOPE_TYPES[s].includes(i.type)),
  )

  return (
    <>
      <PageHeader title={t('stats.pageTitle')} accent={t('stats.pageAccent')} subtitle={period ? t('stats.subtitleYear', { count: list.length, year: period }) : t('stats.subtitle', { count: list.length })} />

      {/* Filtres : une seule rangée (catégorie + période) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1" role="tablist" aria-label={t('nav.stats')}>
          {scopes.map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cx('chip shrink-0', scope === s && 'chip-on')}>
              {scopeLabel(s)}
            </button>
          ))}
        </div>
        <label className="self-start sm:self-auto sm:shrink-0">
          <span className="sr-only">{t('stats.period')}</span>
          <select value={period} onChange={(e) => setYear(e.target.value)} className="field w-auto py-2 pe-8 text-sm">
            <option value="">{t('stats.allYears')}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t('stats.emptyTitle')} text={t('stats.emptyText')} />
      ) : (
        <StatsBody key={scope + period} scope={scope} items={list} year={period} bulk={bulk} scale={settings.ratingScale} onOpen={onOpen} onFixDates={() => setFixing(true)} />
      )}
      {fixing && <DatesSheet onClose={() => setFixing(false)} />}
    </>
  )
}

function StatsBody({
  scope,
  items,
  year,
  bulk,
  scale,
  onOpen,
  onFixDates,
}: {
  scope: Scope
  items: MediaItem[]
  year: string
  bulk: Set<string>
  scale: '5' | '10'
  onOpen: (item: MediaItem) => void
  onFixDates: () => void
}) {
  const s = useMemo(() => computeStats(items), [items])
  const months = useMemo(() => monthly(items, year, bulk), [items, year, bulk])
  // Titres terminés tenus à l'écart de la courbe (ajout en lot, sans date, ou date trop vague)
  const offChart = useMemo(() => {
    let n = 0
    let fix = 0
    for (const i of items) {
      if (i.status !== 'termine') continue
      const q = dateQuality(i, bulk)
      if (!knowsMonth(q)) n++
      if (needsFix(q)) fix++
    }
    return { n, fix }
  }, [items, bulk])
  const rec = useMemo(() => records(items), [items])
  const geo = useMemo(() => countries(items), [items])
  const isFilm = scope === 'film'
  const episodic = scope !== 'all' && scope !== 'film'

  const films = useMemo(() => items.filter((i) => i.type === 'film' && i.status === 'termine'), [items])
  const avgFilm = films.length ? films.reduce((n, f) => n + watchMinutes(f) / (1 + (f.rewatchDates?.length ?? 0)), 0) / films.length : 0
  const rewatches = items.reduce((n, i) => n + (i.rewatchDates?.length ?? 0), 0)

  // Décennies de sortie des titres vus
  const decades = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of items) if (i.status !== 'a_voir' && i.year && i.year > 1870) m.set(Math.floor(i.year / 10) * 10, (m.get(Math.floor(i.year / 10) * 10) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [items])

  const days = Math.floor(s.totalMinutes / 1440)
  const timeHint = days > 0 ? `${t('stats.nonStopPre')}${t('stats.days', { count: days })}${t('stats.nonStopPost')}` : undefined
  // Mois le plus chargé : seulement s'il sort vraiment du lot (pas d'égalité en tête)
  const ranked = [...months].sort((a, b) => b.count - a.count)
  const busiest = ranked[0] && ranked[0].count > (ranked[1]?.count ?? 0) ? ranked[0] : undefined

  // Répartition des notes : 10 tranches sur /10 (½ étoile par tranche en échelle /5)
  const ratingBars = s.ratingBuckets.map((n, k) => {
    const v = k + 1
    const shown = formatRating(v, scale)
    return { key: String(v), axis: scale === '5' ? (v % 2 === 0 ? shown : '') : shown, value: n, tip: `${t('stats.ratedAs', { count: n, rating: shown })} : ${n}` }
  })

  const typeRows = s.byType
    .filter((x) => x.value > 0 && (scope === 'all' || SCOPE_TYPES[scope as Exclude<Scope, 'all'>].includes(x.type)))
    .sort((a, b) => b.minutes - a.minutes)
    .map((x) => ({ key: x.type, label: TYPE_BY_VALUE[x.type].label, value: x.minutes, sub: t('stats.finishedN', { count: x.completed }) }))

  return (
    <div className="mt-5 space-y-4 pb-6">
      {/* Les chiffres clés */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('stats.timeSpent')} value={formatDuration(s.totalMinutes)} hint={timeHint} />
        <StatTile label={isFilm ? t('stats.filmsSeen') : t('stats.finished')} value={s.completed} hint={!isFilm && s.inProgress ? `${s.inProgress} · ${STATUSES[1].label}` : rewatches ? `${rewatches} · ${t('stats.rewatched')}` : undefined} />
        {isFilm ? (
          <StatTile label={t('stats.avgLength')} value={avgFilm ? formatDuration(avgFilm) : '—'} />
        ) : (
          <StatTile label={t('stats.episodesSeen')} value={s.episodesWatched.toLocaleString()} />
        )}
        <StatTile label={t('stats.avgRating')} value={s.avgRating ? formatRating(Math.round(s.avgRating * 10) / 10, scale) : '—'} hint={s.ratedCount ? t('stats.rated', { count: s.ratedCount }) : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Activité mois par mois */}
        <Panel title={year ? t('stats.monthByMonth', { year }) : t('stats.last12')} className="lg:col-span-2">
          <Columns
            label={year ? t('stats.monthByMonth', { year }) : t('stats.last12')}
            height={150}
            bars={months.map((m) => ({
              key: m.key,
              axis: m.initial,
              value: m.count,
              highlight: m === busiest,
              tip: `${m.label} : ${t('stats.monthFinished', { count: m.count })}${m.minutes ? ` · ${formatDuration(m.minutes)}` : ''}`,
            }))}
          />
          {busiest && busiest.count > 0 && (
            <p className="mt-3 text-xs text-ink-2">
              {t('stats.busiest')} <span className="font-medium text-ink">{busiest.label}</span> · {t('stats.monthFinished', { count: busiest.count })}
            </p>
          )}
          {offChart.n > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5">
              <p className="text-xs text-ink-2">{t('dates.chartNote', { count: offChart.n })}</p>
              <button onClick={onFixDates} className="text-xs font-semibold text-ink">
                {offChart.fix > 0 ? t('dates.open') : t('dates.openApprox')} <span className="text-accent rtl:-scale-x-100">→</span>
              </button>
            </div>
          )}
        </Panel>

        {/* Temps par type (vue générale, et séries quand il y a plusieurs formats) */}
        {typeRows.length > 1 && (
          <Panel title={t('stats.timeByType')}>
            <BarList rows={typeRows} format={formatDuration} />
          </Panel>
        )}

        <Panel title={t('stats.myRatings')}>
          {s.ratedCount ? <Columns label={t('stats.myRatings')} height={120} bars={ratingBars} /> : <p className="text-sm text-ink-3">{t('stats.noRatings')}</p>}
        </Panel>

        <Panel title={t('stats.favGenres')}>
          {s.topGenres.length ? (
            <BarList rows={s.topGenres.map((g) => ({ key: g.label, label: genreLabel(g.label), value: g.value }))} />
          ) : (
            <p className="text-sm text-ink-3">{t('stats.noGenres')}</p>
          )}
        </Panel>

        {geo.list.length > 0 && (
          <Panel title={t('stats.countries')}>
            <BarList
              rows={geo.list.slice(0, 8).map((c) => ({
                key: c.code,
                label: (
                  <>
                    <span aria-hidden="true">{c.flag}</span> {c.name}
                  </>
                ),
                value: c.count,
              }))}
            />
          </Panel>
        )}

        {decades.length > 1 && (
          <Panel title={t('stats.decades')}>
            <BarList rows={decades.map(([d, n]) => ({ key: String(d), label: `${d} – ${d + 9}`, value: n }))} />
          </Panel>
        )}

        <Panel title={t('stats.statuses')}>
          <BarList rows={s.byStatus.filter((x) => x.value > 0).map((x) => ({ key: x.status, label: x.label, value: x.value }))} />
        </Panel>

        {s.topPlatforms.length > 0 && (
          <Panel title={t('stats.platforms')}>
            <BarList rows={s.topPlatforms.map((p) => ({ key: p.label, label: p.label, value: p.value }))} />
          </Panel>
        )}

        {/* Records */}
        {(rec.marathon && (episodic || scope === 'all')) || (rec.longestFilm && (isFilm || scope === 'all')) ? (
          <Panel title={t('stats.records')}>
            <div className="space-y-3">
              {rec.marathon && (episodic || scope === 'all') && (
                <RecordRow label={t('stats.marathon')} item={rec.marathon.item} value={t('stats.episodesN', { count: rec.marathon.episodes })} onOpen={onOpen} />
              )}
              {rec.longestFilm && (isFilm || scope === 'all') && (
                <RecordRow label={t('stats.longestFilm')} item={rec.longestFilm} value={formatDuration(rec.longestFilm.duration ?? 0)} onOpen={onOpen} />
              )}
            </div>
          </Panel>
        ) : null}
      </div>

      {/* Mes mieux notés */}
      {rec.bestRated && rec.bestRated.length > 0 && (
        <Panel title={t('stats.bestRated')}>
          <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {rec.bestRated.map((i) => (
              <li key={i.id} className="w-24 shrink-0 lg:w-28">
                <button onClick={() => onOpen(i)} className="block w-full text-start">
                  <Poster src={i.poster} title={i.title} />
                  <p className="mt-1.5 truncate text-xs font-medium">{i.title}</p>
                  <p className="text-[11px] text-ink-3">{formatRating(i.rating, scale)}</p>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-ink-3">{t('stats.footnote')}</p>
    </div>
  )
}

function RecordRow({ label, item, value, onOpen }: { label: string; item: MediaItem; value: string; onOpen: (item: MediaItem) => void }) {
  return (
    <button onClick={() => onOpen(item)} className="flex w-full items-center gap-3 text-start">
      <div className="w-12 shrink-0">
        <Poster src={item.poster} title={item.title} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-3">{label}</p>
        <p className="truncate font-semibold">{item.title}</p>
        <p className="text-sm text-ink-2">{value}</p>
      </div>
    </button>
  )
}
