"use server";

import { refresh } from "next/cache";
import { getDb, DatabaseNotConfiguredError } from "@/lib/db/client";
import { DATASETS, type Dataset, type RowIssue } from "@/lib/imports/validate";
import { importDataset, importSeedFiles, MAX_IMPORT_BYTES } from "@/lib/server/imports";
import { createRun, NoInventorySnapshotError, saveRuleConfig } from "@/lib/server/runs";
import { ReviewError, submitReview } from "@/lib/server/reviews";
import { actorLabel } from "@/lib/server/audit";
import { DEFAULT_RULE_CONFIG, RuleConfigSchema } from "@/lib/rules/config";

export type ActionState = {
  ok: boolean;
  message: string;
  at: number;
  runId?: number;
  imports?: { dataset: Dataset; fileName: string; status: string; rowsTotal: number; inserted: number; updated: number; unchanged: number; errors: RowIssue[]; warnings: RowIssue[] }[];
} | null;

function fail(err: unknown, fallback: string): ActionState {
  if (err instanceof DatabaseNotConfiguredError) return { ok: false, message: "The database is not configured (DATABASE_URL).", at: Date.now() };
  if (err instanceof ReviewError || err instanceof NoInventorySnapshotError) return { ok: false, message: err.message, at: Date.now() };
  if (err instanceof Error && err.message.startsWith("Invalid rule configuration")) return { ok: false, message: err.message, at: Date.now() };
  console.error(fallback, err instanceof Error ? err.message : "unknown error");
  return { ok: false, message: fallback, at: Date.now() };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function runPlanningAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const asOfDate = str(formData, "asOfDate") || undefined;
    const location = str(formData, "location") || undefined;
    if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return { ok: false, message: "Invalid snapshot date.", at: Date.now() };
    const { runId, result } = await createRun(getDb(), { actor: actorLabel(str(formData, "reviewerName")), asOfDate, location });
    refresh();
    return { ok: true, message: `Run #${runId} calculated for ${result.recommendations.length} SKUs (inventory as of ${result.asOfDate}).`, runId, at: Date.now() };
  } catch (err) {
    return fail(err, "The demand planning run could not be completed. No partial results were saved.");
  }
}

export async function reviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const res = await submitReview(getDb(), {
      recommendationId: str(formData, "recommendationId"),
      decision: str(formData, "decision") as "approve" | "edit" | "reject" | "note",
      finalQty: str(formData, "finalQty"),
      reason: str(formData, "reason"),
      note: str(formData, "note"),
      reviewerName: str(formData, "reviewerName"),
    } as never);
    refresh();
    const msg = {
      approved: `Approved for procurement consideration (${res.finalQty} units). No purchase order was created.`,
      edited: `Quantity edited to ${res.finalQty} units and recorded. No purchase order was created.`,
      rejected: "Recommendation rejected and the reason recorded.",
      pending: "Note added.",
      not_required: "Note added.",
    }[res.reviewStatus];
    return { ok: true, message: str(formData, "decision") === "note" ? "Note added." : msg, at: Date.now() };
  } catch (err) {
    return fail(err, "The review could not be saved.");
  }
}

export async function importUploadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const dataset = str(formData, "dataset") as Dataset;
    if (!DATASETS.includes(dataset)) return { ok: false, message: "Choose which dataset this file contains.", at: Date.now() };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file to upload.", at: Date.now() };
    if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: "The file is larger than 2 MB.", at: Date.now() };
    if (!/\.csv$/i.test(file.name)) return { ok: false, message: "Only .csv files are accepted.", at: Date.now() };
    const text = await file.text();
    const fileName = file.name.replace(/[^\w .()-]/g, "_").slice(0, 120);
    const out = await importDataset(getDb(), { dataset, text, fileName, source: "upload", actor: actorLabel(str(formData, "reviewerName")) });
    refresh();
    return {
      ok: out.status === "committed",
      message:
        out.status === "committed"
          ? `Imported ${out.rowsTotal} rows: ${out.inserted} new, ${out.updated} updated, ${out.unchanged} unchanged. Run demand planning again to use the new data.`
          : `Import rejected: ${out.errors.length} problem(s) found. Nothing was changed.`,
      imports: [{ dataset, fileName, status: out.status, rowsTotal: out.rowsTotal, inserted: out.inserted, updated: out.updated, unchanged: out.unchanged, errors: out.errors.slice(0, 200), warnings: out.warnings.slice(0, 50) }],
      at: Date.now(),
    };
  } catch (err) {
    return fail(err, "The file could not be imported.");
  }
}

export async function reimportSeedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const results = await importSeedFiles(getDb(), actorLabel(str(formData, "reviewerName")));
    refresh();
    const rejected = results.filter((r) => r.status === "rejected");
    return {
      ok: rejected.length === 0,
      message: rejected.length ? `${rejected.length} seed file(s) were rejected. See errors below.` : "All five seed files re-imported. Unchanged rows were left as they were.",
      imports: results.map((r) => ({ dataset: r.dataset, fileName: r.fileName, status: r.status, rowsTotal: r.rowsTotal, inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors.slice(0, 100), warnings: r.warnings.slice(0, 20) })),
      at: Date.now(),
    };
  } catch (err) {
    return fail(err, "The seed files could not be imported.");
  }
}

export async function saveConfigAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const num = (k: string) => {
      const v = str(formData, k).trim();
      if (v === "") throw new Error(`Invalid rule configuration: ${k} is required.`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid rule configuration: ${k} must be a number.`);
      return n;
    };
    const unusual = str(formData, "unusualWeekDeviationPct").trim();
    const candidate = {
      highDemandThresholdPct: num("highDemandThresholdPct"),
      highDemandReorderMultiplier: num("highDemandReorderMultiplier"),
      recentWindowWeeks: num("recentWindowWeeks"),
      baselineWindowWeeks: num("baselineWindowWeeks"),
      stockoutMinWeeks: num("stockoutMinWeeks"),
      overstockMaxWeeks: num("overstockMaxWeeks"),
      perishableMinWeeks: num("perishableMinWeeks"),
      perishableMaxWeeks: num("perishableMaxWeeks"),
      perishableValues: str(formData, "perishableValues").split(",").map((s) => s.trim()).filter(Boolean),
      festivalUpliftPct: num("festivalUpliftPct"),
      festivalUpliftMode: str(formData, "festivalUpliftMode") || DEFAULT_RULE_CONFIG.festivalUpliftMode,
      coverageDemandBasis: str(formData, "coverageDemandBasis") || DEFAULT_RULE_CONFIG.coverageDemandBasis,
      roundingMode: str(formData, "roundingMode") || DEFAULT_RULE_CONFIG.roundingMode,
      unusualWeekDeviationPct: unusual === "" ? null : Number(unusual),
    };
    const parsed = RuleConfigSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, message: `Invalid rule configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, at: Date.now() };
    const note = str(formData, "note").trim().slice(0, 500);
    if (note.length < 5) return { ok: false, message: "Describe why the rules are changing (who approved it).", at: Date.now() };
    const id = await saveRuleConfig(getDb(), parsed.data, note, actorLabel(str(formData, "reviewerName")));
    refresh();
    return { ok: true, message: `Configuration v${id} saved. It applies to the next run; existing runs keep the configuration they used.`, at: Date.now() };
  } catch (err) {
    return fail(err, "The configuration could not be saved.");
  }
}

export async function resetConfigAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const id = await saveRuleConfig(getDb(), DEFAULT_RULE_CONFIG, "Reset to the case's documented defaults.", actorLabel(str(formData, "reviewerName")));
    refresh();
    return { ok: true, message: `Defaults restored as configuration v${id}. Applies to the next run.`, at: Date.now() };
  } catch (err) {
    return fail(err, "The configuration could not be reset.");
  }
}
