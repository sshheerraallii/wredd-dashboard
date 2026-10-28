#!/usr/bin/env bash
# Copies the live Neon database into the VPS database, then checks every table's row count matches.
# Neon is only read, never changed. The VPS copy is wiped and replaced each time this runs.
#   bash /opt/wredd-dashboard/deploy/migrate-from-neon.sh
set -euo pipefail
cd /opt/wredd-dashboard
set -a; . ./.env; set +a
: "${NEON_URL:?NEON_URL is empty in .env}"

IMG=postgres:17-alpine
mkdir -p /root/backups
NAME="wredd-neon-$(date -u +%Y%m%dT%H%M%SZ).dump"

echo "1/4 Dumping Neon -> /root/backups/$NAME"
docker run --rm -v /root/backups:/out "$IMG" \
  pg_dump "$NEON_URL" -Fc -n public --no-owner --no-acl -f "/out/$NAME" </dev/null
echo "    $(du -h "/root/backups/$NAME" | cut -f1)"

echo "2/4 Starting the VPS database"
docker compose up -d db
for _ in $(seq 1 30); do
  docker compose exec -T db pg_isready -U wredd -d wredd </dev/null >/dev/null 2>&1 && break
  sleep 2
done

echo "3/4 Restoring (replaces whatever is in the VPS database)"
docker compose exec -T db psql -q -U wredd -d wredd -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' </dev/null
docker compose exec -T db pg_restore -U wredd -d wredd --no-owner --no-acl --exit-on-error < "/root/backups/$NAME"
docker compose exec -T db psql -q -U wredd -d wredd -c 'ANALYZE;' </dev/null

echo "4/4 Comparing row counts, table by table"
NEON_COUNTS=$(docker run --rm -i "$IMG" psql "$NEON_URL" -At -v ON_ERROR_STOP=1 < deploy/row-counts.sql)
VPS_COUNTS=$(docker compose exec -T db psql -U wredd -d wredd -At -v ON_ERROR_STOP=1 < deploy/row-counts.sql)
if [ "$NEON_COUNTS" = "$VPS_COUNTS" ]; then
  TABLES=$(printf '%s\n' "$VPS_COUNTS" | wc -l)
  ROWS=$(printf '%s\n' "$VPS_COUNTS" | awk -F'|' '{s+=$2} END {print s}')
  echo "OK: $TABLES tables, $ROWS rows, every count matches Neon."
else
  echo "MISMATCH - do not cut over. Neon (<) vs VPS (>):"
  diff <(printf '%s\n' "$NEON_COUNTS") <(printf '%s\n' "$VPS_COUNTS") || true
  echo "(If someone used the dashboard during the copy, that alone explains it - run again.)"
  exit 1
fi
