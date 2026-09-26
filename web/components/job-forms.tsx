"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? `Save failed (${res.status}).`;
  } catch {
    return "Can't reach the dashboard server. Check your connection.";
  }
}

const NEEDS_NOTE = new Set(["applied", "interview", "offer", "rejected"]);

export function RecordForm({ jobId, allowed }: { jobId: string; allowed: string[] }) {
  const router = useRouter();
  const [status, setStatus] = useState(allowed[0] ?? "");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState("");
  const [external, setExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!allowed.length) return <p className="sub">This job has no further status changes.</p>;
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await post(`/api/jobs/${jobId}/record`, { status, note, stage, external: status === "applied" && external });
        setBusy(false);
        setError(err);
        if (!err) {
          setNote("");
          router.refresh();
        }
      }}
    >
      <label>
        New status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {allowed.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </label>
      {status === "interview" && (
        <label>
          Stage
          <input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="1次" maxLength={40} />
        </label>
      )}
      {status === "applied" && (
        <label className="check">
          <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
          Applied outside Job OS (no résumé version to pin)
        </label>
      )}
      <label>
        {NEEDS_NOTE.has(status) ? "Confirmation (quote the email or page) — required" : "Note"}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Record result"}</button>
    </form>
  );
}

export function ScheduleForm({ jobId, action, due, kind: initialKind = "task" }: { jobId: string; action: string; due: string; kind?: string }) {
  const router = useRouter();
  const [next, setNext] = useState(action);
  const [when, setWhen] = useState(due ? due.slice(0, 16) : "");
  const [kind, setKind] = useState(initialKind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await post(`/api/jobs/${jobId}/schedule`, { action: next, due: when, kind });
        setBusy(false);
        setError(err);
        if (!err) router.refresh();
      }}
    >
      <label>
        Next step
        <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={200} required />
      </label>
      <label>
        Due (JST)
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      <div className="seg" role="group" aria-label="Kind">
        <button type="button" aria-pressed={kind === "task"} onClick={() => setKind("task")}>Task</button>
        <button type="button" aria-pressed={kind === "interview"} onClick={() => setKind("interview")}>Interview</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Set next step"}</button>
    </form>
  );
}
