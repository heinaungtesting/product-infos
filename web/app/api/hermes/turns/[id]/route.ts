import { turnStore } from "@/lib/hermes";
import { json, ndjsonHeaders } from "@/lib/http";

/** Resume a turn's stream after a dropped connection. Never re-sends the prompt. */
export async function GET(req: Request, ctx: RouteContext<"/api/hermes/turns/[id]">) {
  const turn = turnStore.get((await ctx.params).id);
  if (!turn) return json({ error: "This answer has expired. Reload the conversation." }, 404);
  const after = Number(new URL(req.url).searchParams.get("after") ?? -1);
  return new Response(turnStore.stream(turn, Number.isFinite(after) ? after : -1), { headers: ndjsonHeaders });
}
