# AzuuCine — contexte projet (lu automatiquement par Claude Code)

PWA de suivi de films, séries, animes, K-dramas et C-dramas. Interface en français
(18 langues). Thème sombre par défaut, accent rouge, sans dégradés, police Inter.

## Stack
- **Vite + React 19 + TypeScript**, **Tailwind CSS v4**, PWA (vite-plugin-pwa, service worker auto-update).
- **Supabase** (Postgres + Auth + Storage + Edge Functions) pour les comptes et le social.
- Local-first : IndexedDB par utilisateur + outbox + synchro last-write-wins.
- Dossier local : `C:\Users\romai\Documents\FICHIER\PROJET\AzuuCine`.

## Lancer / vérifier
```bash
npm install
npm run dev          # dev local
npm run typecheck    # tsc --noEmit  ← LANCER APRÈS CHAQUE MODIF, doit finir sans erreur
npm run build        # build de prod
```

## Déploiement
- Remote git : **Gitea** `https://gitea.rdacet.fr/romain/azuucine.git` (branche `main`).
- Push via **PowerShell** : `git push` (GitHub Desktop n'authentifie pas Gitea).
- **Gitea Actions** (`.gitea/workflows/deploy.yml`) build et publie sur le **VPS** (nginx en LXC) à chaque push sur `main`. Site : https://azuucine.rdacet.fr
- `vite.config.ts` contient un garde-fou : le build échoue si `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` manquent en CI (variables/secrets Gitea Actions). La CSP et les en-têtes de sécurité y sont aussi définis (source unique → convertis en conf nginx par `deploy/headers-to-nginx.mjs`).

## Supabase
- Project ref : `qfgnxonqwldcfdjqhhjz` — URL `https://qfgnxonqwldcfdjqhhjz.supabase.co`
- Clé **publishable** (publique, déjà dans le bundle client) : `sb_publishable_s459lWM86bjiteGzWxSYcw_WbiRYydR`
- **Secrets (JAMAIS dans le dépôt, jamais dans .env/VITE_)** : la clé TMDB et la `service_role` vivent dans les **secrets Supabase** / Edge Functions. Ne jamais les committer ni les coller dans le chat.
- **Migrations** : `supabase/migrations/*.sql`. ⚠️ L'outil MCP `apply_migration` **tombe souvent en timeout** sur ce projet (création de fonctions). **Appliquer le SQL en le collant dans Supabase → SQL Editor → Run.** Tous les fichiers sont écrits **idempotents** (`create or replace`, `if not exists`, `drop ... if exists`).
- Edge functions : `tmdb` (proxy pour cacher la clé TMDB), `delete-account`. Storage bucket `profile-media`.
- Compte **admin** = Romain, user id `4529202d-618c-4b40-ab13-228eef3f71ad` (table `public.admins`).

### Règles de sécurité Supabase (NON négociables — « aucune faille »)
- **RLS activé partout** ; chaque utilisateur ne voit que ses données.
- Toute fonction exposée est **`security definer` + `set search_path = ''`** et **vérifie les droits en interne** (`auth.uid()`, `can_view()`, `is_admin()`), puis `revoke ... from public, anon` / `grant execute ... to authenticated`.
- La clé TMDB ne doit jamais fuiter côté client (passe par l'edge function `tmdb`).

## Architecture client (repères)
- `src/store.tsx` — fournisseur de données (IndexedDB = source locale, état React = copie de travail), synchro, thème.
- `src/lib/cloud/` — `auth.ts` (GoTrue maison, PKCE Google), `sync.ts` (push/pull LWW), `social.ts`, `admin.ts`, `reviews.ts`, `notifications.ts`, `api.ts` (`cloudFetch`).
- `src/lib/airing.ts` — suivi des sorties d'épisodes (TMDB/AniList), cache local.
- `src/lib/franchise.ts` — saisons & dédoublonnage de franchises (TMDB 1 fiche multi-saisons vs AniList 1 entrée/saison).
- `src/components/social/` — profils, recherche, fil d'amis, avis par titre (`TitleReviews`), réactions (`Reactions`), notifications (`Notifications`), aperçu d'une fiche (`ItemPeek`), `SocialProvider` (pile d'overlays).
- `src/pages/` — `HomePage`, `CatalogPage`, `StatsPage`, `SettingsPage`, `AdminPage`.
- `src/App.tsx` — shell + routes par hash (`#/home`, `#/admin`…), `BottomNav` (mobile) + `SideNav` (desktop ≥ lg).

## i18n (IMPORTANT)
- 18 langues dans `src/i18n/locales/*.ts`. **`fr` est la référence** : toute clé doit exister dans **toutes** les langues (sinon erreur TS).
- Textes vus par les membres → traduire dans les 18. Un écran réservé à l'admin → `fr` + `en` suffit.
- Clés plurielles `xxx_one`/`xxx_other` (+ `_few`/`_many` pour ar/ru/pl). Variables `{x}`.
- Thèmes d'apparence : `auto` (suit le navigateur), `light`, `dark`, `night`, `starfield` (fond étoilé CSS). Toujours utiliser les **tokens de thème** (`bg-bg`, `text-ink`, `bg-accent-fill`…), **jamais de couleur hex en dur**.

## Conventions
- `npm run typecheck` doit passer après chaque modif.
- Ne pas mettre `localStorage`/`sessionStorage` sans try/catch.
- Garder les fichiers idempotents côté SQL.
- RTL géré (arabe) : préférer les classes logiques (`ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`, `border-e`).

## État / en attente (au 9 oct. 2026)
- Appliqués en ligne : tout jusqu'à `20261008150000`, + `20261009110000_private_tags` et `20261009140000_challenges`.
- **À coller dans SQL Editor** : `supabase/A_COLLER_2026-10-09.sql` (commentaires/spoilers, listes partagées, web push, modération, bugs/erreurs). Idempotent.
- Edge functions déployées : `tmdb` v4 (watch/providers, /find), `send-push` v1.
- Push : générer les clés (`node scripts/gen-vapid.mjs`), 4 secrets Edge Functions + `azuu_push_secret` dans Vault → voir `supabase/PUSH_SETUP.md`.
- Sauvegardes : secrets Gitea `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`, préparation du VPS → voir `deploy/BACKUP.md`.
- Recommandé : activer **Leaked Password Protection** (Authentication → Passwords) ; supprimer `_tmp_ping2` / `_tmp_sd2`.
