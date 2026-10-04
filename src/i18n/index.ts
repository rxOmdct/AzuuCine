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
export type Translations = { [K in RawKey]: string }

export type Lang = 'fr' | 'en' | 'es' | 'it' | 'de' | 'pt' | 'zh' | 'ja' | 'ko'

export interface LangInfo {
  code: Lang
  /** Nom de la langue dans cette langue */
  label: string
  /** Format des dates et nombres */
  locale: string
  /** Langue demandée à TMDB (titres, résumés) */
  tmdb: string
}

export const LANGS: LangInfo[] = [
  { code: 'fr', label: 'Français', locale: 'fr-FR', tmdb: 'fr-FR' },
  { code: 'en', label: 'English', locale: 'en-US', tmdb: 'en-US' },
  { code: 'es', label: 'Español', locale: 'es-ES', tmdb: 'es-ES' },
  { code: 'it', label: 'Italiano', locale: 'it-IT', tmdb: 'it-IT' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE', tmdb: 'de-DE' },
  { code: 'pt', label: 'Português', locale: 'pt-BR', tmdb: 'pt-BR' },
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
  zh: () => import('./locales/zh'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
}

const STORAGE_KEY = 'azuucine:lang'

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in BY_CODE

/** Langue enregistrée, sinon celle du téléphone, sinon le français. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    /* ignore */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l?.slice(0, 2).toLowerCase()
    if (isLang(code)) return code
  }
  return 'fr'
}

let current: Lang = 'fr'
let dict: Partial<Translations> = fr
let plural = new Intl.PluralRules('fr-FR')

export const getLang = () => current
/** Locale BCP 47 pour toLocaleDateString / Intl */
export const locale = () => BY_CODE[current].locale
export const tmdbLanguage = () => BY_CODE[current].tmdb

/** Charge la langue et l'active (à attendre avant d'afficher l'interface). */
export async function loadLang(code: Lang): Promise<void> {
  const next = code === 'fr' ? fr : (await loaders[code]()).default
  current = code
  dict = next
  plural = new Intl.PluralRules(BY_CODE[code].locale)
  document.documentElement.lang = code
  try {
    localStorage.setItem(STORAGE_KEY, code)
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

/** Pays associé à la langue (plateformes de streaming, sorties cinéma) : FR, US, ES… */
export const region = () => BY_CODE[current].locale.split('-')[1]
