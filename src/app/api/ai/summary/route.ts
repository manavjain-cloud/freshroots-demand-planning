import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { summariseRunWithAi, getStoredAi } from "@/lib/server/ai";
import { clientIp, noStore, readJson } from "@/lib/server/http";

const Body = z.object({ runId: z.number().int().positive(), refresh: z.boolean().optional(), cachedOnly: z.boolean().optional() });

export async function POST(req: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ status: "unavailable", reason: "no_database", message: "Database not configured." }, { status: 503, headers: noStore });
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ status: "unavailable", reason: "bad_request", message: "Invalid request." }, { status: 400, headers: noStore });
  const db = getDb();
  try {
    if (parsed.data.cachedOnly) {
      const cached = await getStoredAi(db, "run_summary", parsed.data.runId);
      return NextResponse.json(cached ? { status: "ok", cached: true, data: cached } : { status: "none" }, { headers: noStore });
    }
    const out = await summariseRunWithAi(db, parsed.data.runId, { refresh: parsed.data.refresh, ip: clientIp(req) });
    return NextResponse.json(out, { status: out.status === "ok" ? 200 : out.reason === "rate_limited" ? 429 : out.reason === "not_found" ? 404 : 503, headers: noStore });
  } catch {
    return NextResponse.json({ status: "unavailable", reason: "error", message: "AI explanations are temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
