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

# Placeholders for the build only: no page reads the DB at build time, but lib/email.ts creates
# the Resend client on import and throws without a key. Real values come from .env at runtime.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    RESEND_API_KEY="re_build_placeholder" \
    npm run build

# UTC on purpose: Vercel ran the app in UTC and the day/month logic was written against that.
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
