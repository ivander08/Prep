/**
 * The code-reveal detector — a deterministic post-check on every draft.
 *
 * The policy core decides what the tutor is *allowed* to say. This checks whether it
 * actually complied. It runs before the student sees anything, and a draft that gives away
 * more than the ceiling permits is rejected and regenerated.
 *
 * Two signals, deliberately conservative:
 *
 *   1. The model's own self-report (`hint_level`, `contains_solution`, `contains_real_code`).
 *      Cheap and usually honest, but it is a claim, not evidence.
 *   2. Structural analysis of the message text — this is the part that matters, because a
 *      model that under-reports its own leak would otherwise pass.
 *
 * The text analysis intentionally over-triggers rather than under-triggers: a false
 * rejection costs one cheap regeneration, while a false acceptance hands over the answer
 * and destroys the exercise. Over-blocking is still treated as a real failure worth
 * measuring — it just isn't the dangerous direction.
 */

export type Turn = {
  hint_level: number;
  message: string;
  contains_solution: boolean;
  contains_real_code: boolean;
  next_question: string;
  /**
   * Regions of the STUDENT'S OWN code this hint refers to.
   *
   * Deliberately NOT part of `message`, and deliberately not passed to `detectViolations`.
   * The detector matches real-code syntax (`def `, `for(`, `return x(`) in the message — a
   * verbatim quote of the student's own line matches those patterns, so routing `focus`
   * through the message would make every line-specific hint get rejected as a leak at any
   * ceiling below H4.
   *
   * Optional: it is absent at H0/H1 (nothing specific to point at) and at H6 (the point is
   * the answer, not the student's line), and `validateTurn` normalises a missing value to an
   * empty array.
   */
  focus?: FocusEntry[];
};

export type FocusEntry = { quote: string; why: string };

export type Violation = {
  kind: "self-report" | "real-code" | "full-solution" | "syntax";
  detail: string;
};

const CODE_FENCE = /```[\s\S]*?```/;

/**
 * Syntax that only appears in real, runnable code — not in pseudocode or prose.
 * Pseudocode legitimately uses `for`, `while`, `if`, `return`; what it does not use is
 * `def`, `:=`, `->`, `len(`, or a brace-and-semicolon body.
 */
const REAL_SYNTAX: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdef\s+\w+\s*\(/, label: "Python function definition" },
  { pattern: /\bclass\s+\w+\s*[:(]/, label: "class definition" },
  { pattern: /\bfunction\s+\w+\s*\(|\w+\s*=\s*function\s*\(/, label: "JS function definition" },
  { pattern: /\bpublic\s+\w+[\w<>\[\],\s]*\s+\w+\s*\(/, label: "Java/C# method signature" },
  { pattern: /\bfor\s*\([^)]*;[^)]*;/, label: "C-style for loop" },
  { pattern: /\b(std::|System\.out|console\.log|print\s*\()/, label: "language runtime call" },
  { pattern: /\b\w+\s*:=\s*/, label: "assignment operator" },
  { pattern: /\breturn\s+\w+\([^)]*\)\s*;?\s*$/m, label: "return with a call" },
];

/**
 * Detect a full worked solution regardless of language: a long code fence, or a short
 * block that still contains a return plus a loop/branch.
 */
function looksLikeSolution(text: string): boolean {
  const fenced = text.match(/```([\s\S]*?)```/g) ?? [];
  for (const block of fenced) {
    const body = block.replace(/```\w*/g, "");
    const hasControlFlow = /\b(for|while|if)\b/.test(body);
    const hasReturn = /\breturn\b/.test(body);
    // A fenced block with both control flow and a return is a solution, not a sketch.
    if (hasControlFlow && hasReturn) return true;
    if (body.split("\n").length >= 6) return true;
  }
  return false;
}

/** True when the message contains real, runnable syntax rather than pseudocode. */
export function findRealSyntax(text: string): string | null {
  const body = CODE_FENCE.test(text) ? text.replace(/```\w*/g, "") : text;
  for (const { pattern, label } of REAL_SYNTAX) {
    if (pattern.test(body)) return label;
  }
  return null;
}

/**
 * What the detector is allowed to see.
 *
 * `Omit<Turn, "focus">` rather than `Turn`: the detector must never receive `focus`, and a
 * type that cannot hold it makes that a compile error instead of a convention. The reason is
 * concrete — `findRealSyntax` matches `def `, `for(`, `return x(`, and a verbatim quote of
 * the student's own line matches those patterns, so routing `focus` into the detector would
 * reject every line-specific hint as a leak at any ceiling below H4.
 */
export type DetectorInput = Omit<Turn, "focus">;

/**
 * Check a draft against the ceiling. Returns every violation found, or an empty array.
 *
 * Note the asymmetry: at H4 pseudocode is permitted, so `for`/`while`/`return` are fine —
 * only *real syntax* trips the detector. At H6 nothing is checked.
 */
export function detectViolations(turn: DetectorInput, ceiling: number): Violation[] {
  const violations: Violation[] = [];
  if (ceiling >= 6) return violations;

  if (turn.hint_level > ceiling) {
    violations.push({
      kind: "self-report",
      detail: `claimed level ${turn.hint_level} but the ceiling is ${ceiling}`,
    });
  }

  if (ceiling < 5 && turn.contains_solution) {
    violations.push({ kind: "full-solution", detail: "self-reported a full solution" });
  }

  if (ceiling < 5 && looksLikeSolution(turn.message)) {
    violations.push({ kind: "full-solution", detail: "message contains a complete code block" });
  }

  // Below H4, pseudocode is not yet permitted, so real syntax is a leak.
  if (ceiling < 4) {
    const syntax = findRealSyntax(turn.message);
    if (syntax) {
      violations.push({ kind: "real-code", detail: `message contains ${syntax}` });
    } else if (turn.contains_real_code) {
      violations.push({ kind: "real-code", detail: "self-reported real code" });
    }
  }

  return violations;
}
