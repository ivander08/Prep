import { useState } from "react";

/**
 * The technique panel.
 *
 * The handbook's pattern-independent advice: what to do in the round regardless of which
 * algorithm the problem wants. It is fixed prose with no data behind it, so it is a constant in
 * a component and never a fetch.
 *
 * Mounted on the Overview rather than inside a problem. It is general advice, not something
 * specific to the problem on screen — and a panel repeated above every problem is both noise on
 * the page and easy to stop seeing, which is the opposite of what reference material is for.
 * The Overview is where you land before starting work, which is when this is worth reading.
 *
 * Closed by default. It is reference, not a nag.
 */
export const INTERVIEW_TIPS: Array<{ title: string; body: string }> = [
  {
    title: "Clarify before you design",
    body: "State the assumptions you are making out loud before you commit to them. An assumption you never named is the one the interviewer will probe.",
  },
  {
    title: "Validate the input, or say you will not",
    body: "Empty, negative, wrong type, out of range. Either handle them or say you are assuming valid input — silently assuming it is what produces the wrong answer on the hidden case.",
  },
  {
    title: "Ask about the constraint",
    body: "Time limit, memory limit, expected input size. The answer usually rules out the approach you were about to write, and asking costs one sentence.",
  },
  {
    title: "Check the boundaries by hand",
    body: "Walk your loop over the first and last iteration before you run it. Off-by-one errors are the single most common way a correct idea scores zero.",
  },
  {
    title: "Match the types before you combine them",
    body: "Concatenating a string with a number, or comparing a float to an int, is silent in most languages and wrong in the same way everywhere.",
  },
  {
    title: "Trace the finished code on a small input",
    body: "Two or three elements, written out. It catches the errors that reading cannot, and it is faster than a debugging session.",
  },
  {
    title: "Name the corners you are cutting",
    body: "Say what you would do with more time, and why you are not doing it now. An acknowledged shortcut reads as judgement; an unacknowledged one reads as an oversight.",
  },
  {
    title: "Know the cost of your data structures",
    body: "Pick the structure that fits the operation you do most, and be able to say what the alternative would have cost. The choice is usually the answer they are grading.",
  },
];

/** The interview technique list. Open by default — on the Overview it is reference the reader can scan, not a nag. */
export function TipsPanel() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ marginTop: 22 }}>
      <button onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Interview technique ({INTERVIEW_TIPS.length})
      </button>

      {open ? (
        <div className="table" style={{ marginTop: 8 }}>
          {INTERVIEW_TIPS.map((t) => (
            <div key={t.title} className="tip-row">
              <span className="tip-title">{t.title}</span>
              <span className="tip-body">{t.body}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
