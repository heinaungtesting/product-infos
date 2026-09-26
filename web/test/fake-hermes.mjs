/**
 * A FAKE Hermes gateway for local development only. It imitates the assumed
 * /v1/responses SSE shape. Passing against it proves nothing about the real
 * gateway — replace its output with a recorded live stream (see fixtures/README.md).
 *
 *   PORT=8649 FAKE_KEY=test-key node test/fake-hermes.mjs
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8649);
const key = process.env.FAKE_KEY ?? "test-key";
const delay = Number(process.env.FAKE_DELAY_MS ?? 150);
let requests = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok" }));
  if (req.url === "/_count") return res.end(JSON.stringify({ requests }));
  if (req.url !== "/v1/responses" || req.method !== "POST") return res.writeHead(404).end();
  if (req.headers.authorization !== `Bearer ${key}`) return res.writeHead(401).end("bad key");
  requests++;
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("response.created", { response: { id: `resp_${requests}` } });
  res.write(": keepalive\n\n");
  await sleep(delay);
  send("response.output_item.added", { item: { type: "function_call", name: "terminal" } });
  await sleep(delay);
  const denied = /danger|rm -rf/i.test(body.input);
  send("response.output_item.done", { item: { type: "function_call", name: "terminal", status: denied ? "failed" : "completed", output: denied ? "Command denied: approval required" : "ok" } });
  const reply = denied ? "I couldn't run that: the command was denied." : `(fake) You asked: ${body.input} [conversation=${body.conversation ?? body.previous_response_id ?? "-"}]`;
  for (const word of reply.split(/(?<= )/)) {
    send("response.output_text.delta", { delta: word });
    await sleep(delay / 3);
  }
  send("response.completed", { response: { id: `resp_${requests}` } });
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`fake Hermes on http://127.0.0.1:${port} (key: ${key})`));
