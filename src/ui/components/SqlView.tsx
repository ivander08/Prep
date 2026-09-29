import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  GRADE_LABEL,
  type SqlProblemDetail,
  type SqlProblemList,
  type SqlProblemSummary,
  type SqlRunResponse,
} from "../api";
import { CodeEditor, AssistPicker, type AssistLevel } from "./CodeEditor";
import { Stopwatch, useStopwatchVisible } from "./Stopwatch";
import { Markdown } from "./Markdown";
import { Row } from "./Row";

/**
 * The SQL 50 track.
 *
 * `ComponentsView`'s shape with the nouns changed — list on the left, statement and editor on
 * the right, same `AssistPicker`/`Stopwatch`, same exemplar gate — because it is the same
 * activity: read a spec, write an answer, run it, get a verdict.
 *
 * Two things differ, and both are about the answer being a query rather than a program:
 *
 * 1. The schema and the seed rows are rendered above the editor. Without them the candidate
 *    cannot know a table's columns, and the statement's own `Input:` block is an ASCII table in
 *    a markdown fence — accurate but not something to write a `WHERE` clause against.
 * 2. The result is two grids, not a case list. The reference query's rows and the submitted
 *    query's rows, side by side, because "rows differ" is not actionable on its own and the
 *    multiset rule means the difference is often just ordering.
 *
 * The starter text is `-- Write your query` rather than LeetCode's `codeSnippets`: for SQL that
 * field is only the comment stub `# Write your MySQL query statement below`, which is both
 * wrong for this engine and not a starting point.
 */

const STARTER = "-- Write your query\n";

const DIFFICULTY_ORDER: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

/** A cell as display text. `null` is spelled out: an empty cell reads as a rendering bug. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return v;
  return String(v);
}

/** A result grid. `cols` comes from the row with the most columns, since a projection can vary. */
function ResultGrid({ rows, empty }: { rows: unknown[][]; empty: string }) {
  if (rows.length === 0) return <div className="empty">{empty}</div>;
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);

  return (
    <div className="table sql-result">
      {rows.map((r, i) => (
        <div className="sql-row" key={i}>
          {Array.from({ length: width }, (_, j) => (
            <span className="mono" key={j}>
              {j < r.length ? cell(r[j]) : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SqlView({
  initialSlug,
  onSolved,
}: {
  /** Set by a due row, so the problem scheduled for review opens directly. */
  initialSlug?: string | null;
  onSolved: () => void;
}) {
  const [data, setData] = useState<SqlProblemList | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  /**
   * The current selection, readable from an async callback without re-creating it.
   *
   * `onRun` captures the slug it ran against and drops the response if the selection moved on. A
   * dependency on `activeSlug` would rebuild the callback mid-flight instead, which is the thing
   * being guarded against.
   */
  const activeSlugRef = useRef<string | null>(null);
  const [problem, setProblem] = useState<SqlProblemDetail | null>(null);
  const [code, setCode] = useState(STARTER);
  const [run, setRun] = useState<SqlRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assist, setAssist] = useState<AssistLevel>("words");
  const [showTimer, setShowTimer] = useStopwatchVisible();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  /** Client-side filter over the 50-row list, so a problem is reachable by name. */
  const [filter, setFilter] = useState("");

  const loadList = useCallback(async () => {
    try {
      const r = await api<SqlProblemList>("/api/sql");
      setData(r);
      setError(null);
      return r;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await loadList();
      if (!r) return;
      const keep = activeSlug && r.problems.some((p) => p.slug === activeSlug);
      const fromTarget = initialSlug && r.problems.some((p) => p.slug === initialSlug) ? initialSlug : null;
      setActiveSlug(fromTarget ?? (keep ? activeSlug : (r.problems[0]?.slug ?? null)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList]);

  useEffect(() => {
    activeSlugRef.current = activeSlug;
    if (!activeSlug) return;
    let cancelled = false;
    setProblem(null);
    setRun(null);
    setError(null);
    setCode(STARTER);
    setStartedAt(Date.now());

    api<SqlProblemDetail>(`/api/sql/item?slug=${encodeURIComponent(activeSlug)}`)
      .then((p) => {
        if (cancelled) return;
        setProblem(p);
      })
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  const onRun = useCallback(async () => {
    if (!problem || busy) return;
    // Captured at call time. Switching problems does not remount this view, so a response that
    // arrives after the switch would otherwise land under the new problem's title: run A, click B
    // while in flight, and A's rows render under B. The same guard the detail effect uses below.
    const forSlug = problem.slug;
    setBusy(true);
    setError(null);
    try {
      const r = await api<SqlRunResponse>("/api/sql/run", {
        method: "POST",
        body: JSON.stringify({
          slug: forSlug,
          query: code,
          seconds: (Date.now() - startedAt) / 1000,
        }),
      });
      if (forSlug !== activeSlugRef.current) return;
      setRun(r);
      if (r.passed) {
        // The solved marker comes from the server, so re-read instead of guessing locally: the
        // same list is the record of what has been solved.
        await loadList();
        onSolved();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [problem, code, busy, startedAt, loadList, onSolved]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = data?.problems ?? [];
    return q ? all.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q)) : all;
  }, [data, filter]);

  const byDifficulty = useMemo(() => {
    const buckets = new Map<string, SqlProblemSummary[]>();
    for (const p of shown) {
      const b = buckets.get(p.difficulty) ?? [];
      b.push(p);
      buckets.set(p.difficulty, b);
    }
    return [...buckets.entries()].sort(
      (a, b) => (DIFFICULTY_ORDER[a[0]] ?? 9) - (DIFFICULTY_ORDER[b[0]] ?? 9),
    );
  }, [shown]);

  return (
    <>
      <div className="spread">
        <h1>SQL</h1>
        <div className="row">
          <span className="mono muted small">
            {data?.solved ?? 0}/{data?.total ?? 50} solved
          </span>
          {problem ? (
            <Stopwatch
              startedAt={startedAt}
              limitSeconds={20 * 60}
              hintsUsed={0}
              visible={showTimer}
              onToggle={setShowTimer}
            />
          ) : null}
        </div>
      </div>

      <p className="muted">
        Fifty query problems, graded by execution. Your query and a reference query each run against
        their own freshly seeded SQLite database built from the problem's own sample data, and the
        result rows are compared as a multiset — order and column names do not matter. A pass
        schedules the problem for review like anything else.
      </p>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="workspace">
        <div className="fundamentals-list">
          <input
            className="filter-input"
            placeholder="Filter by title…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {byDifficulty.map(([difficulty, items]) => (
            <div key={difficulty}>
              <div className="module-head">
                <span>{difficulty}</span>
                <span className="mono muted small">
                  {items.filter((c) => c.solved).length}/{items.length}
                </span>
              </div>
              <div className="table" style={{ border: "none" }}>
                {items.map((c) => (
                  <Row
                    key={c.slug}
                    className={`${c.solved ? "solved" : ""}${c.slug === activeSlug ? " active" : ""}`}
                    onClick={() => setActiveSlug(c.slug)}
                    title={c.fetched ? undefined : "Statement not fetched — run `bun run ingest:sql`"}
                  >
                    <span className="qid">{c.solved ? "✓" : "·"}</span>
                    <span className="title">{c.title}</span>
                    {!c.fetched ? <span className="mono muted small">unfetched</span> : null}
                  </Row>
                ))}
              </div>
            </div>
          ))}
          {shown.length === 0 ? <div className="empty">No problems match that filter.</div> : null}
        </div>

        <div className="pane">
          {!problem && !error ? (
            <div className="spinner">Loading problem…</div>
          ) : !problem ? null : (
            <>
              <h2 style={{ marginTop: 0 }}>{problem.title}</h2>

              <div className="card">
                <Markdown md={problem.statementMd} />
              </div>

              <h2>Schema</h2>
              <p className="muted small">
                Applied to a throwaway in-memory SQLite database before your query runs. This is the
                problem's own DDL, normalized from MySQL.
              </p>
              <pre className="exemplar">
                <code>{problem.schema.join("\n")}</code>
              </pre>

              <h2>Sample data</h2>
              {problem.seed.map((t) => (
                <div key={t.table}>
                  <div className="module-head">
                    <span className="mono">{t.table}</span>
                    <span className="mono muted small">{t.rows.length} rows</span>
                  </div>
                  <ResultGrid
                    rows={[t.columns, ...t.rows]}
                    empty="This table has no sample rows."
                  />
                </div>
              ))}
              {problem.caseCount > 1 ? (
                <p className="muted small">
                  This problem ships {problem.caseCount} sample cases. Case 1 is the one graded.
                </p>
              ) : null}

              <h2>Your query</h2>
              <CodeEditor
                value={code}
                onChange={setCode}
                onRun={() => void onRun()}
                language="sql"
                assist={assist}
              />

              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => void onRun()} disabled={busy}>
                  {busy ? "Running…" : "Run query"}
                </button>
                <button onClick={() => setCode(STARTER)} disabled={busy}>
                  Clear
                </button>
                <span className="muted small">Ctrl+Enter</span>
              </div>

              <AssistPicker value={assist} onChange={setAssist} language="sql" />

              {run ? (
                <div className="stack-md">
                  <div className="row">
                    <span className={`verdict ${run.passed ? "pass" : "fail"}`}>
                      {run.passed ? "ACCEPTED" : "WRONG ANSWER"}
                    </span>
                    {run.mutating ? <span className="muted small">graded on the table state</span> : null}
                  </div>

                  {run.error ? (
                    <pre className="notice bad" style={{ marginTop: 10 }}>
                      {run.error}
                    </pre>
                  ) : null}

                  {run.passed && run.nextDue ? (
                    <div className="notice info" style={{ marginTop: 10 }}>
                      Grade <strong>{GRADE_LABEL[run.grade] ?? run.grade}</strong> — scheduled for review in{" "}
                      <strong>
                        {run.intervalDays} day{run.intervalDays === 1 ? "" : "s"}
                      </strong>{" "}
                      ({new Date(run.nextDue).toLocaleDateString()})
                    </div>
                  ) : null}

                  {!run.error && !run.mutating ? (
                    <>
                      <h3>Your rows</h3>
                      <ResultGrid rows={run.userRows} empty="Your query returned no rows." />
                      <h3>Expected rows</h3>
                      <ResultGrid rows={run.expectedRows} empty="The reference query returned no rows." />
                    </>
                  ) : null}

                  {run.mutating && !run.error ? (
                    <>
                      <h3>Table after your statement</h3>
                      <ResultGrid rows={run.userRows} empty="The table is empty." />
                    </>
                  ) : null}

                  <div className="notice warn" style={{ marginTop: 12 }}>{run.disclaimer}</div>

                  {run.passed && run.reference ? (
                    <details className="hint" style={{ marginTop: 12 }}>
                      <summary>Show a reference query</summary>
                      <div className="stack-sm">
                        <p className="muted small">
                          One correct answer, not the only one. Shown only after a pass — reading it
                          first is how a problem feels solved without being solved.
                        </p>
                        <pre className="exemplar">
                          <code>{run.reference}</code>
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
