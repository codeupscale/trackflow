#!/usr/bin/env bash
# ============================================================
# TrackFlow — Production Deploy Script
# Usage: ./scripts/deploy.sh [--skip-build] [--skip-migrate]
#
# Workflow:
#   1. Pull latest code from current branch
#   2. Build Docker images (unless --skip-build)
#   3. Run database migrations (unless --skip-migrate)
#   4. Clear and warm all Laravel caches
#   5. Rolling restart of services (zero-downtime for web/app)
#   6. Verify health checks pass
# ============================================================

set -euo pipefail

COMPOSE_FILE="compose.production.yaml"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }

SKIP_BUILD=false
SKIP_MIGRATE=false

for arg in "$@"; do
    case "$arg" in
        --skip-build)   SKIP_BUILD=true ;;
        --skip-migrate) SKIP_MIGRATE=true ;;
        --help|-h)
            echo "Usage: $0 [--skip-build] [--skip-migrate]"
            echo ""
            echo "Options:"
            echo "  --skip-build     Skip Docker image rebuild (use existing images)"
            echo "  --skip-migrate   Skip database migrations"
            exit 0
            ;;
        *)
            err "Unknown option: $arg"
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

# ---- Step 1: Pull latest code ----
log "Pulling latest code..."
git pull --ff-only || {
    err "Git pull failed. Resolve conflicts manually before deploying."
    exit 1
}

# ---- Step 2: Build images ----
if [ "$SKIP_BUILD" = false ]; then
    log "Building Docker images..."
    $COMPOSE_CMD build --parallel
else
    warn "Skipping Docker build (--skip-build)"
fi

# ---- Step 3: Database migrations ----
if [ "$SKIP_MIGRATE" = false ]; then
    log "Running database migrations..."
    $COMPOSE_CMD run --rm --no-deps app php artisan migrate --force
else
    warn "Skipping migrations (--skip-migrate)"
fi

# ---- Step 4: Clear and warm caches ----
log "Optimizing Laravel caches..."
$COMPOSE_CMD run --rm --no-deps app php artisan optimize:clear
$COMPOSE_CMD run --rm --no-deps app php artisan optimize

# ---- Step 5: Rolling restart ----
# Start infrastructure first (DB, Redis), then app services.
# Using --no-deps + up -d per service avoids taking everything down at once.

log "Restarting infrastructure services..."
$COMPOSE_CMD up -d pgsql redis

log "Waiting for database to be healthy..."
timeout 60 bash -c "until $COMPOSE_CMD exec pgsql pg_isready -q; do sleep 2; done" || {
    err "Database failed to become healthy within 60s"
    exit 1
}

log "Restarting application services..."
$COMPOSE_CMD up -d --no-deps app
$COMPOSE_CMD up -d --no-deps web
$COMPOSE_CMD up -d --no-deps horizon
$COMPOSE_CMD up -d --no-deps reverb
$COMPOSE_CMD up -d --no-deps scheduler

# ---- Step 6: Restart Horizon workers to pick up new code ----
log "Terminating old Horizon workers..."
$COMPOSE_CMD exec horizon php artisan horizon:terminate 2>/dev/null || true

# ---- Step 7: Health check verification ----
log "Waiting for health checks..."
sleep 10

HEALTH_OK=true

# Check app container
if $COMPOSE_CMD exec app curl -sf http://localhost/api/v1/health/live > /dev/null 2>&1; then
    log "App (Laravel API): healthy"
else
    err "App (Laravel API): UNHEALTHY"
    HEALTH_OK=false
fi

# Check web container
if $COMPOSE_CMD exec web wget -q --spider http://localhost:3000/ 2>/dev/null; then
    log "Web (Next.js): healthy"
else
    err "Web (Next.js): UNHEALTHY"
    HEALTH_OK=false
fi

# Show resource usage
log "Current container resource usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" \
    $(${COMPOSE_CMD} ps -q 2>/dev/null) 2>/dev/null || true

echo ""
if [ "$HEALTH_OK" = true ]; then
    log "Deploy complete. All services healthy."
else
    err "Deploy complete but some services are unhealthy. Check logs:"
    echo "  $COMPOSE_CMD logs --tail=50 app"
    echo "  $COMPOSE_CMD logs --tail=50 web"
    exit 1
fi
