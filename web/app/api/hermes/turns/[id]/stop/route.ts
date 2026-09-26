import { turnStore } from "@/lib/hermes";
import { json, requireSameOrigin } from "@/lib/http";

export async function POST(req: Request, ctx: RouteContext<"/api/hermes/turns/[id]/stop">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  return json({ stopped: turnStore.stop((await ctx.params).id) });
}
