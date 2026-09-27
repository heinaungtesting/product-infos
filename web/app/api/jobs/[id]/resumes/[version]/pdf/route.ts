import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { assertJobId, JobOSError, runJobOS } from "@/lib/jobos";
import { errorResponse } from "@/lib/http";
import type { ResumeList } from "@/lib/types";

/** Download a résumé PDF. The version must be listed by Job OS; the path is built server-side only. */
export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]/resumes/[version]/pdf">) {
  try {
    const p = await ctx.params;
    const id = assertJobId(p.id);
    const v = Number(p.version);
    if (!Number.isInteger(v) || v < 1 || v > 9999) throw new JobOSError("Pick a version.", "rule");
    const list = await runJobOS<ResumeList>(["resume", "list", id]);
    const row = list.versions.find((r) => r.version === v);
    if (!row || !row.has_pdf) return new Response("Not found", { status: 404 });
    const file = path.join(path.dirname(config.jobOsPy), "applications", id, `v${v}`, "resume.pdf");
    const bytes = await readFile(file);
    const name = row.upload_filename || `${id}-v${v}.pdf`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${id}-v${v}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof JobOSError) return errorResponse(e);
    // Filesystem errors carry absolute server paths: log them here, never send them to the browser.
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return new Response("Not found", { status: 404 });
    console.error("[resume-pdf]", code ?? "", e instanceof Error ? e.message : e);
    return new Response("Couldn't read the PDF.", { status: 500, headers: { "cache-control": "no-store" } });
  }
}
