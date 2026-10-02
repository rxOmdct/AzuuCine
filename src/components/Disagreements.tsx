import { t } from '../i18n'
import { Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fetchPublicRatings, missingPublic } from '../lib/publicRatings'
import { cx, formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem, RatingScale } from '../types'
import Poster from './Poster'
import { SectionTitle } from './ui'

/** Écart signé, arrondi au dixième dans l'échelle choisie (« 0 » plutôt que « +0,0 »). */
const signed = (v: number, scale: RatingScale) => {
  const r = Math.round((scale === '5' ? v / 2 : v) * 10) / 10
  if (r === 0) return '0'
  return `${r > 0 ? '+' : '−'}${String(Math.abs(r)).replace('.', t('common.decimalSep'))}`
}

function Row({ item, scale }: { item: MediaItem; scale: RatingScale }) {
  const gap = item.rating! - item.publicRating!
  // barre centrée : moitié gauche = moins aimé, moitié droite = plus aimé (écart max affiché : 5 points /10)
  const width = Math.min(50, (Math.abs(gap) / 5) * 50)
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="w-9 shrink-0">
        <Poster src={item.poster} title={item.title} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="text-[11px] text-ink-3">
          {t('public.me')} <span className="text-ink-2">{formatRating(item.rating, scale)}</span> · {t('public.label')} <span className="text-ink-2">{formatRating(item.publicRating, scale)}</span>
        </p>
        <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-2">
          <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
          <span
            className={cx('absolute inset-y-0 rounded-full', gap >= 0 ? 'bg-accent' : 'bg-ink-3')}
            style={gap >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
          />
        </div>
      </div>
      <span className={cx('w-11 shrink-0 text-right text-sm font-bold tabular-nums', gap >= 0 ? 'text-accent' : 'text-ink-2')}>{signed(gap, scale)}</span>
    </li>
  )
}

/** Stats « Moi vs le public » : écarts entre mes notes et la moyenne TMDB / AniList. */
export default function Disagreements({ scoped }: { scoped: MediaItem[] }) {
  const { items, settings, patchMany } = useMedia()
  const scale = settings.ratingScale
  const [progress, setProgress] = useState<[number, number]>()
  const [message, setMessage] = useState<string>()

  const compared = useMemo(() => scoped.filter((i) => i.rating != null && i.publicRating != null), [scoped])
  const rated = useMemo(() => items.filter((i) => i.rating != null), [items])
  const missing = useMemo(() => missingPublic(rated, settings.tmdbKey).length, [rated, settings.tmdbKey, progress])

  const run = async () => {
    if (!navigator.onLine) return setMessage(t('common.offline'))
    setMessage(undefined)
    setProgress([0, missing])
    try {
      const patches = await fetchPublicRatings(rated, settings.tmdbKey, (done, total) => setProgress([done, total]))
      if (patches.length) await patchMany(patches)
      setMessage(patches.length ? t('public.added', { count: patches.length }) : t('public.noneFound'))
    } finally {
      setProgress(undefined)
    }
  }

  const gaps = compared.map((i) => i.rating! - i.publicRating!)
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
  const agree = gaps.length ? Math.round((gaps.filter((g) => Math.abs(g) <= 1).length / gaps.length) * 100) : 0
  const sorted = [...compared].sort((a, b) => b.rating! - b.publicRating! - (a.rating! - a.publicRating!))
  const loved = sorted.filter((i) => i.rating! - i.publicRating! >= 1).slice(0, 5)
  const hated = sorted.filter((i) => i.rating! - i.publicRating! <= -1).reverse().slice(0, 5)

  const fetchButton =
    missing > 0 || progress ? (
      <button onClick={run} disabled={!!progress} className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-3 transition-colors hover:text-ink">
        {progress ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} className="text-accent" />}
        {progress ? `${progress[0]}/${progress[1]}` : t('public.fetch', { n: missing })}
      </button>
    ) : undefined

  return (
    <>
      <SectionTitle action={fetchButton}>{t('public.title')}</SectionTitle>
      {message && <p className="-mt-2 mb-3 text-xs text-ink-3">{message}</p>}

      {compared.length === 0 ? (
        <p className="text-sm text-ink-3">
          {missing > 0
            ? t('public.hintFetch')
            : settings.tmdbKey
              ? t('public.hintNone')
              : t('public.hintKey')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <div className="eyebrow">{t('public.avgGap')}</div>
              <div className={cx('mt-2 text-2xl font-bold leading-none tabular-nums', avg >= 0.3 && 'text-accent')}>{signed(avg, scale)}</div>
              <div className="mt-1.5 text-xs text-ink-3">{Math.abs(avg) < 0.3 ? t('public.average') : avg > 0 ? t('public.generous') : t('public.harsh')}</div>
            </div>
            <div className="card p-4">
              <div className="eyebrow">{t('public.agreeTitle')}</div>
              <div className="mt-2 text-2xl font-bold leading-none tabular-nums">{agree} %</div>
              <div className="mt-1.5 text-xs text-ink-3">
                {scale === '5' ? t('public.within5', { count: compared.length }) : t('public.within10', { count: compared.length })}
              </div>
            </div>
          </div>

          {loved.length > 0 && (
            <div className="card mt-3 px-4 pb-1.5 pt-4">
              <h3 className="text-sm font-semibold">
                {t('public.lovedPre')}<span className="text-accent">{t('public.lovedAccent')}</span>{t('public.lovedPost')}
              </h3>
              <ul className="divide-y divide-line">
                {loved.map((i) => (
                  <Row key={i.id} item={i} scale={scale} />
                ))}
              </ul>
            </div>
          )}
          {hated.length > 0 && (
            <div className="card mt-3 px-4 pb-1.5 pt-4">
              <h3 className="text-sm font-semibold">
                {t('public.hatedPre')}<span className="text-ink-2">{t('public.hatedAccent')}</span>{t('public.hatedPost')}
              </h3>
              <ul className="divide-y divide-line">
                {hated.map((i) => (
                  <Row key={i.id} item={i} scale={scale} />
                ))}
              </ul>
            </div>
          )}
          {!loved.length && !hated.length && <p className="mt-3 text-sm text-ink-3">{t('public.allAgree')}</p>}
        </>
      )}
    </>
  )
}
