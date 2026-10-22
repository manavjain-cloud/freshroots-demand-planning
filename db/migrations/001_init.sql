-- Freshroots Demand Planning: initial schema.
-- Grain of each master/fact table matches the supplied CSV files.

CREATE TABLE IF NOT EXISTS import_batches (
  id              BIGSERIAL PRIMARY KEY,
  dataset         TEXT NOT NULL CHECK (dataset IN ('distributors','skus','weekly_sales','inventory','calendar')),
  file_name       TEXT NOT NULL,
  file_sha256     TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('seed','upload')),
  status          TEXT NOT NULL CHECK (status IN ('committed','rejected')),
  rows_total      INTEGER NOT NULL DEFAULT 0,
  rows_valid      INTEGER NOT NULL DEFAULT 0,
  rows_invalid    INTEGER NOT NULL DEFAULT 0,
  rows_inserted   INTEGER NOT NULL DEFAULT 0,
  rows_updated    INTEGER NOT NULL DEFAULT 0,
  rows_unchanged  INTEGER NOT NULL DEFAULT 0,
  warnings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_batches_dataset_idx ON import_batches (dataset, created_at DESC);

-- Original CSV rows, preserved verbatim for audit.
CREATE TABLE IF NOT EXISTS import_rows (
  batch_id    BIGINT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,
  raw         JSONB NOT NULL,
  is_valid    BOOLEAN NOT NULL,
  PRIMARY KEY (batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS import_errors (
  id           BIGSERIAL PRIMARY KEY,
  batch_id     BIGINT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number   INTEGER,
  column_name  TEXT,
  code         TEXT NOT NULL,
  message      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_errors_batch_idx ON import_errors (batch_id);

CREATE TABLE IF NOT EXISTS distributors (
  distributor_id    TEXT PRIMARY KEY,
  distributor_name  TEXT NOT NULL,
  region            TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  source_batch_id   BIGINT REFERENCES import_batches(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skus (
  sku_id                TEXT PRIMARY KEY,
  sku_name              TEXT NOT NULL,
  category              TEXT NOT NULL,
  perishability         TEXT NOT NULL CHECK (perishability IN ('Low','Medium','High')),
  standard_reorder_qty  INTEGER NOT NULL CHECK (standard_reorder_qty > 0),
  unit_of_measure       TEXT NOT NULL,
  distributor_id        TEXT NOT NULL REFERENCES distributors(distributor_id),
  source_batch_id       BIGINT REFERENCES import_batches(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skus_distributor_idx ON skus (distributor_id);

CREATE TABLE IF NOT EXISTS weekly_sales (
  sku_id           TEXT NOT NULL REFERENCES skus(sku_id),
  iso_week         TEXT NOT NULL CHECK (iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  week_start       DATE NOT NULL,
  units_sold       INTEGER NOT NULL CHECK (units_sold >= 0),
  source_batch_id  BIGINT REFERENCES import_batches(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sku_id, iso_week)
);
CREATE INDEX IF NOT EXISTS weekly_sales_week_idx ON weekly_sales (week_start);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  sku_id           TEXT NOT NULL REFERENCES skus(sku_id),
  location         TEXT NOT NULL,
  as_of_date       DATE NOT NULL,
  units_on_hand    INTEGER NOT NULL CHECK (units_on_hand >= 0),
  source_batch_id  BIGINT REFERENCES import_batches(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sku_id, location, as_of_date)
);
CREATE INDEX IF NOT EXISTS inventory_date_idx ON inventory_snapshots (as_of_date DESC, location);

CREATE TABLE IF NOT EXISTS calendar_months (
  year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month              INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year_month         TEXT NOT NULL UNIQUE CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  is_festival_month  BOOLEAN NOT NULL,
  source_batch_id    BIGINT REFERENCES import_batches(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

-- Versioned rule configuration. Exactly one active version.
CREATE TABLE IF NOT EXISTS rule_configs (
  id          BIGSERIAL PRIMARY KEY,
  config      JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  note        TEXT,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rule_configs_one_active ON rule_configs (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_by      TEXT NOT NULL,
  engine_version    TEXT NOT NULL,
  config_id         BIGINT REFERENCES rule_configs(id),
  config            JSONB NOT NULL,
  as_of_date        DATE NOT NULL,
  location          TEXT NOT NULL,
  window_end_week   TEXT NOT NULL,
  recent_weeks      TEXT[] NOT NULL,
  baseline_weeks    TEXT[] NOT NULL,
  planning_month    TEXT NOT NULL,
  is_festival_month BOOLEAN,
  input_hash        TEXT NOT NULL,
  sku_count         INTEGER NOT NULL,
  summary           JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_created_idx ON recommendation_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS sku_recommendations (
  id                      BIGSERIAL PRIMARY KEY,
  run_id                  BIGINT NOT NULL REFERENCES recommendation_runs(id),
  sku_id                  TEXT NOT NULL REFERENCES skus(sku_id),
  demand_class            TEXT NOT NULL,
  inventory_risk          TEXT NOT NULL,
  action                  TEXT NOT NULL,
  recommended_qty_raw     NUMERIC,
  recommended_qty         INTEGER,
  requires_review         BOOLEAN NOT NULL,
  exception_codes         TEXT[] NOT NULL DEFAULT '{}',
  latest_week_units       INTEGER,
  recent_avg              NUMERIC,
  baseline_avg            NUMERIC,
  forward_demand          NUMERIC,
  current_stock           INTEGER,
  weeks_of_stock          NUMERIC,
  metrics                 JSONB NOT NULL,
  steps                   JSONB NOT NULL,
  reason                  TEXT NOT NULL,
  review_status           TEXT NOT NULL CHECK (review_status IN ('pending','approved','edited','rejected','not_required')),
  final_qty               INTEGER CHECK (final_qty IS NULL OR final_qty >= 0),
  reviewed_at             TIMESTAMPTZ,
  UNIQUE (run_id, sku_id)
);
CREATE INDEX IF NOT EXISTS recs_status_idx ON sku_recommendations (run_id, review_status);
CREATE INDEX IF NOT EXISTS recs_sku_idx ON sku_recommendations (sku_id, run_id DESC);

-- Every human decision, append-only. The latest row per recommendation is current.
CREATE TABLE IF NOT EXISTS review_decisions (
  id                 BIGSERIAL PRIMARY KEY,
  recommendation_id  BIGINT NOT NULL REFERENCES sku_recommendations(id),
  decision           TEXT NOT NULL CHECK (decision IN ('approved','edited','rejected','note')),
  calculated_qty     INTEGER,
  final_qty          INTEGER CHECK (final_qty IS NULL OR final_qty >= 0),
  reason             TEXT,
  note               TEXT,
  reviewer_name      TEXT,
  identity_verified  BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_rec_idx ON review_decisions (recommendation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_explanations (
  id                  BIGSERIAL PRIMARY KEY,
  scope               TEXT NOT NULL CHECK (scope IN ('recommendation','run_summary')),
  ref_id              BIGINT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  content             JSONB NOT NULL,
  grounding_warnings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_expl_ref_idx ON ai_explanations (scope, ref_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (occurred_at DESC);
