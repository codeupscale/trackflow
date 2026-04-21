#!/usr/bin/env bash
# ============================================================
# TrackFlow — Production Deploy Script
#
# Mirrors the GitHub Actions pipeline exactly. Pull pre-built
# images from GHCR, rolling-restart only changed services,
# safety-net every tf-* back up, then health-check them all.
# Auto-rollback if any health check fails within 150 s.
#
# NEVER removes a running container before force-recreating it —
# --force-recreate stops → replaces → starts one service at a
# time, so every other service stays serving traffic.
#
# USAGE
#   ./scripts/deploy.sh [SERVICE FLAGS] [OPTIONS]
#
#   Service flags (default: all three)
#     --api          Deploy backend  (tf-app, tf-horizon, tf-scheduler, tf-reverb)
#     --web          Deploy frontend (tf-web)
#     --marketing    Deploy marketing site (tf-marketing)
#
#   Options
#     --skip-migrate   Skip php artisan migrate
#     --skip-pull      Use locally cached images (skip docker pull)
#     --help           Show this message
#
# REQUIREMENTS
#   • docker, docker compose v2 on PATH
#   • Server must be logged in to GHCR:
#       echo $GHCR_TOKEN | docker login ghcr.io -u <github-user> --password-stdin
# ============================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
INFRA_DIR="/home/ubuntu/infra"
COMPOSE_CMD="docker compose"
API_IMAGE="ghcr.io/codeupscale/trackflow-api:latest"
WEB_IMAGE="ghcr.io/codeupscale/trackflow-web:latest"
MARKETING_IMAGE="ghcr.io/codeupscale/trackflow-marketing:latest"

# All TrackFlow app services (NOT postgres/redis — those are never touched)
TF_ALL_SERVICES="tf-app tf-web tf-marketing tf-horizon tf-scheduler tf-reverb"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }
step() { echo -e "\n${CYAN}══ $* ══${NC}"; }

# ── Argument parsing ───────────────────────────────────────────────────────────
DEPLOY_API=false
DEPLOY_WEB=false
DEPLOY_MARKETING=false
SKIP_MIGRATE=false
SKIP_PULL=false

for arg in "$@"; do
  case "$arg" in
    --api)           DEPLOY_API=true ;;
    --web)           DEPLOY_WEB=true ;;
    --marketing)     DEPLOY_MARKETING=true ;;
    --skip-migrate)  SKIP_MIGRATE=true ;;
    --skip-pull)     SKIP_PULL=true ;;
    --help|-h)
      sed -n '/^# USAGE/,/^# REQUIREMENTS/p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) err "Unknown option: $arg"; exit 1 ;;
  esac
done

# Default: deploy everything when no service flag given
if [ "$DEPLOY_API" = false ] && [ "$DEPLOY_WEB" = false ] && [ "$DEPLOY_MARKETING" = false ]; then
  DEPLOY_API=true; DEPLOY_WEB=true; DEPLOY_MARKETING=true
fi

# ── Helpers ────────────────────────────────────────────────────────────────────
container_name() { echo "infra-${1}-1"; }

is_running() {
  docker inspect --format '{{.State.Running}}' "$(container_name "$1")" 2>/dev/null | grep -q true
}

is_healthy() {
  local status
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
    "$(container_name "$1")" 2>/dev/null || echo "missing")
  [ "$status" = "healthy" ] || [ "$status" = "no-healthcheck" ]
}

wait_healthy() {
  local svc="$1" max=30 attempt=0
  log "  Waiting for ${svc} to be healthy (up to 150s)..."
  while [ $attempt -lt $max ]; do
    if docker inspect "$(container_name "$svc")" >/dev/null 2>&1 && is_healthy "$svc"; then
      log "  [OK] ${svc} healthy"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  local final
  final=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-running{{end}}' \
    "$(container_name "$svc")" 2>/dev/null || echo "missing")
  err "  [FAIL] ${svc} did not become healthy in 150s (status: ${final})"
  return 1
}

cd "$INFRA_DIR"

# ── Step 0: Snapshot current image digests (for rollback) ─────────────────────
step "Snapshot current images"
API_OLD_DIGEST=""
WEB_OLD_DIGEST=""
MARKETING_OLD_DIGEST=""
if [ "$DEPLOY_API" = true ]; then
  API_OLD_DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$API_IMAGE" 2>/dev/null || true)
  log "API  current: ${API_OLD_DIGEST:-<none>}"
fi
if [ "$DEPLOY_WEB" = true ]; then
  WEB_OLD_DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$WEB_IMAGE" 2>/dev/null || true)
  log "Web  current: ${WEB_OLD_DIGEST:-<none>}"
fi
if [ "$DEPLOY_MARKETING" = true ]; then
  MARKETING_OLD_DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$MARKETING_IMAGE" 2>/dev/null || true)
  log "Mktg current: ${MARKETING_OLD_DIGEST:-<none>}"
fi

# ── Step 1: Pull new images from GHCR ─────────────────────────────────────────
if [ "$SKIP_PULL" = false ]; then
  step "Pull images from GHCR"
  if [ "$DEPLOY_API" = true ]; then
    log "Pulling $API_IMAGE"
    docker pull "$API_IMAGE" || {
      err "docker pull failed for $API_IMAGE"
      err "Ensure this server is logged in: echo \$GHCR_TOKEN | docker login ghcr.io -u <user> --password-stdin"
      exit 1
    }
  fi
  if [ "$DEPLOY_WEB" = true ]; then
    log "Pulling $WEB_IMAGE"
    docker pull "$WEB_IMAGE" || { err "docker pull failed for $WEB_IMAGE"; exit 1; }
  fi
  if [ "$DEPLOY_MARKETING" = true ]; then
    log "Pulling $MARKETING_IMAGE"
    docker pull "$MARKETING_IMAGE" || { err "docker pull failed for $MARKETING_IMAGE"; exit 1; }
  fi
else
  warn "Skipping image pull (--skip-pull)"
fi

# ── Step 2: Ensure shared infrastructure is healthy ───────────────────────────
step "Verify shared infrastructure"
$COMPOSE_CMD up -d postgres redis
log "Waiting for postgres..."
timeout 60 bash -c \
  'until docker inspect --format="{{.State.Health.Status}}" infra-postgres-1 2>/dev/null | grep -q healthy; do sleep 2; done' \
  || { err "postgres not healthy after 60s"; $COMPOSE_CMD logs postgres --tail 20; exit 1; }
log "Waiting for redis..."
timeout 30 bash -c \
  'until docker inspect --format="{{.State.Health.Status}}" infra-redis-1 2>/dev/null | grep -q healthy; do sleep 2; done' \
  || { err "redis not healthy after 30s"; $COMPOSE_CMD logs redis --tail 10; exit 1; }
log "postgres + redis healthy"

# ── Step 3: Rolling restart — one service at a time ───────────────────────────
# --no-deps  : never restart postgres/redis as a side effect
# --force-recreate : stop old container, start new one with pulled image
# The old container serves until the moment the new one replaces it.
step "Rolling restart"

if [ "$DEPLOY_API" = true ]; then
  log "Restarting tf-app..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-app

  log "Waiting for tf-app before running migrations..."
  wait_healthy tf-app || { err "tf-app failed to start; aborting"; exit 1; }

  if [ "$SKIP_MIGRATE" = false ]; then
    log "Running database migrations..."
    if ! $COMPOSE_CMD exec tf-app php artisan migrate --force; then
      err "Migration failed — rolling back tf-app"
      if [ -n "$API_OLD_DIGEST" ]; then
        docker pull "$API_OLD_DIGEST" 2>/dev/null || true
        docker tag  "$API_OLD_DIGEST" "$API_IMAGE"  2>/dev/null || true
        $COMPOSE_CMD up -d --no-deps --force-recreate tf-app
      fi
      exit 1
    fi
    log "Migrations OK"
  else
    warn "Skipping migrations (--skip-migrate)"
  fi

  log "Rebuilding Laravel caches..."
  $COMPOSE_CMD exec tf-app php artisan config:cache
  $COMPOSE_CMD exec tf-app php artisan route:cache
  $COMPOSE_CMD exec tf-app php artisan view:cache

  log "Restarting tf-horizon..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-horizon
  $COMPOSE_CMD exec tf-horizon php artisan horizon:terminate 2>/dev/null || true

  log "Restarting tf-scheduler..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-scheduler

  log "Restarting tf-reverb..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-reverb
fi

if [ "$DEPLOY_WEB" = true ]; then
  log "Restarting tf-web..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-web
fi

if [ "$DEPLOY_MARKETING" = true ]; then
  log "Restarting tf-marketing..."
  $COMPOSE_CMD up -d --no-deps --force-recreate tf-marketing
fi

# ── Step 3.5: Safety net ───────────────────────────────────────────────────────
# Bring up any tf-* service that is not running (e.g. was stopped before this
# deploy began). No-op for containers that are already up and healthy.
step "Safety net — ensure every tf-* service is running"
# shellcheck disable=SC2086
$COMPOSE_CMD up -d --no-deps $TF_ALL_SERVICES 2>/dev/null || true
log "All tf-* services started (or were already running)"

# ── Step 4: Health check ALL running tf-* services ────────────────────────────
step "Health checks"
HEALTH_OK=true
for svc in $TF_ALL_SERVICES; do
  if ! docker inspect "$(container_name "$svc")" >/dev/null 2>&1; then
    warn "  ${svc}: container not present — skipping"
    continue
  fi
  wait_healthy "$svc" || HEALTH_OK=false
done

# ── Step 5: Rollback on failure ────────────────────────────────────────────────
if [ "$HEALTH_OK" != true ]; then
  step "HEALTH CHECK FAILED — ROLLING BACK"
  $COMPOSE_CMD up -d postgres redis
  timeout 30 bash -c \
    'until docker inspect --format="{{.State.Health.Status}}" infra-postgres-1 2>/dev/null | grep -q healthy; do sleep 2; done' || true

  if [ "$DEPLOY_API" = true ] && [ -n "$API_OLD_DIGEST" ]; then
    warn "Rolling back API to: $API_OLD_DIGEST"
    docker pull "$API_OLD_DIGEST" 2>/dev/null || true
    docker tag  "$API_OLD_DIGEST" "$API_IMAGE"  2>/dev/null || true
    $COMPOSE_CMD up -d --no-deps tf-app tf-horizon tf-scheduler tf-reverb
  fi
  if [ "$DEPLOY_WEB" = true ] && [ -n "$WEB_OLD_DIGEST" ]; then
    warn "Rolling back Web to: $WEB_OLD_DIGEST"
    docker pull "$WEB_OLD_DIGEST" 2>/dev/null || true
    docker tag  "$WEB_OLD_DIGEST" "$WEB_IMAGE"  2>/dev/null || true
    $COMPOSE_CMD up -d --no-deps tf-web
  fi
  if [ "$DEPLOY_MARKETING" = true ] && [ -n "$MARKETING_OLD_DIGEST" ]; then
    warn "Rolling back Marketing to: $MARKETING_OLD_DIGEST"
    docker pull "$MARKETING_OLD_DIGEST" 2>/dev/null || true
    docker tag  "$MARKETING_OLD_DIGEST" "$MARKETING_IMAGE" 2>/dev/null || true
    $COMPOSE_CMD up -d --no-deps tf-marketing
  fi

  sleep 10
  err "Deploy FAILED. Rolled back to previous images."
  $COMPOSE_CMD ps --format "table {{.Name}}\t{{.Status}}" | grep -E "tf-|NAME"
  exit 1
fi

# ── Step 6: Final status ───────────────────────────────────────────────────────
step "Deploy complete"
$COMPOSE_CMD ps --format "table {{.Name}}\t{{.Status}}\t{{.Image}}" | grep -E "tf-|NAME"
echo ""
log "All TrackFlow services are healthy. Deploy successful."
