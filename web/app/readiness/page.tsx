import Link from "next/link";
import { ErrorPanel } from "@/components/ui";
import { runJobOS } from "@/lib/jobos";
import type { Readiness } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  let r: Readiness;
  try {
    r = await runJobOS<Readiness>(["api", "readiness"]);
  } catch (e) {
    return (<><h1>Readiness</h1><ErrorPanel error={e} /></>);
  }
  const pct = r.evidence.reviewed ? Math.round((r.evidence.linked / r.evidence.reviewed) * 100) : 0;
  return (
    <>
      <h1>Readiness</h1>
      <section className="panel">
        <div className="board-label">Code evidence</div>
        <div className="board-company num">{r.evidence.linked} / {r.evidence.reviewed}</div>
        <div className="cov" role="img" aria-label={`${pct}% of reviewed claims link to code`}>
          <span className="cov-direct" style={{ width: `${pct}%` }} />
          <span className="cov-none" style={{ width: `${100 - pct}%` }} />
        </div>
      </section>
      <h2>Claims</h2>
      <ul className="rows">
        {r.claims.map((c) => (
          <li key={c.id} className="row">
            <span className="row-main">
              <span className="row-title">{c.id}</span>
              <span className="sub" style={{ display: "block" }}>{c.text}</span>
            </span>
            {!c.reviewed ? (
              <span className="tag muted">UNREVIEWED</span>
            ) : c.has_evidence ? (
              <span className="tag tag-direct">LINKED</span>
            ) : (
              <Link className="tag tag-none" href={`/hermes?prompt=${encodeURIComponent(`Find code evidence for claim ${c.id}.`)}`}>NO CODE</Link>
            )}
          </li>
        ))}
      </ul>
      <h2>Skill gaps in active jobs</h2>
      {r.gaps.length ? (
        <ul className="rows">
          {r.gaps.map((g) => <li key={g.requirement} className="row"><span className="row-main">{g.requirement}</span><span className="num muted">{g.jobs} job{g.jobs > 1 ? "s" : ""}</span></li>)}
        </ul>
      ) : (
        <p className="sub">No unmatched requirements.</p>
      )}
    </>
  );
}
