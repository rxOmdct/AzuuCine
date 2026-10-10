/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du projet Supabase (publique) */
  readonly VITE_SUPABASE_URL?: string
  /** Clé publique « anon » / « publishable » de Supabase (publique par nature, protégée par les règles RLS) */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** « 1 » : remonter aussi les erreurs en mode dev (tests) */
  readonly VITE_REPORT_ERRORS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Version de l'app (package.json), injectée par vite.config.ts */
declare const __APP_VERSION__: string
