# Sauvegardes automatiques de la base (Supabase → VPS)

Chaque nuit à 02:17 UTC, le workflow `.gitea/workflows/backup.yml` lance `deploy/backup.sh` sur le
runner `azuucine` (le VPS) :

1. `pg_dump` de toute la base (format custom compressé : tables, données, fonctions, policies RLS,
   comptes `auth.users`), via la connexion **Session pooler IPv4** de Supabase ;
2. **contrôles** : taille minimale, dump lisible par `pg_restore`, présence des tables `items`,
   `profiles`, `follows`, `settings` et `auth.users` — sinon le job **échoue** (croix rouge dans Gitea) ;
3. **chiffrement** gpg symétrique AES-256 avec `BACKUP_PASSPHRASE`, puis vérification que le fichier
   se déchiffre bien ;
4. rangement dans `/srv/backups/azuucine/` (dossier en `700`) et **rotation** :
   7 quotidiennes, 4 hebdomadaires, 6 mensuelles (liens physiques : une même sauvegarde n'occupe
   la place qu'une fois).

Les secrets ne sont jamais dans le dépôt ni affichés dans les logs ; le mot de passe de la base passe
par `PGPASSWORD` (pas sur la ligne de commande).

Pour restaurer : **`deploy/restore.md`**.

## Mise en place (une seule fois)

### 1. Chaîne de connexion Supabase

Supabase → projet `qfgnxonqwldcfdjqhhjz` → **Connect** → **Session pooler** (IPv4, port 5432) :

```
postgresql://postgres.qfgnxonqwldcfdjqhhjz:[YOUR-PASSWORD]@aws-0-<région>.pooler.supabase.com:5432/postgres
```

Remplacer `[YOUR-PASSWORD]` par le mot de passe de la base (Project Settings → Database → Reset
database password si tu ne l'as plus ; **les caractères spéciaux doivent être encodés en %XX**,
ex. `@` → `%40`, ou choisir un mot de passe sans caractères spéciaux, long).

> Pourquoi le *Session pooler* : la connexion directe `db.<ref>.supabase.co` est en IPv6 seulement ;
> le pooler « session » est IPv4 et accepte `pg_dump` (le pooler « transaction », port 6543, non).

### 2. Phrase de chiffrement

Générer une phrase longue et la ranger **dans ton gestionnaire de mots de passe** (si le VPS meurt,
c'est la seule façon de relire les sauvegardes copiées ailleurs) :

```bash
openssl rand -base64 32
```

### 3. Secrets Gitea

Dépôt `romain/azuucine` → **Paramètres → Actions → Secrets** :

| Nom | Valeur |
| --- | --- |
| `SUPABASE_DB_URL` | la chaîne de l'étape 1 |
| `BACKUP_PASSPHRASE` | la phrase de l'étape 2 |

Optionnel, **Variables** : `BACKUP_DIR` (défaut `/srv/backups/azuucine`).

### 4. Préparer le VPS (en root, une fois)

Le runner tourne avec l'utilisateur `deploy` (sans sudo). Il lui faut un client Postgres **de la même
version majeure que Supabase ou plus récent** (Supabase → Project Settings → Infrastructure ; 15 ou 17),
`gpg`, et le dossier des sauvegardes :

```bash
# Client Postgres officiel (dépôt PGDG), ex. version 17
apt-get install -y gnupg postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-client-17

# Dossier dédié, hors de /srv/azuucine (qui est monté dans le conteneur web)
install -d -m 700 -o deploy -g deploy /srv/backups/azuucine
```

Alternative sans installer le client : si l'utilisateur `deploy` peut lancer Docker, le script utilise
automatiquement l'image `postgres:17-alpine` quand le `pg_dump` local manque ou est trop ancien.

### 5. Premier lancement

Gitea → **Actions → backup → Run workflow**. Le log doit finir par :

```
sauvegarde OK : azuucine-AAAAMMJJ-HHMMSS.dump.gpg (… octets chiffrés, … tables de données)
  daily : 1
  weekly : 1
  monthly : 1
```

Puis **tester une restauration** dans une base jetable (`deploy/restore.md`, cas a). Une sauvegarde
jamais testée n'est pas une sauvegarde.

## Surveillance

- Un échec rend le job rouge dans Gitea : active les **notifications par e-mail des Actions** dans
  ton profil Gitea (Paramètres → Notifications) pour être prévenu.
- `/srv/backups/azuucine/.last-success` contient la date de la dernière sauvegarde réussie.
- Le job ne touche pas aux sauvegardes existantes s'il échoue.

## Recommandé : une copie hors du VPS

Les sauvegardes sur le VPS protègent contre une erreur côté Supabase (fausse manip, projet supprimé),
pas contre la perte du VPS. Les fichiers étant chiffrés, on peut les copier n'importe où sans risque,
par exemple chaque semaine depuis un autre ordinateur :

```bash
rsync -a deploy@<vps>:/srv/backups/azuucine/weekly/ ~/Sauvegardes/azuucine/
```

## Lancer une sauvegarde à la main (sur le VPS)

```bash
export SUPABASE_DB_URL='postgresql://…'   # ou lu depuis un fichier en 600
read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
bash deploy/backup.sh
```
