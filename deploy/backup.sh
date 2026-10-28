#!/usr/bin/env bash
# Nightly backup: /root/backups/wredd-YYYY-MM-DD.sql.gz, last 14 kept.
# Restore: see deploy/README.md
set -euo pipefail
mkdir -p /root/backups
cd /opt/wredd-dashboard
F=/root/backups/wredd-$(date +%F).sql.gz
docker compose exec -T db pg_dump -U wredd -d wredd --no-owner --no-acl </dev/null | gzip > "$F.tmp" && mv "$F.tmp" "$F"
ls -1t /root/backups/wredd-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "$(date -Is) backup $F ($(du -h "$F" | cut -f1))"
