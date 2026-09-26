import Link from "next/link";
import { Empty, ErrorPanel, JobCard, JobRow, PageHeader } from "@/components/ui";
import { runJobOS } from "@/lib/jobos";
import type { JobSummary, Pipeline } from "@/lib/types";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string; hint: string; statuses: string[] }[] = [
  { key: "discovered", label: "Discover", hint: "Found & evaluating", statuses: ["discovered"] },
  { key: "drafted", label: "Draft", hint: "Writing the résumé", statuses: ["drafted"] },
  { key: "reviewed", label: "Reviewed", hint: "Ready to submit", statuses: ["reviewed"] },
  { key: "applied", label: "Applied", hint: "Application submitted", statuses: ["applied"] },
  { key: "interview", label: "Interview", hint: "Interviews & next steps", statuses: ["interview"] },
  { key: "offer", label: "Offer", hint: "Decide", statuses: ["offer"] },
];
const ENDED = ["rejected", "withdrawn", "closed"];

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const stage = typeof sp.stage === "string" && COLUMNS.some((c) => c.key === sp.stage) ? sp.stage : "";
  let data: Pipeline;
  try {
    data = await runJobOS<Pipeline>(["api", "pipeline"]);
  } catch (e) {
    return (<><PageHeader title="Pipeline" /><ErrorPanel error={e} /></>);
  }
  const needle = q.toLowerCase();
  const matches = (j: JobSummary) => !needle || `${j.company} ${j.title} ${j.next_action}`.toLowerCase().includes(needle);
  const col = (c: (typeof COLUMNS)[number]) => c.statuses.flatMap((s) => data.groups[s as keyof Pipeline["groups"]] ?? []).filter(matches);
  const ended = ENDED.flatMap((s) => data.groups[s as keyof Pipeline["groups"]] ?? []).filter(matches);
  const all = COLUMNS.flatMap(col);
  const visible = stage ? col(COLUMNS.find((c) => c.key === stage)!) : all;
  const href = (s: string) => `/pipeline?${new URLSearchParams({ ...(q && { q }), ...(s && { stage: s }) })}`;

  return (
    <>
      <PageHeader title="Pipeline" date={false} />
      {q && (
        <p className="chat-status">
          Showing matches for “{q}” · <Link href={stage ? `/pipeline?stage=${stage}` : "/pipeline"} className="link-more">Clear</Link>
        </p>
      )}

      {/* Phone: status filter + card list. */}
      <div className="only-mobile">
        <nav className="filters" aria-label="Filter by stage">
          <Link className="filter" href={href("")} aria-current={!stage ? "true" : undefined}>All <span className="count num">{all.length}</span></Link>
          {COLUMNS.map((c) => (
            <Link key={c.key} className="filter" href={href(c.key)} aria-current={stage === c.key ? "true" : undefined}>
              {c.label} <span className="count num">{col(c).length}</span>
            </Link>
          ))}
        </nav>
        {visible.length ? (
          <div className="card-list">{visible.map((j) => <JobCard key={j.id} job={j} />)}</div>
        ) : (
          <Empty icon="search">{q ? "No jobs match that search." : "No jobs at this stage."}</Empty>
        )}
      </div>

      {/* Desktop: full kanban. */}
      <section className="card pipeline-board only-desktop" aria-label="Application pipeline">
        <div className="board">
          {COLUMNS.map((c) => {
            const jobs = col(c);
            return (
              <div key={c.key} className="column" data-col={c.key}>
                <div className="column-head">
                  <div><strong>{c.label}</strong><span>{c.hint}</span></div>
                  <span className="count num">{jobs.length}</span>
                </div>
                {jobs.map((j) => <JobCard key={j.id} job={j} compact />)}
                {!jobs.length && <p className="column-empty">Nothing here</p>}
              </div>
            );
          })}
        </div>
      </section>

      {ended.length > 0 && (
        <details className="card ended">
          <summary>Ended ({ended.length})</summary>
          <ul className="rows">{ended.map((j) => <JobRow key={j.id} job={j} />)}</ul>
        </details>
      )}
    </>
  );
}
