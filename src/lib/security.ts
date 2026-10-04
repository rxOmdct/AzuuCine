/**
 * Garde-fous de sécurité.
 *
 * Tout ce qui vient de l'extérieur est considéré comme non fiable :
 *  - fichiers JSON importés (sauvegardes, ancienne appli),
 *  - réponses de TMDB / AniList,
 *  - contenu du localStorage (peut avoir été modifié à la main).
 *
 * React échappe déjà le texte affiché (pas d'injection HTML possible) ; ces fonctions
 * empêchent en plus les URLs piégées, les identifiants détournés et les données énormes.
 */

/** Hôtes autorisés pour les images distantes (doit rester cohérent avec la CSP). */
const IMAGE_HOSTS = ['image.tmdb.org', 's4.anilist.co']

/** Types d'images acceptés en data URL. */
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/]+=*$/i

export const LIMITS = {
  importFileBytes: 30 * 1024 * 1024, // 30 Mo
  imageFileBytes: 25 * 1024 * 1024, // photo choisie dans la galerie
  items: 20000,
  lists: 500,
  title: 300,
  shortText: 120, // plateforme, sous-type, genre, nom de liste…
  notes: 20000,
  overview: 10000,
  genres: 40,
  posterDataUrl: 3 * 1024 * 1024, // ~3 Mo par affiche en data URL
  searchQuery: 200,
}

/** Coupe une chaîne trop longue et retire les caractères de contrôle invisibles. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

/** Identifiant interne : lettres, chiffres, tirets, max 64 caractères. */
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

/**
 * Référence vers une base externe. Format strict pour qu'un fichier piégé ne puisse pas
 * faire appeler une autre adresse de l'API (ex. « tmdb:tv:../../account »).
 */
export function isSafeExternalId(value: unknown): value is string {
  return typeof value === 'string' && /^(tmdb:(movie|tv):\d{1,10}|anilist:\d{1,10})$/.test(value)
}

/** Chemin d'affiche TMDB (« /abc123.jpg »). */
export function isSafeTmdbPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i.test(value)
}

/**
 * Affiche acceptée : image embarquée (data:image/…) de taille raisonnable,
 * ou image HTTPS venant uniquement de TMDB / AniList. Tout le reste est ignoré
 * (pas de javascript:, pas de pistage via une image d'un autre site…).
 */
export function safePosterUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (v.startsWith('data:')) return v.length <= LIMITS.posterDataUrl && DATA_IMAGE.test(v) ? v : undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined
    return IMAGE_HOSTS.includes(u.hostname) ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** Date au format AAAA-MM-JJ valide. */
export function safeDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const d = new Date(value + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? undefined : value
}

/** Date-heure ISO valide (ou undefined). */
export function safeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Liste de chaînes courtes, dédoublonnée et limitée. */
export function safeStringList(value: unknown, maxItems: number, maxLen = LIMITS.shortText): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    const s = cleanText(v, maxLen)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

/** Codes pays ISO (2 lettres majuscules). */
export function safeCountries(value: unknown): string[] | undefined {
  const list = safeStringList(value, 10, 3)
    .filter((c) => /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase())
  return list.length ? list : undefined
}

/** Couleur hexadécimale #rrggbb. */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Lecture JSON sûre depuis le localStorage (valeur par défaut si absent ou corrompu). */
export function readStorage<T>(key: string, fallback: T): unknown | T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw || raw.length > 5 * 1024 * 1024) return fallback
    return JSON.parse(raw) as unknown
  } catch {
    return fallback
  }
}

/** Objet « simple » (pas un tableau, pas null). */
export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/** Épisodes par saison : liste d'entiers bornée (au plus 100 saisons). */
export function safeSeasons(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.slice(0, 100).map((n) => (typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 5000 ? n : 0))
  return out.length > 1 && out.every((n) => n > 0) ? out : undefined
}

/** Image distante autorisée (jamais d'image intégrée : la grande image n'est qu'un décor). */
export function remoteImage(value: unknown): string | undefined {
  const url = safePosterUrl(value)
  return url && !url.startsWith('data:') && url.length <= 300 ? url : undefined
}
