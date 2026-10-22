import { z } from "zod";

/**
 * Central rule configuration. Every threshold used by the rule engine lives here
 * (defaults) and in the `rule_configs` table (active version). The UI never
 * hardcodes thresholds; it reads them from the active config.
 */
export const RuleConfigSchema = z.object({
  /** Rule 1: recent average must be MORE than this % above the baseline average. */
  highDemandThresholdPct: z.number().min(0).max(500),
  /** Rule 1: reorder multiplier applied to Standard_Reorder_Qty when high demand. */
  highDemandReorderMultiplier: z.number().min(1).max(10),
  /** Number of latest complete weeks in the "recent" window (case: 4). */
  recentWindowWeeks: z.number().int().min(1).max(52),
  /** Number of latest complete weeks in the baseline window (case: 12). Includes the recent weeks. */
  baselineWindowWeeks: z.number().int().min(1).max(104),
  /** Rule 2: non-perishable stockout-risk threshold in weeks of stock (strictly below). */
  stockoutMinWeeks: z.number().min(0).max(104),
  /** Rule 3: non-perishable overstock threshold in weeks of stock (strictly above). */
  overstockMaxWeeks: z.number().min(0).max(208),
  /** Rule 5: perishable minimum weeks of stock (strictly below = risk). */
  perishableMinWeeks: z.number().min(0).max(52),
  /** Rule 5: perishable maximum weeks of stock (strictly above = potential overstock). */
  perishableMaxWeeks: z.number().min(0).max(52),
  /** Perishability values that receive the tighter perishable window. Seed data uses Low/High. */
  perishableValues: z.array(z.string().min(1)).min(1),
  /** Rule 4: festival-month demand uplift in percent (case: 25). */
  festivalUpliftPct: z.number().min(0).max(500),
  /**
   * Rule 4 sequencing.
   * - "forward_demand" (default): the uplift multiplies the demand used for stock-coverage
   *   checks, once. The high-demand test compares the two historical windows like for like,
   *   so the uplift cannot change that classification.
   * - "recent_window_only": the uplift is also applied to the recent window only before the
   *   high-demand comparison. Not recommended: in a festival month almost every SKU flags.
   */
  festivalUpliftMode: z.enum(["forward_demand", "recent_window_only"]),
  /** Which average is the "average weekly sales" for stock coverage. */
  coverageDemandBasis: z.enum(["baseline_avg", "recent_avg"]),
  /** Rounding applied to fractional reorder quantities. The raw value is always stored. */
  roundingMode: z.enum(["ceil", "round", "floor"]),
  /**
   * Proposed planner-attention signal (NOT a case rule): latest week deviates from the
   * baseline average by more than this percent. null disables it.
   */
  unusualWeekDeviationPct: z.number().min(1).max(1000).nullable(),
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  highDemandThresholdPct: 20,
  highDemandReorderMultiplier: 1.5,
  recentWindowWeeks: 4,
  baselineWindowWeeks: 12,
  stockoutMinWeeks: 6,
  overstockMaxWeeks: 14,
  perishableMinWeeks: 3,
  perishableMaxWeeks: 4,
  perishableValues: ["High"],
  festivalUpliftPct: 25,
  festivalUpliftMode: "forward_demand",
  coverageDemandBasis: "baseline_avg",
  roundingMode: "ceil",
  unusualWeekDeviationPct: 30,
};

/** Which config values come straight from the case and which are implementation choices. */
export const CONFIG_PROVENANCE: Record<keyof RuleConfig, { source: "case" | "assumption" | "proposed"; label: string; note: string }> = {
  highDemandThresholdPct: { source: "case", label: "High-demand threshold (%)", note: "Case: last 4 weeks more than 20% above the 12-week average." },
  highDemandReorderMultiplier: { source: "case", label: "High-demand reorder multiplier", note: "Case: reorder at 1.5x the standard quantity." },
  recentWindowWeeks: { source: "case", label: "Recent window (weeks)", note: "Case: last 4 weeks." },
  baselineWindowWeeks: { source: "case", label: "Baseline window (weeks)", note: "Case: 12-week average. Assumption: the 12 weeks include the latest 4." },
  stockoutMinWeeks: { source: "case", label: "Stockout threshold (weeks of stock)", note: "Case: below 6 weeks of average weekly sales." },
  overstockMaxWeeks: { source: "case", label: "Overstock threshold (weeks of stock)", note: "Case: above 14 weeks of average weekly sales." },
  perishableMinWeeks: { source: "case", label: "Perishable minimum (weeks)", note: "Case: high-perishability SKUs, minimum 3 weeks." },
  perishableMaxWeeks: { source: "case", label: "Perishable maximum (weeks)", note: "Case: high-perishability SKUs, maximum 4 weeks." },
  perishableValues: { source: "assumption", label: "Perishability values treated as perishable", note: "Seed data uses Low/High; 'High' maps to the case's high-perishability SKUs." },
  festivalUpliftPct: { source: "case", label: "Festival uplift (%)", note: "Case: 25% uplift in October, November and March, before threshold checks." },
  festivalUpliftMode: { source: "assumption", label: "Festival uplift sequencing", note: "Assumption: uplift applied once to forward demand for coverage checks." },
  coverageDemandBasis: { source: "assumption", label: "Average used for stock coverage", note: "Assumption: the 12-week average is the case's 'average weekly sales'. Needs planner confirmation." },
  roundingMode: { source: "assumption", label: "Quantity rounding", note: "Assumption: round fractional quantities up to whole units. Raw value is stored." },
  unusualWeekDeviationPct: { source: "proposed", label: "Unusual-week attention signal (%)", note: "Not a case rule. Proposed signal that routes a SKU to the exception queue; not approved." },
};

export function parseRuleConfig(value: unknown): RuleConfig {
  const merged = { ...DEFAULT_RULE_CONFIG, ...(typeof value === "object" && value ? value : {}) };
  const result = RuleConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid rule configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const cfg = result.data;
  if (cfg.recentWindowWeeks > cfg.baselineWindowWeeks) {
    throw new Error("Invalid rule configuration: recent window cannot be longer than the baseline window.");
  }
  if (cfg.perishableMinWeeks > cfg.perishableMaxWeeks) {
    throw new Error("Invalid rule configuration: perishable minimum cannot exceed the maximum.");
  }
  if (cfg.stockoutMinWeeks > cfg.overstockMaxWeeks) {
    throw new Error("Invalid rule configuration: stockout threshold cannot exceed the overstock threshold.");
  }
  return cfg;
}

export const ENGINE_VERSION = "1.0.0";
