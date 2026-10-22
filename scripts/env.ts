import { existsSync } from "node:fs";

/** Load .env.local / .env for CLI scripts (Next.js loads them itself for the app). */
export function loadLocalEnv() {
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) process.loadEnvFile(f);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.");
    process.exit(1);
  }
}
