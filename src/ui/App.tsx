import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, AssistPicker, type AssistLevel, type Focus } from "./components/CodeEditor";
import { TutorPanel } from "./components/TutorPanel";
import { ModelPicker } from "./components/ModelPicker";
import { MasteryView } from "./components/MasteryView";
import { CompaniesView } from "./components/CompaniesView";
import { RoadmapView } from "./components/RoadmapView";
import { ProblemList } from "./components/ProblemList";
import { SettingsView } from "./components/SettingsView";
import { Markdown } from "./components/Markdown";
import { Stopwatch, useStopwatchVisible } from "./components/Stopwatch";
import { CaseTabs } from "./components/CaseTabs";
import { FundamentalsView } from "./components/FundamentalsView";
import { DesignView } from "./components/DesignView";
import { ComponentsView } from "./components/ComponentsView";
import {
  api,
  ApiError,
  GRADE_LABEL,
  type DueItem,
  type DuePattern,
  type ListSummary,
  type ProblemDetail,
  type ProblemRow,
  type RunResponse,
  type AttemptResponse,
} from "./api";

const LISTS = ["blind75", "neetcode150", "neetcode250", "leetcode75", "topInterview150"] as const;

/**
 * The sidebar's sections, in order.
 *
 * A flat list of eleven entries put `Fundamentals`, `Design` and `Build` between `Roadmap` and
 * `Problems` with nothing to say they belong together, and left `Models` and `Settings` —
 * configuration — indistinguishable from the things you actually practise. The grouping is the
 * fix: each section answers a different question.
 *
 * `Overview` leads the first section rather than sitting outside it, so there is no unlabelled
 * orphan at the top of the list.
 *
 * There is deliberately NO `Problems` entry. It used to exist and pointed at the same `list`
 * view as the list buttons below it, with `activeList` unchanged — so it rendered exactly the
 * active list under a generic heading, which is the single most confusing thing about the old
 * layout. The lists are the entry points.
 */
const NAV: Array<{ label: string; items: Array<readonly [View, string]> }> = [
  {
    label: "Practice",
    items: [
      ["overview", "Overview"],
      ["review", "Review"],
      ["roadmap", "Roadmap"],
    ],
  },
  {
    label: "Tracks",
    items: [
      ["fundamentals", "Fundamentals"],
      ["design", "Design"],
      ["components", "Build"],
    ],
  },
  {
    label: "Analysis",
    items: [
      ["weakness", "Weakness"],
      ["companies", "Companies"],
    ],
  },
  {
    label: "Setup",
    items: [
      ["models", "Models"],
      ["settings", "Settings"],
    ],
  },
];

const STARTERS: Record<string, string> = {
  python3: "class Solution:\n    def solve(self):\n        pass\n",
};

type View =
  | "overview"
  | "list"
  | "roadmap"
  | "review"
  | "weakness"
  | "companies"
  | "models"
  | "settings"
  | "fundamentals"
  | "design"
  | "components";

export function App() {
  const [view, setView] = useState<View>("overview");
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [catalog, setCatalog] = useState(0);
  const [activeList, setActiveList] = useState<string>("neetcode150");
  const [due, setDue] = useState<DueItem[]>([]);
  const [duePatterns, setDuePatterns] = useState<DuePattern[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the navigation drawer is open, on screens too narrow for the fixed sidebar.
   *
   * The sidebar is 216px of a phone's 390px, which left 174px for the app and pushed every
   * view into horizontal overflow. Below 860px it becomes an off-canvas drawer instead. The
   * state lives here rather than in the sidebar because the backdrop and the nav buttons
   * both need to close it.
   */
  const [navOpen, setNavOpen] = useState(false);
  /** The component the Build view should open on arrival, set by the Design bridge. */
  const [componentSlug, setComponentSlug] = useState<string | null>(null);

  const openComponent = useCallback((slug: string) => {
    setComponentSlug(slug);
    setView("components");
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const r = await api<{ lists: ListSummary[]; catalog: number }>("/api/lists");
      setLists(r.lists);
      setCatalog(r.catalog);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadDue = useCallback(async () => {
    try {
      const r = await api<{ due: DueItem[] }>("/api/review?limit=50");
      setDue(r.due);
      const p = await api<{ due: DuePattern[] }>("/api/review/patterns?limit=20");
      setDuePatterns(p.due);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    void loadDue();
  }, [refreshLists, loadDue]);

  const onSolved = useCallback(() => {
    void refreshLists();
    void loadDue();
  }, [refreshLists, loadDue]);

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
      {/* Shown only below the drawer breakpoint. `display: none` above it, so on desktop the
          grid still has exactly the two children it expects. */}
      <header className="topbar">
        <button
          className="menu-btn"
          onClick={() => setNavOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
        >
          ☰
        </button>
        <span className="topbar-title">Prep</span>
      </header>

      {navOpen ? (
        <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      ) : null}

      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brand">
          <span>Prep</span>
        </div>

        {/*
          The sections scroll, the brand and footer do not. With five sections the list is
          taller than a short viewport, and letting the whole sidebar scroll would carry the
          brand and the problem count off-screen with it.
        */}
        <div className="nav-scroll">
          {NAV.map((section) => (
            <div key={section.label} className="nav-section">
              <div className="side-label">{section.label}</div>
              <nav className="nav">
                {section.items.map(([id, label]) => (
                  <button
                    key={id}
                    className={view === id ? "active" : ""}
                    onClick={() => {
                      // An explicit nav click clears the Design bridge's target, so Build opens
                      // on the default rather than re-opening whatever round was last finished.
                      if (id === "components") setComponentSlug(null);
                      setView(id);
                      setNavOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    {id === "review" && due.length > 0 ? <span className="count">{due.length}</span> : null}
                  </button>
                ))}
              </nav>
            </div>
          ))}

          <div className="nav-section">
            <div className="side-label">Lists</div>
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
                      setNavOpen(false);
                    }}
                  >
                    <span>{l}</span>
                    {s ? (
                      <span className="count" title={s.locked > 0 ? `${s.locked} require LeetCode Premium` : undefined}>
                        {s.solved}/{s.total}
                        {s.locked > 0 ? <span className="locked"> ·{s.locked}P</span> : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="sidebar-foot">{catalog.toLocaleString()} problems local</div>
      </aside>

      <main className="main">
        {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}

        {view === "overview" ? (
          <Overview lists={lists} catalog={catalog} due={due} onOpen={setOpenSlug} />
        ) : null}

        {view === "review" ? (
          <Review due={due} duePatterns={duePatterns} onOpen={setOpenSlug} onRefresh={loadDue} />
        ) : null}

        {view === "list" ? <ProblemList listName={activeList} onOpen={setOpenSlug} /> : null}

        {view === "roadmap" ? <RoadmapView onOpen={setOpenSlug} /> : null}

        {view === "fundamentals" ? <FundamentalsView onSolved={onSolved} /> : null}

        {view === "design" ? <DesignView onBuild={openComponent} /> : null}

        {view === "components" ? (
          <ComponentsView initialSlug={componentSlug} onSolved={onSolved} />
        ) : null}

        {view === "weakness" ? <MasteryView /> : null}

        {view === "companies" ? <CompaniesView onOpen={setOpenSlug} /> : null}

        {view === "models" ? <ModelPicker /> : null}

        {view === "settings" ? <SettingsView onReset={onSolved} /> : null}
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

      <div className="readout">
        <div className="cell">
          <span className="k">Catalog</span>
          <span className="v">{catalog.toLocaleString()}</span>
        </div>
        <div className="cell">
          <span className="k">Solved</span>
          <span className="v">{totalSolved}</span>
        </div>
        <div className="cell">
          <span className="k">Due now</span>
          <span className={`v ${due.length > 0 ? "signal" : ""}`}>{due.length}</span>
        </div>
      </div>

      <h2>Due now</h2>
      {due.length === 0 ? (
        <div className="empty">
          Nothing due. Solve something and it returns on a schedule — 4 days, then 34, then 89.
        </div>
      ) : (
        <div className="table">
          {due.slice(0, 8).map((d) => (
            <div key={d.qid} className="problem-row" onClick={() => onOpen(d.slug)}>
              <span className="qid">{d.qid}</span>
              <span className="title">{d.title}</span>
              <span className={`badge ${d.difficulty}`}>{d.difficulty}</span>
            </div>
          ))}
        </div>
      )}

      <h2>List progress</h2>
      <div className="table">
        {lists.map((l) => {
          const pct = l.total > 0 ? (l.solved / l.total) * 100 : 0;
          return (
            <div key={l.name} className="progress-row">
              <span className="name">{l.name}</span>
              <span className="track">
                <span className="fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="mono tally">
                {l.solved}/{l.total}
              </span>
              <span className="mono pct">
                {l.locked > 0 ? <span className="locked" title={`${l.locked} require LeetCode Premium`}>{l.locked}P</span> : null}
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Review({
  due,
  duePatterns,
  onOpen,
  onRefresh,
}: {
  due: DueItem[];
  duePatterns: DuePattern[];
  onOpen: (s: string) => void;
  onRefresh: () => void;
}) {
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

      {duePatterns.length > 0 ? (
        <>
          <h2>Patterns due</h2>
          <p className="muted small">
            Re-solve the problem below from memory. The pattern's next review is scheduled from how
            that attempt goes — pass it cleanly and it goes away for longer.
          </p>
          <div className="table">
            {duePatterns.map((p) => (
              <div key={p.pattern} className="problem-row" onClick={() => onOpen(p.slug)}>
                <span className="qid">{p.reps}×</span>
                <span className="title">
                  {p.pattern}
                  <span className="muted small"> · re-solve {p.title}</span>
                </span>
                <span className={`badge ${p.difficulty}`}>{p.difficulty}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
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
  /** A 422 from /api/run: the problem cannot be graded here. Not the student's failure. */
  const [notGradeable, setNotGradeable] = useState<{ message: string; className: string | null } | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [language, setLanguage] = useState("python3");
  /**
   * Default "words": it completes identifiers you already wrote, which removes retyping
   * without handing over API recall — the part interview practice is meant to test.
   */
  const [assist, setAssist] = useState<AssistLevel>("words");
  const [showTimer, setShowTimer] = useStopwatchVisible();
  /** The region the tutor's last hint pointed at, resolved against the current document. */
  const [focus, setFocus] = useState<Focus | null>(null);
  const [languages, setLanguages] = useState<Array<{ id: string; label: string; langSlug: string; available: boolean }>>([]);
  const startedAt = useRef<number>(Date.now());

  /**
   * Load the problem. Extracted from the effect so the Premium panel can re-fetch after a
   * pasted statement is saved, without duplicating the starter-code logic.
   */
  const loadProblem = useCallback(
    async (opts: { resetTimers: boolean; cancelled?: () => boolean }) => {
      const p = await api<ProblemDetail>(`/api/problems/${slug}`);
      if (opts.cancelled?.()) return;
      setProblem(p);
      const starter =
        p.snippets.find((s) => s.langSlug === "python3")?.code ??
        STARTERS.python3 ??
        "class Solution:\n    pass\n";
      setCode(starter);
      if (opts.resetTimers) startedAt.current = Date.now();
    },
    [slug],
  );

  useEffect(() => {
    let cancelled = false;
    setProblem(null);
    setRun(null);
    setAttempt(null);
    setNotGradeable(null);
    setHintsUsed(0);
    setFocus(null);
    startedAt.current = Date.now();

    api<{ languages: Array<{ id: string; label: string; langSlug: string; available: boolean }> }>(
      "/api/languages",
    )
      .then((r) => !cancelled && setLanguages(r.languages))
      .catch(() => {});

    loadProblem({ resetTimers: false, cancelled: () => cancelled }).catch(
      (e) => !cancelled && setError(String(e)),
    );

    return () => {
      cancelled = true;
    };
  }, [slug, loadProblem]);

  const switchLanguage = useCallback(
    (id: string) => {
      setLanguage(id);
      const meta = languages.find((l) => l.id === id);
      const snippet = meta ? problem?.snippets.find((sn) => sn.langSlug === meta.langSlug)?.code : null;
      if (snippet) setCode(snippet);
      setRun(null);
      setNotGradeable(null);
      setFocus(null);
    },
    [languages, problem],
  );

  /**
   * Identity-stable view of the last run, for the tutor panel.
   *
   * The panel refreshes its ceiling when `lastRun` changes identity, so this must change once
   * per RUN — not once per render, and not on every keystroke. Keying it on `code` as well
   * would fire a status request per character typed.
   *
   * The consequence is that "Review my code" reviews the code as it was when it was run,
   * rather than the current buffer. That is the more honest semantic: the review comments on
   * what produced the test result it is given alongside.
   */
  const lastRunForTutor = useMemo(
    () =>
      run
        ? {
            passed: run.accepted,
            testsPassed: run.passed,
            testsTotal: run.total,
            stderr: run.stderr,
            code,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );

  const onRun = useCallback(async () => {
    if (!problem || busy) return;
    setBusy(true);
    setError(null);
    setNotGradeable(null);
    try {
      const r = await api<RunResponse>("/api/run", {
        method: "POST",
        body: JSON.stringify({ slug: problem.slug, code, fnName: problem.meta.name, language }),
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

      // Schedule the pattern card too, from the same attempt's grade. Failure here must not
      // fail the run — the attempt is already recorded, and a pattern card is a secondary
      // artifact. Guarded on `a.nextDue`: an attempt that scheduled nothing (nothing passed)
      // is not evidence for the pattern either.
      const pattern = problem.pattern;
      if (pattern && a.nextDue) {
        void api(`/api/review/patterns/${encodeURIComponent(pattern)}/grade`, {
          method: "POST",
          body: JSON.stringify({ qid: problem.qid }),
        }).catch(() => {});
      }
    } catch (e) {
      // A 422 from /api/run is a statement about the problem, not about the student's code:
      // either it is a design problem or its examples are in a layout the parser cannot
      // read. Both are rendered as an explanation panel; a red failure would blame the
      // student for a limitation of the runner.
      if (e instanceof ApiError && e.status === 422 && e.body && typeof e.body === "object") {
        const b = e.body as { designProblem?: boolean; className?: string; error?: string };
        setNotGradeable({ message: b.error ?? e.message, className: b.className ?? null });
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(false);
    }
  }, [problem, code, busy, hintsUsed, language]);

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
          <div className="row">
            <span className="muted small">
              {problem.card ? `last reviewed ${new Date(problem.card.due).toLocaleDateString()}` : "new"}
            </span>
            <Stopwatch
              startedAt={startedAt.current}
              limitSeconds={problem.gradeLimitSeconds}
              hintsUsed={hintsUsed}
              visible={showTimer}
              onToggle={setShowTimer}
            />
          </div>
        </div>

        <div className="workspace">
          <div className="pane">
            <div className="card statement">
              {problem.premiumLocked ? (
                <PremiumStatement
                  slug={problem.slug}
                  onSaved={() => void loadProblem({ resetTimers: false })}
                />
              ) : (
                <Markdown md={problem.statementMd} />
              )}
            </div>

            {problem.hints.length > 0 ? (
              <div style={{ marginTop: 22 }}>
                <h2 style={{ marginTop: 0 }}>Hints ({problem.hints.length})</h2>
                {problem.hints.map((h, i) => (
                  <details
                    key={i}
                    className="hint"
                    onToggle={(e) => {
                      if ((e.target as HTMLDetailsElement).open) setHintsUsed((n) => Math.max(n, i + 1));
                    }}
                  >
                    <summary>Hint {i + 1}</summary>
                    <div style={{ marginTop: 6 }}>
                      <Markdown md={h} />
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </div>

          <div className="pane">
            <CodeEditor
              value={code}
              onChange={setCode}
              onRun={() => void onRun()}
              language={language}
              assist={assist}
              focus={focus}
              onFocusClear={() => setFocus((f) => (f ? null : f))}
            />

            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => void onRun()} disabled={busy}>
                {busy ? "Running…" : "Run tests"}
              </button>
              <select
                className="lang-select"
                value={language}
                onChange={(e) => switchLanguage(e.target.value)}
                title="Language"
              >
                {languages.map((l) => (
                  <option key={l.id} value={l.id} disabled={!l.available}>
                    {l.label}
                    {l.available ? "" : " (not installed)"}
                  </option>
                ))}
              </select>
              <span className="muted small">Ctrl+Enter</span>
              {hintsUsed > 0 ? <span className="muted small">hints opened: {hintsUsed}</span> : null}
            </div>

            <AssistPicker value={assist} onChange={setAssist} language={language} />

            {problem.parseWarning && !(problem.hasSuite && language === "python3") ? (
              <div className="notice warn" style={{ marginTop: 12 }}>{problem.parseWarning}</div>
            ) : null}

            {notGradeable ? (
              <div className="notice warn" style={{ marginTop: 12 }}>
                <strong style={{ display: "block", marginBottom: 4 }}>
                  {notGradeable.className ? "Design problem — not graded here" : "Cannot be graded here"}
                </strong>
                {notGradeable.message}
              </div>
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
                  <pre className="notice bad" style={{ marginTop: 10 }}>{run.stderr}</pre>
                ) : null}
              </div>
            ) : null}

            {/* Outside the `run` branch: the examples are part of the problem, so the
                Testcase tab is populated before anything has been run. */}
            <CaseTabs examples={problem.testCases} run={run} params={problem.meta.params} />

            {run ? (
              <div className="notice warn" style={{ marginTop: 12 }}>{run.disclaimer}</div>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <TutorPanel
                slug={problem.slug}
                lastRun={lastRunForTutor}
                onUnlocked={() => {
                  setHintsUsed((n) => Math.max(n, problem.hints.length));
                }}
                onFocus={setFocus}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * The statement panel for a LeetCode Premium problem.
 *
 * Premium problems return `content: null` unauthenticated, so there is no fetch that
 * recovers the prose. What IS returned is `exampleTestcases` and `metaData`, and 375
 * Premium problems already have imported suites — so the grader works, and only the
 * statement is missing. The panel says exactly that rather than reporting an error, links
 * out, and offers to store a pasted copy.
 */
function PremiumStatement({ slug, onSaved }: { slug: string; onSaved: () => void }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const url = `https://leetcode.com/problems/${slug}/`;

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/problems/${slug}/statement`, {
        method: "POST",
        body: JSON.stringify({ statementMd: draft }),
      });
      setSaved(true);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [slug, draft, onSaved]);

  return (
    <div>
      <div className="notice warn">
        This is a LeetCode Premium problem, so its statement is not available without a
        subscription. The test suite for it <em>is</em> available — the runner grades it
        normally, including the examples below.
      </div>

      <p>
        <a href={url} target="_blank" rel="noreferrer noopener">
          Open {slug} on leetcode.com
        </a>
      </p>

      {saved ? (
        <div className="notice info">Statement saved.</div>
      ) : null}

      {editing ? (
        <>
          <textarea
            rows={12}
            placeholder="Paste the problem statement here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: "100%" }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy || draft.trim().length === 0} onClick={() => void save()}>
              {busy ? "Saving…" : "Save statement"}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => setEditing(true)}>Paste the statement</button>
      )}

      {error ? <div className="notice bad" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
