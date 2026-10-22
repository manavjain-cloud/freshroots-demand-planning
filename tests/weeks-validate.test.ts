import { describe, expect, it } from "vitest";
import { formatIsoDate, isoWeekMonth, isoWeekStart, latestCompleteWeek, parseIsoWeek, shiftIsoWeek, weekWindow } from "../src/lib/weeks";
import { validateDataset, type ReferenceSets } from "../src/lib/imports/validate";

describe("ISO week helpers", () => {
  it("maps seed weeks to dates", () => {
    expect(formatIsoDate(isoWeekStart("2026-W27"))).toBe("2026-06-29");
    expect(formatIsoDate(isoWeekStart("2026-W42"))).toBe("2026-10-12");
    expect(latestCompleteWeek("2026-10-19")).toBe("2026-W42");
    expect(latestCompleteWeek("2026-10-18")).toBe("2026-W41"); // Sunday of W42 is not complete yet
    expect(isoWeekMonth("2026-W40")).toBe("2026-10"); // Thursday 1 Oct
    expect(isoWeekMonth("2026-W39")).toBe("2026-09");
  });

  it("handles year boundaries and invalid weeks", () => {
    expect(shiftIsoWeek("2026-W01", -1)).toBe("2025-W52");
    expect(parseIsoWeek("2026-W53")).toEqual({ year: 2026, week: 53 }); // 1 Jan 2026 is a Thursday → 53 weeks
    expect(parseIsoWeek("2025-W53")).toBeNull();
    expect(parseIsoWeek("2026-W00")).toBeNull();
    expect(parseIsoWeek("2026-42")).toBeNull();
    expect(weekWindow("2026-W02", 3)).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
  });
});

const refs: ReferenceSets = { distributorIds: new Set(["DIST001"]), skuIds: new Set(["SKU001", "SKU002"]) };

describe("CSV validation", () => {
  it("accepts a clean sales file", () => {
    const v = validateDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nSKU001,2026-W27,194\nSKU002,2026-W27,86\n", refs);
    expect(v.errors).toEqual([]);
    expect(v.validRows).toHaveLength(2);
    expect(v.validRows[0].row).toEqual({ skuId: "SKU001", week: "2026-W27", weekStart: "2026-06-29", unitsSold: 194 });
  });

  it("11. detects duplicate sales rows at the SKU + week grain", () => {
    const v = validateDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nSKU001,2026-W27,194\nSKU001,2026-W27,200\n", refs);
    expect(v.errors.map((e) => e.code)).toEqual(["DUPLICATE_KEY"]);
    expect(v.errors[0].rowNumber).toBe(3);
    expect(v.errors[0].message).toMatch(/first seen on line 2/);
    expect(v.validRows).toHaveLength(1);
  });

  it("12a. rejects unknown SKU references and flags case mismatches", () => {
    const v = validateDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nSKU999,2026-W27,5\nsku001,2026-W28,5\n", refs);
    expect(v.errors.map((e) => e.code)).toEqual(["UNKNOWN_REFERENCE", "ID_CASE_MISMATCH"]);
    expect(v.validRows).toHaveLength(0);
  });

  it("12b. rejects SKUs pointing to an unknown distributor", () => {
    const v = validateDataset(
      "skus",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nSKU003,X,Snack,Low,100,Units,DIST404\n",
      refs,
    );
    expect(v.errors[0]).toMatchObject({ code: "UNKNOWN_REFERENCE", column: "Distributor_ID", rowNumber: 2 });
  });

  it("rejects negative, non-numeric and missing values", () => {
    const v = validateDataset(
      "inventory",
      "SKU_ID,Location,Units_On_Hand,As_Of_Date\nSKU001,Pune,-5,2026-10-19\nSKU002,Pune,12.5,2026-10-19\nSKU001,,10,2026-10-19\nSKU002,Pune,10,2026-02-30\n",
      refs,
    );
    expect(v.errors.map((e) => e.code)).toEqual(["NEGATIVE_VALUE", "INVALID_NUMBER", "MISSING_VALUE", "INVALID_DATE"]);
  });

  it("rejects files with missing required columns", () => {
    const v = validateDataset("weekly_sales", "SKU_ID,Units\nSKU001,4\n", refs);
    expect(v.errors[0].code).toBe("MISSING_COLUMNS");
    expect(v.validRows).toHaveLength(0);
  });

  it("validates calendar booleans and Year_Month consistency", () => {
    const v = validateDataset("calendar", "Year,Month,Year_Month,Is_Festival_Month\n2026,10,2026-10,TRUE\n2026,11,2026-12,FALSE\n2026,3,2026-03,maybe\n", refs);
    expect(v.validRows).toHaveLength(1);
    expect(v.errors.map((e) => e.code)).toEqual(["INCONSISTENT_VALUE", "INVALID_BOOLEAN"]);
  });

  it("rejects invalid ISO weeks and perishability values", () => {
    const sales = validateDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nSKU001,2026-W60,5\n", refs);
    expect(sales.errors[0].code).toBe("INVALID_WEEK");
    const skus = validateDataset(
      "skus",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nSKU003,X,Snack,Extreme,0,Units,DIST001\n",
      refs,
    );
    expect(skus.errors.map((e) => e.code)).toEqual(["INVALID_VALUE", "INVALID_NUMBER"]);
  });

  it("strips a UTF-8 BOM and warns about trimmed whitespace and extra columns", () => {
    const v = validateDataset("distributors", "﻿Distributor_ID,Distributor_Name,Region,Status,Notes\n DIST009 ,Name,Goa,active,x\n", refs);
    expect(v.errors).toEqual([]);
    expect(v.validRows[0].row).toEqual({ distributorId: "DIST009", distributorName: "Name", region: "Goa", status: "Active" });
    expect(v.warnings.map((w) => w.code).sort()).toEqual(["EXTRA_COLUMNS", "TRIMMED_WHITESPACE"]);
  });
});
