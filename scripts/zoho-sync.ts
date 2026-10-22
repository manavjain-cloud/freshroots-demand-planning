import { loadLocalEnv } from "./env";
import { createPgDb } from "../src/lib/db/client";
import { migrate } from "../src/lib/db/migrate";
import { runZohoSync } from "../src/lib/server/zoho-sync";

/** Read-only Zoho sync from the terminal: npm run zoho:sync */
loadLocalEnv();
(async () => {
  const db = createPgDb(process.env.DATABASE_URL!);
  await migrate(db);
  const s = await runZohoSync(db, { actor: "Zoho sync script" });
  console.log(`Sync #${s.id}: ${s.status}${s.error ? ` — ${s.error}` : ""}`);
  console.log(`Items ${s.itemsSeen} (mapped ${s.itemsMapped}) · POs ${s.purchaseOrdersSeen} (details ${s.poDetailsFetched}) · open lines ${s.openPoLines} · receives ${s.receivesSeen} · lead-time observations ${s.leadTimeObservations} · API calls ${s.apiCalls}`);
  if (s.statusValuesSeen.length) console.log(`PO statuses seen: ${s.statusValuesSeen.join(", ")}`);
  for (const w of s.warnings) console.log(`Warning: ${w}`);
  process.exit(s.status === "succeeded" ? 0 : 2);
})().catch((err) => {
  console.error("Zoho sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
