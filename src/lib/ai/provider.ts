/**
 * Server-only AI provider adapter for Gemini.
 * - Google AI Studio key in GEMINI_API_KEY → Gemini API directly.
 * - OpenRouter key (sk-or-...) in GEMINI_API_KEY or OPENROUTER_API_KEY → Gemini models via OpenRouter.
 * The key never leaves the server.
 */

export type AiProvider = "gemini" | "openrouter";

export interface AiConfig {
  provider: AiProvider | null;
  apiKey: string | null;
  models: string[];
  timeoutMs: number;
}

export class AiUnavailableError extends Error {
  constructor(
    public kind: "not_configured" | "timeout" | "rate_limited" | "upstream" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const DEFAULT_MODELS: Record<AiProvider, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"],
  openrouter: ["google/gemini-3.8-flash", "google/gemini-3.6-flash", "google/gemini-3.5-flash"],
};

export function getAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const geminiKey = env.GEMINI_API_KEY?.trim() || null;
  const orKey = env.OPENROUTER_API_KEY?.trim() || null;
  let provider: AiProvider | null = null;
  let apiKey: string | null = null;
  if (geminiKey && !geminiKey.startsWith("sk-or-")) {
    provider = "gemini";
    apiKey = geminiKey;
  } else if (orKey || geminiKey?.startsWith("sk-or-")) {
    provider = "openrouter";
    apiKey = orKey ?? geminiKey;
  }
  const custom = env.AI_MODEL?.trim();
  const fallbacks = env.AI_MODEL_FALLBACKS?.split(",").map((s) => s.trim()).filter(Boolean);
  const models = provider ? [...(custom ? [custom] : []), ...(fallbacks ?? DEFAULT_MODELS[provider])].filter((m, i, a) => a.indexOf(m) === i) : [];
  const timeoutMs = Math.min(Math.max(Number(env.AI_TIMEOUT_MS) || 30_000, 2_000), 60_000);
  return { provider, apiKey, models, timeoutMs };
}

export interface GenerateJsonArgs {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  config?: AiConfig;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

export interface GenerateJsonResult {
  text: string;
  provider: AiProvider;
  model: string;
}

/** Call the model and return its raw JSON text. Retries the next model on retryable failures. */
export async function generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
  const cfg = args.config ?? getAiConfig();
  if (!cfg.provider || !cfg.apiKey) throw new AiUnavailableError("not_configured", "AI explanations are not configured (GEMINI_API_KEY is not set).");
  const doFetch = args.fetchImpl ?? fetch;
  const attempts = Math.min(args.maxAttempts ?? 2, cfg.models.length);
  let lastError: AiUnavailableError | null = null;

  for (let i = 0; i < attempts; i++) {
    const model = cfg.models[i];
    try {
      const text = cfg.provider === "openrouter" ? await callOpenRouter(doFetch, cfg, model, args) : await callGemini(doFetch, cfg, model, args);
      return { text, provider: cfg.provider, model };
    } catch (err) {
      lastError = err instanceof AiUnavailableError ? err : new AiUnavailableError("upstream", "AI request failed.");
      if (lastError.kind === "invalid_response" || lastError.kind === "not_configured") break;
    }
  }
  throw lastError ?? new AiUnavailableError("upstream", "AI request failed.");
}

async function timedFetch(doFetch: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new AiUnavailableError("timeout", "The AI service did not respond in time.");
    throw new AiUnavailableError("upstream", "Could not reach the AI service.");
  } finally {
    clearTimeout(timer);
  }
}

function statusError(status: number): AiUnavailableError {
  if (status === 429) return new AiUnavailableError("rate_limited", "The AI service is rate limiting requests. Try again shortly.");
  if (status === 401 || status === 403) return new AiUnavailableError("not_configured", "The AI key was rejected by the provider.");
  if (status === 402) return new AiUnavailableError("not_configured", "The AI account has insufficient credit.");
  return new AiUnavailableError("upstream", `The AI service returned an error (HTTP ${status}).`);
}

async function callOpenRouter(doFetch: typeof fetch, cfg: AiConfig, model: string, a: GenerateJsonArgs): Promise<string> {
  const res = await timedFetch(
    doFetch,
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "Freshroots Demand Planning" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1500,
        messages: [
          { role: "system", content: a.system },
          { role: "user", content: a.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: a.schemaName, strict: true, schema: a.jsonSchema } },
      }),
    },
    cfg.timeoutMs,
  );
  if (!res.ok) throw statusError(res.status);
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; error?: unknown } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiUnavailableError("upstream", "The AI service returned an empty response.");
  return content;
}

async function callGemini(doFetch: typeof fetch, cfg: AiConfig, model: string, a: GenerateJsonArgs): Promise<string> {
  const res = await timedFetch(
    doFetch,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": cfg.apiKey!, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: a.system }] },
        contents: [{ role: "user", parts: [{ text: a.user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1500, responseMimeType: "application/json", responseJsonSchema: a.jsonSchema },
      }),
    },
    cfg.timeoutMs,
  );
  if (!res.ok) throw statusError(res.status);
  const body = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null;
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  if (!text?.trim()) throw new AiUnavailableError("upstream", "The AI service returned an empty response.");
  return text;
}

/** Strip optional ```json fences and parse. Throws invalid_response on malformed JSON. */
export function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiUnavailableError("invalid_response", "The AI response was not valid JSON.");
  }
}
