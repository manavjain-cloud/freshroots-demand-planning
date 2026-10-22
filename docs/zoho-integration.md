# Zoho Inventory integration

**Status: read-only phase built; waiting for credentials.** Setup: [zoho-setup.md](zoho-setup.md).

## Phase 1 — read-only (built)

Code: [`src/lib/integrations/zoho.ts`](../src/lib/integrations/zoho.ts) (OAuth refresh, GET-only client, pure transforms) and [`src/lib/server/zoho-sync.ts`](../src/lib/server/zoho-sync.ts) (snapshot storage and per-SKU reads). Schema: [`db/migrations/002_zoho_readonly.sql`](../db/migrations/002_zoho_readonly.sql).

- Reads `GET /items`, `GET /purchaseorders`, `GET /purchaseorders/{id}` and `GET /purchasereceives` (Zoho Inventory API v1) with the `Zoho-oauthtoken` header and `organization_id`.
- Maps Zoho items to Freshroots SKUs by the item SKU field.
- Stores each sync as a snapshot (`zoho_sync_runs`, `zoho_items`, `zoho_po_lines`, `zoho_lead_time_obs`); pages read the latest successful one, so a failed sync never blanks the data.
- Shows stock on order and observed lead time on the SKU page, review screen, planning table, CSV export and AI facts. **Rules are unchanged**: on-hand stock only (policy decision P9).
- Never writes to Zoho; `createDraftPurchaseOrder()` always throws. Tests assert the sync makes only GET calls to the Zoho API.
- Tested with fixtures shaped like the documented responses (`tests/zoho.test.ts`). **Not yet verified against a live Zoho account**: the first real sync should be checked (status names, SKU matching, dates).

## Phase 2 — draft purchase orders (not built)

Needs explicit approval from the project owner first. Before building it:

1. Confirm the read-only data matches Zoho after the first live sync (status names, SKU matching, dates).
2. Add the `ZohoInventory.purchaseorders.CREATE` scope only then, on a separate credential if possible.
3. Agree field mappings for vendors (Freshroots distributor IDs vs Zoho vendor contacts), units and locations.
4. Create **draft** purchase orders only from approved or edited planner decisions, with an idempotency key, the Zoho PO id stored against the decision, and procurement still approving inside Zoho.
5. Test against a Zoho test organisation before any production write.

Until then the app remains fully usable with CSV imports, manual review and read-only Zoho data.
