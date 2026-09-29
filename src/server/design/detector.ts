/**
 * Detect the interviewer giving away the design.
 *
 * Structurally the same problem the tutor's code-reveal detector solves, with a different
 * vocabulary: an interviewer leaking the answer does not write code, they recite a finished
 * architecture. Below the deep-dive phase the permitted material is questions and
 * confirmation, never a component list or a schema.
 *
 * Same asymmetry as the tutor: over-triggering costs one cheap regeneration, under-triggering
 * hands over the exercise. The direction that matters is the second one.
 */

import type { Violation } from "../tutor/detector.ts";

export type { Violation };

/**
 * What the detector is allowed to see.
 *
 * The candidate's message is not here. The detector judges the interviewer's draft against
 * the ceiling; a candidate message cannot make the draft leak more or less, and letting one
 * into this function would create the path the policy core exists to prevent.
 */
export type DesignTurnDraft = {
  message: string;
  /** The probe family index the model claims it used, or null when it asked nothing new. */
  probeLevel: number | null;
  /** The model's own claim that it handed over an architecture. */
  revealsDesign: boolean;
};

/**
 * A component list of this length or more, in prose, is a design handed over, not a question
 * asked. Five is low on purpose: a question names at most the one component it is about.
 */
const COMPONENT_LIST_THRESHOLD = 5;

/** Component nouns, used only to count a list. The same broad vocabulary as the signals. */
const COMPONENT_RE =
  /\b(load balancer|api gateway|gateway|cache|redis|memcached|cdn|database|postgres|mysql|cassandra|dynamo\w*|mongodb|object store|blob store|s3|queue|kafka|rabbitmq|sqs|pub\/sub|message broker|worker|scheduler|shard|partition|replica|index|elasticsearch|zookeeper|etcd|service discovery|websocket|web socket|stream processor|aggregator|coordinator|rate limiter|bloom filter|consistent hash|write-ahead log)\b/gi;

/** A DDL block is a schema, which is a finished design for that component. */
const SCHEMA_RE = /\b(CREATE TABLE|CREATE INDEX|PRIMARY KEY|FOREIGN KEY|ALTER TABLE)\b/i;

/** A numbered or bulleted build order is a step-by-step construction, not a probe. */
const BUILD_ORDER_RE =
  /(?:^|\n)\s*(?:step\s*\d|\d\.|first,|then,|next,|finally,|after that,)[^\n]*\n\s*(?:step\s*\d|\d\.|first,|then,|next,|finally,|after that,)/i;

/** Count distinct component nouns in a draft. */
export function countComponents(text: string): number {
  const seen = new Set<string>();
  for (const m of text.matchAll(COMPONENT_RE)) {
    const name = m[1];
    if (name) seen.add(name.toLowerCase());
  }
  return seen.size;
}

/**
 * True when the draft is a finished architecture, not a question about one.
 *
 * Two independent shapes: a long component list, or a schema/build order. Either alone is
 * enough, because either alone is the answer.
 */
export function looksLikeDesignHandover(text: string): boolean {
  if (SCHEMA_RE.test(text)) return true;
  if (BUILD_ORDER_RE.test(text)) return true;
  return countComponents(text) >= COMPONENT_LIST_THRESHOLD;
}

/**
 * Check the interviewer's draft against the probe ceiling.
 *
 * The permitted material depends on the ceiling, not the phase string, so the two can never
 * disagree: the ceiling is the single source of truth, and `policy.ts` owns it.
 *
 * At ceiling 0 (requirements and estimation) the interviewer may confirm and ask, and nothing
 * else: no component list, no schema, no build order. From the high-level phase onward the
 * candidate has committed to components themselves, so naming several back to them is
 * confirmation, not a leak. That is why the component-list check is gated on the ceiling and
 * not applied throughout.
 *
 * The two handover checks below are deliberately NOT gated. They were gated on
 * `maxProbeLevel < 4`, and `probeCeiling` returns 4..7 in `deepdive` and the full set in `wrapup`
 * (`policy.ts`), so in those phases an interviewer turn could hand over an arbitrary architecture
 * with zero violations recorded. The ceiling is also reachable from user text: `phaseFromDrafts`
 * returns the first phase with an empty draft, so writing anything into the first four drafts
 * grants the full probe set. A handed-over design is a leak in every phase; the phase governs what
 * the interviewer ASKS, not whether a handover is recorded.
 */
export function detectDesignViolations(
  turn: DesignTurnDraft,
  opts: { maxProbeLevel: number },
): Violation[] {
  const violations: Violation[] = [];

  if (turn.revealsDesign) {
    violations.push({
      kind: "full-solution",
      detail: "self-reported handing over a design",
    });
  }

  if (looksLikeDesignHandover(turn.message)) {
    const n = countComponents(turn.message);
    violations.push({
      kind: "full-solution",
      detail:
        SCHEMA_RE.test(turn.message)
          ? "message contains a schema definition"
          : BUILD_ORDER_RE.test(turn.message)
            ? "message is a step-by-step build order"
            : `message lists ${n} components`,
    });
  }

  // A model that claims a probe family above the ceiling has escalated on its own. Checked
  // as a self-report, not inferred from the text, because the text of a hard question and an
  // easy one is not reliably distinguishable.
  if (turn.probeLevel !== null && turn.probeLevel > opts.maxProbeLevel) {
    violations.push({
      kind: "self-report",
      detail: `claimed probe level ${turn.probeLevel} but the ceiling is ${opts.maxProbeLevel}`,
    });
  }

  return violations;
}
