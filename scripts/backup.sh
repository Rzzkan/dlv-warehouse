#!/usr/bin/env bash
# Backup database (termasuk foto roll) ke ./backups/delova-YYYY-MM-DD_HHMM.sql.gz, simpan 14 hari.
# Jadwalkan harian:  crontab -e  ->  30 1 * * * /path/ke/dlv-warehouse/scripts/backup.sh >> /var/log/delova-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p backups
out="backups/delova-$(date +%F_%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db sh -c 'mysqldump --single-transaction --routines -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' | gzip > "$out.tmp"
mv "$out.tmp" "$out"
find backups -name 'delova-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "OK $out ($(du -h "$out" | cut -f1))"
