import { loadLocalEnv } from "./env";
import { createPgDb } from "../src/lib/db/client";
import { migrate } from "../src/lib/db/migrate";
import { importSeedFiles } from "../src/lib/server/imports";
import { createRun, ensureActiveConfig } from "../src/lib/server/runs";

/**
 * Apply migrations, import the five supplied seed CSVs (idempotent), make sure a rule
 * configuration exists, and optionally create a recommendation run (--run).
 */
loadLocalEnv();
const actor = "Setup script (IT data setup)";

(async () => {
  const db = createPgDb(process.env.DATABASE_URL!);
  const ran = await migrate(db);
  console.log(ran.length ? `Migrations applied: ${ran.join(", ")}` : "Schema is up to date.");
  const results = await importSeedFiles(db, actor);
  for (const r of results) {
    console.log(`${r.dataset.padEnd(13)} ${r.status.padEnd(9)} rows=${r.rowsTotal} inserted=${r.inserted} updated=${r.updated} unchanged=${r.unchanged} errors=${r.errors.length}`);
    for (const e of r.errors.slice(0, 10)) console.log(`   line ${e.rowNumber ?? "-"} ${e.column ?? ""}: ${e.message}`);
  }
  await ensureActiveConfig(db, actor);
  if (process.argv.includes("--run")) {
    const { runId, result } = await createRun(db, { actor });
    console.log(`Recommendation run #${runId} created for snapshot ${result.asOfDate} (${result.recommendations.length} SKUs).`);
  }
  process.exit(results.some((r) => r.status === "rejected") ? 2 : 0);
})().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
