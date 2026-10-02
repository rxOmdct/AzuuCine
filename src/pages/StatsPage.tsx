import { genreLabel } from '../lib/genres'
import { locale, t } from '../i18n'
import { Star } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import Disagreements from '../components/Disagreements'
import Poster from '../components/Poster'
import { EmptyState, PageHeader, SectionTitle } from '../components/ui'
import { MEDIA_TYPES, STATUSES } from '../lib/constants'
import { availableYears, computeStats, countries, itemsForPeriod, monthly, records, watchMinutes } from '../lib/stats'
import { cx, formatDuration, formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem, MediaType } from '../types'

/** Couleurs des types (palette catégorielle validée pour fond sombre, ordre fixe). */
const TYPE_COLORS: Record<MediaType, string> = {
  film: '#3987e5',
  serie: '#d95926',
  anime: '#199e70',
  kdrama: '#c98500',
  cdrama: '#d55181',
  autre: '#008300',
}

type Tab = 'overview' | 'habits' | 'tastes'
const TABS: { value: Tab; readonly label: string }[] = [
  { value: 'overview', get label() { return t('stats.overview') } },
  { value: 'habits', get label() { return t('stats.habits') } },
  { value: 'tastes', get label() { return t('stats.tastes') } },
]

const fmtInt = (n: number) => n.toLocaleString(locale())

/** Colonnes verticales d'une seule couleur ; toucher une colonne affiche sa valeur. */
function Columns({
  data,
  format,
  height = 140,
  selected,
  onSelect,
}: {
  data: { key: string; label: string; value: number }[]
  format: (v: number) => string
  height?: number
  selected?: string
  onSelect: (key: string) => void
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d) => {
          const on = d.key === selected
          return (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className="group relative flex h-full flex-1 items-end"
              aria-label={`${d.label} : ${format(d.value)}`}
              title={`${d.label} : ${format(d.value)}`}
            >
              <span
                className={cx('w-full rounded-t-[4px] transition-colors', on ? 'bg-accent' : 'bg-accent/45')}
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0 }}
              />
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-line pt-1.5">
        {data.map((d) => (
          <span key={d.key} className={cx('flex-1 text-center text-[10px]', d.key === selected ? 'font-semibold text-ink' : 'text-ink-3')}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-bold leading-none tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-ink-3">{hint}</div>}
    </div>
  )
}

function MiniPoster({ item, caption }: { item: MediaItem; caption: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 shrink-0">
        <Poster src={item.poster} title={item.title} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="text-xs text-ink-3">{caption}</p>
      </div>
    </div>
  )
}

export default function StatsPage() {
  const { items, settings, loading } = useMedia()
  const scale = settings.ratingScale
  const years = useMemo(() => availableYears(items), [items])
  const [year, setYear] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [metric, setMetric] = useState<'count' | 'minutes'>('count')
  const [month, setMonth] = useState<string>()
  const [ratingBin, setRatingBin] = useState<string>()

  const scoped = useMemo(() => itemsForPeriod(items, year), [items, year])
  const s = useMemo(() => computeStats(scoped), [scoped])
  const months = useMemo(() => monthly(items, year), [items, year])
  const geo = useMemo(() => countries(scoped), [scoped])
  const rec = useMemo(() => records(scoped), [scoped])

  if (loading) return <PageHeader title={t('stats.pageTitle')} accent={t('stats.pageAccent')} />
  if (items.length === 0) {
    return (
      <>
        <PageHeader title={t('stats.pageTitle')} accent={t('stats.pageAccent')} />
        <EmptyState title={t('stats.emptyTitle')} text={t('stats.emptyText')} />
      </>
    )
  }

  const hours = Math.round(s.totalMinutes / 60)
  const days = s.totalMinutes / 1440
  const typeTotal = s.byType.reduce((sum, bt) => sum + bt.minutes, 0)
  const typeRows = s.byType.filter((bt) => bt.value > 0).sort((a, b) => b.minutes - a.minutes)

  // Mois sélectionné par défaut : le plus chargé
  const busiest = months.reduce((best, m) => (m[metric] > best[metric] ? m : best), months[0])
  const shownMonth = months.find((m) => m.key === month) ?? busiest

  // Histogramme des notes
  const ratingCols =
    scale === '5'
      ? s.ratingBuckets.map((v, i) => ({ key: String(i), label: formatRating(i + 1, '5'), value: v }))
      : s.ratingBuckets.map((v, i) => ({ key: String(i), label: String(i + 1), value: v }))
  const shownRating = ratingCols.find((c) => c.key === ratingBin) ?? ratingCols.reduce((a, b) => (b.value > a.value ? b : a), ratingCols[0])

  const maxGenre = Math.max(1, ...s.topGenres.map((g) => g.value))
  const maxCountry = Math.max(1, ...geo.list.map((c) => c.count))
  const periodLabel = year || t('stats.sinceStart')

  return (
    <>
      <PageHeader title={t('stats.pageTitle')} accent={t('stats.pageAccent')} subtitle={year ? t('stats.subtitleYear', { count: s.total, year }) : t('stats.subtitle', { count: s.total })} />

      {/* Période + onglets, collants en haut */}
      <div className="sticky top-0 z-20 -mx-4 space-y-2.5 bg-bg/95 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {['', ...years].map((y) => (
            <button key={y || 'all'} onClick={() => setYear(y)} className={cx('chip py-1! text-[13px]', year === y && 'chip-on')}>
              {y || t('common.all')}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-full border border-line p-1">
          {TABS.map((tb) => (
            <button
              key={tb.value}
              onClick={() => setTab(tb.value)}
              className={cx('rounded-full py-2 text-xs font-semibold transition-colors', tab === tb.value ? 'bg-ink text-bg' : 'text-ink-3')}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <>
          {/* Le grand chiffre */}
          <div className="card mt-3 p-5">
            <span className="eyebrow">{t('home.screenTime')} · {periodLabel}</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums leading-none">{fmtInt(hours)}</span>
              <span className="text-xl font-semibold text-accent">{t('stats.hours', { count: hours })}</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {t('stats.nonStopPre')}
              <span className="font-semibold text-ink">{days >= 1 ? t('stats.days', { count: Math.round(days) }) : formatDuration(s.totalMinutes)}</span>
              {t('stats.nonStopPost')}
              {' · '}
              {t('stats.finishedN', { count: s.completed })} · {t('stats.episodesN', { count: s.episodesWatched })}
            </p>
          </div>

          {/* Répartition par type : barre empilée + légende */}
          <SectionTitle>{t('stats.timeByType')}</SectionTitle>
          {typeTotal > 0 ? (
            <>
              <div className="flex h-4 gap-[2px] overflow-hidden rounded-full">
                {typeRows.map((row) =>
                  row.minutes > 0 ? (
                    <span key={row.type} style={{ flexGrow: row.minutes, background: TYPE_COLORS[row.type] }} title={`${row.label} : ${formatDuration(row.minutes)}`} />
                  ) : null,
                )}
              </div>
              <ul className="mt-4 space-y-2.5">
                {typeRows.map((row) => (
                  <li key={row.type} className="flex items-center gap-3 text-sm">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: TYPE_COLORS[row.type] }} />
                    <span className="flex-1 text-ink-2">{row.label}</span>
                    <span className="text-xs text-ink-3">{t('journal.seen', { count: row.completed })}</span>
                    <span className="w-16 text-right text-xs font-semibold tabular-nums">{formatDuration(row.minutes)}</span>
                    <span className="w-10 text-right text-xs tabular-nums text-ink-3">{Math.round((row.minutes / typeTotal) * 100)} %</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-3">{t('stats.noTime')}</p>
          )}

          <div className="mt-8 grid grid-cols-2 gap-3">
            <Tile
              label={t('stats.avgRating')}
              value={
                s.avgRating != null ? (
                  <span className="flex items-center gap-1.5">
                    <Star size={20} className="fill-accent text-accent" />
                    {formatRating(Math.round(s.avgRating * 10) / 10, scale)}
                    <span className="text-sm font-normal text-ink-3">/{scale}</span>
                  </span>
                ) : (
                  '—'
                )
              }
              hint={t('stats.rated', { count: s.ratedCount })}
            />
            <Tile label={t('home.completed')} value={fmtInt(s.completed)} hint={year ? t('stats.inYear', { year }) : t('home.thisYear', { count: s.completedThisYear })} />
          </div>

          {/* Statuts en pastilles */}
          <SectionTitle>{t('stats.statuses')}</SectionTitle>
          <div className="grid grid-cols-5 gap-2 text-center">
            {s.byStatus.map((st) => (
              <div key={st.status} className="rounded-2xl border border-line py-3">
                <div className="text-lg font-bold tabular-nums">{st.value}</div>
                <div className="mt-0.5 text-[10px] leading-tight text-ink-3">{STATUSES.find((x) => x.value === st.status)?.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'habits' && (
        <>
          <SectionTitle
            action={
              <div className="flex rounded-full border border-line p-0.5">
                {(['count', 'minutes'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', metric === m ? 'bg-ink text-bg' : 'text-ink-3')}
                  >
                    {m === 'count' ? t('catalog.titles') : t('stats.hoursTab')}
                  </button>
                ))}
              </div>
            }
          >
            {year ? t('stats.monthByMonth', { year }) : t('stats.last12')}
          </SectionTitle>
          <div className="card p-4">
            <p className="mb-4 text-sm">
              <span className="font-semibold capitalize">{new Date(`${shownMonth.key}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</span>
              <span className="text-ink-2">
                {' · '}
                {t('stats.monthFinished', { count: shownMonth.count })} · {formatDuration(shownMonth.minutes)}
              </span>
            </p>
            <Columns
              data={months.map((m) => ({ key: m.key, label: m.initial, value: metric === 'count' ? m.count : m.minutes }))}
              format={(v) => (metric === 'count' ? t('account.nTitles', { count: v }) : formatDuration(v))}
              selected={shownMonth.key}
              onSelect={setMonth}
            />
            {busiest[metric] > 0 && (
              <p className="mt-3 text-xs text-ink-3">
                {t('stats.busiest')} <span className="text-ink">{new Date(`${busiest.key}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</span>
              </p>
            )}
          </div>

          <SectionTitle>{t('stats.records')}</SectionTitle>
          <div className="space-y-3">
            {rec.marathon && (
              <div className="card p-3.5">
                <span className="eyebrow text-accent">{t('stats.marathon')}</span>
                <div className="mt-2">
                  <MiniPoster item={rec.marathon.item} caption={`${t('stats.episodesN', { count: rec.marathon.episodes })} · ${formatDuration(watchMinutes(rec.marathon.item))}`} />
                </div>
              </div>
            )}
            {rec.longestFilm && (
              <div className="card p-3.5">
                <span className="eyebrow text-accent">{t('stats.longestFilm')}</span>
                <div className="mt-2">
                  <MiniPoster item={rec.longestFilm} caption={formatDuration(rec.longestFilm.duration ?? 0)} />
                </div>
              </div>
            )}
            {!rec.marathon && !rec.longestFilm && <p className="text-sm text-ink-3">{t('stats.noRecords')}</p>}
          </div>

          {s.topPlatforms.length > 0 && (
            <>
              <SectionTitle>{t('stats.platforms')}</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {s.topPlatforms.map((p, i) => (
                  <span key={p.label} className={cx('chip', i === 0 && 'chip-on')}>
                    {p.label}
                    <span className="text-xs opacity-60">{p.value}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'tastes' && (
        <>
          {rec.bestRated && rec.bestRated.length > 0 && (
            <>
              <SectionTitle>{t('stats.bestRated')} · {periodLabel}</SectionTitle>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                {rec.bestRated.map((item) => (
                  <div key={item.id} className="w-24 shrink-0">
                    <Poster src={item.poster} title={item.title} />
                    <p className="mt-1.5 truncate text-xs font-medium text-ink-2">{item.title}</p>
                    <p className="flex items-center gap-1 text-[11px] text-ink-3">
                      <Star size={10} className="fill-accent text-accent" />
                      {formatRating(item.rating, scale)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle>{t('stats.myRatings')}</SectionTitle>
          {s.ratedCount > 0 ? (
            <div className="card p-4">
              <p className="mb-4 text-sm">
                <span className="font-semibold">{t('account.nTitles', { count: shownRating.value })}</span>
                <span className="text-ink-2"> {t('stats.ratedAs', { count: shownRating.value, rating: `${shownRating.label}${scale === '5' ? ' ★' : '/10'}` })}</span>
              </p>
              <Columns data={ratingCols} format={(v) => t('account.nTitles', { count: v })} height={110} selected={shownRating.key} onSelect={setRatingBin} />
            </div>
          ) : (
            <p className="text-sm text-ink-3">{t('stats.noRatings')}</p>
          )}

          <Disagreements scoped={scoped} />

          <SectionTitle>{t('stats.favGenres')}</SectionTitle>
          {s.topGenres.length ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              {s.topGenres.map((g, i) => {
                const r = g.value / maxGenre
                return (
                  <span
                    key={g.label}
                    className={cx('font-bold leading-tight', i === 0 ? 'text-accent' : r > 0.6 ? 'text-ink' : 'text-ink-2')}
                    style={{ fontSize: `${0.85 + r * 1.15}rem` }}
                    title={t('account.nTitles', { count: g.value })}
                  >
                    {genreLabel(g.label)}
                    <sup className="ml-0.5 text-[10px] font-medium text-ink-3">{g.value}</sup>
                  </span>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-3">{t('stats.noGenres')}</p>
          )}

          <SectionTitle>{t('stats.countries')}</SectionTitle>
          {geo.list.length ? (
            <ul className="space-y-3">
              {geo.list.slice(0, 8).map((c) => (
                <li key={c.code} className="flex items-center gap-3 text-sm">
                  <span className="w-7 text-center text-xl leading-none">{c.flag}</span>
                  <span className="w-28 truncate text-ink-2">{c.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(c.count / maxCountry) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-xs font-semibold tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {geo.missing > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              {geo.list.length === 0 ? t('stats.noCountryLegacy', { count: geo.missing }) : t('stats.noCountry', { count: geo.missing })}
            </p>
          )}

          <SectionTitle>{t('stats.byType')}</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {MEDIA_TYPES.map((mt) => {
              const row = s.byType.find((b) => b.type === mt.value)!
              return (
                <div key={mt.value} className="rounded-2xl border border-line p-3">
                  <span className="mb-2 block h-1 w-6 rounded-full" style={{ background: TYPE_COLORS[mt.value] }} />
                  <div className="text-xl font-bold tabular-nums">{row.value}</div>
                  <div className="text-[11px] text-ink-3">{mt.label}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-ink-3">
        {t('stats.footnote')}
      </p>
    </>
  )
}
