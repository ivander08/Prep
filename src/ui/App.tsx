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
import { SqlView } from "./components/SqlView";
import { TipsPanel } from "./components/TipsPanel";
import { Row } from "./components/Row";
import { ProseTrackView } from "./components/ProseTrackView";
import { NAV_SHORTCUTS, typingTarget } from "./shortcuts";
// Imported, not referenced by URL: Vite rewrites the path to the hashed filename at build time,
// so a literal `/assets/logo.svg` would 404 in production. The favicon in `index.html` is
// rewritten by the same mechanism.
import logoUrl from "./assets/logo.svg";
import {
  api,
  ApiError,
  GRADE_LABEL,
  DUE_TRACK_LABEL,
  DUE_TRACK_VIEW,
  type DueTrack,
  type DueTrackItem,
  type ListSummary,
  type MilestoneState,
  type ProblemDetail,
  type ProblemRow,
  type RunResponse,
  type AttemptResponse,
  type StreakStats,
} from "./api";

const LISTS = ["blind75", "neetcode150", "neetcode250", "leetcode75", "topInterview150"] as const;

/**
 * The sidebar's sections, in order.
 *
 * A flat list of eleven entries put `Fundamentals`, `Design` and `Build` between `Roadmap` and
 * `Problems` with nothing to say they belong together, and left `Models` and `Settings` (config)
 * indistinguishable from the things you practise. The grouping is the fix: each section answers a
 * different question, and `Overview` leads the first one so there is no unlabelled orphan.
 *
 * There is no `Problems` entry: it pointed at the same `list` view as the list buttons below it,
 * with `activeList` unchanged, so it rendered the active list under a generic heading. The lists
 * are the entry points.
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
      ["sql", "SQL"],
      ["behavioral", "Behavioral"],
      ["stack", "Stack"],
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
  | "components"
  | "sql"
  | "behavioral"
  | "stack";

/**
 * The `g` chord, wired from the shared table in `shortcuts.ts`.
 *
 * The pending flag is a closure variable rather than state: nothing renders from it, and putting
 * it in state would re-render the whole app on the `g`. The chord is abandoned on any key that
 * is not a mapping, and after 1.5 s — without the timeout a `g` typed an hour ago would still be
 * pending and the next stray letter would navigate away from whatever you were reading.
 */
function useNavShortcuts(open: (view: View) => void): void {
  useEffect(() => {
    let pending = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingTarget(document.activeElement)) return;

      if (e.key === "g") {
        pending = Date.now();
        return;
      }

      if (pending && Date.now() - pending < 1500) {
        pending = 0;
        const hit = NAV_SHORTCUTS.find((s) => s.key === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          open(hit.view as View);
        }
        return;
      }

      pending = 0;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

export function App() {
  const [view, setView] = useState<View>("overview");
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [catalog, setCatalog] = useState(0);
  const [activeList, setActiveList] = useState<string>("neetcode150");
  const [due, setDue] = useState<DueTrackItem[]>([]);
  const [streak, setStreak] = useState<StreakStats | null>(null);
  const [milestones, setMilestones] = useState<MilestoneState[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the navigation drawer is open, on screens too narrow for the fixed sidebar.
   *
   * The sidebar is 216px of a phone's 390px, which left 174px for the app and pushed every
   * view into horizontal overflow. Below 860px it becomes an off-canvas drawer. The state
   * lives here because the backdrop and the nav buttons both need to close it.
   */
  const [navOpen, setNavOpen] = useState(false);
  /** The component the Build view should open on arrival, set by the Design bridge. */
  const [componentSlug, setComponentSlug] = useState<string | null>(null);
  /** The item a non-DSA track should open on arrival, set by a due row. */
  const [trackTarget, setTrackTarget] = useState<{ kind: DueTrack; ref: string } | null>(null);

  const openComponent = useCallback((slug: string) => {
    setComponentSlug(slug);
    setView("components");
  }, []);

  /**
   * Open a track on a specific item.
   *
   * Takes the whole item, not a `(kind, ref)` pair: a `pattern` row has a second destination to
   * consider, and both call sites (Review and Overview) would repeat that branch.
   *
   * A `pattern` row carries the problem to re-solve in `problemSlug`, and re-solving it IS the
   * pattern review: the attempt's grade drives the pattern card through
   * `/api/review/patterns/:pattern/grade`. Nothing passed means `problemSlug: null`, which falls
   * back to the Roadmap. DSA goes through `openSlug`; other kinds set a pending target and switch
   * view, and each view reads it on arrival the way `ComponentsView` reads its `initialSlug`.
   */
  const onOpenTrack = useCallback((item: DueTrackItem) => {
    if (item.kind === "pattern" && item.problemSlug) {
      setOpenSlug(item.problemSlug);
      return;
    }
    if (item.kind === "dsa") {
      setOpenSlug(item.ref);
      return;
    }
    setTrackTarget({ kind: item.kind, ref: item.ref });
    setView(DUE_TRACK_VIEW[item.kind]);
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
      const r = await api<{ due: DueTrackItem[] }>("/api/review?limit=40");
      setDue(r.due);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * The streak and the milestones.
   *
   * Fetched together because they answer the same question, what has been earned, and because
   * `/api/milestones` evaluates on read, so it must be re-read after any graded event for a new
   * award to appear. Nothing here is self-reported: both are derived from the attempt log.
   */
  const loadProgress = useCallback(async () => {
    try {
      const s = await api<StreakStats>("/api/streak");
      setStreak(s);
    } catch {
      // Progress readouts are not worth an error banner; the rest of the overview still works.
    }
    try {
      const m = await api<{ milestones: MilestoneState[] }>("/api/milestones");
      setMilestones(m.milestones);
    } catch {
      // Same.
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    void loadDue();
    void loadProgress();
  }, [refreshLists, loadDue, loadProgress]);

  /**
   * The navigation chords. The same resets an explicit nav click performs, so `g b` does not
   * re-open whatever round was last finished and `g q` does not jump to a due item's problem.
   */
  const onShortcut = useCallback((next: View) => {
    setComponentSlug(null);
    setTrackTarget(null);
    setView(next);
    setNavOpen(false);
  }, []);

  useNavShortcuts(onShortcut);

  const onSolved = useCallback(() => {
    void refreshLists();
    void loadDue();
    void loadProgress();
  }, [refreshLists, loadDue, loadProgress]);

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
          grid still has the two children it expects. */}
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
          {/*
            `aria-hidden` because the adjacent text already names the app: a screen reader that
            also read the SVG's label would say "Prep Prep". The mark is decoration over a label,
            not a second label.
          */}
          <img src={logoUrl} alt="" aria-hidden="true" width={22} height={22} />
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
                      // An explicit nav click clears the pending targets, so Build opens on the
                      // default instead of re-opening whatever round was last finished, and a
                      // track does not re-open the item a due row selected.
                      if (id === "components") setComponentSlug(null);
                      setTrackTarget(null);
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
          <Overview
            lists={lists}
            catalog={catalog}
            due={due}
            streak={streak}
            milestones={milestones}
            onOpenTrack={onOpenTrack}
          />
        ) : null}

        {view === "review" ? <Review due={due} onOpenTrack={onOpenTrack} onRefresh={loadDue} /> : null}

        {view === "list" ? <ProblemList listName={activeList} onOpen={setOpenSlug} /> : null}

        {view === "roadmap" ? <RoadmapView onOpen={setOpenSlug} /> : null}

        {view === "fundamentals" ? (
          <FundamentalsView
            initialSlug={trackTarget?.kind === "concept" ? trackTarget.ref : null}
            onSolved={onSolved}
          />
        ) : null}

        {view === "design" ? (
          <DesignView
            onBuild={openComponent}
            initialSlug={trackTarget?.kind === "design" ? trackTarget.ref : null}
          />
        ) : null}

        {view === "components" ? (
          <ComponentsView initialSlug={trackTarget?.kind === "component" ? trackTarget.ref : componentSlug} onSolved={onSolved} />
        ) : null}

        {view === "sql" ? (
          <SqlView
            initialSlug={trackTarget?.kind === "sql" ? trackTarget.ref : null}
            onSolved={onSolved}
          />
        ) : null}

        {view === "behavioral" ? (
          <ProseTrackView
            kind="behavioral"
            initialSlug={trackTarget?.kind === "behavioral" ? trackTarget.ref : null}
            onSolved={onSolved}
          />
        ) : null}

        {view === "stack" ? (
          <ProseTrackView
            kind="stack"
            initialSlug={trackTarget?.kind === "stack" ? trackTarget.ref : null}
            onSolved={onSolved}
          />
        ) : null}

        {view === "weakness" ? <MasteryView /> : null}

        {view === "companies" ? <CompaniesView onOpen={setOpenSlug} /> : null}

        {view === "models" ? <ModelPicker /> : null}

        {view === "settings" ? <SettingsView onReset={onSolved} /> : null}
      </main>
    </div>
  );
}

/**
 * The heatmap's intensity bucket for a day's graded-event count.
 *
 * Absolute thresholds, not a quantile of the window: a quantile would rescale the whole calendar
 * every time one day changed, so the same day's colour would drift as unrelated days were added.
 * These bands are stable (1, 2, 3-4, 5+), which is what makes two screenshots comparable.
 */
function level(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

function Overview({
  lists,
  catalog,
  due,
  streak,
  milestones,
  onOpenTrack,
}: {
  lists: ListSummary[];
  catalog: number;
  due: DueTrackItem[];
  streak: StreakStats | null;
  milestones: MilestoneState[];
  onOpenTrack: (item: DueTrackItem) => void;
}) {
  const totalSolved = useMemo(() => lists.reduce((a, l) => a + l.solved, 0), [lists]);

  const earnedMilestones = useMemo(() => milestones.filter((m) => m.earnedAt), [milestones]);
  const unearnedMilestones = useMemo(() => milestones.filter((m) => !m.earnedAt), [milestones]);
  const pctEarned = milestones.length > 0 ? Math.round((earnedMilestones.length / milestones.length) * 100) : 0;

  /**
   * Local today, as `YYYY-MM-DD`. Matches the server's own local bucketing; `toISOString` would
   * be UTC and would mark the wrong cell in the evening.
   */
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

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
        <div className="cell">
          <span className="k">Streak</span>
          <span className={`v ${streak?.todayDone ? "signal" : ""}`}>
            {streak ? streak.current : "—"}
            {streak && streak.current > 0 ? (
              <span className="muted small"> day{streak.current === 1 ? "" : "s"}</span>
            ) : null}
          </span>
        </div>
      </div>

      {/*
        The activity calendar. Derived from the same `last_review` rows as the streak itself, so
        a day is lit because a card was graded on it. There is nothing to check off.
        Intensity comes from the event count, so a heavy day is visibly heavier.
      */}
      {streak && streak.activeDays > 0 ? (
        <div className="streak-cal">
          <div className="streak-grid">
            {streak.calendar.map((d) => (
              <span
                key={d.day}
                className={`streak-cell l${level(d.count)}${d.day === today ? " today" : ""}`}
                title={`${d.day} — ${d.count === 0 ? "nothing graded" : `${d.count} graded`}`}
              />
            ))}
          </div>
          <div className="streak-legend">
            <span className="muted small">
              {streak.activeDays} active day{streak.activeDays === 1 ? "" : "s"} · best {streak.best}
            </span>
            <span className="streak-legend-scale">
              <span className="muted small">less</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={`streak-cell l${l}`} />
              ))}
              <span className="muted small">more</span>
            </span>
          </div>
        </div>
      ) : null}

      <h2>Due now</h2>
      {due.length === 0 ? (
        <div className="empty">
          Nothing due. Solve something and it returns on a schedule — 4 days, then 34, then 89.
        </div>
      ) : (
        <div className="table">
          {due.slice(0, 8).map((d) => (
            <Row key={`${d.kind}:${d.ref}`} onClick={() => onOpenTrack(d)}>
              <span className="qid mono muted small">{DUE_TRACK_LABEL[d.kind]}</span>
              <span className="title">{d.title}</span>
              <span className="muted small">
                {d.reps} rep{d.reps === 1 ? "" : "s"}
              </span>
            </Row>
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

      <h2>Milestones</h2>
      <p className="muted small">
        Earned once, from what the attempt log actually records. Nothing here can be claimed — each
        row is a query over graded work.
      </p>
      {/*
        Two lists, not one flat one. At ten rows the flat list was readable; at eighteen the
        unearned ones are the only ones with anything to say (each carries its standing), and
        they were buried under the earned ones. The count is shown because the set is now large
        enough that "how many are left" is the question the header should answer.
      */}
      <div className="table">
        <div className="problem-row milestone-group">
          <span className="qid">{earnedMilestones.length}</span>
          <span className="title">
            <span>Earned</span>
            <span className="muted small sub">
              {earnedMilestones.length}/{milestones.length}
            </span>
          </span>
          <span className="muted small mono">{pctEarned}%</span>
        </div>
        {earnedMilestones.map((m) => (
          <div key={m.id} className="problem-row milestone earned">
            <span className="qid">✓</span>
            <span className="title">
              <span>{m.title}</span>
              {/*
                The requirement stays on an earned row, and is not replaced by the date. It is
                the only place the milestone's threshold is written down, so dropping it once
                earned made the list unreadable after the fact: you could see that something
                was earned but not what it took.
              */}
              <span className="muted small sub">{m.requirement}</span>
            </span>
            <span className="muted small mono">
              {m.earnedAt ? new Date(m.earnedAt).toLocaleDateString() : ""}
            </span>
          </div>
        ))}

        <div className="problem-row milestone-group">
          <span className="qid">{unearnedMilestones.length}</span>
          <span className="title">
            <span>Still open</span>
            <span className="muted small sub">each row shows where you stand</span>
          </span>
          <span className="muted small mono">{unearnedMilestones.length}</span>
        </div>
        {unearnedMilestones.map((m) => (
          <div key={m.id} className="problem-row milestone">
            <span className="qid">·</span>
            <span className="title">
              <span className="muted">{m.title}</span>
              <span className="muted small sub">{m.requirement}</span>
            </span>
            <span className="muted small mono">{m.progress ?? ""}</span>
          </div>
        ))}
      </div>

      <TipsPanel />
    </>
  );
}

function Review({
  due,
  onOpenTrack,
  onRefresh,
}: {
  due: DueTrackItem[];
  /** Open a track on a specific item. */
  onOpenTrack: (item: DueTrackItem) => void;
  onRefresh: () => void;
}): React.JSX.Element {
  /**
   * `null` is "All", not the string "all": a kind named "all" would be indistinguishable from
   * the absence of a filter, and `DUE_TRACK_LABEL` is a total map so every real kind is a key.
   */
  const [kind, setKind] = useState<DueTrack | null>(null);

  // The chips come from the due list, not from a hardcoded list of every kind. A filter chip for
  // a track with nothing due narrows the list to an empty screen and reads as a broken filter.
  const kinds = useMemo(() => {
    const counts = new Map<DueTrack, number>();
    for (const d of due) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [due]);

  const shown = useMemo(() => (kind ? due.filter((d) => d.kind === kind) : due), [due, kind]);

  return (
    <>
      <div className="spread">
        <h1>Review</h1>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <h2>Due now</h2>
      <p className="muted small">
        Everything scheduled across every track, oldest due first. A grade is derived from
        behaviour — tests passing, or a rubric quoting your own words.
      </p>

      {kinds.length > 1 ? (
        <div className="filters">
          <button className={kind === null ? "primary" : ""} onClick={() => setKind(null)}>
            All <span className="mono muted small">{due.length}</span>
          </button>
          {kinds.map(([k, n]) => (
            <button key={k} className={kind === k ? "primary" : ""} onClick={() => setKind(k)}>
              {DUE_TRACK_LABEL[k]} <span className="mono muted small">{n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty">
          {due.length === 0
            ? "Nothing due. Solve something and it returns on a schedule — 4 days, then 34, then 89."
            : `Nothing due in ${DUE_TRACK_LABEL[kind!]}.`}
        </div>
      ) : (
        <div className="table">
          {shown.map((d) => (
            <Row key={`${d.kind}:${d.ref}`} onClick={() => onOpenTrack(d)}>
              {/*
                The first cell holds the track label, not a number. Which track a row belongs to
                is the one thing a mixed list must say per row. The Overview's milestone rows
                already use this column for a non-numeric marker.
              */}
              <span className="qid mono muted small">{DUE_TRACK_LABEL[d.kind]}</span>
              <span className="title">{d.title}</span>
              <span className="muted small">
                {d.reps} rep{d.reps === 1 ? "" : "s"}
                {d.lapses > 0 ? `, ${d.lapses} lapses` : ""}
              </span>
            </Row>
          ))}
        </div>
      )}
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
   * Default "words": it completes identifiers you already wrote, which removes retyping without
   * handing over API recall, the part interview practice is meant to test.
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
   * The panel refreshes its ceiling when `lastRun` changes identity, so this must change once per
   * RUN, not once per render and not on every keystroke. Keying it on `code` as well would fire a
   * status request per character typed.
   *
   * The consequence is that "Review my code" reviews the code as it was when it was run, not the
   * current buffer. That is the more honest semantic: the review comments on what produced the
   * test result it is given alongside.
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
      // fail the run: the attempt is already recorded, and a pattern card is a secondary
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
              <div className="stack-lg">
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
              <div className="stack-md">
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
 * Premium problems return `content: null` unauthenticated, so there is no fetch that recovers the
 * prose. What is returned is `exampleTestcases` and `metaData`, and 375 Premium problems already
 * have imported suites, so the grader works and only the statement is missing. The panel says
 * that, links out, and offers to store a pasted copy.
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
          <div className="row stack-sm">
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
