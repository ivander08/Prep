/**
 * Pattern reference cards: the runtime.
 *
 * The catalogue is static prose; the only thing computed here is which problems to drill the
 * pattern with. That list comes from the database so it cannot go stale against the problem set:
 * a card that hard-coded three slugs would start recommending problems the user already solved,
 * and would break entirely on a re-ingest.
 *
 * No code execution is involved, so unlike `concepts.ts` there is no `metaFor`/`inferType` here.
 */

import { db } from "./db.ts";
import {
  PATTERN_REFS,
  getPatternRef,
  type PatternRef,
  type Priority,
} from "./reference/catalog.ts";

/** A reference card plus the problems to drill it with. */
export type PatternRefView = PatternRef & {
  /** Unsolved problems of this pattern in roadmap order, or solved ones if none are unsolved. */
  recommended: Array<{ slug: string; title: string; difficulty: string }>;
};

type DrillRow = { slug: string; title: string; difficulty: string };

/**
 * The problems to drill a pattern with, in roadmap order.
 *
 * Unsolved first, because the useful recommendation is what to do next. When every problem in the
 * pattern is solved the same query runs without the `NOT EXISTS` clause, so the card offers
 * something to re-solve instead of an empty list under a "Drill this pattern" heading.
 */
function recommended(pattern: string, listName: string): DrillRow[] {
  const unsolved = db
    .query<DrillRow, [string, string]>(
      `SELECT p.slug, p.title, p.difficulty
       FROM problems p
       JOIN lists l ON l.qid = p.qid AND l.name = ?
       WHERE p.pattern = ?
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.qid = p.qid AND a.passed = 1)
       ORDER BY l.position ASC
       LIMIT 3`,
    )
    .all(listName, pattern);

  if (unsolved.length > 0) return unsolved;

  return db
    .query<DrillRow, [string, string]>(
      `SELECT p.slug, p.title, p.difficulty
       FROM problems p
       JOIN lists l ON l.qid = p.qid AND l.name = ?
       WHERE p.pattern = ?
       ORDER BY l.position ASC
       LIMIT 3`,
    )
    .all(listName, pattern);
}

/**
 * The card for one pattern, or null when the pattern has no card.
 *
 * Null, not a throw: the pattern vocabulary is ingested, so a pattern added by a later ingest
 * legitimately has no card yet and the roadmap renders nothing for it.
 */
export function getPatternRefView(pattern: string, listName = "neetcode150"): PatternRefView | null {
  const ref = getPatternRef(pattern);
  if (!ref) return null;
  return { ...ref, recommended: recommended(pattern, listName) };
}

/** Every pattern's interview weight, so the roadmap can order without a per-pattern query. */
export function patternPriorities(): Record<string, Priority> {
  const out: Record<string, Priority> = {};
  for (const r of PATTERN_REFS) out[r.pattern] = r.priority;
  return out;
}
