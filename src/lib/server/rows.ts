import type { PlanRow } from "@/components/planning-table";
import type { RecRow } from "./queries";

/** Serializable table row (drops the heavy metrics/steps payload). */
export function toPlanRow(r: RecRow, onOrder: number | null = null): PlanRow {
  return {
    id: r.id,
    skuId: r.skuId,
    skuName: r.skuName,
    category: r.category,
    perishability: r.perishability,
    distributorId: r.distributorId,
    distributorName: r.distributorName,
    region: r.region,
    latestWeekUnits: r.latestWeekUnits,
    recentAvg: r.recentAvg,
    baselineAvg: r.baselineAvg,
    currentStock: r.currentStock,
    onOrder,
    weeksOfStock: r.weeksOfStock,
    minWeeks: r.metrics.minWeeks,
    maxWeeks: r.metrics.maxWeeks,
    demandClass: r.demandClass,
    inventoryRisk: r.inventoryRisk,
    action: r.action,
    recommendedQty: r.recommendedQty,
    finalQty: r.finalQty,
    reason: r.reason,
    reviewStatus: r.reviewStatus,
    exceptionCodes: r.exceptionCodes,
  };
}
