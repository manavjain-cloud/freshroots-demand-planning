import { NextResponse } from "next/server";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { aiStatus } from "@/lib/server/ai";
import { getZohoStatus } from "@/lib/integrations/zoho";
import { getLatestZohoSyncs } from "@/lib/server/zoho-sync";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  let zohoLastSync: { id: number; status: string; finishedAt: string | null } | null = null;
  if (isDatabaseConfigured()) {
    try {
      await getDb().query("SELECT 1");
      database = "ok";
      try {
        const z = await getLatestZohoSyncs(getDb());
        zohoLastSync = z.latest ? { id: z.latest.id, status: z.latest.status, finishedAt: z.latest.finishedAt } : null;
      } catch {
        zohoLastSync = null;
      }
    } catch {
      database = "error";
    }
  }
  const ai = aiStatus();
  return NextResponse.json(
    { database, ai: { configured: ai.configured, provider: ai.provider, model: ai.model }, zoho: { state: getZohoStatus().state, readOnly: true, lastSync: zohoLastSync }, time: new Date().toISOString() },
    { status: database === "error" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
