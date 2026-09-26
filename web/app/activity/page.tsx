import { CronRunList } from "@/components/cron-activity";
import { Icon } from "@/components/icons";
import { Empty, PageHeader, SectionHead } from "@/components/ui";
import { listJobOsCronActivity } from "@/lib/cron-activity";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

function nextRun(iso: string): string {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const MODE = { agent: "Hermes agent", script: "Script only", monitor: "Change monitor" } as const;

export default async function ActivityPage() {
  try {
    const activity = await listJobOsCronActivity(config.cronDir);
    return (
      <>
        <PageHeader title="Automation" />
        <section aria-labelledby="schedules">
          <SectionHead id="schedules" title="Job OS schedules" />
          {activity.jobs.length ? (
            <div className="schedule-grid">
              {activity.jobs.map((job) => (
                <article className="card schedule-card" key={job.id}>
                  <span className={`schedule-state${job.enabled ? " on" : ""}`}><Icon name={job.enabled ? "check" : "stop"} size={17} /></span>
                  <div>
                    <strong>{job.name}</strong>
                    <p>{MODE[job.mode]} · <code>{job.schedule}</code></p>
                    <span>Next: {nextRun(job.nextRunAt)} JST</span>
                  </div>
                </article>
              ))}
            </div>
          ) : <Empty icon="clock">No Job OS cron jobs found.</Empty>}
        </section>

        <section aria-labelledby="history">
          <SectionHead id="history" title="Run history" />
          {activity.runs.length ? <CronRunList runs={activity.runs} /> : <Empty icon="history">No Job OS cron run has produced output yet.</Empty>}
        </section>
      </>
    );
  } catch {
    const message = "Hermes cron activity is temporarily unavailable.";
    return (
      <>
        <PageHeader title="Automation" />
        <div className="card error-card" role="alert">
          <span className="stat-icon tone-red"><Icon name="alert" size={24} /></span>
          <div><strong>Cron activity unavailable</strong><p>{message}</p><p className="sub">Check HERMES_HOME or HERMES_CRON_DIR on the dashboard server.</p></div>
        </div>
      </>
    );
  }
}
