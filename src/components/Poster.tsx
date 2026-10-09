import { useState } from 'react'
import { cx } from '../lib/utils'

/** Affiche du média, ou une vignette sobre (aplat + initiale en serif) si aucune image. */
export default function Poster({ src, title, className }: { src?: string; title: string; className?: string }) {
  // On retient quelle image a échoué (une nouvelle affiche doit retenter)
  const [broken, setBroken] = useState<string>()
  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt={title}
        loading="lazy"
        onError={() => setBroken(src)}
        className={cx('aspect-[2/3] w-full rounded-xl border border-line bg-surface-2 object-cover', className)}
      />
    )
  }
  const initial = title.trim().charAt(0).toUpperCase() || '?'
  return (
    <div role="img" aria-label={title} className={cx('relative grid aspect-[2/3] w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface-2', className)}>
      <span aria-hidden="true" className="text-3xl font-bold text-ink-3">{initial}</span>
      <span className="absolute bottom-0 start-0 h-[3px] w-1/3 bg-accent-fill" />
    </div>
  )
}
