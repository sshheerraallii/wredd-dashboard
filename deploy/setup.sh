#!/usr/bin/env bash
# First-time setup of the WREDD Dashboard on the shared VPS. Safe to run again.
#   bash /opt/wredd-dashboard/deploy/setup.sh
# Re-run after changing APP_DOMAIN in .env (rewrites the HTTPS entry).
set -euo pipefail
DIR=/opt/wredd-dashboard
cd "$DIR"

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
[ -f .env ] || { echo "No .env yet: cp deploy/env.example .env && chmod 600 .env, then fill it in."; exit 1; }
chmod 600 .env
set -a; . ./.env; set +a
for v in APP_DOMAIN POSTGRES_PASSWORD CRON_SECRET NEXTAUTH_SECRET RESEND_API_KEY \
         CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET; do
  [ -n "${!v:-}" ] || { echo "$v is empty in .env"; exit 1; }
done

# The cron times below are UTC (same as the old vercel.json). Refuse if the server clock isn't.
TZNAME=$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)
case "$TZNAME" in UTC|Etc/UTC) ;; *) echo "Server timezone is $TZNAME, expected UTC. Crons would fire at the wrong time."; exit 1;; esac

docker network inspect web >/dev/null 2>&1 || { echo "Docker network 'web' missing - is GK Parfum running?"; exit 1; }
[ -d /opt/caddy-sites ] || { echo "/opt/caddy-sites missing - GK's Caddy isn't set up for extra sites."; exit 1; }

echo "== Database"
docker compose up -d db
for _ in $(seq 1 30); do
  docker compose exec -T db pg_isready -U wredd -d wredd </dev/null >/dev/null 2>&1 && break
  sleep 2
done
TABLES=$(docker compose exec -T db psql -U wredd -d wredd -At -c \
  "select count(*) from pg_tables where schemaname='public'" </dev/null)
if [ "$TABLES" = "0" ]; then
  echo "Database is empty - copying from Neon."
  bash deploy/migrate-from-neon.sh
else
  echo "Database already has $TABLES tables - leaving the data alone."
fi

echo "== Building and starting the app (first build takes a few minutes)"
docker compose build app
docker compose run --rm --no-deps -T app node_modules/.bin/prisma db push </dev/null
docker compose up -d app
git rev-parse HEAD > .deployed

echo "== HTTPS entry for $APP_DOMAIN"
sed "s/__APP_DOMAIN__/$APP_DOMAIN/" deploy/wredd.caddy.template > /opt/caddy-sites/wredd.caddy
docker exec deploy-caddy-1 caddy reload --config /etc/caddy/Caddyfile </dev/null

echo "== Cron: auto-deploy, nightly backup, dashboard jobs"
cat > /etc/cron.d/wredd-dashboard <<CRON
# WREDD Dashboard. Server clock is UTC.
*/3 * * * * root bash $DIR/deploy/update.sh >> /var/log/wredd-update.log 2>&1
0 3 * * *   root bash $DIR/deploy/backup.sh >> /var/log/wredd-backup.log 2>&1
# Old vercel.json crons, same UTC times
0 * * * *   root bash $DIR/deploy/cron.sh notifications/send    >> /var/log/wredd-cron.log 2>&1
0 2 * * *   root bash $DIR/deploy/cron.sh notifications/cleanup >> /var/log/wredd-cron.log 2>&1
0 0 * * *   root bash $DIR/deploy/cron.sh ops-tasks/generate    >> /var/log/wredd-cron.log 2>&1
0 8 * * *   root bash $DIR/deploy/cron.sh ops-tasks/due-soon    >> /var/log/wredd-cron.log 2>&1
CRON

echo "== Waiting for the app to report healthy"
S=starting
for _ in $(seq 1 40); do
  S=$(docker inspect wredd-app --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  [ "$S" = healthy ] && break
  sleep 5
done
echo "App: $S.  Open https://$APP_DOMAIN   (check HTTPS: docker logs deploy-caddy-1 --tail 30)"
