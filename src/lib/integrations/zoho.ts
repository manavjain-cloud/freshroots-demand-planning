/**
 * Zoho Inventory integration — READ-ONLY.
 *
 * Reads items, purchase orders and purchase receives so the app can show stock on order
 * and an observed (historical) lead time per SKU. Nothing is ever written to Zoho:
 * there is no create/update/delete call in this module, and draft purchase orders remain
 * a future phase that needs explicit approval.
 *
 * API reference: https://www.zoho.com/inventory/api/v1/ (OAuth, items, purchaseorders, purchasereceives).
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export const ZOHO_REQUIRED_ENV = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"] as const;
/** Kept for the settings page; the full list including optional domains. */
export const ZOHO_ENV_VARS = ["ZOHO_ACCOUNTS_DOMAIN", "ZOHO_API_DOMAIN", ...ZOHO_REQUIRED_ENV] as const;

export const ZOHO_READ_SCOPES = ["ZohoInventory.items.READ", "ZohoInventory.purchaseorders.READ", "ZohoInventory.purchasereceives.READ", "ZohoInventory.settings.READ"] as const;

/** Statuses never counted as "on order". Verify against your account (the sync records every status it sees). */
export const DEFAULT_EXCLUDED_PO_STATUSES = ["draft", "pending_approval", "approved", "rejected", "cancelled", "closed", "void"];

export interface ZohoConfig {
  configured: boolean;
  missing: string[];
  accountsDomain: string;
  apiDomain: string;
  organizationId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  maxPoDetails: number;
  historyDays: number;
  excludedStatuses: string[];
  timeoutMs: number;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function getZohoConfig(env: Record<string, string | undefined> = process.env): ZohoConfig {
  const v = (k: string) => env[k]?.trim() ?? "";
  const missing = ZOHO_REQUIRED_ENV.filter((k) => !v(k));
  const num = (k: string, d: number, min: number, max: number) => Math.min(Math.max(Number(v(k)) || d, min), max);
  return {
    configured: missing.length === 0,
    missing: [...missing],
    accountsDomain: trimSlash(v("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in"),
    apiDomain: trimSlash(v("ZOHO_API_DOMAIN") || "https://www.zohoapis.in"),
    organizationId: v("ZOHO_ORGANIZATION_ID"),
    clientId: v("ZOHO_CLIENT_ID"),
    clientSecret: v("ZOHO_CLIENT_SECRET"),
    refreshToken: v("ZOHO_REFRESH_TOKEN"),
    maxPoDetails: num("ZOHO_MAX_PO_DETAILS", 60, 1, 85),
    historyDays: num("ZOHO_HISTORY_DAYS", 365, 30, 1095),
    excludedStatuses: (v("ZOHO_EXCLUDED_PO_STATUSES") || DEFAULT_EXCLUDED_PO_STATUSES.join(",")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    timeoutMs: num("ZOHO_TIMEOUT_MS", 20_000, 2_000, 60_000),
  };
}

export type ZohoIntegrationState = "not_configured" | "configured_not_synced" | "synced" | "sync_failed";

export interface ZohoStatus {
  state: "not_configured" | "configured";
  readEnabled: boolean;
  writeEnabled: false;
  message: string;
  missing: string[];
}

export function getZohoStatus(env: Record<string, string | undefined> = process.env): ZohoStatus {
  const cfg = getZohoConfig(env);
  if (!cfg.configured) {
    const none = cfg.missing.length === ZOHO_REQUIRED_ENV.length;
    return {
      state: "not_configured",
      readEnabled: false,
      writeEnabled: false,
      message: none ? "Not connected. Add read-only Zoho credentials to enable purchase-order and lead-time data." : `Incomplete Zoho settings — missing ${cfg.missing.join(", ")}.`,
      missing: cfg.missing,
    };
  }
  return { state: "configured", readEnabled: true, writeEnabled: false, message: "Read-only access configured. The app never writes to Zoho.", missing: [] };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ZohoError extends Error {
  constructor(
    public kind: "not_configured" | "auth" | "rate_limited" | "timeout" | "upstream" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "ZohoError";
  }
}

/** Draft purchase orders are a future phase. This always throws. */
export class ZohoNotAvailableError extends Error {
  constructor(message = "Creating purchase orders in Zoho is not enabled. Approval in this app does not create or send a purchase order.") {
    super(message);
    this.name = "ZohoNotAvailableError";
  }
}
export function createDraftPurchaseOrder(): never {
  throw new ZohoNotAvailableError();
}

/* ------------------------------------------------------------------ */
/* Read-only client                                                    */
/* ------------------------------------------------------------------ */

const tokenCache = new Map<string, { token: string; apiDomain: string; expiresAt: number }>();

export function clearZohoTokenCache() {
  tokenCache.clear();
}

export class ZohoReadClient {
  apiCalls = 0;
  constructor(
    private cfg: ZohoConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!cfg.configured) throw new ZohoError("not_configured", `Zoho is not configured (missing ${cfg.missing.join(", ")}).`);
  }

  private async timed(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw new ZohoError("timeout", "Zoho did not respond in time.");
      throw new ZohoError("upstream", "Could not reach Zoho.");
    } finally {
      clearTimeout(t);
    }
  }

  /** Access token from the refresh token (cached until shortly before expiry). */
  async accessToken(force = false): Promise<{ token: string; apiDomain: string }> {
    const key = `${this.cfg.accountsDomain}|${this.cfg.clientId}`;
    const cached = tokenCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;
    const qs = new URLSearchParams({ refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: "refresh_token" });
    this.apiCalls++;
    const res = await this.timed(`${this.cfg.accountsDomain}/oauth/v2/token?${qs}`, { method: "POST" });
    const body = (await res.json().catch(() => null)) as { access_token?: string; api_domain?: string; expires_in?: number; error?: string } | null;
    if (!res.ok || !body?.access_token) {
      if (res.status === 429 || body?.error === "Access Denied") throw new ZohoError("rate_limited", "Zoho is limiting token requests. Try again in a few minutes.");
      throw new ZohoError("auth", `Zoho rejected the credentials${body?.error ? ` (${body.error})` : ""}. Check the client ID, secret, refresh token and accounts domain.`);
    }
    const entry = { token: body.access_token, apiDomain: trimSlash(this.cfg.apiDomain || body.api_domain || ""), expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    tokenCache.set(key, entry);
    return entry;
  }

  /** GET /inventory/v1{path}. Retries once with a fresh token on 401. */
  async get<T = Record<string, unknown>>(path: string, params: Record<string, string | number> = {}, retried = false): Promise<T> {
    const { token, apiDomain } = await this.accessToken(retried);
    const qs = new URLSearchParams({ organization_id: this.cfg.organizationId, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    this.apiCalls++;
    const res = await this.timed(`${apiDomain}/inventory/v1${path}?${qs}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (res.status === 401 && !retried) return this.get<T>(path, params, true);
    if (res.status === 429) throw new ZohoError("rate_limited", "Zoho API rate limit reached (100 requests/minute per organisation, plus a daily plan limit).");
    const body = (await res.json().catch(() => null)) as (T & { code?: number; message?: string }) | null;
    if (!res.ok || !body) throw new ZohoError(res.status === 401 || res.status === 403 ? "auth" : "upstream", `Zoho returned HTTP ${res.status}${body?.message ? `: ${body.message}` : ""}.`);
    if (typeof body.code === "number" && body.code !== 0) throw new ZohoError("bad_response", `Zoho error ${body.code}: ${body.message ?? "unknown"}.`);
    return body;
  }

  /** Follow page_context.has_more_page. `keys` = possible list keys in the response. */
  async list<T>(path: string, keys: string[], opts: { perPage?: number; maxPages?: number; params?: Record<string, string | number> } = {}): Promise<{ rows: T[]; truncated: boolean; keyFound: boolean }> {
    const rows: T[] = [];
    let keyFound = false;
    const maxPages = opts.maxPages ?? 10;
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.get<Record<string, unknown>>(path, { ...opts.params, page, per_page: opts.perPage ?? 200 });
      const key = keys.find((k) => Array.isArray(body[k]));
      if (key) {
        keyFound = true;
        rows.push(...(body[key] as T[]));
      }
      const pc = body.page_context as { has_more_page?: boolean } | undefined;
      if (!pc?.has_more_page) return { rows, truncated: false, keyFound };
    }
    return { rows, truncated: true, keyFound };
  }

  async organizations(): Promise<{ organizationId: string; name: string }[]> {
    const { token, apiDomain } = await this.accessToken();
    this.apiCalls++;
    const res = await this.timed(`${apiDomain}/inventory/v1/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const body = (await res.json().catch(() => null)) as { organizations?: { organization_id?: string; name?: string }[]; message?: string } | null;
    if (!res.ok || !body?.organizations) throw new ZohoError(res.status === 401 ? "auth" : "upstream", `Could not list Zoho organisations${body?.message ? `: ${body.message}` : ""}.`);
    return body.organizations.map((o) => ({ organizationId: String(o.organization_id ?? ""), name: String(o.name ?? "") }));
  }
}

/* ------------------------------------------------------------------ */
/* Pure transforms (unit-tested with fixtures)                         */
/* ------------------------------------------------------------------ */

export interface ZohoItemRow { zohoItemId: string; name: string | null; zohoSku: string | null; skuId: string | null; status: string | null }
export interface ZohoPoLineRow {
  purchaseorderId: string; purchaseorderNumber: string | null; poStatus: string | null; poDate: string | null; expectedDeliveryDate: string | null; deliveryDate: string | null;
  vendorName: string | null; lineItemId: string; zohoItemId: string | null; skuId: string | null; itemName: string | null; quantity: number; quantityReceived: number;
  quantityOutstanding: number; isOpen: boolean; locationName: string | null;
}
export interface LeadTimeObs { skuId: string; purchaseorderId: string; purchaseorderNumber: string | null; poDate: string; firstReceiveDate: string; leadTimeDays: number }

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
export const zDate = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v) ? v.slice(0, 10) : null);
const zStr = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const zNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const normStatus = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "_") : "");

/** Map Zoho items to Freshroots SKUs by the Zoho `sku` field (trimmed, case-insensitive). */
export function mapItems(items: Record<string, unknown>[], freshrootsSkuIds: string[]): ZohoItemRow[] {
  const lookup = new Map(freshrootsSkuIds.map((s) => [s.toLowerCase(), s]));
  return items
    .filter((i) => zStr(i.item_id))
    .map((i) => {
      const zohoSku = zStr(i.sku)?.trim() ?? null;
      return { zohoItemId: String(i.item_id), name: zStr(i.name), zohoSku, skuId: zohoSku ? (lookup.get(zohoSku.toLowerCase()) ?? null) : null, status: zStr(i.status) };
    });
}

/** Flatten PO detail responses into lines. A line is "open" if its PO status is not excluded and quantity remains outstanding. */
export function buildPoLines(details: Record<string, unknown>[], itemToSku: Map<string, string | null>, excludedStatuses: string[]): ZohoPoLineRow[] {
  const excluded = new Set(excludedStatuses);
  const out: ZohoPoLineRow[] = [];
  for (const po of details) {
    const status = normStatus(po.status);
    const lines = Array.isArray(po.line_items) ? (po.line_items as Record<string, unknown>[]) : [];
    for (const l of lines) {
      const lineItemId = zStr(l.line_item_id);
      if (!lineItemId) continue;
      const qty = zNum(l.quantity);
      const rec = zNum(l.quantity_received);
      const outstanding = Math.max(qty - rec, 0);
      const zohoItemId = zStr(l.item_id);
      out.push({
        purchaseorderId: String(po.purchaseorder_id),
        purchaseorderNumber: zStr(po.purchaseorder_number),
        poStatus: status || null,
        poDate: zDate(po.date),
        expectedDeliveryDate: zDate(po.expected_delivery_date),
        deliveryDate: zDate(po.delivery_date),
        vendorName: zStr(po.vendor_name),
        lineItemId,
        zohoItemId,
        skuId: zohoItemId ? (itemToSku.get(zohoItemId) ?? null) : null,
        itemName: zStr(l.name),
        quantity: qty,
        quantityReceived: rec,
        quantityOutstanding: outstanding,
        isOpen: !excluded.has(status) && outstanding > 0,
        locationName: zStr(l.location_name),
      });
    }
  }
  return out;
}

/** First receive date per purchase order, from the purchase-receives list. */
export function firstReceiveDates(receives: Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of receives) {
    const po = zStr(r.purchaseorder_id);
    const d = zDate(r.receive_date) ?? zDate(r.date);
    if (!po || !d) continue;
    const cur = out.get(po);
    if (!cur || d < cur) out.set(po, d);
  }
  return out;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Observed lead time per mapped SKU per PO: PO date → first receive date. */
export function leadTimeObservations(lines: ZohoPoLineRow[], firstReceive: Map<string, string>): { obs: LeadTimeObs[]; skipped: number } {
  const seen = new Set<string>();
  const obs: LeadTimeObs[] = [];
  let skipped = 0;
  for (const l of lines) {
    if (!l.skuId || !l.poDate) continue;
    const rd = firstReceive.get(l.purchaseorderId);
    if (!rd) continue;
    const key = `${l.skuId}|${l.purchaseorderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const days = dayDiff(l.poDate, rd);
    if (days < 0) {
      skipped++;
      continue;
    }
    obs.push({ skuId: l.skuId, purchaseorderId: l.purchaseorderId, purchaseorderNumber: l.purchaseorderNumber, poDate: l.poDate, firstReceiveDate: rd, leadTimeDays: days });
  }
  return { obs, skipped };
}

export function summariseLeadTimes(obs: { skuId: string; leadTimeDays: number }[]): Map<string, { n: number; median: number; min: number; max: number }> {
  const by = new Map<string, number[]>();
  for (const o of obs) by.set(o.skuId, [...(by.get(o.skuId) ?? []), o.leadTimeDays]);
  const out = new Map<string, { n: number; median: number; min: number; max: number }>();
  for (const [sku, arr] of by) {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    out.set(sku, { n: s.length, median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, min: s[0], max: s[s.length - 1] });
  }
  return out;
}

/**
 * Decide which PO details to fetch within the call budget: possibly-open POs first
 * (status not excluded and not fully received/closed), then recent received POs for lead times.
 */
export function choosePoDetails(
  headers: Record<string, unknown>[],
  receivedPoIds: Set<string>,
  excludedStatuses: string[],
  cap: number,
  sinceDate: string,
): { ids: string[]; openCandidates: number; openTruncated: boolean } {
  const excluded = new Set(excludedStatuses);
  const done = new Set(["received", "billed", "closed"]);
  const withId = headers.filter((h) => zStr(h.purchaseorder_id));
  const open = withId.filter((h) => !excluded.has(normStatus(h.status)) && !done.has(normStatus(h.status)));
  const byDateDesc = (a: Record<string, unknown>, b: Record<string, unknown>) => String(zDate(b.date) ?? "").localeCompare(String(zDate(a.date) ?? ""));
  const history = withId
    .filter((h) => !open.includes(h) && !excluded.has(normStatus(h.status)) && receivedPoIds.has(String(h.purchaseorder_id)) && (zDate(h.date) ?? "") >= sinceDate)
    .sort(byDateDesc);
  const ids = [...open.sort(byDateDesc), ...history].slice(0, cap).map((h) => String(h.purchaseorder_id));
  return { ids, openCandidates: open.length, openTruncated: open.length > cap };
}
