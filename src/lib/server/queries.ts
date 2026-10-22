import type { Queryable } from "../db/client";
import type { RuleConfig } from "../rules/config";
import type { DemandClass, ExceptionCode, ExplanationStep, InventoryRisk, RecommendationAction, SkuMetrics } from "../rules/engine";
import { DATASETS, DATASET_INFO, type Dataset } from "../imports/validate";
import { backtestMovingAverage, type BacktestResult } from "../analytics/backtest";
import { compareIsoWeeks, daysBetween, latestCompleteWeek, todayInIndia, weekWindow } from "../weeks";
import { buildEngineInputs } from "./runs";
import { getLatestZohoSyncs } from "./zoho-sync";
import { getZohoStatus } from "../integrations/zoho";

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/* ------------------------------ runs ------------------------------ */

export interface RunHeader {
  id: number;
  createdAt: string;
  triggeredBy: string;
  engineVersion: string;
  configId: number | null;
  config: RuleConfig;
  asOfDate: string;
  location: string;
  windowEndWeek: string;
  recentWeeks: string[];
  baselineWeeks: string[];
  planningMonth: string;
  isFestivalMonth: boolean | null;
  inputHash: string;
  skuCount: number;
  summary: Record<string, number>;
}

const RUN_COLS = `id::int AS id, created_at, triggered_by, engine_version, config_id::int AS config_id, config, as_of_date::text AS as_of_date, location,
  window_end_week, recent_weeks, baseline_weeks, planning_month, is_festival_month, input_hash, sku_count, summary`;

type RunDbRow = {
  id: number; created_at: Date; triggered_by: string; engine_version: string; config_id: number | null; config: RuleConfig; as_of_date: string; location: string;
  window_end_week: string; recent_weeks: string[]; baseline_weeks: string[]; planning_month: string; is_festival_month: boolean | null; input_hash: string;
  sku_count: number; summary: Record<string, number>;
};

function mapRun(r: RunDbRow): RunHeader {
  return {
    id: r.id, createdAt: iso(r.created_at)!, triggeredBy: r.triggered_by, engineVersion: r.engine_version, configId: r.config_id, config: r.config,
    asOfDate: r.as_of_date, location: r.location, windowEndWeek: r.window_end_week, recentWeeks: r.recent_weeks, baselineWeeks: r.baseline_weeks,
    planningMonth: r.planning_month, isFestivalMonth: r.is_festival_month, inputHash: r.input_hash, skuCount: r.sku_count, summary: r.summary,
  };
}

export async function getLatestRun(q: Queryable): Promise<RunHeader | null> {
  const r = await q.query<RunDbRow>(`SELECT ${RUN_COLS} FROM recommendation_runs ORDER BY id DESC LIMIT 1`);
  return r.rows[0] ? mapRun(r.rows[0]) : null;
}

export async function getRun(q: Queryable, id: number): Promise<RunHeader | null> {
  const r = await q.query<RunDbRow>(`SELECT ${RUN_COLS} FROM recommendation_runs WHERE id = $1`, [id]);
  return r.rows[0] ? mapRun(r.rows[0]) : null;
}

export async function listRuns(q: Queryable, limit = 20): Promise<(RunHeader & { reviewed: number; pending: number })[]> {
  const r = await q.query<RunDbRow & { reviewed: number; pending: number }>(
    `SELECT ${RUN_COLS},
       (SELECT COUNT(*)::int FROM sku_recommendations s WHERE s.run_id = rr.id AND s.review_status IN ('approved','edited','rejected')) AS reviewed,
       (SELECT COUNT(*)::int FROM sku_recommendations s WHERE s.run_id = rr.id AND s.review_status = 'pending') AS pending
     FROM recommendation_runs rr ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({ ...mapRun(x), reviewed: x.reviewed, pending: x.pending }));
}

/* ------------------------------ recommendations ------------------------------ */

export type ReviewStatus = "pending" | "approved" | "edited" | "rejected" | "not_required";

export interface RecRow {
  id: number;
  runId: number;
  skuId: string;
  skuName: string;
  category: string;
  perishability: string;
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string | null;
  distributorName: string | null;
  region: string | null;
  distributorStatus: string | null;
  demandClass: DemandClass;
  inventoryRisk: InventoryRisk;
  action: RecommendationAction;
  recommendedQtyRaw: number | null;
  recommendedQty: number | null;
  requiresReview: boolean;
  exceptionCodes: ExceptionCode[];
  latestWeekUnits: number | null;
  recentAvg: number | null;
  baselineAvg: number | null;
  forwardDemand: number | null;
  currentStock: number | null;
  weeksOfStock: number | null;
  metrics: SkuMetrics;
  reason: string;
  reviewStatus: ReviewStatus;
  finalQty: number | null;
  reviewedAt: string | null;
  lastDecision: DecisionRow | null;
}

export interface DecisionRow {
  id: number;
  recommendationId: number;
  decision: "approved" | "edited" | "rejected" | "note";
  calculatedQty: number | null;
  finalQty: number | null;
  reason: string | null;
  note: string | null;
  reviewerName: string | null;
  identityVerified: boolean;
  createdAt: string;
}

const REC_SELECT = `
  SELECT r.id::int AS id, r.run_id::int AS run_id, r.sku_id, s.sku_name, s.category, s.perishability, s.standard_reorder_qty, s.unit_of_measure,
    s.distributor_id, d.distributor_name, d.region, d.status AS distributor_status,
    r.demand_class, r.inventory_risk, r.action, r.recommended_qty_raw::float8 AS recommended_qty_raw, r.recommended_qty, r.requires_review,
    r.exception_codes, r.latest_week_units, r.recent_avg::float8 AS recent_avg, r.baseline_avg::float8 AS baseline_avg,
    r.forward_demand::float8 AS forward_demand, r.current_stock, r.weeks_of_stock::float8 AS weeks_of_stock, r.metrics, r.reason,
    r.review_status, r.final_qty, r.reviewed_at,
    ld.id::int AS ld_id, ld.decision AS ld_decision, ld.calculated_qty AS ld_calculated_qty, ld.final_qty AS ld_final_qty, ld.reason AS ld_reason,
    ld.note AS ld_note, ld.reviewer_name AS ld_reviewer_name, ld.identity_verified AS ld_identity_verified, ld.created_at AS ld_created_at
  FROM sku_recommendations r
  JOIN skus s ON s.sku_id = r.sku_id
  LEFT JOIN distributors d ON d.distributor_id = s.distributor_id
  LEFT JOIN LATERAL (
    SELECT * FROM review_decisions x WHERE x.recommendation_id = r.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1
  ) ld ON true`;

type RecDbRow = Record<string, unknown>;

function mapRec(x: RecDbRow): RecRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(x.id), runId: Number(x.run_id), skuId: x.sku_id as string, skuName: x.sku_name as string, category: x.category as string,
    perishability: x.perishability as string, standardReorderQty: Number(x.standard_reorder_qty), unitOfMeasure: x.unit_of_measure as string,
    distributorId: (x.distributor_id as string) ?? null, distributorName: (x.distributor_name as string) ?? null, region: (x.region as string) ?? null,
    distributorStatus: (x.distributor_status as string) ?? null,
    demandClass: x.demand_class as DemandClass, inventoryRisk: x.inventory_risk as InventoryRisk, action: x.action as RecommendationAction,
    recommendedQtyRaw: n(x.recommended_qty_raw), recommendedQty: n(x.recommended_qty), requiresReview: !!x.requires_review,
    exceptionCodes: (x.exception_codes as ExceptionCode[]) ?? [], latestWeekUnits: n(x.latest_week_units), recentAvg: n(x.recent_avg),
    baselineAvg: n(x.baseline_avg), forwardDemand: n(x.forward_demand), currentStock: n(x.current_stock), weeksOfStock: n(x.weeks_of_stock),
    metrics: x.metrics as SkuMetrics, reason: x.reason as string, reviewStatus: x.review_status as ReviewStatus, finalQty: n(x.final_qty),
    reviewedAt: iso((x.reviewed_at as Date) ?? null),
    lastDecision: x.ld_id
      ? {
          id: Number(x.ld_id), recommendationId: Number(x.id), decision: x.ld_decision as DecisionRow["decision"], calculatedQty: n(x.ld_calculated_qty),
          finalQty: n(x.ld_final_qty), reason: (x.ld_reason as string) ?? null, note: (x.ld_note as string) ?? null,
          reviewerName: (x.ld_reviewer_name as string) ?? null, identityVerified: !!x.ld_identity_verified, createdAt: iso(x.ld_created_at as Date)!,
        }
      : null,
  };
}

export async function getRunRecommendations(q: Queryable, runId: number): Promise<RecRow[]> {
  const r = await q.query<RecDbRow>(`${REC_SELECT} WHERE r.run_id = $1 ORDER BY r.sku_id`, [runId]);
  return r.rows.map(mapRec);
}

export async function getRecommendation(q: Queryable, id: number): Promise<(RecRow & { steps: ExplanationStep[] }) | null> {
  const r = await q.query<RecDbRow>(`${REC_SELECT} WHERE r.id = $1`, [id]);
  if (!r.rows[0]) return null;
  const steps = await q.query<{ steps: ExplanationStep[] }>("SELECT steps FROM sku_recommendations WHERE id = $1", [id]);
  return { ...mapRec(r.rows[0]), steps: steps.rows[0].steps };
}

export async function getDecisions(q: Queryable, recommendationIds: number[]): Promise<DecisionRow[]> {
  if (!recommendationIds.length) return [];
  const r = await q.query<{
    id: number; recommendation_id: number; decision: DecisionRow["decision"]; calculated_qty: number | null; final_qty: number | null; reason: string | null;
    note: string | null; reviewer_name: string | null; identity_verified: boolean; created_at: Date;
  }>(
    `SELECT id::int AS id, recommendation_id::int AS recommendation_id, decision, calculated_qty, final_qty, reason, note, reviewer_name, identity_verified, created_at
     FROM review_decisions WHERE recommendation_id = ANY($1::bigint[]) ORDER BY created_at DESC, id DESC`,
    [recommendationIds],
  );
  return r.rows.map((x) => ({
    id: x.id, recommendationId: x.recommendation_id, decision: x.decision, calculatedQty: x.calculated_qty, finalQty: x.final_qty, reason: x.reason,
    note: x.note, reviewerName: x.reviewer_name, identityVerified: x.identity_verified, createdAt: iso(x.created_at)!,
  }));
}

/* ------------------------------ SKU detail ------------------------------ */

export interface SkuDetail {
  sku: { skuId: string; skuName: string; category: string; perishability: string; standardReorderQty: number; unitOfMeasure: string; distributorId: string };
  distributor: { distributorId: string; distributorName: string; region: string; status: string } | null;
  sales: { week: string; weekStart: string; units: number }[];
  inventory: { location: string; asOfDate: string; unitsOnHand: number }[];
  history: { id: number; runId: number; runCreatedAt: string; asOfDate: string; demandClass: string; inventoryRisk: string; action: string; recommendedQty: number | null; reviewStatus: string; finalQty: number | null; weeksOfStock: number | null }[];
  latest: (RecRow & { steps: ExplanationStep[] }) | null;
  decisions: DecisionRow[];
}

export async function getSkuDetail(q: Queryable, skuId: string): Promise<SkuDetail | null> {
  const s = await q.query<{ sku_id: string; sku_name: string; category: string; perishability: string; standard_reorder_qty: number; unit_of_measure: string; distributor_id: string; distributor_name: string | null; region: string | null; status: string | null }>(
    `SELECT s.*, d.distributor_name, d.region, d.status FROM skus s LEFT JOIN distributors d ON d.distributor_id = s.distributor_id WHERE s.sku_id = $1`,
    [skuId],
  );
  const x = s.rows[0];
  if (!x) return null;
  const sales = await q.query<{ iso_week: string; week_start: string; units_sold: number }>(
    "SELECT iso_week, week_start::text AS week_start, units_sold FROM weekly_sales WHERE sku_id = $1 ORDER BY week_start",
    [skuId],
  );
  const inv = await q.query<{ location: string; as_of_date: string; units_on_hand: number }>(
    "SELECT location, as_of_date::text AS as_of_date, units_on_hand FROM inventory_snapshots WHERE sku_id = $1 ORDER BY as_of_date DESC, location",
    [skuId],
  );
  const hist = await q.query<{ id: number; run_id: number; created_at: Date; as_of_date: string; demand_class: string; inventory_risk: string; action: string; recommended_qty: number | null; review_status: string; final_qty: number | null; weeks_of_stock: number | null }>(
    `SELECT r.id::int AS id, r.run_id::int AS run_id, run.created_at, run.as_of_date::text AS as_of_date, r.demand_class, r.inventory_risk, r.action,
       r.recommended_qty, r.review_status, r.final_qty, r.weeks_of_stock::float8 AS weeks_of_stock
     FROM sku_recommendations r JOIN recommendation_runs run ON run.id = r.run_id WHERE r.sku_id = $1 ORDER BY r.run_id DESC LIMIT 50`,
    [skuId],
  );
  const latestRun = await q.query<{ id: number }>("SELECT MAX(id)::int AS id FROM recommendation_runs");
  const latestRec = hist.rows.find((h) => h.run_id === latestRun.rows[0]?.id);
  const latest = latestRec ? await getRecommendation(q, latestRec.id) : null;
  const decisions = await getDecisions(q, hist.rows.map((h) => h.id));
  return {
    sku: { skuId: x.sku_id, skuName: x.sku_name, category: x.category, perishability: x.perishability, standardReorderQty: x.standard_reorder_qty, unitOfMeasure: x.unit_of_measure, distributorId: x.distributor_id },
    distributor: x.distributor_name ? { distributorId: x.distributor_id, distributorName: x.distributor_name, region: x.region ?? "", status: x.status ?? "" } : null,
    sales: sales.rows.map((r) => ({ week: r.iso_week, weekStart: r.week_start, units: r.units_sold })),
    inventory: inv.rows.map((r) => ({ location: r.location, asOfDate: r.as_of_date, unitsOnHand: r.units_on_hand })),
    history: hist.rows.map((h) => ({
      id: h.id, runId: h.run_id, runCreatedAt: iso(h.created_at)!, asOfDate: h.as_of_date, demandClass: h.demand_class, inventoryRisk: h.inventory_risk,
      action: h.action, recommendedQty: h.recommended_qty, reviewStatus: h.review_status, finalQty: h.final_qty, weeksOfStock: h.weeks_of_stock,
    })),
    latest,
    decisions,
  };
}

export async function listSkuOptions(q: Queryable): Promise<{ skuId: string; skuName: string; category: string; perishability: string }[]> {
  const r = await q.query<{ sku_id: string; sku_name: string; category: string; perishability: string }>("SELECT sku_id, sku_name, category, perishability FROM skus ORDER BY sku_id");
  return r.rows.map((x) => ({ skuId: x.sku_id, skuName: x.sku_name, category: x.category, perishability: x.perishability }));
}

/* ------------------------------ data health ------------------------------ */

export interface DatasetStatus {
  dataset: Dataset;
  label: string;
  seedFile: string;
  grain: string;
  rowCount: number;
  lastBatch: { id: number; status: string; fileName: string; source: string; createdAt: string; rowsTotal: number; rowsInvalid: number; inserted: number; updated: number; unchanged: number } | null;
  lastCommittedAt: string | null;
}

export interface DataCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
}

export interface DataHealth {
  datasets: DatasetStatus[];
  checks: DataCheck[];
  latestSnapshot: { asOfDate: string; location: string; skuCount: number } | null;
  latestSalesWeek: string | null;
  expectedSalesWeek: string | null;
  snapshotAgeDays: number | null;
  today: string;
  counts: { skus: number; distributors: number; salesRows: number; inventoryRows: number; calendarMonths: number };
}

export async function getDatasetStatuses(q: Queryable): Promise<DatasetStatus[]> {
  const counts = await q.query<{ ds: string; n: number }>(
    `SELECT 'distributors' AS ds, COUNT(*)::int AS n FROM distributors UNION ALL SELECT 'skus', COUNT(*)::int FROM skus
     UNION ALL SELECT 'weekly_sales', COUNT(*)::int FROM weekly_sales UNION ALL SELECT 'inventory', COUNT(*)::int FROM inventory_snapshots
     UNION ALL SELECT 'calendar', COUNT(*)::int FROM calendar_months`,
  );
  const last = await q.query<{ dataset: string; id: number; status: string; file_name: string; source: string; created_at: Date; rows_total: number; rows_invalid: number; rows_inserted: number; rows_updated: number; rows_unchanged: number }>(
    `SELECT DISTINCT ON (dataset) dataset, id::int AS id, status, file_name, source, created_at, rows_total, rows_invalid, rows_inserted, rows_updated, rows_unchanged
     FROM import_batches ORDER BY dataset, id DESC`,
  );
  const committed = await q.query<{ dataset: string; at: Date }>(`SELECT dataset, MAX(created_at) AS at FROM import_batches WHERE status = 'committed' GROUP BY dataset`);
  const countMap = new Map(counts.rows.map((r) => [r.ds, r.n]));
  const lastMap = new Map(last.rows.map((r) => [r.dataset, r]));
  const comMap = new Map(committed.rows.map((r) => [r.dataset, r.at]));
  return [...DATASETS]
    .sort((a, b) => DATASET_INFO[a].order - DATASET_INFO[b].order)
    .map((ds) => {
      const lb = lastMap.get(ds);
      return {
        dataset: ds, label: DATASET_INFO[ds].label, seedFile: DATASET_INFO[ds].seedFile, grain: DATASET_INFO[ds].grain, rowCount: countMap.get(ds) ?? 0,
        lastBatch: lb
          ? { id: lb.id, status: lb.status, fileName: lb.file_name, source: lb.source, createdAt: iso(lb.created_at)!, rowsTotal: lb.rows_total, rowsInvalid: lb.rows_invalid, inserted: lb.rows_inserted, updated: lb.rows_updated, unchanged: lb.rows_unchanged }
          : null,
        lastCommittedAt: comMap.has(ds) ? iso(comMap.get(ds)!) : null,
      };
    });
}

export async function getDataHealth(q: Queryable): Promise<DataHealth> {
  const datasets = await getDatasetStatuses(q);
  const today = todayInIndia();
  const count = (ds: Dataset) => datasets.find((d) => d.dataset === ds)?.rowCount ?? 0;
  const snap = await q.query<{ as_of_date: string; location: string; n: number }>(
    `SELECT as_of_date::text AS as_of_date, location, COUNT(*)::int AS n FROM inventory_snapshots GROUP BY as_of_date, location ORDER BY as_of_date DESC, location LIMIT 1`,
  );
  const latestSnapshot = snap.rows[0] ? { asOfDate: snap.rows[0].as_of_date, location: snap.rows[0].location, skuCount: snap.rows[0].n } : null;
  const lw = await q.query<{ iso_week: string }>("SELECT iso_week FROM weekly_sales ORDER BY week_start DESC LIMIT 1");
  const latestSalesWeek = lw.rows[0]?.iso_week ?? null;
  const expectedSalesWeek = latestSnapshot ? latestCompleteWeek(latestSnapshot.asOfDate) : null;
  const snapshotAgeDays = latestSnapshot ? daysBetween(latestSnapshot.asOfDate, today) : null;

  const checks: DataCheck[] = [];
  const missing = datasets.filter((d) => d.rowCount === 0);
  checks.push({
    id: "datasets_loaded",
    label: "All five input datasets loaded",
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `No data yet for: ${missing.map((d) => d.label).join(", ")}.` : "Distributors, SKUs, weekly sales, inventory and calendar are present.",
  });
  const rejected = await q.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT ON (dataset) status FROM import_batches ORDER BY dataset, id DESC) x WHERE status = 'rejected'`,
  );
  checks.push({
    id: "rejected_imports",
    label: "Latest import per dataset accepted",
    status: rejected.rows[0].n ? "warn" : "pass",
    detail: rejected.rows[0].n ? `${rejected.rows[0].n} dataset(s) have a rejected latest upload. Previously committed data is still in use.` : "No rejected latest uploads.",
  });

  if (latestSnapshot && expectedSalesWeek) {
    const bundle = await buildEngineInputs(q, { asOfDate: latestSnapshot.asOfDate, location: latestSnapshot.location });
    if (bundle) {
      const weeks = weekWindow(expectedSalesWeek, bundle.config.baselineWindowWeeks);
      const incomplete = bundle.inputs.filter((i) => weeks.some((w) => !i.sales.find((s) => s.week === w)));
      const noStock = bundle.inputs.filter((i) => !i.stock);
      checks.push({
        id: "sales_window_complete",
        label: `Complete ${bundle.config.baselineWindowWeeks}-week sales window per SKU`,
        status: incomplete.length ? "warn" : "pass",
        detail: incomplete.length ? `${incomplete.length} SKU(s) have missing weeks: ${incomplete.map((i) => i.sku.skuId).join(", ")}.` : `All ${bundle.inputs.length} SKUs have sales for ${weeks[0]}–${expectedSalesWeek}.`,
      });
      checks.push({
        id: "inventory_complete",
        label: "Inventory snapshot covers every SKU",
        status: noStock.length ? "warn" : "pass",
        detail: noStock.length ? `No stock row at ${latestSnapshot.asOfDate} for: ${noStock.map((i) => i.sku.skuId).join(", ")}.` : `All SKUs have stock at ${latestSnapshot.location} on ${latestSnapshot.asOfDate}.`,
      });
      const month = latestSnapshot.asOfDate.slice(0, 7);
      checks.push({
        id: "calendar_covers_month",
        label: "Calendar covers the planning month",
        status: bundle.festivalCalendar.has(month) ? "pass" : "fail",
        detail: bundle.festivalCalendar.has(month) ? `${month} is in the calendar (festival month: ${bundle.festivalCalendar.get(month) ? "yes" : "no"}).` : `${month} is missing from the calendar; the festival rule cannot be applied.`,
      });
      const inactive = bundle.inputs.filter((i) => i.sku.distributor && i.sku.distributor.status !== "Active");
      checks.push({
        id: "distributor_mapping",
        label: "SKU → distributor mapping valid and active",
        status: inactive.length ? "warn" : "pass",
        detail: inactive.length ? `Mapped to inactive distributors: ${inactive.map((i) => i.sku.skuId).join(", ")}.` : "Every SKU maps to an active distributor in the master.",
      });
    }
  }

  if (latestSalesWeek && expectedSalesWeek) {
    const fresh = compareIsoWeeks(latestSalesWeek, expectedSalesWeek) >= 0;
    checks.push({
      id: "sales_freshness",
      label: "Sales data up to the latest complete week",
      status: fresh ? "pass" : "warn",
      detail: fresh ? `Sales run through ${latestSalesWeek}, the last complete week before the snapshot.` : `Sales end at ${latestSalesWeek}; expected ${expectedSalesWeek} for the ${latestSnapshot?.asOfDate} snapshot.`,
    });
  }
  if (snapshotAgeDays !== null) {
    checks.push({
      id: "snapshot_age",
      label: "Inventory snapshot age",
      status: snapshotAgeDays > 7 ? "warn" : "pass",
      detail: `Snapshot dated ${latestSnapshot!.asOfDate} is ${snapshotAgeDays} day(s) old (today ${today}, India time).`,
    });
  }

  const gaps = await q.query<{ sku_id: string; n: number; first: string; last: string }>(
    `SELECT sku_id, COUNT(*)::int AS n, MIN(week_start)::text AS first, MAX(week_start)::text AS last FROM weekly_sales GROUP BY sku_id`,
  );
  const gapSkus = gaps.rows.filter((g) => daysBetween(g.first, g.last) / 7 + 1 !== g.n).map((g) => g.sku_id);
  checks.push({
    id: "series_gaps",
    label: "No gaps inside weekly sales series",
    status: gapSkus.length ? "warn" : "pass",
    detail: gapSkus.length ? `Missing weeks inside the series for: ${gapSkus.join(", ")}. Missing weeks are not treated as zero.` : "Each SKU's weekly series is continuous.",
  });
  const orphanDist = await q.query<{ distributor_id: string }>(
    "SELECT d.distributor_id FROM distributors d WHERE NOT EXISTS (SELECT 1 FROM skus s WHERE s.distributor_id = d.distributor_id)",
  );
  if (orphanDist.rows.length) {
    checks.push({ id: "unused_distributors", label: "Distributors without SKUs", status: "info", detail: `${orphanDist.rows.map((r) => r.distributor_id).join(", ")} have no mapped SKUs.` });
  }
  checks.push({
    id: "sample_scope",
    label: "Prototype data scope",
    status: "info",
    detail: `Loaded ${count("skus")} SKUs and ${count("distributors")} distributors. The case describes 400 active SKUs and 1,200 distributors; this is a pilot sample, not the full ERP.`,
  });
  const zoho = getZohoStatus();
  const zs = await getLatestZohoSyncs(q);
  if (zoho.state === "not_configured") {
    checks.push({ id: "zoho_supply", label: "Purchase orders and lead times (Zoho)", status: "info", detail: "Zoho Inventory is not connected, so stock on order and lead times are unavailable." });
  } else if (!zs.latest) {
    checks.push({ id: "zoho_supply", label: "Purchase orders and lead times (Zoho)", status: "warn", detail: "Zoho credentials are set but no sync has run yet (Rules & Settings → Sync from Zoho)." });
  } else {
    const ageDays = Math.floor((Date.now() - Date.parse(zs.latest.finishedAt ?? zs.latest.startedAt)) / 86_400_000);
    const failed = zs.latest.status !== "succeeded";
    checks.push({
      id: "zoho_supply",
      label: "Purchase orders and lead times (Zoho)",
      status: failed || ageDays > 7 || zs.latest.warnings.length ? "warn" : "pass",
      detail: failed
        ? `Last Zoho sync failed: ${zs.latest.error ?? "unknown error"}.${zs.lastSuccess ? ` Showing data from sync #${zs.lastSuccess.id}.` : ""}`
        : `Synced ${ageDays} day(s) ago: ${zs.latest.itemsMapped} SKU(s) matched, ${zs.latest.openPoLines} open PO line(s)${zs.latest.warnings.length ? `, ${zs.latest.warnings.length} warning(s)` : ""}.`,
    });
  }
  checks.push({
    id: "unavailable_inputs",
    label: "Inputs not supplied",
    status: "info",
    detail: "Prices, costs and confirmed stockout events are not in the data and are shown as unavailable.",
  });

  return {
    datasets,
    checks,
    latestSnapshot,
    latestSalesWeek,
    expectedSalesWeek,
    snapshotAgeDays,
    today,
    counts: { skus: count("skus"), distributors: count("distributors"), salesRows: count("weekly_sales"), inventoryRows: count("inventory"), calendarMonths: count("calendar") },
  };
}

export async function getBatchErrors(q: Queryable, batchId: number) {
  const r = await q.query<{ row_number: number | null; column_name: string | null; code: string; message: string }>(
    "SELECT row_number, column_name, code, message FROM import_errors WHERE batch_id = $1 ORDER BY row_number NULLS FIRST, id LIMIT 500",
    [batchId],
  );
  return r.rows.map((e) => ({ rowNumber: e.row_number, column: e.column_name, code: e.code, message: e.message }));
}

export async function listImportBatches(q: Queryable, limit = 25) {
  const r = await q.query<{ id: number; dataset: string; file_name: string; source: string; status: string; rows_total: number; rows_valid: number; rows_invalid: number; rows_inserted: number; rows_updated: number; rows_unchanged: number; imported_by: string; created_at: Date; warnings: unknown[] }>(
    "SELECT id::int AS id, dataset, file_name, source, status, rows_total, rows_valid, rows_invalid, rows_inserted, rows_updated, rows_unchanged, imported_by, created_at, warnings FROM import_batches ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return r.rows.map((b) => ({
    id: b.id, dataset: b.dataset as Dataset, fileName: b.file_name, source: b.source, status: b.status, rowsTotal: b.rows_total, rowsValid: b.rows_valid,
    rowsInvalid: b.rows_invalid, inserted: b.rows_inserted, updated: b.rows_updated, unchanged: b.rows_unchanged, importedBy: b.imported_by,
    createdAt: iso(b.created_at)!, warningCount: Array.isArray(b.warnings) ? b.warnings.length : 0,
  }));
}

/* ------------------------------ insights ------------------------------ */

export async function getWeeklyTotals(q: Queryable) {
  const r = await q.query<{ iso_week: string; week_start: string; category: string; units: number }>(
    `SELECT w.iso_week, w.week_start::text AS week_start, s.category, SUM(w.units_sold)::int AS units
     FROM weekly_sales w JOIN skus s ON s.sku_id = w.sku_id GROUP BY w.iso_week, w.week_start, s.category ORDER BY w.week_start, s.category`,
  );
  return r.rows.map((x) => ({ week: x.iso_week, weekStart: x.week_start, category: x.category, units: x.units }));
}

export async function getAllSalesSeries(q: Queryable): Promise<Map<string, { week: string; units: number }[]>> {
  const r = await q.query<{ sku_id: string; iso_week: string; units_sold: number }>("SELECT sku_id, iso_week, units_sold FROM weekly_sales ORDER BY sku_id, week_start");
  const map = new Map<string, { week: string; units: number }[]>();
  for (const x of r.rows) {
    const l = map.get(x.sku_id) ?? [];
    l.push({ week: x.iso_week, units: x.units_sold });
    map.set(x.sku_id, l);
  }
  return map;
}

export async function getBacktests(q: Queryable): Promise<BacktestResult[]> {
  const series = await getAllSalesSeries(q);
  return [backtestMovingAverage(series, 4), backtestMovingAverage(series, 12)];
}

export interface ReviewStats {
  scope: string;
  total: number;
  requiringReview: number;
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
  notRequired: number;
  reviewed: number;
  approvalRate: number | null;
  editRate: number | null;
  rejectionRate: number | null;
  medianHoursToReview: number | null;
}

export async function getReviewStats(q: Queryable, runId: number | null): Promise<ReviewStats> {
  const r = await q.query<{ status: string; n: number }>(
    `SELECT review_status AS status, COUNT(*)::int AS n FROM sku_recommendations ${runId ? "WHERE run_id = $1" : ""} GROUP BY review_status`,
    runId ? [runId] : [],
  );
  const get = (s: string) => r.rows.find((x) => x.status === s)?.n ?? 0;
  const approved = get("approved");
  const edited = get("edited");
  const rejected = get("rejected");
  const reviewed = approved + edited + rejected;
  const t = await q.query<{ h: number | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.reviewed_at - run.created_at)) / 3600.0) AS h
     FROM sku_recommendations s JOIN recommendation_runs run ON run.id = s.run_id
     WHERE s.reviewed_at IS NOT NULL ${runId ? "AND s.run_id = $1" : ""}`,
    runId ? [runId] : [],
  );
  const total = r.rows.reduce((a, b) => a + b.n, 0);
  return {
    scope: runId ? `Run #${runId}` : "All runs",
    total,
    requiringReview: total - get("not_required"),
    pending: get("pending"),
    approved,
    edited,
    rejected,
    notRequired: get("not_required"),
    reviewed,
    approvalRate: reviewed ? approved / reviewed : null,
    editRate: reviewed ? edited / reviewed : null,
    rejectionRate: reviewed ? rejected / reviewed : null,
    medianHoursToReview: t.rows[0]?.h === null || t.rows[0]?.h === undefined ? null : Number(t.rows[0].h),
  };
}

export async function getAuditLog(q: Queryable, limit = 50) {
  const r = await q.query<{ id: number; occurred_at: Date; actor: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> }>(
    "SELECT id::int AS id, occurred_at, actor, action, entity_type, entity_id, details FROM audit_log ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return r.rows.map((a) => ({ id: a.id, occurredAt: iso(a.occurred_at)!, actor: a.actor, action: a.action, entityType: a.entity_type, entityId: a.entity_id, details: a.details }));
}

export async function listRuleConfigs(q: Queryable, limit = 10) {
  const r = await q.query<{ id: number; config: RuleConfig; is_active: boolean; note: string | null; created_by: string; created_at: Date }>(
    "SELECT id::int AS id, config, is_active, note, created_by, created_at FROM rule_configs ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return r.rows.map((c) => ({ id: c.id, config: c.config, isActive: c.is_active, note: c.note, createdBy: c.created_by, createdAt: iso(c.created_at)! }));
}

/** Week label helper for charts: "W42 · 12 Oct". */
export function weekShortLabel(week: string, weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00Z");
  return `${week.slice(5)} · ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

