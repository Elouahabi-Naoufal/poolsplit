# Hesab — Group Expense Settlement • Dockerfile (production)
# Multi-stage build for Next.js standalone + Prisma + SQLite

FROM node:22-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
# Use development env to ensure dev deps for build are installed
ENV NODE_ENV=development
RUN npm ci || npm install
# Approve prisma scripts (already in allowScripts, but ensure)
RUN npm install-scripts approve --all || true

# Builder stage — generates Prisma Client + builds Next.js
FROM base AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure data dir exists for prisma migrate at build time (will be mounted at runtime)
# Do NOT create symlink here - it causes Turbopack infinite loop (prisma/data/data)
RUN mkdir -p data
ENV DATABASE_URL="file:./data/app.db"
ENV NEXT_TELEMETRY_DISABLED=1
# Generate Prisma Client (required for TypeScript types during next build)
RUN npx prisma generate
# Patch scheduler to defer React work until the document has finished streaming
# (fixes fatal hydration error #418 - react/react#37321)
RUN node scripts/patch-scheduler.mjs
# Build Next.js (standalone output)
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && apk add --no-cache sqlite openssl su-exec

# Copy built app
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy prisma schema, migrations, and generated client for runtime
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/package.json ./package.json

# Data volume
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

# Ensure prisma/data symlink points to /app/data (so both relative paths work)
RUN rm -rf prisma/data && ln -s /app/data prisma/data

EXPOSE 3000
ENV PORT=3003
ENV HOSTNAME="0.0.0.0"
# Database URL for runtime (absolute, ensures correct volume)
ENV DATABASE_URL="file:/app/data/app.db"

# Entrypoint script (runs as root to fix /app/data ownership, then drops to nextjs)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
