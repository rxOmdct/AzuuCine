import { t } from '../i18n'
import type { CriteriaKey, MediaType, TopCategory, WatchStatus } from '../types'

export interface MediaTypeInfo {
  value: MediaType
  /** Nom affiché (dans la langue choisie) */
  readonly label: string
  /** Minutes par épisode par défaut, pour l'estimation du temps passé. */
  episodeMinutes: number
  /** Le format a-t-il des épisodes ? */
  episodic: boolean
}

export const MEDIA_TYPES: MediaTypeInfo[] = [
  { value: 'film', get label() { return t('type.film') }, episodeMinutes: 0, episodic: false },
  { value: 'serie', get label() { return t('type.serie') }, episodeMinutes: 45, episodic: true },
  { value: 'anime', get label() { return t('type.anime') }, episodeMinutes: 24, episodic: true },
  { value: 'kdrama', get label() { return t('type.kdrama') }, episodeMinutes: 60, episodic: true },
  { value: 'cdrama', get label() { return t('type.cdrama') }, episodeMinutes: 45, episodic: true },
  { value: 'autre', get label() { return t('type.autre') }, episodeMinutes: 45, episodic: true },
]

export const TYPE_BY_VALUE = Object.fromEntries(MEDIA_TYPES.map((t) => [t.value, t])) as Record<MediaType, MediaTypeInfo>

export const DEFAULT_FILM_MINUTES = 110

export interface StatusInfo {
  value: WatchStatus
  readonly label: string
  dot: string
}

export const STATUSES: StatusInfo[] = [
  { value: 'a_voir', get label() { return t('status.a_voir') }, dot: 'border border-ink-3' },
  { value: 'en_cours', get label() { return t('status.en_cours') }, dot: 'bg-accent' },
  { value: 'termine', get label() { return t('status.termine') }, dot: 'bg-ink' },
  { value: 'pause', get label() { return t('status.pause') }, dot: 'bg-ink-3' },
  { value: 'abandonne', get label() { return t('status.abandonne') }, dot: 'bg-line-strong' },
]

export const STATUS_BY_VALUE = Object.fromEntries(STATUSES.map((s) => [s.value, s])) as Record<WatchStatus, StatusInfo>

export const CRITERIA: { key: CriteriaKey; readonly label: string }[] = [
  { key: 'story', get label() { return t('criteria.story') } },
  { key: 'cast', get label() { return t('criteria.cast') } },
  { key: 'direction', get label() { return t('criteria.direction') } },
  { key: 'ost', get label() { return t('criteria.ost') } },
]

export const PLATFORM_SUGGESTIONS = [
  'Netflix', 'Prime Video', 'Disney+', 'Crunchyroll', 'ADN', 'Viki', 'Apple TV+', 'Max',
  'Canal+', 'Paramount+', 'YouTube', 'iQIYI', 'WeTV', 'Youku',
]
export const platformSuggestions = () => [...PLATFORM_SUGGESTIONS, t('platform.cinema'), t('platform.dvd'), t('platform.tv')]

export const TOP_CATEGORIES: { value: TopCategory; readonly label: string; readonly plural: string }[] = [
  { value: 'film', get label() { return t('type.film') }, get plural() { return t('typePlural.film') } },
  { value: 'serie', get label() { return t('type.serie') }, get plural() { return t('typePlural.serie') } },
  { value: 'anime', get label() { return t('type.anime') }, get plural() { return t('typePlural.anime') } },
  { value: 'kdrama', get label() { return t('type.kdrama') }, get plural() { return t('typePlural.kdrama') } },
  { value: 'cdrama', get label() { return t('type.cdrama') }, get plural() { return t('typePlural.cdrama') } },
]

export const ALL_TOP_CATEGORIES: TopCategory[] = TOP_CATEGORIES.map((c) => c.value)
