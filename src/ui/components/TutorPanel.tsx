import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Dialog } from "./Dialog";

export type TutorStatus = {
  ceiling: number;
  reason: string;
  attempts: number;
  minutes: number;
  turns: number;
  rejectedTurns: number;
  costIdr: number;
};

export type TutorTurnResponse = {
  level: number;
  ceiling: number;
  reason: string;
  message: string;
  nextQuestion: string;
  /** Regions of your own code this hint points at. Empty when the hint is about approach. */
  focus: Array<{ quote: string; why: string }>;
  refused: boolean;
  rejectionNote: string | null;
  model: string;
  costIdr: number;
  repaired: boolean;
  error?: string;
};

export type ReviewResponse = {
  complexity: string;
  notes: string;
  /** The complexity a stronger approach would reach, or null if already optimal. */
  betterApproach: string | null;
  betterDetail: string | null;
  optimal: boolean;
  model: string;
  costIdr: number;
  error?: string;
};

type Entry =
  | { kind: "student"; text: string }
  | { kind: "tutor"; turn: TutorTurnResponse }
  | { kind: "review"; review: ReviewResponse };

const LEVEL_LABEL: Record<number, string> = {
  0: "Recap",
  1: "Technique",
  2: "Sticking point",
  3: "Insight",
  4: "Pseudocode",
  5: "Worked example",
  6: "Full solution",
};

/**
 * The hint panel.
 *
 * The ceiling is shown before the student asks anything, with the reason, so the constraint
 * reads as a rule the tool states openly. The unlock is present but framed honestly: it costs
 * you the review grade.
 */
export function TutorPanel({
  slug,
  lastRun,
  onUnlocked,
  onFocus,
}: {
  slug: string;
  lastRun: { passed: boolean; testsPassed: number; testsTotal: number; stderr?: string; code: string } | null;
  onUnlocked: () => void;
  /** Handed the first focus region of a turn, so the editor can highlight it. */
  onFocus: (focus: { quote: string; why: string } | null) => void;
}) {
  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<TutorStatus>(`/api/tutor/${slug}/status`));
    } catch (e) {
      setError(String(e));
    }
  }, [slug]);

  useEffect(() => {
    setEntries([]);
    setError(null);
    void refreshStatus();
  }, [slug, refreshStatus]);

  // The ceiling is derived from the attempt log, so a run changes it, and `lastRun` is a
  // fresh object on every run, which makes it the right trigger. Without this the chip kept
  // showing the ceiling from page load, so a student who had just attempted the problem saw
  // H0 and a hint they were now entitled to looked unavailable.
  useEffect(() => {
    if (lastRun) void refreshStatus();
  }, [lastRun, refreshStatus]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  const ask = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const question = draft.trim();
    setDraft("");
    if (question) setEntries((e) => [...e, { kind: "student", text: question }]);

    try {
      const turn = await api<TutorTurnResponse>(`/api/tutor/${slug}/ask`, {
        method: "POST",
        body: JSON.stringify({ message: question }),
      });
      if (turn.error) {
        setError(turn.error);
      } else {
        setEntries((e) => [...e, { kind: "tutor", turn }]);
        // Only the first region: a second highlight would move the viewport away from the
        // one the student is reading.
        onFocus(turn.focus?.[0] ?? null);
        void refreshStatus();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, slug, refreshStatus, onFocus]);

  const requestReview = useCallback(async () => {
    if (!lastRun || reviewing) return;
    setReviewing(true);
    setError(null);
    try {
      const review = await api<ReviewResponse>(`/api/tutor/${slug}/review`, {
        method: "POST",
        body: JSON.stringify({
          code: lastRun.code,
          passed: lastRun.passed,
          testsPassed: lastRun.testsPassed,
          testsTotal: lastRun.testsTotal,
          stderr: lastRun.stderr,
        }),
      });
      if (review.error) setError(review.error);
      else setEntries((e) => [...e, { kind: "review", review }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setReviewing(false);
    }
  }, [lastRun, reviewing, slug]);

  /** The confirmed unlock. The dialog is the confirmation; this no longer asks. */
  const unlock = useCallback(async () => {
    setConfirmUnlock(false);
    try {
      await api(`/api/tutor/${slug}/unlock`, { method: "POST" });
      void refreshStatus();
      onUnlocked();
    } catch (e) {
      setError(String(e));
    }
  }, [slug, refreshStatus, onUnlocked]);

  const totalCost = entries.reduce(
    (a, e) => a + (e.kind === "tutor" ? e.turn.costIdr : e.kind === "review" ? e.review.costIdr : 0),
    0,
  );

  return (
    <div className="tutor">
      <div className="spread tutor-head">
        <div className="row">
          <strong>Tutor</strong>
          {status ? (
            <span className="ceiling-chip" title={status.reason}>
              ceiling H{status.ceiling} · {LEVEL_LABEL[status.ceiling]}
            </span>
          ) : null}
        </div>
        <div className="row">
          {lastRun ? (
            <button className="tiny" onClick={() => void requestReview()} disabled={reviewing}>
              {reviewing ? "Reviewing…" : "Review my code"}
            </button>
          ) : null}
          {status && status.ceiling < 6 ? (
            <button className="tiny danger" onClick={() => setConfirmUnlock(true)}>
              Unlock solution
            </button>
          ) : null}
        </div>
      </div>

      {status ? (
        <div className="tutor-reason">
          {status.reason}
          {status.rejectedTurns > 0 ? (
            <span className="muted"> · {status.rejectedTurns} turn(s) withheld for exceeding the ceiling</span>
          ) : null}
          {totalCost > 0 ? <span className="muted"> · ~Rp {totalCost.toFixed(2)}</span> : null}
        </div>
      ) : null}

      <div className="tutor-log" ref={scroller}>
        {entries.length === 0 ? (
          <div className="muted small" style={{ padding: "10px 2px" }}>
            Ask for a hint, or describe where you are stuck. The tutor will not give you the answer —
            the ceiling above is computed from your attempts and elapsed time, and it rises as you work.
          </div>
        ) : null}

        {entries.map((e, i) => {
          if (e.kind === "student") {
            return (
              <div key={i} className="msg student">
                <span className="msg-role">you</span>
                <div>{e.text}</div>
              </div>
            );
          }
          if (e.kind === "review") {
            return (
              <div key={i} className="msg review">
                <span className="msg-role">review</span>
                <div>
                  <div>
                    <strong>Complexity</strong> <span className="muted small">(estimate)</span>: {e.review.complexity}
                  </div>
                  <div style={{ marginTop: 6 }}>{e.review.notes}</div>
                  <div className={`better${e.review.optimal ? " optimal" : ""}`}>
                    {e.review.optimal ? (
                      <>
                        <span className="better-label">Optimal</span> No stronger approach available for this problem.
                      </>
                    ) : (
                      <>
                        <span className="better-label">Stronger approach</span>
                        <span className="mono">{e.review.betterApproach}</span>
                        {e.review.betterDetail ? <div className="better-detail">{e.review.betterDetail}</div> : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={`msg tutor${e.turn.refused ? " refused" : ""}`}>
              <span className="msg-role">
                tutor · H{e.turn.level}
                {e.turn.repaired ? " · repaired" : ""}
                {e.turn.refused ? " · withheld" : ""}
              </span>
              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{e.turn.message}</div>
              {e.turn.focus?.length > 0 ? (
                <div className="focus-ref">
                  {e.turn.focus.map((f, j) => (
                    <div key={j}>
                      <span className="mono">{f.quote}</span> — {f.why}
                    </div>
                  ))}
                </div>
              ) : null}
              {e.turn.nextQuestion ? (
                <div className="next-q">{e.turn.nextQuestion}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <div className="notice bad small">{error}</div> : null}

      <div className="tutor-input">
        <textarea
          value={draft}
          placeholder="Where are you stuck? (Ctrl+Enter to send)"
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button className="primary" onClick={() => void ask()} disabled={busy}>
          {busy ? "…" : "Ask"}
        </button>
      </div>

      {confirmUnlock ? (
        <Dialog
          title="Unlock the full solution?"
          confirmLabel="Unlock"
          danger
          onConfirm={() => void unlock()}
          onCancel={() => setConfirmUnlock(false)}
        >
          This is recorded, and the review grade for this problem becomes “Again”.
        </Dialog>
      ) : null}
    </div>
  );
}
