/**
 * The technique panel: the handbook's pattern-independent advice, what to do in the round
 * regardless of which algorithm the problem wants. Fixed prose with no data behind it, so it is
 * a constant in a component and never a fetch.
 *
 * Mounted on the Overview, not inside a problem. It is general advice, and a panel repeated above
 * every problem is noise that is easy to stop seeing. The Overview is where you land before
 * starting work, which is when this is worth reading.
 *
 * Closed by default. It is reference, not a nag.
 */

import { NAV_SHORTCUTS } from "../shortcuts";

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

/**
 * The interview technique list.
 *
 * Always expanded. It was a toggle, which was wrong for reference material: the eight headings
 * are the index you scan to find the one you need, and a collapsed list hides the thing that
 * makes it useful. A disclosure also made the page jump under the cursor every time it opened.
 *
 * A heading and a table, not a button and a table, so it reads as a section of the page like
 * "Milestones" and "Due now" do.
 *
 * The keyboard list is rendered from `NAV_SHORTCUTS` in `src/ui/shortcuts.ts`, which is the same
 * table the app's keydown handler reads. A copy here would drift into a shortcut that is
 * advertised and does not work, which is the failure a shortcut list is most prone to.
 */
export function TipsPanel() {
  return (
    <>
      <section className="stack-lg">
        <h2>Interview technique</h2>
        <p className="muted small">
          What to do in the round regardless of which algorithm the problem wants. The same eight
          habits every time.
        </p>
        <div className="table">
          {INTERVIEW_TIPS.map((t) => (
            <div key={t.title} className="tip-row">
              <span className="tip-title">{t.title}</span>
              <span className="tip-body">{t.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-lg">
        <h2>Keyboard</h2>
        <p className="muted small">
          Two-key chords, so they cannot fire while you are typing. A chord is ignored whenever an
          input, a textarea or the code editor has focus.
        </p>
        <div className="table">
          {NAV_SHORTCUTS.map((s) => (
            <div key={s.key} className="tip-row">
              <span className="tip-title mono">g {s.key}</span>
              <span className="tip-body">{s.label}</span>
            </div>
          ))}
          <div className="tip-row">
            <span className="tip-title mono">Ctrl+Enter</span>
            <span className="tip-body">Run the code in the editor</span>
          </div>
        </div>
      </section>
    </>
  );
}
