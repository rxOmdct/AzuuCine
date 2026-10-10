import { EyeOff } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/utils'

/**
 * Texte d'un avis. Avec spoilers : le texte n'est PAS dans la page tant qu'on n'a pas tapé
 * « Afficher le spoiler » (pas seulement flouté : rien à lire pour un lecteur d'écran ni à copier).
 */
export default function ReviewText({
  text,
  spoiler,
  className,
  clamp,
  revealed,
}: {
  text: string
  spoiler?: boolean
  className?: string
  clamp?: boolean
  /** Déjà dévoilé (mon propre avis) : seul le badge « Spoiler » reste */
  revealed?: boolean
}) {
  const [shown, setShown] = useState(!spoiler || !!revealed)

  if (!shown) {
    return (
      <div className={cx('relative mt-2 overflow-hidden rounded-xl border border-line bg-surface-2 px-3.5 py-3', className)}>
        {/* Fausses lignes floutées : purement décoratives */}
        <div aria-hidden="true" className="space-y-2 blur-[3px]">
          <span className="block h-2.5 w-11/12 rounded-full bg-ink-3/40" />
          <span className="block h-2.5 w-4/5 rounded-full bg-ink-3/40" />
          <span className="block h-2.5 w-3/5 rounded-full bg-ink-3/40" />
        </div>
        <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
            <EyeOff size={14} className="text-accent" aria-hidden="true" /> {t('spoiler.warning')}
          </span>
          <button type="button" onClick={() => setShown(true)} className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink active:scale-95">
            {t('spoiler.show')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cx('mt-2', className)}>
      {spoiler && (
        <span className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-accent/50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
          <EyeOff size={11} aria-hidden="true" /> {t('spoiler.badge')}
        </span>
      )}
      <p className={cx('whitespace-pre-line break-words text-sm leading-relaxed text-ink-2', clamp && 'line-clamp-6')}>{text}</p>
    </div>
  )
}
