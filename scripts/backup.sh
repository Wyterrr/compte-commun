#!/bin/sh
# Sauvegarde cohérente de la base dans ./backups (garde les 30 dernières).
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%F-%H%M)
docker compose exec -T app rm -f /data/backup.db
docker compose exec -T app node -e "new (require('node:sqlite').DatabaseSync)('/data/compte-commun.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp app:/data/backup.db "backups/compte-commun-$STAMP.db"
docker compose exec -T app rm -f /data/backup.db
ls -1t backups/compte-commun-*.db | tail -n +31 | xargs -r rm -f
echo "Sauvegarde : backups/compte-commun-$STAMP.db"
