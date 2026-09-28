/**
 * Behavioural scoring for a design round.
 *
 * Scoring reads the transcript and the drafts — both of which are the candidate's own
 * output — and never asks the model to judge quality in the abstract. Two independent things
 * happen here:
 *
 *   1. MECHANICAL SIGNALS, computed in TypeScript with no model call. These are the
 *      observable facts the model's scores are anchored to, and they are what the UI shows
 *      first — so a score can always be traced to something the candidate actually wrote.
 *   2. A MODEL'S SCORES, each of which must quote the candidate. A score with no quote is
 *      discarded and the dimension falls back to its signal-derived default, so the model
 *      cannot move a number without pointing at the text that moved it.
 *
 * The dimension names come from the two published rubrics that agree most closely: CoderPad's
 * Problem Framing / Systems Thinking / Communication / Adaptability / Depth on Demand, and
 * Hello Interview's Problem Navigation / Solution Design / Technical Excellence /
 * Communication and Collaboration. Both are scored from what the candidate *did* in the
 * transcript — did they ask before designing, did they quantify, did they name what they were
 * sacrificing — which is the same rule the rest of this app applies to code.
 */

/**
 * Rubric dimensions, named after the two published rubrics that agree most closely
 * (CoderPad's Problem Framing / Systems Thinking / Communication / Adaptability / Depth on
 * Demand, and Hello Interview's Problem Navigation / Solution Design / Technical Excellence /
 * Communication and Collaboration).
 *
 * Every dimension is scored from OBSERVABLE BEHAVIOUR in the transcript, not from the
 * model's impression: did they ask before designing, did they quantify, did they name what
 * they were giving up. That is the same rule the rest of the app follows for code.
 */
export type RubricDimension =
  | "problemFraming"
  | "systemsThinking"
  | "technicalDepth"
  | "tradeoffReasoning"
  | "communication";

export const RUBRIC_DIMENSIONS: RubricDimension[] = [
  "problemFraming",
  "systemsThinking",
  "technicalDepth",
  "tradeoffReasoning",
  "communication",
];

export const DIMENSION_LABEL: Record<RubricDimension, string> = {
  problemFraming: "Problem framing",
  systemsThinking: "Systems thinking",
  technicalDepth: "Technical depth",
  tradeoffReasoning: "Trade-off reasoning",
  communication: "Communication",
};

/**
 * The 1-4 scale the published rubrics use, where 3 is "meets expectations".
 *
 * 1-4 rather than 0-100 because the sources agree on four levels and the grader's job is to
 * place the round in a band, not to invent a percentage. It maps onto the app's FSRS grades
 * in `gradeFromScores`.
 */
export const SCORE_LABEL: Record<number, string> = {
  1: "Below expectations",
  2: "Approaching",
  3: "Meets expectations",
  4: "Strong",
};

/**
 * Mechanical signals, computed in TypeScript without a model call.
 *
 * These are the observable facts the model's scores are anchored to, and they are what the UI
 * shows first — so a score can always be traced to something the candidate actually wrote.
 */
export type Signals = {
  /** True when the requirements draft names at least one functional requirement. */
  askedFunctional: boolean;
  /** True when it names at least one non-functional requirement (availability, latency...). */
  askedNonFunctional: boolean;
  /** Count of numeric estimates in the estimation draft (QPS, storage, bandwidth, memory). */
  estimateCount: number;
  /** Count of distinct components named in the high-level draft. */
  componentCount: number;
  /** Count of explicit trade-off statements ("X over Y because..."). */
  tradeoffCount: number;
  /** True when the design names a failure mode unprompted (replication, retry, degradation). */
  namesFailure: boolean;
  /** The exact words that fired each boolean/count signal, for the UI to show as evidence. */
  matched: {
    functional: string[];
    nonFunctional: string[];
    estimates: string[];
    components: string[];
    tradeoffs: string[];
    failure: string[];
  };
};

/**
 * Requirement verbs that mark a functional requirement rather than a wish.
 *
 * Covers the vocabulary of every prompt in the catalogue, not just CRUD. A rate limiter's
 * functional requirement is "limit requests per client", and a word list without `limit` or
 * `enforce` reports that draft as having no functional requirements at all — a false negative
 * the UI would then show as a failed signal beside a draft that plainly states them.
 */
export const REQUIREMENT_WORDS = [
  "create",
  "post",
  "send",
  "upload",
  "download",
  "search",
  "retrieve",
  "fetch",
  "delete",
  "update",
  "follow",
  "subscribe",
  "join",
  "leave",
  "share",
  "view",
  "list",
  "redirect",
  "notify",
  "authenticate",
  "log in",
  "sign up",
  "rate",
  "comment",
  "edit",
  "track",
  "match",
  "reserve",
  "hold",
  "purchase",
  "pay",
  // Rate limiting, caching and storage.
  "limit",
  "enforce",
  "throttle",
  "allow",
  "reject",
  "admit",
  "expire",
  "evict",
  "cache",
  "store",
  "replay",
  "persist",
  "append",
  "log ",
  "count",
  "aggregate",
  "index",
  "query",
  "dedup",
  // Coordination and delivery.
  "publish",
  "deliver",
  "queue",
  "consume",
  "partition",
  "shard",
  "replicate",
  "elect",
  "schedule",
  "route",
  "assign",
  "map",
  "resolve",
  "generate",
];

/** Non-functional axes. A design round that never names one has skipped the phase. */
export const NON_FUNCTIONAL_WORDS = [
  "latency",
  "p99",
  "p95",
  "throughput",
  "availability",
  "consisten",
  "durab",
  "scalab",
  "fault toleran",
  "highly available",
  "eventual",
  "strongly consistent",
  "sla",
  "uptime",
  "bandwidth",
  "storage cost",
  "cost per",
  "partition toleran",
  "read-heavy",
  "write-heavy",
  "idempot",
  "at-least-once",
  "exactly-once",
  "backpressure",
  "tail latency",
  "cold start",
  "freshness",
  "staleness",
];

/** Failure and resilience vocabulary. Naming one unprompted is the strongest single signal. */
export const FAILURE_WORDS = [
  "failover",
  "replica",
  "replication",
  "retry",
  "backoff",
  "circuit break",
  "degrad",
  "fallback",
  "dead letter",
  "quorum",
  "leader election",
  "health check",
  "timeout",
  "idempot",
  "reconcil",
  "rollback",
  "drain",
  "tombstone",
  "chaos",
  "split brain",
  "rate limit",
  "bulkhead",
];

/**
 * Trade-off shapes. Two families because candidates state trade-offs two different ways:
 * explicit ("X over Y because") and comparative ("X is faster but loses Y").
 */
export const TRADEOFF_PATTERNS: RegExp[] = [
  /\bover\b[^.\n]{0,60}\bbecause\b/i,
  /\b(?:instead of|rather than)\b/i,
  /\btrade[\s-]?off\b/i,
  /\btrade[\s-]?offs\b/i,
  /\bbut\b[^.\n]{0,40}\b(?:lose|loses|cost|costs|means|sacrific|give up|gives up)\b/i,
  /\b(?:pros?|cons?)\b\s*(?:and|:)/i,
  /\b(?:the cost is|the price is|what we give up|at the expense of)\b/i,
  /\b(?:faster|cheaper|simpler|more accurate)\b[^.\n]{0,40}\bbut\b/i,
];

/**
 * Component vocabulary. Broad on purpose: the count is a signal about whether the candidate
 * named the pieces of a system at all, not a check against the prompt's own component list —
 * a candidate who invents a better component should score for it.
 */
export const COMPONENT_WORDS = [
  "load balancer",
  "api gateway",
  "reverse proxy",
  "cache",
  "redis",
  "memcached",
  "cdn",
  "database",
  "postgres",
  "mysql",
  "cassandra",
  "dynamo",
  "mongo",
  "object store",
  "s3",
  "blob store",
  "queue",
  "kafka",
  "rabbitmq",
  "sqs",
  "pub/sub",
  "worker",
  "scheduler",
  "shard",
  "partition",
  "replica",
  "index",
  "search cluster",
  "elasticsearch",
  "zookeeper",
  "etcd",
  "service discovery",
  "sidecar",
  "web socket",
  "websocket",
  "cdn edge",
  "message broker",
  "stream processor",
  "aggregator",
  "coordinator",
  "rate limiter",
  "bloom filter",
  "trie",
  "consistent hash",
  "snowflake",
  "write-ahead log",
];

/** Every occurrence of a phrase in `text`, case-insensitive, deduped, in first-seen order. */
function findWords(text: string, words: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const haystack = text.toLowerCase();
  for (const w of words) {
    if (haystack.includes(w) && !seen.has(w)) {
      seen.add(w);
      found.push(w);
    }
  }
  return found;
}

/**
 * Numeric estimates, and the reason the pattern requires a unit-ish token.
 *
 * A bare number is not an estimate: "we have 3 services" and "a 4-byte id" are not
 * quantification of scale. Requiring a magnitude suffix (k/M/B or a rate/time unit) is what
 * separates "10,000 QPS" from a number that happens to appear in the text.
 */
const ESTIMATE_RE =
  /(\d[\d,.]*\s*(?:k|m|b|thousand|million|billion|trillion)\b|\d[\d,.]*\s*(?:qps|rps|req\/s|requests? per second|writes?\/s|reads?\/s|mb|gb|tb|pb|kb|ms|s\b|sec|seconds|min|minutes|hours?|days?|years?|%))/gi;

function findEstimates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(ESTIMATE_RE)) {
    const v = m[0].trim();
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Compute the mechanical signals from the phase drafts.
 *
 * Drafts rather than the transcript: the drafts are the candidate's own structured output and
 * are where the phases actually live, so a signal that fired from a draft can be shown
 * against the field the candidate typed it into.
 */
export function extractSignals(drafts: Record<string, string>): Signals {
  const requirements = drafts.requirements ?? "";
  const estimation = drafts.estimation ?? "";
  const highlevel = drafts.highlevel ?? "";
  const deepdive = drafts.deepdive ?? "";
  const wrapup = drafts.wrapup ?? "";

  // Everything except the requirements draft, for the failure signal: naming a failure mode
  // *while writing requirements* is not the same act as naming one in the design, and the
  // design is where the signal is meaningful.
  const designText = [highlevel, deepdive, wrapup].join("\n");

  const functional = findWords(requirements, REQUIREMENT_WORDS);
  const nonFunctional = findWords(requirements, NON_FUNCTIONAL_WORDS);
  const estimates = findEstimates(estimation);
  const components = findWords(designText, COMPONENT_WORDS);
  const failure = findWords(designText, FAILURE_WORDS);

  const tradeoffs: string[] = [];
  for (const re of TRADEOFF_PATTERNS) {
    const m = designText.match(re);
    if (m) tradeoffs.push(m[0].trim());
  }

  return {
    askedFunctional: functional.length > 0,
    askedNonFunctional: nonFunctional.length > 0,
    estimateCount: estimates.length,
    componentCount: components.length,
    tradeoffCount: tradeoffs.length,
    namesFailure: failure.length > 0,
    matched: { functional, nonFunctional, estimates, components, tradeoffs, failure },
  };
}

/**
 * The score a signal set alone justifies, per dimension.
 *
 * This is the fallback, and it is also the anchor the model's score is checked against. It
 * never returns 4: a mechanical check can establish that a candidate did the thing, not that
 * they did it well, so the top band is reserved for a model that quoted evidence for it.
 */
export function signalScore(dim: RubricDimension, s: Signals): number {
  switch (dim) {
    case "problemFraming":
      if (s.askedFunctional && s.askedNonFunctional) return 3;
      if (s.askedFunctional || s.askedNonFunctional) return 2;
      return 1;
    case "systemsThinking":
      if (s.componentCount >= 6) return 3;
      if (s.componentCount >= 3) return 2;
      return 1;
    case "technicalDepth":
      if (s.estimateCount >= 4) return 3;
      if (s.estimateCount >= 1) return 2;
      return 1;
    case "tradeoffReasoning":
      if (s.tradeoffCount >= 3 && s.namesFailure) return 3;
      if (s.tradeoffCount >= 1 || s.namesFailure) return 2;
      return 1;
    case "communication":
      // Communication has no clean mechanical proxy, so it is scored on whether the round
      // produced the artefacts the phases ask for at all. Anything more specific would be
      // measuring prose length, which is not what the rubric scores.
      if (s.askedFunctional && s.componentCount >= 3 && s.estimateCount >= 1) return 3;
      if (s.askedFunctional || s.componentCount >= 3) return 2;
      return 1;
  }
}

/**
 * Map a rubric result onto the app's FSRS grades, the same way `gradeAttempt` does for code.
 *
 * `Again` is reserved for a dimension at the bottom of the scale, because one dimension at 1
 * means a part of the round did not happen at all — that is a fail, not a weak pass. The
 * thresholds are on the average of the five dimensions.
 */
export function gradeFromScores(scores: Record<RubricDimension, number>): 1 | 2 | 3 | 4 {
  const values = RUBRIC_DIMENSIONS.map((d) => scores[d] ?? 1);
  if (values.some((v) => v <= 1)) return 1;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg < 2.5) return 2;
  if (avg < 3.5) return 3;
  return 4;
}
