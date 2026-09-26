import Link from "next/link";
import type { JobSummary } from "@/lib/types";
import { jst } from "@/lib/format";
import { JobOSError } from "@/lib/jobos";

export function Badge({ status, stage }: { status: string; stage?: string }) {
  return (
    <span className="badge" data-status={status}>
      {status}
      {stage ? ` ${stage}` : ""}
    </span>
  );
}

export function Verdict({ verdict }: { verdict: string }) {
  if (!verdict) return null;
  return <span className={`verdict verdict-${verdict}`}>{verdict}</span>;
}

export function JobRow({ job, showDue = true }: { job: JobSummary; showDue?: boolean }) {
  return (
    <li>
      <Link href={`/jobs/${job.id}`} className={`row${job.overdue ? " overdue" : ""}`}>
        <Badge status={job.status} />
        <span className="row-main">
          <span className="row-title">{job.company}</span>
          <span className="sub" style={{ display: "block" }}>
            {job.next_action || job.title}
          </span>
        </span>
        {showDue && job.due_at ? (
          <span className="row-time">{job.overdue ? "OVERDUE " : ""}{jst(job.due_at)}</span>
        ) : (
          <Verdict verdict={job.status === "discovered" ? job.verdict : ""} />
        )}
      </Link>
    </li>
  );
}

export function ErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const system = error instanceof JobOSError ? error.kind === "system" : true;
  return (
    <div className="panel error" role="alert">
      <strong>{system ? "Job OS failed" : "Refused"}</strong>
      <p>{message}</p>
      {system && <p className="sub">Check JOB_OS_DIR on the server, then run <code>python3 job_os.py due</code>.</p>}
      <a className="btn secondary" href="">Try again</a>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="sub row">{children}</p>;
}
