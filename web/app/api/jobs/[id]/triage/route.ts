import { assertJobId, runJobOS, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";

/** Keep → schedules "Draft application" in 3 days. Skip → withdrawn with the reason as evidence. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/triage">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const body = await readJson(req);
    const decision = body.decision === "keep" ? "keep" : body.decision === "skip" ? "skip" : "";
    const reason = String(body.reason ?? "").trim();
    if (!decision) throw new JobOSError("Choose keep or skip.", "rule");
    if (reason.length > 300) throw new JobOSError("Reason is too long (300).", "rule");
    const args = ["triage", id, "--decision", decision];
    if (decision === "skip") args.push("--reason", reason);
    return json(await runJobOS(args));
  } catch (e) {
    return errorResponse(e);
  }
}
