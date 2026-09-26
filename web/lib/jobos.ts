import "server-only";
import { execFile } from "node:child_process";
import { config } from "./config";

export const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const STATUSES = [
  "discovered", "drafted", "reviewed", "applied", "interview", "offer", "rejected", "withdrawn", "closed",
] as const;
export type Status = (typeof STATUSES)[number];

export class JobOSError extends Error {
  constructor(
    message: string,
    /** "rule": job_os.py refused (show as-is). "system": Job OS itself failed. */
    readonly kind: "rule" | "system",
  ) {
    super(message);
  }
}

/** Run job_os.py with a fixed argument array. Never goes through a shell. */
export function runJobOS<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      config.python,
      [config.jobOsPy, "--json", ...args],
      { timeout: 60_000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, JOB_OS_DIR: config.jobOsDir } },
      (err, stdout, stderr) => {
        let parsed: unknown;
        try {
          parsed = stdout ? JSON.parse(stdout) : undefined;
        } catch {
          parsed = undefined;
        }
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          return reject(new JobOSError(String((parsed as { error: unknown }).error), "rule"));
        }
        if (err || parsed === undefined) {
          const why = (stderr || err?.message || "no output").trim().split("\n").slice(-3).join(" ");
          return reject(new JobOSError(`Job OS failed: ${why}. Check JOB_OS_DIR and run \`python3 job_os.py due\`.`, "system"));
        }
        resolve(parsed as T);
      },
    );
  });
}

export function assertJobId(id: string): string {
  if (!JOB_ID_RE.test(id)) throw new JobOSError(`Invalid job id '${id}'.`, "rule");
  return id;
}
