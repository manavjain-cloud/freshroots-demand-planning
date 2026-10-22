import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_CONFIG, parseRuleConfig, type RuleConfig } from "../src/lib/rules/config";
import { roundQty, runRuleEngine, type EngineSkuInput } from "../src/lib/rules/engine";
import { weekWindow } from "../src/lib/weeks";

// As-of Monday 2026-10-19 → latest complete week 2026-W42 (same as the seed data).
const AS_OF = "2026-10-19";
const WEEKS = weekWindow("2026-W42", 12);
const NON_FESTIVAL = new Map([["2026-10", false]]);
const FESTIVAL = new Map([["2026-10", true]]);

/** Sales where the first 8 weeks are `older` and the last 4 are `recent`. */
function sales(older: number, recent: number) {
  return WEEKS.map((week, i) => ({ week, units: i < 8 ? older : recent }));
}
function flat(units: number) {
  return WEEKS.map((week) => ({ week, units }));
}

function sku(overrides: Partial<EngineSkuInput["sku"]> = {}): EngineSkuInput["sku"] {
  return {
    skuId: "T1",
    skuName: "Test SKU",
    category: "Snack",
    perishability: "Low",
    standardReorderQty: 100,
    unitOfMeasure: "Units",
    distributorId: "D1",
    distributor: { name: "Dist", region: "Maharashtra", status: "Active" },
    ...overrides,
  };
}

function run(input: Partial<EngineSkuInput> & { stock?: EngineSkuInput["stock"] }, opts: { calendar?: Map<string, boolean>; config?: Partial<RuleConfig> } = {}) {
  const full: EngineSkuInput = {
    sku: input.sku ?? sku(),
    sales: input.sales ?? flat(100),
    stock: input.stock === undefined ? { unitsOnHand: 1000, location: "Pune", asOfDate: AS_OF } : input.stock,
  };
  const res = runRuleEngine([full], { asOfDate: AS_OF, festivalCalendar: opts.calendar ?? NON_FESTIVAL, config: { ...DEFAULT_RULE_CONFIG, ...opts.config } });
  return res.recommendations[0];
}
const stock = (n: number) => ({ unitsOnHand: n, location: "Pune", asOfDate: AS_OF });

/*
 * Window arithmetic used below: 8 older weeks at x + 4 recent weeks at y.
 * avg12 = (8x + 4y) / 12, avg4 = y. High demand iff y > 1.2 * avg12.
 * x = 100, y = 140 → avg12 = 113.33…, ratio 1.235 (above)
 * x = 100, y = 150 → avg12 = 116.67, ratio 1.2857
 * Exactly 20%: y = 1.2·(8x+4y)/12 ⇔ 12y = 9.6x + 4.8y ⇔ y = 4x/3. x = 75 → y = 100, avg12 = 83.333…, ratio 1.2 exactly.
 * Just below: x = 75, y = 99 → avg12 = 83, ratio 1.1928.
 */

describe("Rule 1 — high demand", () => {
  it("1. just below the 20% threshold is not high demand", () => {
    const r = run({ sales: sales(75, 99), stock: stock(800) });
    expect(r.metrics.demandRatio).toBeCloseTo(99 / 83, 6);
    expect(r.demandClass).toBe("normal");
    expect(r.action).not.toBe("REORDER");
  });

  it("2. exactly at the 20% threshold is NOT high demand (rule says 'more than')", () => {
    const r = run({ sales: sales(75, 100), stock: stock(700) });
    expect(r.metrics.recentAvg).toBe(100);
    expect(r.metrics.baselineAvg).toBeCloseTo(83.3333, 3);
    expect(r.demandClass).toBe("normal");
  });

  it("3. above the threshold is high demand and reorders 1.5 × standard", () => {
    // avg12 = 116.67, stock 1000 → 8.6 weeks (within 6–14 range)
    const r = run({ sales: sales(100, 150), stock: stock(1000) });
    expect(r.demandClass).toBe("high_demand");
    expect(r.action).toBe("REORDER");
    expect(r.recommendedQtyRaw).toBe(150);
    expect(r.recommendedQty).toBe(150);
  });

  it("rounds fractional 1.5× quantities up and preserves the raw value", () => {
    const r = run({ sku: sku({ standardReorderQty: 75 }), sales: sales(100, 150), stock: stock(1000) });
    expect(r.recommendedQtyRaw).toBe(112.5);
    expect(r.recommendedQty).toBe(113);
    expect(roundQty(112.5, "floor")).toBe(112);
    expect(roundQty(224.99999999999997, "ceil")).toBe(225);
  });
});

describe("Rules 2 & 3 — stock coverage (non-perishable)", () => {
  it("4. just below six weeks is stockout risk with an immediate standard reorder", () => {
    const r = run({ sales: flat(100), stock: stock(599) });
    expect(r.metrics.weeksOfStock).toBeCloseTo(5.99, 6);
    expect(r.inventoryRisk).toBe("stockout_risk");
    expect(r.action).toBe("REORDER_IMMEDIATE");
    expect(r.recommendedQty).toBe(100);
  });

  it("5. exactly six weeks is not stockout risk", () => {
    const r = run({ sales: flat(100), stock: stock(600) });
    expect(r.metrics.weeksOfStock).toBe(6);
    expect(r.inventoryRisk).toBe("within_range");
    expect(r.action).toBe("NO_ACTION");
    expect(r.requiresReview).toBe(false);
  });

  it("exactly fourteen weeks is not overstock", () => {
    const r = run({ sales: flat(100), stock: stock(1400) });
    expect(r.inventoryRisk).toBe("within_range");
  });

  it("6. above fourteen weeks is overstock risk and pauses the next order", () => {
    const r = run({ sales: flat(100), stock: stock(1401) });
    expect(r.inventoryRisk).toBe("overstock_risk");
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
    expect(r.recommendedQty).toBe(0);
  });

  it("stockout plus high demand reorders 1.5 × standard immediately", () => {
    const r = run({ sales: sales(100, 150), stock: stock(300) });
    expect(r.demandClass).toBe("high_demand");
    expect(r.inventoryRisk).toBe("stockout_risk");
    expect(r.action).toBe("REORDER_IMMEDIATE");
    expect(r.recommendedQty).toBe(150);
  });

  it("flags when the rule-based quantity would not restore minimum cover", () => {
    const r = run({ sales: flat(100), stock: stock(100) });
    expect(r.metrics.projectedWeeksAfterOrder).toBe(2);
    expect(r.exceptionCodes).toContain("STANDARD_QTY_MAY_NOT_RESTORE_COVER");
  });
});

describe("Rule 5 — perishable SKUs", () => {
  const perishable = sku({ perishability: "High" });

  it("7a. uses the 3–4 week window instead of 6–14", () => {
    const r = run({ sku: perishable, sales: flat(100), stock: stock(350) });
    expect(r.metrics.minWeeks).toBe(3);
    expect(r.metrics.maxWeeks).toBe(4);
    expect(r.inventoryRisk).toBe("within_range"); // would be stockout risk under the 6-week rule
  });

  it("7b. below the minimum requires planner review with no invented quantity", () => {
    const r = run({ sku: perishable, sales: flat(100), stock: stock(299) });
    expect(r.inventoryRisk).toBe("perishable_below_min");
    expect(r.action).toBe("REVIEW_REQUIRED");
    expect(r.recommendedQty).toBeNull();
    expect(r.exceptionCodes).toContain("PERISHABLE_QTY_POLICY_UNDEFINED");
  });

  it("7c. exactly 3 and exactly 4 weeks are within range", () => {
    expect(run({ sku: perishable, sales: flat(100), stock: stock(300) }).inventoryRisk).toBe("within_range");
    expect(run({ sku: perishable, sales: flat(100), stock: stock(400) }).inventoryRisk).toBe("within_range");
  });

  it("7d. above the maximum is flagged as potential overstock and pauses", () => {
    const r = run({ sku: perishable, sales: flat(100), stock: stock(401) });
    expect(r.inventoryRisk).toBe("perishable_above_max");
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
  });

  it("7e. perishable + high demand below minimum keeps the case's 1.5× quantity and flags overshoot", () => {
    const r = run({ sku: sku({ perishability: "High", standardReorderQty: 400 }), sales: sales(100, 150), stock: stock(200) });
    expect(r.action).toBe("REORDER_IMMEDIATE");
    expect(r.recommendedQty).toBe(600);
    expect(r.exceptionCodes).toContain("REORDER_MAY_EXCEED_PERISHABLE_MAX");
  });

  it("perishable matching is case-insensitive", () => {
    const r = run({ sku: sku({ perishability: "high" }), sales: flat(100), stock: stock(350) });
    expect(r.metrics.isPerishable).toBe(true);
  });
});

describe("Rule 4 — festival uplift", () => {
  it("8a. non-festival month: no uplift", () => {
    const r = run({ sales: flat(100), stock: stock(700) }, { calendar: NON_FESTIVAL });
    expect(r.metrics.festivalFactor).toBe(1);
    expect(r.metrics.forwardDemand).toBe(100);
    expect(r.metrics.weeksOfStock).toBe(7);
    expect(r.inventoryRisk).toBe("within_range");
  });

  it("8b. festival month: 25% uplift applied once to forward demand before threshold checks", () => {
    const r = run({ sales: flat(100), stock: stock(700) }, { calendar: FESTIVAL });
    expect(r.metrics.festivalFactor).toBe(1.25);
    expect(r.metrics.forwardDemand).toBe(125);
    expect(r.metrics.weeksOfStock).toBeCloseTo(5.6, 10); // not 700 / 156.25 (double uplift)
    expect(r.inventoryRisk).toBe("stockout_risk");
  });

  it("8c. festival month: exactly six weeks of uplifted demand is not stockout risk", () => {
    const r = run({ sales: flat(100), stock: stock(750) }, { calendar: FESTIVAL });
    expect(r.metrics.weeksOfStock).toBe(6);
    expect(r.inventoryRisk).toBe("within_range");
  });

  it("8d. default mode: uplift does not change the high-demand classification", () => {
    const off = run({ sales: sales(75, 99), stock: stock(800) }, { calendar: NON_FESTIVAL });
    const on = run({ sales: sales(75, 99), stock: stock(800) }, { calendar: FESTIVAL });
    expect(off.demandClass).toBe("normal");
    expect(on.demandClass).toBe("normal");
    expect(on.metrics.demandRatio).toBeCloseTo(off.metrics.demandRatio!, 10);
  });

  it("8e. 'recent_window_only' mode uplifts only the recent window for the demand test", () => {
    const r = run({ sales: flat(100), stock: stock(1000) }, { calendar: FESTIVAL, config: { festivalUpliftMode: "recent_window_only" } });
    expect(r.metrics.demandRatio).toBeCloseTo(1.25, 10);
    expect(r.demandClass).toBe("high_demand");
  });

  it("missing calendar month: no uplift and an explicit exception", () => {
    const r = run({ sales: flat(100), stock: stock(700) }, { calendar: new Map() });
    expect(r.metrics.isFestivalMonth).toBeNull();
    expect(r.metrics.festivalFactor).toBe(1);
    expect(r.exceptionCodes).toContain("CALENDAR_MONTH_MISSING");
    expect(r.requiresReview).toBe(true);
  });
});

describe("Data problems", () => {
  it("9a. zero sales: no division by zero, flagged as no recent demand", () => {
    const r = run({ sales: flat(0), stock: stock(500) });
    expect(r.metrics.weeksOfStock).toBeNull();
    expect(r.inventoryRisk).toBe("no_recent_demand");
    expect(r.action).toBe("REVIEW_REQUIRED");
    expect(r.recommendedQty).toBeNull();
    expect(r.exceptionCodes).toContain("NO_RECENT_DEMAND");
  });

  it("9b. missing sales weeks are not treated as zero", () => {
    const r = run({ sales: flat(100).slice(4), stock: stock(500) }); // only the latest 8 weeks
    expect(r.demandClass).toBe("insufficient_data");
    expect(r.metrics.baselineAvg).toBeNull();
    expect(r.metrics.recentAvg).toBe(100);
    expect(r.action).toBe("REVIEW_REQUIRED");
    expect(r.exceptionCodes).toContain("INSUFFICIENT_HISTORY");
  });

  it("9c. no sales at all (new product) goes to review", () => {
    const r = run({ sales: [], stock: stock(500) });
    expect(r.demandClass).toBe("insufficient_data");
    expect(r.action).toBe("REVIEW_REQUIRED");
  });

  it("10. missing inventory: no coverage, no quantity, review required", () => {
    const r = run({ sales: flat(100), stock: null });
    expect(r.metrics.currentStock).toBeNull();
    expect(r.inventoryRisk).toBe("insufficient_data");
    expect(r.action).toBe("REVIEW_REQUIRED");
    expect(r.recommendedQty).toBeNull();
    expect(r.exceptionCodes).toContain("MISSING_INVENTORY");
  });

  it("unmapped distributor is flagged but rules still run", () => {
    const r = run({ sku: sku({ distributor: null }), sales: flat(100), stock: stock(1000) });
    expect(r.exceptionCodes).toContain("INVALID_DISTRIBUTOR_MAPPING");
    expect(r.inventoryRisk).toBe("within_range");
  });
});

describe("13. Conflicting signals", () => {
  it("high demand + overstock: pause wins, no contradicting reorder, conflict escalated", () => {
    const r = run({ sales: sales(100, 150), stock: stock(5000) });
    expect(r.demandClass).toBe("high_demand");
    expect(r.inventoryRisk).toBe("overstock_risk");
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
    expect(r.recommendedQty).toBe(0);
    expect(r.exceptionCodes).toContain("CONFLICT_HIGH_DEMAND_VS_OVERSTOCK");
    expect(r.requiresReview).toBe(true);
  });
});

describe("Explainability and configuration", () => {
  it("returns a machine-readable trace of every step", () => {
    const r = run({ sales: sales(100, 150), stock: stock(300) });
    expect(r.steps.map((s) => s.step)).toEqual([
      "validate_inputs",
      "sales_windows",
      "baseline_demand",
      "festival_adjustment",
      "thresholds",
      "classify_demand",
      "classify_inventory",
      "recommendation",
    ]);
    expect(r.reason).toMatch(/High demand/);
  });

  it("windows end at the latest complete week before the snapshot", () => {
    const r = run({});
    expect(r.metrics.windowEndWeek).toBe("2026-W42");
    expect(r.metrics.recentWeeks).toEqual(["2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
    expect(r.metrics.baselineWeeks[0]).toBe("2026-W31");
  });

  it("thresholds come from configuration", () => {
    const r = run({ sales: flat(100), stock: stock(700) }, { config: { stockoutMinWeeks: 8 } });
    expect(r.inventoryRisk).toBe("stockout_risk");
  });

  it("rejects inconsistent configuration", () => {
    expect(() => parseRuleConfig({ recentWindowWeeks: 13 })).toThrow(/recent window/);
    expect(() => parseRuleConfig({ perishableMinWeeks: 5 })).toThrow(/perishable minimum/);
    expect(() => parseRuleConfig({ highDemandThresholdPct: -1 })).toThrow();
  });
});
