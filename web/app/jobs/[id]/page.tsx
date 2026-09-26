import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordForm, ScheduleForm } from "@/components/job-forms";
import { Badge, ErrorPanel, Verdict } from "@/components/ui";
import { jst } from "@/lib/format";
import { JOB_ID_RE, JobOSError, runJobOS } from "@/lib/jobos";
import type { JobDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

function primaryAction(d: JobDetail) {
  const s = d.job.status;
  const ask = (prompt: string) => `/hermes?job=${d.job.id}&prompt=${encodeURIComponent(prompt)}`;
  if (s === "interview" || s === "applied") return { href: `/jobs/${d.job.id}/prep`, label: "Open interview prep" };
  if (s === "discovered" || s === "drafted") return { href: ask(`Draft a résumé for ${d.job.id} and show me the selected claims.`), label: "Draft résumé with Hermes" };
  return { href: ask(`Walk me through a debrief for ${d.job.id}.`), label: "Debrief with Hermes" };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!JOB_ID_RE.test(id)) notFound();
  let d: JobDetail;
  try {
    d = await runJobOS<JobDetail>(["api", "job", id]);
  } catch (e) {
    if (e instanceof JobOSError && e.kind === "rule" && e.message.startsWith("No job")) notFound();
    return (<><h1>Job</h1><ErrorPanel error={e} /></>);
  }
  const j = d.job;
  const cov = { direct: 0, inferred: 0, none: 0 };
  d.match.forEach((m) => cov[m.match]++);
  const total = d.match.length || 1;
  const action = primaryAction(d);
  return (
    <>
      <p className="sub"><Link href="/pipeline">← Pipeline</Link></p>
      <h1>{j.company}</h1>
      <p className="muted">{j.title}</p>
      <p><Badge status={j.status} stage={j.stage} /> <Verdict verdict={j.verdict} /></p>
      {j.next_action && (
        <p className={j.overdue ? "red" : ""}>Next: {j.next_action} · <span className="num">{jst(j.due_at)}</span></p>
      )}
      <p><Link className="btn" href={action.href}>{action.label}</Link></p>

      {d.prescreen.reasons && d.prescreen.reasons.length > 0 && (
        <>
          <h2>Prescreen</h2>
          <ul className="rows">
            {d.prescreen.reasons.map((r, i) => (
              <li key={i} className="row"><Verdict verdict={r.level} /> <span className="row-main">{r.detail}</span></li>
            ))}
          </ul>
          {j.override_reason && <p className="sub">Override: {j.override_reason}</p>}
        </>
      )}

      <h2>Requirement coverage</h2>
      <div className="cov" aria-hidden>
        <span className="cov-direct" style={{ width: `${(cov.direct / total) * 100}%` }} />
        <span className="cov-inferred" style={{ width: `${(cov.inferred / total) * 100}%` }} />
        <span className="cov-none" style={{ width: `${(cov.none / total) * 100}%` }} />
      </div>
      <ul className="rows">
        {d.match.map((m) => (
          <li key={m.requirement} className="row">
            <span className="row-main">
              {m.requirement}{m.preferred && <span className="sub"> (preferred)</span>}
              {m.claims[0] && <span className="sub" style={{ display: "block" }}>{m.claims[0].claim}{m.claims[0].kind === "inferred" && ` via ${m.claims[0].path.join(" → ")}`}</span>}
            </span>
            <span className={`tag tag-${m.match}`}>{m.match === "none" ? "NO MATCH" : m.match}</span>
          </li>
        ))}
      </ul>

      {d.versions.length > 0 && (
        <>
          <h2>Résumé versions</h2>
          <ul className="rows">
            {d.versions.map((v) => (
              <li key={v.version} className="row">
                <span className="row-main">v{v.version} · {v.claims} claims{v.unmatched.length > 0 && <span className="red"> · {v.unmatched.length} unmatched</span>}</span>
                {v.sent && <span className="tag tag-direct">SENT</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Set next step</h2>
      <ScheduleForm jobId={j.id} action={j.next_action} due={j.due_at} />

      <h2>Record result</h2>
      <RecordForm jobId={j.id} allowed={d.allowed_next} />

      <h2>History</h2>
      <ul className="rows">
        {d.events.map((e, i) => (
          <li key={i} className="row">
            <Badge status={e.status} />
            <span className="row-main"><span className="sub">{jst(e.at)}</span><span style={{ display: "block" }}>{e.note}</span></span>
          </li>
        ))}
      </ul>
    </>
  );
}
