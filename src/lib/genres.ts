import { t, type TKey } from '../i18n'
import { normalizeText } from './utils'

/**
 * Genres : ils sont enregistrés sous un nom de référence (français, pour rester compatibles avec
 * les anciennes fiches et sauvegardes) et affichés dans la langue choisie.
 */
const CANONICAL: [string, TKey][] = [
  ['Action', 'genre.action'],
  ['Aventure', 'genre.adventure'],
  ['Animation', 'genre.animation'],
  ['Anime', 'genre.anime'],
  ['Comédie', 'genre.comedy'],
  ['Comédie romantique', 'genre.romanticComedy'],
  ['Rom-com', 'genre.romcom'],
  ['Policier', 'genre.crime'],
  ['Documentaire', 'genre.documentary'],
  ['Drame', 'genre.drama'],
  ['Famille', 'genre.family'],
  ['Fantasy', 'genre.fantasy'],
  ['Historique', 'genre.historical'],
  ['Horreur', 'genre.horror'],
  ['Musical', 'genre.musical'],
  ['Musique', 'genre.music'],
  ['Mystère', 'genre.mystery'],
  ['Romance', 'genre.romance'],
  ['Sci-Fi', 'genre.scifi'],
  ['Téléfilm', 'genre.tvMovie'],
  ['Thriller', 'genre.thriller'],
  ['Guerre', 'genre.war'],
  ['Western', 'genre.western'],
  ['Enfants', 'genre.kids'],
  ['Actualités', 'genre.news'],
  ['Télé-réalité', 'genre.reality'],
  ['Feuilleton', 'genre.soap'],
  ['Talk-show', 'genre.talk'],
  ['Politique', 'genre.politics'],
  ['Ecchi', 'genre.ecchi'],
  ['Magical Girl', 'genre.magicalGirl'],
  ['Mecha', 'genre.mecha'],
  ['Psychologique', 'genre.psychological'],
  ['Slice of Life', 'genre.sliceOfLife'],
  ['Sport', 'genre.sports'],
  ['Surnaturel', 'genre.supernatural'],
  ['Shōnen', 'genre.shonen'],
  ['Shōjo', 'genre.shojo'],
  ['Seinen', 'genre.seinen'],
  ['Isekai', 'genre.isekai'],
  ['Médical', 'genre.medical'],
  ['Juridique', 'genre.legal'],
  ['Wuxia', 'genre.wuxia'],
  ['Xianxia', 'genre.xianxia'],
]

// Anciennes variantes rencontrées dans les fiches
const ALIASES: Record<string, string> = {
  familial: 'Famille',
  histoire: 'Historique',
  crime: 'Policier',
  'science-fiction': 'Sci-Fi',
  fantastique: 'Fantasy',
}

const KEY_BY_NAME = new Map(CANONICAL.map(([name, key]) => [normalizeText(name), key]))

/** Nom affiché d'un genre enregistré (inchangé si le genre est inconnu, ex. saisi à la main). */
export function genreLabel(stored: string): string {
  const n = normalizeText(stored)
  const key = KEY_BY_NAME.get(n) ?? KEY_BY_NAME.get(normalizeText(ALIASES[n] ?? ''))
  return key ? t(key) : stored
}

/** Nom de référence à enregistrer, à partir d'un texte saisi dans n'importe quelle langue de l'app. */
export function canonicalGenre(input: string): string {
  const n = normalizeText(input)
  for (const [name, key] of CANONICAL) if (normalizeText(t(key)) === n || normalizeText(name) === n) return name
  return ALIASES[n] ?? input.trim()
}

/** Genres TMDB (identifiants universels) → noms de référence */
const TMDB_GENRES: Record<number, string[]> = {
  28: ['Action'],
  12: ['Aventure'],
  16: ['Animation'],
  35: ['Comédie'],
  80: ['Policier'],
  99: ['Documentaire'],
  18: ['Drame'],
  10751: ['Famille'],
  14: ['Fantasy'],
  36: ['Historique'],
  27: ['Horreur'],
  10402: ['Musique'],
  9648: ['Mystère'],
  10749: ['Romance'],
  878: ['Sci-Fi'],
  10770: ['Téléfilm'],
  53: ['Thriller'],
  10752: ['Guerre'],
  37: ['Western'],
  10759: ['Action', 'Aventure'],
  10762: ['Enfants'],
  10763: ['Actualités'],
  10764: ['Télé-réalité'],
  10765: ['Sci-Fi', 'Fantasy'],
  10766: ['Feuilleton'],
  10767: ['Talk-show'],
  10768: ['Guerre', 'Politique'],
}

export function tmdbGenres(ids: number[]): string[] {
  return [...new Set(ids.flatMap((id) => TMDB_GENRES[id] ?? []))]
}

/** Suggestions proposées à la saisie (dans la langue choisie) */
export const genreSuggestions = () =>
  [
    'Action', 'Aventure', 'Comédie', 'Drame', 'Romance', 'Rom-com', 'Thriller', 'Horreur', 'Mystère', 'Policier', 'Sci-Fi', 'Fantasy',
    'Historique', 'Slice of Life', 'Shōnen', 'Shōjo', 'Seinen', 'Isekai', 'Mecha', 'Sport', 'Musical', 'Médical', 'Juridique', 'Wuxia',
    'Xianxia', 'Famille', 'Animation', 'Psychologique', 'Surnaturel', 'Comédie romantique', 'Documentaire',
  ].map(genreLabel)

/** Sous-types « Autre » : enregistrés en français, affichés dans la langue choisie. */
const SUBTYPES: [string, TKey][] = [
  ['Documentaire', 'subtype.documentary'],
  ['Télé-réalité', 'subtype.reality'],
  ['Émission', 'subtype.show'],
  ['Court-métrage', 'subtype.short'],
  ['Spectacle', 'subtype.stage'],
  ['Mini-série', 'subtype.miniseries'],
]
const SUBTYPE_KEY = new Map(SUBTYPES.map(([name, key]) => [normalizeText(name), key]))

export const subtypeLabel = (stored: string) => {
  const key = SUBTYPE_KEY.get(normalizeText(stored))
  return key ? t(key) : stored
}
export const canonicalSubtype = (input: string) => {
  const n = normalizeText(input)
  for (const [name, key] of SUBTYPES) if (normalizeText(t(key)) === n || normalizeText(name) === n) return name
  return input.trim()
}
export const subtypeSuggestions = () => SUBTYPES.map(([, key]) => t(key))
