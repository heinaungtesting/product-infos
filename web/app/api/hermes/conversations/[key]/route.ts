import { CONVERSATION_RE } from "@/lib/chat-store";
import { chatStore, turnStore } from "@/lib/hermes";
import { json } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/hermes/conversations/[key]">) {
  const key = decodeURIComponent((await ctx.params).key);
  if (!CONVERSATION_RE.test(key)) return json({ error: "Bad conversation key." }, 400);
  const running = turnStore.runningFor(key);
  return json({
    messages: chatStore.get(key).messages,
    running: running ? { id: running.id, text: running.text } : null,
  });
}
