import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { Empty, ErrorPanel, JobRow } from "@/components/ui";
import { jst } from "@/lib/format";
import { runJobOS } from "@/lib/jobos";
import type { Today } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  let data: Today;
  try {
    data = await runJobOS<Today>(["api", "today"]);
  } catch (e) {
    return (<><h1>Today</h1><ErrorPanel error={e} /></>);
  }
  const next = data.next_interview;
  return (
    <>
      <h1>Today</h1>
      {next ? (
        <section className="board" aria-label="Next interview">
          <div className="board-label">Next interview {next.stage && `· ${next.stage}`}</div>
          <div className="board-company">{next.company}</div>
          <div className="board-meta">
            <div>
              <div className="num">{jst(next.due_at)}</div>
              <div style={{ opacity: 0.8 }}>{next.next_action}</div>
            </div>
            <Countdown at={next.due_at} />
          </div>
          <p style={{ marginBottom: 0 }}>
            <Link className="btn" style={{ background: "var(--interview)", color: "#fff" }} href={`/jobs/${next.id}/prep`}>
              Open prep
            </Link>
          </p>
        </section>
      ) : (
        <section className="panel">
          <strong>No interview scheduled</strong>
          <p className="sub">Set one from a job: Pipeline → job → Set next step, kind “Interview”.</p>
        </section>
      )}

      <h2>Next 14 days</h2>
      {data.upcoming.length ? (
        <ul className="rows">{data.upcoming.map((j) => <JobRow key={j.id} job={j} />)}</ul>
      ) : (
        <Empty>Nothing scheduled.</Empty>
      )}

      <h2>Waiting on you</h2>
      {data.waiting.length ? (
        <ul className="rows">
          {data.waiting.map((w, i) => (
            <li key={i}>
              {w.job ? (
                <Link className="row" href={`/jobs/${w.job}`}>{w.text}</Link>
              ) : (
                <Link className={`row${w.kind === "evidence" ? " red" : ""}`} href="/readiness">{w.text}</Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>All clear.</Empty>
      )}

      <h2>Code evidence</h2>
      <p className={data.evidence.linked < data.evidence.reviewed ? "red" : "muted"}>
        {data.evidence.linked} of {data.evidence.reviewed} reviewed claims link to code.
      </p>
      {!data.profile_loaded && <p className="red">profile.json not found in JOB_OS_DIR. Run <code>job_os.py init</code>.</p>}
    </>
  );
}
