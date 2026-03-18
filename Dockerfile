# ── VoiceLink Dockerfile ──
# Optimized for layer caching and production

FROM node:20-alpine AS builder

# Install dependencies layer (cached unless package.json changes)
WORKDIR /app
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Production image
FROM node:20-alpine

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy installed node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
