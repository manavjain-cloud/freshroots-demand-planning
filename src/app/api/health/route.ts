import { NextResponse } from "next/server";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { aiStatus } from "@/lib/server/ai";
import { getZohoStatus } from "@/lib/integrations/zoho";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  if (isDatabaseConfigured()) {
    try {
      await getDb().query("SELECT 1");
      database = "ok";
    } catch {
      database = "error";
    }
  }
  const ai = aiStatus();
  return NextResponse.json(
    { database, ai: { configured: ai.configured, provider: ai.provider, model: ai.model }, zoho: getZohoStatus().state, time: new Date().toISOString() },
    { status: database === "error" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
