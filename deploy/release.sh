#!/usr/bin/env bash
# Publie dist/ de façon atomique dans /srv/azuucine/releases/<date>-<sha> puis bascule le lien "current".
# Garde les 3 dernières versions. Lancé par le workflow (utilisateur "deploy", sans sudo).
set -euo pipefail
ROOT=${AZUUCINE_ROOT:-/srv/azuucine}
KEEP=3
SRC=${1:?usage: release.sh <dist> <sha>}
SHA=${2:?usage: release.sh <dist> <sha>}
HERE=$(cd "$(dirname "$0")" && pwd)

[ -f "$SRC/index.html" ] && [ -f "$SRC/_headers" ] || { echo "dist/ incomplet (index.html ou _headers manquant)"; exit 1; }
REL="$ROOT/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:8}"
mkdir -p "$REL"
cp -a "$SRC" "$REL/dist"
node "$HERE/headers-to-nginx.mjs" "$REL/dist/_headers" "$REL/nginx"
cp "$HERE/nginx/site.conf" "$REL/nginx/site.conf"   # config nginx du site, versionnée dans le dépôt

# bascule atomique : lien relatif temporaire puis rename
ln -s "releases/$(basename "$REL")" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"
date -u +%FT%TZ > "$ROOT/.deployed"   # déclenche le rechargement de nginx dans le conteneur web
echo "publié : $(basename "$REL")"

# purge : ne garder que les $KEEP plus récentes (la courante est toujours la plus récente)
ls -1d "$ROOT"/releases/*/ | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -rf
ls -1 "$ROOT/releases"
