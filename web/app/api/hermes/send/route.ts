import { CONVERSATION_RE } from "@/lib/chat-store";
import { turnStore } from "@/lib/hermes";
import { json, ndjsonHeaders, readJson, requireSameOrigin } from "@/lib/http";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  const body = await readJson(req);
  const conversation = String(body.conversation ?? "");
  const text = String(body.text ?? "").trim();
  const clientMsgId = String(body.clientMsgId ?? "");
  if (!CONVERSATION_RE.test(conversation)) return json({ error: "Bad conversation key." }, 400);
  if (!text || text.length > 4000) return json({ error: "Message must be 1–4000 characters." }, 400);
  if (!UUID_RE.test(clientMsgId)) return json({ error: "Missing clientMsgId." }, 400);

  const result = turnStore.start(conversation, text, clientMsgId);
  if (result.kind === "duplicate") {
    return json({ error: "duplicate", turnId: result.turn.id, status: result.turn.status }, 409);
  }
  if (result.kind === "busy") {
    return json({ error: "busy", message: "Hermes is still answering in this conversation.", turnId: result.turn.id }, 409);
  }
  return new Response(turnStore.stream(result.turn), { headers: ndjsonHeaders });
}
