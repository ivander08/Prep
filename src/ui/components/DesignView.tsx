import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  DIMENSION_LABEL,
  DIMENSION_PROBES,
  type DesignConceptDetail,
  type DesignConceptGroups,
  type DesignConceptSummary,
  type DesignPhase,
  type DesignPromptSummary,
  type DesignSession,
  type DesignScores,
  type DesignSignals,
  type DesignTranscriptEntry,
  type DesignTurnResult,
  type RubricDimension,
  type SketchShape,
} from "../api";
import { formatElapsed, isOverLimit, useStopwatchVisible } from "./Stopwatch";
import { Markdown } from "./Markdown";
import { SketchPad } from "./SketchPad";
import { Row } from "./Row";

/**
 * The system-design round.
 *
 * Shaped like `FundamentalsView` (list left, work right): the same activity, so `.workspace`
 * is reused for one layout language.
 *
 * The phase strip is guidance, not a gate. Published descriptions agree on the five phases
 * and their order but not on the minute allocations, so the timer counts up against the
 * phase's soft budget and turns amber when it runs over. The candidate moves on by writing
 * the next phase's draft; the server derives the phase from the drafts that exist, so the
 * probe ceiling is unmoveable by anything typed into the chat box.
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

export function DesignView({
  onBuild,
  initialSlug = null,
}: {
  onBuild: (slug: string) => void;
  /** Set by a due row, so the prompt scheduled for review opens directly. */
  initialSlug?: string | null;
}) {
  const [prompts, setPrompts] = useState<DesignPromptSummary[]>([]);
  const [session, setSession] = useState<DesignSession | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  /**
   * The view's two modes.
   *
   * The concept library is a second mode of this view, not a nav entry of its own: it is the
   * reference material for the round, so it belongs beside the round, and a candidate who has
   * just been told their trade-off reasoning was weak should land in it without hunting.
   */
  const [mode, setMode] = useState<"rounds" | "concepts">("rounds");
  const [groups, setGroups] = useState<DesignConceptGroups | null>(null);
  const [conceptSlug, setConceptSlug] = useState<string | null>(null);
  const [concept, setConcept] = useState<DesignConceptDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [scores, setScores] = useState<DesignScores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [showTimer, setShowTimer] = useStopwatchVisible();
  const [sketch, setSketch] = useState<SketchShape[]>([]);
  const scroller = useRef<HTMLDivElement | null>(null);
  /**
   * A once-per-second tick, so the elapsed counters actually advance.
   *
   * Wall-clock delta, matching `Stopwatch`: a throttled background tab must not make the phase
   * clock drift behind real time.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * When the current phase began, for the per-phase guidance clock.
   *
   * Reset on an actual phase change. Deriving it by subtracting the earlier phases' nominal
   * budgets would clamp the clock to zero for anyone who wrote the requirements in less than
   * five minutes, which is most people and the candidate the guidance is for.
   */
  const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());

  /**
   * The slug the pending target already opened.
   *
   * A ref, not state, because it exists only to stop the bridge firing twice for the same slug
   * and re-rendering to record that would be a render for a bookkeeping detail.
   */
  const bridged = useRef<string | null>(null);

  /**
   * Load the prompt list, then resume the round that is still in progress.
   *
   * The resume is what makes `/draft` persistence observable: a reload is the one event that
   * would lose an unfinished round, and without this the server-side draft is written and
   * never read back. It runs after the prompt list so the round has a title to render against.
   *
   * A pending target from a due row is started at the end, and only when the resume found no
   * open round. It is sequenced inside this effect because two effects on mount would race,
   * and the slug could overwrite the resumed round or start a second session.
   */
  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ prompts: DesignPromptSummary[] }>("/api/design");
        setPrompts(r.prompts);
      } catch (e) {
        setError(String(e));
      }

      let resumed = false;
      try {
        const open = await api<{ session: DesignSession | null }>("/api/design/resume");
        if (open.session) {
          resumed = true;
          hydrate(open.session);
        }
      } catch {
        // A failed resume is not worth an error banner: the prompt list still works, and the
        // candidate can start a fresh round.
      }

      if (initialSlug && !resumed && bridged.current !== initialSlug) {
        bridged.current = initialSlug;
        void start(initialSlug);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Put a server session into the view.
   *
   * The transcript is rebuilt from the stored entries, not kept only in React state, so a
   * restored round shows the conversation it actually had, including the fact that a leak was
   * refused, which is the most useful thing the transcript records. The sketch is restored the
   * same way, as shapes, so it is still editable.
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
    // The clock restarts from the server's `started_at`, so the timer reflects the real round,
    // not however long ago the page was opened.
    setStartedAt(new Date(s.startedAt).getTime());
    setScores(null);
    setSketch(s.sketch);
  }, []);

  /**
   * Start a fresh round.
   *
   * A new session per selection: a design round is a timed exercise, and resuming one from
   * three days ago would grade a transcript the candidate no longer remembers writing. Past
   * rounds keep their scores in the table; the exercise starts clean.
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

  /**
   * Load the concept library the first time the Concepts tab is opened.
   *
   * On first switch, not on mount: most visits to this view are for a round, and the library
   * is 61 summaries that would be fetched and thrown away.
   */
  useEffect(() => {
    if (mode !== "concepts" || groups) return;
    void api<DesignConceptGroups>("/api/design/concepts")
      .then(setGroups)
      .catch((e) => setError(String(e)));
  }, [mode, groups]);

  /**
   * Load the selected concept's body.
   *
   * The effect runs off `conceptSlug` so the result panel's links and a prompt chip inside a
   * concept take the same path.
   */
  useEffect(() => {
    if (!conceptSlug) return;
    let cancelled = false;
    setConcept(null);
    api<DesignConceptDetail>(`/api/design/concepts/item?slug=${encodeURIComponent(conceptSlug)}`)
      .then((c) => !cancelled && setConcept(c))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [conceptSlug]);

  /**
   * Switch to the library on a concept.
   *
   * Used by the result panel's "Worth reading" links and by the prompt chips inside a concept,
   * so both are the same in-component mode switch, not a navigation.
   */
  const openConcept = useCallback((slug: string) => {
    setMode("concepts");
    setConceptSlug(slug);
  }, []);

  /** Switch back to the round with a prompt selected. */
  const openPrompt = useCallback(
    (slug: string) => {
      setMode("rounds");
      void start(slug);
    },
    [start],
  );

  /**
   * The most recent draft write, so `finish` can await it.
   *
   * `saveDraft` is fired on blur without awaiting, and `finish` posted independently while the
   * server grades from the STORED drafts. If `finish` won the race the round was graded without the
   * phase just written. `ProseTrackView` already awaits its `saveAnswer` first; this is the same
   * shape.
   */
  const pendingSave = useRef<Promise<void> | null>(null);

  const saveDraft = useCallback(
    async (phase: DesignPhase, text: string) => {
      if (!session) return;
      // The local draft map is updated FIRST, because the phase is derived from it below and
      // `session.drafts` is the server's copy from before this save. Reading that would make
      // the phase strip lag one edit behind the text the candidate just wrote.
      const merged = { ...drafts, [phase]: text };
      setDrafts(merged);

      const write = (async () => {
        try {
          await api(`/api/design/${session.id}/draft`, {
            method: "POST",
            body: JSON.stringify({ phase, text }),
          });
          // The server derives the phase from the drafts too, but this mirrors it locally so the
          // strip updates on blur, not on the next round trip.
          setSession((s) => (s ? { ...s, phase: nextPhaseFrom(merged), drafts: merged } : s));
        } catch (e) {
          setError(String(e));
        }
      })();
      pendingSave.current = write;
      await write;
    },
    [session, drafts],
  );

  /**
   * Persist the sketch as shapes.
   *
   * The parent owns the list, so this both stores it locally and writes it through. Committed
   * once per settled gesture, which keeps a drag from being one request per pointer-move.
   */
  const onSketchChange = useCallback(
    (shapes: SketchShape[]) => {
      setSketch(shapes);
      if (!session) return;
      void api(`/api/design/${session.id}/sketch`, {
        method: "POST",
        body: JSON.stringify({ shapes }),
      }).catch((e) => setError(String(e)));
    },
    [session],
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
      // Flush any draft still in flight before asking the server to grade. Without this the
      // server graded from the drafts it already had, and the phase the candidate had just typed
      // was missing from the score.
      await pendingSave.current;
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

  // Restart the per-phase guidance clock whenever the phase changes, including on resume,
  // where the round is restored into whatever phase its drafts put it in.
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
        {mode === "rounds" ? (
          <>
            A 40-minute design round against an interviewer that will not hand you the design. Write each
            phase, ask when you need to, and finish for a behavioural grade — the same rubric shape the real
            round is scored on.
          </>
        ) : (
          <>
            The concept library: {groups?.total ?? 61} short trade-off notes covering what a design round
            probes. Each one names the probe families it answers, so a weak dimension in a finished round
            points at the note that covers it.
          </>
        )}
      </p>

      <div className="case-tab-strip" style={{ marginBottom: 12 }}>
        <button
          className={`case-tab${mode === "rounds" ? " active" : ""}`}
          onClick={() => setMode("rounds")}
        >
          Rounds
        </button>
        <button
          className={`case-tab${mode === "concepts" ? " active" : ""}`}
          onClick={() => setMode("concepts")}
        >
          Concepts{groups ? ` (${groups.total})` : ""}
        </button>
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      {mode === "concepts" ? (
        <ConceptLibrary
          groups={groups}
          conceptSlug={conceptSlug}
          concept={concept}
          error={error}
          onSelect={setConceptSlug}
          onOpenPrompt={openPrompt}
        />
      ) : (
      <div className="workspace">
        <div className="fundamentals-list">
          <div className="module-head">
            <span>Prompts</span>
            <span className="mono muted small">{prompts.length}</span>
          </div>
          <div className="table" style={{ border: "none" }}>
            {prompts.map((p) => (
              <Row
                key={p.slug}
                className={p.slug === activeSlug ? "active" : ""}
                // Disabled while `busy`: `start` is async, so a double-click issued two
                // session-creation requests before the first resolved.
                disabled={busy}
                onClick={() => void start(p.slug)}
              >
                <span className="qid">·</span>
                <span className="title">{p.title}</span>
              </Row>
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

              {scores ? (
                <ResultsPanel scores={scores} onBuild={onBuild} onOpenConcept={openConcept} />
              ) : null}

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
                    <SketchPad value={sketch} onChange={onSketchChange} />
                  ) : null}
                </div>
              ))}

              <div className="row stack-md">
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
      )}
    </>
  );
}

/**
 * The concept library: groups on the left, the selected note on the right.
 *
 * Laid out on the same `.workspace` grid as the round, because it is the same reading posture
 * (browse left, read right) and a second layout language for one screen would drift from the
 * first.
 */
function ConceptLibrary({
  groups,
  conceptSlug,
  concept,
  error,
  onSelect,
  onOpenPrompt,
}: {
  groups: DesignConceptGroups | null;
  conceptSlug: string | null;
  concept: DesignConceptDetail | null;
  /** Rendered by the parent; passed only so a failed load does not also leave the spinner up. */
  error: string | null;
  onSelect: (slug: string) => void;
  onOpenPrompt: (slug: string) => void;
}) {
  // `error` is rendered by the parent, so a failed load must not also leave the spinner up.
  if (!groups) return error ? null : <div className="spinner">Loading concepts…</div>;


  return (
    <div className="workspace">
      <div className="fundamentals-list bounded">
        {groups.groups.map((g) => (
          <div key={g.group}>
            <div className="module-head">
              <span>{g.label}</span>
              <span className="mono muted small">{g.concepts.length}</span>
            </div>
            <div className="table" style={{ border: "none" }}>
              {g.concepts.map((c: DesignConceptSummary) => (
                <Row
                  key={c.slug}
                  className={c.slug === conceptSlug ? "active" : ""}
                  onClick={() => onSelect(c.slug)}
                >
                  <span className="qid">·</span>
                  <span className="title">
                    {c.title}
                    <span className="muted small sub">
                      {c.summary}
                    </span>
                  </span>
                </Row>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pane">
        {!concept ? (
          <div className="empty">Pick a concept. Each note is a trade-off, not a definition.</div>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>{concept.concept.title}</h2>

            {concept.probes.length > 0 ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="muted small">Answers:</span>
                {concept.probes.map((p, i) =>
                  p ? (
                    <span key={i} className="chip">
                      {p}
                    </span>
                  ) : null,
                )}
              </div>
            ) : null}

            <div className="card">
              <Markdown md={concept.concept.bodyMd} />
            </div>

            {concept.concept.prompts.length > 0 ? (
              <>
                <h3 style={{ marginBottom: 6 }}>Comes up in</h3>
                <div className="row">
                  {concept.concept.prompts.map((slug) => (
                    <button key={slug} className="chip" onClick={() => onOpenPrompt(slug)}>
                      {slug}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Which phase the round is in, given the drafts so far.
 *
 * Mirrors the server's `phaseFromDrafts`: the phase is a pure function of which drafts exist,
 * and a round trip to learn something already derivable would put a network call between a
 * keystroke and the phase strip. The server remains the authority for the ceiling; this only
 * drives the display.
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

function ResultsPanel({
  scores,
  onBuild,
  onOpenConcept,
}: {
  scores: DesignScores;
  onBuild: (slug: string) => void;
  onOpenConcept: (slug: string) => void;
}) {
  /**
   * The concepts covering the round's weakest dimension.
   *
   * Fetched here, not threaded down from the parent, because the result panel can be reached
   * without ever opening the library. Cached per mount is not worth it: a round is finished at
   * most a few times a session.
   */
  const [reading, setReading] = useState<DesignConceptSummary[]>([]);

  const weakest = useMemo(() => {
    let worst = DIMENSIONS[0]!;
    for (const d of DIMENSIONS) {
      if (scores.scores[d].score < scores.scores[worst].score) worst = d;
    }
    return worst;
  }, [scores]);

  const probes = DIMENSION_PROBES[weakest];

  useEffect(() => {
    // `communication` maps to no probe family: the library is engineering content, and no note
    // fixes an unclear explanation, so the section is simply absent.
    if (probes.length === 0) return;
    let cancelled = false;
    void api<DesignConceptGroups>("/api/design/concepts")
      .then((g) => {
        if (cancelled) return;
        const all = g.groups.flatMap((x) => x.concepts);
        setReading(all.filter((c) => c.probeFamilies.some((i) => probes.includes(i))).slice(0, 4));
      })
      .catch(() => {
        // A failed lookup removes the suggestion, not the round's grade. The result panel is the
        // thing the candidate came for.
      });
    return () => {
      cancelled = true;
    };
  }, [probes]);

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

      {reading.length > 0 ? (
        <>
          <h3 style={{ marginBottom: 4 }}>Worth reading</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Concepts that cover {DIMENSION_LABEL[weakest].toLowerCase()}, the dimension this round scored
            lowest on.
          </p>
          <div className="table">
            {reading.map((c) => (
              <Row key={c.slug} onClick={() => onOpenConcept(c.slug)}>
                <span className="title">
                  {c.title}
                  <span className="muted small sub">
                    {c.summary}
                  </span>
                </span>
              </Row>
            ))}
          </div>
        </>
      ) : null}

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
