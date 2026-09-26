import { NextResponse, type NextRequest } from "next/server";
import { checkIdentity } from "./lib/auth";
import { config as appConfig } from "./lib/config";

/**
 * Every request needs an allowlisted Tailscale login. Trustworthy only via
 * `tailscale serve`; keep Next.js bound to 127.0.0.1 or a Unix socket.
 */
export function proxy(request: NextRequest) {
  const result = checkIdentity(request.headers, appConfig.allowedLogins, appConfig.devLogin);
  if (!result.ok) {
    return new NextResponse(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Static build assets carry no personal data; everything else needs identity.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
