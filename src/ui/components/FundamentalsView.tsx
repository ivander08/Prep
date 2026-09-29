import { useCallback, useEffect, useMemo, useState } from "react";
import { api, GRADE_LABEL, type ConceptDetail, type ConceptRunResponse, type ConceptSummary, type ConceptModule } from "../api";
import { CodeEditor, AssistPicker, type AssistLevel } from "./CodeEditor";
import { Stopwatch, useStopwatchVisible } from "./Stopwatch";
import { CaseTabs } from "./CaseTabs";
import { Markdown } from "./Markdown";
import { Row } from "./Row";

type ModulesResponse = {
  lang: string | null;
  languages: string[];
  langLabels: Record<string, string>;
  modules: Array<{ module: ConceptModule; label: string; concepts: ConceptSummary[] }>;
  total: number;
};

/**
 * Language fundamentals — the pre-DSA track.
 *
 * Laid out like the problem workspace (list on the left, work on the right) rather than as a
 * course page, because it is the same activity: read the spec, write code, run it, get a
 * verdict. Reusing `.workspace` and `.table` means one layout language across the app instead
 * of a second set of styles that drift.
 *
 * The exemplar is never shown before a pass. It is in the API response because the same
 * payload seeds the editor, and hiding it client-side would be theatre — but revealing it
 * defeats the point of the exercise, so the UI offers it only after `accepted`.
 */
export function FundamentalsView({
  initialSlug,
  onSolved,
}: {
  /** Set by a due row, so the concept scheduled for review opens directly. */
  initialSlug?: string | null;
  onSolved: () => void;
}) {
  const [lang, setLang] = useState(() => {
    // The slug carries its language prefix (`python3/dynamic-array`), so arriving from a due
    // row selects that language rather than whichever one was last used — otherwise the slug
    // would not match the loaded list and the view would silently fall back to the first
    // concept, making the deep-link appear to do nothing.
    const prefix = initialSlug?.split("/")[0];
    return prefix && prefix.length > 0 ? prefix : "python3";
  });
  const [data, setData] = useState<ModulesResponse | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [code, setCode] = useState("");
  const [run, setRun] = useState<ConceptRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assist, setAssist] = useState<AssistLevel>("words");
  const [showTimer, setShowTimer] = useStopwatchVisible();
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const loadList = useCallback(async (l: string) => {
    try {
      const r = await api<ModulesResponse>(`/api/concepts?lang=${encodeURIComponent(l)}`);
      setData(r);
      setError(null);
      return r;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  // Selecting a language reloads the list AND re-opens the same concept in the new language,
  // because a concept's starter code is language-specific and leaving the old one in the
  // editor would run Python against the C++ harness.
  useEffect(() => {
    void (async () => {
      const r = await loadList(lang);
      if (!r) return;
      const first = r.modules[0]?.concepts[0]?.slug ?? null;
      const keep = activeSlug && r.modules.some((m) => m.concepts.some((c) => c.slug === activeSlug));
      // The pending target wins on arrival: it is a deliberate navigation, and the slug
      // includes the language prefix, so it also selects the right language.
      const fromBridge =
        initialSlug && r.modules.some((m) => m.concepts.some((c) => c.slug === initialSlug))
          ? initialSlug
          : null;
      setActiveSlug(fromBridge ?? (keep ? activeSlug : first));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, loadList]);

  useEffect(() => {
    if (!activeSlug) return;
    let cancelled = false;
    setConcept(null);
    setRun(null);
    setError(null);
    setStartedAt(Date.now());

    api<ConceptDetail>(`/api/concepts/item?slug=${encodeURIComponent(activeSlug)}`)
      .then((c) => {
        if (cancelled) return;
        setConcept(c);
        setCode(c.starter);
      })
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  const onRun = useCallback(async () => {
    if (!concept || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<ConceptRunResponse>("/api/concepts/run", {
        method: "POST",
        body: JSON.stringify({
          slug: concept.slug,
          code,
          seconds: (Date.now() - startedAt) / 1000,
        }),
      });
      setRun(r);
      if (r.accepted) {
        // The pass marker in the list comes from the server, so re-read rather than
        // guessing locally — the same list is the record of what has been learned.
        await loadList(lang);
        onSolved();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [concept, code, busy, startedAt, lang, loadList, onSolved]);

  const done = useMemo(() => {
    const all = data?.modules.flatMap((m) => m.concepts) ?? [];
    return { total: all.length, passed: all.filter((c) => c.reviewed).length };
  }, [data]);

  return (
    <>
      <div className="spread">
        <h1>Fundamentals</h1>
        <div className="row">
          <span className="mono muted small">
            {done.passed}/{done.total} passed
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
          {concept ? (
            <Stopwatch
              startedAt={startedAt}
              limitSeconds={concept.gradeLimitSeconds}
              hintsUsed={0}
              visible={showTimer}
              onToggle={setShowTimer}
            />
          ) : null}
        </div>
      </div>

      <p className="muted">
        Language before algorithms. Each concept is a worked example plus one function to write, graded by
        the same runner as the DSA problems — and scheduled for review once it passes.
      </p>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="workspace">
        <div className="fundamentals-list">
          {data?.modules.map((m) => (
            <div key={m.module}>
              <div className="module-head">
                <span>{m.label}</span>
                <span className="mono muted small">
                  {m.concepts.filter((c) => c.reviewed).length}/{m.concepts.length}
                </span>
              </div>
              <div className="table" style={{ border: "none" }}>
                {m.concepts.map((c) => (
                  <Row
                    key={c.slug}
                    className={`${c.reviewed ? "solved" : ""}${c.slug === activeSlug ? " active" : ""}`}
                    onClick={() => setActiveSlug(c.slug)}
                  >
                    <span className="qid">{c.reviewed ? "✓" : "·"}</span>
                    <span className="title">{c.title}</span>
                    {c.prereq?.length ? (
                      <span className="mono muted small" title={`Prerequisites: ${c.prereq.join(", ")}`}>
                        {c.prereq.length} pre
                      </span>
                    ) : null}
                  </Row>
                ))}
              </div>
            </div>
          ))}
          {data && data.modules.length === 0 ? <div className="empty">No concepts for this language.</div> : null}
        </div>

        <div className="pane">
          {!concept ? (
            <div className="spinner">Loading concept…</div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{concept.title}</h2>

              <div className="card">
                <Markdown md={concept.conceptMd} />
              </div>

              <h2>Your task</h2>
              <p>{concept.promptMd}</p>

              <CodeEditor
                value={code}
                onChange={setCode}
                onRun={() => void onRun()}
                language={concept.lang}
                assist={assist}
              />

              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => void onRun()} disabled={busy}>
                  {busy ? "Running…" : "Run tests"}
                </button>
                <button onClick={() => setCode(concept.starter)} disabled={busy}>
                  Reset to starter
                </button>
                <span className="muted small">Ctrl+Enter</span>
              </div>

              <AssistPicker value={assist} onChange={setAssist} language={concept.lang} />

              {run ? (
                <div className="stack-md">
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
                      <div className="stack-sm">
                        <p className="muted small">
                          Only offered after a pass — reading it first is how a concept feels learned without
                          being learned.
                        </p>
                        <pre className="exemplar">
                          <code>{concept.solution}</code>
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
