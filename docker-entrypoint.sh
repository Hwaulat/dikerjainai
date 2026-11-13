#!/bin/sh
set -e

# Run Prisma schema migrations if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
  echo "🚀 [entrypoint] DATABASE_URL detected. Checking & applying database migrations..."

  # Retry up to 15 times (30 seconds total) if PostgreSQL is still starting up
  MAX_RETRIES=15
  RETRY_COUNT=0
  MIGRATION_OK=0

  while [ "$RETRY_COUNT" -lt "$MAX_RETRIES" ]; do
    if npm run db:deploy; then
      MIGRATION_OK=1
      echo "✅ [entrypoint] Database migrations applied successfully."
      break
    else
      RETRY_COUNT=$((RETRY_COUNT + 1))
      echo "⚠️ [entrypoint] Database not ready or migration failed. Retrying ($RETRY_COUNT/$MAX_RETRIES) in 2s..."
      sleep 2
    fi
  done

  if [ "$MIGRATION_OK" -ne 1 ]; then
    echo "❌ [entrypoint] ERROR: Database migrations failed after $MAX_RETRIES attempts. Container will not start."
    exit 1
  fi

  # Optional initial or incremental data import to PostgreSQL if enabled
  if [ "$AUTO_MIGRATE_DATA" = "true" ] || [ "$AUTO_MIGRATE_DATA" = "1" ] || [ "$RUN_DATA_MIGRATION" = "true" ]; then
    echo "🔄 [entrypoint] AUTO_MIGRATE_DATA enabled. Running data migration (npm run db:migrate)..."
    npm run db:migrate || echo "⚠️ [entrypoint] Data migration returned a non-zero status."
  fi
elif [ "$STORAGE_BACKEND" = "postgres" ]; then
  echo "⚠️ [entrypoint] STORAGE_BACKEND=postgres is set, but DATABASE_URL is empty. Skipping database migrations."
fi

# Execute the main container command (defaults to CMD in Dockerfile: node server.js)
exec "$@"
