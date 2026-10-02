import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ProjectModuleDetail,
  type ProjectQuestion,
  type ProjectSessionView,
  type ProjectSummary,
  type TrackGradeResult,
} from "../api";
import { Markdown } from "./Markdown";
import { TrackResults } from "./ProseTrackView";

/**
 * One project module: the study document on the left, the interview questions on the right.
 *
 * Takes over the shell the way `ProblemView` does, because the study document is long-form reading
 * and deserves the full width. The document renders through the existing `<Markdown/>`; there is no
 * second renderer.
 *
 * The question chips are the module's 4-6 questions, each with its own session row, so answering one
 * does not lock the others. The draft autosaves on blur and the grade schedules the MODULE (not the
 * question) through `reviewProject`.
 */
export function ProjectModuleView({
  project,
  module,
  onBack,
  onGraded,
}: {
  project: ProjectSummary;
  module: ProjectModuleDetail;
  onBack: () => void;
  onGraded: () => void;
}): React.JSX.Element {
  const [question, setQuestion] = useState<ProjectQuestion | null>(module.questions[0] ?? null);
  const [session, setSession] = useState<ProjectSessionView | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<TrackGradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The question a `start` is in flight for, so a double click cannot create two sessions. */
  const starting = useRef<string | null>(null);

  const start = useCallback(
    async (q: ProjectQuestion) => {
      if (starting.current === q.q) return;
      starting.current = q.q;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const r = await api<{ sessionId: number; session: ProjectSessionView | null }>(
          `/api/projects/${project.id}/session`,
          { method: "POST", body: JSON.stringify({ slug: module.slug, question: q.q }) },
        );
        setQuestion(q);
        setSession(r.session);
        setAnswer(r.session?.answerMd ?? "");
      } catch (e) {
        setError(String(e));
      } finally {
        starting.current = null;
        setBusy(false);
      }
    },
    [project.id, module.slug],
  );

  // Resume the module's open session on arrival, so a reload lands back on the answer being written.
  // When there is none, the FIRST question is started immediately: the module opens with Q1 selected
  // and a usable textarea, so without a session the "Grade answer" button sat disabled with no
  // explanation, and the only way forward was to click the question that already looked selected.
  useEffect(() => {
    void (async () => {
      let open: ProjectSessionView | null = null;
      try {
        const r = await api<{ module: ProjectModuleDetail; session: ProjectSessionView | null }>(
          `/api/projects/${project.id}/module?slug=${encodeURIComponent(module.slug)}`,
        );
        open = r.session;
      } catch {
        // A failed resume is not worth a banner: the question list still works and a fresh session
        // can be started.
      }

      if (open) {
        const q = module.questions.find((x) => x.q === open!.question) ?? null;
        if (q) {
          setQuestion(q);
          setSession(open);
          setAnswer(open.answerMd);
          return;
        }
      }

      const first = module.questions[0];
      if (first) void start(first);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, module.slug]);

  const saveAnswer = useCallback(
    async (text: string) => {
      if (!session) return;
      try {
        await api(`/api/projects/module/${session.id}/answer`, {
          method: "POST",
          body: JSON.stringify({ answerMd: text }),
        });
      } catch {
        // A failed autosave is not worth interrupting the writer; Finish sends the current value.
      }
    },
    [session],
  );

  const finish = useCallback(async () => {
    if (!session) return;
    setGrading(true);
    setError(null);
    try {
      // Saved first: blur is not guaranteed to have fired (the button can be clicked while the field
      // still has focus), and grading the stored draft would grade stale text.
      await saveAnswer(answer);
      const r = await api<TrackGradeResult>(`/api/projects/module/${session.id}/finish`, { method: "POST" });
      setResult(r);
      onGraded();
    } catch (e) {
      setError(String(e));
    } finally {
      setGrading(false);
    }
  }, [answer, saveAnswer, session, onGraded]);

  return (
    <>
      <div className="spread">
        <h1 style={{ marginBottom: 0 }}>
          {module.position}. {module.title}
        </h1>
        <button onClick={onBack}>← All modules</button>
      </div>
      <p className="muted mono small">
        {project.name} · {module.slug}
      </p>

      {error ? (
        <div className="notice bad" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="workspace">
        <div className="pane" style={{ borderRight: "1px solid var(--rule)" }}>
          <div className="card">
            <Markdown md={module.studyMd} />
          </div>

          <details className="hint" style={{ marginTop: 12 }}>
            <summary>Files this module covers ({module.files.length})</summary>
            <ul className="muted small mono">
              {module.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        </div>

        <div className="pane">
          <h2 style={{ marginTop: 0 }}>Interview questions</h2>
          <div className="row" style={{ flexWrap: "wrap", marginBottom: 12 }}>
            {module.questions.map((q, i) => (
              <button
                key={q.q}
                className={q.q === question?.q ? "primary" : ""}
                disabled={busy}
                onClick={() => void start(q)}
                title={q.q}
              >
                Q{i + 1}
              </button>
            ))}
          </div>

          {!question ? (
            <div className="empty">This module has no questions.</div>
          ) : (
            <>
              <div className="card">
                <p style={{ marginTop: 0 }}>{question.q}</p>
              </div>

              {result ? <TrackResults result={result} /> : null}

              <div className="design-field">
                <label className="design-label" htmlFor="project-answer">
                  Your answer
                  <span className="muted small"> · {answer.trim().split(/\s+/).filter(Boolean).length} words</span>
                </label>
                <textarea
                  id="project-answer"
                  className="design-textarea"
                  value={answer}
                  placeholder="Answer in your own words. Grading checks the reasoning against this module's study document, so a confident claim that contradicts the code scores lower, not higher."
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={(e) => void saveAnswer(e.target.value)}
                />
              </div>

              <div className="row stack-md">
                <button
                  className="primary"
                  onClick={() => void finish()}
                  disabled={grading || busy || !session || answer.trim().length === 0}
                >
                  {grading ? "Grading…" : "Grade answer"}
                </button>
                <span className="muted small">
                  {session
                    ? "The grade schedules this module for review."
                    : "Pick a question to start a session."}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
