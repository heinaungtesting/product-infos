import { ErrorPanel, JobRow } from "@/components/ui";
import { runJobOS } from "@/lib/jobos";
import type { Pipeline } from "@/lib/types";

export const dynamic = "force-dynamic";

const COLORS: Record<string, string> = {
  discovered: "var(--discovered)", drafted: "var(--drafted)", reviewed: "var(--drafted)",
  applied: "var(--applied)", interview: "var(--interview)", offer: "var(--offer)",
};
const ENDED = new Set(["rejected", "withdrawn", "closed"]);

export default async function PipelinePage() {
  let data: Pipeline;
  try {
    data = await runJobOS<Pipeline>(["api", "pipeline"]);
  } catch (e) {
    return (<><h1>Pipeline</h1><ErrorPanel error={e} /></>);
  }
  const ended = data.order.filter((s) => ENDED.has(s)).flatMap((s) => data.groups[s]);
  return (
    <>
      <h1>Pipeline</h1>
      <ol className="line">
        {data.order.filter((s) => !ENDED.has(s)).map((s) => (
          <li key={s} className="station" style={{ ["--c" as string]: COLORS[s] }}>
            <strong>{s}</strong> <span className="muted num">{data.groups[s].length}</span>
            {data.groups[s].length > 0 && (
              <ul className="rows" style={{ marginTop: 8 }}>
                {data.groups[s].map((j) => <JobRow key={j.id} job={j} showDue={s !== "discovered"} />)}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <details>
        <summary className="row">Ended ({ended.length})</summary>
        <ul className="rows">{ended.map((j) => <JobRow key={j.id} job={j} showDue={false} />)}</ul>
      </details>
    </>
  );
}
