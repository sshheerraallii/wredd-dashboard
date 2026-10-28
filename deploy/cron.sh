#!/usr/bin/env bash
# Calls one dashboard cron endpoint (replaces the old vercel.json crons), e.g.:
#   bash /opt/wredd-dashboard/deploy/cron.sh notifications/send
docker exec wredd-app node -e '
fetch("http://127.0.0.1:3000/api/cron/" + process.argv[1], { headers: { authorization: "Bearer " + process.env.CRON_SECRET } })
  .then(async r => { console.log(new Date().toISOString(), "cron", process.argv[1], r.status, (await r.text()).slice(0, 300)); process.exit(r.ok ? 0 : 1); })
  .catch(e => { console.log(new Date().toISOString(), "cron", process.argv[1], "FAILED", e.message); process.exit(1); });
' "$1" </dev/null
