import Papa from "papaparse";
import { formatIsoDate, isoWeekStart, parseIsoDate, parseIsoWeek } from "../weeks";

export const DATASETS = ["distributors", "skus", "weekly_sales", "inventory", "calendar"] as const;
export type Dataset = (typeof DATASETS)[number];

export const DATASET_INFO: Record<Dataset, { label: string; seedFile: string; columns: string[]; grain: string; order: number }> = {
  distributors: { label: "Distributor master", seedFile: "Distributor Seed Data.csv", columns: ["Distributor_ID", "Distributor_Name", "Region", "Status"], grain: "Distributor_ID", order: 1 },
  skus: { label: "SKU master", seedFile: "SKU Seed Data.csv", columns: ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"], grain: "SKU_ID", order: 2 },
  weekly_sales: { label: "Weekly sales", seedFile: "Weekly Sales Seed Data.csv", columns: ["SKU_ID", "Week", "Units_Sold"], grain: "SKU_ID + Week", order: 3 },
  inventory: { label: "Current inventory", seedFile: "Current Inventory Seed Data.csv", columns: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"], grain: "SKU_ID + Location + As_Of_Date", order: 4 },
  calendar: { label: "Calendar", seedFile: "Calendar Seed Data.csv", columns: ["Year", "Month", "Year_Month", "Is_Festival_Month"], grain: "Year + Month", order: 5 },
};

export const ALLOWED_PERISHABILITY = ["Low", "Medium", "High"];
export const ALLOWED_DISTRIBUTOR_STATUS = ["Active", "Inactive"];

export interface RowIssue {
  rowNumber: number | null; // file line number (header = line 1); null = file-level
  column: string | null;
  code: string;
  message: string;
}

export interface DistributorRow { distributorId: string; distributorName: string; region: string; status: string }
export interface SkuRow { skuId: string; skuName: string; category: string; perishability: string; standardReorderQty: number; unitOfMeasure: string; distributorId: string }
export interface SalesRow { skuId: string; week: string; weekStart: string; unitsSold: number }
export interface InventoryRow { skuId: string; location: string; unitsOnHand: number; asOfDate: string }
export interface CalendarRow { year: number; month: number; yearMonth: string; isFestivalMonth: boolean }

export type DatasetRow<D extends Dataset> = D extends "distributors"
  ? DistributorRow
  : D extends "skus"
    ? SkuRow
    : D extends "weekly_sales"
      ? SalesRow
      : D extends "inventory"
        ? InventoryRow
        : CalendarRow;

export interface ValidationResult<D extends Dataset = Dataset> {
  dataset: D;
  rowsTotal: number;
  validRows: { rowNumber: number; row: DatasetRow<D> }[];
  rawRows: { rowNumber: number; raw: Record<string, string>; valid: boolean }[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

/** Known IDs used to check foreign-key references. */
export interface ReferenceSets {
  distributorIds: Set<string>;
  skuIds: Set<string>;
}

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[]; parseErrors: RowIssue[] } {
  const clean = text.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const parseErrors: RowIssue[] = parsed.errors.map((e) => ({
    rowNumber: typeof e.row === "number" ? e.row + 2 : null,
    column: null,
    code: "CSV_PARSE_ERROR",
    message: e.message,
  }));
  return { headers: parsed.meta.fields ?? [], rows: parsed.data, parseErrors };
}

const INT_RE = /^-?\d+$/;

function req(raw: Record<string, string>, col: string, rowNumber: number, errors: RowIssue[]): string | null {
  const v = (raw[col] ?? "").trim();
  if (v === "") {
    errors.push({ rowNumber, column: col, code: "MISSING_VALUE", message: `${col} is empty.` });
    return null;
  }
  return v;
}

function int(raw: Record<string, string>, col: string, rowNumber: number, errors: RowIssue[], opts: { min?: number; positive?: boolean } = {}): number | null {
  const v = req(raw, col, rowNumber, errors);
  if (v === null) return null;
  if (!INT_RE.test(v)) {
    errors.push({ rowNumber, column: col, code: "INVALID_NUMBER", message: `${col} must be a whole number (got "${v}").` });
    return null;
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    errors.push({ rowNumber, column: col, code: "INVALID_NUMBER", message: `${col} is out of range.` });
    return null;
  }
  if (n < 0) {
    errors.push({ rowNumber, column: col, code: "NEGATIVE_VALUE", message: `${col} cannot be negative (got ${n}).` });
    return null;
  }
  if (opts.positive && n === 0) {
    errors.push({ rowNumber, column: col, code: "INVALID_NUMBER", message: `${col} must be greater than zero.` });
    return null;
  }
  return n;
}

function refCheck(id: string, known: Set<string>, col: string, label: string, rowNumber: number, errors: RowIssue[]): boolean {
  if (known.has(id)) return true;
  const caseMatch = [...known].find((k) => k.toLowerCase() === id.toLowerCase());
  errors.push({
    rowNumber,
    column: col,
    code: caseMatch ? "ID_CASE_MISMATCH" : "UNKNOWN_REFERENCE",
    message: caseMatch ? `${col} "${id}" differs only in case from known ${label} "${caseMatch}".` : `${col} "${id}" does not exist in the ${label} master.`,
  });
  return false;
}

function whitespaceWarning(raw: Record<string, string>, cols: string[], rowNumber: number, warnings: RowIssue[]) {
  for (const c of cols) {
    const v = raw[c];
    if (typeof v === "string" && v !== v.trim() && v.trim() !== "") {
      warnings.push({ rowNumber, column: c, code: "TRIMMED_WHITESPACE", message: `${c} had leading/trailing spaces; they were trimmed.` });
    }
  }
}

/**
 * Validate one dataset's CSV text. Pure: no database access.
 * `refs` must contain IDs already in the database plus any being imported in the same batch.
 */
export function validateDataset<D extends Dataset>(dataset: D, text: string, refs: ReferenceSets): ValidationResult<D> {
  const info = DATASET_INFO[dataset];
  const { headers, rows, parseErrors } = parseCsvText(text);
  const errors: RowIssue[] = [...parseErrors];
  const warnings: RowIssue[] = [];
  const validRows: { rowNumber: number; row: DatasetRow<D> }[] = [];
  const rawRows: { rowNumber: number; raw: Record<string, string>; valid: boolean }[] = [];

  const missingCols = info.columns.filter((c) => !headers.includes(c));
  if (headers.length === 0 || rows.length === 0) {
    errors.push({ rowNumber: null, column: null, code: "EMPTY_FILE", message: "The file has no header or no data rows." });
  }
  if (missingCols.length) {
    errors.push({ rowNumber: null, column: missingCols.join(", "), code: "MISSING_COLUMNS", message: `Required columns missing: ${missingCols.join(", ")}. Expected: ${info.columns.join(", ")}.` });
    return { dataset, rowsTotal: rows.length, validRows, rawRows: rows.map((raw, i) => ({ rowNumber: i + 2, raw, valid: false })), errors, warnings };
  }
  const extra = headers.filter((h) => !info.columns.includes(h));
  if (extra.length) warnings.push({ rowNumber: null, column: extra.join(", "), code: "EXTRA_COLUMNS", message: `Columns ignored: ${extra.join(", ")}.` });

  const seenKeys = new Map<string, number>();

  rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const before = errors.length;
    whitespaceWarning(raw, info.columns, rowNumber, warnings);
    let row: DatasetRow<D> | null = null;
    let key: string | null = null;

    if (dataset === "distributors") {
      const id = req(raw, "Distributor_ID", rowNumber, errors);
      const name = req(raw, "Distributor_Name", rowNumber, errors);
      const region = req(raw, "Region", rowNumber, errors);
      const statusRaw = req(raw, "Status", rowNumber, errors);
      const status = statusRaw ? ALLOWED_DISTRIBUTOR_STATUS.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) : undefined;
      if (statusRaw && !status) errors.push({ rowNumber, column: "Status", code: "INVALID_VALUE", message: `Status must be one of ${ALLOWED_DISTRIBUTOR_STATUS.join(", ")} (got "${statusRaw}").` });
      key = id;
      if (id && name && region && status) row = { distributorId: id, distributorName: name, region, status } as DatasetRow<D>;
    } else if (dataset === "skus") {
      const id = req(raw, "SKU_ID", rowNumber, errors);
      const name = req(raw, "SKU_Name", rowNumber, errors);
      const category = req(raw, "Category", rowNumber, errors);
      const perRaw = req(raw, "Perishability", rowNumber, errors);
      const per = perRaw ? ALLOWED_PERISHABILITY.find((p) => p.toLowerCase() === perRaw.toLowerCase()) : undefined;
      if (perRaw && !per) errors.push({ rowNumber, column: "Perishability", code: "INVALID_VALUE", message: `Perishability must be one of ${ALLOWED_PERISHABILITY.join(", ")} (got "${perRaw}").` });
      const qty = int(raw, "Standard_Reorder_Qty", rowNumber, errors, { positive: true });
      const uom = req(raw, "Unit_of_Measure", rowNumber, errors);
      const dist = req(raw, "Distributor_ID", rowNumber, errors);
      const distOk = dist ? refCheck(dist, refs.distributorIds, "Distributor_ID", "distributor", rowNumber, errors) : false;
      key = id;
      if (id && name && category && per && qty !== null && uom && dist && distOk) {
        row = { skuId: id, skuName: name, category, perishability: per, standardReorderQty: qty, unitOfMeasure: uom, distributorId: dist } as DatasetRow<D>;
      }
    } else if (dataset === "weekly_sales") {
      const sku = req(raw, "SKU_ID", rowNumber, errors);
      const week = req(raw, "Week", rowNumber, errors);
      const units = int(raw, "Units_Sold", rowNumber, errors);
      const skuOk = sku ? refCheck(sku, refs.skuIds, "SKU_ID", "SKU", rowNumber, errors) : false;
      const weekOk = week ? parseIsoWeek(week) !== null : false;
      if (week && !weekOk) errors.push({ rowNumber, column: "Week", code: "INVALID_WEEK", message: `Week must be an ISO week like 2026-W27 (got "${week}").` });
      key = sku && week ? `${sku}|${week}` : null;
      if (sku && skuOk && week && weekOk && units !== null) {
        row = { skuId: sku, week, weekStart: formatIsoDate(isoWeekStart(week)), unitsSold: units } as DatasetRow<D>;
      }
    } else if (dataset === "inventory") {
      const sku = req(raw, "SKU_ID", rowNumber, errors);
      const location = req(raw, "Location", rowNumber, errors);
      const units = int(raw, "Units_On_Hand", rowNumber, errors);
      const date = req(raw, "As_Of_Date", rowNumber, errors);
      const skuOk = sku ? refCheck(sku, refs.skuIds, "SKU_ID", "SKU", rowNumber, errors) : false;
      const dateOk = date ? parseIsoDate(date) !== null : false;
      if (date && !dateOk) errors.push({ rowNumber, column: "As_Of_Date", code: "INVALID_DATE", message: `As_Of_Date must be a valid YYYY-MM-DD date (got "${date}").` });
      key = sku && location && date ? `${sku}|${location}|${date}` : null;
      if (sku && skuOk && location && units !== null && date && dateOk) row = { skuId: sku, location, unitsOnHand: units, asOfDate: date } as DatasetRow<D>;
    } else if (dataset === "calendar") {
      const year = int(raw, "Year", rowNumber, errors);
      const month = int(raw, "Month", rowNumber, errors);
      const ym = req(raw, "Year_Month", rowNumber, errors);
      const flagRaw = req(raw, "Is_Festival_Month", rowNumber, errors);
      if (year !== null && (year < 2000 || year > 2100)) errors.push({ rowNumber, column: "Year", code: "INVALID_VALUE", message: `Year ${year} is out of range.` });
      if (month !== null && (month < 1 || month > 12)) errors.push({ rowNumber, column: "Month", code: "INVALID_VALUE", message: `Month must be 1–12 (got ${month}).` });
      const expectedYm = year !== null && month !== null ? `${year}-${String(month).padStart(2, "0")}` : null;
      if (ym && expectedYm && ym !== expectedYm) errors.push({ rowNumber, column: "Year_Month", code: "INCONSISTENT_VALUE", message: `Year_Month "${ym}" does not match Year/Month (${expectedYm}).` });
      let flag: boolean | null = null;
      if (flagRaw) {
        const f = flagRaw.toUpperCase();
        if (f === "TRUE") flag = true;
        else if (f === "FALSE") flag = false;
        else errors.push({ rowNumber, column: "Is_Festival_Month", code: "INVALID_BOOLEAN", message: `Is_Festival_Month must be TRUE or FALSE (got "${flagRaw}").` });
      }
      key = expectedYm;
      if (errors.length === before && year !== null && month !== null && ym && flag !== null) row = { year, month, yearMonth: ym, isFestivalMonth: flag } as DatasetRow<D>;
    }

    if (key !== null) {
      const first = seenKeys.get(key);
      if (first !== undefined) {
        errors.push({ rowNumber, column: info.grain, code: "DUPLICATE_KEY", message: `Duplicate ${info.grain} "${key.replace(/\|/g, " / ")}" (first seen on line ${first}).` });
        row = null;
      } else {
        seenKeys.set(key, rowNumber);
      }
    }

    const valid = row !== null && errors.length === before;
    rawRows.push({ rowNumber, raw, valid });
    if (valid) validRows.push({ rowNumber, row: row! });
  });

  return { dataset, rowsTotal: rows.length, validRows, rawRows, errors, warnings };
}
