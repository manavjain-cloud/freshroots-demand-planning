# Pilot governance: pre-build decisions, Nine Checks, ownership

The same content is shown in the app under *Rules & Settings* (source: [`src/lib/governance.ts`](../src/lib/governance.ts)). Source for all baseline figures: the MESA Term 2 case brief "Deepa's 90-Day Mandate", Demand Planning initiative brief (prepared by Deepa Nair). Recorded 22 Oct 2026.

## Pre-build decisions

| Decision | Content |
|---|---|
| Outcome definition | Improve the timeliness and consistency of demand-planning recommendations and support better inventory decisions. |
| Baseline | ₹18–22 lakh/quarter stockout lost sales + ₹10–12 lakh/quarter overstock write-offs (₹28–34 lakh combined); monthly cycle; ~2 working days of preparation; forecast data 3–4 weeks old on arrival. Case estimates — not all losses are assumed preventable. |
| Workflow change | From monthly manual analysis to repeatable runs on organised data (the planner said twice a week would be feasible). The planner reviews flagged items and exceptions; procurement approval is still required before ordering. |
| Measurement plan | Over the 90-day pilot: baseline-method error vs actuals (WAPE, bias), stock-risk flags raised, approval / edit / rejection rates, time from run to review, data-quality issues per import, planner feedback on alert usefulness. |
| Kill criterion | **Numerical thresholds not yet agreed** — they must be set with the project owner before launch. Pause or redesign if recommendations are materially worse than the agreed baseline, rely on unreliable data, create unacceptable inventory risk or do not improve the workflow. |

## Nine Checks

| Group | Check | Assessment |
|---|---|---|
| Kill switch | Problem real? | Yes — quarterly stockout and overstock losses are documented. Used as rationale only; no reduction is claimed. |
| Kill switch | Workflow repeated? | Yes — monthly today. Runs are stored with inputs hash, config and engine version, so they repeat and audit. |
| Kill switch | Input available? | Partly — five seed files. SAP holds three years of distributor-level sales (exportable per IT). Open POs, lead times, prices and costs are not supplied and are shown as unavailable. |
| Sizing | Output valuable? | Demand classes, stock-risk flags and rule-based reorder recommendations with a visible calculation trace. |
| Sizing | Impact measurable? | Process measures captured from day one; business impact needs post-pilot actuals. |
| Sizing | ROI worth it? | Unknown. Exports support evaluation; no savings or ROI are claimed. |
| Boundary | Failure risk OK? | AI explains only; no autonomous ordering; every flagged item needs a human decision; approval ≠ purchase order. |
| Boundary | Judgment protected? | Exception queue for data gaps, perishable quantity gaps, rule conflicts and unusual weeks; planner can edit, reject or annotate anything. |
| Boundary | Owner clear? | Planner is the primary reviewer; other owners proposed below, not confirmed. |

## Ownership

| Area | Owner | Status |
|---|---|---|
| Recommendation review and exceptions | Senior Demand Planner (Raghav Kulkarni, per case) | Primary role in the app |
| Ordering / purchase orders | Procurement team | Outside this app |
| Rule configuration changes | Proposed: Demand Planner + Head of Operations sign-off | Not confirmed |
| Data quality and SAP exports | Proposed: IT team / data analyst | Not confirmed |
| Technical maintenance of this app | Not assigned | Open |
| Pilot sponsor | Head of Operations (Deepa Nair, per case) | Per case |

## Identity and access

No authentication provider is configured, so the app runs in an explicit **prototype review mode**: reviewer names are optional, self-declared and stored with `identity_verified = false`. An optional shared HTTP Basic password (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`) can restrict access to the site but does not identify individuals. Add a real identity provider before relying on decisions for accountability.
