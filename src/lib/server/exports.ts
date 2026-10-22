import type { Queryable } from "../db/client";
import { round, toCsv, type CsvColumn } from "../csv";
import { ACTION_LABEL, DEMAND_LABEL, EXCEPTION_INFO, RISK_LABEL } from "../rules/engine";
import { getZohoSupplyBySku, type ZohoSkuSupply } from "./zoho-sync";
import { getBacktests, getDataHealth, getLatestRun, getRun, getRunRecommendations, getWeeklyTotals, type RecRow, type RunHeader } from "./queries";

export const REPORTS = {
  recommendations: { label: "Recommendations (latest run)", file: "recommendations" },
  "review-log": { label: "Review decision log", file: "review-log" },
  backtest: { label: "Baseline method evaluation", file: "baseline-evaluation" },
  "data-quality": { label: "Data quality checks", file: "data-quality" },
  "weekly-sales": { label: "Weekly sales by category", file: "weekly-sales-by-category" },
} as const;
export type ReportKey = keyof typeof REPORTS;

export function recommendationColumns(run: RunHeader, supply: Map<string, ZohoSkuSupply> | null = null): CsvColumn<RecRow>[] {
  return [
    { header: "Run_ID", value: (r) => r.runId },
    { header: "Inventory_As_Of", value: () => run.asOfDate },
    { header: "Location", value: () => run.location },
    { header: "SKU_ID", value: (r) => r.skuId },
    { header: "SKU_Name", value: (r) => r.skuName },
    { header: "Category", value: (r) => r.category },
    { header: "Perishability", value: (r) => r.perishability },
    { header: "Distributor_ID", value: (r) => r.distributorId },
    { header: "Distributor_Name", value: (r) => r.distributorName },
    { header: "Region", value: (r) => r.region },
    { header: "Latest_Week_Units", value: (r) => r.latestWeekUnits },
    { header: "Avg_4wk", value: (r) => round(r.recentAvg, 2) },
    { header: "Avg_12wk", value: (r) => round(r.baselineAvg, 2) },
    { header: "Festival_Factor", value: (r) => r.metrics.festivalFactor },
    { header: "Forward_Demand_Per_Week", value: (r) => round(r.forwardDemand, 2) },
    { header: "Current_Stock", value: (r) => r.currentStock },
    { header: "On_Order_Zoho", value: (r) => (supply ? (supply.get(r.skuId)?.onOrder ?? null) : null) },
    { header: "Observed_Lead_Time_Days_Zoho", value: (r) => (supply ? (supply.get(r.skuId)?.leadTime?.median ?? null) : null) },
    { header: "Weeks_Of_Stock", value: (r) => round(r.weeksOfStock, 2) },
    { header: "Min_Weeks", value: (r) => r.metrics.minWeeks },
    { header: "Max_Weeks", value: (r) => r.metrics.maxWeeks },
    { header: "Demand_Class", value: (r) => DEMAND_LABEL[r.demandClass] },
    { header: "Inventory_Risk", value: (r) => RISK_LABEL[r.inventoryRisk] },
    { header: "Action", value: (r) => ACTION_LABEL[r.action] },
    { header: "Calculated_Qty_Raw", value: (r) => r.recommendedQtyRaw },
    { header: "Calculated_Qty", value: (r) => r.recommendedQty },
    { header: "Review_Status", value: (r) => r.reviewStatus },
    { header: "Final_Qty", value: (r) => r.finalQty },
    { header: "Exceptions", value: (r) => r.exceptionCodes.map((c) => EXCEPTION_INFO[c]?.label ?? c).join("; ") },
    { header: "Reason", value: (r) => r.reason },
    { header: "Last_Decision_Reason", value: (r) => r.lastDecision?.reason ?? null },
    { header: "Last_Decision_Note", value: (r) => r.lastDecision?.note ?? null },
    { header: "Reviewed_At", value: (r) => r.reviewedAt },
    { header: "Reviewer_Self_Declared", value: (r) => r.lastDecision?.reviewerName ?? null },
  ];
}

export async function buildReport(q: Queryable, report: ReportKey, opts: { runId?: number } = {}): Promise<{ filename: string; csv: string } | null> {
  const stamp = new Date().toISOString().slice(0, 10);
  switch (report) {
    case "recommendations": {
      const run = opts.runId ? await getRun(q, opts.runId) : await getLatestRun(q);
      if (!run) return null;
      const rows = await getRunRecommendations(q, run.id);
      const zoho = await getZohoSupplyBySku(q);
      return { filename: `freshroots-recommendations-run${run.id}-${stamp}.csv`, csv: toCsv(recommendationColumns(run, zoho.sync ? zoho.bySku : null), rows) };
    }
    case "review-log": {
      const r = await q.query<{ id: number; created_at: Date; run_id: number; sku_id: string; decision: string; calculated_qty: number | null; final_qty: number | null; reason: string | null; note: string | null; reviewer_name: string | null; identity_verified: boolean }>(
        `SELECT d.id::int AS id, d.created_at, s.run_id::int AS run_id, s.sku_id, d.decision, d.calculated_qty, d.final_qty, d.reason, d.note, d.reviewer_name, d.identity_verified
         FROM review_decisions d JOIN sku_recommendations s ON s.id = d.recommendation_id ORDER BY d.id`,
      );
      type Row = (typeof r.rows)[number];
      const cols: CsvColumn<Row>[] = [
        { header: "Decision_ID", value: (x) => x.id },
        { header: "Timestamp_UTC", value: (x) => new Date(x.created_at).toISOString() },
        { header: "Run_ID", value: (x) => x.run_id },
        { header: "SKU_ID", value: (x) => x.sku_id },
        { header: "Decision", value: (x) => x.decision },
        { header: "Calculated_Qty", value: (x) => x.calculated_qty },
        { header: "Final_Qty", value: (x) => x.final_qty },
        { header: "Reason", value: (x) => x.reason },
        { header: "Note", value: (x) => x.note },
        { header: "Reviewer_Self_Declared", value: (x) => x.reviewer_name },
        { header: "Identity_Verified", value: (x) => x.identity_verified },
      ];
      return { filename: `freshroots-review-log-${stamp}.csv`, csv: toCsv(cols, r.rows) };
    }
    case "backtest": {
      const results = await getBacktests(q);
      const rows = results.flatMap((b) => b.perSku.flatMap((s) => s.points.map((p) => ({ method: b.method, skuId: s.skuId, ...p }))));
      const cols: CsvColumn<(typeof rows)[number]>[] = [
        { header: "Method", value: (x) => x.method },
        { header: "SKU_ID", value: (x) => x.skuId },
        { header: "Week", value: (x) => x.week },
        { header: "Actual_Units", value: (x) => x.actual },
        { header: "Baseline_Estimate", value: (x) => round(x.forecast, 2) },
        { header: "Abs_Error", value: (x) => round(x.absError, 2) },
      ];
      return { filename: `freshroots-baseline-evaluation-${stamp}.csv`, csv: toCsv(cols, rows) };
    }
    case "data-quality": {
      const h = await getDataHealth(q);
      const cols: CsvColumn<(typeof h.checks)[number]>[] = [
        { header: "Check", value: (x) => x.label },
        { header: "Status", value: (x) => x.status },
        { header: "Detail", value: (x) => x.detail },
      ];
      return { filename: `freshroots-data-quality-${stamp}.csv`, csv: toCsv(cols, h.checks) };
    }
    case "weekly-sales": {
      const rows = await getWeeklyTotals(q);
      const cols: CsvColumn<(typeof rows)[number]>[] = [
        { header: "Week", value: (x) => x.week },
        { header: "Week_Start", value: (x) => x.weekStart },
        { header: "Category", value: (x) => x.category },
        { header: "Units_Sold", value: (x) => x.units },
      ];
      return { filename: `freshroots-weekly-sales-by-category-${stamp}.csv`, csv: toCsv(cols, rows) };
    }
  }
}
