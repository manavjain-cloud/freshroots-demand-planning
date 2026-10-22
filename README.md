# Freshroots Demand Planning

A decision-support app for Freshroots' demand planner. It imports sales, SKU, distributor, inventory and calendar data, applies the planner's documented rules in a deterministic engine, and produces demand classifications, stock-risk flags and reorder recommendations that a human reviews. Gemini adds optional plain-language explanations; it never sets quantities or classifications. Nothing is ordered automatically.

Built for the MESA AI-Native Track, Term 2 case ("Deepa's 90-Day Mandate" — Option A: Demand Planning).

## What it does

| Module | What you get |
|---|---|
| **Overview** | KPIs from the latest run (SKUs, high demand, stockout and overstock risk, items awaiting review, snapshot date, festival month, data quality), review queue preview, AI planning summary |
| **Demand Planning** | Searchable, sortable table with filters (category, distributor, region, perishability, risk, status), CSV export of the filtered view, mobile card layout |
| **SKU Explorer** | Weekly sales chart with 4/12-week averages and festival weeks, every calculation step, rule-by-rule status, review panel, AI explanation, run history |
| **Recommendations** | Pending / exception / reviewed queues; approve, edit quantity (original kept), reject with reason, add notes; decision history |
| **Insights & Reports** | Review outcome rates and time-to-review, category demand trends, baseline-method evaluation (forecast vs actual), stock-risk summary, case baseline, CSV downloads, run history |
| **Data Imports** | Upload/validate CSVs (all-or-nothing, row-level errors), re-import seed files, data-quality checklist, import history |
| **Rules & Settings** | Versioned rule configuration with provenance (case / assumption / proposed), precedence, open policy decisions, integration status, Nine Checks, pre-build decisions, ownership, audit log |

What it does **not** do: create or send purchase orders, write to Zoho, claim forecast accuracy for the rule-based recommendations, or claim savings/ROI.

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · Neon PostgreSQL (`pg`) · Gemini (Google API or via OpenRouter) · Recharts · Zod · Vitest + PGlite · Vercel · GitHub.

## Local setup

Prerequisites: Node.js 20.9+ (tested on 24), a Neon project, a Gemini key (optional — the app works without AI).

```bash
npm install
cp .env.example .env.local      # then fill in DATABASE_URL and GEMINI_API_KEY
npm run db:seed                 # migrations + import the 5 seed CSVs + first run
npm run dev
```

`npm run db:seed` is idempotent: re-running it changes nothing unless the CSVs changed (it creates a new run each time). Use `npm run db:migrate` to apply schema changes only.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Neon pooled connection string (`…-pooler…`, `sslmode=verify-full`) |
| `GEMINI_API_KEY` | No | Google AI Studio key **or** an OpenRouter key (`sk-or-…`); OpenRouter keys route to `google/gemini-3.8-flash` |
| `OPENROUTER_API_KEY` | No | Alternative place for an OpenRouter key |
| `AI_MODEL`, `AI_MODEL_FALLBACKS`, `AI_TIMEOUT_MS` | No | Model selection and timeout (default 30 s) |
| `AI_RATE_LIMIT_PER_HOUR`, `AI_RATE_LIMIT_GLOBAL_PER_DAY` | No | Defaults 30 per client per hour, 300 per day |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | No | Optional shared site password (not per-user identity) |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID` | No | Read-only Zoho Inventory access; see [docs/zoho-setup.md](docs/zoho-setup.md). Optional `ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` (India defaults) |

Secrets are read only on the server. Nothing is exposed with a `NEXT_PUBLIC_` prefix.

### Connecting Neon

Create a project (or a branch for development) in Neon, copy the **pooled** connection string into `DATABASE_URL`, then run `npm run db:seed`. Use a separate Neon branch for local testing so test reviews do not mix with pilot data.

### Connecting Gemini

Put a Google AI Studio key in `GEMINI_API_KEY` to call the Gemini API directly, or an OpenRouter key to call Gemini through OpenRouter. If the key is missing, invalid or the service times out, AI panels show "temporarily unavailable" and everything else keeps working.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm test` | Vitest (rule engine, validation, imports, runs, reviews, exports, AI failure handling) |
| `npm run check` | All of the above + build |
| `npm run db:migrate` | Apply SQL migrations in `db/migrations` |
| `npm run db:seed` | Migrate, import `data/seed/*.csv`, create a run |
| `npm run zoho:token -- <code>` | One-time: exchange a Zoho Self Client code for a refresh token (saved to `.env.local`, never printed) |
| `npm run zoho:sync` | Read-only sync of Zoho items, purchase orders and receives |

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js).
2. Add `DATABASE_URL` and `GEMINI_API_KEY` (and any optional variables) for Production and Preview.
3. Run `npm run db:seed` once from your machine against the production `DATABASE_URL` (migrations are not run during the Vercel build).
4. Deploy. Pushes to `main` redeploy automatically. `GET /api/health` reports database and AI configuration status without exposing secrets.

## How the rules work

Full detail: [docs/business-rules.md](docs/business-rules.md). Summary:

- Windows end at the last complete ISO week before the inventory snapshot (19 Oct 2026 → W42). Recent = 4 weeks, baseline = 12 weeks (includes the recent 4).
- High demand: `avg4 > avg12 × 1.20` (strict) → reorder at 1.5× standard quantity.
- Weeks of stock = stock ÷ (12-week avg × 1.25 in festival months). Non-perishable: below 6 → stockout risk; above 14 → overstock. Perishable (`High`): 3–4 weeks.
- Precedence: data problems → overstock pause → below minimum → high demand → no action. Conflicts are escalated, never silently resolved.
- Quantities round up; the raw value is stored. Where the case gives no quantity (perishable below minimum), the planner sets it.

## Data and imports

See [docs/data-model.md](docs/data-model.md). The five original seed files are kept unchanged in `data/seed/`. Imports validate columns, types, ISO weeks, dates, booleans, duplicates and references, store the original rows, and reject the whole file if any row is invalid.

## AI layer

`src/lib/ai/*` and `src/lib/server/ai.ts`. The server builds a facts object from the stored rule-engine output (no secrets, no personal data), asks Gemini for schema-constrained JSON, validates it with Zod, drops references to unknown SKUs, and flags any number that does not trace back to a fact. Results are cached per recommendation/run, rate-limited per client and globally, and labelled as AI-generated.

## Testing

`npm test` runs 88 tests, including every case in the brief's test list:

| Brief item | Where |
|---|---|
| 1–3 high-demand threshold below / at / above | `tests/engine.test.ts` |
| 4–6 coverage below 6, exactly 6, above 14 (and exactly 14) | `tests/engine.test.ts` |
| 7 perishable thresholds | `tests/engine.test.ts` |
| 8 festival vs non-festival, single uplift, both modes | `tests/engine.test.ts` |
| 9–10 zero/missing sales, missing inventory | `tests/engine.test.ts` |
| 11–12 duplicate rows, invalid SKU/distributor references | `tests/weeks-validate.test.ts`, `tests/workflows.db.test.ts` |
| 13 conflicting signals | `tests/engine.test.ts` |
| 14 Gemini timeout, malformed / off-schema JSON (with one retry), 429, invented figures | `tests/ai.test.ts` |
| 15 approve / edit / reject / note, guards, superseded runs | `tests/workflows.db.test.ts` |
| 16 CSV export accuracy and escaping | `tests/workflows.db.test.ts` |
| Zoho read-only client, SKU mapping, on-order, lead times, GET-only, failures | `tests/zoho.test.ts` |

Database tests run against an in-memory Postgres (PGlite) with the real migrations.

## Project structure

```
data/seed/            Original five CSV files (unchanged)
db/migrations/        Versioned SQL schema
docs/                 Business rules, data model, governance, Zoho plan
scripts/              db:migrate and db:seed
src/app/              Pages, server actions, API routes (AI, export, health)
src/components/       UI (Red Noir design), charts, review/import/config forms
src/lib/rules/        Rule configuration + deterministic engine
src/lib/imports/      CSV validation
src/lib/server/       Database queries, imports, runs, reviews, exports, AI service
src/lib/ai/           Gemini provider adapter, prompts, schemas, grounding check
src/lib/integrations/ Zoho Inventory read-only client
tests/                Vitest suites
```

## Known limitations

- 16 weeks of history, 15 SKUs, 4 distributors and one inventory snapshot — a pilot sample; no multi-year seasonality.
- No prices or stockout events, so no financial impact is calculated. Stock on order and observed lead times appear once Zoho is connected, but the rules do not net them off (policy decision P9).
- No user authentication; reviewer names are self-declared (see [docs/governance.md](docs/governance.md)).
- Open policy questions (coverage average, perishable quantity, festival month basis, kill-criterion thresholds) need owner sign-off.
- Zoho Inventory: read-only integration built and tested with fixtures, awaiting credentials and a first live check ([docs/zoho-setup.md](docs/zoho-setup.md)). Draft purchase orders are not built ([docs/zoho-integration.md](docs/zoho-integration.md)).
- The visual design follows the Red Noir description in the brief (colours, fonts, conic border, grid texture); the original Red Noir HTML reference file was not available in the workspace.
