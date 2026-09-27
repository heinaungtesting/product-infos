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

export interface DeadlineAlert {
  job: string;
  company: string;
  status: Status;
  action: string;
  at: string;
  time_unconfirmed: boolean;
  overdue: boolean;
  text: string;
}

export interface WaitingItem {
  kind: string;
  job?: string;
  claim?: string;
  company?: string;
  title?: string;
  verdict?: string;
  text: string;
}

export interface Today {
  now: string;
  next_interview: JobSummary | null;
  upcoming: JobSummary[];
  waiting: WaitingItem[];
  counts: Record<Status, number>;
  alerts?: DeadlineAlert[];
  evidence: { reviewed: number; linked: number };
  profile_loaded: boolean;
}

export interface Debrief {
  at: string;
  stage: string;
  date: string;
  questions: { q: string; claim: string; stuck: boolean; better_answer: string }[];
  stuck: number;
  went_well: string;
  next_time: string;
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
  debriefs?: Debrief[];
  claims?: { id: string; label: string }[];
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
  claims: { id: string; text: string; reviewed: boolean; has_evidence: boolean; verified?: boolean; evidence: { url: string; note?: string }[]; skills: string[] }[];
  evidence: { reviewed: number; linked: number; verified?: number; missing_evidence: string[] };
  gaps: { requirement: string; jobs: number }[];
}

export type ResumeVersion = {
  version: number;
  language: "ja" | "en";
  format: string;
  created_at: string;
  ready: boolean;
  placeholders: string[];
  claims: number;
  upload_filename: string | null;
  sent: boolean;
  motivation: string;
  has_pdf: boolean;
};
export type ResumeList = { job_id: string; status: string; sent_version: number | null; can_draft: boolean; versions: ResumeVersion[] };
export type ResumeSaveResult = { action: "created" | "unchanged" | "deleted"; version: number; ready?: boolean; message?: string };
