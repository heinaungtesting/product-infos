import fs from "node:fs";
import path from "node:path";

/**
 * Chat history lives on the server (JOB_OS_DIR/web-state), never on the phone.
 * The phone loads it fresh every time it opens a conversation.
 */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; status: string }[];
  at: string;
  error?: string;
}

interface Conversation {
  lastResponseId?: string;
  messages: ChatMessage[];
}

const MAX_MESSAGES = 60;

export const CONVERSATION_RE = /^job-os(:[a-z0-9][a-z0-9-]{0,80})?(:\d{10,13})?$/;

export class ChatStore {
  private data: Record<string, Conversation> | null = null;

  constructor(private readonly file: string) {}

  private load(): Record<string, Conversation> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, Conversation>;
    } catch {
      this.data = {};
    }
    return this.data;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(key: string): Conversation {
    return this.load()[key] ?? { messages: [] };
  }

  append(key: string, messages: ChatMessage[], lastResponseId?: string): void {
    const all = this.load();
    const conv = all[key] ?? { messages: [] };
    conv.messages = [...conv.messages, ...messages].slice(-MAX_MESSAGES);
    if (lastResponseId) conv.lastResponseId = lastResponseId;
    all[key] = conv;
    this.save();
  }
}
