import type { Status } from "./jobos";

export interface JobSummary {
  id: string;
  company: string;
  title: string;
  status: Status;
  stage: string;
  next_action: string;
  next_kind: "task" | "interview";
  due_at: string;
  overdue: boolean;
  verdict: "PASS" | "WARN" | "BLOCK" | "";
  override: boolean;
}

export interface Today {
  now: string;
  next_interview: JobSummary | null;
  upcoming: JobSummary[];
  waiting: { kind: string; job?: string; claim?: string; text: string }[];
  counts: Record<Status, number>;
  evidence: { reviewed: number; linked: number };
  profile_loaded: boolean;
}

export interface Pipeline {
  order: Status[];
  groups: Record<Status, JobSummary[]>;
}

export interface MatchRow {
  requirement: string;
  skill: string;
  match: "direct" | "inferred" | "none";
  preferred: boolean;
  claims: { claim: string; kind: string; path: string[]; text?: string }[];
}

export interface JobDetail {
  job: JobSummary & { url: string; posting: string; override_reason: string; sent_version: number | null };
  prescreen: { verdict?: string; reasons?: { level: string; rule: string; detail: string }[] };
  match: MatchRow[];
  versions: { version: number; created_at: string; claims: number; unmatched: string[]; sent: boolean }[];
  events: { at: string; status: string; note: string }[];
  allowed_next: Status[];
}

export interface Prep {
  markdown: string;
  job: JobSummary;
  sent_version: number | null;
  sent: { claims: { claim: string; text: string; why: string }[] } | null;
  probe: { claim: string; text: string; evidence: { url: string; note?: string }[]; missing_evidence: boolean; questions: string[] }[];
  history: { year?: number; stage?: string; result?: string; note?: string }[];
  lessons: string[];
}

export interface Readiness {
  claims: { id: string; text: string; reviewed: boolean; has_evidence: boolean; evidence: { url: string; note?: string }[]; skills: string[] }[];
  evidence: { reviewed: number; linked: number; missing_evidence: string[] };
  gaps: { requirement: string; jobs: number }[];
}
