import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

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
};

const LISTS = ["neetcode150", "neetcode250", "blind75", "neetcodeAll", "leetcode75", "topInterview150"] as const;

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

  const load = useCallback(async (name: string) => {
    try {
      const r = await api<{ patterns: RoadmapPattern[] }>(`/api/roadmap?list=${name}`);
      setPatterns(r.patterns);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
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
                onClick={() => setCollapsed((c) => ({ ...c, [p.pattern]: !isCollapsed }))}
              >
                <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
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
