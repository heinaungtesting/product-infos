import assert from "node:assert/strict";
import { test } from "node:test";
import { mapHermesEvent, parseSSE, type SSEMessage } from "../lib/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { chunks.forEach((s) => c.enqueue(enc.encode(s))); c.close(); } });
}

async function collect(chunks: string[]): Promise<SSEMessage[]> {
  const out: SSEMessage[] = [];
  for await (const m of parseSSE(streamOf(chunks))) out.push(m);
  return out;
}

test("parses events split across chunks, CRLF, comments and multi-line data", async () => {
  const msgs = await collect(["event: a\r\nda", "ta: 1\r\n\r\n: keepalive\n\n", "data: x\ndata: y\n\n", "data: tail"]);
  assert.deepEqual(msgs, [{ event: "a", data: "1" }, { event: undefined, data: "x\ny" }, { event: undefined, data: "tail" }]);
});

test("maps text deltas, tools, denials, completion and errors", () => {
  const ev = (type: string, extra: object = {}) => ({ data: JSON.stringify({ type, ...extra }) });
  assert.deepEqual(mapHermesEvent(ev("response.output_text.delta", { delta: "hi" })), [{ type: "delta", text: "hi" }]);
  assert.deepEqual(mapHermesEvent(ev("response.output_item.added", { item: { type: "function_call", name: "terminal" } })), [{ type: "tool", name: "terminal", status: "started" }]);
  assert.equal((mapHermesEvent(ev("response.output_item.done", { item: { type: "function_call", name: "terminal", output: "Command denied" } }))[0] as { status: string }).status, "denied");
  assert.deepEqual(mapHermesEvent(ev("response.completed", { response: { id: "r1" } })), [{ type: "done", responseId: "r1" }]);
  assert.deepEqual(mapHermesEvent(ev("response.failed", { response: { error: { message: "boom" } } })), [{ type: "error", message: "boom" }]);
  assert.deepEqual(mapHermesEvent(ev("some.future.event")), []);
  assert.deepEqual(mapHermesEvent({ data: "[DONE]" }), []);
  assert.deepEqual(mapHermesEvent({ data: "not json" }), []);
});
