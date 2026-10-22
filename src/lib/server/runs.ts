import { createHash } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { DEFAULT_RULE_CONFIG, ENGINE_VERSION, parseRuleConfig, type RuleConfig } from "../rules/config";
import { runRuleEngine, type EngineRunResult, type EngineSkuInput } from "../rules/engine";
import { latestCompleteWeek, weekWindow } from "../weeks";
import { writeAudit } from "./audit";

export async function getActiveConfig(q: Queryable): Promise<{ id: number | null; config: RuleConfig; createdAt: string | null; note: string | null }> {
  const r = await q.query<{ id: string; config: unknown; created_at: Date; note: string | null }>(
    "SELECT id, config, created_at, note FROM rule_configs WHERE is_active LIMIT 1",
  );
  if (!r.rows.length) return { id: null, config: DEFAULT_RULE_CONFIG, createdAt: null, note: null };
  return { id: Number(r.rows[0].id), config: parseRuleConfig(r.rows[0].config), createdAt: new Date(r.rows[0].created_at).toISOString(), note: r.rows[0].note };
}

export async function ensureActiveConfig(db: Db, actor: string): Promise<number> {
  const cur = await getActiveConfig(db);
  if (cur.id !== null) return cur.id;
  const r = await db.query<{ id: string }>(
    "INSERT INTO rule_configs (config, is_active, note, created_by) VALUES ($1::jsonb, true, $2, $3) RETURNING id",
    [JSON.stringify(DEFAULT_RULE_CONFIG), "Initial configuration from the case's documented rules.", actor],
  );
  return Number(r.rows[0].id);
}

/** Save a new config version and make it active. Applies to the next run only. */
export async function saveRuleConfig(db: Db, config: unknown, note: string, actor: string): Promise<number> {
  const parsed = parseRuleConfig(config);
  return db.transaction(async (tx) => {
    const prev = await tx.query<{ id: string; config: unknown }>("SELECT id, config FROM rule_configs WHERE is_active LIMIT 1");
    await tx.query("UPDATE rule_configs SET is_active = false WHERE is_active");
    const r = await tx.query<{ id: string }>(
      "INSERT INTO rule_configs (config, is_active, note, created_by) VALUES ($1::jsonb, true, $2, $3) RETURNING id",
      [JSON.stringify(parsed), note || null, actor],
    );
    const id = Number(r.rows[0].id);
    await writeAudit(tx, { actor, action: "rule_config.updated", entityType: "rule_config", entityId: id, details: { previousId: prev.rows[0]?.id ?? null, previous: prev.rows[0]?.config ?? null, next: parsed, note } });
    return id;
  });
}

export interface SnapshotOption {
  asOfDate: string;
  location: string;
  skuCount: number;
}

export async function listSnapshots(q: Queryable): Promise<SnapshotOption[]> {
  const r = await q.query<{ as_of_date: string; location: string; n: string }>(
    `SELECT as_of_date::text AS as_of_date, location, COUNT(*) AS n FROM inventory_snapshots GROUP BY as_of_date, location ORDER BY as_of_date DESC, location`,
  );
  return r.rows.map((x) => ({ asOfDate: x.as_of_date, location: x.location, skuCount: Number(x.n) }));
}

export interface EngineInputBundle {
  asOfDate: string;
  location: string;
  inputs: EngineSkuInput[];
  festivalCalendar: Map<string, boolean>;
  config: RuleConfig;
  configId: number | null;
  inputHash: string;
}

export async function buildEngineInputs(q: Queryable, opts: { asOfDate?: string; location?: string } = {}): Promise<EngineInputBundle | null> {
  const snaps = await listSnapshots(q);
  const snap = opts.asOfDate ? snaps.find((s) => s.asOfDate === opts.asOfDate && (!opts.location || s.location === opts.location)) : snaps[0];
  if (!snap) return null;
  const { id: configId, config } = await getActiveConfig(q);

  const skus = await q.query<{
    sku_id: string; sku_name: string; category: string; perishability: string; standard_reorder_qty: number; unit_of_measure: string;
    distributor_id: string | null; distributor_name: string | null; region: string | null; status: string | null;
  }>(
    `SELECT s.sku_id, s.sku_name, s.category, s.perishability, s.standard_reorder_qty, s.unit_of_measure, s.distributor_id,
            d.distributor_name, d.region, d.status
     FROM skus s LEFT JOIN distributors d ON d.distributor_id = s.distributor_id ORDER BY s.sku_id`,
  );
  const windowWeeks = weekWindow(latestCompleteWeek(snap.asOfDate), Math.max(config.baselineWindowWeeks, config.recentWindowWeeks));
  const sales = await q.query<{ sku_id: string; iso_week: string; units_sold: number }>(
    `SELECT sku_id, iso_week, units_sold FROM weekly_sales WHERE iso_week = ANY($1::text[]) ORDER BY sku_id, week_start`,
    [windowWeeks],
  );
  const stock = await q.query<{ sku_id: string; units_on_hand: number; location: string; as_of_date: string }>(
    `SELECT sku_id, units_on_hand, location, as_of_date::text AS as_of_date FROM inventory_snapshots WHERE as_of_date = $1::date AND location = $2`,
    [snap.asOfDate, snap.location],
  );
  const cal = await q.query<{ year_month: string; is_festival_month: boolean }>("SELECT year_month, is_festival_month FROM calendar_months");

  const salesBySku = new Map<string, { week: string; units: number }[]>();
  for (const s of sales.rows) {
    const list = salesBySku.get(s.sku_id) ?? [];
    list.push({ week: s.iso_week, units: Number(s.units_sold) });
    salesBySku.set(s.sku_id, list);
  }
  const stockBySku = new Map(stock.rows.map((s) => [s.sku_id, s]));
  const inputs: EngineSkuInput[] = skus.rows.map((s) => {
    const st = stockBySku.get(s.sku_id);
    return {
      sku: {
        skuId: s.sku_id,
        skuName: s.sku_name,
        category: s.category,
        perishability: s.perishability,
        standardReorderQty: Number(s.standard_reorder_qty),
        unitOfMeasure: s.unit_of_measure,
        distributorId: s.distributor_id,
        distributor: s.distributor_name ? { name: s.distributor_name, region: s.region ?? "", status: s.status ?? "" } : null,
      },
      sales: salesBySku.get(s.sku_id) ?? [],
      stock: st ? { unitsOnHand: Number(st.units_on_hand), location: st.location, asOfDate: st.as_of_date } : null,
    };
  });
  const festivalCalendar = new Map(cal.rows.map((c) => [c.year_month, c.is_festival_month]));
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ engine: ENGINE_VERSION, asOfDate: snap.asOfDate, location: snap.location, inputs, cal: [...festivalCalendar].sort(), config }))
    .digest("hex");
  return { asOfDate: snap.asOfDate, location: snap.location, inputs, festivalCalendar, config, configId, inputHash };
}

export function summariseRun(result: EngineRunResult) {
  const recs = result.recommendations;
  const count = (f: (r: (typeof recs)[number]) => boolean) => recs.filter(f).length;
  return {
    skuCount: recs.length,
    highDemand: count((r) => r.demandClass === "high_demand"),
    stockoutRisk: count((r) => r.inventoryRisk === "stockout_risk"),
    overstockRisk: count((r) => r.inventoryRisk === "overstock_risk"),
    perishableBelowMin: count((r) => r.inventoryRisk === "perishable_below_min"),
    perishableAboveMax: count((r) => r.inventoryRisk === "perishable_above_max"),
    insufficientData: count((r) => r.demandClass === "insufficient_data" || r.inventoryRisk === "insufficient_data" || r.inventoryRisk === "no_recent_demand"),
    reorders: count((r) => r.action === "REORDER" || r.action === "REORDER_IMMEDIATE"),
    pauses: count((r) => r.action === "PAUSE_NEXT_ORDER"),
    reviewRequired: count((r) => r.action === "REVIEW_REQUIRED"),
    exceptions: count((r) => r.exceptionCodes.length > 0),
    requiresReview: count((r) => r.requiresReview),
  };
}

export class NoInventorySnapshotError extends Error {
  constructor() {
    super("No inventory snapshot has been imported, so a run cannot be calculated.");
  }
}

/** Run the rule engine on current data and store a reproducible run. */
export async function createRun(db: Db, opts: { actor: string; asOfDate?: string; location?: string }): Promise<{ runId: number; result: EngineRunResult }> {
  await ensureActiveConfig(db, opts.actor);
  const bundle = await buildEngineInputs(db, opts);
  if (!bundle) throw new NoInventorySnapshotError();
  const result = runRuleEngine(bundle.inputs, { asOfDate: bundle.asOfDate, festivalCalendar: bundle.festivalCalendar, config: bundle.config });
  const summary = summariseRun(result);

  const runId = await db.transaction(async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO recommendation_runs (triggered_by, engine_version, config_id, config, as_of_date, location, window_end_week, recent_weeks, baseline_weeks,
         planning_month, is_festival_month, input_hash, sku_count, summary)
       VALUES ($1,$2,$3,$4::jsonb,$5::date,$6,$7,$8::text[],$9::text[],$10,$11,$12,$13,$14::jsonb) RETURNING id`,
      [
        opts.actor, result.engineVersion, bundle.configId, JSON.stringify(bundle.config), bundle.asOfDate, bundle.location, result.windowEndWeek,
        result.recentWeeks, result.baselineWeeks, result.planningMonth, result.isFestivalMonth, bundle.inputHash, result.recommendations.length, JSON.stringify(summary),
      ],
    );
    const id = Number(r.rows[0].id);
    const rows = result.recommendations.map((rec) => ({
      skuId: rec.skuId,
      demandClass: rec.demandClass,
      inventoryRisk: rec.inventoryRisk,
      action: rec.action,
      qtyRaw: rec.recommendedQtyRaw,
      qty: rec.recommendedQty,
      requiresReview: rec.requiresReview,
      exceptionCodes: rec.exceptionCodes,
      latestWeekUnits: rec.metrics.latestWeekUnits,
      recentAvg: rec.metrics.recentAvg,
      baselineAvg: rec.metrics.baselineAvg,
      forwardDemand: rec.metrics.forwardDemand,
      currentStock: rec.metrics.currentStock,
      weeksOfStock: rec.metrics.weeksOfStock,
      metrics: rec.metrics,
      steps: rec.steps,
      reason: rec.reason,
      reviewStatus: rec.requiresReview ? "pending" : "not_required",
    }));
    if (rows.length) {
      await tx.query(
        `INSERT INTO sku_recommendations (run_id, sku_id, demand_class, inventory_risk, action, recommended_qty_raw, recommended_qty, requires_review,
           exception_codes, latest_week_units, recent_avg, baseline_avg, forward_demand, current_stock, weeks_of_stock, metrics, steps, reason, review_status)
         SELECT $1, x."skuId", x."demandClass", x."inventoryRisk", x.action, x."qtyRaw", x.qty, x."requiresReview",
           ARRAY(SELECT jsonb_array_elements_text(x."exceptionCodes")), x."latestWeekUnits", x."recentAvg", x."baselineAvg", x."forwardDemand",
           x."currentStock", x."weeksOfStock", x.metrics, x.steps, x.reason, x."reviewStatus"
         FROM jsonb_to_recordset($2::jsonb) AS x("skuId" text, "demandClass" text, "inventoryRisk" text, action text, "qtyRaw" numeric, qty int,
           "requiresReview" boolean, "exceptionCodes" jsonb, "latestWeekUnits" int, "recentAvg" numeric, "baselineAvg" numeric, "forwardDemand" numeric,
           "currentStock" int, "weeksOfStock" numeric, metrics jsonb, steps jsonb, reason text, "reviewStatus" text)`,
        [id, JSON.stringify(rows)],
      );
    }
    await writeAudit(tx, {
      actor: opts.actor,
      action: "run.created",
      entityType: "recommendation_run",
      entityId: id,
      details: { asOfDate: bundle.asOfDate, location: bundle.location, configId: bundle.configId, inputHash: bundle.inputHash, summary },
    });
    return id;
  });
  return { runId, result };
}
