import { locale, t } from '../i18n'

/** « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j », puis la date. */
export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return t('time.justNow')
  if (s < 3600) return t('time.minutesAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return t('time.hoursAgo', { n: Math.floor(s / 3600) })
  if (s < 7 * 86400) return t('time.daysAgo', { n: Math.floor(s / 86400) })
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}
