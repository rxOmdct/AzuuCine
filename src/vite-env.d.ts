/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du projet Supabase (publique) */
  readonly VITE_SUPABASE_URL?: string
  /** Clé publique « anon » / « publishable » de Supabase (publique par nature, protégée par les règles RLS) */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
