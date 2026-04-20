#!/bin/sh
# ============================================================
# TrackFlow — Container Entrypoint
# Runs on every container start (deploy, restart, reboot).
# Rebuilds Laravel's config/route/view caches from the live
# environment so new env vars are always picked up without
# a manual `artisan config:cache` after .env changes.
# ============================================================
set -e

cd /var/www/html

echo "[entrypoint] Rebuilding Laravel caches from current environment..."

php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "[entrypoint] Caches built. Starting application."

exec "$@"
