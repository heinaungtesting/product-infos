import os from "node:os";
import path from "node:path";

const defaultHermesHome = process.platform === "win32"
  ? path.join(os.homedir(), "AppData", "Local", "hermes")
  : path.join(os.homedir(), ".hermes");

/** Server-only configuration. Nothing here is sent to the browser. */
export const config = {
  jobOsPy: process.env.JOB_OS_PY ?? path.resolve(process.cwd(), "..", "job_os.py"),
  python: process.env.PYTHON ?? "python3",
  jobOsDir: process.env.JOB_OS_DIR ?? path.resolve(process.cwd(), "..", "workspace"),
  cronDir: process.env.HERMES_CRON_DIR ?? path.join(process.env.HERMES_HOME ?? defaultHermesHome, "cron"),
  allowedLogins: (process.env.ALLOWED_TAILSCALE_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "",
  /** Only honoured by `next dev`; lets you use the dashboard without Serve on your PC. */
  devLogin: process.env.NODE_ENV === "development" ? (process.env.JOB_OS_DEV_LOGIN ?? "") : "",
  hermes: {
    url: (process.env.HERMES_URL ?? "http://127.0.0.1:8642").replace(/\/$/, ""),
    apiKey: process.env.HERMES_API_KEY ?? "",
    model: process.env.HERMES_MODEL ?? "hermes-agent",
    /** "conversation" (named threads) or "previous_response_id" — pick after the live contract test. */
    continuation: process.env.HERMES_CONTINUATION === "previous_response_id" ? "previous_response_id" : "conversation",
    /** Set to "true" only after the live test shows that aborting the request cancels the run. */
    stopCancels: process.env.HERMES_STOP_CANCELS === "true",
    turnTimeoutMs: Number(process.env.HERMES_TURN_TIMEOUT_MS ?? 300_000),
  },
} as const;
