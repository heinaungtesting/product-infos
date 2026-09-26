import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type CronRunStatus = "completed" | "silent" | "failed";

export interface JobOsCronJob {
  id: string;
  name: string;
  schedule: string;
  nextRunAt: string;
  lastStatus: string;
  enabled: boolean;
  mode: "agent" | "script" | "monitor";
}

export interface JobOsCronRun {
  id: string;
  jobId: string;
  jobName: string;
  runAt: string;
  status: CronRunStatus;
  output: string;
  sourceFile: string;
}

export interface JobOsCronActivity {
  jobs: JobOsCronJob[];
  runs: JobOsCronRun[];
}

type RawJob = {
  id?: unknown;
  name?: unknown;
  skills?: unknown;
  script?: unknown;
  no_agent?: unknown;
  monitor_script?: unknown;
  schedule_display?: unknown;
  next_run_at?: unknown;
  last_status?: unknown;
  enabled?: unknown;
};

type ReadOptions = { limit?: number };

const SAFE_JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function isJobOsJob(job: RawJob): boolean {
  const skills = Array.isArray(job.skills) ? job.skills : [];
  return (
    (typeof job.name === "string" && job.name.toLowerCase().startsWith("job os")) ||
    skills.includes("job-os") ||
    (typeof job.script === "string" && job.script.startsWith("job_os_")) ||
    (typeof job.monitor_script === "string" && job.monitor_script.startsWith("job_os_"))
  );
}

function normalizeJob(job: RawJob): JobOsCronJob | null {
  if (
    !isJobOsJob(job) ||
    typeof job.id !== "string" ||
    !SAFE_JOB_ID.test(job.id) ||
    typeof job.name !== "string"
  ) return null;
  return {
    id: job.id,
    name: job.name,
    schedule: typeof job.schedule_display === "string" ? job.schedule_display : "",
    nextRunAt: typeof job.next_run_at === "string" ? job.next_run_at : "",
    lastStatus: typeof job.last_status === "string" ? job.last_status : "",
    enabled: job.enabled !== false,
    mode: job.no_agent === true ? "script" : typeof job.monitor_script === "string" ? "monitor" : "agent",
  };
}

function parseRunTime(markdown: string, filename: string): string {
  const header = markdown.match(/^\*\*Run Time:\*\*\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/m);
  const file = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/);
  if (header) return `${header[1]}T${header[2]}+09:00`;
  if (file) return `${file[1]}T${file[2]}:${file[3]}:${file[4]}+09:00`;
  return "";
}

function afterLastHeading(markdown: string, heading: string): string | null {
  const marker = `\n${heading}\n`;
  const content = `\n${markdown}`;
  const index = content.lastIndexOf(marker);
  return index < 0 ? null : content.slice(index + marker.length).trim();
}

function extractOutput(rawMarkdown: string): { output: string; status: CronRunStatus } {
  const markdown = rawMarkdown.replace(/\r\n/g, "\n");
  const title = /^# Cron Job:\s*(.+)$/m.exec(markdown)?.[1] ?? "";
  const hasRunTime = /^\*\*Run Time:\*\*/m.test(markdown);
  if (!title || !hasRunTime) {
    return { output: "Cron archive metadata is incomplete.", status: "failed" };
  }
  if (/\(FAILED\)\s*$/.test(title)) {
    return { output: "The cron run failed. Details remain in the private Hermes log.", status: "failed" };
  }
  const sectionIndexes = ["\n## Prompt", "\n## Response", "\n---\n"]
    .map((marker) => markdown.indexOf(marker))
    .filter((index) => index >= 0);
  const ledgerHeader = markdown.slice(0, sectionIndexes.length ? Math.min(...sectionIndexes) : markdown.length);
  const statusMatch = /^\*\*Status:\*\*\s*(.+)$/m.exec(ledgerHeader);
  if (statusMatch) {
    const statusText = statusMatch[1]?.trim() ?? "unknown";
    const body = ledgerHeader.slice((statusMatch.index ?? 0) + statusMatch[0].length).trim();
    if (/failed|blocked/i.test(statusText)) {
      return { output: body || statusText, status: "failed" };
    }
    if (/silent|no_change/i.test(statusText)) {
      return { output: "No update was produced.", status: "silent" };
    }
  }

  const response = afterLastHeading(markdown, "## Response");
  if (response !== null) {
    if (response === "[SILENT]" || response === "" || response === "(No response generated)") {
      return { output: "No update was produced.", status: "silent" };
    }
    if (response.startsWith("[CRON_FAILURE]")) {
      return {
        output: response.slice("[CRON_FAILURE]".length).trim() || "The cron run failed without an error message.",
        status: "failed",
      };
    }
    return { output: response, status: "completed" };
  }

  const isAgentArchive = /^## Prompt\s*$/m.test(markdown);
  if (isAgentArchive) {
    return {
      output: "Run ended before a response was recorded.",
      status: "failed",
    };
  }

  const scriptParts = markdown.split(/\n---\n/);
  const output = (scriptParts.length > 1 ? scriptParts[scriptParts.length - 1] ?? "" : "").trim();
  if (!output || output === "[SILENT]") return { output: "No update was produced.", status: "silent" };
  return { output, status: "completed" };
}

async function readRuns(cronDir: string, jobs: JobOsCronJob[], options: ReadOptions): Promise<JobOsCronRun[]> {
  const candidates = (await Promise.all(jobs.map(async (job) => {
    const dir = path.join(cronDir, "output", job.id);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => ({ job, file: entry.name, dir }));
    } catch {
      return [];
    }
  }))).flat().sort((a, b) => b.file.localeCompare(a.file));

  const limit = options.limit;
  const selected = typeof limit === "number" && Number.isFinite(limit)
    ? candidates.slice(0, Math.max(0, Math.floor(limit)))
    : candidates;
  const runs = await Promise.all(selected.map(async ({ job, file, dir }) => {
    try {
      const markdown = await readFile(path.join(dir, file), "utf8");
      const parsed = extractOutput(markdown);
      return {
        id: `${job.id}:${file}`,
        jobId: job.id,
        jobName: job.name,
        runAt: parseRunTime(markdown, file),
        status: parsed.status,
        output: parsed.output,
        sourceFile: file,
      } satisfies JobOsCronRun;
    } catch {
      // A pruned or temporarily locked archive must not take down the entire activity feed.
      return null;
    }
  }));

  return runs.filter((run): run is JobOsCronRun => run !== null).sort((a, b) => b.runAt.localeCompare(a.runAt));
}

/** Read Hermes cron state without executing a command or exposing prompts/secrets. */
export async function listJobOsCronActivity(cronDir: string, options: ReadOptions = {}): Promise<JobOsCronActivity> {
  const raw = JSON.parse(await readFile(path.join(cronDir, "jobs.json"), "utf8")) as { jobs?: RawJob[] };
  const jobs = (Array.isArray(raw.jobs) ? raw.jobs : []).map(normalizeJob).filter((job): job is JobOsCronJob => job !== null);
  return { jobs, runs: await readRuns(cronDir, jobs, options) };
}
