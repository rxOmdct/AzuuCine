export type MediaType = 'film' | 'serie' | 'anime' | 'kdrama' | 'cdrama' | 'autre'

export type WatchStatus = 'a_voir' | 'en_cours' | 'termine' | 'pause' | 'abandonne'

export type CriteriaKey = 'story' | 'cast' | 'direction' | 'ost'

/** Toutes les notes sont stockées sur 10 (pas de 0,5), quel que soit l'affichage choisi. */
export type Criteria = Partial<Record<CriteriaKey, number>>

export interface MediaItem {
  id: string
  title: string
  originalTitle?: string
  type: MediaType
  /** Précision pour « Autre » : Documentaire, Télé-réalité… */
  subtype?: string
  year?: number
  status: WatchStatus
  rating?: number
  criteria: Criteria
  favorite?: boolean

  // Suivi des épisodes (formats longs)
  episodesWatched: number
  episodesTotal?: number
  season?: number
  /** Durée d'un épisode en minutes (sinon valeur par défaut selon le type). */
  episodeDuration?: number
  /** Durée totale en minutes (films / formats uniques). */
  duration?: number

  startDate?: string // AAAA-MM-JJ
  endDate?: string // AAAA-MM-JJ
  genres: string[]
  platform?: string
  notes?: string
  /** Avis visible sur mon profil public (sinon il reste privé) */
  notesPublic?: boolean
  /** URL d'image ou image compressée en data URL (reste locale). */
  poster?: string
  /** Synopsis (rempli depuis TMDB / AniList). */
  overview?: string
  /** Référence dans une base externe, ex. « tmdb:tv:1396 » ou « anilist:154587 ». */
  externalId?: string
  /** Place dans un Top 5 (ex. { category: 'anime', rank: 1 }). */
  top?: TopEntry
  /** Listes perso auxquelles appartient la fiche. */
  listIds?: string[]
  /** Pays d'origine (codes ISO, ex. ['KR']). */
  countries?: string[]
  /** Dates de revisionnage (AAAA-MM-JJ), en plus du premier visionnage. */
  rewatchDates?: string[]
  /** Note moyenne du public sur 10 (TMDB ou AniList). */
  publicRating?: number

  createdAt: string // ISO
  updatedAt: string // ISO
}

export type MediaInput = Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt'>

export type RatingScale = '5' | '10'

/** Catégories de Top 5 */
export type TopCategory = 'film' | 'serie' | 'anime' | 'kdrama' | 'cdrama'

export interface TopEntry {
  category: TopCategory
  /** 1 à 5 */
  rank: number
}

export interface Settings {
  ratingScale: RatingScale
  /** Clé API TMDB (v3) ou jeton de lecture (v4). Reste sur l'appareil, jamais exportée. */
  tmdbKey?: string
  /** Catégories de Top 5 affichées sur l'accueil (toutes par défaut). */
  topCategories: TopCategory[]
  /** Couleur du thème (hex), rouge par défaut. */
  accentColor: string
}

export interface CustomList {
  id: string
  name: string
  createdAt: string
}

export interface BackupFile {
  app: 'AzuuCine'
  version: 1
  exportedAt: string
  settings: Omit<Settings, 'tmdbKey'>
  items: MediaItem[]
  lists?: CustomList[]
}
