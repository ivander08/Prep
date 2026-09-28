import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  DIMENSION_LABEL,
  type DesignPhase,
  type DesignPromptSummary,
  type DesignSession,
  type DesignScores,
  type DesignSignals,
  type DesignTranscriptEntry,
  type DesignTurnResult,
  type RubricDimension,
} from "../api";
import { formatElapsed, isOverLimit, useStopwatchVisible } from "./Stopwatch";
import { Markdown } from "./Markdown";
import { SketchPad } from "./SketchPad";

/**
 * The system-design round.
 *
 * Shaped like `FundamentalsView` — prompt list on the left, work on the right — because it is
 * the same activity: pick an exercise, do the work, get a verdict. Reusing `.workspace`
 * means one layout language across the app rather than a second set that drifts.
 *
 * THE PHASE STRIP IS GUIDANCE, NOT A GATE. Every published description of the round agrees on
 * the five phases and their order; none agree on the minute allocations. So the timer counts
 * up against the phase's soft budget and turns amber when it runs over, and the candidate
 * moves on by writing the next phase's draft. The server derives the phase from which drafts
 * exist, which is what makes the probe ceiling unmoveable by anything the candidate types
 * into the chat box.
 */

const PHASES: Array<{ id: DesignPhase; label: string; minutes: number; hint: string }> = [
  {
    id: "requirements",
    label: "Requirements",
    minutes: 5,
    hint: "Ask what the system must do, and what constrains it. The interviewer will confirm what you ask about and volunteer nothing.",
  },
  {
    id: "estimation",
    label: "Estimation",
    minutes: 5,
    hint: "Quantify. Write the working, not just the number — a figure with no derivation is a guess.",
  },
  {
    id: "highlevel",
    label: "High-level design",
    minutes: 13,
    hint: "Name the components and the request flow between them. One box per responsibility.",
  },
  {
    id: "deepdive",
    label: "Deep dive",
    minutes: 13,
    hint: "Pick the parts that are actually hard and go into them: the schema, the partitioning, the failure modes.",
  },
  {
    id: "wrapup",
    label: "Trade-offs",
    minutes: 4,
    hint: "Say what you gave up and why, and what you would do differently with more time.",
  },
];

type Entry = { kind: "candidate"; text: string } | { kind: "turn"; turn: DesignTurnResult };

export function DesignView({ onBuild }: { onBuild: (slug: string) => void }) {
  const [prompts, setPrompts] = useState<DesignPromptSummary[]>([]);
  const [session, setSession] = useState<DesignSession | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [scores, setScores] = useState<DesignScores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [showTimer, setShowTimer] = useStopwatchVisible();
  const [sketchPng, setSketchPng] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  /**
   * A once-per-second tick, so the elapsed counters actually advance.
   *
   * Wall-clock delta rather than an incrementing counter, matching `Stopwatch`: a throttled
   * background tab must not make the phase clock drift behind real time.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * When the current phase began, for the per-phase guidance clock.
   *
   * Reset on an actual phase CHANGE rather than derived from the total elapsed time. Deriving
   * it by subtracting the earlier phases' nominal budgets would clamp the clock to zero for
   * anyone who wrote the requirements in less than five minutes — which is most people, and
   * exactly the candidate the guidance is for.
   */
  const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());

  /**
   * Load the prompt list, then resume the round that is still in progress.
   *
   * The resume is what makes `/draft` persistence observable: a reload is the one event that
   * would lose an unfinished round, and without this the server-side draft is written and
   * never read back. It runs after the prompt list so the round has a title to render against.
   */
  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ prompts: DesignPromptSummary[] }>("/api/design");
        setPrompts(r.prompts);
      } catch (e) {
        setError(String(e));
      }

      try {
        const open = await api<{ session: DesignSession | null }>("/api/design/resume");
        if (open.session) hydrate(open.session);
      } catch {
        // A failed resume is not worth an error banner: the prompt list still works, and the
        // candidate can start a fresh round.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Put a server session into the view.
   *
   * The transcript is rebuilt from the stored entries rather than being kept only in React
   * state, so a restored round shows the conversation it actually had — including the fact
   * that a leak was refused, which is the most useful thing the transcript records.
   */
  const hydrate = useCallback((s: DesignSession) => {
    setActiveSlug(s.slug);
    setSession(s);
    setDrafts(s.drafts);
    setEntries(
      s.transcript.map((e) =>
        e.role === "candidate"
          ? { kind: "candidate" as const, text: e.text }
          : {
              kind: "turn" as const,
              turn: {
                message: e.text,
                phase: s.phase,
                probeLevel: e.probe ?? 0,
                probeName: e.probeName ?? null,
                ceiling: 0,
                reason: "",
                withheld: e.withheld ?? false,
                rejectionNote: null,
                model: "",
                costIdr: 0,
                repaired: false,
              },
            },
      ),
    );
    // The clock restarts from the server's `started_at`, so the timer reflects the real round
    // rather than however long ago the page was opened.
    setStartedAt(new Date(s.startedAt).getTime());
    setScores(null);
    setSketchPng(null);
  }, []);

  /**
   * Start a fresh round.
   *
   * A new session per selection rather than resuming a previous one: a design round is a
   * timed exercise, and resuming one from three days ago would grade a transcript the
   * candidate no longer remembers writing. Past rounds keep their scores in the table; the
   * exercise starts clean.
   */
  const start = useCallback(
    async (slug: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ sessionId: number; session: DesignSession }>("/api/design/start", {
          method: "POST",
          body: JSON.stringify({ slug }),
        });
        hydrate(r.session);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [hydrate],
  );

  const saveDraft = useCallback(
    async (phase: DesignPhase, text: string) => {
      if (!session) return;
      // The local draft map is updated FIRST, because the phase is derived from it below and
      // `session.drafts` is the server's copy from before this save — reading that would make
      // the phase strip lag one edit behind the text the candidate just wrote.
      const merged = { ...drafts, [phase]: text };
      setDrafts(merged);

      try {
        await api(`/api/design/${session.id}/draft`, {
          method: "POST",
          body: JSON.stringify({ phase, text }),
        });
        // The server derives the phase from the drafts too, but this mirrors it locally so the
        // strip updates on blur rather than on the next round trip.
        setSession((s) => (s ? { ...s, phase: nextPhaseFrom(merged), drafts: merged } : s));
      } catch (e) {
        setError(String(e));
      }
    },
    [session, drafts],
  );

  /**
   * Persist the sketch alongside the high-level draft.
   *
   * Keyed off the session id rather than off `drafts`, because the sketch is committed on
   * pointer-up and the current textarea value may not have been blurred yet — reading
   * `drafts.highlevel` here would save a stale body with a fresh image.
   */
  const onSketchCommit = useCallback(
    (png: string | null) => {
      if (!session) return;
      void api(`/api/design/${session.id}/draft`, {
        method: "POST",
        body: JSON.stringify({ phase: "highlevel", text: drafts.highlevel ?? "", sketchPng: png }),
      }).catch((e) => setError(String(e)));
    },
    [session, drafts.highlevel],
  );

  const ask = useCallback(async () => {
    if (!session || busy) return;
    const message = draft.trim();
    setBusy(true);
    setError(null);
    setDraft("");
    if (message.length > 0) setEntries((e) => [...e, { kind: "candidate", text: message }]);

    try {
      const r = await api<{ turn: DesignTurnResult; session: DesignSession }>(
        `/api/design/${session.id}/turn`,
        { method: "POST", body: JSON.stringify({ message }) },
      );
      setEntries((e) => [...e, { kind: "turn", turn: r.turn }]);
      setSession(r.session);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [session, busy, draft]);

  const finish = useCallback(async () => {
    if (!session || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const r = await api<DesignScores>(`/api/design/${session.id}/finish`, { method: "POST" });
      setScores(r);
      setSession((s) => (s ? { ...s, endedAt: new Date().toISOString() } : s));
    } catch (e) {
      setError(String(e));
    } finally {
      setFinishing(false);
    }
  }, [session, finishing]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  // Restart the per-phase guidance clock whenever the phase actually changes — including on
  // resume, where the round is restored into whatever phase its drafts put it in.
  const phaseId = session?.phase ?? "requirements";
  useEffect(() => {
    setPhaseStartedAt(Date.now());
  }, [phaseId]);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const phaseIndex = useMemo(
    () => PHASES.findIndex((p) => p.id === (session?.phase ?? "requirements")),
    [session],
  );
  const phase = PHASES[phaseIndex] ?? PHASES[0]!;
  const phaseElapsed = Math.max(0, Math.floor((now - phaseStartedAt) / 1000));

  return (
    <>
      <div className="spread">
        <h1>Design</h1>
        <div className="row">
          {session ? (
            <>
              <span className={`mono small ${isOverLimit(phaseElapsed, phase.minutes * 60) ? "over" : "muted"}`}>
                {phase.label} {formatElapsed(phaseElapsed)} / {phase.minutes}m
              </span>
              <span className="mono muted small">total {formatElapsed(elapsed)}</span>
              <button className="tiny" onClick={() => setShowTimer(!showTimer)}>
                {showTimer ? "Hide" : "Show"} timer
              </button>
            </>
          ) : null}
        </div>
      </div>

      <p className="muted">
        A 40-minute design round against an interviewer that will not hand you the design. Write each
        phase, ask when you need to, and finish for a behavioural grade — the same rubric shape the real
        round is scored on.
      </p>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="workspace">
        <div className="fundamentals-list">
          <div className="module-head">
            <span>Prompts</span>
            <span className="mono muted small">{prompts.length}</span>
          </div>
          <div className="table" style={{ border: "none" }}>
            {prompts.map((p) => (
              <div
                key={p.slug}
                className={`problem-row${p.slug === activeSlug ? " active" : ""}`}
                onClick={() => void start(p.slug)}
              >
                <span className="qid">·</span>
                <span className="title">{p.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pane">
          {!session ? (
            <div className="empty">
              Pick a prompt to start a round. The interviewer will not volunteer requirements — asking is
              the first thing being graded.
            </div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{session.title}</h2>
              <div className="card">
                <Markdown md={session.statement} />
              </div>

              <div className="phase-strip">
                {PHASES.map((p, i) => (
                  <div
                    key={p.id}
                    className={`phase${i === phaseIndex ? " active" : ""}${i < phaseIndex ? " done" : ""}`}
                    title={p.hint}
                  >
                    <span className="phase-name">{p.label}</span>
                    <span className="phase-time">{p.minutes}m</span>
                  </div>
                ))}
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>{phase.hint}</p>

              {scores ? <ResultsPanel scores={scores} onBuild={onBuild} /> : null}

              {PHASES.map((p) => (
                <div key={p.id} className="design-field">
                  <label className="design-label" htmlFor={`phase-${p.id}`}>
                    {p.label}
                    {p.id === phase.id ? <span className="muted small"> · current</span> : null}
                  </label>
                  <textarea
                    id={`phase-${p.id}`}
                    className="design-textarea"
                    value={drafts[p.id] ?? ""}
                    placeholder={p.hint}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onBlur={(e) => void saveDraft(p.id, e.target.value)}
                  />
                  {p.id === "highlevel" ? (
                    <SketchPad onChange={setSketchPng} onCommit={onSketchCommit} />
                  ) : null}
                </div>
              ))}

              <div className="row" style={{ marginTop: 14 }}>
                <button className="primary" onClick={() => void finish()} disabled={finishing || busy}>
                  {finishing ? "Grading…" : "Finish and grade"}
                </button>
                <span className="muted small">
                  Grading reads your drafts and the transcript. Every score must quote you.
                </span>
              </div>

              <h2>Interviewer</h2>
              <div className="tutor">
                <div className="spread tutor-head">
                  <div className="row">
                    <span className="ceiling-chip" title={session.phase}>
                      probe ≤ {session.probeLevel}
                    </span>
                    <span className="muted small">
                      {session.probesAsked} probe{session.probesAsked === 1 ? "" : "s"} so far
                    </span>
                  </div>
                  <span className="mono muted small">
                    {entries.filter((e) => e.kind === "turn").length} turn(s)
                  </span>
                </div>

                <div className="tutor-log" ref={scroller}>
                  {entries.length === 0 ? (
                    <div className="muted small" style={{ padding: "10px 2px" }}>
                      Ask a question, or state a requirement you want confirmed. The interviewer will not
                      name components before the high-level phase, no matter how you ask.
                    </div>
                  ) : null}

                  {entries.map((e, i) =>
                    e.kind === "candidate" ? (
                      <div key={i} className="msg student">
                        <span className="msg-role">you</span>
                        <div>{e.text}</div>
                      </div>
                    ) : (
                      <div key={i} className={`msg tutor${e.turn.withheld ? " refused" : ""}`}>
                        <span className="msg-role">
                          interviewer
                          {e.turn.probeName ? ` · ${e.turn.probeName}` : ""}
                          {e.turn.withheld ? " · withheld" : ""}
                        </span>
                        <div>{e.turn.message}</div>
                        {e.turn.rejectionNote ? (
                          <div className="muted small" style={{ marginTop: 4 }}>
                            {e.turn.rejectionNote}
                          </div>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>

                <div className="tutor-input">
                  <textarea
                    value={draft}
                    placeholder="Ask the interviewer something, or confirm a requirement…"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void ask();
                      }
                    }}
                  />
                  <button className="primary" onClick={() => void ask()} disabled={busy}>
                    {busy ? "…" : "Ask"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Which phase the round is in, given the drafts so far.
 *
 * Mirrors the server's `phaseFromDrafts` rather than asking it: the phase is a pure function of
 * which drafts exist, and a round trip to learn something already derivable would put a network
 * call between a keystroke and the phase strip. The server remains the authority for the
 * ceiling; this only drives the display.
 */
function nextPhaseFrom(drafts: Record<string, string>): DesignPhase {
  for (const p of ["requirements", "estimation", "highlevel", "deepdive"] as DesignPhase[]) {
    if ((drafts[p] ?? "").trim().length === 0) return p;
  }
  return "wrapup";
}

const DIMENSIONS: RubricDimension[] = [
  "problemFraming",
  "systemsThinking",
  "technicalDepth",
  "tradeoffReasoning",
  "communication",
];

function ResultsPanel({ scores, onBuild }: { scores: DesignScores; onBuild: (slug: string) => void }) {
  return (
    <div className="design-results">
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Round result</h2>
        <span className={`badge ${scores.grade >= 3 ? "Easy" : scores.grade === 2 ? "Medium" : "Hard"}`}>
          {scores.grade >= 4 ? "Strong" : scores.grade === 3 ? "Meets expectations" : scores.grade === 2 ? "Approaching" : "Below expectations"}
        </span>
      </div>
      <p className="muted">{scores.summary}</p>

      {scores.nextDue ? (
        <div className="notice info">
          Scheduled for review in <strong>{scores.intervalDays} day{scores.intervalDays === 1 ? "" : "s"}</strong>{" "}
          ({new Date(scores.nextDue).toLocaleDateString()}). A round that scores below the bottom band is
          not scheduled — there is no design to come back to yet.
        </div>
      ) : (
        <div className="notice warn">
          Not scheduled for review: a round with a dimension at the bottom of the scale is not evidence of a
          design worth revisiting.
        </div>
      )}

      <div className="table">
        {DIMENSIONS.map((d) => {
          const s = scores.scores[d];
          return (
            <div key={d} className="dimension-row">
              <span className="dimension-name">{DIMENSION_LABEL[d]}</span>
              <span className={`dimension-score s${s.score}`}>{s.score}/4</span>
              <span className="dimension-evidence">
                {s.evidence ? (
                  <em>“{s.evidence}”</em>
                ) : (
                  <span className="muted">no quote — scored from the mechanical signals</span>
                )}
                {s.source === "signal" && s.evidence ? (
                  <span className="muted small"> · signal-derived ({s.signalScore}/4)</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <SignalList signals={scores.signals} />

      {scores.componentSlug ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => onBuild(scores.componentSlug!)}>
            Build the component you just designed
          </button>
          <span className="muted small">
            The same prompt, implemented and graded by tests instead of prose.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The mechanical signals, each with the words that fired it. */
function SignalList({ signals }: { signals: DesignSignals }) {
  const rows: Array<{ label: string; on: boolean; words: string[] }> = [
    { label: "Asked about functional requirements", on: signals.askedFunctional, words: signals.matched.functional },
    { label: "Asked about non-functional requirements", on: signals.askedNonFunctional, words: signals.matched.nonFunctional },
    { label: `Quantified the design (${signals.estimateCount})`, on: signals.estimateCount > 0, words: signals.matched.estimates },
    { label: `Named components (${signals.componentCount})`, on: signals.componentCount > 0, words: signals.matched.components },
    { label: `Stated trade-offs (${signals.tradeoffCount})`, on: signals.tradeoffCount > 0, words: signals.matched.tradeoffs },
    { label: "Named a failure mode unprompted", on: signals.namesFailure, words: signals.matched.failure },
  ];

  return (
    <>
      <h2>What the text shows</h2>
      <p className="muted small">
        Computed from your drafts without a model call. These are what the scores are anchored to — a score
        the model could not quote you for falls back to these.
      </p>
      <div className="table">
        {rows.map((r) => (
          <div key={r.label} className="signal-row">
            <span className={`signal-mark ${r.on ? "on" : "off"}`}>{r.on ? "✓" : "·"}</span>
            <span className="signal-label">{r.label}</span>
            <span className="muted small signal-words">
              {r.words.length > 0 ? r.words.slice(0, 8).join(", ") : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export type { DesignTranscriptEntry };
