# WREDD Dashboard - production image. Built on the VPS by deploy/update.sh.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# No database is needed at build time: every page that reads the DB renders per request.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" npm run build

# UTC on purpose: Vercel ran the app in UTC and the day/month logic was written against that.
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
