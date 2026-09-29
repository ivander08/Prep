import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type Settings = {
  keySource: "env" | "database" | "none";
  keyPreview: string | null;
};

type ResetPreview = {
  clears: Record<string, number>;
  keeps: Record<string, number>;
};

const CLEAR_LABEL: Record<string, string> = {
  attempts: "Solve attempts",
  cards: "Review schedule (cards)",
  tutor_turns: "Tutor turns",
  pattern_mastery: "Pattern mastery",
  item_cards: "Fundamentals schedule",
  milestones: "Milestones",
  design_sessions: "Design rounds",
  track_sessions: "Written answers",
};

const KEEP_LABEL: Record<string, string> = {
  problems: "Problem catalog",
  lists: "Curated lists",
  company_problems: "Company tags",
  full_tests: "Test suites",
  model_roles: "Model choices",
};

/**
 * Settings — the API key, and the reset.
 *
 * Both live here because both are the kind of thing you look for once and then stop
 * thinking about. The key field is a password input so it is not shoulder-readable while
 * being typed, and the stored key is only ever shown as a last-4 preview.
 */
export function SettingsView({ onReset }: { onReset: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api<Settings>("/api/settings"));
    } catch (e) {
      setKeyErr(String(e));
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveKey = useCallback(async () => {
    setBusy(true);
    setKeyErr(null);
    setKeyMsg(null);
    try {
      const r = await api<{ ok: boolean; keyPreview: string }>("/api/settings/key", {
        method: "POST",
        body: JSON.stringify({ key: keyDraft }),
      });
      setKeyDraft("");
      setKeyMsg(`Saved ${r.keyPreview}. The tutor will use it on the next call.`);
      await loadSettings();
    } catch (e) {
      setKeyErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [keyDraft, loadSettings]);

  const clearKey = useCallback(async () => {
    setBusy(true);
    setKeyErr(null);
    setKeyMsg(null);
    try {
      await api("/api/settings/key", { method: "DELETE" });
      setKeyMsg("Stored key removed.");
      await loadSettings();
    } catch (e) {
      setKeyErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [loadSettings]);

  const fromEnv = settings?.keySource === "env";

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Local-only. Everything here is stored in this machine's prep.db.</p>

      <h2>AI key</h2>
      <div className="card">
        {settings ? (
          <div className="notice info" style={{ marginBottom: 12 }}>
            {settings.keySource === "none" ? (
              <>No key configured. The tutor and code review need one; everything else works without it.</>
            ) : settings.keySource === "env" ? (
              <>
                Using the <span className="mono">KENARI_API_KEY</span> environment variable. It takes
                precedence over anything saved here, so the Clear button is disabled.
              </>
            ) : (
              <>
                Using a key stored in the database: <span className="mono">{settings.keyPreview}</span>
              </>
            )}
          </div>
        ) : null}

        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 320px" }}>
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="kn-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && keyDraft.trim()) void saveKey();
              }}
            />
          </label>
          <button className="primary" onClick={() => void saveKey()} disabled={busy || keyDraft.trim().length === 0}>
            Save
          </button>
          <button
            className="danger"
            onClick={() => void clearKey()}
            disabled={busy || fromEnv || settings?.keySource !== "database"}
            title={fromEnv ? "The environment variable takes precedence — removing the stored key would change nothing" : undefined}
          >
            Clear stored key
          </button>
        </div>

        {keyMsg ? <div className="notice info" style={{ marginTop: 12 }}>{keyMsg}</div> : null}
        {keyErr ? <div className="notice bad" style={{ marginTop: 12 }}>{keyErr}</div> : null}
      </div>

      <h2>Reset progress</h2>
      <ResetPanel onReset={onReset} />
    </>
  );
}

/**
 * Reset, behind a typed confirmation.
 *
 * The typed word rather than a checkbox is deliberate: this deletes every attempt, which is
 * the one irreversible action in the app, and a checkbox is one misclick away from being
 * checked. The preview is shown first so the scope is visible before, not after.
 */
function ResetPanel({ onReset }: { onReset: () => void }) {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPreview(await api<ResetPreview>("/api/reset/preview"));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: boolean; cleared: Record<string, number> }>("/api/reset", {
        method: "POST",
        body: JSON.stringify({ confirm: "RESET" }),
      });
      setResult(r.cleared);
      setConfirmText("");
      await load();
      onReset();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [load, onReset]);

  const clearedTotal = preview
    ? Object.entries(preview.clears).reduce((a, [, n]) => a + n, 0)
    : 0;

  return (
    <div className="card">
      {preview ? (
        <>
          <div className="spread" style={{ marginBottom: 10 }}>
            <span className="mono small muted">
              {clearedTotal} row{clearedTotal === 1 ? "" : "s"} to clear
            </span>
            <span className="mono small muted">catalog kept intact</span>
          </div>

          <div className="table" style={{ marginBottom: 12 }}>
            {Object.entries(preview.clears).map(([k, n]) => (
              <div key={k} className="progress-row" style={{ gridTemplateColumns: "1fr 84px" }}>
                <span className="name">{CLEAR_LABEL[k] ?? k}</span>
                <span className="mono tally">{n}</span>
              </div>
            ))}
            {Object.entries(preview.keeps).map(([k, n]) => (
              <div
                key={k}
                className="progress-row"
                style={{ gridTemplateColumns: "1fr 84px", opacity: 0.5 }}
              >
                <span className="name">{KEEP_LABEL[k] ?? k} · kept</span>
                <span className="mono tally">{n}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="spinner">Reading current state…</div>
      )}

      <p className="muted small" style={{ marginTop: 0 }}>
        Removes every attempt, hint, review card, and mastery estimate. The problem catalog, lists,
        company tags, and test suites are untouched, so nothing needs re-importing. This cannot be
        undone.
      </p>

      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field">
          <span>Type RESET to confirm</span>
          <input
            value={confirmText}
            placeholder="RESET"
            onChange={(e) => setConfirmText(e.target.value)}
            style={{ width: 160 }}
          />
        </label>
        <button className="danger" disabled={busy || confirmText !== "RESET"} onClick={() => void reset()}>
          {busy ? "Clearing…" : "Reset progress"}
        </button>
      </div>

      {result ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          Cleared {Object.entries(result).map(([k, n]) => `${n} ${CLEAR_LABEL[k] ?? k}`.toLowerCase()).join(", ")}.
        </div>
      ) : null}
      {error ? <div className="notice bad" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
