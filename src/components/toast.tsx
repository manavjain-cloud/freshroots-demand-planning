"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import type { ActionState } from "@/app/actions";
import { cn } from "./ui";

/** Shows the latest server-action result for a few seconds (announced to screen readers). */
export function ActionToast({ state }: { state: ActionState }) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (!state) return;
    const at = state.at;
    const t = setTimeout(() => setExpiredAt(at), state.ok ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [state]);
  const visible = !!state && dismissedAt !== state.at && expiredAt !== state.at;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] justify-end">
      {visible && state ? (
        <div className={cn("rn-rise pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-2xl backdrop-blur", state.ok ? "border-good/40 bg-[#0b1a10]/95" : "border-critical/45 bg-[#1f0a0e]/95")}>
          {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />}
          <p className="text-ink-1">{state.message}</p>
          <button type="button" className="ml-1 rounded p-0.5 text-ink-3 hover:text-ink-1" aria-label="Dismiss" onClick={() => setDismissedAt(state.at)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
