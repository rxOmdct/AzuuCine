import { genreLabel } from '../lib/genres'
import { t } from '../i18n'
import { Loader2, Plus, Share2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { TOP_CATEGORIES } from '../lib/constants'
import { renderTopCard, slug } from '../lib/shareCard'
import { cx, formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem, TopCategory } from '../types'
import Poster from './Poster'
import { RatingBadge } from './Rating'
import TopFiveEditor from './TopFiveEditor'
import SharePreview from './SharePreview'
import { LinkArrow, SectionTitle } from './ui'

/** Chiffre géant en contour (rouge pour le n°1, gris pour les autres). */
function RankNumber({ rank, big }: { rank: number; big?: boolean }) {
  const style: CSSProperties = {
    WebkitTextStroke: big ? '2.5px var(--color-accent)' : '2px var(--color-ink-3)',
    color: 'transparent',
    fontSize: big ? '10rem' : '5.5rem',
    lineHeight: 0.8,
    letterSpacing: '-0.06em',
  }
  return (
    <span aria-hidden className="pointer-events-none select-none font-black" style={style}>
      {rank}
    </span>
  )
}

function EmptySlot({ rank, onClick, big }: { rank: number; onClick: () => void; big?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'grid aspect-[2/3] place-items-center rounded-xl border border-dashed border-line-strong text-ink-3 transition-colors active:bg-surface-2',
        big ? 'w-32' : 'w-full',
      )}
      aria-label={t('top.pick', { rank })}
    >
      <Plus size={big ? 22 : 18} />
    </button>
  )
}

export default function TopFive({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, settings } = useMedia()
  const cats = TOP_CATEGORIES.filter((c) => settings.topCategories.includes(c.value))
  const [selected, setSelected] = useState<TopCategory>()
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; filename: string; title: string }>()

  if (!cats.length) return null
  const current = cats.find((c) => c.value === selected) ?? cats[0]
  const byRank = new Map(items.filter((i) => i.top?.category === current.value).map((i) => [i.top!.rank, i]))
  const first = byRank.get(1)
  const edit = () => setEditing(true)
  const share = async () => {
    setSharing(true)
    try {
      const blob = await renderTopCard(current.plural, [1, 2, 3, 4, 5].map((r) => byRank.get(r)))
      setPreview({ blob, filename: `azuucine-top5-${slug(current.plural)}.png`, title: t('top.shareTitle', { category: current.plural }) })
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <SectionTitle
        action={
          <span className="flex items-center gap-4">
            <button onClick={share} disabled={sharing} className="flex items-center gap-1 text-xs font-medium text-ink-3" aria-label={t('top.shareLabel')}>
              {sharing ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} {t('share.share')}
            </button>
            <LinkArrow onClick={edit}>{t('common.edit')}</LinkArrow>
          </span>
        }
      >
        {t('top.title')} <span className="text-accent">5</span>
      </SectionTitle>

      {/* Choix de la catégorie */}
      {cats.length > 1 && (
        <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
          {cats.map((c) => (
            <button key={c.value} onClick={() => setSelected(c.value)} className={cx('chip py-1! text-[13px]', current.value === c.value && 'chip-on')}>
              {c.plural}
            </button>
          ))}
        </div>
      )}

      {/* N°1 : grand chiffre rouge + affiche + infos */}
      <div className="flex items-end">
        <div className="relative flex shrink-0 items-end">
          <span className="-me-3 mb-1">
            <RankNumber rank={1} big />
          </span>
          {first ? (
            <button onClick={() => onOpen(first)} className="relative z-10 w-32">
              <Poster src={first.poster} title={first.title} />
            </button>
          ) : (
            <EmptySlot rank={1} onClick={edit} big />
          )}
        </div>
        <div className="min-w-0 flex-1 pb-1 ps-4">
          <span className="eyebrow text-accent">{t('top.number', { rank: 1 })} · {current.plural}</span>
          {first ? (
            <>
              <button onClick={() => onOpen(first)} className="mt-1.5 block text-start text-lg font-bold leading-snug">
                {first.title}
              </button>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                {first.year && <span>{first.year}</span>}
                <RatingBadge value={first.rating} scale={settings.ratingScale} />
              </div>
              {first.genres.length > 0 && <p className="mt-2 line-clamp-1 text-xs text-ink-3">{first.genres.slice(0, 3).map(genreLabel).join(' · ')}</p>}
            </>
          ) : (
            <p className="mt-1.5 text-sm text-ink-3">{t('top.pickFirst')}</p>
          )}
        </div>
      </div>

      {/* N°2 à 5 : chiffres en contour qui dépassent derrière les affiches */}
      <div className="mt-14 grid grid-cols-4 gap-x-2">
        {[2, 3, 4, 5].map((rank) => {
          const item = byRank.get(rank)
          return (
            <div key={rank} className="min-w-0">
              <div className="relative">
                <span className="absolute -start-1 -top-9 z-0">
                  <RankNumber rank={rank} />
                </span>
                <div className="relative z-10 ms-4">
                  {item ? (
                    <button onClick={() => onOpen(item)} className="block w-full">
                      <Poster src={item.poster} title={item.title} />
                    </button>
                  ) : (
                    <EmptySlot rank={rank} onClick={edit} />
                  )}
                </div>
              </div>
              <p className="ms-4 mt-1.5 truncate text-[11px] font-medium text-ink-2" title={item?.title}>
                {item ? item.title : '—'}
              </p>
              {item?.rating ? <p className="ms-4 text-[10px] text-ink-3">{formatRating(item.rating, settings.ratingScale)}/{settings.ratingScale}</p> : null}
            </div>
          )
        })}
      </div>

      {preview && <SharePreview {...preview} onClose={() => setPreview(undefined)} />}
      {editing && <TopFiveEditor category={current.value} onClose={() => setEditing(false)} />}
    </>
  )
}
