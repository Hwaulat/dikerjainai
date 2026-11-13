# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Stage 1: Build Dependencies
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# ─────────────────────────────────────────────────────────────
# Stage 2: Production Runtime
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install system dependencies:
# - python3 & requests: required for Neosoft automated sync worker (scripts/sync_neosoft.py)
# - py3-openpyxl: required for Google Sheets integration script
# - tzdata: required for Asia/Jakarta timezone alignment in health & sync cron
# - openssl: required for Prisma CLI & migration engine on Alpine musl
RUN apk add --no-cache openssl python3 py3-pip py3-requests tzdata \
    && (apk add --no-cache py3-openpyxl || pip install --no-cache-dir openpyxl --break-system-packages) \
    && cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime \
    && echo "Asia/Jakarta" > /etc/timezone

RUN deluser --remove-home node \
    && addgroup -S node -g 1001 \
    && adduser -S -G node -u 1001 -h /home/node -s /bin/sh node

ENV NODE_ENV=production \
    PORT=3344 \
    HOST=0.0.0.0 \
    TZ=Asia/Jakarta

# Create application folders and assign permissions to non-root node user
RUN mkdir -p /app/data /app/wa_assistant_auth /app/logs \
    && chown -R node:node /app

# Copy production node_modules from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy application source code
COPY --chown=node:node . .

# Ensure persistent directories have node user ownership
RUN chown -R node:node /app/data /app/wa_assistant_auth /app/logs

# Copy and configure entrypoint script to run migrations on startup
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

EXPOSE 3344

# Native Node HTTP healthcheck to verify service responsiveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3344) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
