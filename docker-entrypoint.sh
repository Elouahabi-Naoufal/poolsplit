#!/bin/sh
set -e

echo ">> Hesab starting..."

# Ensure data dir exists and is writable by nextjs
mkdir -p /app/data /app/data/avatars /app/data/group-images
chown -R nextjs:nodejs /app/data /app/data/avatars /app/data/group-images 2>/dev/null || true
chmod -R 775 /app/data /app/data/avatars /app/data/group-images 2>/dev/null || true

# Ensure public dir is readable by nextjs
chown -R nextjs:nodejs /app/public 2>/dev/null || true

# Ensure symlink
if [ ! -L /app/prisma/data ]; then
  rm -rf /app/prisma/data
  ln -s /app/data /app/prisma/data
fi

# Run migrations as nextjs so app.db is owned by nextjs (not root) —
# otherwise SQLite is readonly for the server ("attempt to write a readonly database")
echo ">> Running prisma migrate deploy..."
run_as_nextjs() {
  if [ "$(id -u)" = "0" ]; then su-exec nextjs:nodejs "$@"; else "$@"; fi
}
if [ -f /app/prisma/migrations/migration_lock.toml ] || ls /app/prisma/migrations/*/migration.sql >/dev/null 2>&1; then
  # Use local prisma 5.22.0 (avoid npx fetching prisma 8 RC which fails with npm 11)
  # Try migrate deploy first, fall back to db push (handles schema changes without matching migrations)
  run_as_nextjs ./node_modules/.bin/prisma migrate deploy || \
    run_as_nextjs npx prisma@5.22.0 migrate deploy || \
    run_as_nextjs ./node_modules/.bin/prisma db push --accept-data-loss || \
    run_as_nextjs npx prisma@5.22.0 db push --accept-data-loss || \
    echo ">> WARNING: Migration deploy failed (tables may already exist). Continuing startup."
else
  echo ">> No migrations found, using db push..."
  run_as_nextjs ./node_modules/.bin/prisma db push --accept-data-loss || \
    run_as_nextjs npx prisma@5.22.0 db push --accept-data-loss || \
    echo ">> WARNING: db push failed. Continuing startup."
fi
# Re-assert ownership after migrate (migrate may create new files)
chown -R nextjs:nodejs /app/data 2>/dev/null || true
chmod -R 775 /app/data 2>/dev/null || true

# Regenerate Prisma Client (ensures runtime client matches current schema)
echo ">> Regenerating Prisma Client..."
run_as_nextjs ./node_modules/.bin/prisma generate || run_as_nextjs npx prisma@5.22.0 generate || echo ">> WARNING: Prisma generate failed. Continuing."

# Enable WAL mode (best effort)
echo ">> Enabling WAL mode..."
run_as_nextjs sqlite3 /app/data/app.db "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;" || echo "WAL setup skipped (db may not exist yet)"

# Generate client if needed (already generated at build)

echo ">> Starting server..."
# Drop privileges: run as nextjs if we are root
if [ "$(id -u)" = "0" ]; then
  exec su-exec nextjs:nodejs "$@"
else
  exec "$@"
fi
