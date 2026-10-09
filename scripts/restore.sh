#!/usr/bin/env bash
# Pulihkan dari backup:  scripts/restore.sh backups/delova-2026-10-09_0130.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
f="${1:?pakai: scripts/restore.sh <file.sql.gz>}"
read -r -p "Ini MENIMPA data saat ini dengan $f. Lanjut? ketik 'ya': " a
[ "$a" = "ya" ] || { echo batal; exit 1; }
gunzip -c "$f" | docker compose -f docker-compose.prod.yml exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
echo "Selesai."
