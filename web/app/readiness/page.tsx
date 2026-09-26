import Link from "next/link";
import { EvidenceForm } from "@/components/feature-forms";
import { Icon } from "@/components/icons";
import { Empty, ErrorPanel, PageHeader } from "@/components/ui";
import { humanize } from "@/lib/format";
import { runJobOS } from "@/lib/jobos";
import type { Readiness } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  let r: Readiness;
  try {
    r = await runJobOS<Readiness>(["api", "readiness"]);
  } catch (e) {
    return (<><PageHeader title="Evidence" /><ErrorPanel error={e} /></>);
  }
  const pct = r.evidence.reviewed ? Math.round((r.evidence.linked / r.evidence.reviewed) * 100) : 0;
  const missing = r.evidence.reviewed - r.evidence.linked;
  const verified = r.evidence.verified ?? r.evidence.linked;
  const pending = r.evidence.linked - verified;
  const maxGap = Math.max(1, ...r.gaps.map((g) => g.jobs));
  const stateOf = (c: Readiness["claims"][number]) =>
    !c.reviewed ? "unreviewed" : !c.has_evidence ? "missing" : c.verified === false ? "pending" : "linked";
  const order = (c: Readiness["claims"][number]) => ({ missing: 0, pending: 1, unreviewed: 2, linked: 3 })[stateOf(c)];
  const claims = [...r.claims].sort((a, b) => order(a) - order(b));
  return (
    <>
      <PageHeader title="Evidence" />
      <div className="readiness-grid">
        <div style={{ display: "grid", gap: 14 }}>
          <section className="card score">
            <div className="ring" style={{ ["--p" as string]: pct }} role="img" aria-label={`${pct}% of reviewed claims link to code`}>
              <span className="num">{pct}%</span>
            </div>
            <div>
              <h2>Code evidence</h2>
              <p className="sub num">{r.evidence.linked} of {r.evidence.reviewed} reviewed claims link to code.</p>
              {missing > 0 ? <p className="red" style={{ fontWeight: 700 }}>{missing} gap{missing > 1 ? "s" : ""} to close before interviews.</p>
                : pending > 0 ? <p style={{ color: "var(--amber-ink)", fontWeight: 700 }}>{pending} link{pending > 1 ? "s" : ""} waiting for review on the PC.</p>
                : <p style={{ color: "var(--green)", fontWeight: 700 }}>Every claim is backed by verified code.</p>}
              {missing > 0 && pending > 0 && <p className="sub">{pending} more link{pending > 1 ? "s" : ""} added, waiting for review.</p>}
            </div>
          </section>

          <div className="section-head"><h2>Claims</h2></div>
          <div className="card-list">
            {claims.map((c) => {
              const state = stateOf(c);
              return (
                <section key={c.id} className={`card claim-card${state === "missing" ? " probe missing" : ""}`} style={{ padding: "16px 18px" }}>
                  <div className="claim-top">
                    <strong>{humanize(c.id)}</strong>
                    <span className={`match-tag ${state === "linked" ? "match-direct" : state === "missing" ? "match-none" : state === "pending" ? "match-inferred" : ""}`} style={state === "unreviewed" ? { background: "#eef1f6", color: "#5f6b80" } : undefined}>
                      {state === "linked" ? "VERIFIED" : state === "missing" ? "NO CODE" : state === "pending" ? "NEEDS REVIEW" : "UNREVIEWED"}
                    </span>
                  </div>
                  <p>{c.text}</p>
                  <div className="tags">{c.skills.map((s) => <span key={s} className="tag">{s}</span>)}</div>
                  {state === "missing" && (
                    <div className="claim-actions">
                      <EvidenceForm claimId={c.id} />
                      <Link className="btn secondary" href={`/hermes?prompt=${encodeURIComponent(`Find code evidence for claim ${c.id}.`)}`}>
                        <Icon name="sparkle" size={18} />Find with Hermes
                      </Link>
                    </div>
                  )}
                  {c.evidence.length > 0 && (
                    <div className="evidence-links">
                      {c.evidence.map((e) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer noopener"><Icon name="code" size={16} />{e.note || "Code"}</a>)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>

        <aside>
          <div className="section-head"><h2>Skill gaps</h2></div>
          {r.gaps.length ? (
            <section className="card" style={{ padding: "6px 0" }}>
              <p className="sub" style={{ padding: "10px 18px 0" }}>Requirements in active jobs with no matching claim.</p>
              {r.gaps.map((g) => (
                <div key={g.requirement} className="bar-row">
                  <strong>{g.requirement}</strong>
                  <span className="sub num">{g.jobs} job{g.jobs > 1 ? "s" : ""}</span>
                  <div className="bar"><span style={{ width: `${(g.jobs / maxGap) * 100}%` }} /></div>
                </div>
              ))}
            </section>
          ) : (
            <Empty>No unmatched requirements.</Empty>
          )}
        </aside>
      </div>
    </>
  );
}
