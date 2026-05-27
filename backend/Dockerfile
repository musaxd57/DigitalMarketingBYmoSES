FROM node:20-alpine AS base

# Install security updates
RUN apk update && apk upgrade && apk add --no-cache \
    dumb-init \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# ─── Dependencies stage ───────────────────────────────────────────────────────
FROM base AS deps

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ─── Development stage ────────────────────────────────────────────────────────
FROM base AS development

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .

EXPOSE 3001
ENV NODE_ENV=development

CMD ["dumb-init", "node", "node_modules/.bin/nodemon", "server.js"]

# ─── Production stage ─────────────────────────────────────────────────────────
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=nodejs:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown nodejs:nodejs logs

# Switch to non-root user
USER nodejs

EXPOSE 3001

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["dumb-init", "node", "server.js"]
