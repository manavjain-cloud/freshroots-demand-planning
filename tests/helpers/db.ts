import { PGlite } from "@electric-sql/pglite";
import type { Db, Tx } from "../../src/lib/db/client";
import { migrate } from "../../src/lib/db/migrate";

/** In-memory Postgres (PGlite) implementing the app's Db interface, with migrations applied. */
export async function createTestDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = new PGlite();
  const db: Db & { close(): Promise<void> } = {
    async query<T>(text: string, params?: unknown[]) {
      const r = await pg.query<T>(text, params as unknown[]);
      return { rows: r.rows };
    },
    async exec(text: string) {
      await pg.exec(text);
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>) {
      return pg.transaction(async (t) => {
        const tx: Tx = {
          async query<R>(text: string, params?: unknown[]) {
            const r = await t.query<R>(text, params as unknown[]);
            return { rows: r.rows };
          },
          async exec(text: string) {
            await t.exec(text);
          },
        };
        return fn(tx);
      });
    },
    async close() {
      await pg.close();
    },
  };
  await migrate(db);
  return db;
}
