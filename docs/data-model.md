# Data model and import process

Schema: [`db/migrations/001_init.sql`](../db/migrations/001_init.sql), applied by `npm run db:migrate` (tracked in `schema_migrations`). Do not create tables by hand in the Neon console.

## Tables

| Table | Grain / key | Purpose |
|---|---|---|
| `distributors` | `distributor_id` | Distributor master (`Distributor Seed Data.csv`) |
| `skus` | `sku_id`; FK → `distributors` | SKU master (`SKU Seed Data.csv`) |
| `weekly_sales` | `(sku_id, iso_week)`; FK → `skus` | Weekly units sold (`Weekly Sales Seed Data.csv`); `week_start` = ISO Monday |
| `inventory_snapshots` | `(sku_id, location, as_of_date)`; FK → `skus` | Units on hand (`Current Inventory Seed Data.csv`); multiple snapshots supported |
| `calendar_months` | `(year, month)`, unique `year_month` | Festival-month flags (`Calendar Seed Data.csv`) |
| `import_batches` | `id` | One row per file import: dataset, file name, SHA-256, source (seed/upload), status (committed/rejected), row counts, warnings, who |
| `import_rows` | `(batch_id, row_number)` | **Original CSV rows preserved verbatim** (JSONB) with a valid flag |
| `import_errors` | `id`; FK → batch | Row-level validation errors (line, column, code, message) |
| `rule_configs` | `id`; one active (partial unique index) | Versioned rule configuration with change note and author |
| `recommendation_runs` | `id` | One per "Run demand planning": snapshot date, location, windows, planning month, festival flag, **config JSON**, **engine version**, **input hash**, summary counts |
| `sku_recommendations` | `id`, unique `(run_id, sku_id)` | Classification, action, raw + rounded quantity, exceptions, key metrics, full metrics JSON, step trace JSON, reason, review status, final quantity |
| `review_decisions` | `id`; FK → recommendation | Append-only human decisions: approved / edited / rejected / note, calculated vs final qty, reason, note, self-declared reviewer name, `identity_verified = false`, timestamp |
| `ai_explanations` | `id` | Cached Gemini outputs (scope, ref id, provider, model, JSON content, grounding warnings) |
| `ai_rate_limits` | `(bucket, window_start)` | Fixed-window counters for AI endpoints (client IPs are hashed) |
| `audit_log` | `id` | Imports, runs, reviews and configuration changes |

Constraints enforce non-negative units, positive standard reorder quantity, allowed perishability/status values, ISO week format and months 1–12.

## Reproducibility

Each run stores the exact configuration, engine version and a SHA-256 of the engine inputs (SKUs, sales window, stock rows, calendar, config). The Overview warns when current data or rules no longer match the latest run's hash.

## Import workflow

Code: [`src/lib/imports/validate.ts`](../src/lib/imports/validate.ts) (pure validation) and [`src/lib/server/imports.ts`](../src/lib/server/imports.ts) (database).

1. Parse CSV (UTF-8 BOM stripped, headers trimmed).
2. Check required columns (extra columns are ignored with a warning).
3. Validate each row: required values, whole non-negative numbers, ISO weeks (`YYYY-Www`), real calendar dates, `TRUE`/`FALSE` booleans, allowed perishability/status values, `Year_Month` consistent with `Year`/`Month`.
4. Check references: SKU → distributor, sales/inventory → SKU (against the database plus the batch). IDs that differ only by case are reported as `ID_CASE_MISMATCH`.
5. Detect duplicate keys at the dataset's grain.
6. **All-or-nothing:** if any row is invalid, the batch is stored as `rejected` with its original rows and errors, and no business data changes. Otherwise rows are upserted on the natural key in one transaction (`inserted` / `updated` / `unchanged` counts). Nothing is ever deleted by an import.

Seed import order: distributors → SKUs → weekly sales → inventory → calendar. `npm run db:seed` (or *Data Imports → Re-import seed files*) is idempotent.

## Data not supplied (shown as "Not available")

Open purchase orders, supplier lead times, prices, costs, confirmed stockout events and multi-year history. The 15 SKUs / 4 distributors are a pilot sample; the case describes 400 SKUs and 1,200 distributors.
