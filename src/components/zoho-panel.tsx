"use client";

import { useActionState } from "react";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { zohoSyncAction, zohoTestAction, type ActionState } from "@/app/actions";
import { ActionToast } from "./toast";
import { useHydrated } from "./use-hydrated";
import { useReviewerName } from "./review-panel";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-lg border p-2.5 text-sm ${state.ok ? "border-good/40 bg-good/[0.07] text-[#b7f5cb]" : "border-critical/40 bg-critical/[0.07] text-[#ffc2c9]"}`}>
      {state.message}
    </p>
  );
}

export function ZohoActions({ configured }: { configured: boolean }) {
  const [testState, test, testing] = useActionState<ActionState>(zohoTestAction, null);
  const [syncState, sync, syncing] = useActionState<ActionState, FormData>(zohoSyncAction, null);
  const [name] = useReviewerName();
  const hydrated = useHydrated();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={test}>
          <button type="submit" className="rn-btn rn-btn-ghost" disabled={!hydrated || !configured || testing}>
            {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}
            Test connection
          </button>
        </form>
        <form action={sync}>
          <input type="hidden" name="reviewerName" value={name} />
          <button type="submit" className="rn-btn rn-btn-primary" disabled={!hydrated || !configured || syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {syncing ? "Reading from Zoho…" : "Sync from Zoho (read-only)"}
          </button>
        </form>
      </div>
      <Result state={testState} />
      <Result state={syncState} />
      <ActionToast state={syncState} />
    </div>
  );
}
