import { t } from '../i18n'
import { Star, X } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cx, formatRating } from '../lib/utils'
import type { RatingScale } from '../types'

/** Petite note compacte (étoile + valeur) pour les cartes. */
export function RatingBadge({ value, scale }: { value?: number; scale: RatingScale }) {
  if (value == null || value === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
      <Star size={12} className="fill-accent text-accent" />
      {formatRating(value, scale)}
      <span className="font-normal text-ink-3">/{scale}</span>
    </span>
  )
}

interface InputProps {
  /** Valeur interne sur 10 */
  value?: number
  onChange: (value: number | undefined) => void
  scale: RatingScale
  size?: 'lg' | 'sm'
  label?: string
}

/**
 * Saisie de note.
 * - Échelle 5 : étoiles avec demi-étoiles (touche la moitié gauche d'une étoile pour ½).
 * - Échelle 10 : curseur au pas de 0,5.
 * La valeur est toujours stockée sur 10.
 */
export function RatingInput({ value, onChange, scale, size = 'lg', label }: InputProps) {
  const px = size === 'lg' ? 34 : 24

  if (scale === '10') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={value ?? 0}
          aria-label={label ?? t('rating.outOf10')}
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange(v === 0 ? undefined : v)
          }}
          className="h-2 flex-1 accent-accent-fill"
        />
        <span className={cx('w-14 text-end font-semibold tabular-nums', size === 'lg' ? 'text-xl' : 'text-sm')}>
          {value ? formatRating(value, '10') : '—'}
          <span className="text-xs font-normal text-ink-3">/10</span>
        </span>
      </div>
    )
  }

  const stars = (value ?? 0) / 2
  const pick = (e: MouseEvent<HTMLButtonElement>, index: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Clavier (Entrée / Espace) : pas de position de clic, on donne l'étoile entière
    const half = e.detail !== 0 && e.clientX - rect.left < rect.width / 2
    const next = (index + (half ? 0.5 : 1)) * 2
    onChange(next === value ? undefined : next) // retoucher la même valeur efface la note
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={label ?? t('rating.outOf5')}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, stars - i))
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => pick(e, i)}
            className="relative transition active:scale-90"
            style={{ width: px, height: px }}
            aria-label={t('rating.stars', { count: i + 1 })}
          >
            <Star size={px} strokeWidth={1.5} className="absolute inset-0 text-ink-3" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={px} strokeWidth={1.5} className="fill-accent text-accent" />
            </span>
          </button>
        )
      })}
      <span className={cx('ms-2 tabular-nums text-ink-2', size === 'lg' ? 'text-base' : 'text-xs')}>
        {value ? formatRating(value, '5') : ''}
      </span>
      {value != null && size === 'lg' && (
        <button type="button" onClick={() => onChange(undefined)} className="ms-auto p-1 text-ink-3" aria-label={t('rating.clear')}>
          <X size={18} />
        </button>
      )}
    </div>
  )
}
