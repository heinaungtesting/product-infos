import Link from "next/link";
import { notFound } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { Icon } from "@/components/icons";
import { ErrorPanel, Logo, PageHeader } from "@/components/ui";
import { humanize, slot } from "@/lib/format";
import { JOB_ID_RE, runJobOS } from "@/lib/jobos";
import type { Prep } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PrepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!JOB_ID_RE.test(id)) notFound();
  let p: Prep;
  try {
    p = await runJobOS<Prep>(["api", "prep", id]);
  } catch (e) {
    return (<><PageHeader title="Prep" date={false} back={{ href: `/jobs/${id}`, label: "Job" }} /><ErrorPanel error={e} /></>);
  }
  const drill = `/hermes?job=${id}&prompt=${encodeURIComponent(`Drill me on the probe questions for ${id}, one at a time. Score each answer.`)}`;
  const missing = p.probe.filter((c) => c.missing_evidence).length;
  const qCount = p.probe.reduce((n, c) => n + c.questions.length, 0);
  return (
    <>
      <PageHeader title="Interview prep" date={false} back={{ href: `/jobs/${id}`, label: p.job.company }} />

      <section className="card hero">
        <span className="hero-icon" style={{ background: "transparent" }}><Logo name={p.job.company} size={64} /></span>
        <div className="hero-body">
          <h3>{p.job.company}{p.job.stage && <span className="muted"> · {p.job.stage}</span>}</h3>
          <p className="hero-when num">{p.job.due_at ? slot(p.job.due_at) : "No time set"}</p>
          <span className="chip-soft"><Icon name="target" size={18} />{qCount} questions · {missing ? `${missing} claim${missing > 1 ? "s" : ""} need code` : "all claims linked"}</span>
        </div>
        <div className="hero-side">
          {p.job.due_at && <Countdown at={p.job.due_at} />}
          <Link className="btn primary" href={drill}><Icon name="play" size={18} />Start drill</Link>
        </div>
      </section>

      <div className="section-head"><h2>Claims they may probe</h2></div>
      <div className="probe-grid card-list" style={{ gridTemplateColumns: undefined }}>
        {p.probe.map((c) => (
          <section key={c.claim} className={`card probe${c.missing_evidence ? " missing" : ""}`}>
            <div className="probe-head">
              <strong>{humanize(c.claim)}</strong>
              <span className={`match-tag ${c.missing_evidence ? "match-none" : "match-direct"}`}>{c.missing_evidence ? "NO CODE" : "LINKED"}</span>
            </div>
            <p className="sub" style={{ color: "#3d4a60" }}>{c.text}</p>
            {c.missing_evidence && <div className="warn-box"><Icon name="alert" size={18} />No code evidence — fix before the interview.</div>}
            {c.evidence.length > 0 && (
              <div className="evidence-links">
                {c.evidence.map((e) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer noopener"><Icon name="code" size={16} />{e.note || "Code"}</a>)}
              </div>
            )}
            <ol className="questions">
              {c.questions.map((q, i) => <li key={q}><span className="qnum num" style={{ width: 32, height: 32, fontSize: 15 }}>{i + 1}</span><span>{q}</span></li>)}
            </ol>
          </section>
        ))}
      </div>

      <div className="detail-grid">
        <section className="card panel">
          <h2><Icon name="file" size={20} />What they received</h2>
          {p.sent ? (
            <ul className="rows" style={{ margin: "0 -20px -8px" }}>
              {p.sent.claims.map((c) => <li key={c.claim} className="row" style={{ padding: "12px 20px" }}><Icon name="check" size={18} className="muted" /><span className="row-main">{c.text}</span></li>)}
            </ul>
          ) : (
            <p className="sub">No sent version recorded. Mark the job applied to pin one.</p>
          )}
        </section>
        {(p.history.length > 0 || p.lessons.length > 0) && (
          <section className="card panel">
            <h2><Icon name="history" size={20} />History and lessons</h2>
            <ul className="rows" style={{ margin: "0 -20px -8px" }}>
              {p.history.map((h, i) => <li key={i} className="row" style={{ padding: "12px 20px" }}><span className="row-main"><strong>{h.year} {h.stage} · {h.result}</strong><span className="sub">{h.note}</span></span></li>)}
              {p.lessons.map((l) => <li key={l} className="row" style={{ padding: "12px 20px" }}><Icon name="sparkle" size={18} className="muted" /><span className="row-main">{l}</span></li>)}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
