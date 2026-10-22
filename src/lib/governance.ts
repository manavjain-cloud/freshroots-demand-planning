/**
 * Pilot governance content. Sources are the MESA Term 2 case brief ("Deepa's 90-Day
 * Mandate", Demand Planning initiative brief). Nothing here claims results.
 */

export const BASELINE_SOURCE = "Case brief: Demand Planning initiative, prepared by Deepa Nair (MESA AI-Native Track, Term 2)";
export const BASELINE_RECORDED_ON = "2026-10-22";

export const BASELINE = [
  { metric: "Stockout-related lost sales", value: "₹18–22 lakh per quarter", note: "Case estimate. Not all of it is necessarily preventable." },
  { metric: "Overstock write-offs (mainly perishables)", value: "₹10–12 lakh per quarter", note: "Case estimate." },
  { metric: "Combined demand-planning losses", value: "₹28–34 lakh per quarter", note: "Case estimate; the business rationale, not a promised saving." },
  { metric: "Planning cycle", value: "Monthly", note: "Manual, run by the Senior Demand Planner." },
  { metric: "Forecast preparation effort", value: "~2 working days per month", note: "400 active SKUs across 1,200 distributors." },
  { metric: "Data age when procurement receives the forecast", value: "3–4 weeks", note: "Case statement." },
  { metric: "Share of recommendations covered by documented rules", value: "~80–85% (planner's estimate)", note: "The remaining 15–20% is judgment: launches, unusual distributor behaviour, one-off events." },
];

export const PRE_BUILD_DECISIONS = [
  { title: "Outcome definition", body: "Improve the timeliness and consistency of demand-planning recommendations and support better inventory decisions." },
  { title: "Baseline", body: "₹28–34 lakh quarterly loss estimate, monthly planning cycle, ~2 working days of preparation and 3–4-week data age, all from the case brief (recorded 22 Oct 2026). Not all reported losses are assumed preventable." },
  { title: "Workflow change", body: "Move from monthly manual analysis to repeatable runs on organised data (the planner suggested twice a week is feasible). The planner reviews every flagged recommendation and exception; procurement approval is still required before any order." },
  { title: "Measurement plan", body: "Over the 90-day pilot, track: baseline-method error vs actuals (WAPE, bias), stock-risk flags raised, recommendation approval / edit / rejection rates, time from run to review, data-quality issues per import and planner feedback on alert usefulness." },
  { title: "Kill criterion", body: "Numerical thresholds must be agreed with the project owner before launch — none are approved yet. Pause or redesign if recommendations are materially worse than the agreed baseline, rely on unreliable data, create unacceptable inventory risk or fail to improve the target workflow." },
];

export const NINE_CHECKS = [
  { group: "Kill switch", check: "Problem real?", answer: "Yes — the case documents ₹18–22 lakh/quarter stockout losses and ₹10–12 lakh/quarter overstock write-offs. Used as rationale only; the tool has not yet reduced any loss." },
  { group: "Kill switch", check: "Workflow repeated?", answer: "Yes — demand planning is a recurring monthly process. Every run here is stored with its inputs, configuration and engine version so it can be repeated and audited." },
  { group: "Kill switch", check: "Input available?", answer: "Partly — five seed files (15 SKUs, 16 weeks, 4 distributors, one snapshot). SAP holds three years of distributor-level sales that IT can export. Open POs, lead times, prices and costs are not supplied and are shown as unavailable." },
  { group: "Sizing", check: "Output valuable?", answer: "Demand classification, stock-risk flags and rule-based reorder recommendations with a full calculation trace, for planner review." },
  { group: "Sizing", check: "Impact measurable?", answer: "Review outcomes, review time, flags and baseline-method error are captured from day one. Business impact (lost sales, write-offs) needs post-pilot actuals that are not in the seed data." },
  { group: "Sizing", check: "ROI worth it?", answer: "Not yet known. The app exports evidence (recommendations, decisions, evaluation, data quality) to support the evaluation. No savings or ROI figures are claimed." },
  { group: "Boundary", check: "Failure risk OK?", answer: "Contained — the AI explains but never sets quantities or classifications, and nothing is ordered automatically. Every flagged item requires human review; approval does not create a purchase order." },
  { group: "Boundary", check: "Judgment protected?", answer: "Yes — an exception queue routes insufficient data, perishable quantity gaps, rule conflicts and unusual weeks to the planner, who can edit, reject or annotate any recommendation." },
  { group: "Boundary", check: "Owner clear?", answer: "Partly — the Senior Demand Planner is the primary reviewer. Owners for data quality, rule configuration and technical maintenance are proposed below but not yet confirmed." },
];

export const OWNERSHIP = [
  { area: "Recommendation review and exceptions", owner: "Senior Demand Planner (Raghav Kulkarni, per case)", status: "Primary role in this app" },
  { area: "Ordering decisions / purchase orders", owner: "Procurement team", status: "Outside this app; approval here is not a PO" },
  { area: "Rule configuration changes", owner: "Proposed: Demand Planner with Head of Operations sign-off", status: "Not confirmed" },
  { area: "Data quality and SAP exports", owner: "Proposed: IT team (3 people) / data analyst", status: "Not confirmed" },
  { area: "Technical maintenance of this app", owner: "Not assigned", status: "Open" },
  { area: "Pilot sponsor", owner: "Head of Operations (Deepa Nair, per case)", status: "Per case brief" },
];

export const OPEN_POLICY_DECISIONS = [
  { id: "P1", question: "Which 'average weekly sales' drives stock coverage?", current: "12-week average (configurable to 4-week).", why: "The case does not say. The 4-week average reacts faster but already contains festival weeks." },
  { id: "P2", question: "What reorder quantity applies to perishable SKUs below the 3-week minimum?", current: "No quantity — planner sets it (unless the high-demand rule applies).", why: "The case defines the window but not the quantity." },
  { id: "P3", question: "What quantity is an 'immediate reorder' for stockout risk without high demand?", current: "Standard_Reorder_Qty × 1, flagged if it would not restore minimum cover.", why: "The case says 'recommend an immediate reorder' without a quantity." },
  { id: "P4", question: "Which month decides the festival uplift?", current: "The month of the inventory snapshot (planning month).", why: "A coverage horizon can cross into a festival month; the case does not specify." },
  { id: "P5", question: "Should baseline weeks that fall in festival months be adjusted?", current: "No adjustment; the count of such weeks is shown on each SKU.", why: "With 16 weeks of history, three October weeks sit inside the 12-week baseline." },
  { id: "P6", question: "Is high demand allowed to override an overstock pause?", current: "No — pause wins and the conflict is escalated to the planner.", why: "The two rules conflict; the case gives no precedence." },
  { id: "P7", question: "Is the 'unusual latest week' signal (30% deviation) wanted?", current: "Proposed signal only, can be disabled.", why: "Not a case rule; intended to surface the judgment cases Raghav describes." },
  { id: "P8", question: "What are the numerical kill-criterion thresholds?", current: "Not set.", why: "Must be agreed with the project owner before launch." },
];

export const RULE_PRECEDENCE = [
  { code: "P0", label: "Data validation", body: "Missing inventory, incomplete sales windows or zero demand → no quantity; planner review." },
  { code: "P1", label: "Overstock pause", body: "Stock above the applicable maximum → pause next order. Never contradicted by a reorder; a high-demand signal is escalated as a conflict." },
  { code: "P2", label: "Below minimum", body: "Non-perishable → immediate reorder (1.5× standard if high demand, else standard). Perishable → planner sets quantity unless high demand applies." },
  { code: "P3", label: "High demand", body: "Within range but high demand → reorder at 1.5× standard." },
  { code: "P4", label: "No action", body: "No rule triggered → no change to the normal cycle; no review needed unless an exception is raised." },
];
