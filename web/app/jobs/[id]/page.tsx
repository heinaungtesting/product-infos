import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { RecordForm, ScheduleForm } from "@/components/job-forms";
import { DebriefForm, TriageActions } from "@/components/feature-forms";
import { ResumeManager } from "@/components/resume-manager";
import { Badge, ErrorPanel, Logo, PageHeader, Verdict } from "@/components/ui";
import { dueLabel, jst } from "@/lib/format";
import { JOB_ID_RE, JobOSError, runJobOS } from "@/lib/jobos";
import type { JobDetail, ResumeList } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEBRIEF_STATUSES = new Set(["applied", "interview", "offer", "rejected"]);

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
    return (<><PageHeader title="Job" date={false} back={{ href: "/pipeline", label: "Pipeline" }} /><ErrorPanel error={e} /></>);
  }
  const resumes = await runJobOS<ResumeList>(["resume", "list", id]).catch(() => null);
  const j = d.job;
  const cov = { direct: 0, inferred: 0, none: 0 };
  d.match.forEach((m) => cov[m.match]++);
  const total = d.match.length || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const action = primaryAction(d);
  return (
    <>
      <PageHeader title="Job" date={false} back={{ href: "/pipeline", label: "Pipeline" }} />

      <section className="card job-hero">
        <div className="job-hero-head">
          <Logo name={j.company} size={64} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{j.company}</h1>
            <p>{j.title}</p>
          </div>
        </div>
        <div className="tags">
          <Badge status={j.status} stage={j.stage} />
          <Verdict verdict={j.verdict} />
          {j.override && <span className="tag tag-amber">Override</span>}
          {j.url && <a className="tag tag-blue" href={j.url} target="_blank" rel="noreferrer noopener"><Icon name="link" size={14} />&nbsp;Posting</a>}
        </div>
        {j.next_action && (
          <div className={`next-step${j.overdue ? " overdue" : ""}`}>
            <Icon name={j.next_kind === "interview" ? "video" : "flag"} size={22} />
            <div>
              <strong>{j.next_action}</strong>
              <span className="sub num">{jst(j.due_at)} · {dueLabel(j.due_at, Date.now(), j.overdue)}</span>
            </div>
          </div>
        )}
        <Link className="btn primary block" href={action.href}>{action.label}<Icon name="arrow" size={18} /></Link>
      </section>

      <div className="detail-grid">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <section className="card panel">
            <h2>Requirement coverage</h2>
            <div className="cov" aria-hidden>
              <span className="cov-direct" style={{ width: pct(cov.direct) }} />
              <span className="cov-inferred" style={{ width: pct(cov.inferred) }} />
              <span className="cov-none" style={{ width: pct(cov.none) }} />
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--green)" }} />{cov.direct} direct</span>
              <span><i style={{ background: "#38bdf8" }} />{cov.inferred} inferred</span>
              <span><i style={{ background: "#f87171" }} />{cov.none} missing</span>
            </div>
            <ul className="rows" style={{ margin: "0 -20px -8px" }}>
              {d.match.map((m) => (
                <li key={m.requirement} className="row" style={{ padding: "12px 20px" }}>
                  <span className="row-main">
                    <strong>{m.requirement}</strong>{m.preferred && <span className="sub" style={{ display: "inline" }}> · preferred</span>}
                    {m.claims[0] && <span className="sub">{m.claims[0].claim}{m.claims[0].kind === "inferred" && ` via ${m.claims[0].path.join(" → ")}`}</span>}
                  </span>
                  <span className={`match-tag match-${m.match}`}>{m.match === "none" ? "NO MATCH" : m.match.toUpperCase()}</span>
                </li>
              ))}
            </ul>
          </section>

          {d.prescreen.reasons && d.prescreen.reasons.length > 0 && (
            <section className="card panel">
              <h2>Prescreen <Verdict verdict={d.prescreen.verdict ?? ""} /></h2>
              <ul className="rows" style={{ margin: "0 -20px -8px" }}>
                {d.prescreen.reasons.map((r, i) => (
                  <li key={i} className="row" style={{ padding: "12px 20px" }}><Verdict verdict={r.level} /><span className="row-main">{r.detail}</span></li>
                ))}
              </ul>
              {j.override_reason && <p className="sub" style={{ marginTop: 12 }}>Override: {j.override_reason}</p>}
            </section>
          )}

          <section className="card panel" id="resumes">
            <h2><Icon name="file" size={20} />Résumés</h2>
            {resumes ? <ResumeManager jobId={j.id} data={resumes} /> : <p className="sub">Résumés couldn't be loaded.</p>}
          </section>

          <section className="card panel">
            <h2><Icon name="history" size={20} />History</h2>
            <ol className="timeline">
              {d.events.map((e, i) => (
                <li key={i}>
                  <span className="when num">{jst(e.at)}</span>
                  <Badge status={e.status} />
                  {e.note && <p>{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="side">
          {j.status === "discovered" && !j.next_action && (
            <section className="card panel">
              <h2><Icon name="target" size={20} />Keep or skip?</h2>
              <p className="sub">Keep schedules "Draft application" in 3 days. Skip closes it as withdrawn with your reason.</p>
              <TriageActions jobId={j.id} company={j.company} />
            </section>
          )}
          {DEBRIEF_STATUSES.has(j.status) && (
            <section className="card panel" id="debrief">
              <h2><Icon name="sparkle" size={20} />Debrief</h2>
              <p className="sub">Right after the interview: what they asked and where you got stuck. Questions go into your drill bank.</p>
              <DebriefForm jobId={j.id} stage={j.stage} claims={d.claims ?? []} />
            </section>
          )}
          {(d.debriefs?.length ?? 0) > 0 && (
            <section className="card panel">
              <h2><Icon name="history" size={20} />Past debriefs</h2>
              <ul className="rows" style={{ margin: "0 -20px -8px" }}>
                {d.debriefs!.map((b, i) => (
                  <li key={i} className="row debrief-row" style={{ padding: "12px 20px" }}>
                    <span className="row-main">
                      <strong>{b.stage || "Interview"}{b.date && <span className="sub" style={{ display: "inline" }}> · {b.date}</span>}</strong>
                      <span className="sub">{b.questions.length} question{b.questions.length === 1 ? "" : "s"}{b.stuck ? ` · ${b.stuck} stuck` : ""}</span>
                      {b.questions.filter((q) => q.stuck).slice(0, 3).map((q, k) => <span key={k} className="sub red clamp-2">⚠ {q.q}</span>)}
                      {b.next_time && <span className="sub">Next time: {b.next_time}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card panel">
            <h2><Icon name="flag" size={20} />Set next step</h2>
            <ScheduleForm jobId={j.id} action={j.next_action} due={j.due_at} kind={j.next_kind} />
          </section>
          <section className="card panel">
            <h2><Icon name="shield" size={20} />Record result</h2>
            <RecordForm jobId={j.id} allowed={d.allowed_next} />
          </section>
        </div>
      </div>
    </>
  );
}
