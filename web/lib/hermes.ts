import "server-only";
import path from "node:path";
import { ChatStore } from "./chat-store";
import { config } from "./config";
import { TurnStore } from "./turns";

// One store per server process (survives dev hot reloads).
const g = globalThis as unknown as { __jobOsTurns?: TurnStore; __jobOsChat?: ChatStore };

export const chatStore = (g.__jobOsChat ??= new ChatStore(path.join(config.jobOsDir, "web-state", "chat.json")));
export const turnStore = (g.__jobOsTurns ??= new TurnStore({
  fetch: (...a) => fetch(...a),
  chat: chatStore,
  hermes: config.hermes,
}));

export async function hermesHealth(): Promise<{ ok: boolean; detail: string }> {
  if (!config.hermes.apiKey) return { ok: false, detail: "HERMES_API_KEY is not set on the dashboard server." };
  try {
    const res = await fetch(`${config.hermes.url}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return { ok: false, detail: `Hermes /health returned ${res.status}.` };
    return { ok: true, detail: "Online" };
  } catch {
    return { ok: false, detail: "Hermes is unreachable — is `hermes gateway` running?" };
  }
}
