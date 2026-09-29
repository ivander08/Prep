import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  GRADE_LABEL,
  TRACK_DIMENSIONS,
  TRACK_DIMENSION_LABEL,
  type ProsePrompt,
  type ProsePromptGroup,
  type TrackGradeResult,
  type TrackSession,
} from "../api";
import { Markdown } from "./Markdown";
import { Row } from "./Row";

/**
 * A prose track: prompt list on the left, answer on the right.
 *
 * ONE component for both the behavioral and the stack track, because the two differ only in
 * which catalogue and which endpoint they read. The layout, the resume behaviour, the grading
 * display and the empty states are identical; a second copy would be the same 200 lines with
 * the strings changed, and the two would drift the first time one of them was fixed.
 *
 * The layout reuses `.workspace` + `.fundamentals-list` + `.pane` — the same grid every other
 * track uses — so there is one layout language across the app rather than a second set.
 *
 * The answer is a `<textarea>` and not the code editor: this is prose, and the editor's
 * bracket matching, lint gutter and language mode would all be noise around it. It reuses
 * `.design-textarea`, which is already the app's monospace prose field.
 */
export function ProseTrackView({
  kind,
  onSolved,
}: {
  kind: "behavioral" | "stack";
  onSolved: () => void;
}): React.JSX.Element {
  const [groups, setGroups] = useState<ProsePromptGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [session, setSession] = useState<TrackSession | null>(null);
  const [prompt, setPrompt] = useState<ProsePrompt | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<TrackGradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The slug the user last clicked, so the list can highlight it before the session arrives. */
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const label = kind === "behavioral" ? "Behavioral" : "Stack";

  /**
   * Load the prompt list, then resume the attempt still in progress.
   *
   * The resume is what makes the draft persistence observable: a reload is the one event that
   * would lose an unfinished answer, and without this the server-side draft is written and
   * never read back. It runs after the list so the pane has a prompt to render against.
   */
  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ groups: ProsePromptGroup[]; total: number }>(`/api/tracks/${kind}`);
        setGroups(r.groups);
        setTotal(r.total);
      } catch (e) {
        setError(String(e));
      }
      try {
        const open = await api<{ session: TrackSession | null }>(`/api/tracks/${kind}/resume`);
        if (open.session) void hydrate(open.session);
      } catch {
        // A failed resume is not worth an error banner: the prompt list still works and a
        // fresh attempt can be started.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  /**
   * Put a server session into the view.
   *
   * The prompt's answer key is fetched alongside the session rather than being threaded in
   * from the list, because the list deliberately does not carry it — see the endpoint.
   */
  const hydrate = useCallback(
    async (s: TrackSession) => {
      setSession(s);
      setActiveSlug(s.slug);
      setAnswer(s.answerMd);
      setResult(null);
      try {
        const p = await api<{ prompt: ProsePrompt }>(`/api/tracks/${kind}/item?slug=${encodeURIComponent(s.slug)}`);
        setPrompt(p.prompt);
      } catch (e) {
        setError(String(e));
      }
    },
    [kind],
  );

  /**
   * Start a fresh attempt at a prompt.
   *
   * A new session per selection rather than resuming a previous one: the answer is graded on
   * the draft that exists when Finish is pressed, and resuming a three-day-old draft would
   * grade text the candidate no longer remembers writing.
   */
  const start = useCallback(
    async (slug: string) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const r = await api<{ sessionId: number; session: TrackSession }>(`/api/tracks/${kind}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        setActiveSlug(slug);
        setSession(r.session);
        setAnswer("");
        const p = await api<{ prompt: ProsePrompt }>(`/api/tracks/${kind}/item?slug=${encodeURIComponent(slug)}`);
        setPrompt(p.prompt);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [kind],
  );

  /** Persist the draft on blur, so a reload or a crash does not lose the answer. */
  const saveAnswer = useCallback(
    async (text: string) => {
      if (!session) return;
      try {
        await api(`/api/tracks/${kind}/${session.id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answerMd: text }),
        });
      } catch {
        // A failed autosave is not worth interrupting the writer. The text is still in the
        // textarea, and the Finish call sends the current value anyway.
      }
    },
    [kind, session],
  );

  const finish = useCallback(async () => {
    if (!session) return;
    setGrading(true);
    setError(null);
    try {
      // The current textarea value is saved first: blur is not guaranteed to have fired (the
      // button can be clicked while the field still has focus), and grading the stored draft
      // rather than what is on screen would grade stale text.
      await saveAnswer(answer);
      const r = await api<TrackGradeResult>(`/api/tracks/${kind}/${session.id}/finish`, { method: "POST" });
      setResult(r);
      onSolved();
    } catch (e) {
      // A 502 from the grader leaves the session ungraded, so the answer is intact and the
      // button can simply be pressed again. The message says so.
      setError(String(e));
    } finally {
      setGrading(false);
    }
  }, [answer, kind, onSolved, saveAnswer, session]);

  const wordCount = useMemo(() => answer.trim().split(/\s+/).filter(Boolean).length, [answer]);

  return (
    <>
      <h1>{label}</h1>
      <p className="muted">
        {kind === "behavioral"
          ? "Answer these in writing. The grade is derived from the answer's structure and specificity — a situation, what you did, and what changed — not from how the story feels."
          : "Answer these in writing. The grade is derived from whether the mechanism is named correctly and the diagnosis is concrete — not from how confident the writing sounds."}
      </p>

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="workspace">
        <div className="fundamentals-list bounded">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="module-head">
                <span>{g.label}</span>
                <span className="mono muted small">{g.prompts.length}</span>
              </div>
              <div className="table" style={{ border: "none" }}>
                {g.prompts.map((p) => (
                  <Row
                    key={p.slug}
                    className={p.slug === activeSlug ? "active" : ""}
                    onClick={() => void start(p.slug)}
                  >
                    <span className="qid">·</span>
                    <span className="title">
                      {p.title}
                      <span className="muted small sub">{p.summary}</span>
                    </span>
                  </Row>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && !error ? <div className="spinner">Loading prompts…</div> : null}
        </div>

        <div className="pane">
          {!session || !prompt ? (
            <div className="empty">
              Pick a prompt to start. The answer is graded against what a strong answer contains, so
              say what you did and what changed — not what you would generally do.
            </div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{prompt.title}</h2>
              <div className="card">
                <Markdown md={prompt.statement} />
              </div>

              {result ? <TrackResults result={result} /> : null}

              <div className="design-field">
                <label className="design-label" htmlFor="track-answer">
                  Your answer
                  <span className="muted small"> · {wordCount} word{wordCount === 1 ? "" : "s"}</span>
                </label>
                <textarea
                  id="track-answer"
                  className="design-textarea"
                  value={answer}
                  placeholder="Write your answer here. Concrete beats polished: a specific situation, what you personally did, and what changed as a result."
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={(e) => void saveAnswer(e.target.value)}
                />
              </div>

              <div className="row stack-md">
                <button className="primary" onClick={() => void finish()} disabled={grading || busy || answer.trim().length === 0}>
                  {grading ? "Grading…" : "Save and grade"}
                </button>
                <span className="muted small">
                  Grading reads your answer and must quote it to move a score.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The graded result: a band, the schedule, then one row per dimension with its quote.
 *
 * Rendered with the design round's `.dimension-row` markup rather than a second set of rules,
 * so a score reads the same wherever it comes from. The four dimensions differ, the presentation
 * does not.
 */
function TrackResults({ result }: { result: TrackGradeResult }) {
  const band =
    result.grade >= 4 ? "Strong" : result.grade === 3 ? "Meets expectations" : result.grade === 2 ? "Approaching" : "Below expectations";

  return (
    <div className="design-results">
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Result</h2>
        <span className={`badge ${result.grade >= 3 ? "Easy" : result.grade === 2 ? "Medium" : "Hard"}`}>
          {band} · {GRADE_LABEL[result.grade] ?? result.grade}
        </span>
      </div>
      <p className="muted">{result.summary}</p>

      {result.nextDue ? (
        <div className="notice info">
          Scheduled for review in <strong>{result.intervalDays} day{result.intervalDays === 1 ? "" : "s"}</strong>{" "}
          ({new Date(result.nextDue).toLocaleDateString()}). A prompt that scores below the bottom band is not
          scheduled — there is no answer to come back to yet.
        </div>
      ) : (
        <div className="notice warn">
          Not scheduled for review: an answer with a dimension at the bottom of the scale is not worth
          revisiting yet. Rewrite it and grade again.
        </div>
      )}

      <div className="table">
        {TRACK_DIMENSIONS.map((d) => {
          const s = result.scores[d];
          if (!s) return null;
          return (
            <div key={d} className="dimension-row">
              <span className="dimension-name">{TRACK_DIMENSION_LABEL[d]}</span>
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

      <h3 style={{ marginBottom: 4 }}>What the text shows</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Computed from your answer without a model call. These are what the scores are anchored to — a
        score the model could not quote you for falls back to these.
      </p>
      <div className="table">
        <div className="signal-row">
          <span className="signal-mark on">·</span>
          <span className="signal-label">Words</span>
          <span className="muted small signal-words">{result.signals.words}</span>
        </div>
        <div className="signal-row">
          <span className={`signal-mark ${result.signals.firstPerson > 0 ? "on" : "off"}`}>
            {result.signals.firstPerson > 0 ? "✓" : "·"}
          </span>
          <span className="signal-label">First-person pronouns</span>
          <span className="muted small signal-words">{result.signals.firstPerson}</span>
        </div>
        <div className="signal-row">
          <span className={`signal-mark ${result.signals.quantified > 0 ? "on" : "off"}`}>
            {result.signals.quantified > 0 ? "✓" : "·"}
          </span>
          <span className="signal-label">Quantified figures</span>
          <span className="muted small signal-words">{result.signals.quantified}</span>
        </div>
        <div className="signal-row">
          <span className={`signal-mark ${result.signals.actionVerbs > 0 ? "on" : "off"}`}>
            {result.signals.actionVerbs > 0 ? "✓" : "·"}
          </span>
          <span className="signal-label">Past-tense action verbs</span>
          <span className="muted small signal-words">{result.signals.actionVerbs}</span>
        </div>
      </div>
    </div>
  );
}
