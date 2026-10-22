"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageSquarePlus, PencilLine, ShieldAlert, XCircle } from "lucide-react";
import { reviewAction, type ActionState } from "@/app/actions";
import type { DecisionRow } from "@/lib/server/queries";
import { pushToast } from "./global-toast";
import { ReviewPill, REVIEW_LABEL } from "./pills";
import { cn } from "./ui";

type Decision = "approve" | "edit" | "reject" | "note";

const NAME_KEY = "freshroots.reviewerName";

export function useReviewerName() {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAME_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from browser storage
      if (saved) setName(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const update = (v: string) => {
    setName(v);
    try {
      window.localStorage.setItem(NAME_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [name, update] as const;
}

export function ReviewerNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">Your name (optional, self-declared)</span>
      <input name="reviewerName" className="rn-input" maxLength={80} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Raghav Kulkarni" autoComplete="name" />
      <span className="mt-1 flex items-center gap-1 text-[0.6875rem] text-ink-3">
        <ShieldAlert className="size-3" aria-hidden /> No sign-in is configured, so names are recorded as unverified.
      </span>
    </label>
  );
}

export function ReviewPanel({
  recommendationId,
  calculatedQty,
  calculatedQtyRaw,
  standardReorderQty,
  unit,
  status,
  finalQty,
  decisions,
  readOnly,
}: {
  recommendationId: number;
  calculatedQty: number | null;
  calculatedQtyRaw: number | null;
  standardReorderQty: number;
  unit: string;
  status: keyof typeof REVIEW_LABEL;
  finalQty: number | null;
  decisions: DecisionRow[];
  readOnly?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await reviewAction(prev, fd);
    if (res?.ok) pushToast(res);
    return res;
  }, null);
  const [decision, setDecision] = useState<Decision>(calculatedQty === null ? "edit" : "approve");
  const [name, setName] = useReviewerName();

  const options: { value: Decision; label: string; icon: typeof CheckCircle2; disabled?: boolean; hint?: string }[] = [
    { value: "approve", label: "Approve", icon: CheckCircle2, disabled: calculatedQty === null, hint: calculatedQty === null ? "No calculated quantity" : undefined },
    { value: "edit", label: calculatedQty === null ? "Set quantity" : "Edit quantity", icon: PencilLine },
    { value: "reject", label: "Reject", icon: XCircle },
    { value: "note", label: "Add note", icon: MessageSquarePlus },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-white/[0.02] p-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-ink-3">Calculated quantity</p>
          <p className="tabular text-lg font-bold text-ink-1">{calculatedQty === null ? "Not set by rules" : `${calculatedQty.toLocaleString("en-IN")} ${unit}`}</p>
          {calculatedQtyRaw !== null && calculatedQtyRaw !== calculatedQty ? <p className="text-[0.6875rem] text-ink-3">raw {calculatedQtyRaw}, rounded up</p> : null}
        </div>
        <div>
          <p className="text-xs text-ink-3">Final quantity</p>
          <p className="tabular text-lg font-bold text-ink-1">{finalQty === null ? "—" : `${finalQty.toLocaleString("en-IN")} ${unit}`}</p>
          {finalQty !== null && calculatedQty !== null && finalQty !== calculatedQty ? (
            <p className="text-[0.6875rem] text-ink-3">
              {finalQty > calculatedQty ? "+" : ""}
              {(finalQty - calculatedQty).toLocaleString("en-IN")} vs calculated
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-ink-3">Standard reorder qty</p>
          <p className="tabular text-lg font-bold text-ink-1">{standardReorderQty.toLocaleString("en-IN")}</p>
        </div>
        <div>
          <p className="mb-1 text-xs text-ink-3">Status</p>
          <ReviewPill value={status} />
        </div>
      </div>

      {readOnly ? (
        <p className="rounded-lg border border-line bg-white/[0.02] p-3 text-sm text-ink-2">{readOnly}</p>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="recommendationId" value={recommendationId} />
          <input type="hidden" name="decision" value={decision} />
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-2">Decision</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={decision === o.value}
                  disabled={o.disabled}
                  title={o.hint}
                  onClick={() => setDecision(o.value)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    decision === o.value ? "border-accent/70 bg-accent/[0.12] text-ink-1" : "border-line-strong text-ink-2 hover:bg-white/[0.04]",
                  )}
                >
                  <o.icon className="size-4" aria-hidden /> {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          {decision === "edit" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">Quantity ({unit}) — required</span>
              <input name="finalQty" type="number" inputMode="numeric" min={0} step={1} required className="rn-input tabular" defaultValue={calculatedQty ?? ""} />
            </label>
          ) : null}
          {decision === "reject" || decision === "edit" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">Reason {decision === "reject" ? "— required" : "(reason or note required)"}</span>
              <textarea name="reason" rows={2} maxLength={1000} required={decision === "reject"} className="rn-input" placeholder={decision === "reject" ? "Why is this recommendation not right?" : "Why does the quantity differ?"} />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">Note {decision === "note" ? "— required" : "(optional)"}</span>
            <textarea name="note" rows={2} maxLength={2000} required={decision === "note"} className="rn-input" placeholder="Context for procurement or future runs" />
          </label>
          <ReviewerNameField value={name} onChange={setName} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[0.6875rem] leading-snug text-ink-3">Approval means reviewed for procurement consideration. It does not create or send a purchase order.</p>
            <button type="submit" className="rn-btn rn-btn-primary shrink-0" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? "Saving…" : { approve: "Approve", edit: "Save quantity", reject: "Reject", note: "Add note" }[decision]}
            </button>
          </div>
          {state && !state.ok ? (
            <p className="rounded-lg border border-critical/40 bg-critical/[0.07] p-2.5 text-sm text-[#ffc2c9]" role="alert">
              {state.message}
            </p>
          ) : null}
        </form>
      )}

      <DecisionLog decisions={decisions} unit={unit} />
    </div>
  );
}

export function DecisionLog({ decisions, unit }: { decisions: DecisionRow[]; unit: string }) {
  if (!decisions.length) return <p className="text-xs text-ink-3">No review decisions recorded yet.</p>;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Decision history</h3>
      <ol className="space-y-2">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-lg border border-line bg-white/[0.02] p-2.5 text-[0.8125rem]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold capitalize text-ink-1">{d.decision}</span>
              <span className="text-[0.6875rem] text-ink-3">{new Date(d.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>
            </div>
            {d.decision !== "note" ? (
              <p className="tabular text-ink-2">
                Calculated {d.calculatedQty === null ? "—" : d.calculatedQty.toLocaleString("en-IN")} → final {d.finalQty === null ? "—" : `${d.finalQty.toLocaleString("en-IN")} ${unit}`}
              </p>
            ) : null}
            {d.reason ? <p className="text-ink-2">Reason: {d.reason}</p> : null}
            {d.note ? <p className="text-ink-2">Note: {d.note}</p> : null}
            <p className="text-[0.6875rem] text-ink-3">By {d.reviewerName ? `${d.reviewerName} (self-declared, unverified)` : "unnamed prototype reviewer"}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
