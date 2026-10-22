import type { Queryable } from "../db/client";

export async function writeAudit(
  q: Queryable,
  entry: { actor: string; action: string; entityType: string; entityId?: string | number | null; details?: Record<string, unknown> },
) {
  await q.query(
    `INSERT INTO audit_log (actor, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [entry.actor, entry.action, entry.entityType, entry.entityId == null ? null : String(entry.entityId), JSON.stringify(entry.details ?? {})],
  );
}

/** Label used for actions when no authentication is configured. Never a fabricated person. */
export function actorLabel(selfDeclaredName?: string | null): string {
  const n = selfDeclaredName?.trim();
  return n ? `${n} (self-declared, unverified)` : "Prototype reviewer (unauthenticated)";
}
