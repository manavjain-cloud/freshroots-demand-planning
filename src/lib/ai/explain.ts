import { z } from "zod";
import { AiUnavailableError, generateJson, parseModelJson, type AiConfig } from "./provider";

/* ------------------------------------------------------------------ */
/* Output schemas                                                      */
/* ------------------------------------------------------------------ */

export const ExplanationSchema = z.object({
  headline: z.string().min(1).max(200),
  explanation: z.string().min(1).max(1500),
  key_drivers: z.array(z.string().min(1).max(300)).max(6),
  planner_checks: z.array(z.string().min(1).max(300)).max(6),
  caveats: z.array(z.string().min(1).max(300)).max(5),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

const strArr = (max: number) => ({ type: "array", items: { type: "string" }, maxItems: max });
export const EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "explanation", "key_drivers", "planner_checks", "caveats"],
  properties: {
    headline: { type: "string", description: "One sentence, plain business language." },
    explanation: { type: "string", description: "2-4 sentences explaining why the rules produced this outcome." },
    key_drivers: strArr(6),
    planner_checks: strArr(6),
    caveats: strArr(5),
  },
};

export const SummarySchema = z.object({
  headline: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  priority_items: z
    .array(z.object({ sku_id: z.string().min(1).max(40), issue: z.string().min(1).max(300), suggested_check: z.string().min(1).max(300) }))
    .max(10),
  exceptions_note: z.string().max(800),
  data_caveats: z.array(z.string().min(1).max(300)).max(6),
});
export type PlanningSummary = z.infer<typeof SummarySchema>;

export const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "priority_items", "exceptions_note", "data_caveats"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    priority_items: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sku_id", "issue", "suggested_check"],
        properties: { sku_id: { type: "string" }, issue: { type: "string" }, suggested_check: { type: "string" } },
      },
    },
    exceptions_note: { type: "string" },
    data_caveats: strArr(6),
  },
};

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `You support a demand planner at Freshroots, a regional FMCG distributor in India.
A deterministic rule engine has already classified demand and inventory risk and calculated any reorder quantity.
Your job is only to explain those results in clear business English.
Strict rules:
- Use only the facts in the JSON you are given. Never invent sales, stock, prices, costs, lead times, savings or forecasts.
- Do not calculate new quantities, and never suggest a different reorder quantity or override a classification.
- Never say an order, purchase order or approval has been made. The planner and procurement decide.
- When you quote a number, copy it exactly as it appears in the facts.
- If facts are missing or flagged as exceptions, say so plainly and suggest what the planner should check.
- Use the human-readable labels in the facts; never print internal codes in UPPER_SNAKE_CASE.
- Keep it short and specific. Respond with JSON matching the schema only.`;

/* ------------------------------------------------------------------ */
/* Grounding check                                                     */
/* ------------------------------------------------------------------ */

function collectNumbers(value: unknown, out: number[]) {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (typeof value === "string") {
    for (const m of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n)) out.push(n);
    }
  } else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, out));
}

/** Every rendering of a fact number a model could legitimately quote. */
export function allowedNumberSet(facts: unknown): Set<string> {
  const nums: number[] = [];
  collectNumbers(facts, nums);
  const out = new Set<string>();
  const add = (n: number) => {
    for (const d of [0, 1, 2]) out.add(Number(n.toFixed(d)).toString());
    out.add(Math.trunc(n).toString());
    out.add(Math.ceil(n).toString());
  };
  for (const n of nums) {
    add(n);
    add(Math.abs(n));
    if (Math.abs(n) < 10) {
      add(n * 100); // ratios quoted as percentages
      add((n - 1) * 100); // ratios quoted as % change
    }
  }
  return out;
}

/** Numbers in the AI text that do not trace back to a supplied fact. */
export function findUngroundedNumbers(output: unknown, facts: unknown): string[] {
  const allowed = allowedNumberSet(facts);
  const found: number[] = [];
  collectNumbers(output, found);
  const bad = new Set<string>();
  for (const n of found) {
    const forms = [0, 1, 2].map((d) => Number(Math.abs(n).toFixed(d)).toString());
    if (!forms.some((f) => allowed.has(f))) bad.add(String(n));
  }
  return [...bad];
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

export interface AiGenerated<T> {
  content: T;
  provider: string;
  model: string;
  warnings: string[];
}

export async function generateExplanation(facts: Record<string, unknown>, opts: { config?: AiConfig; fetchImpl?: typeof fetch } = {}): Promise<AiGenerated<Explanation>> {
  const res = await generateJson({
    system: SYSTEM_PROMPT,
    user: `Explain this SKU's rule-engine result for the demand planner.\nFACTS:\n${JSON.stringify(facts, null, 2)}`,
    schemaName: "sku_explanation",
    jsonSchema: EXPLANATION_JSON_SCHEMA,
    ...opts,
  });
  const parsed = ExplanationSchema.safeParse(parseModelJson(res.text));
  if (!parsed.success) throw new AiUnavailableError("invalid_response", "The AI response did not match the expected format.");
  const ungrounded = findUngroundedNumbers(parsed.data, facts);
  const warnings = ungrounded.length ? [`Figures not found in the calculated facts: ${ungrounded.join(", ")}. Treat them as unverified.`] : [];
  return { content: parsed.data, provider: res.provider, model: res.model, warnings };
}

export async function generatePlanningSummary(
  facts: Record<string, unknown> & { skus: { sku_id: string }[] },
  opts: { config?: AiConfig; fetchImpl?: typeof fetch } = {},
): Promise<AiGenerated<PlanningSummary>> {
  const res = await generateJson({
    system: SYSTEM_PROMPT,
    user: `Write a concise planning summary of this rule-engine run for the demand planner. Prioritise items needing review.\nFACTS:\n${JSON.stringify(facts, null, 2)}`,
    schemaName: "planning_summary",
    jsonSchema: SUMMARY_JSON_SCHEMA,
    ...opts,
  });
  const parsed = SummarySchema.safeParse(parseModelJson(res.text));
  if (!parsed.success) throw new AiUnavailableError("invalid_response", "The AI response did not match the expected format.");
  const known = new Set(facts.skus.map((s) => s.sku_id));
  const unknownIds = parsed.data.priority_items.filter((p) => !known.has(p.sku_id)).map((p) => p.sku_id);
  const content = { ...parsed.data, priority_items: parsed.data.priority_items.filter((p) => known.has(p.sku_id)) };
  const warnings: string[] = [];
  if (unknownIds.length) warnings.push(`Removed items referring to unknown SKUs: ${unknownIds.join(", ")}.`);
  const ungrounded = findUngroundedNumbers(content, facts);
  if (ungrounded.length) warnings.push(`Figures not found in the calculated facts: ${ungrounded.join(", ")}. Treat them as unverified.`);
  return { content, provider: res.provider, model: res.model, warnings };
}
