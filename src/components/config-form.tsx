"use client";

import { useActionState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { resetConfigAction, saveConfigAction, type ActionState } from "@/app/actions";
import { CONFIG_PROVENANCE, type RuleConfig } from "@/lib/rules/config";
import { ActionToast } from "./toast";
import { ReviewerNameField, useReviewerName } from "./review-panel";
import { cn } from "./ui";

const SOURCE_STYLE = {
  case: "border-good/35 bg-good/10 text-[#b7f5cb]",
  assumption: "border-warning/40 bg-warning/10 text-[#ffe2a6]",
  proposed: "border-info/35 bg-info/10 text-[#cfe0ff]",
} as const;
const SOURCE_LABEL = { case: "From case", assumption: "Assumption", proposed: "Proposed" } as const;

type NumKey = { [K in keyof RuleConfig]: RuleConfig[K] extends number ? K : never }[keyof RuleConfig];
const NUMERIC: { key: NumKey; step: string; min: number }[] = [
  { key: "highDemandThresholdPct", step: "0.1", min: 0 },
  { key: "highDemandReorderMultiplier", step: "0.05", min: 1 },
  { key: "recentWindowWeeks", step: "1", min: 1 },
  { key: "baselineWindowWeeks", step: "1", min: 1 },
  { key: "stockoutMinWeeks", step: "0.5", min: 0 },
  { key: "overstockMaxWeeks", step: "0.5", min: 0 },
  { key: "perishableMinWeeks", step: "0.5", min: 0 },
  { key: "perishableMaxWeeks", step: "0.5", min: 0 },
  { key: "festivalUpliftPct", step: "1", min: 0 },
];

function Field({ k, children }: { k: keyof RuleConfig; children: React.ReactNode }) {
  const p = CONFIG_PROVENANCE[k];
  return (
    <div className="rounded-lg border border-line bg-white/[0.02] p-3">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <label htmlFor={`cfg-${k}`} className="text-sm font-medium text-ink-1">
          {p.label}
        </label>
        <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide", SOURCE_STYLE[p.source])}>{SOURCE_LABEL[p.source]}</span>
      </div>
      {children}
      <p className="mt-1.5 text-[0.6875rem] leading-snug text-ink-3">{p.note}</p>
    </div>
  );
}

export function ConfigForm({ config }: { config: RuleConfig }) {
  const [state, save, saving] = useActionState<ActionState, FormData>(saveConfigAction, null);
  const [resetState, reset, resetting] = useActionState<ActionState, FormData>(resetConfigAction, null);
  const [name, setName] = useReviewerName();
  return (
    <div className="space-y-4">
      <form action={save} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {NUMERIC.map(({ key, step, min }) => (
            <Field key={key} k={key}>
              <input id={`cfg-${key}`} name={key} type="number" step={step} min={min} required defaultValue={config[key]} className="rn-input tabular" />
            </Field>
          ))}
          <Field k="perishableValues">
            <input id="cfg-perishableValues" name="perishableValues" required defaultValue={config.perishableValues.join(", ")} className="rn-input" />
          </Field>
          <Field k="festivalUpliftMode">
            <select id="cfg-festivalUpliftMode" name="festivalUpliftMode" defaultValue={config.festivalUpliftMode} className="rn-input">
              <option value="forward_demand">Once, on forward demand (recommended)</option>
              <option value="recent_window_only">Also on the 4-week window for the demand test</option>
            </select>
          </Field>
          <Field k="coverageDemandBasis">
            <select id="cfg-coverageDemandBasis" name="coverageDemandBasis" defaultValue={config.coverageDemandBasis} className="rn-input">
              <option value="baseline_avg">12-week average</option>
              <option value="recent_avg">4-week average</option>
            </select>
          </Field>
          <Field k="roundingMode">
            <select id="cfg-roundingMode" name="roundingMode" defaultValue={config.roundingMode} className="rn-input">
              <option value="ceil">Round up</option>
              <option value="round">Round to nearest</option>
              <option value="floor">Round down</option>
            </select>
          </Field>
          <Field k="unusualWeekDeviationPct">
            <input id="cfg-unusualWeekDeviationPct" name="unusualWeekDeviationPct" type="number" step="1" min={1} defaultValue={config.unusualWeekDeviationPct ?? ""} placeholder="Blank = off" className="rn-input tabular" />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">Change note — required (what changed, who approved it)</span>
            <textarea name="note" required minLength={5} maxLength={500} rows={2} className="rn-input" placeholder="e.g. Coverage basis changed to 4-week avg, approved by Head of Operations on …" />
          </label>
          <ReviewerNameField value={name} onChange={setName} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rn-btn rn-btn-primary" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            Save as new version
          </button>
          <p className="text-xs text-ink-3">Applies to the next run. Previous runs keep the configuration they used.</p>
        </div>
        {state && !state.ok ? (
          <p className="rounded-lg border border-critical/40 bg-critical/[0.07] p-2.5 text-sm text-[#ffc2c9]" role="alert">
            {state.message}
          </p>
        ) : null}
        <ActionToast state={state?.ok ? state : null} />
      </form>
      <form action={reset}>
        <input type="hidden" name="reviewerName" value={name} />
        <button type="submit" className="rn-btn rn-btn-ghost" disabled={resetting}>
          <RotateCcw className="size-4" aria-hidden /> Reset to case defaults
        </button>
        <ActionToast state={resetState} />
      </form>
    </div>
  );
}
