import { Pool, types } from "pg";

/** Minimal query interface shared by the Neon (pg) pool and the in-memory test database. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Tx extends Queryable {
  /** Run several statements (no parameters), e.g. a migration file. */
  exec(text: string): Promise<void>;
}

export interface Db extends Tx {
  /** Run `fn` inside a transaction; rolls back on any thrown error. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// Return DATE and NUMERIC columns as strings; callers convert explicitly.
types.setTypeParser(1082, (v: string) => v);

export function createPgDb(connectionString: string): Db {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    async exec(text: string) {
      await pool.query(text);
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Tx = {
          async query<R>(text: string, params?: unknown[]) {
            const res = await client.query(text, params as unknown[]);
            return { rows: res.rows as R[] };
          },
          async exec(text: string) {
            await client.query(text);
          },
        };
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

const globalForDb = globalThis as unknown as { __freshrootsDb?: Db };

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return !!globalForDb.__freshrootsDb || !!process.env.DATABASE_URL;
}

/** Shared database handle. Server-only. */
export function getDb(): Db {
  if (globalForDb.__freshrootsDb) return globalForDb.__freshrootsDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  globalForDb.__freshrootsDb = createPgDb(url);
  return globalForDb.__freshrootsDb;
}

/** Test hook: inject a database (e.g. PGlite). */
export function setDb(db: Db | undefined) {
  globalForDb.__freshrootsDb = db;
}
