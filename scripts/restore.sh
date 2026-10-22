#!/usr/bin/env bash
# Pulihkan dari backup:  scripts/restore.sh backups/delova-2026-10-09_0130.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
# Pakai file compose yang sama dengan saat deploy (standalone / berbagi VPS), dibaca dari .env
COMPOSE_FILE="${COMPOSE_FILE:-$(grep -E '^COMPOSE_FILE=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
f="${1:?pakai: scripts/restore.sh <file.sql.gz>}"
read -r -p "Ini MENIMPA data saat ini dengan $f. Lanjut? ketik 'ya': " a
[ "$a" = "ya" ] || { echo batal; exit 1; }
gunzip -c "$f" | docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
echo "Selesai."
