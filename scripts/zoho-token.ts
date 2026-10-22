/**
 * One-time Zoho setup: exchange a Self Client grant code for a refresh token.
 *
 *   npm run zoho:token -- <grant-code>
 *
 * Reads ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_ACCOUNTS_DOMAIN (default
 * https://accounts.zoho.in) from .env.local or ../API_KEYS.txt. Saves them plus ZOHO_REFRESH_TOKEN, ZOHO_API_DOMAIN
 * and, if there is exactly one organisation, ZOHO_ORGANIZATION_ID into .env.local and
 * into ../API_KEYS.txt if that file exists. Tokens are never printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILES = [".env.local", "../API_KEYS.txt"].filter((f) => f === ".env.local" || existsSync(f));

function readVar(name: string): string {
  if (process.env[name]) return process.env[name]!.trim();
  for (const f of FILES) {
    if (!existsSync(f)) continue;
    const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
    if (m && m[1].trim()) return m[1].trim();
  }
  return "";
}

function upsertVar(file: string, name: string, value: string) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  writeFileSync(file, re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`);
}

(async () => {
  const code = process.argv[2]?.trim();
  if (!code) {
    console.error("Usage: npm run zoho:token -- <grant-code from the Zoho API Console Self Client>");
    process.exit(1);
  }
  const clientId = readVar("ZOHO_CLIENT_ID");
  const clientSecret = readVar("ZOHO_CLIENT_SECRET");
  const accounts = (readVar("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in").replace(/\/+$/, "");
  if (!clientId || !clientSecret) {
    console.error("Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.local (or ../API_KEYS.txt) first.");
    process.exit(1);
  }
  const qs = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code });
  const res = await fetch(`${accounts}/oauth/v2/token?${qs}`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; api_domain?: string; error?: string };
  if (!body.refresh_token || !body.access_token) {
    console.error(`Zoho did not return a refresh token${body.error ? ` (${body.error})` : ""}. The code may have expired (it lasts only a few minutes), been used already, or belong to a different data centre than ${accounts}.`);
    process.exit(1);
  }
  const apiDomain = (body.api_domain || "https://www.zohoapis.in").replace(/\/+$/, "");
  for (const f of FILES) {
    upsertVar(f, "ZOHO_CLIENT_ID", clientId);
    upsertVar(f, "ZOHO_CLIENT_SECRET", clientSecret);
    upsertVar(f, "ZOHO_ACCOUNTS_DOMAIN", accounts);
    upsertVar(f, "ZOHO_API_DOMAIN", apiDomain);
    upsertVar(f, "ZOHO_REFRESH_TOKEN", body.refresh_token);
  }
  console.log(`Refresh token saved to ${FILES.join(" and ")} (not shown). API domain: ${apiDomain}`);

  const orgRes = await fetch(`${apiDomain}/inventory/v1/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${body.access_token}` } });
  const orgs = ((await orgRes.json().catch(() => ({}))) as { organizations?: { organization_id: string; name: string }[] }).organizations ?? [];
  if (!orgs.length) {
    console.log("Could not list organisations (the ZohoInventory.settings.READ scope may be missing). Set ZOHO_ORGANIZATION_ID manually.");
  } else {
    for (const o of orgs) console.log(`Organisation: ${o.name} — ${o.organization_id}`);
    if (orgs.length === 1) {
      for (const f of FILES) upsertVar(f, "ZOHO_ORGANIZATION_ID", String(orgs[0].organization_id));
      console.log("ZOHO_ORGANIZATION_ID saved.");
    } else {
      console.log("Several organisations found: set ZOHO_ORGANIZATION_ID to the right one.");
    }
  }
})().catch((err) => {
  console.error("Token exchange failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
