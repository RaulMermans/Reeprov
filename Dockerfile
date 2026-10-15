# Multi-stage Dockerfile for AgentPulse Self-Hosted Studio
FROM node:22-alpine AS base

# Stage 1: Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Stage 3: Runner (Clean compiled/standalone runtime)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV AGENTPULSE_MODE=self_hosted
ENV AGENTPULSE_HOME=/home/nextjs/.agentpulse
ENV AGENTPULSE_STORE_DIR=/home/nextjs/.agentpulse
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Security: Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set up local store directory with proper ownership
RUN mkdir -p /home/nextjs/.agentpulse && chown -R nextjs:nodejs /home/nextjs/.agentpulse
VOLUME ["/home/nextjs/.agentpulse"]

# Copy Next.js standalone compiled output and static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
