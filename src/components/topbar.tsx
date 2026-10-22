import { connection } from "next/server";
import { CalendarClock, Database, ShieldAlert } from "lucide-react";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { getLatestRun } from "@/lib/server/queries";
import { listSnapshots } from "@/lib/server/runs";
import { fmtDate, fmtDateTime, fmtWeekRange } from "@/lib/format";
import { latestCompleteWeek } from "@/lib/weeks";
import { RunPlanningButton } from "./run-button";

/** Data freshness + primary action. Rendered on every page inside Suspense. */
export async function TopBarStatus() {
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
        <Database className="size-3.5" aria-hidden /> Database not configured
      </span>
    );
  }
  let data: { snaps: Awaited<ReturnType<typeof listSnapshots>>; run: Awaited<ReturnType<typeof getLatestRun>> } | null = null;
  try {
    const db = getDb();
    const [snaps, run] = await Promise.all([listSnapshots(db), getLatestRun(db)]);
    data = { snaps, run };
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-critical">
        <Database className="size-3.5" aria-hidden /> Database unreachable
      </span>
    );
  }
  {
    const { snaps, run } = data;
    const snap = snaps[0];
    const salesWeek = snap ? latestCompleteWeek(snap.asOfDate) : null;
    return (
      <div className="flex w-full flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5 text-ink-3" aria-hidden />
            Inventory as of <strong className="font-semibold text-ink-1">{snap ? fmtDate(snap.asOfDate) : "—"}</strong>
          </span>
          {salesWeek ? (
            <span>
              Sales window ends <strong className="font-semibold text-ink-1">{salesWeek.slice(5)}</strong> <span className="text-ink-3">({fmtWeekRange(salesWeek)})</span>
            </span>
          ) : null}
          <span>
            Last run: {run ? <strong className="font-semibold text-ink-1">#{run.id} · {fmtDateTime(run.createdAt)}</strong> : <span className="text-ink-3">none yet</span>}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/[0.07] px-2 py-0.5 text-[0.6875rem] text-[#ffe2a6]" title="No authentication is configured. Reviewer names are self-declared and not verified.">
            <ShieldAlert className="size-3 text-warning" aria-hidden /> Prototype review mode · no sign-in
          </span>
        </div>
        <RunPlanningButton snapshots={snaps.map((s) => ({ asOfDate: s.asOfDate, location: s.location }))} />
      </div>
    );
  }
}
