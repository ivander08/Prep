/**
 * The code-reveal detector: a deterministic post-check on every draft.
 * The policy core decides what the tutor is *allowed* to say; this checks whether it actually
 * complied, before the student sees anything. A draft that gives away more than the ceiling
 * permits is rejected and regenerated.
 * Two signals: the model's own self-report (`hint_level`, `contains_solution`,
 * `contains_real_code`), cheap and usually honest but a claim, not evidence; and structural
 * analysis of the message text, which catches an under-reported leak.
 * The text analysis over-triggers: a false rejection costs one cheap regeneration, a false
 * acceptance hands over the answer and destroys the exercise. Over-blocking is still a real
 * failure worth measuring, just not the dangerous direction.
 */

export type Turn = {
  hint_level: number;
  message: string;
  contains_solution: boolean;
  contains_real_code: boolean;
  next_question: string;
  /**
   * Regions of the student's own code this hint refers to.
   *
   * Not part of `message`, and not passed to `detectViolations`. The detector matches
   * real-code syntax (`def `, `for(`, `return x(`) in the message, and a verbatim quote of the
   * student's own line matches those patterns, so routing `focus` through the message would
   * make every line-specific hint get rejected as a leak at any ceiling below H4.
   *
   * Optional: absent at H0/H1 (nothing specific to point at) and at H6 (the answer is the
   * point, not the student's line). `validateTurn` normalises a missing value to an empty
   * array.
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
 * Syntax that only appears in real, runnable code, not in pseudocode or prose.
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

/** True when the message contains real, runnable syntax and not just pseudocode. */
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
 * `Omit<Turn, "focus">`, not `Turn`: the detector must never receive `focus`, and a type that
 * cannot hold it makes that a compile error instead of a convention. The reason is concrete:
 * `findRealSyntax` matches `def `, `for(`, `return x(`, and a verbatim quote of the student's
 * own line matches those patterns, so routing `focus` into the detector would reject every
 * line-specific hint as a leak at any ceiling below H4.
 */
export type DetectorInput = Omit<Turn, "focus">;

/**
 * Check a draft against the ceiling. Returns every violation found, or an empty array.
 *
 * Note the asymmetry: at H4 pseudocode is permitted, so `for`/`while`/`return` are fine, and
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

  // Real syntax is a leak at every level that forbids it. H4 (pseudocode) and H5 (worked example)
  // both say "NO real language syntax" in `HINT_RULES`, and H6 is the unlocked full solution.
  //
  // The gate used to be `ceiling < 4`, so at H4 the only content check that could fire was
  // `looksLikeSolution` — which misses a single real-syntax line — and at H5 the function returned
  // after the self-report check alone, accepting a draft that contained a complete runnable
  // solution. Both contradicted the policy the ceiling was supposed to enforce.
  if (ceiling < 6) {
    const syntax = findRealSyntax(turn.message);
    if (syntax) {
      violations.push({ kind: "real-code", detail: `message contains ${syntax}` });
    } else if (turn.contains_real_code) {
      violations.push({ kind: "real-code", detail: "self-reported real code" });
    }
  }

  return violations;
}
