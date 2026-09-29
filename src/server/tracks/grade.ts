/**
 * Prose-answer grading.
 *
 * The behavioral and stack tracks both ask for a written answer and grade it against a rubric,
 * so this is ONE module and not two. The same three mechanisms the design round uses are reused
 * rather than re-derived, because a second grader would drift from the first:
 *
 *   - `structured()` (`tutor/client.ts`) with a tool schema and a validator, so the model
 *     returns a shape and a retry happens on a malformed one.
 *   - Verbatim-quote validation via `quoteAppears` (`design/index.ts`): a score that cannot
 *     quote the candidate's own text is discarded and the mechanical signal score stands in.
 *     This is what stops a model moving a number without pointing at the words that moved it.
 *   - `gradeFromScores()` (`design/rubric.ts`) maps the 1-4 dimension scores onto the app's
 *     FSRS grades, so a prose answer schedules through the same `reviewItem` call as everything
 *     else.
 *
 * There is no code execution here and therefore no `gradeAttempt`.
 *
 * The clamp is the design round's rule, applied to different anchors: a verified quote buys at
 * most one point of movement off the signal-derived score, and a mechanical cap (short answer,
 * no first person, nothing quantified) can hold a dimension down below what the model claimed.
 * The model shades a score; it does not set one.
 */

import { structured, KenariError, type CallMeta, type ToolDef } from "../tutor/client.ts";
import { quoteAppears } from "../design/index.ts";
import { gradeFromValues } from "../design/rubric.ts";

/** The four dimensions a prose answer is scored on, in the order they are displayed. */
export type TrackGradeDimension = "structure" | "specificity" | "ownership" | "impact";

export const TRACK_DIMENSIONS: TrackGradeDimension[] = [
  "structure",
  "specificity",
  "ownership",
  "impact",
];

/**
 * What each dimension measures, sent to the model as the rubric.
 *
 * `structure` and `specificity` are the answer's shape; `ownership` and `impact` are what a
 * behavioral interviewer is actually listening for, and they are the two the mechanical signals
 * can bound most reliably.
 */
export const DIMENSION_LABEL: Record<TrackGradeDimension, string> = {
  structure: "Structure",
  specificity: "Specificity",
  ownership: "Ownership",
  impact: "Impact",
};

const DIMENSION_RUBRIC: Record<TrackGradeDimension, string> = {
  structure: "Names a situation, what the candidate did about it, and what changed. A story with no result is not structured.",
  specificity: "Concrete and particular — a real system, a real person, a real number — rather than a category of event.",
  ownership: "States what the CANDIDATE did in the first person. A team's achievement described in the plural is not ownership.",
  impact: "States an outcome that could be observed or measured: a number, a date, a shipped change, a decision reversed.",
};

/**
 * The 1-4 scale, where 3 is "meets expectations". Same calibration as the design round, so a
 * score means the same thing across tracks.
 */
export const SCORE_LABEL: Record<number, string> = {
  1: "did not do this at all",
  2: "attempted it weakly or inconsistently",
  3: "did it adequately",
  4: "did it well and specifically",
};

/** One dimension's score with the evidence that earned it. */
export type TrackScore = {
  score: number;
  evidence: string;
  signalScore: number;
  source: "model" | "signal";
};

export type TrackGradeResult = {
  scores: Record<TrackGradeDimension, TrackScore>;
  signals: AnswerSignals;
  grade: 1 | 2 | 3 | 4;
  summary: string;
  model: string;
  costIdr: number;
};

/**
 * Cheap signals from the answer text alone, computed with no model call.
 *
 * These are not a grade. They are the bound on what the model may claim: a mechanical check can
 * establish that the candidate did a thing, never that they did it well, so the top band is
 * reserved for a model that quoted evidence for it.
 */
export type AnswerSignals = {
  words: number;
  /** First-person singular pronouns — a behavioral answer that never says "I" is describing a team. */
  firstPerson: number;
  /** Numbers, percentages, or durations — evidence that an outcome was measured. */
  quantified: number;
  /** Past-tense verbs suggesting a concrete action was taken. */
  actionVerbs: number;
};

/**
 * First-person singular, including the contracted forms.
 *
 * `\bI\b` alone misses "I'd", "I've" and "I'm", which are exactly how a first-person answer
 * reads in practice — matching only the bare pronoun would score a written-out answer as
 * having no ownership at all.
 */
const FIRST_PERSON_RE = /\b(i|i'd|i've|i'll|i'm|my|mine|myself)\b/gi;

/**
 * Numbers that mean something was measured: a quantity, a percentage, a duration, a currency.
 *
 * Bare digits are deliberately NOT counted. "Team of 3" is a measurement; a stray "2024" or a
 * version number is not, and counting every integer made the signal fire on almost anything.
 */
const QUANTIFIED_RE =
  /(\d[\d,.]*\s*(?:%|percent|x\b|k\b|m\b|bn\b)|(?:\$|€|£|rp|idr)\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:users?|customers?|requests?|qps|rps|ms|s\b|sec|seconds?|minutes?|hours?|days?|weeks?|months?|years?|people|engineers?|teams?|services?|rows?|records?|gb|tb|mb|kb)\b|\b\d+\s*(?:to|-|–)\s*\d+\b)/gi;

/**
 * Past-tense verbs that indicate a concrete action rather than an opinion.
 *
 * A closed list, and short on purpose. It is not trying to parse English — it is checking that
 * the answer contains at least one thing the candidate DID, which is the minimum a behavioral
 * answer needs and the thing a purely reflective answer lacks.
 */
const ACTION_VERBS = [
  "led", "built", "wrote", "shipped", "fixed", "designed", "migrated", "refactored", "proposed",
  "convinced", "escalated", "reverted", "deployed", "debugged", "profiled", "rewrote", "split",
  "merged", "reduced", "increased", "removed", "introduced", "tested", "measured", "documented",
  "mentored", "reviewed", "asked", "raised", "pushed", "changed", "started", "owned", "drove",
  "negotiated", "traded", "cut", "added", "replaced", "simplified", "automated", "investigated",
  "traced", "isolated", "rolled", "ran", "led", "took", "told", "decided", "found", "learned",
];

/** Compute the mechanical signals. No model call, no network — pure text analysis. */
export function extractAnswerSignals(answer: string): AnswerSignals {
  const words = answer.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const firstPerson = (answer.match(FIRST_PERSON_RE) ?? []).length;
  const quantified = (answer.match(QUANTIFIED_RE) ?? []).length;
  const lower = answer.toLowerCase();
  const actionVerbs = ACTION_VERBS.filter((v) => new RegExp(`\\b${v}\\b`).test(lower)).length;
  return { words, firstPerson, quantified, actionVerbs };
}

/**
 * The score a signal set alone justifies, per dimension.
 *
 * This is the fallback and the anchor the model's score is checked against. It never returns 4:
 * a mechanical check can establish that the candidate did the thing, not that they did it well.
 *
 * The word-count band is the load-bearing one. An answer under 60 words cannot contain a
 * situation, an action and a result — there is not enough room — so `structure` is capped at 2
 * however well written it is.
 */
export function signalScore(dim: TrackGradeDimension, s: AnswerSignals): number {
  switch (dim) {
    case "structure":
      if (s.words >= 180 && s.actionVerbs >= 3) return 3;
      if (s.words >= 60 && s.actionVerbs >= 1) return 2;
      return 1;
    case "specificity":
      // Named actions are the cheapest proxy for "a particular event rather than a general
      // reflection", and length is the second: a specific story needs room to be specific in.
      if (s.actionVerbs >= 4 && s.words >= 150) return 3;
      if (s.actionVerbs >= 2 && s.words >= 60) return 2;
      return 1;
    case "ownership":
      // First person is the whole signal. Without it the answer is about a team, whatever
      // else it does.
      if (s.firstPerson >= 4 && s.actionVerbs >= 3) return 3;
      if (s.firstPerson >= 1) return 2;
      return 1;
    case "impact":
      if (s.quantified >= 2) return 3;
      if (s.quantified >= 1) return 2;
      return 1;
  }
}

/**
 * The ceiling a mechanical cap imposes on a dimension, or 4 for no cap.
 *
 * Separate from `signalScore` because they answer different questions. `signalScore` is what
 * the text alone justifies; a cap is what the text FORBIDS — an answer with no number in it
 * cannot have demonstrated measurable impact, so `impact` may not exceed 2 no matter what the
 * model says. Both are applied: the model's score is clamped to within one of the signal, and
 * then held at or below the cap.
 */
export function signalCap(dim: TrackGradeDimension, s: AnswerSignals): number {
  switch (dim) {
    case "structure":
      return s.words < 60 ? 2 : 4;
    case "ownership":
      return s.firstPerson === 0 ? 2 : 4;
    case "impact":
      return s.quantified === 0 ? 2 : 4;
    case "specificity":
      return 4;
  }
}

/** The tool schema, mirroring `design/index.ts`'s `GRADE_TOOL`. */
const GRADE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "submit_grade",
    description: "Submit the rubric scores for a written interview answer.",
    parameters: {
      type: "object",
      properties: {
        scores: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string", enum: TRACK_DIMENSIONS },
              score: { type: "integer", minimum: 1, maximum: 4 },
              evidence: { type: "string" },
            },
            required: ["dimension", "score", "evidence"],
          },
        },
        summary: { type: "string" },
      },
      required: ["scores", "summary"],
    },
  },
};

type GradePayload = {
  scores: Array<{ dimension: TrackGradeDimension; score: number; evidence: string }>;
  summary: string;
};

function validateGrade(value: unknown): { ok: true; value: GradePayload } | { ok: false; missing: string[] } {
  if (typeof value !== "object" || value === null) return { ok: false, missing: ["scores", "summary"] };
  const v = value as Record<string, unknown>;
  const missing: string[] = [];

  if (!Array.isArray(v.scores)) missing.push("scores");
  if (typeof v.summary !== "string" || v.summary.trim().length === 0) missing.push("summary");

  const scores: GradePayload["scores"] = [];
  if (Array.isArray(v.scores)) {
    for (const raw of v.scores) {
      if (typeof raw !== "object" || raw === null) continue;
      const e = raw as Record<string, unknown>;
      if (typeof e.dimension !== "string") continue;
      if (!(TRACK_DIMENSIONS as string[]).includes(e.dimension)) continue;
      if (typeof e.score !== "number") continue;
      scores.push({
        dimension: e.dimension as TrackGradeDimension,
        score: Math.min(4, Math.max(1, Math.round(e.score))),
        evidence: typeof e.evidence === "string" ? e.evidence.trim() : "",
      });
    }
  }

  if (scores.length === 0) missing.push("scores[]");
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: { scores, summary: (v.summary as string).trim() } };
}

/**
 * Grade one written answer against a prompt's answer key.
 *
 * The model is given the answer AND the mechanical signals, and is instructed to justify every
 * score by quoting the candidate. A score with no quote is discarded and the dimension falls
 * back to its signal-derived default, so the model cannot move a number without pointing at the
 * text that moved it.
 */
export async function gradeProseAnswer(opts: {
  /** Which rubric to apply. Both use the same four dimensions; only the framing differs. */
  kind: "behavioral" | "stack";
  title: string;
  statement: string;
  /** What a strong answer contains, from the catalogue. The answer key. */
  lookFor: string[];
  /** Where candidates typically go wrong on this one. */
  commonMistakes: string[];
  /** The candidate's answer. */
  answer: string;
}): Promise<TrackGradeResult> {
  const signals = extractAnswerSignals(opts.answer);

  const framing =
    opts.kind === "behavioral"
      ? "You score a written answer to a behavioral interview question. Score what the candidate DID, as evidenced by their own words — not what they seemed to believe or intend."
      : "You score a written answer to an engineering-depth interview question. Score the correctness and concreteness of the reasoning as evidenced by their own words — not how confident the writing sounds.";

  const signalsBlock = [
    `words: ${signals.words}`,
    `firstPersonPronouns: ${signals.firstPerson}`,
    `quantifiedFigures: ${signals.quantified}`,
    `pastTenseActionVerbs: ${signals.actionVerbs}`,
  ].join("\n");

  const system = [
    framing,
    "",
    "Dimensions, each scored 1-4 where 3 = meets expectations:",
    ...TRACK_DIMENSIONS.map((d) => `- ${d} (${DIMENSION_LABEL[d]}): ${DIMENSION_RUBRIC[d]}`),
    "",
    "Rules:",
    "- Every score MUST carry an `evidence` field holding a VERBATIM quote from the candidate's own answer. A quote that is not verbatim will be discarded and your score for that dimension ignored.",
    "- If the candidate did not do the thing the dimension measures, score it 1 and leave evidence as an empty string. Do not invent a quote.",
    "- Score the four dimensions independently. A strong result does not raise structure; a well-structured answer with no outcome does not raise impact.",
    "",
    "Reference scale, for calibrating 1-4:",
    ...Object.entries(SCORE_LABEL).map(([k, v]) => `  ${k} = ${v}`),
    "",
    "The mechanical signals below were computed from the candidate's text without a model. Use them to check your own reading; where a signal contradicts your impression, the signal is the fact. In particular, a low firstPersonPronouns count means the answer describes a team rather than the candidate, and a zero quantifiedFigures count means no outcome was measured.",
    signalsBlock,
    "",
    "# What a strong answer contains",
    ...opts.lookFor.map((l) => `- ${l}`),
    "",
    "# Where candidates typically go wrong on this one",
    ...opts.commonMistakes.map((m) => `- ${m}`),
  ].join("\n");

  const user = [
    `# Question: ${opts.title}`,
    "",
    opts.statement,
    "",
    "# The candidate's answer",
    opts.answer.trim().length > 0 ? opts.answer : "(the answer is empty)",
  ].join("\n");

  let payload: GradePayload;
  let meta: CallMeta;
  try {
    const r = await structured(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      GRADE_TOOL,
      validateGrade,
      // The `design` role, not a new one. Grading written reasoning is what that role already
      // selects a model for, and a fourth role would need a settings row, a picker entry and a
      // default before it graded anything at all.
      { role: "design", maxTokens: 2000 },
    );
    payload = r.value;
    meta = r.meta;
  } catch (e) {
    const note = e instanceof KenariError ? e.message : String(e);
    throw new Error(`${opts.kind} grading unavailable: ${note}`);
  }

  const scores = {} as Record<TrackGradeDimension, TrackScore>;
  for (const dim of TRACK_DIMENSIONS) {
    const sig = signalScore(dim, signals);
    const cap = signalCap(dim, signals);
    const entry = payload.scores.find((s) => s.dimension === dim);

    // No entry, no quote, or a quote that is not in the candidate's text → the model has not
    // earned the right to set this number, so the signal does.
    if (!entry || entry.evidence.length === 0 || !quoteAppears(entry.evidence, opts.answer)) {
      scores[dim] = {
        score: Math.min(sig, cap),
        evidence: entry?.evidence && entry.evidence.length > 0 ? `(unverified quote: ${entry.evidence})` : "",
        signalScore: sig,
        source: "signal",
      };
      continue;
    }

    // A verified quote buys at most one point of movement off the signal-derived score, and the
    // mechanical cap still holds it down. Two independent limits, applied in that order.
    const clamped = Math.min(sig + 1, Math.max(sig - 1, entry.score), cap);
    scores[dim] = {
      score: clamped,
      evidence: entry.evidence,
      signalScore: sig,
      source: clamped === entry.score ? "model" : "signal",
    };
  }

  const numeric = TRACK_DIMENSIONS.map((d) => scores[d].score);

  return {
    scores,
    signals,
    grade: gradeFromValues(numeric),
    summary: payload.summary,
    model: meta.model,
    costIdr: meta.cost.idr,
  };
}
