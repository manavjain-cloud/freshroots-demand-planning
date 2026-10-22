"use client";

import { useActionState } from "react";
import { FileUp, Loader2, RotateCcw } from "lucide-react";
import { importUploadAction, reimportSeedAction, type ActionState } from "@/app/actions";
import { DATASET_INFO, DATASETS } from "@/lib/imports/validate";
import { ActionToast } from "./toast";
import { useHydrated } from "./use-hydrated";
import { ReviewerNameField, useReviewerName } from "./review-panel";
import { cn } from "./ui";

function Result({ state }: { state: ActionState }) {
  if (!state?.imports?.length) return state && !state.ok ? <p className="rounded-lg border border-critical/40 bg-critical/[0.07] p-2.5 text-sm text-[#ffc2c9]" role="alert">{state.message}</p> : null;
  return (
    <div className="space-y-3" aria-live="polite">
      <p className={cn("rounded-lg border p-2.5 text-sm", state.ok ? "border-good/40 bg-good/[0.07] text-[#b7f5cb]" : "border-critical/40 bg-critical/[0.07] text-[#ffc2c9]")}>{state.message}</p>
      {state.imports.map((i) => (
        <div key={i.dataset + i.fileName} className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium text-ink-1">
            {DATASET_INFO[i.dataset].label} · {i.fileName} · <span className={i.status === "committed" ? "text-good" : "text-critical"}>{i.status}</span>
          </p>
          <p className="tabular text-xs text-ink-3">
            {i.rowsTotal} rows · {i.inserted} new · {i.updated} updated · {i.unchanged} unchanged
          </p>
          {i.errors.length ? (
            <div className="mt-2 max-h-60 overflow-auto rounded border border-line" tabIndex={0} role="region" aria-label="Import errors, scrollable">
              <table className="rn-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Column</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {i.errors.map((e, k) => (
                    <tr key={k}>
                      <td className="tabular">{e.rowNumber ?? "file"}</td>
                      <td className="text-xs">{e.column ?? "—"}</td>
                      <td className="text-xs">
                        <span className="font-mono text-[0.6875rem] text-ink-3">{e.code}</span> {e.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {i.warnings.length ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-warning">
              {i.warnings.map((w, k) => (
                <li key={k}>
                  {w.rowNumber ? `Line ${w.rowNumber}: ` : ""}
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ImportPanel() {
  const [upState, upload, uploading] = useActionState<ActionState, FormData>(importUploadAction, null);
  const [seedState, reseed, seeding] = useActionState<ActionState, FormData>(reimportSeedAction, null);
  const [name, setName] = useReviewerName();
  const hydrated = useHydrated();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form action={upload} className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-1">Upload a refreshed CSV</h3>
        <p className="text-xs leading-relaxed text-ink-3">
          The file is validated first. If any row fails, nothing is written and the row-level errors are listed. Valid files are upserted on their natural key; no rows are deleted.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Dataset</span>
          <select name="dataset" className="rn-input" required defaultValue="">
            <option value="" disabled>
              Choose dataset…
            </option>
            {DATASETS.map((d) => (
              <option key={d} value={d}>
                {DATASET_INFO[d].label} — columns: {DATASET_INFO[d].columns.join(", ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">CSV file (max 2 MB)</span>
          <input name="file" type="file" accept=".csv,text/csv" required className="rn-input file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-sm file:text-ink-1" />
        </label>
        <ReviewerNameField value={name} onChange={setName} />
        <button type="submit" className="rn-btn rn-btn-primary" disabled={!hydrated || uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
          {uploading ? "Validating…" : "Validate and import"}
        </button>
        <Result state={upState} />
        <ActionToast state={upState} />
      </form>

      <form action={reseed} className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-1">Re-import the supplied seed files</h3>
        <p className="text-xs leading-relaxed text-ink-3">
          Re-reads the five original files ({DATASETS.map((d) => DATASET_INFO[d].seedFile).join(", ")}) in dependency order. Safe to repeat: unchanged rows are left as they are.
        </p>
        <input type="hidden" name="reviewerName" value={name} />
        <button type="submit" className="rn-btn rn-btn-ghost" disabled={!hydrated || seeding}>
          {seeding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
          {seeding ? "Importing…" : "Re-import seed files"}
        </button>
        <Result state={seedState} />
        <ActionToast state={seedState} />
      </form>
    </div>
  );
}
