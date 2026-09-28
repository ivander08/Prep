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

/** The measurement span the graticule covers. */
const SCALE_MIN = 1000;
const SCALE_MAX = 1600;

function band(elo: number): { label: string; className: string } {
  if (elo < 1150) return { label: "weak", className: "weak" };
  if (elo < 1300) return { label: "developing", className: "developing" };
  if (elo < 1450) return { label: "solid", className: "solid" };
  return { label: "strong", className: "strong" };
}

/**
 * The mastery graticule — the one element this interface should be remembered by.
 *
 * A bare Elo number means nothing without a reference. Plotting it as a position on a
 * fixed 1000-1600 span makes "weak" and "strong" legible at a glance, and the tick marks
 * give the eye something to compare against down the column. Instruments solve this
 * problem with a scale; so does this.
 */
function Graticule({ elo }: { elo: number }) {
  const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, elo));
  const pct = ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  const b = band(elo);

  return (
    <div className="scale-wrap">
      <div className="scale">
        <span className="floor" />
        <span className={`mark ${b.className}`} style={{ left: `${pct}%` }} />
      </div>
      <div className="scale-legend">
        <span>1000</span>
        <span>1300</span>
        <span>1600</span>
      </div>
    </div>
  );
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

      <div className="readout">
        <div className="cell">
          <span className="k">Solved</span>
          <span className="v">{stats.solvedDistinct}</span>
        </div>
        <div className="cell">
          <span className="k">Unaided</span>
          <span className="v pass">{stats.unaided}</span>
        </div>
        <div className="cell">
          <span className="k">With hints</span>
          <span className="v">{stats.withHints}</span>
        </div>
        <div className="cell">
          <span className="k">Patterns</span>
          <span className="v">{stats.patternsTouched}</span>
        </div>
        <div className="cell">
          <span className="k">Tutor spend</span>
          <span className="v signal">
            {stats.totalTutorCost.toFixed(2)}
            <span className="unit">IDR</span>
          </span>
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
              <span>strength</span>
              <span>elo</span>
              <span>solved</span>
              <span>hint rate</span>
              <span>lapses</span>
            </div>
            {patterns.map((p) => {
              const b = band(p.elo);
              return (
                <div key={p.pattern} className="tr mastery">
                  <span>
                    {p.pattern}
                    <span className={`state-tag ${b.className}`}> · {b.label}</span>
                  </span>
                  <Graticule elo={p.elo} />
                  <span className="mono" data-label="elo">{Math.round(p.elo)}</span>
                  <span className="mono" data-label="solved">
                    {p.solved}/{p.attempts}
                  </span>
                  <span className="mono" data-label="hints">{(p.hintRate * 100).toFixed(0)}%</span>
                  <span className="mono" data-label="lapses">{p.lapses > 0 ? p.lapses : "—"}</span>
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
                <span className="mono" data-label="attempts">{h.totalAttempts}</span>
                <span className="mono" data-label="hinted">{h.attemptsWithHints}</span>
                <span className="mono" data-label="unaided">{h.unaidedSolves}</span>
                <span className="mono" data-label="rate">{(h.hintRate * 100).toFixed(0)}%</span>
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
