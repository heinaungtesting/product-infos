import { config } from "@/lib/config";
import { hermesHealth } from "@/lib/hermes";
import { json } from "@/lib/http";

export async function GET() {
  return json({ ...(await hermesHealth()), stopCancels: config.hermes.stopCancels });
}
