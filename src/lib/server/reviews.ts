import { z } from "zod";
import type { Db } from "../db/client";
import { actorLabel, writeAudit } from "./audit";

export const ReviewInputSchema = z.object({
  recommendationId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "edit", "reject", "note"]),
  finalQty: z
    .union([z.literal(""), z.coerce.number().int("Quantity must be a whole number").min(0, "Quantity cannot be negative").max(10_000_000)])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  reason: z.string().trim().max(1000).optional().default(""),
  note: z.string().trim().max(2000).optional().default(""),
  reviewerName: z.string().trim().max(80).optional().default(""),
});
export type ReviewInput = z.input<typeof ReviewInputSchema>;

export class ReviewError extends Error {}

export interface ReviewResult {
  recommendationId: number;
  reviewStatus: "pending" | "approved" | "edited" | "rejected" | "not_required";
  finalQty: number | null;
  decisionId: number;
}

/**
 * Record a planner decision. Approval means "reviewed and approved for procurement
 * consideration" — it never creates or sends a purchase order.
 */
export async function submitReview(db: Db, raw: ReviewInput): Promise<ReviewResult> {
  const parsed = ReviewInputSchema.safeParse(raw);
  if (!parsed.success) throw new ReviewError(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;

  return db.transaction(async (tx) => {
    const r = await tx.query<{ id: string; run_id: string; sku_id: string; recommended_qty: number | null; review_status: string; action: string; latest_run: string }>(
      `SELECT r.id, r.run_id, r.sku_id, r.recommended_qty, r.review_status, r.action,
              (SELECT MAX(id) FROM recommendation_runs) AS latest_run
       FROM sku_recommendations r WHERE r.id = $1 FOR UPDATE`,
      [input.recommendationId],
    );
    const rec = r.rows[0];
    if (!rec) throw new ReviewError("Recommendation not found.");
    if (Number(rec.run_id) !== Number(rec.latest_run)) throw new ReviewError("This recommendation belongs to an older run and has been superseded. Review the latest run instead.");

    const calculated = rec.recommended_qty === null ? null : Number(rec.recommended_qty);
    let status: ReviewResult["reviewStatus"] = rec.review_status as ReviewResult["reviewStatus"];
    let finalQty: number | null = null;
    let decision: "approved" | "edited" | "rejected" | "note";

    switch (input.decision) {
      case "approve":
        if (calculated === null) throw new ReviewError("There is no calculated quantity to approve. Use Edit to set a quantity, or Reject.");
        decision = "approved";
        status = "approved";
        finalQty = calculated;
        break;
      case "edit":
        if (input.finalQty === undefined) throw new ReviewError("Enter the edited quantity.");
        if (calculated !== null && input.finalQty === calculated) throw new ReviewError("The quantity is unchanged. Use Approve instead.");
        decision = "edited";
        status = "edited";
        finalQty = input.finalQty;
        break;
      case "reject":
        if (input.reason.length < 3) throw new ReviewError("A rejection reason is required.");
        decision = "rejected";
        status = "rejected";
        finalQty = null;
        break;
      case "note":
        if (input.note.length < 1) throw new ReviewError("Enter a note.");
        decision = "note";
        break;
    }
    if (input.decision === "edit" && !input.reason && !input.note) {
      throw new ReviewError("Add a reason or note explaining the edited quantity.");
    }

    const d = await tx.query<{ id: string }>(
      `INSERT INTO review_decisions (recommendation_id, decision, calculated_qty, final_qty, reason, note, reviewer_name, identity_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
      [input.recommendationId, decision, calculated, decision === "note" ? null : finalQty, input.reason || null, input.note || null, input.reviewerName || null],
    );
    if (decision !== "note") {
      await tx.query(`UPDATE sku_recommendations SET review_status=$2, final_qty=$3, reviewed_at=now() WHERE id=$1`, [input.recommendationId, status, finalQty]);
    }
    await writeAudit(tx, {
      actor: actorLabel(input.reviewerName),
      action: `review.${decision}`,
      entityType: "sku_recommendation",
      entityId: input.recommendationId,
      details: { skuId: rec.sku_id, runId: Number(rec.run_id), calculatedQty: calculated, finalQty, reason: input.reason || null, note: input.note || null },
    });
    const current = decision === "note" ? await tx.query<{ final_qty: number | null }>("SELECT final_qty FROM sku_recommendations WHERE id=$1", [input.recommendationId]) : null;
    return {
      recommendationId: input.recommendationId,
      reviewStatus: status,
      finalQty: current ? (current.rows[0].final_qty === null ? null : Number(current.rows[0].final_qty)) : finalQty,
      decisionId: Number(d.rows[0].id),
    };
  });
}
