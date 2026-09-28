import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  GRADE_LABEL,
  type ComponentDetail,
  type ComponentModule,
  type ComponentRunResponse,
  type ComponentSummary,
} from "../api";
import { CodeEditor, AssistPicker, type AssistLevel } from "./CodeEditor";
import { Stopwatch, useStopwatchVisible } from "./Stopwatch";
import { CaseTabs } from "./CaseTabs";
import { Markdown } from "./Markdown";

type ModulesResponse = {
  lang: string | null;
  languages: string[];
  langLabels: Record<string, string>;
  modules: Array<{ module: ComponentModule; label: string; components: ComponentSummary[] }>;
  total: number;
};

/**
 * The Build track — executable system-design components.
 *
 * `FundamentalsView` with the nouns changed: module-grouped list on the left, editor and run
 * panel on the right, the same `AssistPicker`, `Stopwatch`, `CaseTabs` and exemplar gate. The
 * two views are the same activity — read a spec, write code, run it, get a verdict — so they
 * share a layout language rather than each growing their own.
 *
 * What is genuinely different is the SHAPE of the exercise: a component is stateful, so the
 * signature takes an operation script and returns the output sequence. That is documented in
 * `opFormat` and shown above the editor, because the encoding is the interface.
 *
 * The exemplar is never shown before a pass, for the same reason it is not in the concept
 * track: reading it first is how a component feels learned without being learned.
 */
export function ComponentsView({
  initialSlug,
  onSolved,
}: {
  /** Set by the Design view's bridge, so a finished round can land straight on its component. */
  initialSlug?: string | null;
  onSolved: () => void;
}) {
  const [lang, setLang] = useState(() => {
    // The bridge slug carries its language prefix (`python3/token-bucket`), so arriving from a
    // finished design round selects that language rather than whichever one was last used —
    // otherwise the slug would not match the loaded list and the view would silently fall back
    // to the first component.
    const prefix = initialSlug?.split("/")[0];
    return prefix && prefix.length > 0 ? prefix : "python3";
  });
  const [data, setData] = useState<ModulesResponse | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [component, setComponent] = useState<ComponentDetail | null>(null);
  const [code, setCode] = useState("");
  const [run, setRun] = useState<ComponentRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assist, setAssist] = useState<AssistLevel>("words");
  const [showTimer, setShowTimer] = useStopwatchVisible();
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const loadList = useCallback(async (l: string) => {
    try {
      const r = await api<ModulesResponse>(`/api/components?lang=${encodeURIComponent(l)}`);
      setData(r);
      setError(null);
      return r;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  // Selecting a language reloads the list AND re-opens the same component in the new language,
  // because a component's starter is language-specific and leaving the old one in the editor
  // would run Python against the C++ harness.
  useEffect(() => {
    void (async () => {
      const r = await loadList(lang);
      if (!r) return;
      const keep = activeSlug && r.modules.some((m) => m.components.some((c) => c.slug === activeSlug));
      // The bridge's slug wins on arrival: it is a deliberate navigation, and the slug
      // includes the language prefix, so it also selects the right language.
      const fromBridge =
        initialSlug && r.modules.some((m) => m.components.some((c) => c.slug === initialSlug))
          ? initialSlug
          : null;
      setActiveSlug(fromBridge ?? (keep ? activeSlug : (r.modules[0]?.components[0]?.slug ?? null)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, loadList]);

  useEffect(() => {
    if (!activeSlug) return;
    let cancelled = false;
    setComponent(null);
    setRun(null);
    setError(null);
    setStartedAt(Date.now());

    api<ComponentDetail>(`/api/components/item?slug=${encodeURIComponent(activeSlug)}`)
      .then((c) => {
        if (cancelled) return;
        setComponent(c);
        setCode(c.starter);
      })
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  const onRun = useCallback(async () => {
    if (!component || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<ComponentRunResponse>("/api/components/run", {
        method: "POST",
        body: JSON.stringify({
          slug: component.slug,
          code,
          seconds: (Date.now() - startedAt) / 1000,
        }),
      });
      setRun(r);
      if (r.accepted) {
        // The pass marker comes from the server, so re-read rather than guessing locally —
        // the same list is the record of what has been built.
        await loadList(lang);
        onSolved();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [component, code, busy, startedAt, lang, loadList, onSolved]);

  const done = useMemo(() => {
    const all = data?.modules.flatMap((m) => m.components) ?? [];
    return { total: all.length, passed: all.filter((c) => c.reviewed).length };
  }, [data]);

  return (
    <>
      <div className="spread">
        <h1>Build</h1>
        <div className="row">
          <span className="mono muted small">
            {done.passed}/{done.total} built
          </span>
          <label className="field">
            <span>Language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {Object.entries(data?.langLabels ?? {}).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {component ? (
            <Stopwatch
              startedAt={startedAt}
              limitSeconds={component.gradeLimitSeconds}
              hintsUsed={0}
              visible={showTimer}
              onToggle={setShowTimer}
            />
          ) : null}
        </div>
      </div>

      <p className="muted">
        The components behind the systems you design, made executable. A stateful component takes one
        operation script and returns the whole output sequence, so every case runs through the same
        runner as the DSA problems — and a pass schedules it for review.
      </p>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="workspace">
        <div className="fundamentals-list">
          {data?.modules.map((m) => (
            <div key={m.module}>
              <div className="module-head">
                <span>{m.label}</span>
                <span className="mono muted small">
                  {m.components.filter((c) => c.reviewed).length}/{m.components.length}
                </span>
              </div>
              <div className="table" style={{ border: "none" }}>
                {m.components.map((c) => (
                  <div
                    key={c.slug}
                    className={`problem-row${c.reviewed ? " solved" : ""}${c.slug === activeSlug ? " active" : ""}`}
                    onClick={() => setActiveSlug(c.slug)}
                  >
                    <span className="qid">{c.reviewed ? "✓" : "·"}</span>
                    <span className="title">{c.title}</span>
                    {c.prereq?.length ? (
                      <span className="mono muted small" title={`Prerequisites: ${c.prereq.join(", ")}`}>
                        {c.prereq.length} pre
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data && data.modules.length === 0 ? <div className="empty">No components for this language.</div> : null}
        </div>

        <div className="pane">
          {!component ? (
            <div className="spinner">Loading component…</div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{component.title}</h2>

              <div className="card">
                <Markdown md={component.conceptMd} />
              </div>

              <h2>Your task</h2>
              <p>{component.promptMd}</p>

              <div className="card op-format">
                <span className="op-format-label">Operation format</span>
                <Markdown md={component.opFormat} />
              </div>

              <CodeEditor
                value={code}
                onChange={setCode}
                onRun={() => void onRun()}
                language={component.lang}
                assist={assist}
              />

              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => void onRun()} disabled={busy}>
                  {busy ? "Running…" : "Run tests"}
                </button>
                <button onClick={() => setCode(component.starter)} disabled={busy}>
                  Reset to starter
                </button>
                <span className="muted small">Ctrl+Enter</span>
              </div>

              <AssistPicker value={assist} onChange={setAssist} language={component.lang} />

              {run ? (
                <div style={{ marginTop: 14 }}>
                  <div className="row">
                    <span className={`verdict ${run.accepted ? "pass" : "fail"}`}>
                      {run.accepted ? "ACCEPTED" : "WRONG ANSWER"}
                    </span>
                    <span className="muted small">
                      {run.passed}/{run.total} cases · {Math.round(run.durationMs)} ms
                    </span>
                  </div>

                  {run.accepted && run.nextDue ? (
                    <div className="notice info" style={{ marginTop: 10 }}>
                      Grade <strong>{GRADE_LABEL[run.grade] ?? run.grade}</strong> — scheduled for review in{" "}
                      <strong>
                        {run.intervalDays} day{run.intervalDays === 1 ? "" : "s"}
                      </strong>{" "}
                      ({new Date(run.nextDue).toLocaleDateString()})
                    </div>
                  ) : null}

                  {run.stderr ? (
                    <pre className="notice bad" style={{ marginTop: 10 }}>
                      {run.stderr}
                    </pre>
                  ) : null}

                  <CaseTabs run={run} />

                  <div className="notice warn" style={{ marginTop: 12 }}>{run.disclaimer}</div>

                  {run.accepted ? (
                    <details className="hint" style={{ marginTop: 12 }}>
                      <summary>Show the exemplar</summary>
                      <div style={{ marginTop: 8 }}>
                        <p className="muted small">
                          Only offered after a pass — reading it first is how a component feels built without
                          being built.
                        </p>
                        <pre className="exemplar">
                          <code>{component.solution}</code>
                        </pre>
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
