import type { Db, Queryable } from "../db/client";
import {
  buildPoLines,
  choosePoDetails,
  firstReceiveDates,
  getZohoConfig,
  leadTimeObservations,
  mapItems,
  normStatus,
  summariseLeadTimes,
  ZohoError,
  ZohoReadClient,
  type ZohoConfig,
} from "../integrations/zoho";
import { writeAudit } from "./audit";

export interface ZohoSyncSummary {
  id: number;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  itemsSeen: number;
  itemsMapped: number;
  purchaseOrdersSeen: number;
  poDetailsFetched: number;
  openPoLines: number;
  receivesSeen: number;
  leadTimeObservations: number;
  apiCalls: number;
  statusValuesSeen: string[];
  warnings: string[];
  error: string | null;
}

/**
 * Read items, purchase orders and receives from Zoho and store a snapshot.
 * Read-only towards Zoho. Never modifies Freshroots sales, stock or recommendations.
 */
export async function runZohoSync(db: Db, opts: { actor: string; fetchImpl?: typeof fetch; config?: ZohoConfig; today?: string }): Promise<ZohoSyncSummary> {
  const cfg = opts.config ?? getZohoConfig();
  if (!cfg.configured) throw new ZohoError("not_configured", `Zoho is not configured (missing ${cfg.missing.join(", ")}).`);

  const started = await db.query<{ id: string }>(
    "INSERT INTO zoho_sync_runs (status, triggered_by, organization_id) VALUES ('running', $1, $2) RETURNING id",
    [opts.actor, cfg.organizationId],
  );
  const syncId = Number(started.rows[0].id);
  const client = new ZohoReadClient(cfg, opts.fetchImpl);
  const warnings: string[] = [];

  try {
    const skuRows = await db.query<{ sku_id: string }>("SELECT sku_id FROM skus");
    const skuIds = skuRows.rows.map((r) => r.sku_id);

    // 1. Items → SKU mapping
    const itemsRes = await client.list<Record<string, unknown>>("/items", ["items"], { maxPages: 10 });
    if (!itemsRes.keyFound) warnings.push("The items response had no 'items' list.");
    if (itemsRes.truncated) warnings.push("More than 2,000 Zoho items; only the first 2,000 were read.");
    const items = mapItems(itemsRes.rows, skuIds);
    const itemToSku = new Map(items.map((i) => [i.zohoItemId, i.skuId]));
    const mappedSkus = new Set(items.filter((i) => i.skuId).map((i) => i.skuId!));
    const unmappedFreshroots = skuIds.filter((s) => !mappedSkus.has(s));
    if (unmappedFreshroots.length) warnings.push(`No Zoho item has SKU = ${unmappedFreshroots.join(", ")}; on-order and lead time are unavailable for these.`);

    // 2. Purchase-order headers
    const poRes = await client.list<Record<string, unknown>>("/purchaseorders", ["purchaseorders", "purchase_orders"], { maxPages: 10 });
    if (!poRes.keyFound) warnings.push("The purchase-orders response had no 'purchaseorders' list.");
    if (poRes.truncated) warnings.push("More than 2,000 purchase orders; only the most recent pages were read.");
    const statusValues = [...new Set(poRes.rows.map((p) => normStatus(p.status)).filter(Boolean))].sort();

    // 3. Purchase receives (for lead time)
    const recRes = await client.list<Record<string, unknown>>("/purchasereceives", ["purchasereceives", "purchase_receives"], { maxPages: 10 });
    if (!recRes.keyFound) warnings.push("The purchase-receives response had no 'purchasereceives' list; lead times cannot be observed.");
    const firstReceive = firstReceiveDates(recRes.rows);

    // 4. PO details within the call budget
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - cfg.historyDays * 86_400_000).toISOString().slice(0, 10);
    const budget = Math.max(0, Math.min(cfg.maxPoDetails, 90 - client.apiCalls));
    const pick = choosePoDetails(poRes.rows, new Set(firstReceive.keys()), cfg.excludedStatuses, budget, since);
    if (pick.openTruncated) warnings.push(`${pick.openCandidates} possibly-open purchase orders but only ${budget} could be read in one sync; on-order quantities may be understated.`);
    const details: Record<string, unknown>[] = [];
    for (const id of pick.ids) {
      const body = await client.get<Record<string, unknown>>(`/purchaseorders/${encodeURIComponent(id)}`);
      const po = (body.purchaseorder ?? body.purchase_order) as Record<string, unknown> | undefined;
      if (po) details.push(po);
      else warnings.push(`Purchase order ${id} returned no details.`);
    }

    const lines = buildPoLines(details, itemToSku, cfg.excludedStatuses);
    const unmappedOpen = lines.filter((l) => l.isOpen && !l.skuId);
    if (unmappedOpen.length) warnings.push(`${unmappedOpen.length} open PO line(s) are for Zoho items that do not match a Freshroots SKU.`);
    const lt = leadTimeObservations(lines, firstReceive);
    if (lt.skipped) warnings.push(`${lt.skipped} lead-time observation(s) skipped because the receive date was before the PO date.`);

    // 5. Store the snapshot atomically
    await db.transaction(async (tx) => {
      if (items.length) {
        await tx.query(
          `INSERT INTO zoho_items (sync_id, zoho_item_id, name, zoho_sku, sku_id, status)
           SELECT $1, x."zohoItemId", x.name, x."zohoSku", x."skuId", x.status
           FROM jsonb_to_recordset($2::jsonb) AS x("zohoItemId" text, name text, "zohoSku" text, "skuId" text, status text)`,
          [syncId, JSON.stringify(items)],
        );
      }
      if (lines.length) {
        await tx.query(
          `INSERT INTO zoho_po_lines (sync_id, purchaseorder_id, purchaseorder_number, po_status, po_date, expected_delivery_date, delivery_date, vendor_name,
             line_item_id, zoho_item_id, sku_id, item_name, quantity, quantity_received, quantity_outstanding, is_open, location_name)
           SELECT $1, x."purchaseorderId", x."purchaseorderNumber", x."poStatus", x."poDate"::date, x."expectedDeliveryDate"::date, x."deliveryDate"::date, x."vendorName",
             x."lineItemId", x."zohoItemId", x."skuId", x."itemName", x.quantity, x."quantityReceived", x."quantityOutstanding", x."isOpen", x."locationName"
           FROM jsonb_to_recordset($2::jsonb) AS x("purchaseorderId" text, "purchaseorderNumber" text, "poStatus" text, "poDate" text, "expectedDeliveryDate" text,
             "deliveryDate" text, "vendorName" text, "lineItemId" text, "zohoItemId" text, "skuId" text, "itemName" text, quantity numeric, "quantityReceived" numeric,
             "quantityOutstanding" numeric, "isOpen" boolean, "locationName" text)
           ON CONFLICT DO NOTHING`,
          [syncId, JSON.stringify(lines)],
        );
      }
      if (lt.obs.length) {
        await tx.query(
          `INSERT INTO zoho_lead_time_obs (sync_id, sku_id, purchaseorder_id, purchaseorder_number, po_date, first_receive_date, lead_time_days)
           SELECT $1, x."skuId", x."purchaseorderId", x."purchaseorderNumber", x."poDate"::date, x."firstReceiveDate"::date, x."leadTimeDays"
           FROM jsonb_to_recordset($2::jsonb) AS x("skuId" text, "purchaseorderId" text, "purchaseorderNumber" text, "poDate" text, "firstReceiveDate" text, "leadTimeDays" int)`,
          [syncId, JSON.stringify(lt.obs)],
        );
      }
      await tx.query(
        `UPDATE zoho_sync_runs SET status='succeeded', finished_at=now(), items_seen=$2, items_mapped=$3, purchase_orders_seen=$4, po_details_fetched=$5,
           open_po_lines=$6, receives_seen=$7, lead_time_observations=$8, api_calls=$9, status_values_seen=$10::text[], warnings=$11::jsonb WHERE id=$1`,
        [syncId, items.length, items.filter((i) => i.skuId).length, poRes.rows.length, details.length, lines.filter((l) => l.isOpen).length, recRes.rows.length, lt.obs.length, client.apiCalls, statusValues, JSON.stringify(warnings)],
      );
      await writeAudit(tx, { actor: opts.actor, action: "zoho.sync.succeeded", entityType: "zoho_sync", entityId: syncId, details: { apiCalls: client.apiCalls, openLines: lines.filter((l) => l.isOpen).length, warnings: warnings.length } });
    });
  } catch (err) {
    const message = err instanceof ZohoError ? err.message : "The Zoho sync failed unexpectedly.";
    if (!(err instanceof ZohoError)) console.error("Zoho sync failed", err instanceof Error ? err.message : "unknown");
    await db.query(`UPDATE zoho_sync_runs SET status='failed', finished_at=now(), api_calls=$2, error=$3, warnings=$4::jsonb WHERE id=$1`, [syncId, client.apiCalls, message, JSON.stringify(warnings)]);
    await writeAudit(db, { actor: opts.actor, action: "zoho.sync.failed", entityType: "zoho_sync", entityId: syncId, details: { error: message } });
  }
  return (await getZohoSync(db, syncId))!;
}

/* ------------------------------ reads ------------------------------ */

type SyncDbRow = {
  id: number; status: ZohoSyncSummary["status"]; started_at: Date; finished_at: Date | null; triggered_by: string; items_seen: number; items_mapped: number;
  purchase_orders_seen: number; po_details_fetched: number; open_po_lines: number; receives_seen: number; lead_time_observations: number; api_calls: number;
  status_values_seen: string[]; warnings: string[]; error: string | null;
};
const SYNC_COLS = `id::int AS id, status, started_at, finished_at, triggered_by, items_seen, items_mapped, purchase_orders_seen, po_details_fetched, open_po_lines,
  receives_seen, lead_time_observations, api_calls, status_values_seen, warnings, error`;
const mapSync = (r: SyncDbRow): ZohoSyncSummary => ({
  id: r.id, status: r.status, startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  triggeredBy: r.triggered_by, itemsSeen: r.items_seen, itemsMapped: r.items_mapped, purchaseOrdersSeen: r.purchase_orders_seen, poDetailsFetched: r.po_details_fetched,
  openPoLines: r.open_po_lines, receivesSeen: r.receives_seen, leadTimeObservations: r.lead_time_observations, apiCalls: r.api_calls,
  statusValuesSeen: r.status_values_seen ?? [], warnings: Array.isArray(r.warnings) ? r.warnings : [], error: r.error,
});

export async function getZohoSync(q: Queryable, id: number): Promise<ZohoSyncSummary | null> {
  const r = await q.query<SyncDbRow>(`SELECT ${SYNC_COLS} FROM zoho_sync_runs WHERE id = $1`, [id]);
  return r.rows[0] ? mapSync(r.rows[0]) : null;
}

export async function getLatestZohoSyncs(q: Queryable): Promise<{ latest: ZohoSyncSummary | null; lastSuccess: ZohoSyncSummary | null }> {
  const latest = await q.query<SyncDbRow>(`SELECT ${SYNC_COLS} FROM zoho_sync_runs ORDER BY id DESC LIMIT 1`);
  const ok = await q.query<SyncDbRow>(`SELECT ${SYNC_COLS} FROM zoho_sync_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1`);
  return { latest: latest.rows[0] ? mapSync(latest.rows[0]) : null, lastSuccess: ok.rows[0] ? mapSync(ok.rows[0]) : null };
}

export interface ZohoSkuSupply {
  syncId: number;
  syncedAt: string;
  mapped: boolean;
  onOrder: number;
  openLines: { purchaseorderNumber: string | null; poStatus: string | null; poDate: string | null; expectedDeliveryDate: string | null; vendorName: string | null; outstanding: number }[];
  leadTime: { n: number; median: number; min: number; max: number } | null;
}

/** Per-SKU supply data from the latest successful sync (empty map if never synced). */
export async function getZohoSupplyBySku(q: Queryable): Promise<{ sync: ZohoSyncSummary | null; bySku: Map<string, ZohoSkuSupply> }> {
  const { lastSuccess } = await getLatestZohoSyncs(q);
  const bySku = new Map<string, ZohoSkuSupply>();
  if (!lastSuccess) return { sync: null, bySku };
  const syncedAt = lastSuccess.finishedAt ?? lastSuccess.startedAt;
  const mapped = await q.query<{ sku_id: string }>("SELECT DISTINCT sku_id FROM zoho_items WHERE sync_id = $1 AND sku_id IS NOT NULL", [lastSuccess.id]);
  for (const m of mapped.rows) bySku.set(m.sku_id, { syncId: lastSuccess.id, syncedAt, mapped: true, onOrder: 0, openLines: [], leadTime: null });
  const lines = await q.query<{ sku_id: string; purchaseorder_number: string | null; po_status: string | null; po_date: string | null; expected_delivery_date: string | null; vendor_name: string | null; outstanding: number }>(
    `SELECT sku_id, purchaseorder_number, po_status, po_date::text AS po_date, expected_delivery_date::text AS expected_delivery_date, vendor_name,
            quantity_outstanding::float8 AS outstanding
     FROM zoho_po_lines WHERE sync_id = $1 AND is_open AND sku_id IS NOT NULL ORDER BY expected_delivery_date NULLS LAST, po_date`,
    [lastSuccess.id],
  );
  for (const l of lines.rows) {
    const s = bySku.get(l.sku_id) ?? { syncId: lastSuccess.id, syncedAt, mapped: true, onOrder: 0, openLines: [], leadTime: null };
    s.onOrder += Number(l.outstanding);
    s.openLines.push({ purchaseorderNumber: l.purchaseorder_number, poStatus: l.po_status, poDate: l.po_date, expectedDeliveryDate: l.expected_delivery_date, vendorName: l.vendor_name, outstanding: Number(l.outstanding) });
    bySku.set(l.sku_id, s);
  }
  const obs = await q.query<{ sku_id: string; lead_time_days: number }>("SELECT sku_id, lead_time_days FROM zoho_lead_time_obs WHERE sync_id = $1", [lastSuccess.id]);
  for (const [sku, lt] of summariseLeadTimes(obs.rows.map((o) => ({ skuId: o.sku_id, leadTimeDays: o.lead_time_days })))) {
    const s = bySku.get(sku);
    if (s) s.leadTime = lt;
  }
  return { sync: lastSuccess, bySku };
}
