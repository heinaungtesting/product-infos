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

const SKIP_REASONS = ["Not a fit", "SES / staffing", "Language bar", "Deadline passed"];

/** Keep / Skip for an undecided (discovered) job. Skip records withdrawn with the reason. */
export function TriageActions({ jobId, company }: { jobId: string; company: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "skip">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(decision: "keep" | "skip", why = "") {
    setBusy(true);
    const err = await post(`/api/jobs/${jobId}/triage`, { decision, reason: why });
    setBusy(false);
    setError(err);
    if (!err) {
      setMode("idle");
      router.refresh();
    }
  }

  if (mode === "skip") {
    return (
      <form
        className="triage-skip"
        onSubmit={(e) => {
          e.preventDefault();
          send("skip", reason);
        }}
      >
        <div className="chips" role="group" aria-label={`Reason for skipping ${company}`}>
          {SKIP_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Or type a reason" aria-label="Reason" />
        <div className="triage-buttons">
          <button type="button" className="btn secondary sm" onClick={() => { setMode("idle"); setError(null); }} disabled={busy}>Cancel</button>
          <button className="btn danger sm" disabled={busy || !reason.trim()}>{busy ? "Saving…" : "Skip job"}</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    );
  }
  return (
    <div className="triage-buttons">
      <button type="button" className="btn secondary sm" onClick={() => setMode("skip")} disabled={busy} aria-label={`Skip ${company}`}>Skip</button>
      <button type="button" className="btn primary sm" onClick={() => send("keep")} disabled={busy} aria-label={`Keep ${company}`}>{busy ? "…" : "Keep"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

const PERMALINK = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{7,40}\/\S+$/;

/** Paste a GitHub commit permalink onto a claim. Saved as unverified until reviewed on the PC. */
export function EvidenceForm({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = url.trim();
  const looksBranch = /\/blob\/(main|master|develop)\//.test(trimmed);
  const valid = PERMALINK.test(trimmed);

  if (!open) {
    return <button type="button" className="btn outline-amber" onClick={() => setOpen(true)}>Add code link</button>;
  }
  return (
    <form
      className="form evidence-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await post(`/api/claims/${claimId}/evidence`, { url: trimmed, note, confirm });
        setBusy(false);
        setError(err);
        if (!err) {
          setUrl("");
          setNote("");
          setConfirm(false);
          setOpen(false);
          router.refresh();
        }
      }}
    >
      <label>
        GitHub commit permalink
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="https://github.com/you/repo/blob/1a2b3c4/src/file.ts#L10-L40" maxLength={500} required />
      </label>
      {looksBranch && <p className="form-error">That's a branch link — it moves. On GitHub, press <kbd>y</kbd> to switch to a commit link.</p>}
      <label>
        What it shows <span className="muted">(optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. offline detection hook" />
      </label>
      <label className="check">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        I opened this link and the code implements this claim.
      </label>
      <p className="sub">Saved as <strong>unverified</strong>. Mark it verified on the PC after a proper review.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="triage-buttons">
        <button type="button" className="btn secondary" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>Cancel</button>
        <button className="btn primary" disabled={busy || !valid || !confirm}>{busy ? "Saving…" : "Save link"}</button>
      </div>
    </form>
  );
}

type Q = { q: string; claim: string; stuck: boolean; better_answer: string };
const emptyQ = (): Q => ({ q: "", claim: "", stuck: false, better_answer: "" });

/** Post-interview debrief. Questions feed the drill bank; "next time" becomes a prep lesson. */
export function DebriefForm({ jobId, stage: initialStage, claims }: { jobId: string; stage: string; claims: { id: string; label: string }[] }) {
  const router = useRouter();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [stage, setStage] = useState(initialStage);
  const [date, setDate] = useState(today);
  const [format, setFormat] = useState<"online" | "onsite">("online");
  const [interviewers, setInterviewers] = useState("");
  const [qs, setQs] = useState<Q[]>([emptyQ()]);
  const [wentWell, setWentWell] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const set = (i: number, patch: Partial<Q>) => setQs((all) => all.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const filled = qs.filter((q) => q.q.trim()).length;

  return (
    <form
      className="form debrief-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await post(`/api/jobs/${jobId}/debrief`, {
          stage, date, format, interviewers, went_well: wentWell, next_time: nextTime,
          questions: qs.filter((q) => q.q.trim()),
        });
        setBusy(false);
        setError(err);
        if (!err) {
          setSaved(filled);
          setQs([emptyQ()]);
          setWentWell("");
          setNextTime("");
          router.refresh();
        }
      }}
    >
      <div className="form-row">
        <label>Stage<input value={stage} onChange={(e) => setStage(e.target.value)} maxLength={40} placeholder="1次面接" /></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="seg" role="group" aria-label="Format">
        <button type="button" aria-pressed={format === "online"} onClick={() => setFormat("online")}>Online</button>
        <button type="button" aria-pressed={format === "onsite"} onClick={() => setFormat("onsite")}>Onsite</button>
      </div>
      <label>Interviewers <span className="muted">(roles only, no names)</span>
        <input value={interviewers} onChange={(e) => setInterviewers(e.target.value)} maxLength={80} placeholder="エンジニア2名" />
      </label>

      <fieldset className="debrief-qs">
        <legend>Questions they asked</legend>
        {qs.map((q, i) => (
          <div key={i} className={`debrief-q${q.stuck ? " stuck" : ""}`}>
            <div className="debrief-q-head">
              <span className="qnum num">{i + 1}</span>
              <textarea value={q.q} onChange={(e) => set(i, { q: e.target.value })} rows={2} maxLength={300}
                placeholder="The question, as you remember it" aria-label={`Question ${i + 1}`} />
              {qs.length > 1 && (
                <button type="button" className="icon-btn" onClick={() => setQs((all) => all.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}>×</button>
              )}
            </div>
            <div className="form-row">
              <label className="check"><input type="checkbox" checked={q.stuck} onChange={(e) => set(i, { stuck: e.target.checked })} />I got stuck</label>
              {claims.length > 0 && (
                <label>About
                  <select value={q.claim} onChange={(e) => set(i, { claim: e.target.value })}>
                    <option value="">General</option>
                    {claims.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {q.stuck && (
              <label>Better answer now <span className="muted">(optional)</span>
                <textarea value={q.better_answer} onChange={(e) => set(i, { better_answer: e.target.value })} rows={2} maxLength={800} />
              </label>
            )}
          </div>
        ))}
        {qs.length < 30 && <button type="button" className="btn secondary" onClick={() => setQs((all) => [...all, emptyQ()])}>+ Add question</button>}
      </fieldset>

      <label>What went well<textarea value={wentWell} onChange={(e) => setWentWell(e.target.value)} rows={2} maxLength={500} /></label>
      <label>One change for next time<textarea value={nextTime} onChange={(e) => setNextTime(e.target.value)} rows={2} maxLength={300} placeholder="Shows up in interview prep as a lesson" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved !== null && !error && <p className="form-ok" role="status">Saved — {saved} question{saved === 1 ? "" : "s"} added to your drill bank.</p>}
      <button className="btn primary" disabled={busy || !filled}>{busy ? "Saving…" : `Save debrief${filled ? ` (${filled})` : ""}`}</button>
    </form>
  );
}
