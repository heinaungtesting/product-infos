import Link from "next/link";
import type { JobSummary } from "@/lib/types";
import { dueLabel, jst, longDay } from "@/lib/format";
import { JobOSError } from "@/lib/jobos";
import { BrandMark, Icon, type IconName } from "./icons";

const STATUS_LABEL: Record<string, string> = {
  discovered: "New", drafted: "Draft", reviewed: "Reviewed", applied: "Applied", interview: "Interview",
  offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn", closed: "Closed",
};

export function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s;
}

/** Colored status pill. */
export function Badge({ status, stage }: { status: string; stage?: string }) {
  return (
    <span className="pill" data-status={status}>
      {statusLabel(status)}
      {stage ? ` · ${stage}` : ""}
    </span>
  );
}

export function Verdict({ verdict }: { verdict: string }) {
  if (!verdict) return null;
  return <span className={`pill verdict-${verdict}`}>{verdict === "PASS" ? "Eligible" : verdict === "WARN" ? "Check fit" : "Blocked"}</span>;
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: "blue" | "red" | "amber" | "green" }) {
  return <span className={`tag${tone ? ` tag-${tone}` : ""}`}>{children}</span>;
}

const LOGO_COLORS = ["#2563eb", "#0ea5e9", "#7c3aed", "#db2777", "#059669", "#ea580c", "#0891b2", "#4f46e5", "#dc2626", "#0d9488"];

/** Company monogram tile, colored deterministically from the name. */
export function Logo({ name, size = 44 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const words = name.replace(/^(株式会社|有限会社)/, "").trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 1)).toUpperCase();
  return (
    <span className="logo" style={{ width: size, height: size, background: LOGO_COLORS[h % LOGO_COLORS.length], fontSize: size * (initials.length > 1 ? 0.36 : 0.46) }} aria-hidden>
      {initials}
    </span>
  );
}

/** Rich job card used by Today, Pipeline and the board. */
export function JobCard({ job, now, compact = false }: { job: JobSummary; now?: string; compact?: boolean }) {
  const due = job.due_at ? dueLabel(job.due_at, now, job.overdue) : "";
  const urgent = job.overdue || (job.due_at && /today|tomorrow/.test(due));
  return (
    <Link href={`/jobs/${job.id}`} className={`job-card${compact ? " compact" : ""}${job.overdue ? " overdue" : ""}`}>
      <div className="job-head">
        <Logo name={job.company} size={compact ? 36 : 48} />
        <div className="job-id">
          <strong>{job.company}</strong>
          <span>{job.title}</span>
        </div>
        {!compact && <Badge status={job.status} stage={job.stage} />}
      </div>
      {job.next_action && (
        <div className="job-meta">
          <span><Icon name={job.next_kind === "interview" ? "video" : "flag"} size={16} />{job.next_action}</span>
        </div>
      )}
      <div className="job-foot">
        <div className="tags">
          {compact && <Badge status={job.status} stage={job.stage} />}
          {job.status === "discovered" && <Verdict verdict={job.verdict} />}
          {job.override && <Tag tone="amber">Override</Tag>}
        </div>
        {job.due_at ? (
          <span className={`job-due${urgent ? " urgent" : ""}`}>
            {compact ? `${due.charAt(0).toUpperCase()}${due.slice(1)}` : `${jst(job.due_at)}`}
          </span>
        ) : (
          <span className="job-due">No deadline</span>
        )}
      </div>
    </Link>
  );
}

/** Legacy compact row, kept for dense lists (history, ended jobs). */
export function JobRow({ job }: { job: JobSummary; showDue?: boolean }) {
  return (
    <li>
      <Link href={`/jobs/${job.id}`} className="row">
        <Logo name={job.company} size={32} />
        <span className="row-main">
          <span className="row-title">{job.company}</span>
          <span className="sub">{job.title}</span>
        </span>
        <Badge status={job.status} />
      </Link>
    </li>
  );
}

export function StatTile({ icon, value, label, sub, tone = "blue", href }: { icon: IconName; value: number | string; label: string; sub?: string; tone?: "blue" | "amber" | "green" | "red"; href?: string }) {
  const body = (
    <>
      <span className={`stat-icon tone-${tone}`}><Icon name={icon} size={24} /></span>
      <span className="stat-text">
        <span className="stat-line"><strong className="num">{value}</strong><span className="stat-label">{label}</span></span>
        {sub && <span className="stat-sub">{sub}</span>}
      </span>
    </>
  );
  return href ? <Link href={href} className="stat">{body}</Link> : <div className="stat">{body}</div>;
}

export function SectionHead({ title, href, action = "View all", id }: { title: string; href?: string; action?: string; id?: string }) {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      {href && <Link href={href} className="link-more">{action}<Icon name="arrow" size={18} /></Link>}
    </div>
  );
}

/** Page title block. Phone gets the brand row; desktop gets search + Hermes on the right. */
export function PageHeader({ title, back, date = true, children }: { title: string; back?: { href: string; label: string }; date?: boolean; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div className="mobile-brand"><BrandMark size={30} /><strong>Job OS</strong></div>
      {back && <Link className="back" href={back.href}><Icon name="back" size={18} />{back.label}</Link>}
      <div className="title-row">
        <h1>{title}</h1>
        {date && <span className="title-date">{longDay()}</span>}
        <div className="header-tools">
          <form action="/pipeline" className="search" role="search">
            <Icon name="search" size={18} />
            <input name="q" type="search" placeholder="Search jobs or companies…" aria-label="Search jobs" />
          </form>
          <Link href="/hermes" className="btn ghost"><Icon name="sparkle" size={18} />Ask Hermes</Link>
        </div>
      </div>
      {children}
    </header>
  );
}

export function ErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const system = error instanceof JobOSError ? error.kind === "system" : true;
  return (
    <div className="card error-card" role="alert">
      <span className="stat-icon tone-red"><Icon name="alert" size={24} /></span>
      <div>
        <strong>{system ? "Job OS failed" : "Refused"}</strong>
        <p>{message}</p>
        {system && <p className="sub">Check JOB_OS_DIR on the server, then run <code>python3 job_os.py due</code>.</p>}
        <a className="btn secondary" href="">Try again</a>
      </div>
    </div>
  );
}

export function Empty({ children, icon = "check" }: { children: React.ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} />
      <span>{children}</span>
    </div>
  );
}
