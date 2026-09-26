import "server-only";
import { checkOrigin } from "./auth";
import { config } from "./config";
import { JobOSError } from "./jobos";

export const noStore = { "cache-control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/** CSRF guard for every write route. */
export function requireSameOrigin(req: Request): Response | null {
  if (checkOrigin(req.headers, config.dashboardOrigin)) return null;
  return json({ error: "Blocked: this request did not come from the dashboard (Origin check)." }, 403);
}

export function errorResponse(e: unknown): Response {
  if (e instanceof JobOSError) return json({ error: e.message, kind: e.kind }, e.kind === "rule" ? 422 : 500);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const ndjsonHeaders = { "content-type": "application/x-ndjson; charset=utf-8", ...noStore, "x-accel-buffering": "no" };
