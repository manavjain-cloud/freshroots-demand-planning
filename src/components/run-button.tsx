"use client";

import { useActionState } from "react";
import { Loader2, Play } from "lucide-react";
import { runPlanningAction, type ActionState } from "@/app/actions";
import { ActionToast } from "./toast";

export function RunPlanningButton({ snapshots }: { snapshots: { asOfDate: string; location: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(runPlanningAction, null);
  const disabled = pending || snapshots.length === 0;
  return (
    <form action={action} className="flex items-center gap-2">
      {snapshots.length > 1 ? (
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          <span className="sr-only sm:not-sr-only">Snapshot</span>
          <select name="snapshot" className="rn-input w-auto py-1.5 text-xs" defaultValue={`${snapshots[0].asOfDate}|${snapshots[0].location}`}
            onChange={(e) => {
              const [d, l] = e.currentTarget.value.split("|");
              const form = e.currentTarget.form!;
              (form.elements.namedItem("asOfDate") as HTMLInputElement).value = d;
              (form.elements.namedItem("location") as HTMLInputElement).value = l;
            }}>
            {snapshots.map((s) => (
              <option key={`${s.asOfDate}|${s.location}`} value={`${s.asOfDate}|${s.location}`}>
                {s.asOfDate} · {s.location}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <input type="hidden" name="asOfDate" defaultValue={snapshots[0]?.asOfDate ?? ""} />
      <input type="hidden" name="location" defaultValue={snapshots[0]?.location ?? ""} />
      <span className="rn-conic">
        <button type="submit" disabled={disabled} className="rn-btn rn-btn-primary relative rounded-[11px]" title={snapshots.length === 0 ? "Import an inventory snapshot first" : "Recalculate every SKU with the active rules"}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {pending ? "Running…" : "Run demand planning"}
        </button>
      </span>
      <ActionToast state={state} />
    </form>
  );
}
