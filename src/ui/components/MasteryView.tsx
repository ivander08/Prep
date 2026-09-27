import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type MasteryRow = {
  pattern: string;
  elo: number;
  attempts: number;
  solved: number;
  hintRate: number;
  lapses: number;
  expectedVsMedium: number;
};

type HintRow = {
  pattern: string;
  totalAttempts: number;
  attemptsWithHints: number;
  unaidedSolves: number;
  hintRate: number;
};

type Stats = {
  attempts: number;
  solvedDistinct: number;
  unaided: number;
  withHints: number;
  patternsTouched: number;
  totalTutorCost: number;
};

type MasteryResponse = { patterns: MasteryRow[]; hintDependence: HintRow[]; stats: Stats };

/** Elo rendered as a band, since the number itself means little without a reference. */
function band(elo: number): { label: string; className: string } {
  if (elo < 1150) return { label: "weak", className: "weak" };
  if (elo < 1300) return { label: "developing", className: "developing" };
  if (elo < 1450) return { label: "solid", className: "solid" };
  return { label: "strong", className: "strong" };
}

/**
 * Mastery + weakness view.
 *
 * Ordered weakest-first on purpose: the useful question is "what should I work on", not
 * "what am I good at". Hint dependence is shown alongside because a pattern can look
 * solved while every solve needed help.
 */
export function MasteryView() {
  const [data, setData] = useState<MasteryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MasteryResponse>("/api/mastery"));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return <div className="spinner">Computing mastery…</div>;

  const { patterns, hintDependence, stats } = data;

  return (
    <>
      <h1>Weakness</h1>
      <p className="muted">
        Mastery is an Elo per pattern, driven by what you actually did: whether the tests passed, how many
        hints you used, and whether a re-solve failed. A pattern you have never attempted does not appear.
      </p>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat">
          <div className="n">{stats.solvedDistinct}</div>
          <div className="k">problems solved</div>
        </div>
        <div className="stat">
          <div className="n">{stats.unaided}</div>
          <div className="k">unaided solves</div>
        </div>
        <div className="stat">
          <div className="n">{stats.withHints}</div>
          <div className="k">attempts with hints</div>
        </div>
        <div className="stat">
          <div className="n">{stats.patternsTouched}</div>
          <div className="k">patterns touched</div>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="card muted" style={{ marginTop: 18 }}>
          No graded attempts yet. Solve something and this fills in.
        </div>
      ) : (
        <>
          <h2>By pattern — weakest first</h2>
          <div className="table">
            <div className="tr th mastery">
              <span>pattern</span>
              <span>elo</span>
              <span>state</span>
              <span>solved</span>
              <span>hint rate</span>
              <span>lapses</span>
            </div>
            {patterns.map((p) => {
              const b = band(p.elo);
              return (
                <div key={p.pattern} className="tr mastery">
                  <span>{p.pattern}</span>
                  <span className="mono">{Math.round(p.elo)}</span>
                  <span>
                    <span className={`pill ${b.className}`}>{b.label}</span>
                  </span>
                  <span className="mono">
                    {p.solved}/{p.attempts}
                  </span>
                  <span className="mono">{(p.hintRate * 100).toFixed(0)}%</span>
                  <span className="mono">{p.lapses > 0 ? p.lapses : "—"}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {hintDependence.length > 0 ? (
        <>
          <h2>Hint dependence</h2>
          <p className="muted small">
            Patterns where you solve with help. Not automatically bad early on — but a solve you needed help
            for is not one you can reproduce in an interview.
          </p>
          <div className="table">
            <div className="tr th hintdep">
              <span>pattern</span>
              <span>attempts</span>
              <span>with hints</span>
              <span>unaided solves</span>
              <span>rate</span>
            </div>
            {hintDependence.map((h) => (
              <div key={h.pattern} className="tr hintdep">
                <span>{h.pattern}</span>
                <span className="mono">{h.totalAttempts}</span>
                <span className="mono">{h.attemptsWithHints}</span>
                <span className="mono">{h.unaidedSolves}</span>
                <span className="mono">{(h.hintRate * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <p className="muted small" style={{ marginTop: 16 }}>
        Tutor spend so far: ~Rp {stats.totalTutorCost.toFixed(2)} (estimated from published rates).
      </p>
    </>
  );
}
