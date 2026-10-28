#!/usr/bin/env bash
# Redeploys when GitHub has new commits (cron, every 3 minutes). "--force" rebuilds anyway,
# e.g. after editing .env.
set -euo pipefail
DIR=/opt/wredd-dashboard
cd "$DIR"
exec 9>/tmp/wredd-update.lock
flock -n 9 || exit 0

git fetch -q origin main
NEW=$(git rev-parse origin/main)
OLD=$(cat .deployed 2>/dev/null || echo none)
if [ "$NEW" = "$OLD" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

echo "$(date -Is) deploying $NEW"
git reset -q --hard "$NEW"
docker compose up -d db
docker compose build app
# Apply schema.prisma changes. Refuses anything that would delete data -> deploy stops, old version keeps running.
docker compose run --rm --no-deps -T app node_modules/.bin/prisma db push </dev/null
docker compose up -d app
echo "$NEW" > .deployed
docker image prune -f >/dev/null
echo "$(date -Is) done"
