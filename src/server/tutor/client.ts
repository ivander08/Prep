/**
 * kenari.id client — model routing, fallback, and the mandatory validate/repair loop.
 *
 * THREE RULES, all discovered by measurement rather than from docs (dossier §6.2):
 *
 *   1. `response_format: json_schema` IS NOT ENFORCED. Across 8 models it returned valid
 *      JSON with the wrong keys, every time. Never build structured output on it.
 *   2. A FORCED TOOL CALL IS STILL NOT A GUARANTEE. In 1 of 4 measured runs the model
 *      omitted a field declared in `required`. Validate and repair, always.
 *   3. SET `max_tokens >= 2000`. Reasoning models return `content: null` with
 *      `finish_reason: "length"` when the budget is exhausted by reasoning alone.
 *
 * Also: 3 of 8 `:free` models listed in `GET /v1/models` returned `model_not_found` when
 * called, so model ids are never hardcoded — the chain is probed at call time.
 */

import { getRoleModel, type Role } from "../models.ts";
import { db, getMeta } from "../db.ts";

const BASE = process.env.KENARI_BASE_URL ?? "https://kenari.id/v1";

/**
 * The API key, from the environment if set, otherwise from the local database.
 *
 * The env var wins so a shell-provided key is never silently overridden by a stale value
 * saved in the UI. The stored key is plaintext in `prep.db` — the same file that already
 * holds all progress, on a single-user machine. The UI shows it masked and offers Clear.
 *
 * Read per call rather than cached at module load: the whole point of the settings screen
 * is that saving a key takes effect without restarting the server.
 */
export function apiKey(): string | null {
  return process.env.KENARI_API_KEY ?? getMeta("kenari_api_key") ?? null;
}

/**
 * Fallback chain, cheapest useful model first. `deepseek-v4-1-flash` is Rp 150/M in,
 * Rp 300/M out with a 25x cached-input discount — priced in micro-IDR (Rp x 1e6) per 1M
 * tokens.
 *
 * The chain is walked whenever the preferred model fails, which happens more than you
 * would expect: the catalog advertises models the router cannot serve.
 */
export const MODEL_CHAIN: string[] = [
  "deepseek-v4-1-flash",
  "nemotron-3-ultra-550b-a55b:free",
  "nemotron-3-super-120b-a12b:free",
  "agnes-3-0-flash:free",
  "step-3-7-flash:free",
];

/**
 * Price lookup, read from the cached `GET /v1/models` catalog rather than hardcoded.
 *
 * Prices change — `deepseek-v4-1-flash` was listed at 150,000,000 micro-IDR in one reading
 * and 20,000,000 in another on the same day, which is a 7.5x difference. A hardcoded table
 * is therefore a bug waiting to happen.
 *
 * The unit is `micro_idr_per_1m_tokens`: micro-Rupiah is Rp x 1e6, so
 * IDR per 1M tokens = catalog_value / 1e6. Measured against the live gateway: a call with
 * 38 input and 29,000 output tokens moved the quota by exactly Rp 1, and the Rp 20/M +
 * Rp 50/M reading predicts Rp 1.45 (rounds to 1) while an Rp 150/M + Rp 300/M reading
 * predicts Rp 8.71 (would round to 9). So /1e6 is correct.
 *
 * Falls back to a conservative default when the model is not in the catalog.
 */
type Rates = { input: number; output: number; cacheRead: number };

const FALLBACK_RATES: Rates = { input: 20_000_000, output: 50_000_000, cacheRead: 500_000 };

function ratesFor(model: string): Rates {
  try {
    const row = db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'model_catalog'")
      .get();
    if (!row) return FALLBACK_RATES;

    const catalog = JSON.parse(row.value) as Array<{
      id: string;
      inputPerM: number | null;
      outputPerM: number | null;
      cacheReadPerM: number | null;
    }>;
    const entry = catalog.find((m) => m.id === model);
    if (!entry) return FALLBACK_RATES;

    // The catalog stores IDR per 1M tokens; convert back to micro-IDR so the arithmetic
    // below stays in one unit.
    return {
      input: (entry.inputPerM ?? 20) * 1e6,
      output: (entry.outputPerM ?? 50) * 1e6,
      cacheRead: (entry.cacheReadPerM ?? 0.5) * 1e6,
    };
  } catch {
    return FALLBACK_RATES;
  }
}

export type Usage = { tokensIn: number; tokensOut: number; cachedTokens: number };
export type CostEstimate = { idr: number; tokensIn: number; tokensOut: number; cached: number };

/**
 * Estimate the Rupiah cost of one call.
 *
 * Labelled an estimate in the UI because kenari exposes no per-request cost endpoint, and
 * `/v1/account/quota` reports whole Rupiah — a sub-Rupiah call rounds to zero and cannot be
 * verified.
 */
export function estimateCost(model: string, usage: Usage): CostEstimate {
  const p = ratesFor(model);
  const fresh = Math.max(0, usage.tokensIn - usage.cachedTokens);
  const microIdr =
    fresh * p.input + usage.cachedTokens * p.cacheRead + usage.tokensOut * p.output;

  return {
    // micro-IDR -> IDR: micro = Rp x 1e6, and the rate is per 1M tokens.
    idr: microIdr / 1e6 / 1e6,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    cached: usage.cachedTokens,
  };
}

export class KenariError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "KenariError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type ChatResult = {
  model: string;
  content: string | null;
  toolArgs: unknown | null;
  finishReason: string;
  usage: Usage;
};

async function callOnce(
  model: string,
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; forceTool?: string; maxTokens?: number; temperature?: number },
): Promise<ChatResult> {
  const key = apiKey();
  if (!key) {
    throw new KenariError(
      "no API key: set KENARI_API_KEY in the environment, or save one under Settings in the app",
      0,
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    // Rule 3: reasoning models return null content below this budget.
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.tools) {
    body.tools = opts.tools;
    if (opts.forceTool) body.tool_choice = { type: "function", function: { name: opts.forceTool } };
  }

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
    } catch {
      // non-JSON error body; status is enough
    }
    throw new KenariError(`${model}: HTTP ${res.status} ${code ?? ""}`.trim(), res.status, code);
  }

  const json = JSON.parse(text) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { arguments?: string } }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const choice = json.choices?.[0];
  const rawArgs = choice?.message?.tool_calls?.[0]?.function?.arguments;

  let toolArgs: unknown | null = null;
  if (rawArgs) {
    try {
      toolArgs = JSON.parse(rawArgs);
    } catch {
      toolArgs = null; // malformed JSON from the model is treated as "no tool call"
    }
  }

  return {
    model: json.model ?? model,
    content: choice?.message?.content ?? null,
    toolArgs,
    finishReason: choice?.finish_reason ?? "unknown",
    usage: {
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

export type CallMeta = { model: string; usage: Usage; cost: CostEstimate; repaired: boolean; fellBackFrom: string | null };

/**
 * The chain to try: the user's chosen model first (if any), then the defaults, deduped.
 *
 * A user selection is a preference, not a guarantee — if the chosen model is unavailable
 * the request still succeeds on the fallback rather than failing, and `fellBackFrom` tells
 * the caller it happened so the UI can say so.
 */
function chainFor(role: Role | undefined): string[] {
  const preferred = role ? getRoleModel(role) : null;
  if (!preferred) return MODEL_CHAIN;
  return [preferred, ...MODEL_CHAIN.filter((m) => m !== preferred)];
}

/** Walk the chain until a model answers. Returns the first success. */
export async function chat(
  messages: ChatMessage[],
  opts: {
    tools?: ToolDef[];
    forceTool?: string;
    maxTokens?: number;
    temperature?: number;
    role?: Role;
  } = {},
): Promise<{ result: ChatResult; meta: CallMeta }> {
  const failures: string[] = [];
  const chain = chainFor(opts.role);
  const preferred = opts.role ? getRoleModel(opts.role) : null;

  for (const model of chain) {
    try {
      const result = await callOnce(model, messages, opts);
      const cost = estimateCost(result.model, result.usage);
      return {
        result,
        meta: {
          model: result.model,
          usage: result.usage,
          cost,
          repaired: false,
          fellBackFrom: preferred && result.model !== preferred ? preferred : null,
        },
      };
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      // 402 = no balance for a paid model; move on to the free tier rather than giving up.
    }
  }

  throw new KenariError(`every model in the chain failed:\n  ${failures.join("\n  ")}`, 502);
}

// ---------------------------------------------------------------------------
// Validate + repair
// ---------------------------------------------------------------------------

export type Validator<T> = (value: unknown) => { ok: true; value: T } | { ok: false; missing: string[] };

/**
 * Force a tool call, validate the result, and repair once.
 *
 * The repair step is not defensive padding — it was measured. With a forced tool call and
 * `required` fields declared, one run in four still omitted `next_question`. Echoing the
 * missing field names back produced a valid payload on the first retry.
 *
 * If the second attempt is also invalid, the caller gets a structured failure rather than
 * a half-formed object; the tutor surfaces that as "couldn't produce a hint" instead of
 * silently showing something wrong.
 */
export async function structured<T>(
  messages: ChatMessage[],
  tool: ToolDef,
  validate: Validator<T>,
  opts: { maxTokens?: number; role?: Role } = {},
): Promise<{ value: T; meta: CallMeta }> {
  const first = await chat(messages, { tools: [tool], forceTool: tool.function.name, ...opts });

  if (first.result.toolArgs !== null) {
    const check = validate(first.result.toolArgs);
    if (check.ok) return { value: check.value, meta: first.meta };
  }

  const firstValue = first.result.toolArgs ?? {};
  const check = validate(firstValue);
  const missing = check.ok ? [] : check.missing;

  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: JSON.stringify(firstValue).slice(0, 1500) },
    {
      role: "user",
      content:
        `Your previous tool call was REJECTED. ` +
        (missing.length > 0
          ? `Missing or invalid required fields: ${JSON.stringify(missing)}. `
          : `The payload did not match the required schema. `) +
        `Re-emit the complete object with EVERY required field populated. Do not explain — call the tool.`,
    },
  ];

  const second = await chat(repairMessages, { tools: [tool], forceTool: tool.function.name, ...opts });

  if (second.result.toolArgs !== null) {
    const recheck = validate(second.result.toolArgs);
    if (recheck.ok) {
      return { value: recheck.value, meta: { ...second.meta, repaired: true } };
    }
  }

  throw new KenariError(
    `structured output failed validation twice; missing: ${JSON.stringify(missing)}`,
    502,
  );
}
