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
  /** Nombre d'épisodes de chaque saison (TMDB), ex. [24, 24]. Les épisodes vus restent comptés au total. */
  seasons?: number[]
  /** Durée d'un épisode en minutes (sinon valeur par défaut selon le type). */
  episodeDuration?: number
  /** Durée totale en minutes (films / formats uniques). */
  duration?: number

  startDate?: string // AAAA-MM-JJ
  endDate?: string // AAAA-MM-JJ
  genres: string[]
  platform?: string
  /** Mon avis (visible sur mon profil, comme ma note) */
  notes?: string
  /** URL d'image ou image compressée en data URL (reste locale). */
  poster?: string
  /** Grande image horizontale (TMDB), pour l'en-tête de la fiche et l'accueil. */
  backdrop?: string
  /** Synopsis (rempli depuis TMDB / AniList). */
  overview?: string
  /** Référence dans une base externe, ex. « tmdb:tv:1396 » ou « anilist:154587 ». */
  externalId?: string
  /** Place dans un Top 5 (ex. { category: 'anime', rank: 1 }). */
  top?: TopEntry
  /** Listes perso auxquelles appartient la fiche. */
  listIds?: string[]
  /** Tags personnels libres (« comfort », « halloween »…). Privés : jamais affichés sur le profil public. */
  tags?: string[]
  /** Pays d'origine (codes ISO, ex. ['KR']). */
  countries?: string[]
  /** Dates de revisionnage (AAAA-MM-JJ), en plus du premier visionnage. */
  rewatchDates?: string[]
  /** Note moyenne du public sur 10 (TMDB ou AniList). */
  publicRating?: number
  /** Épisodes cochés par jour (AAAA-MM-JJ → nombre), pour les défis. Privé (retiré des profils publics). */
  episodeLog?: Record<string, number>

  createdAt: string // ISO
  updatedAt: string // ISO
}

export type MediaInput = Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt'>

export type RatingScale = '5' | '10'

/** Apparence : auto suit le navigateur (clair/sombre), les autres sont forcés. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'night' | 'starfield'

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
  /** Apparence (clair, sombre, nuit, bleu nuit étoilé). « auto » suit le navigateur. */
  themeMode: ThemeMode
  /** Notifications reçues (true par défaut si absent). Nécessite un compte. */
  notifPrefs?: NotifPrefs
  /** Défis de visionnage (synchronisés avec les réglages, privés). */
  challenges?: Challenge[]
}

/** Défi : « voir N films en 2026 », « 20 épisodes cette semaine »… */
export interface Challenge {
  id: string
  /** Objectif (quantité) */
  target: number
  media: MediaType | 'all'
  /** Titres terminés ou épisodes vus */
  unit: 'titles' | 'episodes'
  period: 'week' | 'month' | 'year' | 'custom'
  /** Bornes incluses, AAAA-MM-JJ */
  start: string
  end: string
  name?: string
  archived?: boolean
}

/** Types de notifications que l'on choisit de recevoir (true par défaut). */
export interface NotifPrefs {
  /** Nouveaux épisodes / saisons des séries suivies */
  episodes?: boolean
  /** Nouveaux abonnés et demandes d'abonnement */
  follows?: boolean
  /** Demandes d'abonnement acceptées */
  accepted?: boolean
  /** Réactions reçues sur mes avis */
  reactions?: boolean
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
