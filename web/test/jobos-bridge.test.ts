/**
 * Contract tests for scripts/jobos_bridge.py against the real Job OS v4 CLI.
 * Runs on a throwaway copy of the v4 skill directory so real records are never touched.
 * Skipped when the v4 skill is not installed on this machine.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const V4_DIR = process.env.JOB_OS_V4_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "hermes", "skills", "career", "job-os");
const BRIDGE = path.resolve(import.meta.dirname, "..", "scripts", "jobos_bridge.py");
const PYTHON = process.env.PYTHON ?? "python";
const present = existsSync(path.join(V4_DIR, "job_os.py")) && existsSync(path.join(V4_DIR, "data", "job_os.sqlite3"));

let root = "";
function run(args: string[], input?: string): Promise<{ code: number; out: any; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(PYTHON, [BRIDGE, "--json", ...args], { env: { ...process.env, JOB_OS_PY: path.join(root, "job_os.py") } }, (err, stdout, stderr) => {
      let out: any;
      try { out = JSON.parse(stdout); } catch { out = undefined; }
      resolve({ code: err ? Number((err as any).code ?? 1) : 0, out, stderr });
    });
    child.stdin?.end(input ?? "");
  });
}

describe("jobos_bridge (Job OS v4 compatibility)", { skip: !present && "Job OS v4 not installed" }, () => {
  before(() => {
    root = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "jobos-v4-"));
    cpSync(V4_DIR, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}__pycache__`) });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("api today returns the dashboard Today shape", async () => {
    const { code, out } = await run(["api", "today"]);
    assert.equal(code, 0);
    for (const k of ["now", "next_interview", "upcoming", "waiting", "counts", "evidence", "profile_loaded"]) assert.ok(k in out, k);
    assert.equal(typeof out.counts.discovered, "number");
    assert.ok(Array.isArray(out.upcoming));
    assert.equal(typeof out.evidence.reviewed, "number");
  });

  it("api pipeline groups every status", async () => {
    const { out } = await run(["api", "pipeline"]);
    assert.deepEqual(out.order.slice(0, 3), ["discovered", "drafted", "reviewed"]);
    for (const s of out.order) assert.ok(Array.isArray(out.groups[s]), s);
    const all = out.order.flatMap((s: string) => out.groups[s]);
    assert.ok(all.length > 0);
    for (const j of all) assert.match(j.verdict, /^(PASS|WARN|BLOCK|)$/);
  });

  it("api job maps the traceable match graph and never offers drafted", async () => {
    const pipe = (await run(["api", "pipeline"])).out;
    const id = pipe.groups.discovered[0]?.id ?? pipe.order.flatMap((s: string) => pipe.groups[s])[0].id;
    const { code, out } = await run(["api", "job", id]);
    assert.equal(code, 0);
    assert.equal(out.job.id, id);
    for (const m of out.match) assert.match(m.match, /^(direct|inferred|none)$/);
    assert.ok(!out.allowed_next.includes("drafted"), "drafting must go through `draft`, not a status flip");
    assert.ok(Array.isArray(out.events));
  });

  it("api job does not leak absolute filesystem paths from event notes", async () => {
    const { out } = await run(["api", "job", "herp-2027-engineer"]);
    if (!out?.events) return;
    for (const e of out.events) assert.doesNotMatch(e.note, /[A-Za-z]:\\|\/Users\/|\/home\//);
  });

  it("api readiness and prep are read-only", async () => {
    const db = path.join(root, "data", "job_os.sqlite3");
    const before = readFileSync(db);
    const r = await run(["api", "readiness"]);
    assert.equal(r.code, 0);
    assert.ok(Array.isArray(r.out.claims) && Array.isArray(r.out.gaps));
    const pipe = (await run(["api", "pipeline"])).out;
    const id = pipe.order.flatMap((s: string) => pipe.groups[s])[0].id;
    const p = await run(["api", "prep", id]);
    assert.equal(p.code, 0);
    assert.ok(Array.isArray(p.out.probe));
    assert.ok(readFileSync(db).equals(before), "reads must not modify the database");
    assert.ok(!existsSync(path.join(root, "applications", id, "interview_prep.md")) || statSync(path.join(root, "applications", id, "interview_prep.md")).mtimeMs < Date.now() - 60_000);
  });

  it("verify returns the sidebar evidence meter", async () => {
    const { code, out } = await run(["verify"]);
    assert.equal(code, 0);
    assert.equal(typeof out.reviewed, "number");
    assert.equal(typeof out.linked, "number");
  });

  it("scrubs local paths from notes but keeps URLs intact", async () => {
    const py = `import sys,json,importlib.util as u
s=u.spec_from_file_location("b",sys.argv[1]);b=u.module_from_spec(s);s.loader.exec_module(b)
class V: ROOT=sys.argv[2]
print(json.dumps([b.scrub(V,x) for x in sys.argv[3:]]))`;
    const out: string[] = await new Promise((res, rej) => execFile(PYTHON, ["-c", py, BRIDGE, root,
      "Imported from https://recruit.jobcan.jp/donuts/job_offers/2184751",
      "saved C:\\Users\\hhama\\secret\\resume.pdf ok",
      "see /home/sigma/x/notes.md"], (e, so) => (e ? rej(e) : res(JSON.parse(so)))));
    assert.equal(out[0], "Imported from https://recruit.jobcan.jp/donuts/job_offers/2184751");
    assert.equal(out[1], "saved resume.pdf ok");
    assert.equal(out[2], "see notes.md");
  });

  it("unknown job is a rule error, not a system failure", async () => {
    const { code, out } = await run(["api", "job", "does-not-exist"]);
    assert.equal(code, 0);
    assert.match(out.error, /^No job/);
  });

  it("record enforces v4 evidence rules and refuses drafted", async () => {
    const drafted = await run(["record", "hatena-2027-web", "--status", "drafted", "--note", "x"]);
    assert.match(drafted.out.error, /draft/i);
    const noNote = await run(["record", "hatena-2027-web", "--status", "rejected", "--note", ""]);
    assert.match(noNote.out.error, /confirmation|note/i);
    const ok = await run(["record", "hatena-2027-web", "--status", "withdrawn", "--note", "not a fit"]);
    assert.deepEqual(ok.out, { ok: true });
    const job = (await run(["api", "job", "hatena-2027-web"])).out;
    assert.equal(job.job.status, "withdrawn");
  });

  it("schedule stores local time as JST", async () => {
    const r = await run(["schedule", "litalico-2027-web", "--action", "ES提出", "--due", "2026-10-05T18:00", "--kind", "task"]);
    assert.deepEqual(r.out, { ok: true });
    const job = (await run(["api", "job", "litalico-2027-web"])).out;
    assert.equal(job.job.due_at, "2026-10-05T18:00:00+09:00");
    assert.equal(job.job.next_action, "ES提出");
  });

  // ---- Feature 5: deadline-ping alerts on Today (same rule as the 09:00 cron: job_os.py alerts --hours 72)
  it("api today carries the deadline-ping alerts", async () => {
    const soon = new Date(Date.now() + 24 * 3600_000 + 9 * 3600_000).toISOString().slice(0, 16);
    await run(["schedule", "fuller-2027-software", "--action", "ES締切", "--due", soon, "--kind", "task"]);
    const { out } = await run(["api", "today"]);
    assert.ok(Array.isArray(out.alerts));
    const hit = out.alerts.find((a: any) => a.job === "fuller-2027-software");
    assert.ok(hit, "a task due in 24h must appear");
    assert.equal(hit.overdue, false);
    assert.match(hit.text, /ES締切/);
  });

  // ---- Résumé CRUD (idempotent)
  it("resume save creates once, then refuses to duplicate identical content", async () => {
    const pipe = (await run(["api", "pipeline"])).out;
    const id = pipe.groups.discovered.find((j: any) => j.verdict !== "BLOCK")?.id;
    assert.ok(id, "needs a draftable job in the copy");
    const before = (await run(["resume", "list", id])).out;
    assert.equal(before.can_draft, true);
    const first = await run(["resume", "save", id, "--language", "en"]);
    assert.equal(first.out.action, "created", JSON.stringify(first.out));
    const again = await run(["resume", "save", id, "--language", "en"]);
    assert.equal(again.out.action, "unchanged");
    assert.equal(again.out.version, first.out.version);
    const list = (await run(["resume", "list", id])).out;
    assert.equal(list.versions.length, before.versions.length + 1);
    assert.ok(!JSON.stringify(list).match(/[A-Za-z]:[\\/]|\/Users\//), "no server paths");
    const dbFile = path.join(root, "data", "job_os.sqlite3");
    const mtime = statSync(dbFile).mtimeMs;
    await run(["resume", "list", id]);
    assert.equal(statSync(dbFile).mtimeMs, mtime, "listing must not write the database");
  });

  it("resume save with a 志望動機 via stdin makes a new version once; delete archives; sent is protected", async () => {
    const pipe = (await run(["api", "pipeline"])).out;
    const id = pipe.groups.discovered.find((j: any) => j.verdict !== "BLOCK")?.id;
    const mot = "貴社の開発姿勢に惹かれました。";
    const a = await run(["resume", "save", id, "--language", "ja", "--motivation", "-"], mot);
    assert.equal(a.out.action, "created", JSON.stringify(a.out));
    const b = await run(["resume", "save", id, "--language", "ja", "--motivation", "-"], mot);
    assert.equal(b.out.action, "unchanged");
    const row = (await run(["resume", "list", id])).out.versions.find((v: any) => v.version === a.out.version);
    assert.equal(row.motivation, mot);
    const del = await run(["resume", "delete", id, "--version", String(a.out.version)]);
    assert.equal(del.out.action, "deleted");
    const del2 = await run(["resume", "delete", id, "--version", String(a.out.version)]);
    assert.equal(del2.out.action, "unchanged");
    const tooLong = await run(["resume", "save", id, "--language", "ja", "--motivation", "-"], "あ".repeat(601));
    assert.match(tooLong.out.error, /600/);
    const sent = pipe.groups.applied.concat(pipe.groups.interview).find((j: any) => j.id);
    if (sent) {
      const d = (await run(["resume", "list", sent.id])).out;
      assert.equal(d.can_draft, false);
      const refuse = await run(["resume", "save", sent.id, "--language", "en"]);
      assert.match(refuse.out.error, /Already/);
    }
  });

  // ---- Feature 3: keep / skip triage
  it("triage keep sets a next action and removes the job from the undecided list", async () => {
    // Live data changes daily; pick whichever job is still undecided in this copy.
    const before = (await run(["api", "today"])).out;
    const target = before.waiting.find((w: any) => w.kind === "triage")?.job;
    assert.ok(target, "fixture copy needs at least one undecided job");
    const r = await run(["triage", target, "--decision", "keep"]);
    assert.deepEqual(r.out, { ok: true });
    const job = (await run(["api", "job", target])).out.job;
    assert.equal(job.status, "discovered");
    assert.ok(job.next_action.length > 0 && job.due_at.endsWith("+09:00"));
    const today = (await run(["api", "today"])).out;
    assert.ok(!today.waiting.some((w: any) => w.kind === "triage" && w.job === target));
  });

  it("triage skip records withdrawn with the reason; needs a reason; only for discovered", async () => {
    const empty = await run(["triage", "andpad-2027-engineer", "--decision", "skip", "--reason", " "]);
    assert.match(empty.out.error, /reason/i);
    const ok = await run(["triage", "andpad-2027-engineer", "--decision", "skip", "--reason", "SES寄り"]);
    assert.deepEqual(ok.out, { ok: true });
    const d = (await run(["api", "job", "andpad-2027-engineer"])).out;
    assert.equal(d.job.status, "withdrawn");
    assert.match(d.events[0].note, /SES寄り/);
    const again = await run(["triage", "donuts-2027-web", "--decision", "skip", "--reason", "x"]);
    assert.match(again.out.error, /undecided|discovered/i);
  });

  it("today waiting rows carry short company/title fields", async () => {
    const { out } = await run(["api", "today"]);
    const t = out.waiting.find((w: any) => w.kind === "triage");
    if (!t) return;
    assert.equal(typeof t.company, "string");
    assert.equal(typeof t.title, "string");
  });

  // ---- Feature 2: add a code link from the phone
  it("evidence add requires a commit permalink and explicit confirmation", async () => {
    const branch = await run(["evidence", "sugi-reliability", "--url", "https://github.com/heinaungtesting/sugi/blob/main/src/sync.ts#L10", "--confirm"]);
    assert.match(branch.out.error, /commit permalink/i);
    const unconfirmed = await run(["evidence", "sugi-reliability", "--url", "https://github.com/heinaungtesting/sugi/blob/0123abc/src/sync.ts#L10"]);
    assert.match(unconfirmed.out.error, /confirm/i);
    const unknown = await run(["evidence", "nope", "--url", "https://github.com/a/b/blob/0123abc/x.ts", "--confirm"]);
    assert.match(unknown.out.error, /claim/i);
  });

  it("evidence add links the claim, stays unverified, and closes the gap", async () => {
    const url = "https://github.com/heinaungtesting/sugi/blob/0123abcd/src/lib/offline.ts#L12-L40";
    const r = await run(["evidence", "sugi-reliability", "--url", url, "--note", "offline detection", "--confirm"]);
    assert.deepEqual(r.out, { ok: true, result: "added" });
    const rd = (await run(["api", "readiness"])).out;
    const c = rd.claims.find((x: any) => x.id === "sugi-reliability");
    assert.equal(c.has_evidence, true);
    assert.equal(c.verified, false, "a phone-added link is pending review, not verified");
    assert.equal(rd.evidence.verified, 0);
    assert.equal(c.evidence[0].url, url);
    assert.match(c.evidence[0].note, /unverified/);
    assert.ok(!rd.evidence.missing_evidence.includes("sugi-reliability"));
    const profile = JSON.parse(readFileSync(path.join(root, "profile.json"), "utf8"));
    const ev = profile.claims.find((x: any) => x.id === "sugi-reliability").evidence;
    assert.equal(ev.at(-1).verified, false);
  });

  // ---- Feature 1: debrief from the phone
  it("debrief saves questions into the bank and shows on the job page", async () => {
    const data = {
      stage: "1次面接", date: "2026-09-28", format: "online", interviewers: "エンジニア2名",
      questions: [
        { q: "オフライン検知はどこで実装していますか？", claim: "sugi-reliability", stuck: true, what_i_said: "曖昧", better_answer: "useOnline フックで…" },
        { q: "なぜNext.jsを選んだのですか？", claim: "", stuck: false },
      ],
      went_well: "デモ", next_time: "コードを画面共有で即示す",
    };
    const r = await run(["debrief", "donuts-2027-web", "--data", JSON.stringify(data)]);
    assert.deepEqual(r.out, { ok: true, questions: 2 });
    const d = (await run(["api", "job", "donuts-2027-web"])).out;
    assert.equal(d.debriefs.length, 1);
    assert.equal(d.debriefs[0].stuck, 1);
    assert.equal(d.debriefs[0].questions[0].q, data.questions[0].q);
    assert.ok(d.claims.some((c: any) => c.id === "sugi-reliability"));
    const prep = (await run(["api", "prep", "donuts-2027-web"])).out;
    assert.ok(prep.lessons.some((l: string) => l.includes("コードを画面共有")));
  });

  it("debrief via stdin handles a max-size payload (Windows argv limit)", async () => {
    const qs = Array.from({ length: 30 }, (_, i) => ({ q: `長い質問${i} `.padEnd(300, "あ"), better_answer: "い".repeat(800) }));
    const r = await run(["debrief", "donuts-2027-web", "--data", "-"], JSON.stringify({ stage: "2次面接", questions: qs }));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.questions, 30);
  });

  it("debrief rejects empty questions, unknown claims and bad JSON", async () => {
    const none = await run(["debrief", "donuts-2027-web", "--data", JSON.stringify({ stage: "x", questions: [] })]);
    assert.match(none.out.error, /question/i);
    const bad = await run(["debrief", "donuts-2027-web", "--data", JSON.stringify({ questions: [{ q: "a", claim: "zzz" }] })]);
    assert.match(bad.out.error, /claim/i);
    const junk = await run(["debrief", "donuts-2027-web", "--data", "{nope"]);
    assert.match(junk.out.error, /JSON/);
  });
});
