import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { buildReport, REPORTS, type ReportKey } from "@/lib/server/exports";

export async function GET(req: Request, ctx: RouteContext<"/api/export/[report]">) {
  const { report } = await ctx.params;
  if (!(report in REPORTS)) return new Response("Unknown report", { status: 404 });
  if (!isDatabaseConfigured()) return new Response("Database not configured", { status: 503 });
  const runParam = new URL(req.url).searchParams.get("runId");
  const runId = runParam && /^\d+$/.test(runParam) ? Number(runParam) : undefined;
  try {
    const out = await buildReport(getDb(), report as ReportKey, { runId });
    if (!out) return new Response("No data available for this report yet.", { status: 404 });
    return new Response("﻿" + out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("The report could not be generated.", { status: 500 });
  }
}
