import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";

export function migrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

/** Apply pending versioned SQL migrations in filename order. Idempotent. */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
    ran.push(file);
  }
  return ran;
}
