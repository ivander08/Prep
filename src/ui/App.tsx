import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "./components/CodeEditor";
import { TutorPanel } from "./components/TutorPanel";
import { ModelPicker } from "./components/ModelPicker";
import { MasteryView } from "./components/MasteryView";
import { CompaniesView } from "./components/CompaniesView";
import {
  api,
  GRADE_LABEL,
  type DueItem,
  type ListSummary,
  type ProblemDetail,
  type ProblemRow,
  type RunResponse,
  type AttemptResponse,
} from "./api";

const LISTS = ["blind75", "neetcode150", "neetcode250", "leetcode75", "topInterview150"] as const;

const STARTERS: Record<string, string> = {
  python3: "class Solution:\n    def solve(self):\n        pass\n",
};

type View = "overview" | "list" | "review" | "weakness" | "companies" | "models";

export function App() {
  const [view, setView] = useState<View>("overview");
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [catalog, setCatalog] = useState(0);
  const [activeList, setActiveList] = useState<string>("neetcode150");
  const [problems, setProblems] = useState<ProblemRow[]>([]);
  const [due, setDue] = useState<DueItem[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLists = useCallback(async () => {
    try {
      const r = await api<{ lists: ListSummary[]; catalog: number }>("/api/lists");
      setLists(r.lists);
      setCatalog(r.catalog);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadList = useCallback(async (name: string) => {
    try {
      const r = await api<{ problems: ProblemRow[] }>(`/api/lists/${name}/problems?limit=200`);
      setProblems(r.problems);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadDue = useCallback(async () => {
    try {
      const r = await api<{ due: DueItem[] }>("/api/review?limit=50");
      setDue(r.due);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    void loadDue();
  }, [refreshLists, loadDue]);

  useEffect(() => {
    if (view === "list") void loadList(activeList);
  }, [view, activeList, loadList]);

  const onSolved = useCallback(() => {
    void refreshLists();
    void loadDue();
    if (view === "list") void loadList(activeList);
  }, [refreshLists, loadDue, loadList, view, activeList]);

  if (openSlug) {
    return (
      <ProblemView
        slug={openSlug}
        onBack={() => {
          setOpenSlug(null);
          onSolved();
        }}
      />
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span>Prep</span>
        </div>

        <nav className="nav">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
            Overview
          </button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>
            Review {due.length > 0 ? `(${due.length})` : ""}
          </button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            Practice
          </button>
          <button className={view === "weakness" ? "active" : ""} onClick={() => setView("weakness")}>
            Weakness
          </button>
          <button className={view === "companies" ? "active" : ""} onClick={() => setView("companies")}>
            Companies
          </button>
          <button className={view === "models" ? "active" : ""} onClick={() => setView("models")}>
            Models
          </button>
        </nav>

        <div>
          <h2>Lists</h2>
          <nav className="nav">
            {LISTS.map((l) => {
              const s = lists.find((x) => x.name === l);
              return (
                <button
                  key={l}
                  className={view === "list" && activeList === l ? "active" : ""}
                  onClick={() => {
                    setActiveList(l);
                    setView("list");
                  }}
                >
                  {l}
                  {s ? <span className="muted small"> {s.solved}/{s.total}</span> : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="muted small" style={{ marginTop: "auto" }}>
          {catalog.toLocaleString()} problems cached locally
        </div>
      </aside>

      <main className="main">
        {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}

        {view === "overview" ? (
          <Overview lists={lists} catalog={catalog} due={due} onOpen={setOpenSlug} />
        ) : null}

        {view === "review" ? (
          <Review due={due} onOpen={setOpenSlug} onRefresh={loadDue} />
        ) : null}

        {view === "list" ? (
          <ListView name={activeList} problems={problems} onOpen={setOpenSlug} />
        ) : null}

        {view === "weakness" ? <MasteryView /> : null}

        {view === "companies" ? <CompaniesView onOpen={setOpenSlug} /> : null}

        {view === "models" ? <ModelPicker /> : null}
      </main>
    </div>
  );
}

function Overview({
  lists,
  catalog,
  due,
  onOpen,
}: {
  lists: ListSummary[];
  catalog: number;
  due: DueItem[];
  onOpen: (slug: string) => void;
}) {
  const totalSolved = useMemo(() => lists.reduce((a, l) => a + l.solved, 0), [lists]);

  return (
    <>
      <h1>Overview</h1>
      <p className="muted">Local-first interview prep. Nothing leaves this machine except your AI calls.</p>

      <div className="stat-grid" style={{ marginTop: 18 }}>
        <div className="stat">
          <div className="n">{catalog.toLocaleString()}</div>
          <div className="k">problems cached</div>
        </div>
        <div className="stat">
          <div className="n">{totalSolved}</div>
          <div className="k">solved across lists</div>
        </div>
        <div className="stat">
          <div className="n">{due.length}</div>
          <div className="k">due for review</div>
        </div>
      </div>

      <h2>Due now</h2>
      {due.length === 0 ? (
        <div className="card muted">Nothing due. Solve something and it will come back on a schedule.</div>
      ) : (
        <div>
          {due.slice(0, 8).map((d) => (
            <div key={d.qid} className="problem-row" onClick={() => onOpen(d.slug)}>
              <span className="qid">{d.qid}</span>
              <span className="title">{d.title}</span>
              <span className={`badge ${d.difficulty}`}>{d.difficulty}</span>
            </div>
          ))}
        </div>
      )}

      <h2>Progress</h2>
      <div className="card">
        {lists.map((l) => {
          const pct = l.total > 0 ? Math.round((l.solved / l.total) * 100) : 0;
          return (
            <div key={l.name} className="spread" style={{ padding: "5px 0" }}>
              <span>{l.name}</span>
              <span className="muted small">
                {l.solved}/{l.total} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ListView({
  name,
  problems,
  onOpen,
}: {
  name: string;
  problems: ProblemRow[];
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <h1>{name}</h1>
      <p className="muted">Click a problem to open it.</p>
      <div style={{ marginTop: 14 }}>
        {problems.map((p) => (
          <div key={p.qid} className={`problem-row${p.solved ? " solved" : ""}`} onClick={() => onOpen(p.slug)}>
            <span className="qid">{p.qid}</span>
            <span className="title">{p.title}</span>
            <span className={`badge ${p.difficulty}`}>{p.difficulty}</span>
          </div>
        ))}
        {problems.length === 0 ? <div className="empty">No problems loaded for this list.</div> : null}
      </div>
    </>
  );
}

function Review({ due, onOpen, onRefresh }: { due: DueItem[]; onOpen: (s: string) => void; onRefresh: () => void }) {
  return (
    <>
      <div className="spread">
        <h1>Review</h1>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <p className="muted">
        Re-solve these from memory, no hints. Your grade is derived from whether the tests pass — not from how
        confident you feel.
      </p>
      <div style={{ marginTop: 14 }}>
        {due.map((d) => (
          <div key={d.qid} className="problem-row" onClick={() => onOpen(d.slug)}>
            <span className="qid">{d.qid}</span>
            <span className="title">{d.title}</span>
            <span className="muted small">
              {d.reps} reps{d.lapses > 0 ? `, ${d.lapses} lapses` : ""}
            </span>
          </div>
        ))}
        {due.length === 0 ? <div className="empty">Nothing due right now.</div> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Problem workspace
// ---------------------------------------------------------------------------

function ProblemView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [code, setCode] = useState("");
  const [run, setRun] = useState<RunResponse | null>(null);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    setProblem(null);
    setRun(null);
    setAttempt(null);
    setHintsUsed(0);
    startedAt.current = Date.now();

    api<ProblemDetail>(`/api/problems/${slug}`)
      .then((p) => {
        if (cancelled) return;
        setProblem(p);
        const starter =
          p.snippets.find((s) => s.langSlug === "python3")?.code ??
          STARTERS.python3 ??
          "class Solution:\n    pass\n";
        setCode(starter);
      })
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const onRun = useCallback(async () => {
    if (!problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<RunResponse>("/api/run", {
        method: "POST",
        body: JSON.stringify({ slug: problem.slug, code, fnName: problem.meta.name }),
      });
      setRun(r);

      const a = await api<AttemptResponse>("/api/attempts", {
        method: "POST",
        body: JSON.stringify({
          slug: problem.slug,
          code,
          passed: r.accepted,
          testsPassed: r.passed,
          testsTotal: r.total,
          hintsUsed,
          solutionUnlocked: false,
          seconds: (Date.now() - startedAt.current) / 1000,
        }),
      });
      setAttempt(a);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [problem, code, busy, hintsUsed]);

  if (error) {
    return (
      <div className="layout full">
        <main className="main">
          <button onClick={onBack}>← Back</button>
          <div className="notice bad" style={{ marginTop: 16 }}>{error}</div>
        </main>
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="layout full">
        <main className="main">
          <button onClick={onBack}>← Back</button>
          <div className="spinner" style={{ marginTop: 16 }}>Loading problem…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="layout full">
      <main className="main">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div className="row">
            <button onClick={onBack}>← Back</button>
            <h1 style={{ margin: 0 }}>{problem.title}</h1>
            <span className={`badge ${problem.difficulty}`}>{problem.difficulty}</span>
          </div>
          <span className="muted small">
            {problem.card ? `last reviewed ${new Date(problem.card.due).toLocaleDateString()}` : "new"}
          </span>
        </div>

        <div className="workspace">
          <div>
            <div className="card statement">
              <Statement md={problem.statementMd} />
            </div>

            {problem.hints.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <h2>Hints ({problem.hints.length})</h2>
                {problem.hints.map((h, i) => (
                  <details
                    key={i}
                    className="hint"
                    onToggle={(e) => {
                      if ((e.target as HTMLDetailsElement).open) setHintsUsed((n) => Math.max(n, i + 1));
                    }}
                  >
                    <summary>Hint {i + 1}</summary>
                    <div style={{ marginTop: 6 }}>{h}</div>
                  </details>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <CodeEditor value={code} onChange={setCode} onRun={() => void onRun()} />

            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => void onRun()} disabled={busy}>
                {busy ? "Running…" : "Run tests"}
              </button>
              <span className="muted small">Ctrl+Enter</span>
              {hintsUsed > 0 ? <span className="muted small">hints opened: {hintsUsed}</span> : null}
            </div>

            {problem.parseWarning ? (
              <div className="notice warn" style={{ marginTop: 12 }}>{problem.parseWarning}</div>
            ) : null}

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

                {attempt?.nextDue ? (
                  <div className="notice info" style={{ marginTop: 10 }}>
                    Grade <strong>{GRADE_LABEL[attempt.grade] ?? attempt.grade}</strong> — next review in{" "}
                    <strong>{attempt.intervalDays} day{attempt.intervalDays === 1 ? "" : "s"}</strong> (
                    {new Date(attempt.nextDue).toLocaleDateString()})
                  </div>
                ) : null}

                {run.stderr ? (
                  <pre className="notice bad" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{run.stderr}</pre>
                ) : null}

                <div className="results">
                  {run.cases.map((c) => (
                    <div key={c.index} className={`case ${c.pass ? "pass" : "fail"}`}>
                      <span>{c.pass ? "PASS" : "FAIL"}</span>
                      <span className="vals">
                        {c.error ? (
                          <span style={{ color: "var(--bad)" }}>{c.error}</span>
                        ) : (
                          <>
                            in {JSON.stringify(c.args)} → got {JSON.stringify(c.got)}
                            {!c.pass ? <> · expected {JSON.stringify(c.expected)}</> : null}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="notice warn" style={{ marginTop: 12 }}>{run.disclaimer}</div>
              </div>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <TutorPanel
                slug={problem.slug}
                lastRun={
                  run
                    ? {
                        passed: run.accepted,
                        testsPassed: run.passed,
                        testsTotal: run.total,
                        stderr: run.stderr,
                        code,
                      }
                    : null
                }
                onUnlocked={() => {
                  setHintsUsed((n) => Math.max(n, problem.hints.length));
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Minimal markdown renderer: paragraphs, lists, fenced code, inline code, bold/italic.
 * Hand-rolled rather than pulling a dependency — statements use a small, fixed subset.
 */
function Statement({ md }: { md: string }) {
  const blocks = useMemo(() => {
    const out: Array<{ kind: "p" | "ul" | "pre"; content: string }> = [];
    const lines = md.split("\n");
    let buf: string[] = [];
    let list: string[] = [];
    let pre: string[] = [];
    let inPre = false;

    const flushP = () => {
      if (buf.length) {
        out.push({ kind: "p", content: buf.join(" ") });
        buf = [];
      }
    };
    const flushList = () => {
      if (list.length) {
        out.push({ kind: "ul", content: list.join("\n") });
        list = [];
      }
    };

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inPre) {
          out.push({ kind: "pre", content: pre.join("\n") });
          pre = [];
          inPre = false;
        } else {
          flushP();
          flushList();
          inPre = true;
        }
        continue;
      }
      if (inPre) {
        pre.push(line);
        continue;
      }
      if (line.trim().startsWith("- ")) {
        flushP();
        list.push(line.trim().slice(2));
        continue;
      }
      if (line.trim() === "") {
        flushP();
        flushList();
        continue;
      }
      flushList();
      buf.push(line.trim());
    }
    flushP();
    flushList();
    if (pre.length) out.push({ kind: "pre", content: pre.join("\n") });
    return out;
  }, [md]);

  return (
    <div>
      {blocks.map((b, i) => {
        if (b.kind === "pre") {
          return (
            <pre key={i}>
              <code>{b.content}</code>
            </pre>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i}>
              {b.content.split("\n").map((li, j) => (
                <li key={j}>{inline(li)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(b.content)}</p>;
      })}
    </div>
  );
}

function inline(text: string) {
  // Bold before italic: the italic pattern must not consume the inner span of `**bold**`.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p.length > 0);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}
