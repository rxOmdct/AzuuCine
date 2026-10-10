import { locale, t } from '../i18n'
import type { MediaItem } from '../types'
import { formatDate, todayISO } from './utils'

/**
 * Qualité de la date de fin d'un titre terminé.
 *
 * Quand on ajoute toute sa bibliothèque d'un coup (import, ou des dizaines de titres « vus » le même jour),
 * la date de fin enregistrée est celle de l'ajout, pas du visionnage : la courbe des stats serait fausse.
 * Ces « ajouts en lot » sont repérés automatiquement et tenus à l'écart de la courbe, jusqu'à ce que je
 * corrige la date (année, mois, ou « je ne sais plus »).
 */
export type DateQuality = 'exact' | 'month' | 'year' | 'unknown' | 'bulk' | 'missing'

/** À partir de combien de titres terminés le même jour on considère que c'est un ajout en lot. */
export const BULK_MIN = 15

const localDay = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Jours d'ajout en lot : beaucoup de titres créés le même jour, ou beaucoup de titres « terminés » le même jour.
 * Compter aussi les créations garde le lot reconnu quand on a déjà corrigé une partie de ses titres.
 */
export function bulkDays(items: MediaItem[]): Set<string> {
  const ends = new Map<string, number>()
  const created = new Map<string, number>()
  for (const i of items) {
    const c = localDay(i.createdAt)
    created.set(c, (created.get(c) ?? 0) + 1)
    if (i.status === 'termine' && !i.endApprox && i.endDate) ends.set(i.endDate, (ends.get(i.endDate) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const m of [ends, created]) for (const [d, n] of m) if (n >= BULK_MIN) out.add(d)
  return out
}

export function dateQuality(item: MediaItem, bulk: Set<string>): DateQuality {
  // Seule la date de fin d'un titre terminé compte ici (les autres statuts se rattachent à leur début)
  if (item.status !== 'termine') return 'exact'
  if (item.endApprox === 'unknown') return 'unknown'
  if (item.endApprox === 'year') return 'year'
  if (item.endApprox === 'month') return 'month'
  if (!item.endDate) return 'missing'
  return bulk.has(item.endDate) ? 'bulk' : 'exact'
}

/** Date à corriger (ajout en lot ou aucune date). */
export const needsFix = (q: DateQuality) => q === 'bulk' || q === 'missing'
/** Peut aller dans la courbe mois par mois. */
export const knowsMonth = (q: DateQuality) => q === 'exact' || q === 'month'
/** Peut compter pour une année. */
export const knowsYear = (q: DateQuality) => q === 'exact' || q === 'month' || q === 'year'

/**
 * Correctif pour une date approximative : année seule (→ 1er juillet), année + mois (→ le 15),
 * ou inconnue (date effacée). La date de début, si elle venait du même ajout en lot, est effacée aussi.
 */
export function approxPatch(item: MediaItem, choice: { year: number; month?: number } | 'unknown'): Pick<MediaItem, 'endDate' | 'endApprox' | 'startDate'> {
  const today = todayISO()
  if (choice === 'unknown') {
    return { endDate: undefined, endApprox: 'unknown', startDate: item.startDate && item.startDate === item.endDate ? undefined : item.startDate }
  }
  const raw = choice.month ? `${choice.year}-${String(choice.month).padStart(2, '0')}-15` : `${choice.year}-07-01`
  const endDate = raw > today ? today : raw
  // Un début postérieur à la nouvelle fin (ou identique à l'ancienne fin factice) n'a plus de sens
  const startDate = item.startDate && (item.startDate > endDate || item.startDate === item.endDate) ? undefined : item.startDate
  return { endDate, endApprox: choice.month ? 'month' : 'year', startDate }
}

/** Date de fin telle qu'on l'affiche : « 12 mars 2024 », « mars 2023 », « vers 2021 », « date inconnue ». */
export function endLabel(item: MediaItem): string | undefined {
  if (item.endApprox === 'unknown') return t('dates.unknown')
  if (!item.endDate) return undefined
  if (item.endApprox === 'year') return t('dates.year', { year: item.endDate.slice(0, 4) })
  if (item.endApprox === 'month') return new Date(item.endDate + 'T12:00:00').toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
  return formatDate(item.endDate)
}
