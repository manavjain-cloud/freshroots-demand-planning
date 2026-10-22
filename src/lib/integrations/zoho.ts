/**
 * Zoho Inventory integration — NEXT PHASE. Interface only.
 *
 * Nothing here calls Zoho. The planned capabilities (read purchase-order status and
 * supplier lead times, create DRAFT purchase orders) need confirmed API access,
 * credentials, field mappings and an approved procurement workflow first.
 * Until then the app runs entirely on CSV data and manual review.
 */

export type ZohoIntegrationState = "not_configured" | "credentials_present_unverified";

export interface ZohoStatus {
  state: ZohoIntegrationState;
  readEnabled: false;
  writeEnabled: false;
  message: string;
  missing: string[];
}

export interface ZohoPurchaseOrderSummary {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: string;
  skuId: string;
  quantity: number;
  expectedDeliveryDate: string | null;
}

export interface ZohoDraftPurchaseOrderRequest {
  recommendationId: number;
  skuId: string;
  quantity: number;
  /** Must reference an approved/edited planner decision. */
  reviewDecisionId: number;
}

/** Contract a future, verified Zoho client must satisfy. */
export interface ZohoInventoryClient {
  getStatus(): ZohoStatus;
  fetchOpenPurchaseOrders(skuIds: string[]): Promise<ZohoPurchaseOrderSummary[]>;
  fetchSupplierLeadTimes(skuIds: string[]): Promise<Record<string, number | null>>;
  createDraftPurchaseOrder(req: ZohoDraftPurchaseOrderRequest): Promise<never>;
}

export const ZOHO_ENV_VARS = ["ZOHO_API_DOMAIN", "ZOHO_ORGANIZATION_ID", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"] as const;

export class ZohoNotAvailableError extends Error {
  constructor(message = "Zoho Inventory integration is not active in this version. No data was sent to or read from Zoho.") {
    super(message);
    this.name = "ZohoNotAvailableError";
  }
}

export function getZohoStatus(env: Record<string, string | undefined> = process.env): ZohoStatus {
  const missing = ZOHO_ENV_VARS.filter((k) => !env[k]?.trim());
  if (missing.length === ZOHO_ENV_VARS.length) {
    return { state: "not_configured", readEnabled: false, writeEnabled: false, message: "Not connected. Planned for the next phase, subject to API access, credentials and permissions.", missing: [...missing] };
  }
  return {
    state: "credentials_present_unverified",
    readEnabled: false,
    writeEnabled: false,
    message: "Some Zoho settings are present, but the connection has not been implemented or verified. No calls are made.",
    missing: [...missing],
  };
}

/** The only client in this version: it never calls Zoho and never pretends to. */
export const disabledZohoClient: ZohoInventoryClient = {
  getStatus: () => getZohoStatus(),
  async fetchOpenPurchaseOrders() {
    throw new ZohoNotAvailableError();
  },
  async fetchSupplierLeadTimes() {
    throw new ZohoNotAvailableError();
  },
  async createDraftPurchaseOrder() {
    throw new ZohoNotAvailableError("Creating purchase orders is disabled. Approval in this app does not create or send a purchase order.");
  },
};
