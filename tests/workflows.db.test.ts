import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Papa from "papaparse";
import { createTestDb } from "./helpers/db";
import { importDataset, importSeedFiles } from "../src/lib/server/imports";
import { createRun, saveRuleConfig } from "../src/lib/server/runs";
import { submitReview } from "../src/lib/server/reviews";
import { buildReport } from "../src/lib/server/exports";
import { getDataHealth, getLatestRun, getReviewStats, getRunRecommendations, getSkuDetail } from "../src/lib/server/queries";
import { escapeCell, toCsv } from "../src/lib/csv";
import { DEFAULT_RULE_CONFIG } from "../src/lib/rules/config";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

describe("Seed import", () => {
  it("imports all five supplied files with the expected counts", async () => {
    const out = await importSeedFiles(db, "test");
    expect(out.map((o) => [o.dataset, o.status, o.rowsTotal, o.inserted])).toEqual([
      ["distributors", "committed", 4, 4],
      ["skus", "committed", 15, 15],
      ["weekly_sales", "committed", 240, 240],
      ["inventory", "committed", 15, 15],
      ["calendar", "committed", 24, 24],
    ]);
    const raw = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM import_rows");
    expect(raw.rows[0].n).toBe(298); // original rows preserved
  });

  it("is repeatable without duplicates", async () => {
    const out = await importSeedFiles(db, "test");
    expect(out.every((o) => o.inserted === 0 && o.updated === 0)).toBe(true);
    const n = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM weekly_sales");
    expect(n.rows[0].n).toBe(240);
  });

  it("rejects a batch with any invalid row and leaves data untouched", async () => {
    const out = await importDataset(db, {
      dataset: "weekly_sales",
      text: "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,999\nSKU001,2026-W42,5\nSKU404,2026-W42,1\n",
      fileName: "bad.csv",
      source: "upload",
      actor: "test",
    });
    expect(out.status).toBe("rejected");
    expect(out.errors.map((e) => e.code)).toEqual(["DUPLICATE_KEY", "UNKNOWN_REFERENCE"]);
    const v = await db.query<{ units_sold: number }>("SELECT units_sold FROM weekly_sales WHERE sku_id='SKU001' AND iso_week='2026-W42'");
    expect(v.rows[0].units_sold).toBe(259);
    const errs = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM import_errors WHERE batch_id = $1", [out.batchId]);
    expect(errs.rows[0].n).toBe(2);
  });

  it("reports data health for the seed data", async () => {
    const h = await getDataHealth(db);
    expect(h.counts).toEqual({ skus: 15, distributors: 4, salesRows: 240, inventoryRows: 15, calendarMonths: 24 });
    expect(h.latestSnapshot).toEqual({ asOfDate: "2026-10-19", location: "Pune Central Warehouse", skuCount: 15 });
    expect(h.latestSalesWeek).toBe("2026-W42");
    expect(h.checks.find((c) => c.id === "sales_window_complete")?.status).toBe("pass");
    expect(h.checks.find((c) => c.id === "rejected_imports")?.status).toBe("warn");
  });
});

describe("Recommendation runs", () => {
  it("produces the documented outcome for the seed data", async () => {
    const { runId } = await createRun(db, { actor: "test" });
    const run = await getLatestRun(db);
    expect(run?.id).toBe(runId);
    expect(run?.asOfDate).toBe("2026-10-19");
    expect(run?.isFestivalMonth).toBe(true);
    const rows = await getRunRecommendations(db, runId);
    const by = Object.fromEntries(rows.map((r) => [r.skuId, r]));
    expect(by.SKU001).toMatchObject({ demandClass: "high_demand", inventoryRisk: "stockout_risk", action: "REORDER_IMMEDIATE", recommendedQty: 750, reviewStatus: "pending" });
    expect(by.SKU003).toMatchObject({ inventoryRisk: "stockout_risk", recommendedQty: 300 });
    expect(by.SKU004).toMatchObject({ inventoryRisk: "perishable_below_min", action: "REVIEW_REQUIRED", recommendedQty: null });
    expect(by.SKU006).toMatchObject({ inventoryRisk: "overstock_risk", action: "PAUSE_NEXT_ORDER", recommendedQty: 0 });
    expect(by.SKU007).toMatchObject({ inventoryRisk: "perishable_above_max", action: "PAUSE_NEXT_ORDER" });
    expect(by.SKU002).toMatchObject({ action: "NO_ACTION", reviewStatus: "not_required" });
    expect(run?.summary).toMatchObject({ skuCount: 15, highDemand: 1, stockoutRisk: 3, overstockRisk: 1, perishableBelowMin: 2, perishableAboveMax: 1 });
  });

  it("records the config used, so a new config only affects new runs", async () => {
    const before = await getLatestRun(db);
    await saveRuleConfig(db, { ...DEFAULT_RULE_CONFIG, stockoutMinWeeks: 5 }, "test change", "test");
    await saveRuleConfig(db, DEFAULT_RULE_CONFIG, "restore", "test");
    const stillOld = await getLatestRun(db);
    expect(stillOld?.config.stockoutMinWeeks).toBe(6);
    expect(stillOld?.id).toBe(before?.id);
  });
});

describe("15. Recommendation review", () => {
  let rows: Awaited<ReturnType<typeof getRunRecommendations>>;
  beforeAll(async () => {
    const { runId } = await createRun(db, { actor: "test" });
    rows = await getRunRecommendations(db, runId);
  });
  const rec = (sku: string) => rows.find((r) => r.skuId === sku)!;

  it("approves the calculated quantity", async () => {
    const r = await submitReview(db, { recommendationId: rec("SKU001").id, decision: "approve", reviewerName: "Raghav" });
    expect(r).toMatchObject({ reviewStatus: "approved", finalQty: 750 });
    const d = await db.query<{ identity_verified: boolean; reviewer_name: string }>("SELECT identity_verified, reviewer_name FROM review_decisions WHERE id=$1", [r.decisionId]);
    expect(d.rows[0]).toEqual({ identity_verified: false, reviewer_name: "Raghav" });
  });

  it("edits the quantity, keeping the original calculated value", async () => {
    const r = await submitReview(db, { recommendationId: rec("SKU003").id, decision: "edit", finalQty: 450, reason: "Distributor scheme next week" });
    expect(r).toMatchObject({ reviewStatus: "edited", finalQty: 450 });
    const d = await db.query<{ calculated_qty: number; final_qty: number }>("SELECT calculated_qty, final_qty FROM review_decisions WHERE id=$1", [r.decisionId]);
    expect(d.rows[0]).toEqual({ calculated_qty: 300, final_qty: 450 });
  });

  it("sets a quantity for a perishable exception through edit", async () => {
    const r = await submitReview(db, { recommendationId: rec("SKU004").id, decision: "edit", finalQty: 150, note: "Standard qty keeps cover inside 3–4 weeks" });
    expect(r.reviewStatus).toBe("edited");
  });

  it("rejects with a reason, and requires the reason", async () => {
    await expect(submitReview(db, { recommendationId: rec("SKU013").id, decision: "reject" })).rejects.toThrow(/reason is required/);
    const r = await submitReview(db, { recommendationId: rec("SKU013").id, decision: "reject", reason: "Stock transfer arriving from Mumbai" });
    expect(r).toMatchObject({ reviewStatus: "rejected", finalQty: null });
  });

  it("guards invalid decisions", async () => {
    await expect(submitReview(db, { recommendationId: rec("SKU011").id, decision: "approve" })).rejects.toThrow(/no calculated quantity/);
    await expect(submitReview(db, { recommendationId: rec("SKU006").id, decision: "edit", finalQty: 0, reason: "x" })).rejects.toThrow(/unchanged/);
    await expect(submitReview(db, { recommendationId: rec("SKU006").id, decision: "edit", finalQty: -3, reason: "x" })).rejects.toThrow(/negative/);
    await expect(submitReview(db, { recommendationId: rec("SKU006").id, decision: "edit", finalQty: 10 })).rejects.toThrow(/reason or note/);
  });

  it("adds a note without changing status", async () => {
    const r = await submitReview(db, { recommendationId: rec("SKU001").id, decision: "note", note: "Checked with procurement" });
    expect(r).toMatchObject({ reviewStatus: "approved", finalQty: 750 });
  });

  it("refuses reviews on superseded runs", async () => {
    const old = rec("SKU006");
    await createRun(db, { actor: "test" });
    await expect(submitReview(db, { recommendationId: old.id, decision: "approve" })).rejects.toThrow(/superseded/);
  });

  it("computes acceptance, edit and rejection rates", async () => {
    const stats = await getReviewStats(db, rows[0].runId);
    expect(stats).toMatchObject({ approved: 1, edited: 2, rejected: 1, reviewed: 4 });
    expect(stats.approvalRate).toBe(0.25);
    expect(stats.editRate).toBe(0.5);
  });

  it("shows history and decisions on the SKU detail view", async () => {
    const d = await getSkuDetail(db, "SKU001");
    expect(d?.sales).toHaveLength(16);
    expect(d?.history.length).toBeGreaterThanOrEqual(3);
    expect(d?.decisions.map((x) => x.decision)).toEqual(["note", "approved"]);
    expect(d?.latest?.steps.length).toBe(8);
  });
});

describe("16. CSV export accuracy", () => {
  it("escapes quotes, commas, newlines and formula prefixes", () => {
    expect(escapeCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(escapeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCell(-5)).toBe("-5");
    expect(escapeCell(null)).toBe("");
    const csv = toCsv([{ header: "a", value: (r: { a: string }) => r.a }], [{ a: "x\ny" }]);
    expect(Papa.parse(csv.trim(), { header: true }).data).toEqual([{ a: "x\ny" }]);
  });

  it("exports the recommendation table with values matching the database", async () => {
    const run = await getLatestRun(db);
    const rows = await getRunRecommendations(db, run!.id);
    const report = await buildReport(db, "recommendations");
    const parsed = Papa.parse<Record<string, string>>(report!.csv.trim(), { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(15);
    for (const r of rows) {
      const line = parsed.data.find((p) => p.SKU_ID === r.skuId)!;
      expect(line.Run_ID).toBe(String(run!.id));
      expect(line.Current_Stock).toBe(String(r.currentStock));
      expect(line.Calculated_Qty).toBe(r.recommendedQty === null ? "" : String(r.recommendedQty));
      expect(Number(line.Avg_12wk)).toBeCloseTo(r.baselineAvg!, 2);
      expect(line.Reason).toBe(r.reason);
    }
  });

  it("exports the review log, evaluation, data quality and weekly sales reports", async () => {
    for (const key of ["review-log", "backtest", "data-quality", "weekly-sales"] as const) {
      const r = await buildReport(db, key);
      const parsed = Papa.parse(r!.csv.trim(), { header: true });
      expect(parsed.errors).toEqual([]);
      expect(parsed.data.length).toBeGreaterThan(0);
    }
  });
});
