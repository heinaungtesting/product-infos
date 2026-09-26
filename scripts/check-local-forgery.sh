#!/usr/bin/env bash
# Smoke-test item: can a process ON THE SERVER masquerade as Hein by forging
# Tailscale-User-Login and calling the dashboard directly (bypassing Serve)?
#
#   scripts/check-local-forgery.sh 127.0.0.1:3000 hein@example.com
#   sudo -u hermes scripts/check-local-forgery.sh unix:/run/job-os/web.sock hein@example.com
#
# Run it as the OS user Hermes runs as. Expected:
#   unix socket  -> REFUSED (permission denied)   = boundary holds
#   127.0.0.1    -> ACCEPTED                      = documented gap (option 2)
set -u
target="${1:?target: host:port or unix:/path}"
login="${2:?allowed login to forge}"
if [[ "$target" == unix:* ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --unix-socket "${target#unix:}" -H "Tailscale-User-Login: $login" http://localhost/ 2>/dev/null)
else
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Tailscale-User-Login: $login" "http://$target/" 2>/dev/null)
fi
echo "user=$(id -un) target=$target http=$code"
if [[ "$code" == "200" ]]; then
  echo "ACCEPTED: a local process can act as $login. Use a Unix socket, or record this as a known gap."
  exit 1
fi
echo "REFUSED: forged identity did not get in."
