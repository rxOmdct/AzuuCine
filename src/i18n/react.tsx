import { Fragment, createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { getLang, LANGS, loadLang, t, type Lang } from '.'

interface LangApi {
  lang: Lang
  setLang: (l: Lang) => Promise<void>
}

const LangContext = createContext<LangApi>({ lang: 'fr', setLang: async () => {} })

// Caches qui contiennent du texte déjà traduit (libellés des sorties) : à refaire dans la nouvelle langue
const TRANSLATED_CACHES = ['azuucine:releases', 'azuucine:global-releases']

/** Langue active. Changer de langue ré-affiche toute l'app (les données ne bougent pas). */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(getLang)
  const setLang = useCallback(async (l: Lang) => {
    if (l === getLang()) return
    await loadLang(l)
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
    <LangContext.Provider value={{ lang, setLang }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)

/** Sélecteur de langue (noms dans leur propre langue). */
export function LanguageSelect({ className }: { className?: string }) {
  const { lang, setLang } = useLang()
  return (
    <select
      value={lang}
      onChange={(e) => void setLang(e.target.value as Lang)}
      className={className ?? 'field'}
      aria-label={t('settings.language')}
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
