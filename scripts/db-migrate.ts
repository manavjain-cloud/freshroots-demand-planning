import { loadLocalEnv } from "./env";
import { createPgDb } from "../src/lib/db/client";
import { migrate } from "../src/lib/db/migrate";

loadLocalEnv();
const db = createPgDb(process.env.DATABASE_URL!);
migrate(db)
  .then((ran) => {
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Schema is up to date.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
