/**
 * Identity comes from Tailscale Serve's `Tailscale-User-Login` header.
 * Serve sets it and strips spoofed copies, so it is trustworthy ONLY for
 * requests that arrived through Serve. See README "Local-forgery boundary".
 */
export type IdentityResult =
  | { ok: true; login: string }
  | { ok: false; status: 403; message: string };

export function checkIdentity(
  headers: Headers,
  allowed: readonly string[],
  devLogin = "",
): IdentityResult {
  const login = (headers.get("tailscale-user-login") ?? devLogin).trim().toLowerCase();
  if (!login) {
    return {
      ok: false,
      status: 403,
      message:
        "403 — No Tailscale identity. Open the dashboard through its `tailscale serve` URL from an untagged device (tagged devices and Funnel carry no identity).",
    };
  }
  if (allowed.length === 0) {
    return { ok: false, status: 403, message: `403 — ALLOWED_TAILSCALE_LOGINS is empty, so nobody is allowed. Seen login: ${login}` };
  }
  if (!allowed.includes(login)) {
    return { ok: false, status: 403, message: `403 — ${login} is not allowed on this dashboard.` };
  }
  return { ok: true, login };
}

/** Write routes must come from the dashboard's own origin (CSRF guard). */
export function checkOrigin(headers: Headers, dashboardOrigin = ""): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  if (dashboardOrigin && origin === dashboardOrigin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [headers.get("x-forwarded-host"), headers.get("host")].filter(Boolean);
  return hosts.includes(originHost);
}
