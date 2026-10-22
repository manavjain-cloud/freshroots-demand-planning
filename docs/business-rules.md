# Business rules — implementation notes

The rule engine is a single pure TypeScript module: [`src/lib/rules/engine.ts`](../src/lib/rules/engine.ts).
Thresholds come only from the active rule configuration ([`src/lib/rules/config.ts`](../src/lib/rules/config.ts) defaults, versioned in the `rule_configs` table). No page or component re-implements a rule. Gemini never calculates or overrides anything.

## Source rules (case brief, documented by the Senior Demand Planner)

| # | Rule (case wording, paraphrased) | Config keys |
|---|---|---|
| 1 | Last 4 weeks more than 20% above the 12-week average → high demand, reorder at 1.5× standard quantity | `highDemandThresholdPct`, `highDemandReorderMultiplier`, `recentWindowWeeks`, `baselineWindowWeeks` |
| 2 | Stock below 6 weeks of average weekly sales → stockout risk, immediate reorder | `stockoutMinWeeks` |
| 3 | Stock above 14 weeks of average weekly sales → overstock risk, pause next order | `overstockMaxWeeks` |
| 4 | October, November, March → 25% demand uplift before any threshold checks | `festivalUpliftPct`, `festivalUpliftMode` |
| 5 | High-perishability SKUs: minimum 3, maximum 4 weeks of stock | `perishableMinWeeks`, `perishableMaxWeeks`, `perishableValues` |

## Calculation sequence (per SKU, per run)

1. **Validate inputs.** Sales must exist for every week in the window (missing weeks are *not* zero), a stock row must exist at the selected snapshot, the planning month should be in the calendar.
2. **Windows.** The window ends at the latest ISO week fully complete before the inventory snapshot date. Snapshot 2026-10-19 (a Monday) → window ends 2026-W42 (12–18 Oct). Recent = W39–W42; baseline = W31–W42 (the 12 weeks include the recent 4).
3. **Baseline demand.** `avg4 = sum(recent) / 4`, `avg12 = sum(baseline) / 12`.
4. **Festival adjustment.** Planning month = month of the snapshot date (2026-10). If the calendar marks it as a festival month, `forwardDemand = coverageBase × 1.25`, applied **once**. `coverageBase` is `avg12` by default (configurable to `avg4`).
5. **Thresholds.** Perishable (`Perishability = High` in the seed) → 3–4 weeks; otherwise 6–14 weeks.
6. **Classify.**
   - Demand: `highDemand = avg4 > avg12 × 1.20` (strict; exactly 20% is *not* high demand). In the default mode the uplift multiplies both windows equally, so it cannot change this classification.
   - Inventory: `weeksOfStock = stock / forwardDemand`; strictly below min → stockout risk / below perishable minimum; strictly above max → overstock / above perishable maximum. Exactly 6.0 or 14.0 weeks is within range. Zero demand → "no recent demand" (no division by zero).
7. **Recommend** using the precedence below.
8. **Explain.** Every step is returned as a machine-readable trace (`steps`) and stored with the recommendation, alongside a deterministic plain-language `reason`.

Floating-point comparisons use a relative tolerance of 1e-9 so values that are mathematically equal to a threshold are never flagged.

## Precedence (deterministic)

| Code | Condition | Action | Quantity |
|---|---|---|---|
| P0 | Inputs incomplete (no stock row, missing weeks, zero demand) | Planner review | None |
| P1 | Stock above applicable maximum | Pause next order | 0 — never contradicted by a reorder; a simultaneous high-demand signal raises `CONFLICT_HIGH_DEMAND_VS_OVERSTOCK` |
| P2 | Stock below applicable minimum | Immediate reorder | Non-perishable: 1.5× standard if high demand, else 1× standard. Perishable: 1.5× standard if high demand; otherwise **no quantity** — planner sets it (`PERISHABLE_QTY_POLICY_UNDEFINED`) |
| P3 | Within range and high demand | Reorder | 1.5× standard |
| P4 | Nothing triggered | No action | — (no review needed unless an exception is raised) |

Quantities are rounded **up** to whole units (configurable); the unrounded value is stored as `recommended_qty_raw`.

Additional exception flags (route the SKU to the exception queue, never change the quantity):

- `STANDARD_QTY_MAY_NOT_RESTORE_COVER` — after the rule quantity, projected cover is still below the minimum.
- `REORDER_MAY_EXCEED_PERISHABLE_MAX` — a perishable reorder would push cover above the maximum.
- `UNUSUAL_LATEST_WEEK` — **proposed** signal, not a case rule: latest week deviates > 30% from the 12-week average. Can be disabled.
- `INVALID_DISTRIBUTOR_MAPPING`, `INACTIVE_DISTRIBUTOR`, `CALENDAR_MONTH_MISSING`, `MISSING_INVENTORY`, `INSUFFICIENT_HISTORY`, `NO_RECENT_DEMAND`.

Projected cover ignores lead times and open purchase orders because neither is supplied.

## Result on the supplied seed data (snapshot 19 Oct 2026, October = festival month)

| SKU | Outcome |
|---|---|
| SKU001 Mango Drink | High demand (+21.4%) and stockout risk (3.35 wks) → immediate reorder **750** (1.5 × 500) |
| SKU003 Brown Rice, SKU013 Peanut Butter | Stockout risk → immediate reorder at standard qty (300, 120); flagged that this may not restore 6 weeks of cover |
| SKU004 Almond Milk, SKU011 Multigrain Bread | Perishable below 3 weeks (1.8 wks) → planner sets quantity |
| SKU006 Quinoa | Overstock (22.2 wks) → pause next order |
| SKU007 Coconut Water | Perishable above 4 weeks (4.08 wks) → pause next order |
| Other 8 SKUs | Within range, no action |

These are rule outputs for planner review, not validated forecasts.

## Open policy decisions (need planner / owner sign-off)

See *Rules & Settings → Open policy decisions* in the app, or [`src/lib/governance.ts`](../src/lib/governance.ts). In short: which average drives coverage (P1), perishable quantity below minimum (P2), quantity for a plain stockout reorder (P3), which month decides the festival uplift (P4), festival weeks inside the baseline (P5), high demand vs overstock (P6), the proposed unusual-week signal (P7), and numerical kill-criterion thresholds (P8).

## Tests

[`tests/engine.test.ts`](../tests/engine.test.ts) covers just-below / exactly-at / above the 20% threshold, coverage just below / exactly at 6 weeks, exactly 14 and above 14 weeks, perishable windows (including exactly 3 and 4), festival vs non-festival months, single application of the uplift, both uplift modes, zero and missing sales, missing inventory, unmapped distributors, the high-demand-vs-overstock conflict, rounding, the trace and configuration validation.
