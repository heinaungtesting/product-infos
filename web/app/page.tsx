import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { CronRunList } from "@/components/cron-activity";
import { TriageActions } from "@/components/feature-forms";
import { Icon, type IconName } from "@/components/icons";
import { Empty, ErrorPanel, JobCard, Logo, PageHeader, SectionHead, StatTile, statusLabel } from "@/components/ui";
import { listJobOsCronActivity } from "@/lib/cron-activity";
import { config } from "@/lib/config";
import { dueLabel, humanize, slot } from "@/lib/format";
import { runJobOS } from "@/lib/jobos";
import type { DeadlineAlert, JobSummary, Pipeline, Prep, Readiness, Today } from "@/lib/types";

export const dynamic = "force-dynamic";

const IN_PROCESS = ["drafted", "reviewed", "applied", "interview", "offer"] as const;

const BOARD: { key: string; label: string; hint: string; statuses: string[] }[] = [
  { key: "discovered", label: "Discover", hint: "Found & evaluating", statuses: ["discovered"] },
  { key: "drafted", label: "Draft", hint: "Preparing application", statuses: ["drafted", "reviewed"] },
  { key: "applied", label: "Applied", hint: "Application submitted", statuses: ["applied"] },
  { key: "interview", label: "Interview", hint: "Interviews & next steps", statuses: ["interview", "offer"] },
];

const WAIT_ICON: Record<string, IconName> = { review: "file", triage: "target", evidence: "link" };

export default async function TodayPage() {
  let data: Today;
  try {
    data = await runJobOS<Today>(["api", "today"]);
  } catch (e) {
    return (<><PageHeader title="Today" /><ErrorPanel error={e} /></>);
  }
  const next = data.next_interview;
  // Secondary views never take the page down: they just hide their section.
  const [pipeline, readiness, prep, cronActivity] = await Promise.all([
    runJobOS<Pipeline>(["api", "pipeline"]).catch(() => null),
    runJobOS<Readiness>(["api", "readiness"]).catch(() => null),
    next ? runJobOS<Prep>(["api", "prep", next.id]).catch(() => null) : Promise.resolve(null),
    listJobOsCronActivity(config.cronDir, { limit: 3 }).catch(() => null),
  ]);

  const now = data.now;
  // An interview whose time has passed but whose status hasn't moved: the real next step is the debrief.
  const pastInterview = next ? null : data.upcoming.find((j) => j.next_kind === "interview" && j.overdue) ?? null;
  const heroId = next?.id ?? pastInterview?.id;
  const tasks = data.upcoming.filter((j) => j.id !== heroId && (j.next_kind !== "interview" || j.overdue));
  const alert = tasks[0] ?? null;
  const active = IN_PROCESS.reduce((n, s) => n + (data.counts[s] ?? 0), 0);
  const gaps = data.evidence.reviewed - data.evidence.linked;
  const questions = prep?.probe.flatMap((p) => p.questions.map((q) => ({ q, claim: p.claim, missing: p.missing_evidence }))) ?? [];
  const drill = next ? `/hermes?job=${next.id}&prompt=${encodeURIComponent(`Drill me on the probe questions for ${next.id}, one at a time. Score each answer.`)}` : "/hermes";
  const nextUp = uniqueJobs([...data.upcoming, ...(pipeline ? IN_PROCESS.flatMap((s) => pipeline.groups[s]) : [])]).filter((j) => j.id !== heroId).slice(0, 4);
  const missingClaims = readiness?.claims.filter((c) => c.reviewed && !c.has_evidence) ?? [];
  const triage = data.waiting.filter((w) => w.kind === "triage" && w.job);
  const otherWaiting = data.waiting.filter((w) => w.kind !== "triage");
  // The hero already covers its interview; the banner is for everything else that's urgent.
  const bannerAlerts = (data.alerts ?? []).filter((a) => a.job !== heroId);
  const bannerGroups = groupAlerts(bannerAlerts);
  const overdueCount = bannerAlerts.filter((a) => a.overdue).length;
  const soonCount = bannerAlerts.length - overdueCount;
  // With the banner up, the single "most urgent task" card would just repeat its first line.
  const showAlertCard = bannerAlerts.length === 0;

  return (
    <div className="today">
      <PageHeader title="Today" />

      <div className="today-main">
        {bannerGroups.length > 0 && (
          <section className={`card deadline-banner${overdueCount ? "" : " soon"}`} role="alert" aria-labelledby="alerts-title">
            <span className="alert-icon"><Icon name="alert" size={24} /></span>
            <div className="deadline-body">
              <strong id="alerts-title">
                {[overdueCount && `${overdueCount} overdue`, soonCount && `${soonCount} due within 72h`].filter(Boolean).join(" · ")}
              </strong>
              <ul>
                {bannerGroups.slice(0, 4).map((g) => (
                  <li key={g.key}>
                    <Link href={g.items.length === 1 ? `/jobs/${g.items[0].job}` : "/pipeline"}>
                      <span className={`deadline-when${g.overdue ? " red" : ""}`}>
                        {cap(dueLabel(g.at, now, g.overdue))}{!g.overdue && ` ${slotTime(g.at)}`}{g.unconfirmed ? " (time unconfirmed)" : ""}
                      </span>
                      <span className="deadline-what">
                        <span>{g.action}{g.items.length > 1 && <b className="deadline-n"> ×{g.items.length}</b>}</span>
                        <span className="deadline-co">{g.items.map((a) => a.company.replace(/^株式会社|株式会社$/g, "")).join("・")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="stats" aria-label="Summary">
          <StatTile icon="today" value={data.upcoming.length} label="upcoming" sub="Interviews & deadlines" href="#next-up" />
          <StatTile icon="refresh" value={active} label="in process" sub="Applications moving forward" href="/pipeline" />
          <StatTile icon="alert" tone="amber" value={gaps} label="gaps" sub="Claims without code" href="/readiness" />
        </section>

        <div className={`hero-row${showAlertCard ? "" : " solo"}`}>
          {next ? (
            <section className="card hero" aria-label="Next interview">
              <span className="hero-icon"><Icon name="today" size={30} /></span>
              <div className="hero-body">
                <h3>{next.company}{next.stage && <span className="muted"> · {next.stage}</span>}</h3>
                <p className="hero-when num">{slot(next.due_at)}</p>
                <span className="chip-soft"><Icon name="video" size={18} />{next.next_action && next.next_action !== next.stage ? next.next_action : "Interview"}</span>
              </div>
              <div className="hero-side">
                <Countdown at={next.due_at} />
                <Link className="btn primary" href={`/jobs/${next.id}/prep`}>Prepare<Icon name="arrow" size={18} /></Link>
              </div>
            </section>
          ) : pastInterview ? (
            <section className="card hero debrief-hero" aria-label="Interview to debrief">
              <span className="hero-icon"><Icon name="sparkle" size={30} /></span>
              <div className="hero-body">
                <h3>How did {pastInterview.company} go?{pastInterview.stage && <span className="muted"> · {pastInterview.stage}</span>}</h3>
                <p className="hero-when num">Interview was {slot(pastInterview.due_at)}</p>
                <span className="chip-soft">Log the questions while they're fresh — they feed your drills.</span>
              </div>
              <div className="hero-side">
                <Link className="btn primary" href={`/jobs/${pastInterview.id}#debrief`}>Debrief<Icon name="arrow" size={18} /></Link>
              </div>
            </section>
          ) : (
            <section className="card hero">
              <span className="hero-icon"><Icon name="today" size={30} /></span>
              <div className="hero-body">
                <h3>No interview scheduled</h3>
                <p className="sub">When you get one, open the job and set its next step to “Interview”.</p>
              </div>
              <div className="hero-side"><Link className="btn primary" href="/pipeline">Pipeline<Icon name="arrow" size={18} /></Link></div>
            </section>
          )}

          {!showAlertCard ? null : alert ? (
            <section className={`card alert-card${alert.overdue ? " overdue" : ""}`} aria-label="Most urgent task">
              <span className="alert-icon"><Icon name="file" size={26} /></span>
              <div className="alert-body">
                <strong>{alert.next_action} <span className="alert-due">· {dueLabel(alert.due_at, now, alert.overdue)}</span></strong>
                <span>{statusLabel(alert.status)} · {alert.company} — {alert.title}</span>
              </div>
              <Link className="btn outline-amber" href={`/jobs/${alert.id}`}>View</Link>
            </section>
          ) : (
            <section className="card alert-card calm">
              <span className="alert-icon"><Icon name="check" size={26} /></span>
              <div className="alert-body"><strong>No deadlines in the next 14 days</strong><span>Use the time to close evidence gaps.</span></div>
            </section>
          )}
        </div>

        {/* Phone: a short list of what's next. */}
        <section className="only-mobile" aria-labelledby="next-up">
          <SectionHead id="next-up" title="Next up" href="/pipeline" />
          {nextUp.length ? (
            <div className="card-list">{nextUp.map((j) => <JobCard key={j.id} job={j} now={now} />)}</div>
          ) : (
            <Empty>Nothing in progress. Add a job with Hermes.</Empty>
          )}
        </section>

        {/* Desktop: the whole pipeline at a glance. */}
        {pipeline && (
          <section className="card board-card only-desktop" aria-labelledby="board-title">
            <SectionHead id="board-title" title="Application pipeline" href="/pipeline" />
            <div className="board">
              {BOARD.map((col) => {
                const jobs = col.statuses.flatMap((s) => pipeline.groups[s as keyof Pipeline["groups"]] ?? []);
                return (
                  <div key={col.key} className="column" data-col={col.key}>
                    <div className="column-head">
                      <div><strong>{col.label}</strong><span>{col.hint}</span></div>
                      <span className="count num">{jobs.length}</span>
                    </div>
                    {jobs.slice(0, 3).map((j) => <JobCard key={j.id} job={j} now={now} compact />)}
                    {jobs.length > 3 && <Link className="column-more" href="/pipeline">+{jobs.length - 3} more</Link>}
                    {!jobs.length && <p className="column-empty">Nothing here</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {triage.length > 0 && (
          <section aria-labelledby="triage">
            <SectionHead id="triage" title={`Undecided · ${triage.length}`} href="/pipeline" />
            <ul className="card list-card triage-list">
              {triage.slice(0, 5).map((w) => (
                <li key={w.job} className="triage-row">
                  <Link className="triage-main" href={`/jobs/${w.job}`}>
                    <Logo name={w.company ?? ""} size={36} />
                    <span className="row-main">
                      <strong className="clamp-1">{w.company}</strong>
                      <span className="sub clamp-1">{w.title}</span>
                    </span>
                    {w.verdict === "WARN" && <span className="pill verdict-WARN">Check fit</span>}
                  </Link>
                  <TriageActions jobId={w.job!} company={w.company ?? ""} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {otherWaiting.length > 0 && (
          <section aria-labelledby="waiting">
            <SectionHead id="waiting" title="Waiting on you" />
            <ul className="card list-card">
              {otherWaiting.slice(0, 6).map((w, i) => (
                <li key={i}>
                  <Link className="list-row" href={w.job ? `/jobs/${w.job}` : "/readiness"}>
                    <span className={`mini-icon kind-${w.kind}`}><Icon name={WAIT_ICON[w.kind] ?? "flag"} size={18} /></span>
                    <span className="row-main clamp-2">{w.kind === "evidence" && w.claim ? `Add a code link for ${humanize(w.claim)}` : w.text}</span>
                    <Icon name="arrow" size={18} className="muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!data.profile_loaded && <p className="red">profile.json not found in JOB_OS_DIR. Run <code>job_os.py init</code>.</p>}
      </div>

      <aside className="today-rail">
        {next && (
          <section className="card focus" aria-labelledby="focus-title">
            <h2 id="focus-title">Interview focus</h2>
            <p className="sub">{next.company} · {slot(next.due_at)}</p>
            {questions.length ? (
              <ol className="questions">
                {questions.slice(0, 3).map((q, i) => (
                  <li key={i} className={i > 0 ? "rest" : undefined}>
                    <span className="qnum num">{i + 1}</span>
                    <span>{q.q}{q.missing && <span className="red sub"> · no code yet</span>}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sub">No probe questions yet. Add them to your claims in profile.json.</p>
            )}
            <Link className="btn primary block" href={drill}><Icon name="play" size={18} />Start 10-min drill</Link>
          </section>
        )}

        {readiness && (
          <section className="card evidence-path" aria-labelledby="ev-title">
            <SectionHead id="ev-title" title="Evidence path" href="/readiness" />
            <ol className="path">
              {[...missingClaims, ...readiness.claims.filter((c) => c.reviewed && c.has_evidence)].slice(0, 4).map((c) => {
                const ok = c.has_evidence && c.verified !== false;
                return (
                <li key={c.id} className={ok ? "ok" : "pending"}>
                  <span className="path-icon"><Icon name={c.has_evidence ? "code" : "link"} size={20} /></span>
                  <div>
                    <span className="path-kind">{c.skills.slice(0, 2).join(" · ") || "Claim"}</span>
                    <strong>{humanize(c.id)}</strong>
                    <p>{ok ? c.text : c.has_evidence ? "Link added — review it on the PC to mark verified." : "Code link pending — add a GitHub permalink and a short README note."}</p>
                  </div>
                  <span className="path-state" aria-label={ok ? "Verified" : c.has_evidence ? "Needs review" : "Missing"}>
                    <Icon name={ok ? "check" : "alert"} size={14} strokeWidth={3} />
                  </span>
                </li>
                );
              })}
            </ol>
          </section>
        )}

        {cronActivity && cronActivity.runs.length > 0 && (
          <section className="automation" aria-labelledby="automation-title">
            <SectionHead id="automation-title" title="Automation" href="/activity" />
            <CronRunList runs={cronActivity.runs} limit={3} />
          </section>
        )}
      </aside>
    </div>
  );
}

function uniqueJobs(jobs: JobSummary[]) {
  const seen = new Set<string>();
  return jobs.filter((j) => !seen.has(j.id) && seen.add(j.id));
}

type AlertGroup = { key: string; action: string; at: string; overdue: boolean; unconfirmed: boolean; items: DeadlineAlert[] };

/** Same action at the same time (e.g. three drafts due 18:00) collapses into one line. */
function groupAlerts(alerts: DeadlineAlert[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const a of alerts) {
    const key = `${a.action}|${Date.parse(a.at)}|${a.overdue}`;
    const g = groups.get(key) ?? { key, action: a.action, at: a.at, overdue: a.overdue, unconfirmed: false, items: [] };
    g.items.push(a);
    g.unconfirmed ||= a.time_unconfirmed;
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => Number(y.overdue) - Number(x.overdue) || Date.parse(x.at) - Date.parse(y.at));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slotTime = (iso: string) => slot(iso).split(" · ")[1]?.split(" ")[0] ?? "";
