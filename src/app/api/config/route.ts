import { connection } from "next/server";
import type { PublicConfig } from "@/lib/shared/schema";
import { getConfig } from "@/server/config";
import { getEngine } from "@/server/engines";
import { NO_STORE } from "@/server/http";

/** GET /api/config — engine capabilities and limits the UI validates against. No secrets. */
export async function GET() {
  await connection(); // environment-dependent: never prerender
  const cfg = getConfig();
  const body: PublicConfig = {
    engine: getEngine().capabilities,
    limits: cfg.limits,
    jobTtlSeconds: cfg.JOB_TTL_MINUTES * 60,
  };
  return Response.json(body, { headers: NO_STORE });
}
