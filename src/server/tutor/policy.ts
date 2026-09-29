/**
 * The hint ceiling: deterministic, and blind to the student's text.
 *
 * The maximum hint level comes from state only: attempt count, elapsed time, and whether the
 * solution was unlocked. It never reads a message or prompt, so a prompt-injection attempt has
 * nothing to attach to and the tutor cannot be talked out of withholding. An unrestricted
 * GPT-4 tutor made students ~17% WORSE on an unaided exam than a no-tool control group; the
 * same model rebuilt to withhold answers erased the harm (Bastani et al., PNAS 2025).
 *
 * Levels, by how much they give away: H0 restate + ask, H1 technique family, H2 sticking point,
 * H3 invariant, H4 pseudocode, H5 worked micro-example, H6 full solution (explicit unlock).
 */

/** The maximum hint level this attempt state permits. */
export function hintCeiling(state: {
  attempts: number;
  minutes: number;
  solutionUnlocked: boolean;
}): number {
  if (state.solutionUnlocked) return 6;
  if (state.attempts === 0) return 0;
  if (state.attempts <= 1) return 1;
  if (state.attempts <= 3) return 2;
  if (state.minutes < 10) return 3;
  if (state.minutes < 25) return 4;
  return 5;
}

/**
 * What the model is allowed to do at each level.
 *
 * Phrased as prohibitions, not permissions: a model told "point at the sticking point" will
 * still volunteer the data structure unless the instruction says not to.
 */
export const HINT_RULES: Record<number, string> = {
  0: "Restate the problem in your own words and ask what they have tried. Do NOT name any technique, data structure, or algorithmic idea. Do NOT write code.",
  1: "Name ONLY the general technique family (for example 'hashing' or 'two pointers'). Do NOT name the specific data structure to use, and do NOT write code.",
  2: "Point at the specific sticking point or obstacle in their approach. Describe it abstractly. Do NOT give the insight that resolves it, and do NOT write code.",
  3: "State the key invariant or insight in the abstract. NO pseudocode, NO language syntax, NO code.",
  4: "Sketch the approach in pseudocode only. NO real language syntax, NO runnable code.",
  5: "Work a micro-example on a DIFFERENT input, then let them transfer the idea. NO real language syntax.",
  6: "A full solution and walkthrough are allowed.",
};

/** Human-readable label, for the UI and the audit trail. */
export const LEVEL_LABEL: Record<number, string> = {
  0: "Recap",
  1: "Technique",
  2: "Sticking point",
  3: "Insight",
  4: "Pseudocode",
  5: "Worked example",
  6: "Full solution",
};

/**
 * Why this ceiling, in words. Shown to the student so the constraint is legible instead of
 * feeling like the tool is being obtuse.
 */
export function ceilingReason(state: {
  attempts: number;
  minutes: number;
  solutionUnlocked: boolean;
}): string {
  if (state.solutionUnlocked) return "Solution unlocked for this problem.";
  if (state.attempts === 0) return "No attempts recorded yet — start by working the problem.";
  if (state.attempts <= 1) return `${state.attempts} attempt so far — hints stay at the technique family.`;
  if (state.attempts <= 3) return `${state.attempts} attempts — you can be pointed at the sticking point.`;
  if (state.minutes < 10) return `${state.attempts} attempts, ${Math.round(state.minutes)} min in — abstract insight only.`;
  if (state.minutes < 25) return `${state.attempts} attempts, ${Math.round(state.minutes)} min in — pseudocode is allowed.`;
  return `${state.attempts} attempts, ${Math.round(state.minutes)} min in — a worked example is allowed.`;
}
