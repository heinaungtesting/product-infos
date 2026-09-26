import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIdentity, checkOrigin } from "../lib/auth";

const h = (o: Record<string, string>) => new Headers(o);

test("identity: allowlisted login passes, others and missing get 403", () => {
  assert.deepEqual(checkIdentity(h({ "tailscale-user-login": "Hein@Example.com" }), ["hein@example.com"]), { ok: true, login: "hein@example.com" });
  const other = checkIdentity(h({ "tailscale-user-login": "friend@example.com" }), ["hein@example.com"]);
  assert.equal(other.ok, false);
  assert.match(!other.ok ? other.message : "", /friend@example.com is not allowed/);
  const none = checkIdentity(h({}), ["hein@example.com"]);
  assert.match(!none.ok ? none.message : "", /No Tailscale identity/);
  assert.equal(checkIdentity(h({ "tailscale-user-login": "a@b" }), []).ok, false);
});

test("origin: same host or configured origin only", () => {
  assert.equal(checkOrigin(h({ origin: "https://box.tail1.ts.net", host: "box.tail1.ts.net" })), true);
  assert.equal(checkOrigin(h({ origin: "https://box.tail1.ts.net", host: "127.0.0.1:3000", "x-forwarded-host": "box.tail1.ts.net" })), true);
  assert.equal(checkOrigin(h({ origin: "https://evil.example", host: "box.tail1.ts.net" })), false);
  assert.equal(checkOrigin(h({ host: "box.tail1.ts.net" })), false);
  assert.equal(checkOrigin(h({ origin: "https://box.tail1.ts.net", host: "127.0.0.1:3000" }), "https://box.tail1.ts.net"), true);
});
