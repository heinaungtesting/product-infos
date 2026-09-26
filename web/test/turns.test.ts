import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ChatStore } from "../lib/chat-store";
import { TurnStore, type Sequenced } from "../lib/turns";

const enc = new TextEncoder();
const hermes = { url: "http://hermes", apiKey: "k", model: "m", continuation: "conversation" as const, turnTimeoutMs: 5000 };

/** Fake fetch whose SSE body is released by calling `release()`. */
function gatedFetch() {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchFn = (async () => {
    calls++;
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        send({ type: "response.output_item.added", item: { type: "function_call", name: "terminal" } });
        await gate;
        send({ type: "response.output_text.delta", delta: "Hello" });
        send({ type: "response.completed", response: { id: "resp_1" } });
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, release, calls: () => calls };
}

function store(fetchFn: typeof fetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobos-"));
  const chat = new ChatStore(path.join(dir, "chat.json"));
  return { turns: new TurnStore({ fetch: fetchFn, chat, hermes }), chat };
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<Sequenced[]> {
  const text = await new Response(s).text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

test("duplicate clientMsgId never reaches Hermes twice; second send while running is busy", async () => {
  const f = gatedFetch();
  const { turns } = store(f.fetchFn);
  const a = turns.start("job-os", "hi", ID1);
  assert.equal(a.kind, "started");
  assert.equal(turns.start("job-os", "hi", ID1).kind, "duplicate");
  assert.equal(turns.start("job-os", "other", ID2).kind, "busy");
  f.release();
  await readAll(turns.stream(a.turn));
  assert.equal(f.calls(), 1);
  assert.equal(turns.start("job-os", "hi", ID1).kind, "duplicate"); // still remembered after finishing
});

test("turn keeps running when the reader disconnects, and resumes from a sequence number", async () => {
  const f = gatedFetch();
  const { turns, chat } = store(f.fetchFn);
  const { turn } = turns.start("job-os:acme", "status?", ID1);
  const reader = turns.stream(turn).getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim().split("\n")[0]);
  assert.equal(first.type, "turn");
  await reader.cancel(); // phone lost signal
  f.release();
  const rest = await readAll(turns.stream(turn, first.seq));
  assert.deepEqual(rest.map((e) => e.type), ["tool", "delta", "done"]);
  assert.equal(f.calls(), 1);
  const saved = chat.get("job-os:acme");
  assert.equal(saved.lastResponseId, "resp_1");
  assert.deepEqual(saved.messages.map((m) => [m.role, m.text]), [["user", "status?"], ["assistant", "Hello"]]);
});

test("unreachable Hermes gives the fix, not a stack trace", async () => {
  const { turns } = store((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  const { turn } = turns.start("job-os", "hi", ID1);
  const events = await readAll(turns.stream(turn));
  assert.match((events.at(-1) as { message: string }).message, /hermes gateway/);
});

test("401 from Hermes names the API key", async () => {
  const { turns } = store((async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
  const { turn } = turns.start("job-os", "hi", ID1);
  const events = await readAll(turns.stream(turn));
  assert.match((events.at(-1) as { message: string }).message, /HERMES_API_KEY/);
});
