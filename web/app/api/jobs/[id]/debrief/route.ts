import { assertJobId, runJobOS, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";

const CLAIM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Post-interview debrief. Questions go into the v4 question bank for drills. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/debrief">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const body = await readJson(req);
    const raw = Array.isArray(body.questions) ? body.questions : [];
    if (raw.length > 30) throw new JobOSError("At most 30 questions per debrief.", "rule");
    const questions = raw
      .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
      .map((q) => ({
        q: s(q.q, 300),
        claim: CLAIM_RE.test(String(q.claim ?? "")) ? String(q.claim) : "",
        stuck: q.stuck === true,
        what_i_said: s(q.what_i_said, 500),
        better_answer: s(q.better_answer, 800),
      }))
      .filter((q) => q.q);
    if (!questions.length) throw new JobOSError("Add at least one question they asked.", "rule");
    const date = s(body.date, 10);
    const data = {
      stage: s(body.stage, 40),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      format: body.format === "onsite" ? "onsite" : "online",
      interviewers: s(body.interviewers, 80),
      questions,
      went_well: s(body.went_well, 500),
      next_time: s(body.next_time, 300),
    };
    return json(await runJobOS(["debrief", id, "--data", "-"], JSON.stringify(data)));
  } catch (e) {
    return errorResponse(e);
  }
}
