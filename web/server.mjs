/**
 * Production server. Listens ONLY on loopback or a Unix socket, so the one way
 * in from other devices is `tailscale serve`.
 *
 *   LISTEN=127.0.0.1:3000                 (default)
 *   LISTEN=unix:/run/job-os/web.sock      (recommended: blocks local header forgery)
 *   SOCKET_MODE=660                        (octal permissions for the socket)
 */
import fs from "node:fs";
import { createServer } from "node:http";
import next from "next";
import nextEnv from "@next/env";

// Load .env.local before reading LISTEN (Next would otherwise load it later).
nextEnv.loadEnvConfig(import.meta.dirname, false);

const listen = process.env.LISTEN ?? "127.0.0.1:3000";
const app = next({ dev: false, dir: import.meta.dirname });
const handle = app.getRequestHandler();

await app.prepare();
const server = createServer((req, res) => handle(req, res));

if (listen.startsWith("unix:")) {
  const socket = listen.slice(5);
  if (fs.existsSync(socket)) fs.unlinkSync(socket);
  const mode = parseInt(process.env.SOCKET_MODE ?? "660", 8);
  // Create the socket with no access at all, then open it up to the chosen mode.
  const oldUmask = process.umask(0o777);
  server.listen(socket, () => {
    process.umask(oldUmask);
    fs.chmodSync(socket, mode);
    console.log(`Job OS dashboard on unix:${socket} (mode ${mode.toString(8)})`);
  });
} else {
  const i = listen.lastIndexOf(":");
  const host = listen.slice(0, i);
  const port = Number(listen.slice(i + 1));
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
    console.error(`Refusing to listen on ${host}: bind to 127.0.0.1 or a Unix socket and expose it with \`tailscale serve\`.`);
    process.exit(1);
  }
  server.listen(port, host, () => console.log(`Job OS dashboard on http://${host}:${port}`));
}
