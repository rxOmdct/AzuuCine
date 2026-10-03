#!/usr/bin/env bash
# Revient à la version précédente (ou à celle donnée en argument). À lancer en root sur le VPS :
#   /srv/azuucine/rollback.sh            -> version juste avant la courante
#   /srv/azuucine/rollback.sh <nom>      -> une version précise (voir ls /srv/azuucine/releases)
set -euo pipefail
ROOT=${AZUUCINE_ROOT:-/srv/azuucine}
CUR=$(basename "$(readlink "$ROOT/current")")
if [ -n "${1:-}" ]; then TARGET=$1
else TARGET=$(ls -1 "$ROOT/releases" | sort -r | grep -A1 -x "$CUR" | tail -n1)
fi
[ -n "$TARGET" ] && [ "$TARGET" != "$CUR" ] && [ -d "$ROOT/releases/$TARGET" ] || { echo "aucune version cible"; exit 1; }
ln -s "releases/$TARGET" "$ROOT/current.tmp"; mv -T "$ROOT/current.tmp" "$ROOT/current"
date -u +%FT%TZ > "$ROOT/.deployed"
echo "retour : $CUR -> $TARGET"
