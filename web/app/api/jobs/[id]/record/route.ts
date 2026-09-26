import { assertJobId, runJobOS, STATUSES, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/record">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const body = await readJson(req);
    const status = String(body.status ?? "");
    const note = String(body.note ?? "").trim();
    const stage = String(body.stage ?? "").trim();
    if (!(STATUSES as readonly string[]).includes(status)) throw new JobOSError(`Unknown status '${status}'.`, "rule");
    if (note.length > 2000 || stage.length > 40) throw new JobOSError("Note (2000) or stage (40) is too long.", "rule");
    const args = ["record", id, "--status", status, "--note", note];
    if (stage) args.push("--stage", stage);
    return json(await runJobOS(args));
  } catch (e) {
    return errorResponse(e);
  }
}
