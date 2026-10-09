#!/usr/bin/env bash
# Backup tanpa Docker. Membaca DB_* dari .env. Jadwalkan: 30 1 * * * /opt/dlv-warehouse/scripts/backup-native.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p backups
out="backups/delova-$(date +%F_%H%M).sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump --single-transaction --routines -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" | gzip > "$out.tmp"
mv "$out.tmp" "$out"
find backups -name 'delova-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "OK $out ($(du -h "$out" | cut -f1))"
