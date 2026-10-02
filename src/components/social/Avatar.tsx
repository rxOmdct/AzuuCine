import { cx } from '../../lib/utils'

/** Photo de profil ronde, ou initiale sur fond neutre. */
export default function Avatar({ url, name, size = 40, className }: { url?: string; name: string; size?: number; className?: string }) {
  const style = { width: size, height: size }
  if (url) return <img src={url} alt="" style={style} className={cx('shrink-0 rounded-full border border-line bg-surface-2 object-cover', className)} />
  return (
    <span style={{ ...style, fontSize: size * 0.42 }} className={cx('grid shrink-0 place-items-center rounded-full border border-line bg-surface-2 font-bold text-ink-2', className)}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}
