import { Chat } from "@/components/chat";
import { JOB_ID_RE } from "@/lib/jobos";

export const dynamic = "force-dynamic";

export default async function HermesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const job = typeof sp.job === "string" && JOB_ID_RE.test(sp.job) ? sp.job : undefined;
  const prompt = typeof sp.prompt === "string" ? sp.prompt.slice(0, 4000) : undefined;
  return (
    <>
      <h1>Hermes</h1>
      <Chat key={job ?? "general"} conversation={job ? `job-os:${job}` : "job-os"} job={job} initialPrompt={prompt} />
    </>
  );
}
