# Zoho Inventory — next-phase integration plan

**Status: not connected.** This version makes no calls to Zoho. Approving a recommendation records a review decision only; it does not create, send or sync a purchase order.

The interface lives in [`src/lib/integrations/zoho.ts`](../src/lib/integrations/zoho.ts):

- `getZohoStatus()` reports `not_configured` or `credentials_present_unverified` (reads and writes always disabled).
- `ZohoInventoryClient` defines the future contract: `fetchOpenPurchaseOrders`, `fetchSupplierLeadTimes`, `createDraftPurchaseOrder`.
- `disabledZohoClient` is the only implementation and throws `ZohoNotAvailableError`.

## What is needed before building it

1. **API access confirmed** for the Freshroots Zoho Inventory organisation (data centre, e.g. `.in`), and an owner who approves the integration.
2. **OAuth credentials** (server-side only, as environment variables): `ZOHO_API_DOMAIN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`. Start with read-only scopes.
3. **Field mappings** verified: Freshroots `SKU_ID` ↔ Zoho item ID; distributor/vendor IDs; units of measure; warehouse/location names.
4. **Read phase first:** fetch open purchase orders and expected delivery dates so projected cover can include stock already on order, and supplier lead times so "immediate reorder" can be checked against lead time.
5. **Write phase only after approval:** create *draft* purchase orders from approved/edited decisions only, with idempotency keys, a stored Zoho PO id per decision, and procurement still approving inside Zoho.
6. Tests against a Zoho sandbox or recorded fixtures before any production write.

Until then the app remains fully usable with CSV imports and manual review.
