import fr from './locales/fr'

/**
 * Traductions de l'interface, sans dépendance.
 *  - Le français est la langue de référence (src/i18n/locales/fr.ts) : chaque clé existe dans toutes les langues.
 *  - Les autres langues sont chargées à la demande (une seule à la fois).
 *  - Pluriels : clés « xxx_one » / « xxx_other » (+ « _zero », « _few », « _many » si besoin), choisies avec Intl.PluralRules.
 *  - Variables : « {name} » dans le texte, remplacées par t(key, { name }).
 */

export type Dict = typeof fr
type RawKey = keyof Dict
/** Clés plurielles appelées sans suffixe : t('titles', { count }) */
type PluralBase = RawKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never
type SuffixedPlural = RawKey extends infer K ? (K extends `${string}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? K : never) : never
export type TKey = Exclude<RawKey, SuffixedPlural> | PluralBase
// Les langues aux pluriels plus riches (arabe, russe, polonais…) ajoutent des clés « _two », « _few », « _many »
export type Translations = { [K in RawKey]: string } & Record<string, string>

export type Lang = 'fr' | 'en' | 'es' | 'it' | 'de' | 'pt' | 'nl' | 'pl' | 'ru' | 'tr' | 'ar' | 'hi' | 'id' | 'th' | 'vi' | 'zh' | 'ja' | 'ko'

export interface LangInfo {
  code: Lang
  /** Nom de la langue dans cette langue */
  label: string
  /** Format des dates et nombres */
  locale: string
  /** Langue demandée à TMDB (titres, résumés) */
  tmdb: string
  /** Écriture de droite à gauche */
  rtl?: boolean
}

export const LANGS: LangInfo[] = [
  { code: 'fr', label: 'Français', locale: 'fr-FR', tmdb: 'fr-FR' },
  { code: 'en', label: 'English', locale: 'en-US', tmdb: 'en-US' },
  { code: 'es', label: 'Español', locale: 'es-ES', tmdb: 'es-ES' },
  { code: 'it', label: 'Italiano', locale: 'it-IT', tmdb: 'it-IT' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE', tmdb: 'de-DE' },
  { code: 'pt', label: 'Português', locale: 'pt-BR', tmdb: 'pt-BR' },
  { code: 'nl', label: 'Nederlands', locale: 'nl-NL', tmdb: 'nl-NL' },
  { code: 'pl', label: 'Polski', locale: 'pl-PL', tmdb: 'pl-PL' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU', tmdb: 'ru-RU' },
  { code: 'tr', label: 'Türkçe', locale: 'tr-TR', tmdb: 'tr-TR' },
  { code: 'ar', label: 'العربية', locale: 'ar-SA', tmdb: 'ar-SA', rtl: true },
  { code: 'hi', label: 'हिन्दी', locale: 'hi-IN', tmdb: 'hi-IN' },
  { code: 'id', label: 'Bahasa Indonesia', locale: 'id-ID', tmdb: 'id-ID' },
  { code: 'th', label: 'ไทย', locale: 'th-TH', tmdb: 'th-TH' },
  { code: 'vi', label: 'Tiếng Việt', locale: 'vi-VN', tmdb: 'vi-VN' },
  { code: 'zh', label: '中文', locale: 'zh-CN', tmdb: 'zh-CN' },
  { code: 'ja', label: '日本語', locale: 'ja-JP', tmdb: 'ja-JP' },
  { code: 'ko', label: '한국어', locale: 'ko-KR', tmdb: 'ko-KR' },
]
const BY_CODE = Object.fromEntries(LANGS.map((l) => [l.code, l])) as Record<Lang, LangInfo>

const loaders: Record<Exclude<Lang, 'fr'>, () => Promise<{ default: Translations }>> = {
  en: () => import('./locales/en'),
  es: () => import('./locales/es'),
  it: () => import('./locales/it'),
  de: () => import('./locales/de'),
  pt: () => import('./locales/pt'),
  nl: () => import('./locales/nl'),
  pl: () => import('./locales/pl'),
  ru: () => import('./locales/ru'),
  tr: () => import('./locales/tr'),
  ar: () => import('./locales/ar'),
  hi: () => import('./locales/hi'),
  id: () => import('./locales/id'),
  th: () => import('./locales/th'),
  vi: () => import('./locales/vi'),
  zh: () => import('./locales/zh'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
}

const STORAGE_KEY = 'azuucine:lang'

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in BY_CODE

/**
 * Pays où se trouve l'appareil, d'après son fuseau horaire (aucune requête réseau, aucune géolocalisation).
 * Pour un pays à plusieurs langues, on prend celle du téléphone si elle en fait partie.
 */
const ZONES: [RegExp, string, Lang[]][] = [
  [/^Europe\/(Paris|Monaco)$|^Indian\/Reunion$|^America\/(Martinique|Guadeloupe|Cayenne)$|^Pacific\/(Tahiti|Noumea)$/, 'FR', ['fr']],
  [/^Europe\/Brussels$/, 'BE', ['fr', 'nl', 'de']],
  [/^Europe\/(Zurich|Busingen)$/, 'CH', ['de', 'fr', 'it']],
  [/^Europe\/Luxembourg$/, 'LU', ['fr', 'de']],
  [/^America\/(Montreal|Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/, 'CA', ['en', 'fr']],
  [/^Africa\/(Abidjan|Dakar|Bamako|Ouagadougou|Niamey|Conakry|Lome|Porto-Novo|Libreville|Douala|Kinshasa|Brazzaville|Bangui|Ndjamena)$|^Indian\/Antananarivo$/, '', ['fr']],
  [/^Europe\/(London|Dublin)$/, 'GB', ['en']],
  [/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)$|^Pacific\/Honolulu$/, 'US', ['en', 'es']],
  [/^Australia\/|^Pacific\/Auckland$/, 'AU', ['en']],
  [/^Europe\/Madrid$|^Atlantic\/Canary$/, 'ES', ['es']],
  [/^America\/(Mexico_City|Bogota|Lima|Santiago|Caracas|Guayaquil|La_Paz|Asuncion|Montevideo|Panama|Costa_Rica|Guatemala|El_Salvador|Tegucigalpa|Managua|Havana|Santo_Domingo|Puerto_Rico|Tijuana|Monterrey|Cancun)$|^America\/Argentina\//, '', ['es']],
  [/^Europe\/(Rome|Vatican|San_Marino)$/, 'IT', ['it']],
  [/^Europe\/(Berlin|Vienna)$/, 'DE', ['de']],
  [/^Europe\/Lisbon$|^Atlantic\/(Azores|Madeira)$/, 'PT', ['pt']],
  [/^America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Manaus|Belem|Cuiaba|Porto_Velho|Rio_Branco|Maceio|Araguaina|Campo_Grande)$/, 'BR', ['pt']],
  [/^Africa\/(Luanda|Maputo)$/, '', ['pt']],
  [/^Europe\/Amsterdam$|^America\/Paramaribo$/, 'NL', ['nl']],
  [/^Europe\/Warsaw$/, 'PL', ['pl']],
  [/^Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Kirov|Astrakhan|Saratov|Ulyanovsk|Minsk)$|^Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Bishkek)$/, 'RU', ['ru']],
  [/^Europe\/Istanbul$|^Asia\/Istanbul$/, 'TR', ['tr']],
  [/^Asia\/(Riyadh|Dubai|Kuwait|Qatar|Bahrain|Muscat|Aden|Baghdad|Amman|Beirut|Damascus|Gaza|Hebron)$|^Africa\/(Cairo|Tripoli|Tunis|Algiers|Casablanca|El_Aaiun|Khartoum|Nouakchott)$/, '', ['ar', 'fr']],
  [/^Asia\/(Kolkata|Calcutta)$/, 'IN', ['hi', 'en']],
  [/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/, 'ID', ['id']],
  [/^Asia\/Bangkok$/, 'TH', ['th']],
  [/^Asia\/(Ho_Chi_Minh|Saigon)$/, 'VN', ['vi']],
  [/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Hong_Kong|Macau|Taipei)$/, '', ['zh']],
  [/^Asia\/Singapore$/, 'SG', ['en', 'zh']],
  [/^Asia\/Tokyo$/, 'JP', ['ja']],
  [/^Asia\/Seoul$/, 'KR', ['ko']],
]

function browserLangs(): Lang[] {
  const out: Lang[] = []
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l?.slice(0, 2).toLowerCase()
    if (isLang(code) && !out.includes(code)) out.push(code)
  }
  return out
}

/** Langue du pays où l'on se trouve (fuseau horaire), sinon celle du téléphone, sinon l'anglais. */
export function detectLang(): Lang {
  const browser = browserLangs()
  let zone = ''
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    /* ignore */
  }
  const hit = ZONES.find(([re]) => re.test(zone))
  if (hit) return hit[2].find((l) => browser.includes(l)) ?? hit[2][0]
  return browser[0] ?? 'en'
}

/** Pays détecté (pour les plateformes de streaming et les sorties cinéma). */
function detectRegion(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    return ZONES.find(([re]) => re.test(zone))?.[1] || undefined
  } catch {
    return undefined
  }
}

/** La langue a-t-elle été choisie à la main ? (sinon : automatique) */
export function isLangChosen(): boolean {
  try {
    return isLang(localStorage.getItem(STORAGE_KEY))
  } catch {
    return false
  }
}

/** Langue choisie, sinon automatique. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    /* ignore */
  }
  return detectLang()
}

let current: Lang = 'fr'
let dict: Partial<Translations> = fr
let plural = new Intl.PluralRules('fr-FR')

export const getLang = () => current
/** Locale BCP 47 pour toLocaleDateString / Intl */
export const locale = () => BY_CODE[current].locale
export const tmdbLanguage = () => BY_CODE[current].tmdb

/** Charge la langue et l'active. `remember` : choix fait à la main (null = revenir à l'automatique). */
export async function loadLang(code: Lang, remember?: boolean | null): Promise<void> {
  const next = code === 'fr' ? fr : (await loaders[code]()).default
  current = code
  dict = next
  plural = new Intl.PluralRules(BY_CODE[code].locale)
  document.documentElement.lang = code
  document.documentElement.dir = BY_CODE[code].rtl ? 'rtl' : 'ltr'
  try {
    if (remember) localStorage.setItem(STORAGE_KEY, code)
    else if (remember === null) localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function lookup(key: string): string | undefined {
  return (dict as Record<string, string>)[key] ?? (fr as Record<string, string>)[key]
}

/** Texte traduit. Les variables {x} sont remplacées ; « count » choisit la forme plurielle. */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  let text: string | undefined
  if (vars && typeof vars.count === 'number') {
    const n = vars.count
    text = (n === 0 ? lookup(`${key}_zero`) : undefined) ?? lookup(`${key}_${plural.select(n)}`) ?? lookup(`${key}_other`)
  }
  text ??= lookup(key) ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? formatVar(name, vars[name]) : m))
}

// Seuls les compteurs sont formatés (« 1 234 ») ; une année reste « 2026 »
const formatVar = (name: string, v: string | number) => (typeof v === 'number' && (name === 'count' || name === 'n') ? v.toLocaleString(locale()) : String(v))

/** Nombre formaté dans la langue active (espaces, virgules…). */
export const fmtNumber = (n: number, opts?: Intl.NumberFormatOptions) => n.toLocaleString(locale(), opts)

/** Pays de l'utilisateur (plateformes de streaming, sorties cinéma) : celui du fuseau horaire, sinon celui de la langue. */
export const region = () => detectRegion() ?? BY_CODE[current].locale.split('-')[1]
