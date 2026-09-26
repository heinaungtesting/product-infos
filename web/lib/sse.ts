/**
 * Hermes /v1/responses SSE → dashboard chat events.
 *
 * The event names below follow the OpenAI Responses shape that Hermes documents.
 * They are NOT yet validated against a live gateway: record a real stream
 * (see test/fixtures/README.md) and adjust `mapHermesEvent` to match it.
 * Unknown events are ignored, never fatal.
 */

export type ChatEvent =
  | { type: "turn"; id: string; conversation: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "started" | "done" | "denied" | "error"; detail?: string }
  | { type: "done"; responseId?: string }
  | { type: "error"; message: string };

export interface SSEMessage {
  event?: string;
  data: string;
}

/** Parse a byte stream of Server-Sent Events. Comment lines (keepalives) are skipped. */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  const reader = stream.getReader();
  const flush = function* (): Generator<SSEMessage> {
    if (data.length) yield { event, data: data.join("\n") };
    event = undefined;
    data = [];
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(buffer[nl] === "\r" ? nl + 2 : nl + 1);
        if (line === "") {
          yield* flush();
        } else if (line.startsWith(":")) {
          continue;
        } else {
          const i = line.indexOf(":");
          const field = i < 0 ? line : line.slice(0, i);
          const val = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
          if (field === "event") event = val;
          else if (field === "data") data.push(val);
        }
      }
      if (done) {
        if (buffer) data.push(buffer.replace(/^data: ?/, ""));
        yield* flush();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const TOOL_ITEM_TYPES = new Set(["function_call", "tool_call", "custom_tool_call", "mcp_call", "computer_call"]);
const DENIED_RE = /\b(denied|not approved|approval (required|denied)|blocked by policy)\b/i;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Final text of a completed response, used when the stream carried no deltas. */
export function responseText(response: unknown): string {
  const out = obj(response).output;
  if (!Array.isArray(out)) return str(obj(response).output_text);
  return out
    .flatMap((item) => (Array.isArray(obj(item).content) ? (obj(item).content as unknown[]) : []))
    .map((c) => str(obj(c).text))
    .join("");
}

export function mapHermesEvent(msg: SSEMessage): ChatEvent[] {
  if (msg.data === "[DONE]") return [];
  let json: Json;
  try {
    json = obj(JSON.parse(msg.data));
  } catch {
    return [];
  }
  const type = str(json.type) || msg.event || "";
  const item = obj(json.item);
  const itemType = str(item.type);

  if (type === "response.output_text.delta") return [{ type: "delta", text: str(json.delta) }];
  if (type === "response.output_item.added" && TOOL_ITEM_TYPES.has(itemType)) {
    return [{ type: "tool", name: str(item.name) || itemType, status: "started" }];
  }
  if (type === "response.output_item.done" && TOOL_ITEM_TYPES.has(itemType)) {
    const raw = JSON.stringify(item);
    const status = DENIED_RE.test(raw) ? "denied" : str(item.status) === "failed" ? "error" : "done";
    return [{ type: "tool", name: str(item.name) || itemType, status }];
  }
  if (/approval/i.test(type)) {
    return [{ type: "tool", name: str(json.name) || str(item.name) || "command", status: "denied", detail: str(json.command) }];
  }
  if (type === "response.completed") return [{ type: "done", responseId: str(obj(json.response).id) || undefined }];
  if (type === "response.failed" || type === "error" || type === "response.error") {
    const err = obj(json.error ?? obj(json.response).error);
    return [{ type: "error", message: str(err.message) || str(json.message) || "Hermes reported an error." }];
  }
  return [];
}

export function upstreamError(status: number, body: string): string {
  if (status === 401 || status === 403) return `Hermes rejected the API key (${status}). Check HERMES_API_KEY.`;
  if (status === 429) return "Hermes is busy (429). Try again in a moment.";
  return `Hermes returned ${status}: ${body.slice(0, 200)}`;
}
