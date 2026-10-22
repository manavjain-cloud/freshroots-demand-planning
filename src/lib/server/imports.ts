import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db, Queryable, Tx } from "../db/client";
import { DATASETS, DATASET_INFO, validateDataset, type Dataset, type ReferenceSets, type RowIssue, type ValidationResult } from "../imports/validate";
import { writeAudit } from "./audit";

export interface ImportOutcome {
  batchId: number;
  dataset: Dataset;
  fileName: string;
  status: "committed" | "rejected";
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export async function loadReferenceSets(q: Queryable): Promise<ReferenceSets> {
  const d = await q.query<{ id: string }>("SELECT distributor_id AS id FROM distributors");
  const s = await q.query<{ id: string }>("SELECT sku_id AS id FROM skus");
  return { distributorIds: new Set(d.rows.map((r) => r.id)), skuIds: new Set(s.rows.map((r) => r.id)) };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Validate and import one dataset. All-or-nothing: if any row is invalid the batch is
 * recorded as rejected (with row-level errors and the original rows) and no data changes.
 * Valid batches are upserted on the dataset's natural key; nothing is deleted.
 */
export async function importDataset(
  db: Db,
  args: { dataset: Dataset; text: string; fileName: string; source: "seed" | "upload"; actor: string },
): Promise<ImportOutcome> {
  if (!DATASETS.includes(args.dataset)) throw new Error("Unknown dataset");
  return db.transaction(async (tx) => {
    const refs = await loadReferenceSets(tx);
    const v = validateDataset(args.dataset, args.text, refs);
    const status: ImportOutcome["status"] = v.errors.length === 0 && v.validRows.length > 0 ? "committed" : "rejected";
    const rowsInvalid = v.rawRows.filter((r) => !r.valid).length;

    const batch = await tx.query<{ id: string }>(
      `INSERT INTO import_batches (dataset, file_name, file_sha256, source, status, rows_total, rows_valid, rows_invalid, warnings, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id`,
      [args.dataset, args.fileName, sha256(args.text), args.source, status, v.rowsTotal, v.validRows.length, rowsInvalid, JSON.stringify(v.warnings), args.actor],
    );
    const batchId = Number(batch.rows[0].id);

    if (v.rawRows.length) {
      await tx.query(
        `INSERT INTO import_rows (batch_id, row_number, raw, is_valid)
         SELECT $1, (r->>'rowNumber')::int, r->'raw', (r->>'valid')::boolean FROM jsonb_array_elements($2::jsonb) AS r`,
        [batchId, JSON.stringify(v.rawRows)],
      );
    }
    if (v.errors.length) {
      await tx.query(
        `INSERT INTO import_errors (batch_id, row_number, column_name, code, message)
         SELECT $1, NULLIF(e->>'rowNumber','')::int, e->>'column', e->>'code', e->>'message' FROM jsonb_array_elements($2::jsonb) AS e`,
        [batchId, JSON.stringify(v.errors)],
      );
    }

    let inserted = 0;
    let updated = 0;
    if (status === "committed") {
      const res = await upsertRows(tx, v, batchId);
      inserted = res.inserted;
      updated = res.updated;
      await tx.query(`UPDATE import_batches SET rows_inserted=$2, rows_updated=$3, rows_unchanged=$4 WHERE id=$1`, [
        batchId,
        inserted,
        updated,
        v.validRows.length - inserted - updated,
      ]);
    }

    await writeAudit(tx, {
      actor: args.actor,
      action: status === "committed" ? "import.committed" : "import.rejected",
      entityType: "import_batch",
      entityId: batchId,
      details: { dataset: args.dataset, fileName: args.fileName, rowsTotal: v.rowsTotal, errors: v.errors.length, inserted, updated },
    });

    return {
      batchId,
      dataset: args.dataset,
      fileName: args.fileName,
      status,
      rowsTotal: v.rowsTotal,
      rowsValid: v.validRows.length,
      rowsInvalid,
      inserted,
      updated,
      unchanged: status === "committed" ? v.validRows.length - inserted - updated : 0,
      errors: v.errors,
      warnings: v.warnings,
    };
  });
}

async function upsertRows(tx: Tx, v: ValidationResult, batchId: number): Promise<{ inserted: number; updated: number }> {
  const json = JSON.stringify(v.validRows.map((r) => r.row));
  let sql: string;
  switch (v.dataset) {
    case "distributors":
      sql = `INSERT INTO distributors AS t (distributor_id, distributor_name, region, status, source_batch_id)
        SELECT x."distributorId", x."distributorName", x.region, x.status, $2
        FROM jsonb_to_recordset($1::jsonb) AS x("distributorId" text, "distributorName" text, region text, status text)
        ON CONFLICT (distributor_id) DO UPDATE SET distributor_name=EXCLUDED.distributor_name, region=EXCLUDED.region, status=EXCLUDED.status,
          source_batch_id=EXCLUDED.source_batch_id, updated_at=now()
        WHERE (t.distributor_name, t.region, t.status) IS DISTINCT FROM (EXCLUDED.distributor_name, EXCLUDED.region, EXCLUDED.status)
        RETURNING (xmax = 0) AS inserted`;
      break;
    case "skus":
      sql = `INSERT INTO skus AS t (sku_id, sku_name, category, perishability, standard_reorder_qty, unit_of_measure, distributor_id, source_batch_id)
        SELECT x."skuId", x."skuName", x.category, x.perishability, x."standardReorderQty", x."unitOfMeasure", x."distributorId", $2
        FROM jsonb_to_recordset($1::jsonb) AS x("skuId" text, "skuName" text, category text, perishability text, "standardReorderQty" int, "unitOfMeasure" text, "distributorId" text)
        ON CONFLICT (sku_id) DO UPDATE SET sku_name=EXCLUDED.sku_name, category=EXCLUDED.category, perishability=EXCLUDED.perishability,
          standard_reorder_qty=EXCLUDED.standard_reorder_qty, unit_of_measure=EXCLUDED.unit_of_measure, distributor_id=EXCLUDED.distributor_id,
          source_batch_id=EXCLUDED.source_batch_id, updated_at=now()
        WHERE (t.sku_name, t.category, t.perishability, t.standard_reorder_qty, t.unit_of_measure, t.distributor_id)
          IS DISTINCT FROM (EXCLUDED.sku_name, EXCLUDED.category, EXCLUDED.perishability, EXCLUDED.standard_reorder_qty, EXCLUDED.unit_of_measure, EXCLUDED.distributor_id)
        RETURNING (xmax = 0) AS inserted`;
      break;
    case "weekly_sales":
      sql = `INSERT INTO weekly_sales AS t (sku_id, iso_week, week_start, units_sold, source_batch_id)
        SELECT x."skuId", x.week, x."weekStart"::date, x."unitsSold", $2
        FROM jsonb_to_recordset($1::jsonb) AS x("skuId" text, week text, "weekStart" text, "unitsSold" int)
        ON CONFLICT (sku_id, iso_week) DO UPDATE SET units_sold=EXCLUDED.units_sold, source_batch_id=EXCLUDED.source_batch_id, updated_at=now()
        WHERE t.units_sold IS DISTINCT FROM EXCLUDED.units_sold
        RETURNING (xmax = 0) AS inserted`;
      break;
    case "inventory":
      sql = `INSERT INTO inventory_snapshots AS t (sku_id, location, as_of_date, units_on_hand, source_batch_id)
        SELECT x."skuId", x.location, x."asOfDate"::date, x."unitsOnHand", $2
        FROM jsonb_to_recordset($1::jsonb) AS x("skuId" text, location text, "asOfDate" text, "unitsOnHand" int)
        ON CONFLICT (sku_id, location, as_of_date) DO UPDATE SET units_on_hand=EXCLUDED.units_on_hand, source_batch_id=EXCLUDED.source_batch_id, updated_at=now()
        WHERE t.units_on_hand IS DISTINCT FROM EXCLUDED.units_on_hand
        RETURNING (xmax = 0) AS inserted`;
      break;
    case "calendar":
      sql = `INSERT INTO calendar_months AS t (year, month, year_month, is_festival_month, source_batch_id)
        SELECT x.year, x.month, x."yearMonth", x."isFestivalMonth", $2
        FROM jsonb_to_recordset($1::jsonb) AS x(year int, month int, "yearMonth" text, "isFestivalMonth" boolean)
        ON CONFLICT (year, month) DO UPDATE SET year_month=EXCLUDED.year_month, is_festival_month=EXCLUDED.is_festival_month,
          source_batch_id=EXCLUDED.source_batch_id, updated_at=now()
        WHERE (t.year_month, t.is_festival_month) IS DISTINCT FROM (EXCLUDED.year_month, EXCLUDED.is_festival_month)
        RETURNING (xmax = 0) AS inserted`;
      break;
  }
  const res = await tx.query<{ inserted: boolean }>(sql, [json, batchId]);
  const inserted = res.rows.filter((r) => r.inserted).length;
  return { inserted, updated: res.rows.length - inserted };
}

/** Import the five supplied seed files (data/seed/) in dependency order. */
export async function importSeedFiles(db: Db, actor: string): Promise<ImportOutcome[]> {
  const ordered = [...DATASETS].sort((a, b) => DATASET_INFO[a].order - DATASET_INFO[b].order);
  const out: ImportOutcome[] = [];
  for (const dataset of ordered) {
    const fileName = DATASET_INFO[dataset].seedFile;
    const text = readFileSync(path.join(process.cwd(), "data", "seed", fileName), "utf8");
    out.push(await importDataset(db, { dataset, text, fileName, source: "seed", actor }));
  }
  return out;
}
