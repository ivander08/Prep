/**
 * Executable system-design components — the shared catalogue.
 *
 * Same shape as `concepts/catalog.ts`: one entry per component, language-independent, holding
 * the contract, the prose and the tests. Per-language code lives in `components/<lang>.ts` and
 * supplies only `starter` and `solution`.
 *
 * WHY EVERY COMPONENT IS `fn(capacity, ops) -> result[]`. The real components here are
 * stateful — an LRU cache is exercised by a sequence of operations, not by one call — and
 * `runInLanguage` makes exactly one function call per test case. Rather than add a per-operation
 * harness to five languages, a component is modelled as ONE call that takes the whole operation
 * script and returns the whole output list. Every argument and return is then drawn from the
 * vocabulary the existing harnesses already coerce (`integer`, `integer[]`, `string`,
 * `string[]`, `boolean`), so this track needs no new runner machinery at all and works in all
 * five languages on the day it lands.
 *
 * THE HASH IS PART OF THE CONTRACT. `consistent-hash` and `bloom-filter` would otherwise be
 * unsatisfiable: their output depends on the hash function, and a student cannot guess which
 * one the tests assume. It is specified in the prompt and in the starter, identically in every
 * language, as a polynomial rolling hash:
 *
 *     h = 0
 *     for each character c:  h = (h * 31 + ord(c)) % 1000003
 *
 * `consistent-hash` deliberately asserts PROPERTIES ("low" remapping, "even" spread) rather
 * than exact node assignments, so any correct ring passes and a naive modulo hash fails — see
 * the note on its tests.
 */

export type ComponentModule = "caching" | "rate-limiting" | "coordination" | "storage" | "indexing";

export type ComponentTest = { args: [number, string[]]; expected: number[] | string[] };

export type ComponentSpec = {
  slug: string;
  module: ComponentModule;
  title: string;
  /** Canonical camelCase name; per-language casing is derived by `fnNameFor`. */
  name: string;
  /** The design context: why this component exists in a real system. */
  conceptMd: string;
  /** The contract to implement, in prose, including the op string format. */
  promptMd: string;
  /** The exact `ops` encoding the starter parses, shown to the student. */
  opFormat: string;
  tests: ComponentTest[];
  prereq?: string[];
  goImports?: string[];
};

export const MODULE_LABEL: Record<ComponentModule, string> = {
  caching: "Caching",
  "rate-limiting": "Rate limiting",
  coordination: "Coordination",
  storage: "Storage",
  indexing: "Indexing",
};

export const MODULE_ORDER: ComponentModule[] = [
  "caching",
  "rate-limiting",
  "coordination",
  "storage",
  "indexing",
];

/**
 * The shared hash, stated once so the prose and the prompts cannot disagree about it.
 * Exported because the language files quote it in their starter comments.
 */
export const HASH_SPEC =
  "h = 0; for each character c: h = (h * 31 + ord(c)) % 1000003, with ord(c) the character's code point. All arithmetic fits in a signed 32-bit integer, so the same code works in every language.";

export const COMPONENTS: ComponentSpec[] = [
  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------
  {
    slug: "lru-cache",
    module: "caching",
    title: "LRU cache",
    name: "runLru",
    conceptMd: [
      "Every cache in front of a database is a bet that the recent past predicts the near",
      "future. LRU is the cheapest version of that bet: when the cache is full, evict whatever",
      "has gone longest without being touched.",
      "",
      "The implementation is a hash map plus a doubly linked list. The map gives O(1) lookup;",
      "the list gives O(1) move-to-front and O(1) eviction from the tail. Neither structure",
      "alone is enough — a map has no order, and a list has no lookup — and the whole design",
      "falls out of needing both operations in constant time.",
      "",
      "```text",
      "put 1 1   → store 1=1, most recent",
      "put 2 2   → store 2=2, most recent",
      "get 1     → hit, and 1 becomes most recent",
      "put 3 3   → full: evict 2 (least recent)",
      "get 2     → miss, -1",
      "```",
      "",
      "The trap is a `get` that returns the value without refreshing recency. It looks correct",
      "on every test that does not interleave gets and puts, which is most of them.",
    ].join("\n"),
    promptMd: [
      "Implement `runLru(capacity, ops) -> integer[]`.",
      "",
      "A `get` on a key that is present returns its value AND makes it the most recently used.",
      "A `get` on a missing key returns -1. A `put` on an existing key updates the value and",
      "makes it most recently used. A `put` that takes the cache over capacity evicts the least",
      "recently used key.",
    ].join("\n"),
    opFormat: [
      '- `"get K"`            → look up key K',
      '- `"put K V"`          → set key K to value V',
      "Each `get` appends one integer to the output: the value, or -1. `put` appends nothing.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      {
        args: [2, ["put 1 1", "put 2 2", "get 1", "put 3 3", "get 2", "get 3"]],
        expected: [1, -1, 3],
      },
      { args: [1, ["put 1 1", "put 2 2", "get 1", "get 2"]], expected: [-1, 2] },
      {
        args: [2, ["put 1 1", "put 2 2", "get 1", "put 3 3", "get 1", "get 2", "get 3"]],
        expected: [1, 1, -1, 3],
      },
      { args: [2, ["get 9", "put 1 1", "get 1"]], expected: [-1, 1] },
      {
        args: [3, ["put 1 10", "put 2 20", "put 3 30", "get 2", "put 4 40", "get 1", "get 3"]],
        expected: [20, -1, 30],
      },
    ],
  },
  {
    slug: "lfu-cache",
    module: "caching",
    title: "LFU cache",
    name: "runLfu",
    conceptMd: [
      "LFU evicts the least frequently used entry rather than the least recently used. It is",
      "better when popularity is stable — a CDN caching a popular asset should not drop it",
      "because a burst of one-off requests pushed it out — and worse when popularity shifts,",
      "because a key with a large historical count becomes effectively permanent.",
      "",
      "```text",
      "put 1 1, put 2 2   → both used once",
      "get 1              → 1 used twice, 2 used once",
      "put 3 3            → full: evict 2 (least frequent)",
      "```",
      "",
      "Ties are broken by least-recently-used, which is why this needs a recency counter as well",
      "as a frequency counter. Without a tie-break the eviction is non-deterministic and the same",
      "code produces different answers run to run.",
      "",
      "The classic hard case is a key whose frequency is 0 after insertion and has never been",
      "read: it must still be evictable, so insertion counts as one use.",
    ].join("\n"),
    promptMd: [
      "Implement `runLfu(capacity, ops) -> integer[]`.",
      "",
      "A `get` on a present key returns its value and increments its use count. A `get` on a",
      "missing key returns -1. A `put` on a new key inserts it with use count 1; a `put` on an",
      "existing key updates the value and increments its use count. Over capacity, evict the key",
      "with the lowest use count, breaking ties by least recently used.",
    ].join("\n"),
    opFormat: [
      '- `"get K"`            → look up key K',
      '- `"put K V"`          → set key K to value V',
      "Each `get` appends one integer to the output: the value, or -1. `put` appends nothing.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      {
        args: [2, ["put 1 1", "put 2 2", "get 1", "put 3 3", "get 2", "get 3"]],
        expected: [1, -1, 3],
      },
      {
        args: [2, ["put 1 1", "put 2 2", "get 1", "get 1", "put 3 3", "get 2", "get 3"]],
        expected: [1, 1, -1, 3],
      },
      { args: [1, ["put 1 1", "put 1 2", "get 1"]], expected: [2] },
      {
        args: [3, ["put 1 1", "put 2 2", "put 3 3", "get 1", "get 2", "put 4 4", "get 3", "get 1"]],
        expected: [1, 2, -1, 1],
      },
    ],
  },
  {
    slug: "ttl-cache",
    module: "caching",
    title: "TTL cache",
    name: "runTtl",
    conceptMd: [
      "A TTL cache expires entries on a clock rather than on pressure. It is what you use when",
      "staleness is the thing you are bounding — a DNS cache, a session store, a rate-limit",
      "counter — and eviction is a safety valve rather than the policy.",
      "",
      "The design decision that matters is eager versus lazy expiry. Eager means a sweeper walks",
      "the store and removes expired keys; lazy means a key is checked and discarded on read.",
      "Lazy alone leaks memory for keys nobody reads; eager alone wastes work on keys nobody",
      "reads. Production systems do both, and this exercise makes you do both.",
      "",
      "```text",
      "TTL is 3 ticks.",
      "put 1 1, tick, get 1   → 1 (age 1)",
      "tick, get 1            → 1 (age 2)",
      "tick, get 1            → -1 (age 3 = expired)",
      "```",
      "",
      "The off-by-one is the whole exercise: an entry written at clock 0 with TTL 3 is live at",
      "clock 2 and dead at clock 3, so the test is `clock >= writtenAt + TTL`.",
    ].join("\n"),
    promptMd: [
      "Implement `runTtl(capacity, ops) -> integer[]` with a fixed TTL of 3 ticks.",
      "",
      "A `tick` advances a logical clock by 1 and expires every entry whose age has reached the",
      "TTL. A `put` purges expired entries first, then inserts and, over capacity, evicts the",
      "least recently used. A `get` purges first, then returns the value and refreshes recency,",
      "or -1 if the key is absent or expired.",
    ].join("\n"),
    opFormat: [
      '- `"tick"`             → advance the clock by 1',
      '- `"get K"`            → look up key K',
      '- `"put K V"`          → set key K to value V',
      "Each `get` appends one integer to the output: the value, or -1. `tick` and `put` append nothing.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      {
        args: [2, ["put 1 1", "tick", "get 1", "tick", "get 1", "tick", "get 1"]],
        expected: [1, 1, -1],
      },
      {
        args: [2, ["put 1 1", "put 2 2", "tick", "put 3 3", "get 1", "get 2", "get 3"]],
        expected: [-1, 2, 3],
      },
      { args: [1, ["put 1 1", "tick", "put 2 2", "get 1", "get 2"]], expected: [-1, 2] },
      {
        args: [2, ["get 5", "put 1 1", "tick", "tick", "tick", "tick", "get 1"]],
        expected: [-1, -1],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  {
    slug: "fixed-window",
    module: "rate-limiting",
    title: "Fixed window limiter",
    name: "runFixedWindow",
    conceptMd: [
      "The simplest limiter: divide time into windows, count requests in the current window, and",
      "reject once the count reaches the limit. One counter and one key per window, which is why",
      "it is what people reach for first.",
      "",
      "Its flaw is the boundary burst. With a limit of 2 per 10-tick window, a client can send 2",
      "at tick 9 and 2 at tick 10 — 4 requests in two ticks against a limit of 2 per 10. The",
      "average is respected and the instantaneous rate is not.",
      "",
      "```text",
      "limit 2, window 10",
      "t 0 → allow (1 in window 0)",
      "t 0 → allow (2 in window 0)",
      "t 9 → reject",
      "t 10 → allow (window 1, count resets)",
      "```",
      "",
      "The window is `t / windowSize` with integer division, which is what makes the reset free.",
    ].join("\n"),
    promptMd: [
      "Implement `runFixedWindow(limit, ops) -> integer[]` with a window size of 10 ticks.",
      "",
      "The first argument is the per-window limit. Each request is either allowed (1) or rejected",
      "(0). A request belongs to the window `t / 10`; the counter resets when the window changes.",
    ].join("\n"),
    opFormat: [
      '- `"t N"`              → a request arriving at tick N',
      "Each op appends one integer to the output: 1 if allowed, 0 if rejected.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      { args: [2, ["t 0", "t 0", "t 0", "t 9", "t 10", "t 10"]], expected: [1, 1, 0, 0, 1, 1] },
      { args: [3, ["t 0", "t 1", "t 2", "t 3", "t 10", "t 20"]], expected: [1, 1, 1, 0, 1, 1] },
      { args: [1, ["t 5", "t 5", "t 15"]], expected: [1, 0, 1] },
      // The boundary burst this algorithm is known for: 4 requests in 2 ticks against a limit
      // of 2 per 10. A correct fixed-window limiter ALLOWS all four.
      { args: [2, ["t 0", "t 9", "t 10", "t 11"]], expected: [1, 1, 1, 1] },
    ],
  },
  {
    slug: "sliding-window-log",
    module: "rate-limiting",
    title: "Sliding window log limiter",
    name: "runSlidingWindow",
    conceptMd: [
      "The exact limiter: keep the timestamp of every accepted request and reject when the",
      "number still inside the trailing window has reached the limit. It has no boundary burst,",
      "because the window moves with the request rather than snapping to a grid.",
      "",
      "```text",
      "limit 2, window 10",
      "t 0 → allow [0]",
      "t 9 → allow [0, 9]",
      "t 10 → allow [9, 10]   (0 has left the window)",
      "t 11 → reject [9, 10, 11] would be 3",
      "```",
      "",
      "The cost is memory proportional to the limit — you store every accepted timestamp. At a",
      "limit of a million per window that is a million timestamps per client, which is why the",
      "sliding-window COUNTER approximation exists. This exercise is the exact version so the",
      "tradeoff is legible.",
    ].join("\n"),
    promptMd: [
      "Implement `runSlidingWindow(limit, ops) -> integer[]` with a window size of 10 ticks.",
      "",
      "A request at tick `t` is allowed if fewer than `limit` accepted requests fall in the",
      "half-open interval `(t - 10, t]`. An accepted request's timestamp is remembered; a",
      "rejected one is not.",
    ].join("\n"),
    opFormat: [
      '- `"t N"`              → a request arriving at tick N',
      "Each op appends one integer to the output: 1 if allowed, 0 if rejected.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      // The same case that fixed-window allows entirely: here the fourth request is rejected,
      // because 0 and 9 are both still inside the window at tick 11 only if within 10 — 0 is
      // not, 9 is, so t=10 and t=11 are the two that count.
      { args: [2, ["t 0", "t 9", "t 10", "t 11"]], expected: [1, 1, 1, 0] },
      { args: [2, ["t 0", "t 0", "t 9", "t 10"]], expected: [1, 1, 0, 1] },
      { args: [1, ["t 0", "t 10", "t 11", "t 21"]], expected: [1, 1, 0, 1] },
      { args: [3, ["t 0", "t 1", "t 2", "t 3", "t 11", "t 12"]], expected: [1, 1, 1, 0, 1, 1] },
    ],
  },
  {
    slug: "token-bucket",
    module: "rate-limiting",
    title: "Token bucket",
    name: "runTokenBucket",
    conceptMd: [
      "A bucket holds tokens, refills at a fixed rate, and every request costs one. It allows",
      "bursts up to the bucket size while enforcing a long-run average, which is why it is the",
      "limiter most APIs actually use: a client that has been idle has earned the right to",
      "burst.",
      "",
      "```text",
      "rate 2 tokens/tick, capacity 2*rate = 4 tokens, starts FULL",
      "t 0 → 4 tokens, allow, 3 left",
      "t 0 → allow, 2 left",
      "t 5 → +10 refill capped at 4, allow",
      "```",
      "",
      "Two numbers define the behaviour and they are easy to conflate: the REFILL RATE (tokens",
      "per tick) sets the sustained rate, and the CAPACITY (the bucket size) sets the largest",
      "burst. Starting full is the other decision — an empty bucket makes the first requests of",
      "a fresh process fail, which is not what a limiter is for.",
    ].join("\n"),
    promptMd: [
      "Implement `runTokenBucket(rate, ops) -> integer[]`.",
      "",
      "The bucket starts FULL at `capacity = 2 * rate` tokens and refills by `rate` tokens per",
      "tick elapsed, never exceeding capacity. Each request costs 1 token: allowed if at least",
      "one token is available, rejected otherwise. Refill happens before the request is judged.",
    ].join("\n"),
    opFormat: [
      '- `"t N"`              → a request arriving at tick N',
      "Each op appends one integer to the output: 1 if allowed, 0 if rejected.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      // Capacity 4 at rate 2: five requests at t=0 exhaust the bucket.
      { args: [2, ["t 0", "t 0", "t 0", "t 0", "t 0"]], expected: [1, 1, 1, 1, 0] },
      { args: [2, ["t 0", "t 0", "t 0", "t 5", "t 5"]], expected: [1, 1, 1, 1, 1] },
      // Capacity 2 at rate 1: two at t=0, one refill by t=1, one more by t=2.
      { args: [1, ["t 0", "t 0", "t 1", "t 2"]], expected: [1, 1, 1, 1] },
      // Capacity 6 at rate 3: the bucket refills faster than the requests consume it.
      { args: [3, ["t 0", "t 1", "t 1", "t 1", "t 1"]], expected: [1, 1, 1, 1, 1] },
    ],
  },
  {
    slug: "leaky-bucket",
    module: "rate-limiting",
    title: "Leaky bucket",
    name: "runLeakyBucket",
    conceptMd: [
      "A leaky bucket is a queue that drains at a constant rate. Requests enter the queue if",
      "there is room and leave at a fixed rate; if the queue is full the request is rejected. The",
      "output rate is therefore perfectly smooth — no bursts ever leave the system.",
      "",
      "The contrast with the token bucket is the whole point, and the two are routinely confused",
      "because they look like mirror images. A token bucket ADMITS a burst and smooths it later;",
      "a leaky bucket REJECTS the burst. Token bucket for an API where a client may burst after",
      "idling; leaky bucket for protecting a downstream that cannot absorb a burst at all.",
      "",
      "```text",
      "rate 2, capacity 2, starts EMPTY",
      "t 0 → level 0 < 2, admit, level 1",
      "t 0 → level 1 < 2, admit, level 2",
      "t 0 → level 2, full: reject",
      "t 5 → drained to 0, admit",
      "```",
      "",
      "The arithmetic is the same as the token bucket with the sign flipped: the level rises by",
      "one per admitted request and falls by `rate` per tick, clamped at zero.",
    ].join("\n"),
    promptMd: [
      "Implement `runLeakyBucket(rate, ops) -> integer[]`.",
      "",
      "The bucket starts EMPTY with `capacity = rate` and drains by `rate` units per tick",
      "elapsed, never below zero. A request is admitted if the level is below capacity, and",
      "raises the level by 1; otherwise it is rejected. Drain happens before the request is",
      "judged.",
    ].join("\n"),
    opFormat: [
      '- `"t N"`              → a request arriving at tick N',
      "Each op appends one integer to the output: 1 if admitted, 0 if rejected.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      // Capacity 2 at rate 2: the queue fills immediately and the burst is rejected, unlike the
      // token bucket on the same input.
      { args: [2, ["t 0", "t 0", "t 0", "t 0", "t 0"]], expected: [1, 1, 0, 0, 0] },
      { args: [2, ["t 0", "t 0", "t 0", "t 5", "t 5"]], expected: [1, 1, 0, 1, 1] },
      // Capacity 1 at rate 1: one admitted, then it must drain before the next.
      { args: [1, ["t 0", "t 0", "t 1", "t 2"]], expected: [1, 0, 1, 1] },
      { args: [3, ["t 0", "t 1", "t 1", "t 1", "t 1"]], expected: [1, 1, 1, 1, 0] },
    ],
  },

  // -------------------------------------------------------------------------
  // Coordination
  // -------------------------------------------------------------------------
  {
    slug: "consistent-hash",
    module: "coordination",
    title: "Consistent hashing ring",
    name: "runConsistentHash",
    conceptMd: [
      "Consistent hashing is what stops a cache cluster from collapsing when a node is added.",
      "With `key % N` sharding, going from 3 nodes to 4 remaps three quarters of all keys and",
      "every one of those is a cache miss against the origin at once. On a ring, adding a node",
      "takes over only the arc it lands on — about 1/N of the keyspace.",
      "",
      "The ring is built by hashing each node to several positions, called virtual nodes. Without",
      "them, three nodes produce three points and the arcs between them are wildly unequal; with",
      "them, each node owns many small arcs and the load evens out.",
      "",
      "```text",
      `hash: ${HASH_SPEC}`,
      "ring position: hash(nodeName + \"#\" + vnodeIndex) % 360",
      "a key maps to the first node at or after hash(key) % 360, wrapping to the lowest node.",
      "```",
      "",
      "This exercise asserts PROPERTIES rather than exact assignments. A different but correct",
      "ring implementation is still correct, so the tests check that a node addition remaps a",
      "minority of keys (\"low\") and that load is spread (\"even\") — which a naive modulo hash",
      "fails, because it remaps three quarters.",
    ].join("\n"),
    promptMd: [
      "Implement `runConsistentHash(vnodes, ops) -> string[]`.",
      "",
      "Nodes start as `a`, `b`, `c`. The ring holds `vnodes` positions per node, at",
      "`hash(name + \"#\" + i) % 360`, and a key maps to the first position at or after",
      "`hash(key) % 360`, wrapping around to the lowest position.",
      "",
      "The first argument is the virtual-node count. Ops are given below; each emits one string.",
      "For `moved`, report `\"low\"` when fewer than half the loaded keys changed node and `\"high\"`",
      "otherwise. For `spread`, report `\"even\"` when the busiest node holds at most 1.8x the",
      "average, and `\"uneven\"` otherwise. Report `\"none\"` for either op when nothing is loaded.",
    ].join("\n"),
    opFormat: [
      '- `"load N"`           → map keys "0".."N-1" through the current ring and remember them',
      '- `"node X"`           → add node X to the ring',
      '- `"moved"`            → "low" | "high" | "none", for the keys loaded before the last change',
      '- `"spread"`           → "even" | "uneven" | "none", for the keys currently loaded',
    ].join("\n"),
    goImports: ["sort", "strconv", "strings"],
    tests: [
      { args: [12, ["load 300", "spread"]], expected: ["even"] },
      // 3 nodes to 4: an ideal ring moves about 1/4 of the keys. Modulo hashing moves 3/4.
      { args: [12, ["load 300", "node d", "moved"]], expected: ["low"] },
      { args: [12, ["load 300", "node d", "node e", "moved"]], expected: ["low"] },
      { args: [12, ["load 300", "node d", "spread"]], expected: ["even"] },
      { args: [12, ["load 300", "node d", "node e", "spread"]], expected: ["even"] },
      // No node change, so nothing moves.
      { args: [12, ["load 100", "moved"]], expected: ["low"] },
    ],
  },
  {
    slug: "snowflake-id",
    module: "coordination",
    title: "Snowflake id",
    name: "runSnowflake",
    conceptMd: [
      "A database auto-increment gives unique, ordered ids and requires a central authority. A",
      "UUID needs no authority and is not sortable — which matters, because an index on a random",
      "id inserts into random pages and fragments. Snowflake is the middle: a 64-bit id that is",
      "locally generated and still sorts by time.",
      "",
      "```text",
      "| 41 bits timestamp | 10 bits worker | 12 bits sequence |",
      "id = (t << 22) | (worker << 12) | seq",
      "```",
      "",
      "The 41-bit timestamp is milliseconds since a custom epoch, which is what buys ~69 years.",
      "The worker field is what makes two machines unable to collide. The sequence field handles",
      "more than one id in the same millisecond on the same machine, and it RESETS when the clock",
      "moves forward.",
      "",
      "The real failure is clock skew: if the machine's clock jumps backwards, the generator can",
      "produce a duplicate id. Production implementations refuse to generate until the clock",
      "catches up. This exercise models the forward-only case so the bit layout is the lesson.",
    ].join("\n"),
    promptMd: [
      "Implement `runSnowflake(workerId, ops) -> string[]`.",
      "",
      "Pack each id as `(t << 22) | (workerId << 12) | seq` and return it as a DECIMAL STRING,",
      "because the value exceeds 32 bits. `seq` starts at 0 for a new millisecond and increments",
      "for each further id requested in the same millisecond.",
    ].join("\n"),
    opFormat: [
      '- `"t N"`              → generate an id for millisecond N',
      "Each op appends one decimal string to the output.",
    ].join("\n"),
    goImports: ["strconv", "strings"],
    tests: [
      {
        args: [1, ["t 1000", "t 1000", "t 1000", "t 1001"]],
        expected: ["4194308096", "4194308097", "4194308098", "4198502400"],
      },
      { args: [0, ["t 5", "t 5", "t 6"]], expected: ["20971520", "20971521", "25165824"] },
      { args: [7, ["t 42"]], expected: ["176189440"] },
      { args: [2, ["t 9", "t 10", "t 10"]], expected: ["37756928", "41951232", "41951233"] },
    ],
  },
  {
    slug: "bloom-filter",
    module: "coordination",
    title: "Bloom filter",
    name: "runBloom",
    conceptMd: [
      "A bloom filter answers \"definitely not present\" and \"probably present\" in a few bits per",
      "key. It never returns a false negative and sometimes returns a false positive. That",
      "asymmetry is the entire value: it is a cheap guard in front of an expensive lookup.",
      "",
      "```text",
      "add x   → set bits h(x), h(x+\"1\"), h(x+\"2\")",
      "check x → all three set? probably present : definitely absent",
      "```",
      "",
      "Three hash functions over one bit array is the standard small configuration. False",
      "positives rise as the array fills — at 50% full the rate is noticeable — which is why real",
      "deployments size the array from the expected key count, and why a bloom filter is usually",
      "rebuilt rather than resized.",
      "",
      "The exercise's tests assert only the direction that is guaranteed: every key that was added",
      "is found. A false positive on a key that was never added is not a bug and is not asserted",
      "against.",
    ].join("\n"),
    promptMd: [
      "Implement `runBloom(bits, ops) -> integer[]`.",
      "",
      `Three bit positions per key: \`hash(s) % bits\`, \`hash(s + "1") % bits\`, \`hash(s + "2") % bits\`,`,
      `where ${HASH_SPEC}`,
      "",
      "The first argument is the array size in bits.",
    ].join("\n"),
    opFormat: [
      '- `"add S"`            → set the three bit positions for key S',
      '- `"check S"`          → 1 if all three positions are set, 0 otherwise',
      '- `"bits"`             → the number of bits currently set',
      "- `add` appends nothing; `check` and `bits` each append one integer.",
    ].join("\n"),
    goImports: ["strings"],
    tests: [
      { args: [64, ["add apple", "check apple", "check banana", "bits"]], expected: [1, 0, 3] },
      {
        args: [128, ["add a", "add b", "add c", "check a", "check b", "check c", "bits"]],
        expected: [1, 1, 1, 9],
      },
      { args: [32, ["check x", "bits", "add x", "check x"]], expected: [0, 0, 1] },
      { args: [256, ["add hello", "add world", "check hello", "check world"]], expected: [1, 1] },
    ],
  },

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------
  {
    slug: "wal-kv",
    module: "storage",
    title: "Write-ahead log KV store",
    name: "runWalKv",
    conceptMd: [
      "A write-ahead log is how a store survives a crash: the operation is appended to the log",
      "before it is applied, so replaying the log reconstructs the state. Every database you have",
      "used does this, and it is why a crash loses the last few milliseconds rather than the",
      "whole file.",
      "",
      "```text",
      "set 1 10   → log: [set 1 10], state: {1: 10}",
      "del 1      → log: [set 1 10, del 1], state: {}",
      "replay     → rebuild state by applying the log in order",
      "```",
      "",
      "The log grows without bound, which is why compaction exists: once the log exceeds a",
      "threshold, replace it with one `set` per live key. That is safe because a replay of the",
      "compacted log reaches the same state — the log is a history of operations and the snapshot",
      "is a history that happens to be minimal.",
      "",
      "The subtle part is that compaction must run after the operation is applied, not before, or",
      "the log and the state disagree for the duration of the compaction.",
    ].join("\n"),
    promptMd: [
      "Implement `runWalKv(capacity, ops) -> integer[]`.",
      "",
      "The first argument is the log size that triggers compaction. `set` and `del` append to the",
      "log and apply immediately. When the log exceeds `capacity`, compact it to one `set` per",
      "live key, ordered by key. `replay` rebuilds the state by applying the log in order, and",
      "`logsize` reports the current log length.",
    ].join("\n"),
    opFormat: [
      '- `"set K V"`          → set key K to value V',
      '- `"del K"`            → remove key K',
      '- `"get K"`            → the value, or -1 if absent',
      '- `"replay"`           → rebuild state from the log',
      '- `"logsize"`          → the number of entries in the log',
      "- `set`, `del` and `replay` append nothing; `get` and `logsize` each append one integer.",
    ].join("\n"),
    goImports: ["sort", "strconv", "strings"],
    tests: [
      {
        args: [100, ["set 1 10", "set 2 20", "get 1", "get 2", "del 1", "get 1"]],
        expected: [10, 20, -1],
      },
      // capacity 2: three sets push the log to 3 entries, so it compacts — but compaction
      // replaces 3 entries with 3 live keys, so the size is still 3.
      { args: [2, ["set 1 10", "set 2 20", "set 3 30", "logsize"]], expected: [3] },
      { args: [100, ["set 1 10", "del 1", "replay", "get 1"]], expected: [-1] },
      // Three writes to one key compact to a single entry.
      { args: [2, ["set 1 10", "set 1 11", "set 1 12", "replay", "get 1", "logsize"]], expected: [12, 1] },
      { args: [100, ["get 7", "set 7 70", "get 7"]], expected: [-1, 70] },
      {
        args: [3, ["set 1 1", "set 2 2", "set 3 3", "set 4 4", "replay", "get 1", "get 4"]],
        expected: [1, 4],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------
  {
    slug: "inverted-index",
    module: "indexing",
    title: "Inverted index",
    name: "runInvertedIndex",
    conceptMd: [
      "An inverted index maps a term to the documents containing it. It is the structure behind",
      "every full-text search: without it, finding a word means reading every document, and with",
      "it, the answer is one lookup plus a merge.",
      "",
      "```text",
      "index 1 cat dog",
      "index 2 dog bird",
      "search dog → 1,2",
      "search cat → 1",
      "```",
      "",
      "The postings list is kept sorted so that multi-term queries can be intersected by a",
      "merge rather than a hash — the same reason a merge join beats a nested loop when both",
      "sides are sorted.",
      "",
      "Two things make the real version hard and this one instructive: the vocabulary is large,",
      "so postings lists are stored on disk and compressed with delta encoding; and the top-K",
      "results need ranking, which is why a limit is part of the contract here rather than an",
      "afterthought.",
    ].join("\n"),
    promptMd: [
      "Implement `runInvertedIndex(limit, ops) -> string[]`.",
      "",
      "`index D t1 t2 ...` adds document D to the postings list of each term. `search T` returns",
      "the ids of the documents containing T, ascending, joined with commas, truncated to the",
      "first `limit` ids. A term with no documents returns an empty string.",
    ].join("\n"),
    opFormat: [
      '- `"index D t1 t2 ..."` → add document D to each listed term\'s postings list',
      '- `"search T"`         → the comma-joined document ids for term T, ascending, at most `limit`',
      "- `index` appends nothing; `search` appends one string.",
    ].join("\n"),
    goImports: ["sort", "strconv", "strings"],
    tests: [
      {
        args: [10, ["index 1 cat dog", "index 2 dog bird", "search dog", "search cat", "search fish"]],
        expected: ["1,2", "1", ""],
      },
      { args: [1, ["index 1 a", "index 2 a", "index 3 a", "search a"]], expected: ["1"] },
      { args: [10, ["index 1 cat", "index 1 dog", "search cat"]], expected: ["1"] },
      { args: [2, ["index 5 z", "index 1 z", "index 3 z", "search z"]], expected: ["1,3"] },
      { args: [10, ["search nothing", "index 4 x y", "search x", "search y"]], expected: ["", "4", "4"] },
    ],
  },
];
