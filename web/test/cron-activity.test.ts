import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { listJobOsCronActivity } from "../lib/cron-activity";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "job-os-cron-"));
  roots.push(root);
  await mkdir(path.join(root, "output", "job-weekly"), { recursive: true });
  await mkdir(path.join(root, "output", "job-alert"), { recursive: true });
  await mkdir(path.join(root, "output", "unrelated"), { recursive: true });
  await writeFile(path.join(root, "jobs.json"), JSON.stringify({
    jobs: [
      {
        id: "job-weekly",
        name: "Job OS weekly discovery",
        skills: ["job-os"],
        schedule_display: "0 9 * * 0",
        next_run_at: "2026-09-27T09:00:00+09:00",
        last_status: "ok",
        enabled: true,
      },
      {
        id: "job-alert",
        name: "Job OS daily deadline ping",
        skills: [],
        script: "job_os_alerts.py",
        no_agent: true,
        schedule_display: "0 9 * * *",
        next_run_at: "2026-09-27T09:00:00+09:00",
        last_status: "ok",
        enabled: true,
      },
      {
        id: "unrelated",
        name: "Server backup",
        skills: [],
        schedule_display: "0 1 * * *",
        enabled: true,
      },
    ],
  }));
  return root;
}

test("lists only Job OS schedules and extracts the delivered response from every output file", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_04-29-18.md"), [
    "# Cron Job: Job OS weekly discovery",
    "",
    "**Job ID:** job-weekly",
    "**Run Time:** 2026-09-26 04:29:18",
    "",
    "## Prompt",
    "",
    "This prompt must not appear in the app.",
    "",
    "## Response",
    "",
    "**期限**",
    "- 7日以内：DONUTS 一次面接",
  ].join("\n"));
  await writeFile(path.join(root, "output", "job-alert", "2026-09-26_12-17-56.md"), [
    "# Cron Job: Job OS daily deadline ping",
    "",
    "**Job ID:** job-alert",
    "**Run Time:** 2026-09-26 12:17:56",
    "**Mode:** no_agent (script)",
    "",
    "---",
    "",
    "【Job OS】72時間以内・期限超過",
    "• 09/28 Mon 12:00 | DONUTS | 面接",
  ].join("\r\n"));
  await writeFile(path.join(root, "output", "unrelated", "2026-09-26_13-00-00.md"), "## Response\n\nbackup complete");

  const result = await listJobOsCronActivity(root);

  assert.deepEqual(result.jobs.map((job) => job.id), ["job-weekly", "job-alert"]);
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0].jobId, "job-alert");
  assert.match(result.runs[0].output, /DONUTS/);
  assert.equal(result.runs[1].jobId, "job-weekly");
  assert.match(result.runs[1].output, /7日以内/);
  assert.doesNotMatch(result.runs[1].output, /prompt must not appear/);
});

test("keeps silent and failed runs visible instead of dropping them", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_08-00-00.md"), [
    "# Cron Job: Job OS weekly discovery",
    "**Job ID:** job-weekly",
    "**Run Time:** 2026-09-26 08:00:00",
    "## Response",
    "",
    "[SILENT]",
  ].join("\n"));
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_09-00-00.md"), [
    "# Cron Job: Job OS weekly discovery",
    "**Job ID:** job-weekly",
    "**Run Time:** 2026-09-26 09:00:00",
    "## Response",
    "",
    "[CRON_FAILURE]",
    "Fetcher timed out.",
  ].join("\n"));

  const result = await listJobOsCronActivity(root);

  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0].status, "failed");
  assert.equal(result.runs[0].output, "Fetcher timed out.");
  assert.equal(result.runs[1].status, "silent");
  assert.equal(result.runs[1].output, "No update was produced.");
});

test("uses the final response boundary and never exposes an incomplete agent prompt", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_10-00-00.md"), [
    "# Cron Job: Job OS weekly discovery",
    "**Run Time:** 2026-09-26 10:00:00",
    "## Prompt",
    "A skill says: put your answer under ## Response",
    "**Status:** failed",
    "secret prompt tail",
    "## Response",
    "",
    "SAFE FINAL ANSWER",
  ].join("\n"));
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_11-00-00.md"), [
    "# Cron Job: Job OS weekly discovery (FAILED)",
    "**Run Time:** 2026-09-26 11:00:00",
    "## Prompt",
    "secret prompt",
    "## Error",
    "secret diagnostic",
  ].join("\n"));

  const result = await listJobOsCronActivity(root);

  assert.equal(result.runs[0].status, "failed");
  assert.doesNotMatch(result.runs[0].output, /secret/);
  assert.equal(result.runs[1].status, "completed");
  assert.equal(result.runs[1].output, "SAFE FINAL ANSWER");
  assert.doesNotMatch(result.runs[1].output, /prompt/);
});

test("parses Hermes status-ledger failures and silent monitor ticks", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "output", "job-alert", "2026-09-26_12-00-00.md"), [
    "# Cron Job: Job OS daily deadline ping",
    "**Run Time:** 2026-09-26 12:00:00",
    "**Mode:** no_agent (script)",
    "**Status:** script failed",
    "",
    "Connection refused",
    "## Prompt",
    "secret diagnostic prompt",
  ].join("\r\n"));
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_13-00-00.md"), [
    "# Cron Job: Job OS weekly discovery",
    "**Run Time:** 2026-09-26 13:00:00",
    "**Mode:** monitor",
    "**Status:** no_change (agent run suppressed)",
  ].join("\n"));

  const result = await listJobOsCronActivity(root);

  assert.equal(result.runs[0].status, "silent");
  assert.equal(result.runs[1].status, "failed");
  assert.match(result.runs[1].output, /Connection refused/);
  assert.doesNotMatch(result.runs[1].output, /secret/);
});

test("skips unsafe job ids and unreadable output entries while keeping valid runs", async () => {
  const root = await fixture();
  const store = JSON.parse(await readFile(path.join(root, "jobs.json"), "utf8"));
  store.jobs.push({ id: "../outside", name: "Job OS unsafe", skills: ["job-os"] });
  await writeFile(path.join(root, "jobs.json"), JSON.stringify(store));
  await mkdir(path.join(root, "output", "job-weekly", "2026-09-26_14-00-00.md"));
  await writeFile(path.join(root, "output", "job-weekly", "2026-09-26_15-00-00.md"), [
    "# Cron Job: Job OS weekly discovery",
    "**Run Time:** 2026-09-26 15:00:00",
    "## Response",
    "",
    "Valid run",
  ].join("\n"));

  const result = await listJobOsCronActivity(root);

  assert.equal(result.jobs.some((job) => job.id === "../outside"), false);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].output, "Valid run");
});

test("a reader-level limit returns only the newest runs", async () => {
  const root = await fixture();
  for (const hour of ["08", "09", "10"]) {
    await writeFile(path.join(root, "output", "job-weekly", `2026-09-26_${hour}-00-00.md`), [
      "# Cron Job: Job OS weekly discovery",
      `**Run Time:** 2026-09-26 ${hour}:00:00`,
      "## Response",
      "",
      `Run ${hour}`,
    ].join("\n"));
  }

  const result = await listJobOsCronActivity(root, { limit: 2 });

  assert.deepEqual(result.runs.map((run) => run.output), ["Run 10", "Run 09"]);
});
