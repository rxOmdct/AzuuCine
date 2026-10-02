import { locale, t } from '../i18n'
import type { RatingScale } from '../types'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      /* contexte non sécurisé (http sur réseau local) */
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/** Note interne (sur 10) → texte affiché selon l'échelle choisie. */
export function formatRating(value: number | undefined, scale: RatingScale): string {
  if (value == null) return '—'
  const v = scale === '5' ? value / 2 : value
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', t('common.decimalSep'))
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes)
  if (total < 60) return t('common.minutes', { n: total })
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  if (days > 0) return t('common.daysHours', { d: days, h: hours })
  return mins ? t('common.hoursMinutes', { h: hours, m: mins }) : t('common.hours', { h: hours })
}

export function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Recherche insensible à la casse et aux accents. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
