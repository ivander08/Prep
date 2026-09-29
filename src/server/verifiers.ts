/**
 * Verifiers: semantic correctness checks for problems with more than one valid answer.
 *
 * The imported suites assert exact equality:
 *     assert candidate(strs = ['a','b','c','d','e']) == [['a'],['b'],['c'],['d'],['e']]
 * For `group-anagrams` that is wrong: LeetCode accepts the groups in any order and the members in
 * any order, so a correct solution returning `[['e'],['d'],['c'],['b'],['a']]` is marked WRONG.
 * Measured: a correct solution was rejected for this reason. Same for `permutations`, `3sum`,
 * `subsets`, `combination-sum`, `two-sum` with multiple index pairs, and every statement that says
 * "in any order". The harness emits the raw returned value and TypeScript decides: these rules can
 * be unit-tested, a string-substituted assertion cannot, and only order-free problems are listed.
 */

export type Verdict = { pass: boolean; reason?: string };

/** Sort nested arrays by their JSON form, so [[1,2],[3]] and [[3],[1,2]] compare equal. */
function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    return x;
  };
  return JSON.stringify(norm(v));
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

/**
 * A verifier returns pass/fail for one case. `undefined` means no verifier; fall back to the strict
 * comparison.
 */
export type Verifier = (got: unknown, expected: unknown) => Verdict;

const ORDER_FREE_GROUPS: Verifier = (got, expected) => {
  const g = asArray(got);
  const e = asArray(expected);
  if (!g || !e) return { pass: false, reason: "expected a list of groups" };
  if (g.length !== e.length) return { pass: false, reason: `got ${g.length} groups, expected ${e.length}` };
  return canonical(g) === canonical(e)
    ? { pass: true }
    : { pass: false, reason: "groups differ from any accepted ordering" };
};

/** Sets of indices or values, where the answer set order is free but membership is not. */
const ORDER_FREE_FLAT: Verifier = (got, expected) => {
  const g = asArray(got);
  const e = asArray(expected);
  if (!g || !e) return { pass: false, reason: "expected a list" };
  if (g.length !== e.length) return { pass: false, reason: `got ${g.length} items, expected ${e.length}` };
  return canonical(g) === canonical(e) ? { pass: true } : { pass: false, reason: "contents differ" };
};

/**
 * `two-sum`: exactly two indices, in either order.
 *
 * The statement says "You can return the answer in any order.", and the stored suite's reference
 * answer is one specific ordering of the pair. Comparing positionally rejected the same correct
 * pair written the other way round — measured: `[i, j]` scored 72/72 and `[j, i]` scored 0/72, on
 * a problem whose statement explicitly permits both.
 *
 * No sum or range check is needed here, and adding one is not possible: a verifier sees the
 * returned value and the reference answer, not the case's arguments. That is enough, because the
 * reference answer is a pair of indices into those arguments — any answer that is the same two
 * indices IS the reference pair, and any other pair is a different pair and is rejected.
 */
const TWO_SUM_ANY_ORDER: Verifier = (got, expected) => {
  const g = asArray(got);
  const e = asArray(expected);
  if (!g || !e) return { pass: false, reason: "expected a list of two indices" };
  if (g.length !== 2 || e.length !== 2) {
    return { pass: false, reason: `expected two indices, got ${g.length}` };
  }
  if (!g.every((v) => typeof v === "number" && Number.isInteger(v))) {
    return { pass: false, reason: "indices must be integers" };
  }
  const sorted = [...g].sort((a, b) => (a as number) - (b as number));
  return sorted[0] === e[0] && sorted[1] === e[1]
    ? { pass: true }
    : { pass: false, reason: `got indices [${g.join(", ")}], expected the pair {${e.join(", ")}}` };
};

/**
 * Which problems accept more than one ordering.
 *
 * Keyed by slug. A short explicit list, not a heuristic: guessing "this looks order-free" is how a
 * false ACCEPT gets introduced, and a false accept is worse than a false reject because it teaches
 * you something untrue.
 */
const VERIFIERS: Record<string, Verifier> = {
  "two-sum": TWO_SUM_ANY_ORDER,
  "group-anagrams": ORDER_FREE_GROUPS,
  permutations: ORDER_FREE_GROUPS,
  "permutations-ii": ORDER_FREE_GROUPS,
  subsets: ORDER_FREE_GROUPS,
  "subsets-ii": ORDER_FREE_GROUPS,
  "3sum": ORDER_FREE_GROUPS,
  "4sum": ORDER_FREE_GROUPS,
  "combination-sum": ORDER_FREE_GROUPS,
  "combination-sum-ii": ORDER_FREE_GROUPS,
  "combination-sum-iii": ORDER_FREE_GROUPS,
  "letter-combinations-of-a-phone-number": ORDER_FREE_FLAT,
  "top-k-frequent-elements": ORDER_FREE_FLAT,
  "k-closest-points-to-origin": ORDER_FREE_GROUPS,
  "find-all-anagrams-in-a-string": ORDER_FREE_FLAT,
  "pacific-atlantic-water-flow": ORDER_FREE_GROUPS,
};

export function verifierFor(slug: string): Verifier | null {
  return VERIFIERS[slug] ?? null;
}
