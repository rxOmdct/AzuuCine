#!/usr/bin/env bash
# Sauvegarde chiffrée de la base Supabase d'AzuuCine, avec rotation.
# Lancé chaque nuit par .gitea/workflows/backup.yml (runner "azuucine", sur le VPS).
#
# Variables (secrets Gitea, JAMAIS dans le dépôt) :
#   SUPABASE_DB_URL    postgresql://postgres.<ref>:<mot de passe>@aws-0-<région>.pooler.supabase.com:5432/postgres
#                      (Supabase -> Connect -> « Session pooler », IPv4)
#   BACKUP_PASSPHRASE  phrase de chiffrement (gpg symétrique AES-256) — à garder AUSSI hors du VPS
# Optionnelles :
#   BACKUP_DIR         dossier des sauvegardes (défaut : /srv/backups/azuucine)
#   PG_IMAGE           image Docker du client Postgres si pg_dump local trop ancien (défaut : postgres:17-alpine)
#   KEEP_DAILY / KEEP_WEEKLY / KEEP_MONTHLY   (défaut : 7 / 4 / 6)
#   MIN_DUMP_BYTES     taille minimale d'un dump valide (défaut : 20000)
#
# Restauration : voir deploy/restore.md. Procédure complète : deploy/BACKUP.md.
set -Eeuo pipefail
umask 077

fail() { echo "ÉCHEC SAUVEGARDE : $*" >&2; exit 1; }
trap 'fail "erreur inattendue (ligne $LINENO)"' ERR

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL manquante (secret Gitea)}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquante (secret Gitea)}"
[ "${#BACKUP_PASSPHRASE}" -ge 16 ] || fail "BACKUP_PASSPHRASE trop courte (16 caractères minimum)"
BACKUP_DIR=${BACKUP_DIR:-/srv/backups/azuucine}
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
KEEP_MONTHLY=${KEEP_MONTHLY:-6}
MIN_DUMP_BYTES=${MIN_DUMP_BYTES:-20000}
command -v gpg >/dev/null || fail "gpg absent (apt install gnupg)"

# ── Connexion : le mot de passe passe par PGPASSWORD, jamais sur la ligne de commande (visible dans ps) ──
re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.+)$'
[[ "$SUPABASE_DB_URL" =~ $re ]] || fail "SUPABASE_DB_URL mal formée (attendu postgresql://user:motdepasse@hôte:port/base)"
DB_URL="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
pw=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${pw//%/\\x}")   # décodage des %XX éventuels
export PGPASSWORD
export PGSSLMODE=${PGSSLMODE:-require}
export PGCONNECT_TIMEOUT=20
unset pw

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR"/{daily,weekly,monthly}
WORK=$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ── Client Postgres : pg_dump local s'il est assez récent (>= version du serveur), sinon Docker ──
pg() { # pg <commande> <args…> — exécute un outil client Postgres
  if [ "${USE_DOCKER:-0}" = 1 ]; then
    docker run --rm -i --network host --user "$(id -u):$(id -g)" \
      -e PGPASSWORD -e PGSSLMODE -e PGCONNECT_TIMEOUT -v "$WORK:$WORK" -w "$WORK" "$PG_IMAGE" "$@"
  else
    "$@"
  fi
}
server_major() { pg psql -X -At -d "$DB_URL" -c 'show server_version_num' | cut -c1-2; }

USE_DOCKER=0
if command -v pg_dump >/dev/null && command -v psql >/dev/null; then
  local_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
  srv=$(server_major) || fail "connexion à la base impossible (URL, mot de passe, réseau IPv4 ?)"
  if [ "$local_major" -lt "$srv" ]; then
    command -v docker >/dev/null || fail "pg_dump $local_major < serveur $srv et Docker absent : installe postgresql-client-$srv"
    USE_DOCKER=1
  fi
else
  command -v docker >/dev/null || fail "ni pg_dump ni Docker : installe postgresql-client (même version que Supabase) ou Docker"
  USE_DOCKER=1
  srv=$(server_major) || fail "connexion à la base impossible (URL, mot de passe, réseau IPv4 ?)"
fi
echo "serveur Postgres $srv · client $([ "$USE_DOCKER" = 1 ] && echo "Docker $PG_IMAGE" || echo "local $local_major")"

# ── Dump (format « custom » : compressé, restauration sélective possible avec pg_restore) ──
STAMP=$(date -u +%Y%m%d-%H%M%S)
DUMP="$WORK/azuucine-$STAMP.dump"
pg pg_dump -d "$DB_URL" --format=custom --compress=9 --no-owner --no-privileges \
  --exclude-table-data='auth.audit_log_entries' --file "$DUMP" \
  || fail "pg_dump a échoué"

# ── Contrôles : le dump doit exister, avoir une taille plausible et contenir les tables de l'app ──
[ -s "$DUMP" ] || fail "dump vide"
size=$(stat -c %s "$DUMP")
[ "$size" -ge "$MIN_DUMP_BYTES" ] || fail "dump trop petit ($size octets < $MIN_DUMP_BYTES) : base vide ou dump incomplet ?"
pg pg_restore --list "$DUMP" > "$WORK/toc.txt" || fail "dump illisible par pg_restore"
for tbl in items profiles follows settings; do
  grep -qE "TABLE DATA public $tbl " "$WORK/toc.txt" || fail "table public.$tbl absente du dump"
done
grep -qE "TABLE DATA auth users " "$WORK/toc.txt" || fail "table auth.users absente du dump"
entries=$(grep -c 'TABLE DATA' "$WORK/toc.txt")

# ── Chiffrement (gpg symétrique AES-256 ; la phrase passe par un descripteur, pas par la ligne de commande) ──
ENC="$DUMP.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none \
  --output "$ENC" "$DUMP" 3<<<"$BACKUP_PASSPHRASE" || fail "chiffrement impossible"
# Vérification : le fichier chiffré se déchiffre et redonne exactement le dump
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$ENC" 3<<<"$BACKUP_PASSPHRASE" \
  | cmp -s - "$DUMP" || fail "vérification du déchiffrement échouée"
sha256sum "$ENC" | sed "s#  .*/#  #" > "$ENC.sha256"
rm -f "$DUMP"

# ── Rangement + rotation (7 quotidiennes, 4 hebdomadaires, 6 mensuelles ; liens physiques = pas de doublon disque) ──
name=$(basename "$ENC")
mv "$ENC" "$ENC.sha256" "$BACKUP_DIR/daily/"
newest() { { ls -1 "$1"/*.gpg 2>/dev/null || true; } | sort | tail -1; }
age_days() { echo $(( ( $(date -u +%s) - $(stat -c %Y "$1") ) / 86400 )); }
w=$(newest "$BACKUP_DIR/weekly")
if [ -z "$w" ] || [ "$(age_days "$w")" -ge 7 ]; then
  ln -f "$BACKUP_DIR/daily/$name" "$BACKUP_DIR/weekly/$name"
  ln -f "$BACKUP_DIR/daily/$name.sha256" "$BACKUP_DIR/weekly/$name.sha256"
fi
m=$(newest "$BACKUP_DIR/monthly")
if [ -z "$m" ] || [ "$(basename "$m" | cut -c10-15)" != "$(date -u +%Y%m)" ]; then
  ln -f "$BACKUP_DIR/daily/$name" "$BACKUP_DIR/monthly/$name"
  ln -f "$BACKUP_DIR/daily/$name.sha256" "$BACKUP_DIR/monthly/$name.sha256"
fi
prune() { # prune <dossier> <nombre à garder>
  { ls -1 "$1"/*.gpg 2>/dev/null || true; } | sort -r | tail -n +$(( $2 + 1 )) | while read -r f; do rm -f "$f" "$f.sha256"; done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

date -u +%FT%TZ > "$BACKUP_DIR/.last-success"
echo "sauvegarde OK : $name ($(stat -c %s "$BACKUP_DIR/daily/$name") octets chiffrés, $entries tables de données)"
for d in daily weekly monthly; do echo "  $d : $({ ls -1 "$BACKUP_DIR/$d"/*.gpg 2>/dev/null || true; } | wc -l)"; done
