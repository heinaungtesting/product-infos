"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Tool = { name: string; status: string };
type Msg = { role: "user" | "assistant"; text: string; tools?: Tool[]; error?: string };
type Line =
  | { seq: number; type: "turn"; id: string }
  | { seq: number; type: "delta"; text: string }
  | { seq: number; type: "tool"; name: string; status: string }
  | { seq: number; type: "done" }
  | { seq: number; type: "error"; message: string };

const CHIPS = ["What's due this week?", "Prep me for my next interview.", "Which claims still have no code link?"];

export function Chat({ conversation: initialKey, job, initialPrompt }: { conversation: string; job?: string; initialPrompt?: string }) {
  const [conversation, setConversation] = useState(initialKey);
  const [health, setHealth] = useState<{ ok: boolean; detail: string; stopCancels: boolean } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState(initialPrompt ?? "");
  const [msgId, setMsgId] = useState<string | null>(initialPrompt ? crypto.randomUUID() : null);
  const [turn, setTurn] = useState<{ id: string; lastSeq: number; state: "streaming" | "dropped" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((ms) => (ms.length && ms[ms.length - 1].role === "assistant" ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms));

  /** Read an NDJSON turn stream. Returns true if it reached done/error. */
  const read = useCallback(async (res: Response, fromSeq: number): Promise<boolean> => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let turnId = "";
    let last = fromSeq;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = JSON.parse(buf.slice(0, nl)) as Line;
          buf = buf.slice(nl + 1);
          last = line.seq;
          if (line.type === "turn") turnId = line.id;
          setTurn((t) => ({ id: turnId || t?.id || "", lastSeq: last, state: "streaming" }));
          if (line.type === "delta") patchLast((m) => ({ ...m, text: m.text + line.text }));
          if (line.type === "tool") patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name: line.name, status: line.status }] }));
          if (line.type === "error") patchLast((m) => ({ ...m, error: line.message }));
          if (line.type === "done" || line.type === "error") {
            setTurn(null);
            return true;
          }
        }
      }
    } catch {
      /* dropped mid-stream */
    }
    setTurn((t) => (t ? { ...t, state: "dropped" } : t));
    return false;
  }, []);

  const loadConversation = useCallback(async (key: string) => {
    setNotice(null);
    try {
      const res = await fetch(`/api/hermes/conversations/${encodeURIComponent(key)}`, { cache: "no-store" });
      const data = await res.json();
      const history: Msg[] = data.messages ?? [];
      if (data.running) {
        // An answer is still being produced server-side: reattach from the start.
        setMessages([...history, { role: "user", text: data.running.text }, { role: "assistant", text: "" }]);
        setTurn({ id: data.running.id, lastSeq: -1, state: "streaming" });
        const r = await fetch(`/api/hermes/turns/${data.running.id}?after=-1`, { cache: "no-store" });
        if (r.ok) await read(r, -1);
      } else {
        setMessages(history);
        setTurn(null);
      }
    } catch {
      setNotice("Can't load this conversation. Check your connection.");
    }
  }, [read]);

  useEffect(() => {
    fetch("/api/hermes/health", { cache: "no-store" }).then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false, detail: "Dashboard server unreachable.", stopCancels: false }));
    void loadConversation(conversation);
  }, [conversation, loadConversation]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || turn) return;
    const id = msgId ?? crypto.randomUUID();
    setMsgId(id);
    setNotice(null);
    let res: Response;
    try {
      res = await fetch("/api/hermes/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation, text, clientMsgId: id }),
      });
    } catch {
      // We don't know if it arrived. Keep the same id: tapping Send again is safe.
      setNotice("Couldn't reach the server. Tap Send again — it won't be sent twice.");
      return;
    }
    if (res.status === 409) {
      const data = await res.json();
      if (data.error === "duplicate") {
        setDraft("");
        setMsgId(null);
        setNotice("That message was already received. Loading its answer…");
        await loadConversation(conversation);
      } else {
        setNotice(data.message ?? "Hermes is still answering.");
      }
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error ?? `Send failed (${res.status}).`);
      return;
    }
    setDraft("");
    setMsgId(null);
    setMessages((ms) => [...ms, { role: "user", text }, { role: "assistant", text: "" }]);
    await read(res, -1);
  }

  async function resume() {
    if (!turn) return;
    const res = await fetch(`/api/hermes/turns/${turn.id}?after=${turn.lastSeq}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      setTurn({ ...turn, state: "streaming" });
      await read(res, turn.lastSeq);
    } else {
      await loadConversation(conversation);
    }
  }

  async function stop() {
    if (!turn) return;
    await fetch(`/api/hermes/turns/${turn.id}/stop`, { method: "POST" }).catch(() => {});
  }

  function newConversation() {
    setConversation(`job-os${job ? `:${job}` : ""}:${Date.now()}`);
  }

  return (
    <>
      <p className="sub">
        <span className={`dot${health?.ok ? " on" : ""}`} aria-hidden />
        {health ? (health.ok ? "Hermes online" : `Hermes offline — ${health.detail}`) : "Checking Hermes…"}
        {" · "}<code>{conversation}</code>
      </p>
      <div className="chips">
        {CHIPS.map((c) => (
          <button key={c} className="btn secondary" onClick={() => { setDraft(c); setMsgId(crypto.randomUUID()); }}>{c}</button>
        ))}
        <button className="btn secondary" onClick={newConversation}>New conversation</button>
      </div>
      <p className="sub">Chat is for questions. Record statuses and deadlines with the forms on each job.</p>
      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.tools?.map((t, j) => (
              <div key={j} className={`tool${t.status === "denied" ? " denied" : ""}`}>
                {t.status === "denied" ? `⛔ ${t.name}: denied by Hermes' default approval policy — run this on the PC.` : `⚙ ${t.name} (${t.status})`}
              </div>
            ))}
            {m.text || (m.role === "assistant" && !m.error ? "…" : "")}
            {m.error && <div className="form-error">{m.error}</div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {turn?.state === "dropped" && (
        <div className="panel error" role="alert">
          <strong>Connection dropped. Hermes may still be answering.</strong>
          <p><button className="btn" onClick={resume}>Reload conversation</button></p>
        </div>
      )}
      {notice && <p className="form-error" role="alert">{notice}</p>}
      <div className="composer">
        <textarea
          aria-label="Message Hermes"
          value={draft}
          rows={2}
          onChange={(e) => {
            if (!draft && e.target.value) setMsgId(crypto.randomUUID());
            setDraft(e.target.value);
          }}
        />
        {turn?.state === "streaming" ? (
          <button className="btn secondary" onClick={stop}>{health?.stopCancels ? "Stop" : "Stop showing"}</button>
        ) : (
          <button className="btn" onClick={send} disabled={!draft.trim() || !!turn}>Send</button>
        )}
      </div>
    </>
  );
}
