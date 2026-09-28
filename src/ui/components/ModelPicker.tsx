import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type CatalogModel = {
  id: string;
  contextLength: number | null;
  free: boolean;
  inputPerM: number | null;
  outputPerM: number | null;
  cacheReadPerM: number | null;
  toolCall: boolean;
  inputModalities: string[];
  reasoning: boolean;
};

type ModelsResponse = {
  roles: Record<string, string | null>;
  roleLabels: Record<string, string>;
  availableRoles: string[];
  models: CatalogModel[];
  error?: string;
};

function formatPerM(idr: number | null): string {
  if (idr === null) return "—";
  if (idr === 0) return "free";
  if (idr < 1000) return `Rp ${idr.toFixed(0)}`;
  return `Rp ${(idr / 1000).toFixed(1)}k`;
}

function formatContext(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Model picker.
 *
 * Prices come from the live catalog, converted from micro-IDR (Rp x 1e6) to Rp per 1M
 * tokens. A selection is a preference, not a guarantee: the catalog advertises models the
 * router cannot always serve, so the client still falls back and the UI reports when it
 * did.
 */
export function ModelPicker() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      setData(await api<ModelsResponse>(`/api/models${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = useCallback(
    async (role: string, model: string | null) => {
      setSaving(role);
      try {
        await api("/api/models/roles", { method: "POST", body: JSON.stringify({ role, model }) });
        await load();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(null);
      }
    },
    [load],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    return data.models
      .filter((m) => (freeOnly ? m.free : true))
      .filter((m) => (q ? m.id.toLowerCase().includes(q) : true))
      .slice(0, 200);
  }, [data, filter, freeOnly]);

  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return <div className="spinner">Loading model catalog…</div>;

  return (
    <>
      <h1>Models</h1>
      <p className="muted">
        Pick which model handles each job. Prices are read live from the gateway and shown in Rupiah per
        1M tokens. A selection is a preference — if the chosen model is unavailable, the request falls
        back rather than failing.
      </p>

      {data.availableRoles.map((role) => {
        const current = data.roles[role] ?? null;
        const selected = data.models.find((m) => m.id === current);
        return (
          <div key={role} className="card" style={{ marginTop: 14 }}>
            <div className="spread">
              <div>
                <strong>{data.roleLabels[role] ?? role}</strong>
                <div className="muted small">
                  {current ? (
                    <>
                      {current}
                      {selected ? (
                        <>
                          {" · "}
                          {formatPerM(selected.inputPerM)}/M in, {formatPerM(selected.outputPerM)}/M out
                          {selected.cacheReadPerM !== null ? (
                            <> · {formatPerM(selected.cacheReadPerM)}/M cached</>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    "using the built-in fallback chain"
                  )}
                </div>
              </div>
              {current ? (
                <button className="tiny" onClick={() => void choose(role, null)} disabled={saving === role}>
                  Reset to default
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      <h2>Available models ({data.models.length})</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          className="filter-input"
          placeholder="Filter by id…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="row small muted" style={{ gap: 5 }}>
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
          free only
        </label>
      </div>

      <div className="table">
        <div className="tr th">
          <span>model</span>
          <span>in /M</span>
          <span>out /M</span>
          <span>cached</span>
          <span>ctx</span>
          <span>flags</span>
          <span />
        </div>
        {visible.map((m) => (
          <div key={m.id} className="tr">
            <span className="mono">{m.id}</span>
            <span className="mono" data-label="in">{formatPerM(m.inputPerM)}</span>
            <span className="mono" data-label="out">{formatPerM(m.outputPerM)}</span>
            <span className="mono" data-label="cached">
              {m.cacheReadPerM === null ? "—" : formatPerM(m.cacheReadPerM)}
            </span>
            <span className="mono" data-label="ctx">{formatContext(m.contextLength)}</span>
            <span className="muted small" data-label="flags">
              {m.free ? "free " : ""}
              {m.toolCall ? "tools " : ""}
              {m.reasoning ? "reasoning " : ""}
              {m.inputModalities.includes("image") ? "vision" : ""}
            </span>
            <span>
              {data.availableRoles.map((role) => (
                <button
                  key={role}
                  className="tiny"
                  title={`Use for ${data.roleLabels[role] ?? role}`}
                  onClick={() => void choose(role, m.id)}
                  disabled={saving === role || data.roles[role] === m.id}
                >
                  {data.roles[role] === m.id ? "✓ set" : role === "tutor" ? "tutor" : "review"}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <button style={{ marginTop: 12 }} onClick={() => void load(true)}>
        Refresh catalog
      </button>
    </>
  );
}
