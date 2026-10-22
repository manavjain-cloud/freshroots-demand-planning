import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Archive, ArrowRight, CalendarClock, ClipboardCheck, Database, FileWarning, Layers, ShieldCheck, PartyPopper, TrendingUp, TriangleAlert } from "lucide-react";
import { Card, KpiCard, Notice, PageHeader, PageSkeleton, Unavailable } from "@/components/ui";
import { ActionPill, DemandPill, ExceptionPill, ReviewPill, RiskPill } from "@/components/pills";
import { DbMissing, NoRunYet } from "@/components/states";
import { AiSummaryPanel } from "@/components/ai-panels";
import { byPriority, dbOrNull } from "@/lib/server/page";
import { getDataHealth, getLatestRun, getRunRecommendations } from "@/lib/server/queries";
import { buildEngineInputs } from "@/lib/server/runs";
import { fmtDate, fmtDateTime, fmtMonth, fmtNum } from "@/lib/format";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Demand planning overview"
        description="Rule-based demand classifications, stock-risk flags and reorder recommendations from the latest run. Every number traces back to the imported data and the documented rules; nothing is ordered automatically."
      />
      <Suspense fallback={<PageSkeleton />}>
        <OverviewData />
      </Suspense>
    </>
  );
}

async function OverviewData() {
  await connection();
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const [run, health] = await Promise.all([getLatestRun(db), getDataHealth(db)]);
  const checkCounts = { pass: 0, warn: 0, fail: 0, info: 0 };
  health.checks.forEach((c) => checkCounts[c.status]++);

  if (!run) {
    return (
      <div className="space-y-4">
        <NoRunYet />
        <DataQualityCard health={health} counts={checkCounts} />
      </div>
    );
  }

  const rows = await getRunRecommendations(db, run.id);
  const bundle = await buildEngineInputs(db, { asOfDate: run.asOfDate, location: run.location });
  const stale = !!bundle && bundle.inputHash !== run.inputHash;
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const pending = n((r) => r.reviewStatus === "pending");
  const attention = rows.filter((r) => r.reviewStatus === "pending").sort(byPriority);
  const exceptions = n((r) => r.exceptionCodes.length > 0);

  return (
    <div className="space-y-6">
      {stale ? (
        <Notice tone="warning" title="Data or rules changed since this run">
          Imported data or the active rule configuration differs from what run #{run.id} used. <strong>Run demand planning</strong> again to refresh recommendations.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="SKUs loaded" value={fmtNum(health.counts.skus)} icon={Layers} hint={`${fmtNum(health.counts.distributors)} distributors · pilot sample (case: 400 SKUs, 1,200 distributors)`} href="/skus" />
        <KpiCard label="High demand" value={fmtNum(run.summary.highDemand)} icon={TrendingUp} tone="warning" hint={`4-week avg > ${run.config.highDemandThresholdPct}% above 12-week avg`} href="/planning?risk=high_demand" />
        <KpiCard label="Stockout risk" value={fmtNum(run.summary.stockoutRisk + run.summary.perishableBelowMin)} icon={TriangleAlert} tone="critical" hint={`${run.summary.stockoutRisk} below ${run.config.stockoutMinWeeks} wks · ${run.summary.perishableBelowMin} perishable below ${run.config.perishableMinWeeks} wks`} href="/planning?risk=below_min" />
        <KpiCard label="Overstock risk" value={fmtNum(run.summary.overstockRisk + run.summary.perishableAboveMax)} icon={Archive} tone="serious" hint={`${run.summary.overstockRisk} above ${run.config.overstockMaxWeeks} wks · ${run.summary.perishableAboveMax} perishable above ${run.config.perishableMaxWeeks} wks`} href="/planning?risk=above_max" />
        <KpiCard label="Awaiting review" value={fmtNum(pending)} icon={ClipboardCheck} tone={pending ? "accent" : "good"} hint={`${exceptions} with exceptions · ${n((r) => r.reviewStatus === "not_required")} need no action`} href="/recommendations" />
        <KpiCard label="Latest inventory snapshot" value={<span className="text-xl">{fmtDate(run.asOfDate)}</span>} icon={CalendarClock} hint={`${run.location} · ${health.snapshotAgeDays ?? "?"} day(s) old`} />
        <KpiCard
          label="Festival month"
          value={<span className="text-xl">{run.isFestivalMonth === null ? "Unknown" : run.isFestivalMonth ? "Yes" : "No"}</span>}
          icon={PartyPopper}
          tone={run.isFestivalMonth ? "warning" : "neutral"}
          hint={`${fmtMonth(run.planningMonth)}${run.isFestivalMonth ? ` · +${run.config.festivalUpliftPct}% demand uplift applied` : ""}`}
        />
        <KpiCard
          label="Data quality"
          value={<span className="text-xl">{checkCounts.fail ? `${checkCounts.fail} failing` : checkCounts.warn ? `${checkCounts.warn} warning${checkCounts.warn > 1 ? "s" : ""}` : "All checks pass"}</span>}
          icon={checkCounts.fail || checkCounts.warn ? FileWarning : ShieldCheck}
          tone={checkCounts.fail ? "critical" : checkCounts.warn ? "warning" : "good"}
          hint={`${checkCounts.pass} passing checks · sales through ${health.latestSalesWeek ?? "—"}`}
          href="/imports"
        />
      </div>

      <Notice title="Risk flags are projections, not confirmed events">
        A stockout or overstock <em>risk</em> means current stock falls outside the rule window at the projected demand rate. Confirmed stockouts and write-offs are{" "}
        <strong>not available</strong> — no stockout events, open purchase orders or supplier lead times were supplied.
      </Notice>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card
          title="Needs your review"
          description={`Run #${run.id} · ${fmtDateTime(run.createdAt)} · most urgent first`}
          actions={
            <Link href="/recommendations" className="rn-btn rn-btn-ghost py-1.5 text-xs">
              Open review queue <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {attention.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing is waiting for review in this run.</p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/recommendations?rec=${r.id}`} className="font-medium text-ink-1 underline-offset-2 hover:underline">
                      {r.skuName}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {r.skuId} · {r.category} · {r.weeksOfStock === null ? "cover not calculable" : `${fmtNum(r.weeksOfStock, 1)} wks of stock`}
                    </p>
                    {r.exceptionCodes.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.exceptionCodes.map((c) => (
                          <ExceptionPill key={c} code={c} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                    {r.demandClass === "high_demand" ? <DemandPill value={r.demandClass} /> : null}
                    <RiskPill value={r.inventoryRisk} />
                    <ActionPill value={r.action} />
                    <span className="tabular w-20 text-right text-sm font-semibold text-ink-1">
                      {r.recommendedQty === null ? <Unavailable label="Set qty" reason="No rule-defined quantity" /> : `${fmtNum(r.recommendedQty)} u`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {attention.length > 8 ? <p className="mt-2 text-xs text-ink-3">+{attention.length - 8} more in the review queue.</p> : null}
        </Card>

        <div className="space-y-6">
          <AiSummaryPanel runId={run.id} />
          <Card title="Review progress" description={`Run #${run.id}`}>
            <div className="flex flex-wrap gap-2">
              {(["pending", "approved", "edited", "rejected", "not_required"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <ReviewPill value={s} /> <span className="tabular text-sm font-semibold text-ink-1">{n((r) => r.reviewStatus === s)}</span>
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <DataQualityCard health={health} counts={checkCounts} />
    </div>
  );
}

function DataQualityCard({ health, counts }: { health: Awaited<ReturnType<typeof getDataHealth>>; counts: Record<string, number> }) {
  const issues = health.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <Card
      title="Data freshness and quality"
      description={`Today ${fmtDate(health.today)} (IST) · ${counts.pass} checks passing`}
      actions={
        <Link href="/imports" className="rn-btn rn-btn-ghost py-1.5 text-xs">
          <Database className="size-3.5" aria-hidden /> Data imports
        </Link>
      }
    >
      {issues.length === 0 ? (
        <p className="text-sm text-ink-2">All data checks pass. Sales run through {health.latestSalesWeek ?? "—"}; inventory snapshot {fmtDate(health.latestSnapshot?.asOfDate)}.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((c) => (
            <li key={c.id}>
              <Notice tone={c.status === "fail" ? "critical" : "warning"} title={c.label}>
                {c.detail}
              </Notice>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
