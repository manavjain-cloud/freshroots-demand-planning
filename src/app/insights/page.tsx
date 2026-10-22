import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CheckCircle2, Clock, Download, PencilLine, XCircle } from "lucide-react";
import { Card, KpiCard, Notice, PageHeader, PageSkeleton, Unavailable } from "@/components/ui";
import { RiskPill } from "@/components/pills";
import { DbMissing } from "@/components/states";
import { CategoryTrendChart, ForecastVsActualChart } from "@/components/charts";
import { dbOrNull } from "@/lib/server/page";
import { getBacktests, getDataHealth, getLatestRun, getReviewStats, getRunRecommendations, getWeeklyTotals, listRuns, listSkuOptions, weekShortLabel } from "@/lib/server/queries";
import { REPORTS } from "@/lib/server/exports";
import { BASELINE, BASELINE_RECORDED_ON, BASELINE_SOURCE } from "@/lib/governance";
import { RISK_LABEL, type InventoryRisk } from "@/lib/rules/engine";
import { formatIsoDate, isoWeekStart } from "@/lib/weeks";
import { fmtDate, fmtDateTime, fmtNum, fmtPct } from "@/lib/format";

export const metadata: Metadata = { title: "Insights & Reports" };

export default function InsightsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insights & Reports"
        title="Insights and reports"
        description="Demand trends, a clearly labelled baseline-method evaluation, stock-risk summaries and review outcomes. No savings, ROI or forecast-accuracy claims are made for the pilot recommendations."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <InsightsData />
      </Suspense>
    </>
  );
}

async function InsightsData() {
  await connection();
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const [run, weekly, backtests, health, runs, skus, allStats] = await Promise.all([
    getLatestRun(db),
    getWeeklyTotals(db),
    getBacktests(db),
    getDataHealth(db),
    listRuns(db, 10),
    listSkuOptions(db),
    getReviewStats(db, null),
  ]);
  const stats = run ? await getReviewStats(db, run.id) : null;
  const recs = run ? await getRunRecommendations(db, run.id) : [];
  const skuName = new Map(skus.map((s) => [s.skuId, s.skuName]));
  const [ma4, ma12] = backtests;
  const label = (w: string) => weekShortLabel(w, formatIsoDate(isoWeekStart(w)));
  const series = ma4.perSku.map((s) => ({ skuId: s.skuId, skuName: skuName.get(s.skuId) ?? s.skuId, wape: s.wape, points: s.points.map((p) => ({ week: p.week, label: label(p.week), actual: p.actual, forecast: p.forecast })) }));
  const riskGroups = (["stockout_risk", "perishable_below_min", "overstock_risk", "perishable_above_max", "no_recent_demand", "insufficient_data", "within_range"] as InventoryRisk[])
    .map((risk) => ({ risk, rows: recs.filter((r) => r.inventoryRisk === risk) }))
    .filter((g) => g.rows.length);
  const issues = health.checks.filter((c) => c.status === "warn" || c.status === "fail");

  return (
    <div className="space-y-6">
      <section aria-labelledby="review-outcomes">
        <h2 id="review-outcomes" className="mb-3 text-base font-semibold text-ink-1">
          Recommendation review outcomes {stats ? <span className="text-sm font-normal text-ink-3">· {stats.scope}</span> : null}
        </h2>
        {stats ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Approval rate" value={stats.approvalRate === null ? <Unavailable label="No reviews yet" /> : fmtPct(stats.approvalRate)} icon={CheckCircle2} tone="good" hint={`${stats.approved} approved of ${stats.reviewed} reviewed`} />
            <KpiCard label="Edit rate" value={stats.editRate === null ? <Unavailable label="No reviews yet" /> : fmtPct(stats.editRate)} icon={PencilLine} tone="info" hint={`${stats.edited} edited`} />
            <KpiCard label="Rejection rate" value={stats.rejectionRate === null ? <Unavailable label="No reviews yet" /> : fmtPct(stats.rejectionRate)} icon={XCircle} tone="critical" hint={`${stats.rejected} rejected · ${stats.pending} still pending`} />
            <KpiCard
              label="Median time to review"
              value={stats.medianHoursToReview === null ? <Unavailable label="No reviews yet" /> : `${fmtNum(stats.medianHoursToReview, 1)} h`}
              icon={Clock}
              hint="From run calculation to the planner's decision"
            />
          </div>
        ) : (
          <Unavailable label="No runs yet" />
        )}
        <p className="mt-2 text-xs text-ink-3">
          All runs: {allStats.reviewed} reviewed ({allStats.approved} approved, {allStats.edited} edited, {allStats.rejected} rejected). Rates are pilot process measures, not accuracy.
        </p>
      </section>

      <Card title="Weekly demand trend by category" description={`Total units sold per ISO week across all SKUs (${weekly[0]?.week ?? "—"} to ${weekly[weekly.length - 1]?.week ?? "—"})`}>
        {weekly.length ? <CategoryTrendChart data={weekly.map((w) => ({ ...w, label: label(w.week) }))} /> : <Unavailable label="No sales data" />}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="Baseline method evaluation (forecast vs actual)"
          description="A separate, one-week-ahead moving-average baseline evaluated against actual sales. It is not the planner's rules and is not used for recommendations."
        >
          <ForecastVsActualChart series={series} />
        </Card>
        <Card title="Evaluation summary" description="Weighted absolute percentage error (WAPE) and bias over all evaluable SKU-weeks">
          <table className="rn-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="text-right">SKU-weeks</th>
                <th className="text-right">WAPE</th>
                <th className="text-right">Bias</th>
              </tr>
            </thead>
            <tbody>
              {[ma4, ma12].map((b) => (
                <tr key={b.method}>
                  <td>
                    {b.windowWeeks}-week moving average
                    <div className="text-xs text-ink-3">
                      weeks {b.overall.evaluatedWeeks[0] ?? "—"}–{b.overall.evaluatedWeeks[b.overall.evaluatedWeeks.length - 1] ?? "—"}
                    </div>
                  </td>
                  <td className="tabular text-right">{b.overall.n}</td>
                  <td className="tabular text-right">{b.overall.wape === null ? "—" : fmtPct(b.overall.wape, 1)}</td>
                  <td className="tabular text-right">{b.overall.bias === null ? "—" : fmtPct(b.overall.bias, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-2">
            <Notice>
              Only {health.counts.salesRows / Math.max(health.counts.skus, 1)} weeks of history per SKU exist, so the 12-week baseline can be evaluated on only {ma12.overall.evaluatedWeeks.length} weeks. Seasonality across years cannot be assessed.
            </Notice>
            <Notice tone="warning" title="Pilot recommendations are not yet evaluated">
              Accuracy of the rule-based recommendations needs post-pilot sales, stockout and write-off actuals, which are not available yet.
            </Notice>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Stock-risk summary" description={run ? `Run #${run.id} · inventory as of ${fmtDate(run.asOfDate)}` : "No run yet"}>
          {riskGroups.length ? (
            <ul className="space-y-3">
              {riskGroups.map((g) => (
                <li key={g.risk} className="rounded-lg border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <RiskPill value={g.risk} />
                    <span className="tabular text-sm font-semibold text-ink-1">{g.rows.length} SKU{g.rows.length > 1 ? "s" : ""}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                    {g.rows.map((r, i) => (
                      <span key={r.id}>
                        {i ? ", " : ""}
                        <Link href={`/skus/${r.skuId}`} className="underline-offset-2 hover:underline">
                          {r.skuId}
                        </Link>{" "}
                        ({r.weeksOfStock === null ? "n/a" : `${fmtNum(r.weeksOfStock, 1)} wks`})
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable label="No run yet" />
          )}
          <p className="mt-3 text-xs text-ink-3">{RISK_LABEL.stockout_risk} and overstock flags are projections; confirmed stockout events are not available.</p>
        </Card>

        <Card title="Data quality warnings" description={`${health.checks.length} checks · today ${fmtDate(health.today)}`}>
          {issues.length ? (
            <ul className="space-y-2">
              {issues.map((c) => (
                <li key={c.id}>
                  <Notice tone={c.status === "fail" ? "critical" : "warning"} title={c.label}>
                    {c.detail}
                  </Notice>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No data-quality warnings. See Data Imports for the full checklist.</p>
          )}
        </Card>
      </div>

      <Card title="Pilot baseline (from the case)" description={`Source: ${BASELINE_SOURCE}. Recorded ${fmtDate(BASELINE_RECORDED_ON)}. These are the starting point for measurement, not results of this tool.`}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pilot baseline table, scrollable">
          <table className="rn-table">
            <thead>
              <tr>
                <th>Baseline metric</th>
                <th>Value</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {BASELINE.map((b) => (
                <tr key={b.metric}>
                  <td className="text-ink-1">{b.metric}</td>
                  <td className="tabular whitespace-nowrap font-medium text-ink-1">{b.value}</td>
                  <td className="text-xs text-ink-3">{b.note}</td>
                </tr>
              ))}
              <tr>
                <td className="text-ink-1">Savings / ROI from this tool</td>
                <td>
                  <Unavailable />
                </td>
                <td className="text-xs text-ink-3">Not claimed. Requires pilot actuals and agreed measurement.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Downloadable reports" description="CSV files generated from the database at the time of download">
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.entries(REPORTS).map(([key, r]) => (
              <li key={key}>
                <a href={`/api/export/${key}`} download className="rn-btn rn-btn-ghost w-full justify-start">
                  <Download className="size-4 text-accent" aria-hidden /> {r.label}
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Run history" description="Each run stores its inputs hash, configuration and engine version">
          {runs.length ? (
            <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label="Run history, scrollable">
              <table className="rn-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Calculated</th>
                    <th>Snapshot</th>
                    <th className="text-right">Reviewed</th>
                    <th className="text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>
                        #{r.id}
                        <div className="text-[0.6875rem] text-ink-3">v{r.engineVersion} · cfg {r.configId ?? "default"}</div>
                      </td>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</td>
                      <td className="text-xs">{fmtDate(r.asOfDate)}</td>
                      <td className="tabular text-right">{r.reviewed}</td>
                      <td className="tabular text-right">{r.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Unavailable label="No runs yet" />
          )}
        </Card>
      </div>
    </div>
  );
}
