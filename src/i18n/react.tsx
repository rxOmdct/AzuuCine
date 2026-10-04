import { Fragment, createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { detectLang, getLang, isLangChosen, LANGS, loadLang, t, type Lang } from '.'

interface LangApi {
  lang: Lang
  /** Langue automatique (selon le pays où l'on se trouve) */
  auto: boolean
  setLang: (l: Lang | 'auto') => Promise<void>
}

const LangContext = createContext<LangApi>({ lang: 'fr', auto: true, setLang: async () => {} })

// Caches qui contiennent du texte déjà traduit (libellés des sorties) : à refaire dans la nouvelle langue
const TRANSLATED_CACHES = ['azuucine:releases', 'azuucine:global-releases']

/** Langue active. Changer de langue ré-affiche toute l'app (les données ne bougent pas). */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(getLang)
  const [auto, setAuto] = useState(() => !isLangChosen())
  const setLang = useCallback(async (choice: Lang | 'auto') => {
    const l = choice === 'auto' ? detectLang() : choice
    setAuto(choice === 'auto')
    if (l === getLang()) {
      await loadLang(l, choice === 'auto' ? null : true)
      return
    }
    await loadLang(l, choice === 'auto' ? null : true)
    for (const k of TRANSLATED_CACHES) {
      try {
        localStorage.removeItem(k)
      } catch {
        /* ignore */
      }
    }
    setState(l)
  }, [])
  return (
    <LangContext.Provider value={{ lang, auto, setLang }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)

/** Sélecteur de langue (noms dans leur propre langue). */
export function LanguageSelect({ className }: { className?: string }) {
  const { lang, auto, setLang } = useLang()
  const detected = LANGS.find((l) => l.code === detectLang())
  return (
    <select
      value={auto ? 'auto' : lang}
      onChange={(e) => void setLang(e.target.value as Lang | 'auto')}
      className={className ?? 'field'}
      aria-label={t('settings.language')}
    >
      <option value="auto">{t('settings.langAuto', { lang: detected?.label ?? '' })}</option>
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
