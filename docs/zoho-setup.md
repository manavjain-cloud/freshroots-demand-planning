# Connecting Zoho Inventory (read-only)

This takes about 10 minutes. The app only **reads** from Zoho: items, purchase orders and purchase receives. It never creates, edits or deletes anything there.

Sources: Zoho Inventory API docs — [OAuth](https://www.zoho.com/inventory/api/v1/oauth/), [Introduction / data centres](https://www.zoho.com/inventory/api/v1/introduction/), [Self Client](https://www.zoho.com/accounts/protocol/oauth/self-client/overview.html), [authorization code flow](https://www.zoho.com/accounts/protocol/oauth/self-client/authorization-code-flow.html).

## What you need

| Value | Where it comes from | Secret? |
|---|---|---|
| `ZOHO_CLIENT_ID` | API Console → Self Client → *Client Secret* tab | No, but keep private |
| `ZOHO_CLIENT_SECRET` | Same tab | **Yes** |
| `ZOHO_REFRESH_TOKEN` | Created by `npm run zoho:token` from a one-time code | **Yes** — long-lived |
| `ZOHO_ORGANIZATION_ID` | Saved automatically by the same script (or Zoho Inventory → Settings → Manage organisations) | No |
| `ZOHO_ACCOUNTS_DOMAIN` | `https://accounts.zoho.in` for India (default). US: `.com`, EU: `.eu`, Australia: `.com.au` | No |
| `ZOHO_API_DOMAIN` | `https://www.zohoapis.in` for India (default); saved from Zoho's token response | No |

Read-only scopes (all four are needed):

```
ZohoInventory.items.READ,ZohoInventory.purchaseorders.READ,ZohoInventory.purchasereceives.READ,ZohoInventory.settings.READ
```

`settings.READ` is only used to list your organisations and test the connection.

**Do not paste any of these into chat.** Put them in `D:\Demand Planning Dashboard\API_KEYS.txt` (outside the repo).

## Step 1 — Have a Zoho Inventory organisation

Use Freshroots' Zoho Inventory account, or a test/trial organisation. Sign in to the same Zoho account you will use in step 2. For the app to match data, each Zoho **item's SKU field must equal the Freshroots SKU_ID** (e.g. `SKU001`). Items without a matching SKU are reported, not guessed.

## Step 2 — Create a Self Client

1. Open the Zoho API Console for your account's data centre: **https://api-console.zoho.in** for an India account (use the domain you normally sign in to Zoho with; `api-console.zoho.com` for US accounts).
2. Click **GET STARTED** (or **ADD CLIENT**), choose **Self Client**, click **CREATE NOW**, then **CREATE** and **OK**.
3. Open the **Client Secret** tab and copy the **Client ID** and **Client Secret** into `API_KEYS.txt`:

```
ZOHO_CLIENT_ID=1000.xxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxx
```

## Step 3 — Generate a one-time code and exchange it (do this quickly)

The code expires in a few minutes (3 minutes by default), so have the terminal ready first.

1. In the Self Client, open the **Generate Code** tab.
2. **Scope:** paste the four scopes above (comma-separated, no spaces).
3. **Time Duration:** choose the longest option offered.
4. **Scope Description:** e.g. `Freshroots demand planning read-only`.
5. Click **CREATE**, select the Zoho Inventory organisation if asked, and copy the code.
6. Immediately run, in `D:\Demand Planning Dashboard\freshroots-demand-planning`:

```bash
npm run zoho:token -- PASTE_THE_CODE_HERE
```

The script exchanges the code at `https://accounts.zoho.in/oauth/v2/token`, saves the refresh token, API domain, client ID/secret and (if you have one organisation) the organisation ID into `.env.local` and `API_KEYS.txt`, and prints your organisation name. It never prints tokens. If it says the code expired, generate a new one and run it again.

## Step 4 — Sync

```bash
npm run zoho:sync
```

or open **Rules & Settings → Zoho Inventory → Test connection / Sync from Zoho**. The sync reports how many items matched Freshroots SKUs, open purchase-order lines, lead-time observations, the PO status values it saw, and any warnings.

## Step 5 — Production (Vercel)

Add `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID` (and the two domains if not India) as **sensitive** environment variables for Production, then redeploy. Claude can do this from `API_KEYS.txt` without the values appearing in chat.

## What the app does with the data

- **On order** = quantity − quantity received on purchase-order lines whose status is not `draft`, `pending_approval`, `approved`, `rejected`, `cancelled`, `closed` or `void` (configurable with `ZOHO_EXCLUDED_PO_STATUSES`). Check the "PO statuses seen" list after your first sync and tell Claude if your account uses other names.
- **Observed lead time** = days from PO date to the first purchase receive, median over received POs in the last 365 days (`ZOHO_HISTORY_DAYS`). Zoho Inventory has no supplier lead-time field, so this is an observation, not a supplier commitment.
- Both are shown on the SKU page, the review screen, the planning table and the CSV export. **The rules still use on-hand stock only** — whether stock on order should count towards cover is an open policy decision (P9).

## Limits

Zoho allows 100 API requests per minute per organisation and a daily limit by plan (1,000/day on the free plan). One sync uses roughly 5 + the number of purchase orders read in detail, capped at 85 detail reads (`ZOHO_MAX_PO_DETAILS`, default 60). Possibly-open POs are read first; if there are more than the cap, the sync warns that on-order may be understated.

## Revoking access

Delete the Self Client in the API Console, or revoke the refresh token. The app then shows "sync failed" and keeps the last successful snapshot, clearly dated.
