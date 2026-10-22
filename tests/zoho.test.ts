import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/db";
import { importSeedFiles } from "../src/lib/server/imports";
import {
  buildPoLines,
  choosePoDetails,
  clearZohoTokenCache,
  createDraftPurchaseOrder,
  firstReceiveDates,
  getZohoConfig,
  getZohoStatus,
  leadTimeObservations,
  mapItems,
  summariseLeadTimes,
  ZohoReadClient,
  type ZohoConfig,
} from "../src/lib/integrations/zoho";
import { getZohoSupplyBySku, runZohoSync } from "../src/lib/server/zoho-sync";

const ENV = {
  ZOHO_CLIENT_ID: "1000.TESTCLIENT",
  ZOHO_CLIENT_SECRET: "test-secret",
  ZOHO_REFRESH_TOKEN: "1000.test-refresh",
  ZOHO_ORGANIZATION_ID: "60000000001",
};
const CFG: ZohoConfig = getZohoConfig(ENV);

/* Fixtures shaped like the Zoho Inventory v1 docs (items, purchaseorders, purchasereceives). */
const ITEMS = [
  { item_id: "460000000011", name: "Mango Drink 200ml", sku: "SKU001", status: "active" },
  { item_id: "460000000012", name: "Brown Rice 1kg", sku: "sku003 ", status: "active" },
  { item_id: "460000000099", name: "Sample item", sku: "ZX-1", status: "active" },
];
const PO_HEADERS = [
  { purchaseorder_id: "PO1", purchaseorder_number: "PO-00001", status: "issued", date: "2026-10-10", vendor_name: "NutriFlow Distributors" },
  { purchaseorder_id: "PO2", purchaseorder_number: "PO-00002", status: "partially_received", date: "2026-09-01", vendor_name: "GrainPath Logistics" },
  { purchaseorder_id: "PO3", purchaseorder_number: "PO-00003", status: "received", date: "2026-08-01", vendor_name: "NutriFlow Distributors" },
  { purchaseorder_id: "PO4", purchaseorder_number: "PO-00004", status: "draft", date: "2026-10-15", vendor_name: "NutriFlow Distributors" },
  { purchaseorder_id: "PO5", purchaseorder_number: "PO-00005", status: "cancelled", date: "2026-07-01", vendor_name: "NutriFlow Distributors" },
];
const PO_DETAILS: Record<string, Record<string, unknown>> = {
  PO1: { ...PO_HEADERS[0], expected_delivery_date: "2026-10-24", line_items: [{ line_item_id: "L1", item_id: "460000000011", name: "Mango Drink 200ml", quantity: 500, quantity_received: 0, location_name: "Pune Central Warehouse" }] },
  PO2: { ...PO_HEADERS[1], expected_delivery_date: "2026-09-15", line_items: [{ line_item_id: "L2", item_id: "460000000012", name: "Brown Rice 1kg", quantity: 300, quantity_received: 100 }, { line_item_id: "L3", item_id: "460000000099", name: "Sample", quantity: 5, quantity_received: 0 }] },
  PO3: { ...PO_HEADERS[2], line_items: [{ line_item_id: "L4", item_id: "460000000011", name: "Mango Drink 200ml", quantity: 400, quantity_received: 400 }] },
  PO4: { ...PO_HEADERS[3], line_items: [{ line_item_id: "L5", item_id: "460000000011", name: "Mango Drink 200ml", quantity: 999, quantity_received: 0 }] },
};
const RECEIVES = [
  { purchasereceive_id: "R1", purchaseorder_id: "PO3", receive_date: "2026-08-11" },
  { purchasereceive_id: "R2", purchaseorder_id: "PO2", receive_date: "2026-09-12" },
  { purchasereceive_id: "R3", purchaseorder_id: "PO2", receive_date: "2026-09-09" },
];

type Call = { method: string; url: URL };

function fakeZoho(opts: { failStatus?: number; expireFirstToken?: boolean } = {}) {
  const calls: Call[] = [];
  let tokenN = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (url.pathname === "/oauth/v2/token") {
      tokenN++;
      return json({ access_token: `access-${tokenN}`, api_domain: "https://www.zohoapis.in", token_type: "Bearer", expires_in: 3600 });
    }
    const auth = new Headers(init?.headers).get("Authorization");
    if (opts.expireFirstToken && auth === "Zoho-oauthtoken access-1") return json({ code: 57, message: "Invalid token" }, 401);
    if (opts.failStatus && url.pathname.endsWith("/purchaseorders")) return json({ code: 44, message: "limit" }, opts.failStatus);
    const p = url.pathname.replace("/inventory/v1", "");
    if (p === "/organizations") return json({ code: 0, organizations: [{ organization_id: "60000000001", name: "Freshroots Test" }] });
    if (p === "/items") return json({ code: 0, items: ITEMS, page_context: { page: 1, per_page: 200, has_more_page: false } });
    if (p === "/purchaseorders") return json({ code: 0, purchaseorders: PO_HEADERS, page_context: { page: 1, per_page: 200, has_more_page: false } });
    if (p === "/purchasereceives") return json({ code: 0, purchasereceives: RECEIVES, page_context: { page: 1, per_page: 200, has_more_page: false } });
    const m = /^\/purchaseorders\/(.+)$/.exec(p);
    if (m && PO_DETAILS[m[1]]) return json({ code: 0, purchase_order: PO_DETAILS[m[1]] });
    return json({ code: 1, message: "not found" }, 404);
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

beforeEach(() => clearZohoTokenCache());

describe("Zoho configuration", () => {
  it("is not configured without credentials and defaults to the India data centre", () => {
    const c = getZohoConfig({});
    expect(c.configured).toBe(false);
    expect(c.missing).toEqual(["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]);
    expect(c.accountsDomain).toBe("https://accounts.zoho.in");
    expect(c.apiDomain).toBe("https://www.zohoapis.in");
    expect(getZohoStatus({}).state).toBe("not_configured");
    expect(getZohoStatus(ENV)).toMatchObject({ state: "configured", readEnabled: true, writeEnabled: false });
  });

  it("never creates purchase orders", () => {
    expect(() => createDraftPurchaseOrder()).toThrow(/not enabled/);
  });
});

describe("Zoho transforms", () => {
  it("maps Zoho items to Freshroots SKUs by SKU (trimmed, case-insensitive)", () => {
    const rows = mapItems(ITEMS, ["SKU001", "SKU003"]);
    expect(rows.map((r) => r.skuId)).toEqual(["SKU001", "SKU003", null]);
  });

  it("computes outstanding quantities and excludes draft/cancelled/received", () => {
    const map = new Map([["460000000011", "SKU001"], ["460000000012", "SKU003"]]);
    const lines = buildPoLines(Object.values(PO_DETAILS), map, CFG.excludedStatuses);
    const open = lines.filter((l) => l.isOpen);
    expect(open.map((l) => [l.purchaseorderNumber, l.skuId, l.quantityOutstanding])).toEqual([
      ["PO-00001", "SKU001", 500],
      ["PO-00002", "SKU003", 200],
      ["PO-00002", null, 5],
    ]);
    expect(lines.find((l) => l.purchaseorderId === "PO4")?.isOpen).toBe(false); // draft
    expect(lines.find((l) => l.purchaseorderId === "PO3")?.isOpen).toBe(false); // fully received
  });

  it("derives observed lead time from PO date to first receive date", () => {
    const map = new Map([["460000000011", "SKU001"], ["460000000012", "SKU003"]]);
    const lines = buildPoLines(Object.values(PO_DETAILS), map, CFG.excludedStatuses);
    const first = firstReceiveDates(RECEIVES);
    expect(first.get("PO2")).toBe("2026-09-09");
    const { obs } = leadTimeObservations(lines, first);
    expect(obs.map((o) => [o.skuId, o.leadTimeDays])).toEqual([
      ["SKU003", 8],
      ["SKU001", 10],
    ]);
    const s = summariseLeadTimes([...obs, { skuId: "SKU001", leadTimeDays: 14 }]);
    expect(s.get("SKU001")).toEqual({ n: 2, median: 12, min: 10, max: 14 });
  });

  it("prioritises possibly-open POs within the call budget", () => {
    const pick = choosePoDetails(PO_HEADERS, new Set(["PO2", "PO3"]), CFG.excludedStatuses, 2, "2025-10-01");
    expect(pick.ids).toEqual(["PO1", "PO2"]);
    expect(pick.openTruncated).toBe(false);
    const tight = choosePoDetails(PO_HEADERS, new Set(), CFG.excludedStatuses, 1, "2025-10-01");
    expect(tight.openTruncated).toBe(true);
  });
});

describe("Zoho client", () => {
  it("sends the Zoho-oauthtoken header and organization_id", async () => {
    const z = fakeZoho();
    const client = new ZohoReadClient(CFG, z.impl);
    await client.get("/items");
    const call = z.calls.find((c) => c.url.pathname === "/inventory/v1/items")!;
    expect(call.url.origin).toBe("https://www.zohoapis.in");
    expect(call.url.searchParams.get("organization_id")).toBe("60000000001");
    const token = z.calls.find((c) => c.url.pathname === "/oauth/v2/token")!;
    expect(token.url.origin).toBe("https://accounts.zoho.in");
    expect(token.url.searchParams.get("grant_type")).toBe("refresh_token");
  });

  it("refreshes the access token once on 401", async () => {
    const z = fakeZoho({ expireFirstToken: true });
    const client = new ZohoReadClient(CFG, z.impl);
    await expect(client.get("/items")).resolves.toMatchObject({ code: 0 });
    expect(z.calls.filter((c) => c.url.pathname === "/oauth/v2/token")).toHaveLength(2);
  });

  it("lists organisations", async () => {
    const z = fakeZoho();
    expect(await new ZohoReadClient(CFG, z.impl).organizations()).toEqual([{ organizationId: "60000000001", name: "Freshroots Test" }]);
  });
});

describe("Zoho sync with the database", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    await importSeedFiles(db, "test");
  });
  afterAll(async () => db.close());

  it("stores a snapshot with on-order quantities and lead times, using only GET calls against Zoho data", async () => {
    const z = fakeZoho();
    const s = await runZohoSync(db, { actor: "test", fetchImpl: z.impl, config: CFG, today: "2026-10-22" });
    expect(s).toMatchObject({ status: "succeeded", itemsSeen: 3, itemsMapped: 2, purchaseOrdersSeen: 5, openPoLines: 3, leadTimeObservations: 2 });
    expect(s.statusValuesSeen).toEqual(["cancelled", "draft", "issued", "partially_received", "received"]);
    expect(s.warnings.join(" ")).toMatch(/No Zoho item has SKU = SKU002/);
    const nonGet = z.calls.filter((c) => c.method !== "GET" && c.url.pathname !== "/oauth/v2/token");
    expect(nonGet).toEqual([]);

    const { bySku } = await getZohoSupplyBySku(db);
    expect(bySku.get("SKU001")).toMatchObject({ onOrder: 500, leadTime: { n: 1, median: 10 } });
    expect(bySku.get("SKU001")?.openLines[0]).toMatchObject({ purchaseorderNumber: "PO-00001", expectedDeliveryDate: "2026-10-24" });
    expect(bySku.get("SKU003")).toMatchObject({ onOrder: 200, leadTime: { median: 8 } });
    expect(bySku.has("SKU002")).toBe(false);
  });

  it("records a failed sync on rate limiting without touching existing data", async () => {
    const z = fakeZoho({ failStatus: 429 });
    const s = await runZohoSync(db, { actor: "test", fetchImpl: z.impl, config: CFG, today: "2026-10-22" });
    expect(s.status).toBe("failed");
    expect(s.error).toMatch(/rate limit/);
    const { sync, bySku } = await getZohoSupplyBySku(db);
    expect(sync?.status).toBe("succeeded"); // still reading the last good snapshot
    expect(bySku.get("SKU001")?.onOrder).toBe(500);
  });
});
