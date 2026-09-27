"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { jst } from "@/lib/format";
import type { ResumeList, ResumeSaveResult, ResumeVersion } from "@/lib/types";
import { Icon } from "./icons";

async function call(url: string, method: "POST" | "DELETE", body?: unknown): Promise<{ ok: ResumeSaveResult | null; error: string | null }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: data as ResumeSaveResult, error: null };
    return { ok: null, error: data.error ?? `Failed (${res.status}).` };
  } catch {
    return { ok: null, error: "Can't reach the dashboard server. Check your connection." };
  }
}

const MAX = 600;

/** Create / read / update / delete résumé versions. Every write is idempotent on the server:
 *  identical content is reported as "already exists" and nothing is executed. */
export function ResumeManager({ jobId, data }: { jobId: string; data: ResumeList }) {
  const router = useRouter();
  const latest = (lang: "ja" | "en") => [...data.versions].reverse().find((v) => v.language === lang);
  const [lang, setLang] = useState<"ja" | "en">(latest("en") && !latest("ja") ? "en" : "ja");
  const [motivation, setMotivation] = useState(latest("ja")?.motivation ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "same"; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const base = latest(lang);
  // Only the server knows whether claims/profile changed, so the button is never disabled on a guess.
  const sameText = !!base && (lang === "en" || motivation.trim() === base.motivation.trim());

  async function save() {
    setBusy("save");
    setError(null);
    setNotice(null);
    const r = await call(`/api/jobs/${jobId}/resumes`, "POST", { language: lang, motivation: lang === "ja" ? motivation : "" });
    setBusy(null);
    if (r.error) return setError(r.error);
    if (r.ok!.action === "unchanged") return setNotice({ kind: "same", text: `Already exists as v${r.ok!.version} — nothing was created.` });
    setNotice({ kind: "ok", text: `Created v${r.ok!.version}${r.ok!.ready === false ? " — has 【未記入】 items, not sendable yet" : ""}.` });
    router.refresh();
  }

  async function remove(v: number) {
    setBusy(`del-${v}`);
    setError(null);
    setNotice(null);
    const r = await call(`/api/jobs/${jobId}/resumes?version=${v}`, "DELETE");
    setBusy(null);
    setConfirmDel(null);
    if (r.error) return setError(r.error);
    setNotice({ kind: r.ok!.action === "deleted" ? "ok" : "same", text: r.ok!.action === "deleted" ? `Deleted v${v} (archived on the PC).` : r.ok!.message ?? "Nothing to delete." });
    router.refresh();
  }

  return (
    <div className="resume-manager">
      {data.versions.length === 0 && <p className="sub">No résumé yet for this job.</p>}
      {data.versions.length > 0 && (
        <ul className="rows resume-rows">
          {[...data.versions].reverse().map((v) => (
            <VersionRow key={v.version} jobId={jobId} v={v} canDelete={data.can_draft && !v.sent}
              confirming={confirmDel === v.version} busy={busy === `del-${v.version}`}
              onAsk={() => setConfirmDel(v.version)} onCancel={() => setConfirmDel(null)} onDelete={() => remove(v.version)}
              onEdit={() => { setLang(v.language); if (v.language === "ja") setMotivation(v.motivation); setNotice(null); document.getElementById("resume-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
          ))}
        </ul>
      )}

      {data.can_draft ? (
        <form id="resume-editor" className="form resume-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="chips" role="group" aria-label="Résumé language">
            <button type="button" className="chip" aria-pressed={lang === "ja"} onClick={() => { setLang("ja"); setNotice(null); }}>履歴書（日本語）</button>
            <button type="button" className="chip" aria-pressed={lang === "en"} onClick={() => { setLang("en"); setNotice(null); }}>English</button>
          </div>
          {lang === "ja" && (
            <label>
              志望動機 <span className="muted">(your own words · {motivation.trim().length}/{MAX})</span>
              <textarea value={motivation} onChange={(e) => { setMotivation(e.target.value); setNotice(null); }} rows={7} maxLength={MAX + 50}
                placeholder="Leave empty to draft with 【未記入】 — it won't be sendable until you write it." />
            </label>
          )}
          {motivation.trim().length > MAX && lang === "ja" && <p className="form-error">Over {MAX} characters — the 履歴書 box won't fit it.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className={notice.kind === "ok" ? "form-ok" : "form-note"} role="status">{notice.text}</p>}
          <button className="btn primary block" disabled={!!busy || (lang === "ja" && motivation.trim().length > MAX)}>
            {busy === "save" ? "Checking…" : base ? "Save changes" : "Create résumé"}
          </button>
          <p className="sub">
            {sameText
              ? `Same ${lang === "ja" ? "志望動機" : "input"} as v${base!.version}. Saving only creates a new version if your reviewed claims or profile changed since — otherwise nothing runs.`
              : "A new version is only created when something changed. Sent versions are never edited or deleted."}
          </p>
        </form>
      ) : (
        <p className="sub">This job is {data.status}; its résumé history is frozen.</p>
      )}
    </div>
  );
}

function VersionRow({ jobId, v, canDelete, confirming, busy, onAsk, onCancel, onDelete, onEdit }: {
  jobId: string; v: ResumeVersion; canDelete: boolean; confirming: boolean; busy: boolean;
  onAsk: () => void; onCancel: () => void; onDelete: () => void; onEdit: () => void;
}) {
  return (
    <li className="row resume-row">
      <span className="mini-icon"><Icon name="file" size={18} /></span>
      <span className="row-main">
        <strong>v{v.version}</strong> · {v.language === "ja" ? "履歴書" : "English"} · {v.claims} claims
        <span className="sub num">{jst(v.created_at)}</span>
        {!v.ready && (
          <details className="resume-missing">
            <summary>{v.placeholders.length} item{v.placeholders.length === 1 ? "" : "s"} 【未記入】 — not sendable</summary>
            <ul>{v.placeholders.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </details>
        )}
        {confirming ? (
          <span className="resume-actions">
            <button type="button" className="btn secondary sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn danger sm" onClick={onDelete} disabled={busy}>{busy ? "Deleting…" : `Delete v${v.version}`}</button>
          </span>
        ) : (
          <span className="resume-actions">
            {v.has_pdf && <a className="btn secondary sm" href={`/api/jobs/${jobId}/resumes/${v.version}/pdf`} target="_blank" rel="noreferrer">PDF</a>}
            {canDelete && <button type="button" className="btn secondary sm" onClick={onEdit}>Edit</button>}
            {canDelete && <button type="button" className="btn secondary sm" onClick={onAsk} aria-label={`Delete v${v.version}`}>Delete</button>}
          </span>
        )}
      </span>
      {v.sent ? <span className="match-tag match-direct">SENT</span> : v.ready ? <span className="match-tag match-direct">READY</span> : <span className="match-tag match-inferred">DRAFT</span>}
    </li>
  );
}
