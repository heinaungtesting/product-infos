import { assertJobId, runJobOS, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/schedule">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const body = await readJson(req);
    const action = String(body.action ?? "").trim();
    const due = String(body.due ?? "");
    const kind = body.kind === "interview" ? "interview" : "task";
    if (!action || action.length > 200) throw new JobOSError("Next action must be 1–200 characters.", "rule");
    // The form sends local time; job_os.py stores it as JST (+09:00).
    if (!LOCAL_DT.test(due)) throw new JobOSError("Pick a due date and time.", "rule");
    return json(await runJobOS(["schedule", id, "--action", action, "--due", due, "--kind", kind]));
  } catch (e) {
    return errorResponse(e);
  }
}
