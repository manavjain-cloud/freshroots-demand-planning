import { ENGINE_VERSION, type RuleConfig } from "./config";
import { isoWeekMonth, latestCompleteWeek, parseIsoDate, weekWindow } from "../weeks";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface EngineSku {
  skuId: string;
  skuName: string;
  category: string;
  perishability: string;
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string | null;
  /** null when the SKU's distributor reference could not be resolved. */
  distributor: { name: string; region: string; status: string } | null;
}

export interface EngineSkuInput {
  sku: EngineSku;
  sales: { week: string; units: number }[];
  /** Units on hand at the selected snapshot, or null if no snapshot row exists for this SKU. */
  stock: { unitsOnHand: number; location: string; asOfDate: string } | null;
}

export interface EngineContext {
  /** Inventory snapshot date the run is based on (YYYY-MM-DD). */
  asOfDate: string;
  /** Calendar seed: YYYY-MM -> is festival month. */
  festivalCalendar: Map<string, boolean>;
  config: RuleConfig;
}

export type DemandClass = "high_demand" | "normal" | "insufficient_data";
export type InventoryRisk =
  | "stockout_risk"
  | "overstock_risk"
  | "perishable_below_min"
  | "perishable_above_max"
  | "within_range"
  | "no_recent_demand"
  | "insufficient_data";
export type RecommendationAction = "REORDER_IMMEDIATE" | "REORDER" | "PAUSE_NEXT_ORDER" | "REVIEW_REQUIRED" | "NO_ACTION";

export type ExceptionCode =
  | "MISSING_INVENTORY"
  | "INSUFFICIENT_HISTORY"
  | "NO_RECENT_DEMAND"
  | "CALENDAR_MONTH_MISSING"
  | "INVALID_DISTRIBUTOR_MAPPING"
  | "INACTIVE_DISTRIBUTOR"
  | "CONFLICT_HIGH_DEMAND_VS_OVERSTOCK"
  | "PERISHABLE_QTY_POLICY_UNDEFINED"
  | "REORDER_MAY_EXCEED_PERISHABLE_MAX"
  | "STANDARD_QTY_MAY_NOT_RESTORE_COVER"
  | "UNUSUAL_LATEST_WEEK";

export const EXCEPTION_INFO: Record<ExceptionCode, { label: string; kind: "data" | "policy" | "conflict" | "attention"; description: string }> = {
  MISSING_INVENTORY: { label: "Missing inventory", kind: "data", description: "No stock row for this SKU at the selected snapshot. Coverage cannot be calculated." },
  INSUFFICIENT_HISTORY: { label: "Insufficient sales history", kind: "data", description: "One or more weeks in the calculation window have no sales row (possible new product or data gap). Missing weeks are not treated as zero." },
  NO_RECENT_DEMAND: { label: "No recent demand", kind: "data", description: "Average weekly sales are zero, so weeks of stock cannot be calculated." },
  CALENDAR_MONTH_MISSING: { label: "Calendar month missing", kind: "data", description: "The planning month is not in the calendar seed, so the festival uplift was not applied." },
  INVALID_DISTRIBUTOR_MAPPING: { label: "Unmapped distributor", kind: "data", description: "The SKU's distributor ID does not match the distributor master." },
  INACTIVE_DISTRIBUTOR: { label: "Inactive distributor", kind: "attention", description: "The mapped distributor is not Active." },
  CONFLICT_HIGH_DEMAND_VS_OVERSTOCK: { label: "High demand vs overstock", kind: "conflict", description: "Demand is rising but stock is above the maximum. The overstock pause takes precedence; the planner decides whether an exception is justified." },
  PERISHABLE_QTY_POLICY_UNDEFINED: { label: "Perishable quantity policy undefined", kind: "policy", description: "The case does not define a reorder quantity for perishable SKUs below the minimum window. The planner sets the quantity." },
  REORDER_MAY_EXCEED_PERISHABLE_MAX: { label: "Reorder may exceed perishable max", kind: "attention", description: "After the rule-based reorder, projected stock would exceed the perishable maximum window." },
  STANDARD_QTY_MAY_NOT_RESTORE_COVER: { label: "Reorder may not restore cover", kind: "attention", description: "After the rule-based reorder, projected stock would still be below the minimum cover." },
  UNUSUAL_LATEST_WEEK: { label: "Unusual latest week", kind: "attention", description: "Latest week deviates sharply from the baseline average. Proposed signal, not a case rule." },
};

export interface ExplanationStep {
  step: string;
  rule: string;
  result: string;
  data: Record<string, unknown>;
}

export interface SkuMetrics {
  windowEndWeek: string;
  recentWeeks: string[];
  baselineWeeks: string[];
  latestWeek: string | null;
  latestWeekUnits: number | null;
  recentSum: number | null;
  baselineSum: number | null;
  recentAvg: number | null;
  baselineAvg: number | null;
  /** recentAvg compared with baselineAvg, after any configured uplift on the recent window. */
  demandRatio: number | null;
  planningMonth: string;
  isFestivalMonth: boolean | null;
  festivalFactor: number;
  baselineFestivalWeeks: number;
  coverageBasis: "baseline_avg" | "recent_avg";
  coverageBaseDemand: number | null;
  forwardDemand: number | null;
  currentStock: number | null;
  stockLocation: string | null;
  weeksOfStock: number | null;
  isPerishable: boolean;
  minWeeks: number;
  maxWeeks: number;
  projectedWeeksAfterOrder: number | null;
}

export interface SkuRecommendation {
  skuId: string;
  demandClass: DemandClass;
  inventoryRisk: InventoryRisk;
  action: RecommendationAction;
  recommendedQtyRaw: number | null;
  recommendedQty: number | null;
  requiresReview: boolean;
  exceptionCodes: ExceptionCode[];
  metrics: SkuMetrics;
  reason: string;
  steps: ExplanationStep[];
}

export interface EngineRunResult {
  engineVersion: string;
  asOfDate: string;
  windowEndWeek: string;
  recentWeeks: string[];
  baselineWeeks: string[];
  planningMonth: string;
  isFestivalMonth: boolean | null;
  recommendations: SkuRecommendation[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const EPS = 1e-9;
/** a > b, tolerant to floating-point noise so "exactly at threshold" is never flagged. */
export function strictlyGreater(a: number, b: number): boolean {
  return a - b > EPS * Math.max(1, Math.abs(b));
}
/** a < b, tolerant to floating-point noise. */
export function strictlyLess(a: number, b: number): boolean {
  return b - a > EPS * Math.max(1, Math.abs(b));
}

export function roundQty(raw: number, mode: RuleConfig["roundingMode"]): number {
  // Snap away floating-point noise (e.g. 224.99999999) before rounding.
  const snapped = Math.abs(raw - Math.round(raw)) < 1e-9 ? Math.round(raw) : raw;
  if (mode === "ceil") return Math.ceil(snapped);
  if (mode === "floor") return Math.floor(snapped);
  return Math.round(snapped);
}

const fmt = (n: number | null, digits = 1) => (n === null ? "n/a" : n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const fmtInt = (n: number | null) => (n === null ? "n/a" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 }));

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export function runRuleEngine(inputs: EngineSkuInput[], ctx: EngineContext): EngineRunResult {
  if (!parseIsoDate(ctx.asOfDate)) throw new Error(`Invalid as-of date: ${ctx.asOfDate}`);
  const cfg = ctx.config;
  const windowEndWeek = latestCompleteWeek(ctx.asOfDate);
  const baselineWeeks = weekWindow(windowEndWeek, cfg.baselineWindowWeeks);
  const recentWeeks = weekWindow(windowEndWeek, cfg.recentWindowWeeks);
  const planningMonth = ctx.asOfDate.slice(0, 7);
  const festivalLookup = ctx.festivalCalendar.get(planningMonth);
  const isFestivalMonth = festivalLookup === undefined ? null : festivalLookup;

  const recommendations = inputs.map((input) =>
    evaluateSku(input, { cfg, windowEndWeek, baselineWeeks, recentWeeks, planningMonth, isFestivalMonth, festivalCalendar: ctx.festivalCalendar }),
  );

  return { engineVersion: ENGINE_VERSION, asOfDate: ctx.asOfDate, windowEndWeek, recentWeeks, baselineWeeks, planningMonth, isFestivalMonth, recommendations };
}

interface EvalCtx {
  cfg: RuleConfig;
  windowEndWeek: string;
  baselineWeeks: string[];
  recentWeeks: string[];
  planningMonth: string;
  isFestivalMonth: boolean | null;
  festivalCalendar: Map<string, boolean>;
}

export function evaluateSku(input: EngineSkuInput, c: EvalCtx): SkuRecommendation {
  const { cfg } = c;
  const { sku } = input;
  const steps: ExplanationStep[] = [];
  const exceptions = new Set<ExceptionCode>();

  /* 1. Validate inputs ------------------------------------------------ */
  const salesByWeek = new Map<string, number>();
  for (const s of input.sales) salesByWeek.set(s.week, s.units);
  const missingBaseline = c.baselineWeeks.filter((w) => !salesByWeek.has(w));
  const missingRecent = c.recentWeeks.filter((w) => !salesByWeek.has(w));
  const stockOk = input.stock !== null && Number.isFinite(input.stock.unitsOnHand) && input.stock.unitsOnHand >= 0;
  if (!stockOk) exceptions.add("MISSING_INVENTORY");
  if (missingBaseline.length > 0) exceptions.add("INSUFFICIENT_HISTORY");
  if (!sku.distributor) exceptions.add("INVALID_DISTRIBUTOR_MAPPING");
  else if (sku.distributor.status.toLowerCase() !== "active") exceptions.add("INACTIVE_DISTRIBUTOR");
  if (c.isFestivalMonth === null) exceptions.add("CALENDAR_MONTH_MISSING");
  steps.push({
    step: "validate_inputs",
    rule: "Inputs must cover the full calculation window and include a stock snapshot.",
    result: exceptions.size === 0 ? "All inputs present." : `Issues: ${[...exceptions].join(", ")}`,
    data: { missingBaselineWeeks: missingBaseline, missingRecentWeeks: missingRecent, hasInventory: stockOk, distributorMapped: !!sku.distributor },
  });

  /* 2. Sales windows -------------------------------------------------- */
  const sumOf = (weeks: string[]) => weeks.reduce((acc, w) => acc + (salesByWeek.get(w) ?? 0), 0);
  const recentSum = missingRecent.length === 0 ? sumOf(c.recentWeeks) : null;
  const baselineSum = missingBaseline.length === 0 ? sumOf(c.baselineWeeks) : null;
  const latestWeek = salesByWeek.has(c.windowEndWeek) ? c.windowEndWeek : null;
  const latestWeekUnits = latestWeek ? salesByWeek.get(latestWeek)! : null;
  steps.push({
    step: "sales_windows",
    rule: `Recent window = latest ${cfg.recentWindowWeeks} complete weeks; baseline = latest ${cfg.baselineWindowWeeks} complete weeks (includes the recent weeks).`,
    result: `Recent ${c.recentWeeks[0]}–${c.windowEndWeek}; baseline ${c.baselineWeeks[0]}–${c.windowEndWeek}.`,
    data: { recentWeeks: c.recentWeeks, baselineWeeks: c.baselineWeeks, recentSum, baselineSum },
  });

  /* 3. Baseline demand ----------------------------------------------- */
  const recentAvg = recentSum === null ? null : recentSum / cfg.recentWindowWeeks;
  const baselineAvg = baselineSum === null ? null : baselineSum / cfg.baselineWindowWeeks;
  steps.push({
    step: "baseline_demand",
    rule: "Average weekly sales = window total / number of weeks.",
    result: `Recent avg ${fmt(recentAvg)}; baseline avg ${fmt(baselineAvg)} units/week.`,
    data: { recentAvg, baselineAvg },
  });

  /* 4. Festival adjustment ------------------------------------------- */
  const festivalFactor = c.isFestivalMonth ? 1 + cfg.festivalUpliftPct / 100 : 1;
  const baselineFestivalWeeks = c.baselineWeeks.filter((w) => c.festivalCalendar.get(isoWeekMonth(w)) === true).length;
  const coverageBaseDemand = cfg.coverageDemandBasis === "baseline_avg" ? baselineAvg : recentAvg;
  const forwardDemand = coverageBaseDemand === null ? null : coverageBaseDemand * festivalFactor;
  steps.push({
    step: "festival_adjustment",
    rule: `Festival months get a ${cfg.festivalUpliftPct}% uplift, applied once, before threshold checks (mode: ${cfg.festivalUpliftMode}).`,
    result:
      c.isFestivalMonth === null
        ? `Planning month ${c.planningMonth} not in calendar; uplift not applied.`
        : c.isFestivalMonth
          ? `Planning month ${c.planningMonth} is a festival month: forward demand = ${fmt(coverageBaseDemand)} × ${festivalFactor} = ${fmt(forwardDemand)} units/week.`
          : `Planning month ${c.planningMonth} is not a festival month: no uplift.`,
    data: { planningMonth: c.planningMonth, isFestivalMonth: c.isFestivalMonth, festivalFactor, coverageBasis: cfg.coverageDemandBasis, coverageBaseDemand, forwardDemand, baselineFestivalWeeks },
  });

  /* 5. Applicable thresholds ----------------------------------------- */
  const isPerishable = cfg.perishableValues.map((v) => v.toLowerCase()).includes(sku.perishability.toLowerCase());
  const minWeeks = isPerishable ? cfg.perishableMinWeeks : cfg.stockoutMinWeeks;
  const maxWeeks = isPerishable ? cfg.perishableMaxWeeks : cfg.overstockMaxWeeks;
  steps.push({
    step: "thresholds",
    rule: isPerishable ? "High-perishability SKU: tighter window." : "Standard SKU: stockout/overstock window.",
    result: `Minimum ${minWeeks} weeks, maximum ${maxWeeks} weeks of stock.`,
    data: { perishability: sku.perishability, isPerishable, minWeeks, maxWeeks },
  });

  /* 6a. Demand classification ---------------------------------------- */
  let demandClass: DemandClass = "insufficient_data";
  let demandRatio: number | null = null;
  if (recentAvg !== null && baselineAvg !== null) {
    const recentForTest = cfg.festivalUpliftMode === "recent_window_only" ? recentAvg * festivalFactor : recentAvg;
    if (baselineAvg > 0) {
      demandRatio = recentForTest / baselineAvg;
      const threshold = baselineAvg * (1 + cfg.highDemandThresholdPct / 100);
      demandClass = strictlyGreater(recentForTest, threshold) ? "high_demand" : "normal";
    } else {
      demandClass = recentForTest > 0 ? "high_demand" : "normal";
    }
    steps.push({
      step: "classify_demand",
      rule: `High demand if recent avg is more than ${cfg.highDemandThresholdPct}% above baseline avg.`,
      result:
        demandRatio === null
          ? `Baseline avg is zero; recent avg ${fmt(recentForTest)} → ${demandClass}.`
          : `Recent ${fmt(recentForTest)} vs baseline ${fmt(baselineAvg)} = ${fmt((demandRatio - 1) * 100)}% change → ${demandClass === "high_demand" ? "HIGH DEMAND" : "not high demand"}.`,
      data: { recentForTest, baselineAvg, demandRatio, thresholdPct: cfg.highDemandThresholdPct, demandClass },
    });
  } else {
    steps.push({ step: "classify_demand", rule: "Requires complete recent and baseline windows.", result: "Insufficient data: not classified.", data: { demandClass } });
  }

  /* 6b. Inventory classification ------------------------------------- */
  const currentStock = stockOk ? input.stock!.unitsOnHand : null;
  let weeksOfStock: number | null = null;
  let inventoryRisk: InventoryRisk = "insufficient_data";
  if (currentStock !== null && forwardDemand !== null) {
    if (forwardDemand <= 0) {
      inventoryRisk = "no_recent_demand";
      exceptions.add("NO_RECENT_DEMAND");
    } else {
      weeksOfStock = currentStock / forwardDemand;
      if (strictlyLess(weeksOfStock, minWeeks)) inventoryRisk = isPerishable ? "perishable_below_min" : "stockout_risk";
      else if (strictlyGreater(weeksOfStock, maxWeeks)) inventoryRisk = isPerishable ? "perishable_above_max" : "overstock_risk";
      else inventoryRisk = "within_range";
    }
  }
  steps.push({
    step: "classify_inventory",
    rule: `Weeks of stock = current stock / forward demand. Below ${minWeeks} = ${isPerishable ? "below perishable minimum" : "stockout risk"}; above ${maxWeeks} = ${isPerishable ? "above perishable maximum" : "overstock risk"}.`,
    result:
      weeksOfStock === null
        ? `Not calculated (${inventoryRisk.replace(/_/g, " ")}).`
        : `${fmtInt(currentStock)} / ${fmt(forwardDemand)} = ${fmt(weeksOfStock, 2)} weeks → ${inventoryRisk.replace(/_/g, " ")}.`,
    data: { currentStock, forwardDemand, weeksOfStock, inventoryRisk },
  });

  /* 7. Recommendation, with explicit precedence ---------------------- */
  const std = sku.standardReorderQty;
  const high = demandClass === "high_demand";
  let action: RecommendationAction = "NO_ACTION";
  let qtyRaw: number | null = null;
  let precedence = "";

  const dataBlocked = currentStock === null || weeksOfStock === null || demandClass === "insufficient_data";
  if (dataBlocked) {
    // P0: data problems block a quantity. The planner decides.
    action = "REVIEW_REQUIRED";
    precedence = "P0 data validation: inputs incomplete, no quantity calculated.";
  } else if (inventoryRisk === "overstock_risk" || inventoryRisk === "perishable_above_max") {
    // P1: an overstock pause is never contradicted by a reorder.
    action = "PAUSE_NEXT_ORDER";
    qtyRaw = 0;
    precedence = "P1 overstock: pause the next order.";
    if (high) {
      exceptions.add("CONFLICT_HIGH_DEMAND_VS_OVERSTOCK");
      precedence += " High-demand signal conflicts; pause takes precedence and the conflict is escalated.";
    }
  } else if (inventoryRisk === "stockout_risk" || inventoryRisk === "perishable_below_min") {
    // P2: below minimum cover.
    if (inventoryRisk === "perishable_below_min" && !high) {
      action = "REVIEW_REQUIRED";
      exceptions.add("PERISHABLE_QTY_POLICY_UNDEFINED");
      precedence = "P2 perishable below minimum: case defines no quantity; planner sets it.";
    } else {
      action = "REORDER_IMMEDIATE";
      qtyRaw = high ? std * cfg.highDemandReorderMultiplier : std;
      precedence = high
        ? `P2 below minimum + high demand: immediate reorder at ${cfg.highDemandReorderMultiplier} × standard quantity.`
        : "P2 stockout risk: immediate reorder at the standard reorder quantity.";
    }
  } else if (high) {
    // P3: within range but high demand.
    action = "REORDER";
    qtyRaw = std * cfg.highDemandReorderMultiplier;
    precedence = `P3 high demand within stock range: reorder at ${cfg.highDemandReorderMultiplier} × standard quantity.`;
  } else {
    action = "NO_ACTION";
    precedence = "P4 no rule triggered: no change to the normal cycle.";
  }

  const recommendedQty = qtyRaw === null ? null : roundQty(qtyRaw, cfg.roundingMode);

  let projectedWeeksAfterOrder: number | null = null;
  if (recommendedQty !== null && recommendedQty > 0 && currentStock !== null && forwardDemand && forwardDemand > 0) {
    projectedWeeksAfterOrder = (currentStock + recommendedQty) / forwardDemand;
    if (isPerishable && strictlyGreater(projectedWeeksAfterOrder, maxWeeks)) exceptions.add("REORDER_MAY_EXCEED_PERISHABLE_MAX");
    if (strictlyLess(projectedWeeksAfterOrder, minWeeks)) exceptions.add("STANDARD_QTY_MAY_NOT_RESTORE_COVER");
  }

  // Proposed attention signal (not a case rule).
  if (cfg.unusualWeekDeviationPct !== null && latestWeekUnits !== null && baselineAvg !== null && baselineAvg > 0) {
    const dev = Math.abs(latestWeekUnits - baselineAvg) / baselineAvg;
    if (strictlyGreater(dev * 100, cfg.unusualWeekDeviationPct)) exceptions.add("UNUSUAL_LATEST_WEEK");
  }

  steps.push({
    step: "recommendation",
    rule: "Precedence: P0 data → P1 overstock pause → P2 below minimum → P3 high demand → P4 no action.",
    result: `${ACTION_LABEL[action]}${recommendedQty !== null ? `, quantity ${fmtInt(recommendedQty)} (raw ${qtyRaw}, rounding ${cfg.roundingMode})` : ""}. ${precedence}`,
    data: { action, recommendedQtyRaw: qtyRaw, recommendedQty, standardReorderQty: std, projectedWeeksAfterOrder, precedence },
  });

  const exceptionCodes = [...exceptions];
  const requiresReview = action !== "NO_ACTION" || exceptionCodes.length > 0;

  const metrics: SkuMetrics = {
    windowEndWeek: c.windowEndWeek,
    recentWeeks: c.recentWeeks,
    baselineWeeks: c.baselineWeeks,
    latestWeek,
    latestWeekUnits,
    recentSum,
    baselineSum,
    recentAvg,
    baselineAvg,
    demandRatio,
    planningMonth: c.planningMonth,
    isFestivalMonth: c.isFestivalMonth,
    festivalFactor,
    baselineFestivalWeeks,
    coverageBasis: cfg.coverageDemandBasis,
    coverageBaseDemand,
    forwardDemand,
    currentStock,
    stockLocation: input.stock?.location ?? null,
    weeksOfStock,
    isPerishable,
    minWeeks,
    maxWeeks,
    projectedWeeksAfterOrder,
  };

  return {
    skuId: sku.skuId,
    demandClass,
    inventoryRisk,
    action,
    recommendedQtyRaw: qtyRaw,
    recommendedQty,
    requiresReview,
    exceptionCodes,
    metrics,
    reason: buildReason({ demandClass, inventoryRisk, action, recommendedQty, metrics, cfg, std, exceptionCodes }),
    steps,
  };
}

function buildReason(a: {
  demandClass: DemandClass;
  inventoryRisk: InventoryRisk;
  action: RecommendationAction;
  recommendedQty: number | null;
  metrics: SkuMetrics;
  cfg: RuleConfig;
  std: number;
  exceptionCodes: ExceptionCode[];
}): string {
  const m = a.metrics;
  const parts: string[] = [];
  if (a.demandClass === "high_demand" && m.demandRatio !== null) {
    parts.push(`High demand: ${a.cfg.recentWindowWeeks}-week avg ${fmt(m.recentAvg)} is ${fmt((m.demandRatio - 1) * 100)}% above the ${a.cfg.baselineWindowWeeks}-week avg ${fmt(m.baselineAvg)} (threshold >${a.cfg.highDemandThresholdPct}%).`);
  } else if (a.demandClass === "normal" && m.demandRatio !== null) {
    parts.push(`Demand ${fmt((m.demandRatio - 1) * 100)}% vs baseline (not above the ${a.cfg.highDemandThresholdPct}% threshold).`);
  } else if (a.demandClass === "insufficient_data") {
    parts.push("Demand not classified: incomplete sales history in the window.");
  }
  if (m.weeksOfStock !== null) {
    const demandLabel = m.festivalFactor > 1 ? "festival-adjusted demand" : "average demand";
    parts.push(`Stock ${fmtInt(m.currentStock)} covers ${fmt(m.weeksOfStock, 1)} weeks of ${demandLabel} (${fmt(m.forwardDemand)}/wk); window ${m.minWeeks}–${m.maxWeeks} weeks.`);
  } else if (a.inventoryRisk === "no_recent_demand") {
    parts.push("No recent demand: weeks of stock cannot be calculated.");
  } else if (m.currentStock === null) {
    parts.push("No inventory snapshot for this SKU.");
  }
  switch (a.action) {
    case "REORDER_IMMEDIATE":
      parts.push(`Recommend immediate reorder of ${fmtInt(a.recommendedQty)} units${a.demandClass === "high_demand" ? ` (${a.cfg.highDemandReorderMultiplier} × ${a.std})` : " (standard quantity)"}, for planner review.`);
      break;
    case "REORDER":
      parts.push(`Recommend reorder of ${fmtInt(a.recommendedQty)} units (${a.cfg.highDemandReorderMultiplier} × ${a.std}), for planner review.`);
      break;
    case "PAUSE_NEXT_ORDER":
      parts.push("Recommend pausing the next order.");
      break;
    case "REVIEW_REQUIRED":
      parts.push("No quantity calculated: planner review required.");
      break;
    case "NO_ACTION":
      parts.push("No rule triggered: no change to the normal cycle.");
      break;
  }
  if (a.exceptionCodes.length) parts.push(`Exceptions: ${a.exceptionCodes.map((c) => EXCEPTION_INFO[c].label).join(", ")}.`);
  return parts.join(" ");
}

export const ACTION_LABEL: Record<RecommendationAction, string> = {
  REORDER_IMMEDIATE: "Immediate reorder",
  REORDER: "Reorder",
  PAUSE_NEXT_ORDER: "Pause next order",
  REVIEW_REQUIRED: "Planner review",
  NO_ACTION: "No action",
};

export const RISK_LABEL: Record<InventoryRisk, string> = {
  stockout_risk: "Stockout risk",
  overstock_risk: "Overstock risk",
  perishable_below_min: "Below perishable min",
  perishable_above_max: "Above perishable max",
  within_range: "Within range",
  no_recent_demand: "No recent demand",
  insufficient_data: "Insufficient data",
};

export const DEMAND_LABEL: Record<DemandClass, string> = {
  high_demand: "High demand",
  normal: "Normal",
  insufficient_data: "Insufficient data",
};
