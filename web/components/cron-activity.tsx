import type { JobOsCronRun } from "@/lib/cron-activity";
import { Icon } from "./icons";

function when(iso: string): string {
  if (!iso) return "Unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-JP", {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function summary(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[#>*•\-\s]+/, "").replace(/\*\*/g, ""))
    .find(Boolean) ?? "No output";
}

export function CronRunList({ runs, limit }: { runs: JobOsCronRun[]; limit?: number }) {
  const shown = typeof limit === "number" ? runs.slice(0, limit) : runs;
  return (
    <div className="cron-runs">
      {shown.map((run) => (
        <details className={`card cron-run status-${run.status}`} key={run.id}>
          <summary>
            <span className="cron-icon" aria-hidden="true"><Icon name={run.status === "failed" ? "alert" : run.status === "silent" ? "clock" : "refresh"} size={20} /></span>
            <span className="sr-only">Status: {run.status}. </span>
            <span className="cron-title">
              <strong>{run.jobName}</strong>
              <span>{summary(run.output)}</span>
            </span>
            <span className="cron-time num">{when(run.runAt)}</span>
            <Icon name="arrow" size={16} className="cron-open" />
          </summary>
          <pre>{run.output}</pre>
        </details>
      ))}
    </div>
  );
}
