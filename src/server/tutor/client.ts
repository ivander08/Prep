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

const BASE = process.env.KENARI_BASE_URL ?? "https://kenari.id/v1";

/**
 * Cheapest useful model first. `deepseek-v4-1-flash` is Rp 150/M in, Rp 300/M out with a
 * 25x cached-input discount — priced in micro-IDR (Rp x 1e6) per 1M tokens.
 */
export const MODEL_CHAIN: string[] = [
  "deepseek-v4-1-flash",
  "nemotron-3-ultra-550b-a55b:free",
  "nemotron-3-super-120b-a12b:free",
  "agnes-3-0-flash:free",
  "step-3-7-flash:free",
];

/**
 * Price table in micro-IDR per 1M tokens, read from `GET /v1/models`.
 * Cost is computed locally and labelled an estimate: kenari exposes no per-request cost
 * endpoint, and `/v1/account/quota` reports whole Rupiah, so a sub-Rupiah call rounds to
 * zero and cannot be used to verify.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "deepseek-v4-1-flash": { input: 150_000_000, output: 300_000_000, cacheRead: 4_000_000 },
};

export type Usage = { tokensIn: number; tokensOut: number; cachedTokens: number };
export type CostEstimate = { idr: number; tokensIn: number; tokensOut: number; cached: number };

/** Estimate the Rupiah cost of one call. Micro-IDR per 1M tokens => IDR = units * tokens / 1e6 / 1e6. */
export function estimateCost(model: string, usage: Usage): CostEstimate {
  const p = PRICES[model];
  if (!p) return { idr: 0, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cached: usage.cachedTokens };

  const fresh = Math.max(0, usage.tokensIn - usage.cachedTokens);
  const microIdr =
    fresh * p.input + usage.cachedTokens * p.cacheRead + usage.tokensOut * p.output;

  return {
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
  const key = process.env.KENARI_API_KEY;
  if (!key) throw new KenariError("KENARI_API_KEY is not set", 0);

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

export type CallMeta = { model: string; usage: Usage; cost: CostEstimate; repaired: boolean };

/** Walk the chain until a model answers. Returns the first success. */
export async function chat(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; forceTool?: string; maxTokens?: number; temperature?: number } = {},
): Promise<{ result: ChatResult; meta: CallMeta }> {
  const failures: string[] = [];

  for (const model of MODEL_CHAIN) {
    try {
      const result = await callOnce(model, messages, opts);
      const cost = estimateCost(result.model, result.usage);
      return { result, meta: { model: result.model, usage: result.usage, cost, repaired: false } };
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
  opts: { maxTokens?: number } = {},
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
