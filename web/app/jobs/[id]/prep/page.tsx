import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/ui";
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
    return (<><h1>Prep</h1><ErrorPanel error={e} /></>);
  }
  const drill = `/hermes?job=${id}&prompt=${encodeURIComponent(`Drill me on the probe questions for ${id}, one at a time. Score each answer.`)}`;
  return (
    <>
      <p className="sub"><Link href={`/jobs/${id}`}>← {p.job.company}</Link></p>
      <h1>Prep: {p.job.company}</h1>
      <h2>What they received</h2>
      {p.sent ? (
        <ul className="rows">{p.sent.claims.map((c) => <li key={c.claim} className="row">{c.text}</li>)}</ul>
      ) : (
        <p className="sub">No sent version recorded. Mark the job applied to pin one.</p>
      )}
      <p><Link className="btn" href={drill}>Drill these questions</Link></p>
      <h2>Claims they may probe</h2>
      {p.probe.map((c) => (
        <section key={c.claim} className="panel" style={{ marginBottom: 12, borderColor: c.missing_evidence ? "var(--alert)" : undefined }}>
          <strong>{c.claim}</strong>
          {c.missing_evidence && <p className="red"><strong>No code evidence — fix before the interview.</strong></p>}
          <p>{c.text}</p>
          {c.evidence.map((e) => <p key={e.url} className="sub"><a href={e.url} target="_blank" rel="noreferrer noopener">{e.note || "Code"}</a></p>)}
          <ul>{c.questions.map((q) => <li key={q}>{q}</li>)}</ul>
        </section>
      ))}
      {(p.history.length > 0 || p.lessons.length > 0) && (
        <>
          <h2>History and lessons</h2>
          <ul className="rows">
            {p.history.map((h, i) => <li key={i} className="row">{h.year} {h.stage} {h.result}: {h.note}</li>)}
            {p.lessons.map((l) => <li key={l} className="row">{l}</li>)}
          </ul>
        </>
      )}
    </>
  );
}
