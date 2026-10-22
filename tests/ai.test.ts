import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findUngroundedNumbers, generateExplanation } from "../src/lib/ai/explain";
import { AiUnavailableError, getAiConfig, type AiConfig } from "../src/lib/ai/provider";
import { createTestDb } from "./helpers/db";
import { importSeedFiles } from "../src/lib/server/imports";
import { createRun } from "../src/lib/server/runs";
import { consumeRateLimit, explainRecommendation, summariseRunWithAi } from "../src/lib/server/ai";
import { getRunRecommendations } from "../src/lib/server/queries";

const OR_CONFIG: AiConfig = { provider: "openrouter", apiKey: "test-key", models: ["google/gemini-a", "google/gemini-b"], timeoutMs: 200 };

const GOOD = { headline: "Stock covers 3.4 weeks", explanation: "Recent avg 261 vs 214.9.", key_drivers: ["High demand"], planner_checks: ["Confirm supplier capacity"], caveats: [] };
const FACTS = { stock: { weeks_of_stock: 3.4, units_on_hand: 900 }, sales: { recent_avg_per_week: 261, baseline_avg_per_week: 214.9 } };

function openRouterResponse(content: unknown, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });
}

describe("provider configuration", () => {
  it("detects an OpenRouter key placed in GEMINI_API_KEY", () => {
    const c = getAiConfig({ GEMINI_API_KEY: "sk-or-v1-abc" });
    expect(c.provider).toBe("openrouter");
    expect(c.models[0]).toBe("google/gemini-3.8-flash");
  });
  it("uses the Gemini API for a Google key", () => {
    expect(getAiConfig({ GEMINI_API_KEY: "AIzaTest" }).provider).toBe("gemini");
  });
  it("is unconfigured without keys", () => {
    expect(getAiConfig({}).provider).toBeNull();
  });
});

describe("14. Gemini failure handling", () => {
  it("parses and validates a well-formed response", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse(GOOD));
    const g = await generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(g.content.headline).toBe("Stock covers 3.4 weeks");
    expect(g.warnings).toEqual([]);
  });

  it("times out and reports a timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    await expect(generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // tried the fallback model
  });

  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse("{ not json"));
    await expect(generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("rejects JSON that does not match the schema", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse({ headline: 42 }));
    await expect(generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("reports upstream rate limiting", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("flags figures that are not in the calculated facts", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse({ ...GOOD, explanation: "Order 1200 units to save ₹4.5 lakh." }));
    const g = await generateExplanation(FACTS, { config: OR_CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(g.warnings[0]).toMatch(/1200/);
    expect(g.warnings[0]).toMatch(/4\.5/);
  });

  it("accepts rounded and percentage renderings of facts", () => {
    expect(findUngroundedNumbers({ t: "21.4% above, 3.35 weeks → 3.4, 900 units" }, { ratio: 1.2139, wos: 3.351, stock: 900 })).toEqual([]);
  });
});

describe("AI service with the database", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let recId: number;
  let runId: number;
  const env = { ...process.env };

  beforeAll(async () => {
    db = await createTestDb();
    await importSeedFiles(db, "test");
    const run = await createRun(db, { actor: "test" });
    runId = run.runId;
    recId = (await getRunRecommendations(db, runId)).find((r) => r.skuId === "SKU001")!.id;
  });
  afterAll(async () => {
    process.env = env;
    await db.close();
  });

  it("returns a clear unavailable status when no key is configured, without touching deterministic data", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const out = await explainRecommendation(db, recId, { ip: "1.1.1.1" });
    expect(out).toMatchObject({ status: "unavailable", reason: "not_configured" });
    const rec = (await getRunRecommendations(db, runId)).find((r) => r.id === recId)!;
    expect(rec.recommendedQty).toBe(750);
  });

  it("stores and then serves a cached explanation", async () => {
    process.env.GEMINI_API_KEY = "sk-or-v1-test";
    const fetchImpl = vi.fn(async () => openRouterResponse({ ...GOOD, headline: "SKU001 shows high demand with 3.4 weeks of cover" }));
    const first = await explainRecommendation(db, recId, { ip: "2.2.2.2", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first).toMatchObject({ status: "ok", cached: false });
    const second = await explainRecommendation(db, recId, { ip: "2.2.2.2", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(second).toMatchObject({ status: "ok", cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops summary items that reference unknown SKUs", async () => {
    process.env.GEMINI_API_KEY = "sk-or-v1-test";
    const fetchImpl = vi.fn(async () =>
      openRouterResponse({
        headline: "3 SKUs need action",
        summary: "Review stockout risks.",
        priority_items: [
          { sku_id: "SKU001", issue: "Stockout risk", suggested_check: "Confirm" },
          { sku_id: "SKU999", issue: "Made up", suggested_check: "None" },
        ],
        exceptions_note: "",
        data_caveats: [],
      }),
    );
    const out = await summariseRunWithAi(db, runId, { ip: "3.3.3.3", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.data.content.priority_items.map((p) => p.sku_id)).toEqual(["SKU001"]);
      expect(out.data.warnings.join(" ")).toMatch(/SKU999/);
    }
  });

  it("enforces the per-client rate limit", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, "test-bucket", 3, 3600);
    expect((await consumeRateLimit(db, "test-bucket", 3, 3600)).allowed).toBe(false);
  });
});
