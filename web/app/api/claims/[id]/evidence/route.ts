import { runJobOS, JobOSError } from "@/lib/jobos";
import { errorResponse, json, readJson, requireSameOrigin } from "@/lib/http";

const CLAIM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PERMALINK_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{7,40}\/\S+$/;

/** Attach a GitHub commit permalink to a claim. Saved as unverified; needs explicit confirmation. */
export async function POST(req: Request, ctx: RouteContext<"/api/claims/[id]/evidence">) {
  const blocked = requireSameOrigin(req);
  if (blocked) return blocked;
  try {
    const claim = (await ctx.params).id;
    if (!CLAIM_RE.test(claim)) throw new JobOSError("Unknown claim.", "rule");
    const body = await readJson(req);
    const url = String(body.url ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!PERMALINK_RE.test(url) || url.length > 500) {
      throw new JobOSError("Use a GitHub commit permalink (…/blob/<commit>/path#L10-L40). On GitHub, press 'y' to get one.", "rule");
    }
    if (note.length > 120) throw new JobOSError("Note is too long (120).", "rule");
    if (body.confirm !== true) throw new JobOSError("Confirm that this code implements the claim before saving.", "rule");
    return json(await runJobOS(["evidence", claim, "--url", url, "--note", note, "--confirm"]));
  } catch (e) {
    return errorResponse(e);
  }
}
