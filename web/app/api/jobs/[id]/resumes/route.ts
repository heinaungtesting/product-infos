import { assertJobId, runJobOS, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";
import type { ResumeList, ResumeSaveResult } from "@/lib/types";

/** List résumé versions for a job. */
export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]/resumes">) {
  try {
    const id = assertJobId((await ctx.params).id);
    return json(await runJobOS<ResumeList>(["resume", "list", id]));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Create / update. Idempotent: identical content returns {action:"unchanged"} and writes nothing. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/resumes">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const body = await readJson(req);
    const language = body.language === "en" ? "en" : "ja";
    const motivation = String(body.motivation ?? "");
    if (motivation.length > 600) throw new JobOSError("志望動機 is over 600 characters.", "rule");
    return json(await runJobOS<ResumeSaveResult>(["resume", "save", id, "--language", language, "--motivation", "-"], motivation));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Delete = archive. Never the sent version. Deleting a version that's already gone is a no-op. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/jobs/[id]/resumes">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const id = assertJobId((await ctx.params).id);
    const v = Number(new URL(req.url).searchParams.get("version"));
    if (!Number.isInteger(v) || v < 1 || v > 9999) throw new JobOSError("Pick a version.", "rule");
    return json(await runJobOS<ResumeSaveResult>(["resume", "delete", id, "--version", String(v)]));
  } catch (e) {
    return errorResponse(e);
  }
}
