import { Check, Pencil, Star } from 'lucide-react'
import { useState } from 'react'
import { t } from '../i18n'
import { genreLabel } from '../lib/genres'
import { formatRating } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaInput } from '../types'
import Poster from './Poster'

export interface HeroAction {
  label: string
  onClick?: () => void
  /** Déjà fait (tout vu) : bouton affiché comme validé */
  done?: boolean
}

interface Props {
  form: MediaInput
  typeLabel: string
  editing: boolean
  onEdit: () => void
  primary: HeroAction
}

/** En-tête d'une fiche, façon plateforme de streaming : grande image, titre, infos et action principale. */
export default function ItemHero({ form, typeLabel, editing, onEdit, primary }: Props) {
  const { settings } = useMedia()
  const [moreText, setMoreText] = useState(false)
  const image = form.backdrop ?? form.poster
  const meta = [typeLabel, form.year, ...form.genres.slice(0, 3).map(genreLabel)].filter(Boolean).join(' · ')

  return (
    <section>
      <div className="relative h-56 overflow-hidden bg-surface-2 sm:h-72">
        {image && <img src={image} alt="" className={form.backdrop ? 'size-full object-cover' : 'size-full scale-110 object-cover blur-md'} />}
        <div className="absolute inset-0 bg-bg/55" />
      </div>

      <div className="relative mx-auto -mt-24 flex max-w-2xl items-end gap-4 px-4">
        <div className="w-24 shrink-0 sm:w-28">
          <Poster src={form.poster} title={form.title} />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="line-clamp-3 text-2xl font-bold leading-tight">{form.title}</h1>
          {form.originalTitle && <p className="mt-0.5 truncate text-sm text-ink-3">{form.originalTitle}</p>}
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-2xl px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          {meta && <span>{meta}</span>}
          {form.publicRating != null && (
            <span className="flex items-center gap-1 font-semibold text-ink">
              <Star size={12} className="fill-accent text-accent" />
              {formatRating(form.publicRating, settings.ratingScale)}
            </span>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={primary.onClick}
            disabled={!primary.onClick}
            className={primary.done ? 'btn btn-ghost flex-1 py-3' : 'btn btn-primary flex-1 py-3'}
          >
            {primary.done && <Check size={17} />}
            {primary.label}
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-pressed={editing}
            className={editing ? 'btn btn-light px-4' : 'btn btn-ghost px-4'}
            aria-label={t('hero.edit')}
            title={t('hero.edit')}
          >
            <Pencil size={17} />
          </button>
        </div>

        {form.overview && (
          <button type="button" onClick={() => setMoreText((v) => !v)} className="mt-4 block text-left text-sm leading-relaxed text-ink-2">
            <span className={moreText ? 'whitespace-pre-line' : 'line-clamp-3'}>{form.overview}</span>
            {form.overview.length > 160 && <span className="mt-1 block text-xs font-medium text-ink">{moreText ? t('hero.less') : t('hero.more')}</span>}
          </button>
        )}
      </div>
    </section>
  )
}
