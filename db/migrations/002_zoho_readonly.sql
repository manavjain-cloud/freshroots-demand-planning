-- Zoho Inventory read-only sync (purchase orders, receives, items).
-- Each sync writes a complete snapshot; the app reads the latest successful one.
-- Nothing here is ever written back to Zoho.

CREATE TABLE IF NOT EXISTS zoho_sync_runs (
  id                       BIGSERIAL PRIMARY KEY,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at              TIMESTAMPTZ,
  status                   TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  triggered_by             TEXT NOT NULL,
  organization_id          TEXT,
  items_seen               INTEGER NOT NULL DEFAULT 0,
  items_mapped             INTEGER NOT NULL DEFAULT 0,
  purchase_orders_seen     INTEGER NOT NULL DEFAULT 0,
  po_details_fetched       INTEGER NOT NULL DEFAULT 0,
  open_po_lines            INTEGER NOT NULL DEFAULT 0,
  receives_seen            INTEGER NOT NULL DEFAULT 0,
  lead_time_observations   INTEGER NOT NULL DEFAULT 0,
  api_calls                INTEGER NOT NULL DEFAULT 0,
  status_values_seen       TEXT[] NOT NULL DEFAULT '{}',
  warnings                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  error                    TEXT
);
CREATE INDEX IF NOT EXISTS zoho_sync_runs_status_idx ON zoho_sync_runs (status, id DESC);

-- Zoho items and how they map to Freshroots SKUs (Zoho item `sku` = Freshroots SKU_ID).
CREATE TABLE IF NOT EXISTS zoho_items (
  sync_id        BIGINT NOT NULL REFERENCES zoho_sync_runs(id) ON DELETE CASCADE,
  zoho_item_id   TEXT NOT NULL,
  name           TEXT,
  zoho_sku       TEXT,
  sku_id         TEXT REFERENCES skus(sku_id),
  status         TEXT,
  PRIMARY KEY (sync_id, zoho_item_id)
);

-- Purchase-order lines from the PO detail endpoint.
CREATE TABLE IF NOT EXISTS zoho_po_lines (
  sync_id                 BIGINT NOT NULL REFERENCES zoho_sync_runs(id) ON DELETE CASCADE,
  purchaseorder_id        TEXT NOT NULL,
  purchaseorder_number    TEXT,
  po_status               TEXT,
  po_date                 DATE,
  expected_delivery_date  DATE,
  delivery_date           DATE,
  vendor_name             TEXT,
  line_item_id            TEXT NOT NULL,
  zoho_item_id            TEXT,
  sku_id                  TEXT REFERENCES skus(sku_id),
  item_name               TEXT,
  quantity                NUMERIC NOT NULL DEFAULT 0,
  quantity_received       NUMERIC NOT NULL DEFAULT 0,
  quantity_outstanding    NUMERIC NOT NULL DEFAULT 0,
  is_open                 BOOLEAN NOT NULL,
  location_name           TEXT,
  PRIMARY KEY (sync_id, purchaseorder_id, line_item_id)
);
CREATE INDEX IF NOT EXISTS zoho_po_lines_sku_idx ON zoho_po_lines (sync_id, sku_id);

-- Observed lead time: PO date → first purchase-receive date, per SKU on that PO.
CREATE TABLE IF NOT EXISTS zoho_lead_time_obs (
  sync_id             BIGINT NOT NULL REFERENCES zoho_sync_runs(id) ON DELETE CASCADE,
  sku_id              TEXT NOT NULL REFERENCES skus(sku_id),
  purchaseorder_id    TEXT NOT NULL,
  purchaseorder_number TEXT,
  po_date             DATE NOT NULL,
  first_receive_date  DATE NOT NULL,
  lead_time_days      INTEGER NOT NULL CHECK (lead_time_days >= 0),
  PRIMARY KEY (sync_id, sku_id, purchaseorder_id)
);
