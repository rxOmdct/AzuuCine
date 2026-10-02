import { useState } from 'react'
import { cx } from '../lib/utils'

/** Affiche du média, ou une vignette sobre (aplat + initiale en serif) si aucune image. */
export default function Poster({ src, title, className }: { src?: string; title: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className={cx('aspect-[2/3] w-full rounded-xl border border-line bg-surface-2 object-cover', className)}
      />
    )
  }
  const initial = title.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className={cx('relative grid aspect-[2/3] w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface-2', className)}>
      <span className="text-3xl font-bold text-ink-3">{initial}</span>
      <span className="absolute bottom-0 left-0 h-[3px] w-1/3 bg-accent-fill" />
    </div>
  )
}
