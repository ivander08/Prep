/**
 * Model catalog and role assignment.
 *
 * kenari exposes `GET /v1/models` publicly, so the picker reads live prices rather than a
 * hardcoded table. Two things about that response that are easy to get wrong:
 *
 *   1. Prices are in MICRO-IDR per 1M tokens — Rupiah x 1e6. The docs are explicit:
 *      "balances and prices are stored in micro-Rupiah, which means Rupiah multiplied by
 *      1.000.000". Reading `150000000` as Rp 150/M understates by 1000x; reading it as
 *      Rp 150 billion/M overstates by 1000x. Correct: Rp 150 per 1M tokens.
 *   2. The bare `GET /v1/models` lists CHAT models only. Embedding, rerank, and moderation
 *      models need `?modality=...`.
 *   3. The catalog advertises models the router cannot always serve — 3 of 8 free models
 *      returned `model_not_found` when called. So the picker is a preference, and the
 *      client still walks a fallback chain.
 */

import { db } from "./db.ts";

export type CatalogModel = {
  id: string;
  contextLength: number | null;
  free: boolean;
  /** IDR per 1M tokens, converted from the catalog's micro-IDR. */
  inputPerM: number | null;
  outputPerM: number | null;
  cacheReadPerM: number | null;
  toolCall: boolean;
  inputModalities: string[];
  reasoning: boolean;
};

type RawModel = {
  id: string;
  context_length?: number | null;
  pricing?: {
    free?: boolean;
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
  };
  tool_call?: boolean | null;
  modalities?: { input?: string[] };
  reasoning_toggle?: boolean | null;
};

/** micro-IDR per 1M tokens -> IDR per 1M tokens. */
function toIdrPerMillion(micro: number | null | undefined): number | null {
  if (micro === null || micro === undefined) return null;
  return micro / 1e6;
}

export async function fetchCatalog(force = false): Promise<CatalogModel[]> {
  const cached = db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'model_catalog'")
    .get();
  const fetchedAt = db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'model_catalog_at'")
    .get();

  const fresh =
    cached && fetchedAt && Date.now() - new Date(fetchedAt.value).getTime() < 6 * 60 * 60 * 1000;

  if (fresh && !force) {
    return JSON.parse(cached.value) as CatalogModel[];
  }

  const res = await fetch("https://kenari.id/v1/models", { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    if (cached) return JSON.parse(cached.value) as CatalogModel[];
    throw new Error(`kenari /v1/models returned HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: RawModel[] };
  const models: CatalogModel[] = (body.data ?? [])
    .filter((m) => typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      contextLength: m.context_length ?? null,
      free: Boolean(m.pricing?.free),
      inputPerM: toIdrPerMillion(m.pricing?.input),
      outputPerM: toIdrPerMillion(m.pricing?.output),
      cacheReadPerM: toIdrPerMillion(m.pricing?.cache_read),
      toolCall: Boolean(m.tool_call),
      inputModalities: m.modalities?.input ?? ["text"],
      reasoning: Boolean(m.reasoning_toggle),
    }));

  db.run(
    "INSERT INTO meta (key, value) VALUES ('model_catalog', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(models)],
  );
  db.run(
    "INSERT INTO meta (key, value) VALUES ('model_catalog_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [new Date().toISOString()],
  );

  return models;
}

export type Role = "tutor" | "review";

export const ROLE_LABEL: Record<Role, string> = {
  tutor: "Tutor (hint ladder)",
  review: "Code review (complexity + style)",
};

export const ROLES: Role[] = ["tutor", "review"];

/** The user's chosen model for a role, or null to use the built-in fallback chain. */
export function getRoleModel(role: Role): string | null {
  const row = db
    .query<{ model: string }, [string]>("SELECT model FROM model_roles WHERE role = ?")
    .get(role);
  return row?.model ?? null;
}

export function setRoleModel(role: Role, model: string | null): void {
  if (model === null) {
    db.run("DELETE FROM model_roles WHERE role = ?", [role]);
    return;
  }
  db.run(
    `INSERT INTO model_roles (role, model, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(role) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at`,
    [role, model, new Date().toISOString()],
  );
}

export function allRoleModels(): Record<string, string | null> {
  return { tutor: getRoleModel("tutor"), review: getRoleModel("review") };
}
