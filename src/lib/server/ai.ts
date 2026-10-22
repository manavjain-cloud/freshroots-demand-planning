import { createHash } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { generateExplanation, generatePlanningSummary, type Explanation, type PlanningSummary } from "../ai/explain";
import { AiUnavailableError, getAiConfig } from "../ai/provider";
import { ACTION_LABEL, DEMAND_LABEL, EXCEPTION_INFO, RISK_LABEL, type DemandClass, type ExceptionCode, type InventoryRisk, type RecommendationAction, type SkuMetrics } from "../rules/engine";
import type { RuleConfig } from "../rules/config";
import { round } from "../csv";

export interface StoredAi<T> {
  id: number;
  content: T;
  provider: string;
  model: string;
  warnings: string[];
  createdAt: string;
}

export function aiStatus() {
  const cfg = getAiConfig();
  return { configured: !!cfg.provider, provider: cfg.provider, model: cfg.models[0] ?? null };
}

/* ------------------------------ rate limiting ------------------------------ */

export function clientBucket(ip: string | null): string {
  return "ip:" + createHash("sha256").update(`freshroots:${ip ?? "unknown"}`).digest("hex").slice(0, 24);
}

/** Fixed-window counter stored in Postgres so limits hold across serverless instances. */
export async function consumeRateLimit(q: Queryable, bucket: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number }> {
  const r = await q.query<{ count: number }>(
    `INSERT INTO ai_rate_limits (bucket, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = ai_rate_limits.count + 1
     RETURNING count`,
    [bucket, windowSeconds],
  );
  const count = Number(r.rows[0].count);
  return { allowed: count <= limit, count };
}

export async function checkAiRateLimits(q: Queryable, ip: string | null): Promise<string | null> {
  const perHour = Number(process.env.AI_RATE_LIMIT_PER_HOUR) || 30;
  const perDay = Number(process.env.AI_RATE_LIMIT_GLOBAL_PER_DAY) || 300;
  const a = await consumeRateLimit(q, clientBucket(ip), perHour, 3600);
  if (!a.allowed) return `AI request limit reached (${perHour} per hour). Try again later.`;
  const b = await consumeRateLimit(q, "global", perDay, 86400);
  if (!b.allowed) return `Daily AI request limit reached (${perDay}). Try again tomorrow.`;
  return null;
}

/* ------------------------------ facts ------------------------------ */

export async function buildRecommendationFacts(q: Queryable, recommendationId: number): Promise<Record<string, unknown> | null> {
  const r = await q.query<{
    sku_id: string; sku_name: string; category: string; perishability: string; standard_reorder_qty: number; unit_of_measure: string;
    demand_class: string; inventory_risk: string; action: string; recommended_qty: number | null; exception_codes: string[];
    metrics: SkuMetrics; reason: string; config: RuleConfig; as_of_date: string; run_id: string;
  }>(
    `SELECT r.sku_id, s.sku_name, s.category, s.perishability, s.standard_reorder_qty, s.unit_of_measure, r.demand_class, r.inventory_risk,
            r.action, r.recommended_qty, r.exception_codes, r.metrics, r.reason, run.config, run.as_of_date::text AS as_of_date, r.run_id
     FROM sku_recommendations r JOIN skus s ON s.sku_id = r.sku_id JOIN recommendation_runs run ON run.id = r.run_id
     WHERE r.id = $1`,
    [recommendationId],
  );
  const x = r.rows[0];
  if (!x) return null;
  const m = x.metrics;
  return {
    sku: { sku_id: x.sku_id, name: x.sku_name, category: x.category, perishability: x.perishability, standard_reorder_qty: x.standard_reorder_qty, unit: x.unit_of_measure },
    inventory_snapshot_date: x.as_of_date,
    windows: { recent_weeks: m.recentWeeks, baseline_weeks: m.baselineWeeks },
    sales: {
      latest_week: m.latestWeek,
      latest_week_units: m.latestWeekUnits,
      recent_avg_per_week: round(m.recentAvg, 1),
      baseline_avg_per_week: round(m.baselineAvg, 1),
      change_vs_baseline_pct: m.demandRatio === null ? null : round((m.demandRatio - 1) * 100, 1),
    },
    festival: { planning_month: m.planningMonth, is_festival_month: m.isFestivalMonth, uplift_factor: m.festivalFactor, baseline_weeks_in_festival_months: m.baselineFestivalWeeks },
    stock: {
      units_on_hand: m.currentStock,
      forward_demand_per_week: round(m.forwardDemand, 1),
      weeks_of_stock: round(m.weeksOfStock, 1),
      min_weeks: m.minWeeks,
      max_weeks: m.maxWeeks,
      perishable_window_applies: m.isPerishable,
      projected_weeks_after_reorder: round(m.projectedWeeksAfterOrder, 1),
    },
    rule_thresholds: {
      high_demand_threshold_pct: x.config.highDemandThresholdPct,
      high_demand_multiplier: x.config.highDemandReorderMultiplier,
      festival_uplift_pct: x.config.festivalUpliftPct,
    },
    result: {
      demand_class: DEMAND_LABEL[x.demand_class as DemandClass] ?? x.demand_class,
      inventory_risk: RISK_LABEL[x.inventory_risk as InventoryRisk] ?? x.inventory_risk,
      action: ACTION_LABEL[x.action as RecommendationAction] ?? x.action,
      recommended_qty: x.recommended_qty,
      exceptions: x.exception_codes.map((c) => ({ name: EXCEPTION_INFO[c as ExceptionCode]?.label ?? c, meaning: EXCEPTION_INFO[c as ExceptionCode]?.description ?? c })),
      rule_engine_reason: x.reason,
    },
    unavailable_data: ["open purchase orders", "supplier lead times", "prices and costs"],
  };
}

export async function buildRunFacts(q: Queryable, runId: number): Promise<(Record<string, unknown> & { skus: { sku_id: string }[] }) | null> {
  const run = await q.query<{ as_of_date: string; location: string; planning_month: string; is_festival_month: boolean | null; summary: Record<string, number>; window_end_week: string }>(
    `SELECT as_of_date::text AS as_of_date, location, planning_month, is_festival_month, summary, window_end_week FROM recommendation_runs WHERE id = $1`,
    [runId],
  );
  if (!run.rows[0]) return null;
  const recs = await q.query<{ sku_id: string; sku_name: string; perishability: string; demand_class: string; inventory_risk: string; action: string; recommended_qty: number | null; weeks_of_stock: string | null; exception_codes: string[]; review_status: string }>(
    `SELECT r.sku_id, s.sku_name, s.perishability, r.demand_class, r.inventory_risk, r.action, r.recommended_qty, r.weeks_of_stock::text AS weeks_of_stock, r.exception_codes, r.review_status
     FROM sku_recommendations r JOIN skus s ON s.sku_id = r.sku_id WHERE r.run_id = $1 ORDER BY r.sku_id`,
    [runId],
  );
  const h = run.rows[0];
  return {
    run: { inventory_snapshot_date: h.as_of_date, location: h.location, latest_sales_week: h.window_end_week, planning_month: h.planning_month, festival_month: h.is_festival_month },
    counts: h.summary,
    skus: recs.rows.map((r) => ({
      sku_id: r.sku_id,
      name: r.sku_name,
      perishability: r.perishability,
      demand: DEMAND_LABEL[r.demand_class as DemandClass] ?? r.demand_class,
      inventory_risk: RISK_LABEL[r.inventory_risk as InventoryRisk] ?? r.inventory_risk,
      action: ACTION_LABEL[r.action as RecommendationAction] ?? r.action,
      recommended_qty: r.recommended_qty,
      weeks_of_stock: r.weeks_of_stock === null ? null : round(Number(r.weeks_of_stock), 1),
      exceptions: r.exception_codes.map((c) => EXCEPTION_INFO[c as ExceptionCode]?.label ?? c),
      review_status: r.review_status,
    })),
    unavailable_data: ["open purchase orders", "supplier lead times", "prices and costs", "confirmed stockout events"],
  };
}

/* ------------------------------ cache ------------------------------ */

export async function getStoredAi<T>(q: Queryable, scope: "recommendation" | "run_summary", refId: number): Promise<StoredAi<T> | null> {
  const r = await q.query<{ id: string; content: T; provider: string; model: string; grounding_warnings: string[]; created_at: Date }>(
    `SELECT id, content, provider, model, grounding_warnings, created_at FROM ai_explanations WHERE scope = $1 AND ref_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [scope, refId],
  );
  const x = r.rows[0];
  return x ? { id: Number(x.id), content: x.content, provider: x.provider, model: x.model, warnings: x.grounding_warnings, createdAt: new Date(x.created_at).toISOString() } : null;
}

async function store<T>(db: Db, scope: "recommendation" | "run_summary", refId: number, g: { content: T; provider: string; model: string; warnings: string[] }): Promise<StoredAi<T>> {
  const r = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO ai_explanations (scope, ref_id, provider, model, content, grounding_warnings) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id, created_at`,
    [scope, refId, g.provider, g.model, JSON.stringify(g.content), JSON.stringify(g.warnings)],
  );
  return { id: Number(r.rows[0].id), content: g.content, provider: g.provider, model: g.model, warnings: g.warnings, createdAt: new Date(r.rows[0].created_at).toISOString() };
}

export type AiOutcome<T> = { status: "ok"; cached: boolean; data: StoredAi<T> } | { status: "unavailable"; reason: string; message: string };

export async function explainRecommendation(db: Db, recommendationId: number, opts: { refresh?: boolean; ip?: string | null; fetchImpl?: typeof fetch } = {}): Promise<AiOutcome<Explanation>> {
  if (!opts.refresh) {
    const cached = await getStoredAi<Explanation>(db, "recommendation", recommendationId);
    if (cached) return { status: "ok", cached: true, data: cached };
  }
  const facts = await buildRecommendationFacts(db, recommendationId);
  if (!facts) return { status: "unavailable", reason: "not_found", message: "Recommendation not found." };
  const limited = await checkAiRateLimits(db, opts.ip ?? null);
  if (limited) return { status: "unavailable", reason: "rate_limited", message: limited };
  try {
    const g = await generateExplanation(facts, { fetchImpl: opts.fetchImpl });
    return { status: "ok", cached: false, data: await store(db, "recommendation", recommendationId, g) };
  } catch (err) {
    return aiFailure(err);
  }
}

export async function summariseRunWithAi(db: Db, runId: number, opts: { refresh?: boolean; ip?: string | null; fetchImpl?: typeof fetch } = {}): Promise<AiOutcome<PlanningSummary>> {
  if (!opts.refresh) {
    const cached = await getStoredAi<PlanningSummary>(db, "run_summary", runId);
    if (cached) return { status: "ok", cached: true, data: cached };
  }
  const facts = await buildRunFacts(db, runId);
  if (!facts) return { status: "unavailable", reason: "not_found", message: "Run not found." };
  const limited = await checkAiRateLimits(db, opts.ip ?? null);
  if (limited) return { status: "unavailable", reason: "rate_limited", message: limited };
  try {
    const g = await generatePlanningSummary(facts, { fetchImpl: opts.fetchImpl });
    return { status: "ok", cached: false, data: await store(db, "run_summary", runId, g) };
  } catch (err) {
    return aiFailure(err);
  }
}

function aiFailure(err: unknown): { status: "unavailable"; reason: string; message: string } {
  if (err instanceof AiUnavailableError) return { status: "unavailable", reason: err.kind, message: `AI explanations are temporarily unavailable: ${err.message}` };
  console.error("AI explanation failed", err instanceof Error ? err.message : "unknown error");
  return { status: "unavailable", reason: "upstream", message: "AI explanations are temporarily unavailable." };
}
