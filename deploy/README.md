# WREDD Dashboard on the VPS

Runs next to GK Parfum on `187.77.98.20` (Ubuntu, clock in UTC). GK's Caddy provides HTTPS;
the dashboard has its own app container (`wredd-app`, on the shared `web` network) and its own
Postgres 17. No ports are published.

| What | Where |
|---|---|
| Code | `/opt/wredd-dashboard` (auto-deploys within 3 min of a push to `main`) |
| Secrets | `/opt/wredd-dashboard/.env` (chmod 600, never committed) |
| HTTPS entry | `/opt/caddy-sites/wredd.caddy` (written by `deploy/setup.sh`) |
| Cron | `/etc/cron.d/wredd-dashboard` (deploy, backup, the 4 old Vercel crons) |
| Backups | `/root/backups/wredd-YYYY-MM-DD.sql.gz`, 03:00 UTC, last 14 kept |
| Logs | `/var/log/wredd-update.log`, `wredd-backup.log`, `wredd-cron.log` |

Schema changes: just push. Each deploy runs `prisma db push`; if a change would delete data it
refuses, the deploy stops and the old version keeps running. Check `wredd-update.log`.

## First-time setup (test subdomain)

Web console first: `bind 'set enable-bracketed-paste off'`

1. DNS (wredd.com's Hostinger account): A record `vps` → `187.77.98.20`.
2. On the server:
   ```bash
   git clone https://github.com/sshheerraallii/wredd-dashboard.git /opt/wredd-dashboard
   cd /opt/wredd-dashboard
   cp deploy/env.example .env && chmod 600 .env && nano .env
   bash deploy/setup.sh
   ```
   It copies Neon into the VPS database, checks every table's row count matches, builds the
   app, adds the HTTPS entry and installs the cron file. Then click through `https://vps.wredd.com`.

The test copy runs the crons too (real emails). To keep it quiet until cutover:
`sed -i '/cron.sh/s/^/#/' /etc/cron.d/wredd-dashboard` — `setup.sh` puts them back.

## Cutover night (~20 min, nobody using the dashboard)

1. A day before: TTL on the `dashboard` DNS record → 300.
2. Vercel → project → Settings → **Pause project** (stops the old site *and* its crons).
3. On the server:
   ```bash
   cd /opt/wredd-dashboard
   bash deploy/migrate-from-neon.sh     # must end with "OK: ... every count matches Neon."
   sed -i 's/^APP_DOMAIN=.*/APP_DOMAIN=dashboard.wredd.com/' .env
   bash deploy/setup.sh
   ```
4. DNS: replace the `dashboard` CNAME (Vercel) with an A record → `187.77.98.20`.
5. Log in; check projects, payments, performance.

**Rollback** (first 7 days): un-pause Vercel, point DNS back. Anything entered on the VPS in
between must be re-entered, so decide fast. After 7 quiet days: delete Neon, remove `NEON_URL`
from `.env`, downgrade Vercel, remove the `vps` DNS record.

## Everyday commands

```bash
cd /opt/wredd-dashboard
docker compose ps                                  # db + wredd-app, both healthy
docker compose logs -f app                         # app logs
tail -f /var/log/wredd-update.log                  # deploys
bash deploy/update.sh --force                      # rebuild now (e.g. after editing .env)
bash deploy/cron.sh notifications/send             # fire a cron by hand
bash deploy/backup.sh                              # backup now
```

## Prisma Studio from your PC

The database isn't published. Open a temporary bridge on the server (localhost only):

```bash
docker run -d --rm --name wredd-db-bridge --network wredd_default -p 127.0.0.1:5433:5432 \
  alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:db:5432
```

On your PC (PowerShell): `ssh -N -L 5433:127.0.0.1:5433 root@187.77.98.20`, then use
`postgresql://wredd:<POSTGRES_PASSWORD>@127.0.0.1:5433/wredd?sslmode=disable`.
Close it afterwards: `docker stop wredd-db-bridge`.

## Restore a backup

```bash
cd /opt/wredd-dashboard
docker compose stop app
docker compose exec -T db psql -U wredd -d wredd -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' </dev/null
gunzip -c /root/backups/wredd-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -q -U wredd -d wredd
docker compose start app
```
