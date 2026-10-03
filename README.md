# AzuuCine

Application personnelle (PWA) pour suivre, noter et organiser mes visionnages : films, séries, animes, K-dramas, C-dramas et autres.
Deux modes :
- **Avec comptes** (si le fichier `.env` est rempli) : chacun crée son compte, ses données sont enregistrées dans une base
  Supabase où **personne d'autre ne peut les lire**, synchronisées entre ses appareils, et gardées aussi sur le téléphone
  pour fonctionner sans internet. La clé TMDB reste sur le serveur.
- **100 % local** (sans `.env`) : comme avant, tout reste dans le navigateur de l'appareil.

## Stack

- **Vite + React 19 + TypeScript**
- **Tailwind CSS v4** (thème sombre par défaut)
- **vite-plugin-pwa** : manifeste, icônes, service worker (fonctionne hors-ligne)
- **IndexedDB** via un petit wrapper maison (`src/lib/db.ts`), sans dépendance
- **lucide-react** pour les icônes
- Police **Inter** embarquée via `@fontsource` (aucun appel à Google Fonts)
- Recherche en ligne : **TMDB** (films, séries, dramas) et **AniList** (animes)
- Comptes : **Supabase** (Auth + Postgres + Edge Functions), appelé sans dépendance (`src/lib/cloud/`)

## Design

Fond noir + une couleur d'accent au choix (Réglages → Thème : 12 couleurs prêtes ou couleur libre, rouge par défaut), sobre, typographie simple façon Letterboxd (Inter partout, petites capitales grises pour les sections),
boutons en pilule, filets de 1px, **aucun dégradé ni ombre**. Les couleurs sont définies dans `src/index.css` (`@theme`).

## Arborescence

```
AzuuCine/
├── index.html                 # méta iOS/Android (plein écran, icône, barre d'état)
├── vite.config.ts             # config Vite + manifeste PWA
├── public/icons/              # icônes de l'app (192, 512, maskable, apple-touch)
└── src/
    ├── main.tsx               # point d'entrée + enregistrement du service worker
    ├── Root.tsx               # écran de connexion si les comptes sont activés
    ├── App.tsx                # navigation par onglets (#/home, #/catalog…)
    ├── store.tsx              # service de données : CRUD, +1 épisode, import (React Context)
    ├── types.ts               # modèle MediaItem
    ├── index.css              # thème Tailwind + composants (.field, .chip, .btn…)
    ├── lib/
    │   ├── db.ts              # IndexedDB (une base par compte)
    │   ├── cloud/             # comptes : connexion, synchronisation, proxy TMDB
    │   ├── backup.ts          # export / import JSON + validation des fiches
    │   ├── catalogApi.ts      # recherche TMDB + AniList, détection du type (K-drama, anime…)
    │   ├── stats.ts           # statistiques et estimation du temps passé
    │   ├── constants.ts       # types, statuts, critères, genres, plateformes
    │   ├── image.ts           # compression des affiches importées depuis la galerie
    │   └── utils.ts
    ├── components/            # BottomNav, MediaCard, MediaForm, Rating, TagInput, Poster…
    └── pages/                 # Accueil, Catalogue, Statistiques, Réglages
supabase/
├── migrations/…_azuucine.sql  # tables + règles de sécurité (RLS) à exécuter une fois
└── functions/                 # fonctions serveur : tmdb (proxy avec ta clé), delete-account
```

## Sécurité

**Code public, données privées.** Tu peux publier le code sans risque : rien de secret n'est dedans.

- **Ce qui est public (normal)** : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` finissent dans l'app, donc lisibles par
  n'importe qui. C'est prévu ainsi : elles ne donnent accès qu'à ce que les règles de la base autorisent.
- **Ce qui est secret** : ta clé TMDB (`TMDB_API_KEY`) et la clé `service_role` vivent **uniquement dans les secrets
  Supabase**, côté serveur. Elles ne sont ni dans le code, ni dans `.env`, ni dans l'app. ⚠️ Ne mets jamais une clé
  secrète dans une variable `VITE_…` : tout ce qui commence par `VITE_` est envoyé au navigateur.
- **Isolation des comptes** : Row Level Security sur toutes les tables (`user_id = auth.uid()`), vérifiée par la base
  elle-même. Même avec la clé publique, impossible de lire ou modifier les données d'un autre compte.
- **Profils** : les autres membres ne lisent jamais les tables directement, seulement via des fonctions SQL qui vérifient
  l'accès (profil public, ou abonné accepté pour un compte privé) et retirent les avis non publics et les listes perso.
  Les photos ne peuvent être envoyées que dans le dossier de leur propriétaire (JPEG/PNG/WebP, 2 Mo max) ; le pseudo de
  départ est aléatoire (l'email n'est jamais montré). Les visiteurs non
  connectés n'ont accès à rien. Quotas par compte (20 000 fiches, 300 listes) et taille maximale par fiche.
- **Conflits** : la modification la plus récente gagne, vérifiée par un trigger côté serveur (un appareil resté
  hors-ligne ne peut pas écraser une version plus récente).
- **Proxy TMDB** : seuls les comptes connectés peuvent l'utiliser, uniquement pour quelques adresses et paramètres
  précis (liste blanche), avec une limite de requêtes par compte et une liste d'origines autorisées (`ALLOWED_ORIGINS`).
- **Mots de passe** : gérés par Supabase Auth (hachés, jamais stockés dans l'app). Seule la session (jetons renouvelés
  automatiquement) est gardée sur l'appareil. Déconnexion = données du compte retirées de l'appareil.
- **Données reçues** : tout ce qui vient du serveur, d'un fichier importé ou des API est revalidé et borné
  (`src/lib/security.ts`, `normalizeItem`) avant d'être affiché ou enregistré.
- **Images** : seules les images embarquées (`data:image/…`, SVG exclu) et celles de TMDB / AniList sont acceptées ;
  les photos de la galerie sont ré-encodées (les métadonnées EXIF/GPS disparaissent).
- **Affichage** : React échappe tout le texte (pas d'injection HTML possible) ; aucun `innerHTML`, aucun `eval`.
- **Politique de sécurité du contenu (CSP)** ajoutée à la version publiée : seuls les scripts de l'app s'exécutent et
  seuls TMDB / AniList / ton projet Supabase peuvent être contactés. Le fichier `_headers` généré au build ajoute les
  en-têtes de sécurité (repris par nginx sur le VPS, Netlify ou Cloudflare Pages) (anti-iframe, HSTS, pas de référent…).
- **Serveur de développement** : `npm run dev` n'est accessible que depuis ton PC. `npm run dev:mobile` l'ouvre à ton
  réseau Wi-Fi, à utiliser seulement chez toi et à couper après.
- **Dépendances** : lance `npm run audit` de temps en temps et `npm update` pour les correctifs.

## Comptes : mise en place de Supabase (une seule fois, ~15 min)

1. **Crée le projet** : https://supabase.com → *New project* (gratuit). Région : *West EU (Paris)* ou *Frankfurt*.
   Garde le mot de passe de la base quelque part (tu n'en auras pas besoin dans l'app).
2. **Crée les tables** : *SQL Editor* → *New query* → colle tout le fichier
   `supabase/migrations/20260930120000_azuucine.sql` → **Run**. (Tu peux le relancer sans risque.)
3. **Réglages de connexion** : *Authentication* →
   - *Sign In / Providers* → **Email** activé, **Confirm email** activé (recommandé), longueur minimale du mot de passe : 8.
   - *URL Configuration* → **Site URL** = l'adresse de ton app en ligne (ex. `https://azuucine.rdacet.fr`),
     et dans **Redirect URLs** ajoute aussi `http://localhost:5173`. Les liens des emails (confirmation, mot de passe
     oublié) renvoient vers ces adresses.
4. **Le fichier `.env`** : copie `.env.example` en `.env`, puis remplis les 2 valeurs depuis *Project Settings* →
   *API* (ou *API Keys*) : **Project URL** et la clé **publishable** (ou **anon** si ton projet utilise les anciennes clés).
   Le `.env` n'est jamais publié (il est dans `.gitignore`).
5. **Les fonctions serveur + ta clé TMDB** (dans le dossier du projet, PowerShell) :
   ```powershell
   npx.cmd supabase login
   npx.cmd supabase link --project-ref <l'identifiant du projet, dans l'adresse du tableau de bord>
   npx.cmd supabase secrets set TMDB_API_KEY=<ta clé ou ton jeton TMDB> ALLOWED_ORIGINS=https://azuucine.rdacet.fr,http://localhost:5173
   npx.cmd supabase functions deploy tmdb --no-verify-jwt
   npx.cmd supabase functions deploy delete-account --no-verify-jwt
   ```
   (`--no-verify-jwt` : la connexion est vérifiée dans le code de chaque fonction.) Pour changer la clé TMDB plus tard,
   relance juste la commande `secrets set`.
5 bis. **Profils et abonnements** : dans *SQL Editor*, colle et lance aussi `supabase/migrations/20261002120000_social.sql`
   (tables des profils, abonnements, fil d'activité, et stockage des photos). Relance ensuite
   `npx.cmd supabase functions deploy delete-account --project-ref <id> --no-verify-jwt --use-api` pour que la suppression
   d'un compte efface aussi ses photos.
6. **Relance l'app** (`npm run dev`) : l'écran de connexion apparaît. Crée ton compte ; dans *Réglages*, AzuuCine te
   propose d'ajouter à ton compte les titres déjà présents sur l'appareil.
7. **En ligne** : sur le VPS (voir « Déploiement automatique »), Netlify ou Cloudflare Pages, ajoute `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les
   variables d'environnement du site (le `.env` n'y est pas envoyé), ou fais `npm run build` sur ton PC avec le `.env`
   et glisse le dossier `dist/`.

À savoir : sur l'offre gratuite, un projet Supabase **sans aucune visite pendant 7 jours** est mis en pause (rien n'est
perdu, tu le relances depuis le tableau de bord). L'app continue de marcher hors-ligne en attendant.

## 1. Lancer l'app sur ton PC

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
cd AzuuCine
npm install
npm run dev
```

Ouvre ensuite `http://localhost:5173` dans ton navigateur (mode mobile des outils de développement conseillé : F12 → icône téléphone).

> Pour un test rapide sur ton téléphone connecté au même Wi-Fi, lance `npm run dev:mobile` puis ouvre l'adresse « Network » affichée dans le terminal (ex. `http://192.168.1.20:5173`).
> Attention : en `http://`, le mode hors-ligne et l'installation « vraie » ne fonctionnent pas — c'est normal, il faut du HTTPS (étape 2).

## Recherche dans les bases de films

Quand tu ajoutes un titre, un champ **« Remplir depuis une base »** permet de le chercher et de préremplir la fiche
(titres, type, année, genres, synopsis, nombre et durée des épisodes, durée du film, plateforme en France, affiche).
Ta note, ton statut, tes épisodes vus et ton avis ne sont jamais écrasés.

- **Animes → AniList** : fonctionne tout de suite, sans compte. Les synopsis sont en anglais.
- **Films, séries, K-dramas, C-dramas → TMDB** : il faut une clé gratuite.
  1. Crée un compte sur https://www.themoviedb.org
  2. Paramètres du compte → **API** → demande une clé (usage personnel).
  3. Copie la **« Clé d'API »** (ou le « Jeton d'accès en lecture ») dans AzuuCine → Réglages → Bases de films → Valider.

La clé reste sur l'appareil (à saisir sur chaque téléphone) et n'est jamais incluse dans les exports.
Seul le texte recherché est envoyé à TMDB / AniList ; ta bibliothèque reste locale.

## 2. Mettre l'app en ligne (gratuit, HTTPS)

Une PWA installable a besoin d'être servie en **HTTPS**. L'hébergeur ne sert que les fichiers de l'app
(les données sont dans Supabase avec les comptes, ou sur le téléphone en mode local).

```bash
npm run build
```

Cela crée un dossier `dist/`. Il est publié automatiquement sur mon VPS (voir ci-dessous) ; tu peux aussi le glisser sur
n'importe quel hébergeur statique (Netlify Drop, Cloudflare Pages, Vercel…).

### Déploiement automatique (VPS + Gitea Actions)

À chaque push sur `main`, le workflow `.gitea/workflows/deploy.yml` fait `npm ci`, `npm run build`, puis publie `dist/`
sur le VPS, sur **https://azuucine.rdacet.fr**.

- **Architecture** (conteneurs LXC) : `azuucine-ci` (runner Gitea Actions, utilisateur `deploy` sans sudo, seul à pouvoir
  écrire dans `/srv/azuucine`) → dossier partagé `/srv/azuucine` → `azuucine-web` (nginx, lecture seule) → `proxy`
  (nginx + certbot, HTTPS).
- **Variables de build** (publiques) : dans Gitea → Dépôt → Paramètres → Actions, variable `VITE_SUPABASE_URL` et secret
  `VITE_SUPABASE_ANON_KEY`. Si elles manquent, le build **échoue** (`REQUIRE_SUPABASE=1` active la garde de
  `vite.config.ts`). Les vrais secrets (clé TMDB, `service_role`) restent dans Supabase.
- **En-têtes de sécurité** : définis une seule fois dans `vite.config.ts` (CSP, HSTS, etc.). `deploy/headers-to-nginx.mjs`
  convertit `dist/_headers` en configuration nginx à chaque déploiement : rien à recopier à la main.
- **Config nginx** : `deploy/nginx/site.conf` (dont le type MIME du manifest du PWA) est livrée avec chaque release. Pour un
  conteneur `azuucine-web` neuf : `lxc-attach -n azuucine-web -- bash < deploy/web/bootstrap.sh`, puis un push sur `main`.
- **Versions** : les 3 dernières sont gardées dans `/srv/azuucine/releases/`, `current` pointe sur la version en ligne.
- **Retour arrière** (en root sur le VPS) : `/srv/azuucine/rollback.sh` revient à la version précédente,
  `/srv/azuucine/rollback.sh <nom-de-version>` à une version précise (`ls /srv/azuucine/releases`).
- **Supabase** : ajoute `https://azuucine.rdacet.fr` à *Authentication → URL Configuration* (Site URL et Redirect URLs),
  au secret `ALLOWED_ORIGINS` des Edge Functions, et aux origines autorisées du client OAuth Google.

## 3. Installer sur l'écran d'accueil

### iPhone (Safari obligatoire)
1. Ouvre l'adresse HTTPS de ton app dans **Safari**.
2. Touche le bouton **Partager** (carré avec une flèche vers le haut).
3. Choisis **« Sur l'écran d'accueil »**, puis **Ajouter**.
4. Lance AzuuCine depuis l'icône : elle s'ouvre en plein écran, comme une app.

### Android (Chrome)
1. Ouvre l'adresse HTTPS dans **Chrome**.
2. Touche le menu **⋮** → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »).
3. Confirme : l'icône AzuuCine apparaît dans tes applications.

## ⚠️ À savoir sur les données

- **Avec un compte** : tes données sont dans ton compte et sur chaque appareil connecté. Les modifications faites
  hors-ligne partent dès que le réseau revient (Réglages → Mon compte indique l'état). L'export JSON reste utile comme
  sauvegarde personnelle.
- **En mode local** : les données sont propres à chaque appareil et à chaque navigateur ; désinstaller l'app ou effacer les
  données du navigateur supprime la bibliothèque, pense à exporter régulièrement.
- Sur iPhone, l'app installée sur l'écran d'accueil a **son propre stockage**, distinct de Safari. Utilise toujours l'app installée.

## Fonctionnalités

- **Profils et abonnements** (avec un compte) : photo de profil, bannière, nom, pseudo et bio ; s'abonner à d'autres membres comme sur Letterboxd ; leur profil montre leur Top 5, leurs derniers visionnages, leurs stats et leur bibliothèque (avis écrits privés, sauf ceux cochés « Afficher cet avis sur mon profil ») ; compte privé avec demandes d'abonnement ; fil « Mes abonnements » sur l'accueil ; recherche par pseudo ; lien de profil à partager (`…/#/u/pseudo`)
- **9 langues** (Réglages → Langue, détectée automatiquement au premier lancement) : français, anglais, espagnol, italien, allemand, portugais (Brésil), chinois simplifié, japonais, coréen. Les dates, les nombres et les infos TMDB suivent la langue choisie. Les textes sont dans `src/i18n/locales/` (le français fait référence).
- **Comptes** : inscription par email, synchronisation automatique entre appareils, fonctionne hors-ligne, mot de passe oublié, suppression du compte

- Fiches : titre + titre original, type (Film, Série, Anime, K-Drama, C-Drama, Autre + précision), année, affiche (photo de la galerie compressée ou URL)
- Statut : À voir / En cours / Terminé / En pause / Abandonné (dates de début/fin remplies automatiquement)
- Note sur 5 étoiles (demi-étoiles) ou sur 10, au choix dans les réglages, + 4 critères détaillés optionnels + coup de cœur
- Suivi des épisodes : vus / total, saison, durée par épisode, bouton **+1** depuis l'accueil et le catalogue (passe en « Terminé » au dernier épisode)
- Genres/tags libres avec suggestions, plateforme, avis personnel
- Accueil : stats rapides, **roulette** (tirage au sort animé parmi « À voir », « En pause » ou mes préférés à revoir, filtrable par type, temps dispo, genre, plateforme), « En cours », Top 5, « À voir », « Récemment terminés »
- Catalogue : recherche instantanée (titre, titre original, tag, plateforme — sans tenir compte des accents), filtres type/statut/genre/note/coups de cœur, tris
- **Suggestions « Si tu as aimé… »** à partir de tes titres préférés, ajout en un clic à « À voir »
- **Listes perso** (Catalogue → Listes), utilisables aussi comme source de la roulette
- **Carrousels** utilisables à la souris sur ordinateur (molette ou glisser)
- **Statistiques visuelles** : filtre par année, onglets Vue d'ensemble / Habitudes / Goûts, heures, types, mois par mois, records, notes, genres, pays
- **Partage en image** d'une fiche ou d'un Top 5 (story / message)
- **Calendrier des sorties** (bouton en haut de l'accueil) : toutes les sorties à venir — films au cinéma en France, épisodes des séries et K/C-dramas les plus suivis (TMDB), tous les épisodes d'animes diffusés (AniList) — filtrables par catégorie, avec ajout en un clic à « À voir ». Onglet « Mes titres » pour ne voir que ta bibliothèque
- **Journal** (Catalogue → Journal) : ton historique de visionnage mois par mois, avec les **revisionnages** (section « Revisionnages » d'une fiche terminée)
- **Moi vs le public** (Stats → Goûts) : ta note comparée à la moyenne TMDB / AniList, écart moyen, titres que tu as plus ou moins aimés que tout le monde
- Export / import JSON (fusion ou remplacement), validation des fichiers importés

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement (uniquement sur ce PC) |
| `npm run dev:mobile` | serveur de développement ouvert au Wi-Fi (test sur téléphone) |
| `npm run audit` | vérifie les failles connues des dépendances |
| `npm run build` | build de production dans `dist/` |
| `npm run preview` | prévisualiser le build |
| `npm run typecheck` | vérification TypeScript |
