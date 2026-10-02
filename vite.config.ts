import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Politique de sécurité du contenu (CSP) : le navigateur n'exécute que les scripts de l'app,
 * et ne contacte que TMDB / AniList. Même si une donnée piégée arrivait à s'afficher,
 * elle ne pourrait ni lancer de code, ni envoyer tes données ailleurs.
 */
export const buildCsp = (supabaseUrl = '') => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://image.tmdb.org https://s4.anilist.co${supabaseUrl ? ' ' + supabaseUrl : ''}`,
  "font-src 'self'",
  `connect-src 'self' https://api.themoviedb.org https://graphql.anilist.co https://image.tmdb.org https://s4.anilist.co${supabaseUrl ? ' ' + supabaseUrl : ''}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ')

/**
 * Ajoute la CSP dans index.html et génère _headers, uniquement pour la version publiée
 * (le mode dev a besoin de plus de souplesse). L'adresse Supabase du .env y est ajoutée si présente.
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  const csp = buildCsp(supabaseUrl)
  return {
    name: 'azuucine-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
    // En-têtes de sécurité pour l'hébergement (Netlify et Cloudflare Pages lisent ce fichier)
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
          '  X-Frame-Options: DENY',
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: no-referrer',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()',
          '  Cross-Origin-Opener-Policy: same-origin',
          '  Cross-Origin-Resource-Policy: same-origin',
          '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
          '',
          '# Le service worker doit toujours être revérifié pour que les mises à jour arrivent',
          '/sw.js',
          '  Cache-Control: no-cache',
          '',
        ].join('\n'),
      })
    },
  }
}

// Si tu héberges l'app dans un sous-dossier (ex. GitHub Pages : /azuucine/),
// remplace base: '/' par base: '/azuucine/'.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const origin = (env.VITE_SUPABASE_URL ?? '').trim().replace(/^(https?:\/\/[^/]+).*$/, '$1')
  const supabaseUrl = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(origin) ? origin : ''
  return {
  base: '/',
  // Le serveur de dev n'écoute que sur ce PC (voir « npm run dev:mobile » pour tester sur le téléphone)
  server: { host: 'localhost', strictPort: false },
  preview: { host: 'localhost' },
  build: { sourcemap: false },
  plugins: [
    contentSecurityPolicy(supabaseUrl),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'AzuuCine',
        short_name: 'AzuuCine',
        description: 'Mon journal privé de films, séries, animes et dramas',
        lang: 'fr',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        // Les affiches AniList ne peuvent pas être copiées dans la base (CORS) :
        // on les garde en cache après le premier affichage pour les voir hors-ligne.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(s4\.anilist\.co|image\.tmdb\.org)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'posters',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}
})
