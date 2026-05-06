#!/usr/bin/env bash
#
# run-e2e-local.sh — orchestrate the CAD Stone Playwright suite end-to-end
# from a single command on the Replit / Nix workspace.
#
# Why this script exists (Task #344):
#   The Playwright-bundled chromium-headless-shell can't load its shared
#   libs (libglib-2.0.so.0, libnss3, ...) on Nix, so the suite was
#   effectively unrunnable in-workspace. This script:
#     - Points Playwright at the system chromium from replit.nix
#       (the playwright config already honors $CHROMIUM_PATH).
#     - Recreates the test DB schema.
#     - Seeds Cesar / Anwar / worker fixture + the baseline E2E
#       client + open job that the suite's beforeAll hooks require.
#     - Boots the api-server and Vite dev server in the background,
#       waits for both to respond, then runs the suite.
#     - Tears the servers down on exit so re-runs don't collide on
#       the ports.
#
# Usage:
#   SEED_ADMIN_CESAR_PASSWORD=...   \
#   SEED_ADMIN_ANWAR_PASSWORD=...   \
#   SEED_WORKER_FIXTURE_PASSWORD=...\
#   SEED_PM_FIXTURE_PASSWORD=...    \
#   JWT_SECRET=$(openssl rand -hex 32) \
#     ./scripts/run-e2e-local.sh
#
#   Pass extra Playwright args after `--`:
#     ./scripts/run-e2e-local.sh -- tests/e2e/leads-converted-filter.spec.ts
#
# All four password env vars must satisfy the API password policy
# (>= 12 chars, no obvious weak patterns); see seed-users.mjs header.
# JWT_SECRET only needs to be a random 32+ char string — the test DB
# is throwaway, it does NOT need to match production.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "::error:: $name is required (see header of $0)" >&2
    exit 1
  fi
}

require_env SEED_ADMIN_CESAR_PASSWORD
require_env SEED_ADMIN_ANWAR_PASSWORD
require_env SEED_WORKER_FIXTURE_PASSWORD
require_env SEED_PM_FIXTURE_PASSWORD
require_env JWT_SECRET

# 1. Resolve a chromium binary that actually has its system libs.
#    Prefer an explicitly-set CHROMIUM_PATH; otherwise look on PATH.
if [ -z "${CHROMIUM_PATH:-}" ]; then
  if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_PATH="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    CHROMIUM_PATH="$(command -v chromium-browser)"
  else
    echo "::error:: no system chromium found. Add pkgs.chromium to replit.nix" >&2
    echo "         or export CHROMIUM_PATH to point at a chromium binary." >&2
    exit 1
  fi
fi
export CHROMIUM_PATH
echo "[run-e2e] using chromium: $CHROMIUM_PATH"

# 2. Test DB connection. Defaults match setup-test-db.ts; override by
#    exporting TEST_DATABASE_URL before invoking this script.
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test}"
export DATABASE_URL="$TEST_DATABASE_URL"
# Make sure the api-server doesn't try to dial Supabase.
export SUPABASE_DATABASE_URL=""

# 3. Ports the playwright config + api-server expect.
export API_PORT="${API_PORT:-8080}"
export CADSTONE_PORT="${CADSTONE_PORT:-21903}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${CADSTONE_PORT}}"

# Email is exercised by the invite flow auth.setup.ts uses for the PM
# fixture. We don't want real outbound mail in tests.
export RESEND_API_KEY="${RESEND_API_KEY:-}"
export EMAIL_FROM="${EMAIL_FROM:-noreply@cadstone.test}"
export APP_PUBLIC_URL="${APP_PUBLIC_URL:-$E2E_BASE_URL}"

API_LOG="$(mktemp -t cadstone-api.XXXXXX.log)"
VITE_LOG="$(mktemp -t cadstone-vite.XXXXXX.log)"
API_PID=""
VITE_PID=""

cleanup() {
  set +e
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
  fi
  if [ -n "$VITE_PID" ]; then
    kill "$VITE_PID" 2>/dev/null
    wait "$VITE_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# 4. Schema + seed.
echo "[run-e2e] recreating test DB schema..."
pnpm setup-test-db

echo "[run-e2e] seeding admins, worker fixture, and baseline E2E rows..."
node artifacts/api-server/scripts/seed-users.mjs --db=local

# 5. Boot api-server.
echo "[run-e2e] starting api-server on :$API_PORT (logs: $API_LOG)..."
( cd artifacts/api-server && PORT="$API_PORT" pnpm dev ) > "$API_LOG" 2>&1 &
API_PID=$!

wait_for_port() {
  local url="$1"; local label="$2"; local logfile="$3"
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[run-e2e] $label is up"
      return 0
    fi
    sleep 0.5
  done
  echo "::error:: $label did not start within 60s. Last log lines:" >&2
  tail -n 200 "$logfile" >&2 || true
  exit 1
}

# Use the cheap /api/livez probe defined in
# artifacts/api-server/src/routes/health.ts. Don't probe `/` — it only
# serves index.html when the dist bundle is present, and the local flow
# runs Vite separately.
wait_for_port "http://127.0.0.1:${API_PORT}/api/livez" "api-server" "$API_LOG"

# 6. Boot Vite dev server.
echo "[run-e2e] starting Vite dev server on :$CADSTONE_PORT (logs: $VITE_LOG)..."
( cd artifacts/cadstone && PORT="$CADSTONE_PORT" pnpm dev ) > "$VITE_LOG" 2>&1 &
VITE_PID=$!

wait_for_port "http://127.0.0.1:${CADSTONE_PORT}/" "vite" "$VITE_LOG"

# 7. Run Playwright. Forward any extra args after `--` straight through.
EXTRA_ARGS=()
if [ "$#" -gt 0 ] && [ "$1" = "--" ]; then
  shift
  EXTRA_ARGS=("$@")
fi

echo "[run-e2e] running Playwright suite..."
pnpm --filter @workspace/cadstone test:e2e "${EXTRA_ARGS[@]}"
