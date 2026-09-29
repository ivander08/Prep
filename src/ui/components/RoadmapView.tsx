import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type PatternPriority, type PatternRefView } from "../api";
import { Row } from "./Row";

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
  /**
   * Whether each pattern's PROBLEM LIST is collapsed. Open by default — the problem list is
   * the exercise, so it is what you came for.
   */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /**
   * Whether each pattern's reference card is OPEN. Closed by default.
   *
   * Closed because the card is a page of complexity tables, corner cases, pitfalls and a
   * stdlib map — reading material, not the exercise. With it open, the first pattern pushed
   * every other pattern's problems below a screenful, so the roadmap's shape (which is the
   * thing the view is for) was invisible on arrival.
   *
   * Inverted from the old `collapsed` map so the default is the closed state and an absent key
   * reads as "closed" — the same reason the problems list below uses a positive flag.
   */
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * Reference cards, fetched once per pattern and kept.
   *
   * Cached rather than re-fetched on every expand: collapsing and re-expanding a pattern is a
   * common way to compare two of them, and a request per toggle would make that feel slow. The
   * `null` value is a real cached state — "this pattern has no card" — so a pattern the ingest
   * added later is not re-requested on every open.
   */
  const [refs, setRefs] = useState<Record<string, PatternRefView | null>>({});
  /**
   * Patterns whose card fetch FAILED, as opposed to patterns that have no card.
   *
   * Without this the two collapse into the same `null` in `refs`, and a failed fetch renders
   * identically to "this pattern genuinely has no reference card" — so a network error is
   * indistinguishable from an empty result and the retry is impossible to discover. Kept in
   * its own map rather than as a third value in `refs` because `refs`'s `null` is a real
   * cached answer, and a failed fetch must not be cached as one.
   */
  const [refErrors, setRefErrors] = useState<Record<string, boolean>>({});

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
        setRefErrors((c) => ({ ...c, [pattern]: false }));
      } catch {
        // A failed card fetch is not worth an error banner: the pattern list below it still
        // works, and the card is reference material rather than the exercise itself. It IS
        // worth distinguishing from "no card", so the row says so and offers the retry —
        // see the render branch.
        setRefErrors((c) => ({ ...c, [pattern]: true }));
      }
    },
    [list],
  );

  useEffect(() => {
    // `recommended` is list-specific, so a cached card from another list would recommend
    // problems that are not in this one. The error flags go with the cache for the same
    // reason: a failure against one list says nothing about the next.
    setRefs({});
    setRefErrors({});
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
          const cardIsOpen = cardOpen[p.pattern] ?? false;
          /** Fetched and confirmed to have no card — the toggle is then not rendered at all. */
          const noCard = refs[p.pattern] === null;

          return (
            <section key={p.pattern} className={`pattern-block${done ? " done" : ""}`}>
              <button
                className="pattern-head"
                onClick={() => setCollapsed((c) => ({ ...c, [p.pattern]: !isCollapsed }))}
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
                    The reference card is its own disclosure, closed by default, and it is
                    fetched when THAT opens — not when the pattern's problem list opens.

                    The old code fetched on the pattern header's expand, which meant it only
                    fired for a pattern that had been collapsed first: the list starts expanded,
                    so the very first open of the Roadmap rendered "Loading card…" forever and
                    the card only appeared after collapsing and re-expanding the pattern. The
                    fetch now hangs off the thing that actually needs it.

                    The toggle is hidden once the fetch comes back `null`, because a pattern
                    with no card should not offer a control that does nothing.
                  */}
                  {!noCard ? (
                    <button
                      className="pattern-card-toggle"
                      aria-expanded={cardIsOpen}
                      onClick={() => {
                        setCardOpen((c) => ({ ...c, [p.pattern]: !cardIsOpen }));
                        // Fetch on the way in, once. `in refs` covers both a real card and a
                        // confirmed absence, so neither is requested twice.
                        if (!cardIsOpen && !(p.pattern in refs) && !refErrors[p.pattern]) {
                          void loadRef(p.pattern);
                        }
                      }}
                    >
                      <span className="caret">{cardIsOpen ? "▾" : "▸"}</span> Reference card
                    </button>
                  ) : null}

                  {cardIsOpen ? (
                    refErrors[p.pattern] ? (
                      <div className="pattern-ref muted small">
                        Card unavailable —{" "}
                        <button
                          className="tiny"
                          onClick={() => {
                            // Clear the flag before re-requesting so the row goes back to the
                            // pending line rather than sitting on the error while the retry runs.
                            setRefErrors((c) => ({ ...c, [p.pattern]: false }));
                            void loadRef(p.pattern);
                          }}
                        >
                          retry
                        </button>
                      </div>
                    ) : refs[p.pattern] ? (
                      <PatternCard card={refs[p.pattern]!} onOpen={onOpen} />
                    ) : (
                      <div className="pattern-ref muted small">Loading card…</div>
                    )
                  ) : null}

                  {p.problems.map((pr) => (
                    <Row
                      key={pr.qid}
                      className={pr.solved ? "solved" : ""}
                      onClick={() => onOpen(pr.slug)}
                    >
                      <span className="qid">{pr.qid}</span>
                      <span className="title">{pr.title}</span>
                      <span className={`badge ${pr.difficulty}`}>{pr.difficulty}</span>
                    </Row>
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
          <Row key={r.slug} onClick={() => onOpen(r.slug)}>
            <span className="title">{r.title}</span>
            <span className={`badge ${r.difficulty}`}>{r.difficulty}</span>
          </Row>
        ))}
      </div>
    </div>
  );
}
