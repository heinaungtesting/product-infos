#!/usr/bin/env bash
# Start the Job OS dashboard (production) for the tailnet. Registered as a Windows logon task
# by scripts/install-autostart.ps1. Secrets stay in the Hermes .env; nothing is copied here.
set -euo pipefail

HERMES="${LOCALAPPDATA:-/c/Users/$USERNAME/AppData/Local}/hermes"
HERMES="${HERMES//\\//}"
WEB="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HERMES/logs/jobos-dashboard.log"
mkdir -p "$(dirname "$LOG")"

# Already running? (port 3100 answers) → nothing to do.
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3100/; then
  echo "$(date -Is) already running" >> "$LOG"; exit 0
fi

HERMES_API_KEY="$(grep -E '^API_SERVER_KEY=' "$HERMES/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
export HERMES_API_KEY
export NODE_ENV=production LISTEN=127.0.0.1:3100 PYTHON=python
export JOB_OS_PY="$HERMES/skills/career/job-os/job_os.py" JOB_OS_DIR="$HERMES/skills/career/job-os"
export HERMES_CRON_DIR="$HERMES/cron"
export ALLOWED_TAILSCALE_LOGINS="${ALLOWED_TAILSCALE_LOGINS:-hhamaster199@gmail.com}"
export DASHBOARD_ORIGIN="${DASHBOARD_ORIGIN:-https://msi.tail71ac56.ts.net:8443}"

cd "$WEB"
# Rebuild when there's no build or any git-tracked file in web/ (incl. proxy.ts auth, configs, lockfile)
# is newer than it, so logon never serves a stale bundle.
stale() {
  [ -f .next/BUILD_ID ] || return 0
  local f
  while IFS= read -r -d '' f; do
    { [ ! -e "$f" ] || [ "$f" -nt .next/BUILD_ID ]; } && return 0   # deleted or newer → rebuild
  done < <(git ls-files -z -- . 2>/dev/null)
  return 1
}
if stale; then
  echo "$(date -Is) building" >> "$LOG"
  npm run build >> "$LOG" 2>&1
fi
# tailscale serve config persists across reboots; re-assert it in case it was reset.
tailscale serve --bg --https=8443 http://127.0.0.1:3100 >> "$LOG" 2>&1 || true
echo "$(date -Is) starting" >> "$LOG"
exec node server.mjs >> "$LOG" 2>&1
