import "server-only";
import { getDb, isDatabaseConfigured, type Db } from "../db/client";
import type { RecRow } from "./queries";

export function dbOrNull(): Db | null {
  return isDatabaseConfigured() ? getDb() : null;
}

const ACTION_RANK = { REORDER_IMMEDIATE: 0, REVIEW_REQUIRED: 1, PAUSE_NEXT_ORDER: 2, REORDER: 3, NO_ACTION: 4 } as const;

/** Review queue order: most urgent first, then by lowest cover. */
export function byPriority(a: RecRow, b: RecRow): number {
  const s = (r: RecRow) => (r.reviewStatus === "pending" ? 0 : 1);
  return (
    s(a) - s(b) ||
    ACTION_RANK[a.action] - ACTION_RANK[b.action] ||
    (b.exceptionCodes.length > 0 ? 1 : 0) - (a.exceptionCodes.length > 0 ? 1 : 0) ||
    (a.weeksOfStock ?? 999) - (b.weeksOfStock ?? 999) ||
    a.skuId.localeCompare(b.skuId)
  );
}
