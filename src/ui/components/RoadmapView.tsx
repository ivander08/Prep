import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type PatternPriority, type PatternRefView } from "../api";

type RoadmapProblem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  position: number;
  solved: number;
};

type RoadmapPattern = {
  pattern: string;
  problems: RoadmapProblem[];
  total: number;
  solved: number;
  elo: number | null;
  priority: PatternPriority | null;
};

const LISTS = ["neetcode150", "neetcode250", "blind75", "neetcodeAll", "leetcode75", "topInterview150"] as const;

/**
 * Language labels for the reference card's stdlib table.
 *
 * A five-line constant rather than a fetch of `/api/concepts`, which returns the same map: the
 * labels are static strings, and a second network round trip to render one table would be worse
 * than the duplication. The server holds the identical map in `concepts.ts`, and the client
 * already hardcodes `"python3"` as its default language for the same reason.
 */
const LANG_LABEL: Record<string, string> = {
  python3: "Python 3",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
};

/**
 * The roadmap — patterns as the organising unit, not problems.
 *
 * Ordered weakest-first when mastery data exists, because the useful question is what to
 * work on next, not what you are already good at. Each pattern shows its own progress bar
 * so the shape of the whole roadmap is readable at a glance.
 */
export function RoadmapView({ onOpen }: { onOpen: (slug: string) => void }) {
  const [list, setList] = useState<string>("neetcode150");
  const [patterns, setPatterns] = useState<RoadmapPattern[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * Reference cards, fetched once per pattern on first expand and kept.
   *
   * Cached rather than re-fetched on every expand: collapsing and re-expanding a pattern is a
   * common way to compare two of them, and a request per toggle would make that feel slow. The
   * `null` value is a real cached state — "this pattern has no card" — so a pattern the ingest
   * added later is not re-requested on every open.
   */
  const [refs, setRefs] = useState<Record<string, PatternRefView | null>>({});

  const load = useCallback(async (name: string) => {
    try {
      const r = await api<{ patterns: RoadmapPattern[] }>(`/api/roadmap?list=${name}`);
      setPatterns(r.patterns);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadRef = useCallback(
    async (pattern: string) => {
      try {
        const r = await api<{ ref: PatternRefView | null }>(
          `/api/reference/pattern?pattern=${encodeURIComponent(pattern)}&list=${encodeURIComponent(list)}`,
        );
        setRefs((c) => ({ ...c, [pattern]: r.ref }));
      } catch {
        // A failed card fetch is not worth an error banner: the pattern list below it still
        // works, and the card is reference material rather than the exercise itself.
        setRefs((c) => ({ ...c, [pattern]: null }));
      }
    },
    [list],
  );

  useEffect(() => {
    // `recommended` is list-specific, so a cached card from another list would recommend
    // problems that are not in this one.
    setRefs({});
    void load(list);
  }, [list, load]);

  const totals = useMemo(() => {
    const total = patterns.reduce((a, p) => a + p.total, 0);
    const solved = patterns.reduce((a, p) => a + p.solved, 0);
    return { total, solved, pct: total > 0 ? (solved / total) * 100 : 0 };
  }, [patterns]);

  if (error) return <div className="notice bad">{error}</div>;

  return (
    <>
      <div className="spread">
        <h1>Roadmap</h1>
        <select
          className="filter-input"
          value={list}
          onChange={(e) => setList(e.target.value)}
          style={{ minWidth: 180 }}
        >
          {LISTS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <p className="muted">
        Grouped by technique. Ordered weakest-first, so what needs work is at the top — a pattern you
        have not attempted yet sorts above one you have mastered.
      </p>

      <div className="readout">
        <div className="cell">
          <span className="k">Patterns</span>
          <span className="v">{patterns.length}</span>
        </div>
        <div className="cell">
          <span className="k">Solved</span>
          <span className="v">{totals.solved}</span>
        </div>
        <div className="cell">
          <span className="k">Total</span>
          <span className="v">{totals.total}</span>
        </div>
        <div className="cell">
          <span className="k">Complete</span>
          <span className="v signal">
            {totals.pct.toFixed(0)}
            <span className="unit">%</span>
          </span>
        </div>
      </div>

      <div className="roadmap">
        {patterns.map((p) => {
          const pct = p.total > 0 ? (p.solved / p.total) * 100 : 0;
          const done = p.solved === p.total;
          const isCollapsed = collapsed[p.pattern] ?? false;

          return (
            <section key={p.pattern} className={`pattern-block${done ? " done" : ""}`}>
              <button
                className="pattern-head"
                onClick={() => {
                  setCollapsed((c) => ({ ...c, [p.pattern]: !isCollapsed }));
                  if (isCollapsed && !(p.pattern in refs)) void loadRef(p.pattern);
                }}
              >
                <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                {p.priority ? <span className={`badge ${p.priority}`} title="interview weight">{p.priority}</span> : null}
                <span className="pattern-name">{p.pattern}</span>
                {p.elo !== null ? (
                  <span className="pattern-elo mono" title="pattern strength (Elo)">
                    {Math.round(p.elo)}
                  </span>
                ) : (
                  <span className="pattern-elo mono faint" title="not attempted">
                    —
                  </span>
                )}
                <span className="pattern-track">
                  <span className="fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="pattern-tally mono">
                  {p.solved}/{p.total}
                </span>
              </button>

              {!isCollapsed ? (
                <div className="pattern-problems">
                  {/*
                    Three states, and they must stay distinguishable: `undefined` = fetch in
                    flight (show a pending line, not a gap), `null` = fetched and this pattern
                    genuinely has no card (show nothing — a normal state, since the vocabulary
                    is ingested), a value = the card. Collapsing and re-expanding hits the
                    cache, which is why the card only "appears late" on the first expand.
                  */}
                  {refs[p.pattern] === undefined ? (
                    <div className="pattern-ref muted small">Loading card…</div>
                  ) : refs[p.pattern] ? (
                    <PatternCard card={refs[p.pattern]!} onOpen={onOpen} />
                  ) : null}
                  {p.problems.map((pr) => (
                    <div
                      key={pr.qid}
                      className={`problem-row${pr.solved ? " solved" : ""}`}
                      onClick={() => onOpen(pr.slug)}
                    >
                      <span className="qid">{pr.qid}</span>
                      <span className="title">{pr.title}</span>
                      <span className={`badge ${pr.difficulty}`}>{pr.difficulty}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

/**
 * The reference card, rendered above a pattern's problem list.
 *
 * Everything here is either static catalogue prose or a query the server already ran, so there
 * is no state and no fetch of its own — the parent owns the cache and passes the card down.
 * `recommended` is deliberately at the bottom: the card is reference material, and the drill
 * list is the action that follows from reading it.
 */
function PatternCard({ card, onOpen }: { card: PatternRefView; onOpen: (slug: string) => void }) {
  return (
    <div className="pattern-ref">
      <h3>Complexity</h3>
      <div className="table">
        {card.complexity.map((c) => (
          <div key={c.operation} className="ref-row">
            <span className="ref-k">{c.operation}</span>
            <span className="ref-v mono">{c.cost}</span>
          </div>
        ))}
      </div>

      <h3>Corner cases</h3>
      <ul className="ref-list">
        {card.cornerCases.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>

      <h3>Common pitfalls</h3>
      <ul className="ref-list">
        {card.pitfalls.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <h3>Standard library</h3>
      <div className="table">
        {Object.entries(LANG_LABEL).map(([lang, label]) => (
          <div key={lang} className="ref-row">
            <span className="ref-k">{label}</span>
            <span className="ref-v mono">{card.stdlib[lang] ?? "—"}</span>
          </div>
        ))}
      </div>

      <h3>Drill this pattern</h3>
      <div className="table">
        {card.recommended.map((r) => (
          <div key={r.slug} className="problem-row" onClick={() => onOpen(r.slug)}>
            <span className="title">{r.title}</span>
            <span className={`badge ${r.difficulty}`}>{r.difficulty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
