import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Download } from "lucide-react";
import { Notice, PageHeader, PageSkeleton } from "@/components/ui";
import { DbMissing, NoRunYet } from "@/components/states";
import { PlanningTable } from "@/components/planning-table";
import { dbOrNull } from "@/lib/server/page";
import { getLatestRun, getRunRecommendations } from "@/lib/server/queries";
import { toPlanRow } from "@/lib/server/rows";
import { fmtDate, fmtDateTime, fmtMonth } from "@/lib/format";

export const metadata: Metadata = { title: "Demand Planning" };

export default function PlanningPage(props: PageProps<"/planning">) {
  return (
    <>
      <PageHeader
        eyebrow="Demand Planning"
        title="Demand planning table"
        description="Every SKU from the latest run with its sales windows, stock coverage, classification and recommendation. Select a SKU to see the full calculation."
        actions={
          <a href="/api/export/recommendations" className="rn-btn rn-btn-ghost" download>
            <Download className="size-4" aria-hidden /> Full CSV
          </a>
        }
      />
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <PlanningData searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function PlanningData({ searchParams }: { searchParams: PageProps<"/planning">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const run = await getLatestRun(db);
  if (!run) return <NoRunYet />;
  const rows = await getRunRecommendations(db, run.id);
  const risk = typeof sp.risk === "string" ? sp.risk : "";
  return (
    <div className="space-y-4">
      <Notice title={`Run #${run.id} · ${fmtDateTime(run.createdAt)}`}>
        Inventory as of {fmtDate(run.asOfDate)} ({run.location}). 4-week window {run.recentWeeks[0]}–{run.windowEndWeek}; 12-week window {run.baselineWeeks[0]}–{run.windowEndWeek}.{" "}
        {run.isFestivalMonth ? `${fmtMonth(run.planningMonth)} is a festival month: weeks of stock use demand × ${1 + run.config.festivalUpliftPct / 100}.` : `${fmtMonth(run.planningMonth)} is not a festival month.`}{" "}
        Weeks of stock use the {run.config.coverageDemandBasis === "baseline_avg" ? "12-week" : "4-week"} average.
      </Notice>
      <PlanningTable rows={rows.map(toPlanRow)} initialRisk={risk} runId={run.id} />
    </div>
  );
}
