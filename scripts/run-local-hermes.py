"""Run the local Job OS dashboard against the real Hermes API (development only).

The API key stays in the server process environment; it is never sent to the browser
or written into this repository. Production access must use Tailscale Serve and the
identity controls described in README.md, not JOB_OS_DEV_LOGIN.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=os.environ.get("JOB_OS_DIR"), help="Existing Job OS data outside git")
    parser.add_argument("--login", help="Dev-only local login; never use for a deployed instance")
    parser.add_argument("--port", type=int, default=50543)
    parser.add_argument("--check", action="store_true", help="Verify authenticated Hermes API only; do not start the dashboard")
    args = parser.parse_args()
    if not args.check and (not args.data_dir or not args.login):
        parser.error("--data-dir and --login are required to start the dashboard")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    hermes_home = Path(os.environ.get("HERMES_HOME") or Path.home() / ("AppData/Local/hermes" if os.name == "nt" else ".hermes"))
    secret_path = hermes_home / ".env"
    try:
        lines = secret_path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        parser.error(f"Cannot read Hermes secrets at {secret_path}: {exc}")
    keys = dict(line.split("=", 1) for line in lines if "=" in line and not line.lstrip().startswith("#"))
    key = keys.get("API_SERVER_KEY", "").strip().strip('"').strip("'")
    if not key:
        parser.error("API_SERVER_KEY is missing from the active Hermes .env")

    # Fixed localhost target: never forward the API key to a user-supplied URL.
    request = urllib.request.Request(
        "http://127.0.0.1:8642/v1/models",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200:
                parser.error(f"Hermes /v1/models returned HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        parser.error(f"Hermes /v1/models returned HTTP {exc.code}; check API_SERVER_KEY")
    except urllib.error.URLError as exc:
        parser.error(f"Hermes API is unreachable at 127.0.0.1:8642: {exc.reason}")
    print("Hermes API authentication verified (200).", flush=True)
    if args.check:
        return 0

    data_dir = Path(args.data_dir).expanduser().resolve()
    if not (data_dir / "profile.json").is_file():
        parser.error(f"No profile.json in {data_dir}; initialise Job OS data first")
    repo = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env.update({
        "JOB_OS_DIR": str(data_dir),
        "JOB_OS_PY": str(repo / "job_os.py"),
        "PYTHON": sys.executable,
        "JOB_OS_DEV_LOGIN": args.login,
        "ALLOWED_TAILSCALE_LOGINS": args.login,
        "HERMES_URL": "http://127.0.0.1:8642",
        "HERMES_API_KEY": key,
        "HERMES_CONTINUATION": "previous_response_id",
        "PORT": str(args.port),
    })
    npm = "npm.cmd" if os.name == "nt" else "npm"
    print(f"Starting local development dashboard at http://127.0.0.1:{args.port}", flush=True)
    return subprocess.call([npm, "run", "dev"], cwd=repo / "web", env=env)


if __name__ == "__main__":
    raise SystemExit(main())
