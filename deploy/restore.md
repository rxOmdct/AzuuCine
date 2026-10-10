# Restaurer une sauvegarde de la base AzuuCine

Les sauvegardes sont produites chaque nuit par `deploy/backup.sh` (workflow `.gitea/workflows/backup.yml`)
dans `/srv/backups/azuucine/{daily,weekly,monthly}/` sur le VPS :

```
azuucine-AAAAMMJJ-HHMMSS.dump.gpg         dump pg_dump (format custom, compressé) chiffré AES-256 (gpg symétrique)
azuucine-AAAAMMJJ-HHMMSS.dump.gpg.sha256  empreinte du fichier chiffré
```

Il faut la **phrase de chiffrement** (`BACKUP_PASSPHRASE`, gardée dans ton gestionnaire de mots de passe) :
sans elle, la sauvegarde est illisible — c'est voulu.

> ⚠️ Toujours **tester d'abord sur un projet Supabase de test** (ou une base Postgres locale), jamais
> directement sur la production. Une restauration remplace des données : fais d'abord une sauvegarde
> de l'état actuel (`bash deploy/backup.sh` à la main, voir BACKUP.md).

## 1. Récupérer et déchiffrer

```bash
cd /srv/backups/azuucine/daily            # ou weekly / monthly
ls -1                                      # choisir le fichier
F=azuucine-20261009-021703.dump.gpg
sha256sum -c "$F.sha256"                   # doit afficher : OK

# Déchiffrer (la phrase est demandée ; rien n'est écrit dans l'historique du shell)
umask 077
gpg --decrypt --output /tmp/azuucine.dump "$F"

# Contenu du dump (liste des tables, fonctions, policies…)
pg_restore --list /tmp/azuucine.dump | less
```

Le client Postgres doit être **de la même version majeure que Supabase, ou plus récent**
(`pg_restore --version`). Sinon, via Docker :
`docker run --rm -it --network host -v /tmp:/tmp postgres:17-alpine pg_restore --list /tmp/azuucine.dump`

## 2. Cas courants

La connexion se fait avec la chaîne **Session pooler** (Supabase → Connect), mot de passe dans `PGPASSWORD` :

```bash
export PGPASSWORD='…'            # mot de passe de la base (pas dans l'URL)
export PGSSLMODE=require
DB='postgresql://postgres.<ref>@aws-0-<région>.pooler.supabase.com:5432/postgres'
```

### a) Récupérer les données d'un seul compte ou d'une seule table (le plus fréquent)

Restaurer le dump dans une **base locale** jetable, puis copier ce qu'il faut :

```bash
createdb azuu_restore
pg_restore --no-owner --no-privileges -d azuu_restore --schema=public /tmp/azuucine.dump
psql -d azuu_restore -c "select id, data->>'title' from public.items where user_id = '<uuid>'"
```

(Les erreurs « role … does not exist » / « schema auth does not exist » sur une base locale sont normales :
les tables `public` gardent leurs données.) Puis réinjecter les lignes voulues dans Supabase avec
`\copy … to/from` ou un `insert … on conflict do update` ciblé.

### b) Restaurer tout le schéma `public` (après une fausse manip)

```bash
# 1. sauvegarde de l'état actuel
bash deploy/backup.sh
# 2. restauration des tables de l'app (les comptes auth.users existent toujours)
pg_restore --no-owner --no-privileges --clean --if-exists --schema=public -d "$DB" /tmp/azuucine.dump
```

`--clean` supprime puis recrée les objets du schéma `public` (tables, fonctions, policies RLS).
Relancer ensuite les migrations récentes si le dump est antérieur à l'une d'elles
(`supabase/migrations/*.sql`, toutes idempotentes) dans **SQL Editor → Run**.

### c) Projet Supabase perdu (reconstruction complète dans un nouveau projet)

1. Créer un nouveau projet Supabase (même région), noter sa chaîne Session pooler.
2. Restaurer d'abord les comptes, puis l'app :
   ```bash
   pg_restore --no-owner --no-privileges --data-only --schema=auth --table=users --table=identities -d "$DB" /tmp/azuucine.dump
   pg_restore --no-owner --no-privileges --schema=public -d "$DB" /tmp/azuucine.dump
   pg_restore --no-owner --no-privileges --data-only --schema=storage --table=objects -d "$DB" /tmp/azuucine.dump
   ```
   (Les fichiers du bucket `profile-media` ne sont **pas** dans le dump : seules leurs références le sont.
   Les photos de profil devront être re-téléversées, ou copiées depuis l'ancien projet s'il est accessible.)
3. Rejouer les réglages hors base : bucket `profile-media` (public), edge functions `tmdb` et
   `delete-account` + leurs secrets (clé TMDB), fournisseurs d'auth (Google), URL du site.
4. Mettre à jour `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` dans Gitea et redéployer.
5. Remettre Romain admin : `insert into public.admins (user_id) values ('<uuid>') on conflict do nothing;`

## 3. Nettoyer

```bash
shred -u /tmp/azuucine.dump 2>/dev/null || rm -f /tmp/azuucine.dump
dropdb azuu_restore 2>/dev/null || true
unset PGPASSWORD
```
