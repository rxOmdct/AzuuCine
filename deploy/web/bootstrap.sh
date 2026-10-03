#!/usr/bin/env bash
# À lancer UNE FOIS, en root, dans un conteneur azuucine-web neuf (Debian 12) :
#   lxc-attach -n azuucine-web -- bash < deploy/web/bootstrap.sh
# Prérequis : /srv/azuucine monté dans le conteneur (lxc.mount.entry ... srv/azuucine none bind,ro).
# Ensuite, toute la configuration du site arrive avec les déploiements (deploy/nginx/site.conf).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq nginx >/dev/null
rm -f /etc/nginx/sites-enabled/default
echo 'include /srv/azuucine/current/nginx/site.conf;' > /etc/nginx/conf.d/azuucine.conf
cat > /etc/systemd/system/azuucine-reload.path <<UNIT
[Unit]
Description=Recharge nginx apres un deploiement AzuuCine
[Path]
PathModified=/srv/azuucine/.deployed
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/azuucine-reload.service <<UNIT
[Unit]
Description=Reload nginx (deploiement AzuuCine)
[Service]
Type=oneshot
ExecStart=/bin/sh -c "nginx -t && systemctl reload nginx"
UNIT
systemctl daemon-reload
systemctl enable --now azuucine-reload.path >/dev/null 2>&1
echo "ok : le premier déploiement (push sur main) activera le site"
