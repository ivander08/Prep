/**
 * Engineering-depth prompts, the stack track. Eighteen questions about how a running system
 * behaves, in six groups. The prose is original; the mechanisms described are the ones any
 * production post-mortem or language specification names, and none of it is copied from a
 * book or an article. Held in code, like `design/catalog.ts`, `design/concepts.ts` and
 * `concepts/catalog.ts`, because a prose edit is then a source edit and not a migration.
 * The answer key is here and must not reach the client. `lookFor` and `commonMistakes` score
 * a written answer, so the list endpoint serves only `{slug, group, title, summary}`;
 * `getStackPrompt` carries the key and stays server-side. No code runs here: the design
 * round's grading machinery, the same rubric, the same verbatim-quote check, the same
 * `reviewItem` scheduling call.
 */

export type StackGroup = "language-depth" | "runtime" | "data" | "concurrency" | "delivery" | "debugging";

export const GROUP_LABEL: Record<StackGroup, string> = {
  "language-depth": "Language depth",
  runtime: "Runtime and memory",
  data: "Data and storage",
  concurrency: "Concurrency",
  delivery: "Delivery and operations",
  debugging: "Debugging and diagnosis",
};

export const GROUP_ORDER: StackGroup[] = [
  "language-depth",
  "runtime",
  "data",
  "concurrency",
  "delivery",
  "debugging",
];

export type StackPrompt = {
  slug: string;
  group: StackGroup;
  title: string;
  /** The question, as an interviewer would ask it. Answerable in prose, never a coding task. */
  statement: string;
  /** The one-line summary shown collapsed. */
  summary: string;
  /** What a strong answer contains. The answer key, never sent to the client. */
  lookFor: string[];
  /** Where candidates typically go wrong on this one. */
  commonMistakes: string[];
};

export const STACK_PROMPTS: StackPrompt[] = [
  // ------------------------------------------------------------- language depth
  {
    slug: "value-vs-reference",
    group: "language-depth",
    title: "Value versus reference semantics",
    statement:
      "A function mutates an argument and the caller's data changes too, in a way nobody expected. Explain why, and how you would decide whether the fix belongs in the function or in the caller.",
    summary:
      "Whether an assignment copies a value or aliases a reference decides what a mutation is visible through, and the fix is a decision about ownership rather than a keyword.",
    lookFor: [
      "Names the mechanism correctly: assignment copies a value for primitives and copies a reference for objects, arrays and maps, so two names can point at one object.",
      "Distinguishes shallow from deep copying, and says which one the language's spread or clone helper actually produces.",
      "Identifies the specific mutation as aliasing — a nested object reached through a shared parent — rather than reaching for a blanket deep-clone of everything.",
      "States where the fix belongs and why: copy at the boundary if the callee must not mutate the caller's state, or make the data immutable if the aliasing is the bug.",
      "Names the tradeoff: a deep clone on a hot path is real cost and a structured-clone of a large object is not free, so immutability by convention is often cheaper than copying by value.",
      "Mentions at least one language-level tool for the decision, such as `Object.freeze`, a readonly type, or a structural-sharing library, rather than hand-rolling a recursive clone.",
    ],
    commonMistakes: [
      "Recites \"objects are passed by reference\" and never says what actually happens to the binding versus the value.",
      "Reaches for a deep clone of every argument at every call site instead of deciding who owns the data.",
      "Confuses shallow and deep copy and asserts that a spread operator deep-clones.",
    ],
  },
  {
    slug: "closures-in-practice",
    group: "language-depth",
    title: "Closures in practice",
    statement:
      "You register three handlers in a loop and they all report the same value when they fire. Explain what the closure captured, and walk me through two ways to make each handler see its own iteration.",
    summary:
      "A closure captures the variable, not the value at the moment of definition, so a loop variable shared across iterations is shared across handlers.",
    lookFor: [
      "Names the mechanism: the handler closes over the binding, not a snapshot of its value, so a single mutable binding is observed by every handler.",
      "Distinguishes `var` from `let` and says that `let` creates a fresh binding per iteration, which is why the same loop behaves differently under each.",
      "Offers a second fix that does not rely on the loop keyword, such as a factory function taking the value as a parameter or capturing it in a local const.",
      "Explains the memory consequence: a closure keeps its captured scope alive, so a long-lived handler holds everything that scope references.",
      "Names a place this bites outside loops — an event listener that captures a stale component state, or a memoised function holding a large object it no longer needs.",
    ],
    commonMistakes: [
      "Says \"the closure captured the wrong value\" without naming the binding-versus-value distinction.",
      "Gives only the `var`-to-`let` fix and cannot produce a second approach.",
      "Never mentions that the captured scope stays reachable and can hold memory alive.",
    ],
  },
  {
    slug: "generics-and-type-erasure",
    group: "language-depth",
    title: "Generics and type erasure",
    statement:
      "A generic collection validates its elements at runtime and someone asks why the type parameter is not available there. Explain what the compiler keeps and what it throws away, and what that costs you.",
    summary:
      "Generics are usually checked at compile time and erased before the runtime sees them, so a type parameter cannot be inspected, instantiated, or used to build a runtime check.",
    lookFor: [
      "Names erasure: type parameters are a compile-time construct and are not present in the emitted code or the runtime value.",
      "States the practical consequences — no `new T()`, no `instanceof T`, no overloading on `List<A>` versus `List<B>` — and why each follows from erasure.",
      "Names the escape hatch the language provides, such as passing a constructor or a runtime type token explicitly, or boxing the check in a validation function.",
      "Contrasts erasure with reified or monomorphised generics and says what that alternative buys and costs.",
      "Connects the erasure to a real symptom, such as an unchecked cast warning, an unsafe downcast, or a collection that accepts the wrong element and fails at read time.",
    ],
    commonMistakes: [
      "Confuses compile-time generics with a runtime class token and asserts the type parameter is inspectable.",
      "Says \"generics are just syntactic sugar\" without distinguishing checking from representation.",
      "Names no workaround for the case where a runtime check is genuinely needed.",
    ],
  },

  // ---------------------------------------------------------- runtime and memory
  {
    slug: "event-loop-and-blocking",
    group: "runtime",
    title: "The event loop and blocking",
    statement:
      "A single-threaded service handles thousands of concurrent requests, yet one slow synchronous call stalls every one of them. Explain why, and how you would find the call.",
    summary:
      "One thread runs the event loop, so any work that occupies it synchronously delays every callback behind it — the concurrency is in the waiting, not in the work.",
    lookFor: [
      "Names the mechanism: a single-threaded loop drains a queue of callbacks, and a synchronous block holds the thread so nothing else can be scheduled.",
      "Distinguishes CPU-bound blocking from waiting — a synchronous filesystem read, a JSON parse of a huge payload, a `crypto` call on the main thread — because the fix differs.",
      "Names a concrete diagnostic: event-loop lag or delay monitoring, a flame graph or CPU profile, or a tracer that shows the span where the loop stopped turning.",
      "States the fixes: move the work off the main thread — a worker pool, a separate service, the async form of the API — or chunk it so the loop can interleave.",
      "States the tradeoff: workers add a serialisation boundary and a pool to size, and a separate service adds a network hop, so the fix has a cost the diagnosis has to justify.",
    ],
    commonMistakes: [
      "Says \"use async\" without naming the specific synchronous call that is holding the thread.",
      "Blames the runtime or the language rather than the blocking call on the single thread.",
      "Proposes adding more threads or more instances without explaining why one blocked loop stalls the rest.",
    ],
  },
  {
    slug: "garbage-collection-pauses",
    group: "runtime",
    title: "Garbage collection pauses",
    statement:
      "A latency-sensitive service shows p99 spikes that line up with garbage collection, while the average stays flat. Walk me through how you would confirm that and what you would change.",
    summary:
      "Collection pauses show up in the tail and not the average, so the fix is to reduce the allocation rate or the live set before reaching for a collector tuning knob.",
    lookFor: [
      "Names the mechanism: allocation triggers collection, and a stop-the-world phase or a large copy suspends the application while it runs.",
      "Distinguishes a young-generation collection from a full collection and says why the full one is the one that moves p99.",
      "Names the diagnostic: garbage-collection logging or a heap metric, a pause histogram correlated with the latency spike, and an allocation profile showing what is allocated.",
      "Names the fixes in the right order: reduce the allocation rate first — avoid per-request large buffers, reuse or pool, cut boxing — before tuning the collector.",
      "States the tradeoff of the tuning knobs: a bigger heap means fewer but longer pauses, and a low-pause collector trades throughput and CPU for latency.",
      "Mentions the live-set question: a pause that grows over time is a leak keeping objects alive, not a collector that needs tuning.",
    ],
    commonMistakes: [
      "Jumps straight to collector flags without confirming collection is the cause of the spike.",
      "Reads the average latency and concludes there is no problem.",
      "Proposes a bigger heap without saying it makes each pause longer.",
    ],
  },
  {
    slug: "memory-leak-diagnosis",
    group: "runtime",
    title: "Memory leak diagnosis",
    statement:
      "A long-running process grows steadily until it is killed by the out-of-memory killer, but a restart fixes it for a day. How would you confirm a leak rather than a cache doing its job?",
    summary:
      "A leak is a live set that only grows, so the proof is a heap snapshot that still reaches the same objects after collection rather than a rising process figure.",
    lookFor: [
      "Distinguishes a leak from a cache: a cache reaches a steady state or is bounded, a leak's live set after a full collection only grows.",
      "Names the diagnostic: take two heap snapshots separated by time and traffic, force a full collection before each, and diff the retained objects and their retaining paths.",
      "Names a likely root: an unbounded map keyed by request or session, a listener never removed, a closure holding a scope alive, a global buffer that is appended to.",
      "Names the measurement to watch over time — post-collection heap, not resident memory — and says why RSS is a misleading signal for a managed runtime.",
      "States the fix and the guard: bound the structure with an eviction policy, remove the listener, or add an alert on post-collection heap growth.",
    ],
    commonMistakes: [
      "Treats a rising process figure as proof of a leak without forcing a collection first.",
      "Calls it a leak and then raises the memory limit or restarts on a schedule instead of finding the retaining path.",
      "Names no tool and no snapshot comparison, only \"use a profiler\".",
    ],
  },

  // ------------------------------------------------------------- data and storage
  {
    slug: "index-selection",
    group: "data",
    title: "Index selection",
    statement:
      "A query that was fast for a year starts doing sequential scans after a data migration. Explain how the planner decides what to use, and how you would work out what went wrong.",
    summary:
      "The planner picks an index from statistics and cost, so a plan that changed usually means the statistics or the query shape changed rather than the index being wrong.",
    lookFor: [
      "Names the mechanism: the planner estimates rows and costs from table statistics and chooses the cheapest access path.",
      "Names the diagnostic: `EXPLAIN` or `EXPLAIN ANALYZE`, comparing the estimated row count against the actual, to find the misestimate.",
      "Identifies the usual causes of a plan flip: stale statistics after a bulk load, a type or collation mismatch that makes the index unusable, or a changed predicate.",
      "Explains why a scan can be the right plan: a predicate matching a large fraction of the table is cheaper to scan than to chase through an index.",
      "Names the composite-index rule: column order matters, and a range predicate stops the index being used for the columns after it.",
      "States a tradeoff: each index costs write amplification and storage, so an index is added for a query and paid for by every insert.",
    ],
    commonMistakes: [
      "Reaches for a hint or a force-index before reading the plan and finding the misestimate.",
      "Asserts that an index always makes a query faster, with no mention of selectivity.",
      "Adds an index without saying what it costs on writes.",
    ],
  },
  {
    slug: "transaction-isolation",
    group: "data",
    title: "Transaction isolation",
    statement:
      "Two concurrent transactions read the same row, both decide it needs updating, and one of their writes is lost. Explain which isolation level allows that and what you would do about it.",
    summary:
      "Each isolation level permits a specific anomaly, so the fix is to name the anomaly you cannot tolerate and choose the level or the locking that prevents it.",
    lookFor: [
      "Names the anomalies in order — dirty read, non-repeatable read, phantom, write skew, lost update — and which level permits each.",
      "Names the mechanism for the lost update: read-modify-write on a stale snapshot with no locking, so the second writer overwrites the first.",
      "Names the fixes and where they belong: an atomic update that does the arithmetic in the database, a row lock taken before the read, an optimistic version column with a retry, or a higher isolation level.",
      "Names the diagnostic: the transaction's isolation level, the statement that reads, and the gap between the read and the write in the log.",
      "States the tradeoff: a stronger level and a lock both reduce concurrency and add deadlock and retry pressure, so the level is chosen against the anomaly that actually matters.",
    ],
    commonMistakes: [
      "Says \"use serialisable\" without naming which anomaly the default level allowed.",
      "Describes a read-modify-write in application code as if it were atomic.",
      "Confuses locking with isolation level, or treats them as the same lever.",
    ],
  },
  {
    slug: "n-plus-one",
    group: "data",
    title: "The N+1 query",
    statement:
      "A list endpoint that returns fifty items issues fifty-one queries. Explain how that happens, how you would confirm it, and how you would fix it without changing the response.",
    summary:
      "A lazy relationship is loaded once per parent inside a loop, so the query count scales with the result size and the fix is to fetch the children in one pass.",
    lookFor: [
      "Names the mechanism: the parent list is fetched in one query and each parent's relation is loaded lazily, once per row, inside the rendering or mapping loop.",
      "Names the diagnostic: a query log or counter showing the count tracks the result size, or a tracer showing N identical statements with different ids.",
      "Names the fixes: a join or a batched `IN` fetch, an eager-load directive on the query, or a dataloader that batches and caches within a request.",
      "Names the tradeoff: a join can duplicate parent rows and needs deduplication, and eager loading everything can fetch more than a given endpoint needs.",
      "Says the response shape must not change, so the fix is in the data access layer rather than in the serialiser.",
    ],
    commonMistakes: [
      "Caches the whole list to hide the query count instead of fixing the access pattern.",
      "Adds an index, which speeds each of the fifty-one queries and leaves fifty-one of them.",
      "Proposes a join without mentioning the row duplication it causes.",
    ],
  },

  // ---------------------------------------------------------------- concurrency
  {
    slug: "race-conditions",
    group: "concurrency",
    title: "Race conditions",
    statement:
      "A counter occasionally loses an increment under load and the bug never reproduces on a developer machine. Explain how you would make it reproducible and how you would fix it.",
    summary:
      "Two interleavings of a read-modify-write can both succeed and only one increment survives, so the fix is to remove the shared mutable state or make the update atomic.",
    lookFor: [
      "Names the mechanism: a non-atomic read-modify-write, where both threads read the same value before either writes, so one increment is lost.",
      "Says why it is load-dependent: the window is small, so it needs contention and specific scheduling, which is why one machine never shows it.",
      "Names how to make it reproducible: increase concurrency and iterations, add a delay or a yield inside the critical section, or drive the interleaving with a deterministic test harness.",
      "Names the fixes: make the update atomic — a database `UPDATE ... SET x = x + 1`, a compare-and-swap, an atomic type — or remove the shared state entirely by partitioning it.",
      "Names the diagnostic that confirms it: a stress test that fails, a race detector, or a counter that disagrees with the expected total.",
    ],
    commonMistakes: [
      "Adds a log or a sleep to debug it and thereby changes the timing so the bug disappears.",
      "Says \"use a lock\" without naming what state is shared or what the lock protects.",
      "Treats it as a hardware or environment problem because it does not reproduce locally.",
    ],
  },
  {
    slug: "locks-vs-queues",
    group: "concurrency",
    title: "Locks versus queues",
    statement:
      "A team serialises work with a mutex and now the service stalls under load. Explain when a lock is the right tool and when a queue is, and how you would choose here.",
    summary:
      "A lock serialises access to shared state and makes callers wait, while a queue serialises execution and lets callers return — the choice is about whether the caller can wait.",
    lookFor: [
      "Names the difference in what is serialised: a lock holds shared state for a critical section, a queue owns a stream of work items and processes them in order.",
      "Names the failure the lock produces here: the critical section is held across a slow operation, so throughput collapses and the callers block rather than shed load.",
      "Names what a queue buys: bounded concurrency, backpressure, a natural retry and dead-letter path, and a caller that returns a receipt instead of waiting.",
      "Names what a queue costs: it is a new component, it needs idempotency on the consumer, and the result is eventually consistent.",
      "States the decision rule: if the caller needs the result synchronously, shrink the critical section and keep the lock; if it does not, move the work behind a queue.",
    ],
    commonMistakes: [
      "Says \"queues are more scalable\" without saying what the lock was protecting.",
      "Replaces a lock with a queue and never mentions that the consumer must be idempotent.",
      "Keeps the critical section across a network call and only adds a timeout.",
    ],
  },
  {
    slug: "idempotent-retries",
    group: "concurrency",
    title: "Idempotent retries",
    statement:
      "A payment is charged twice because a client retried a request that had actually succeeded. Explain how the retry should have been designed, and how you would make an endpoint safe to retry.",
    summary:
      "A retry is safe only when the operation is idempotent, so the request needs an identity the server can recognise and a record of what it already did.",
    lookFor: [
      "Names the mechanism: the client could not tell a lost response from a failed request, so it retried and the server executed the side effect a second time.",
      "Names the fix: an idempotency key supplied by the client, stored by the server with the result, so a repeat returns the original result instead of re-executing.",
      "Names the storage requirement: the key must be persisted atomically with the effect, and the record must be retained long enough to cover the retry window.",
      "Distinguishes safe methods and natural idempotency from side-effecting ones, and says which HTTP methods are expected to be idempotent.",
      "Names the wider pattern: at-least-once delivery plus idempotent consumers, and a deduplication window rather than an assumption that retries will not happen.",
      "States the tradeoff: storing every key is storage and a lookup on the hot path, and an expiry that is too short reintroduces the duplicate.",
    ],
    commonMistakes: [
      "Says \"just add retries\" without making the operation safe to repeat.",
      "Relies on a client-generated random value that is regenerated on each attempt.",
      "Assumes exactly-once delivery from the transport instead of designing the consumer to tolerate duplicates.",
    ],
  },

  // --------------------------------------------------- delivery and operations
  {
    slug: "zero-downtime-deploy",
    group: "delivery",
    title: "Zero-downtime deploy",
    statement:
      "You need to ship a change that alters a column's meaning while traffic keeps flowing. Walk me through the sequence, and say which steps are irreversible.",
    summary:
      "A zero-downtime change is a sequence of backward-compatible steps, because the old and new code run side by side for a while and both must work against the same schema.",
    lookFor: [
      "Names the constraint: during a rolling deploy both versions run at once, so every intermediate state must be readable and writable by both.",
      "Names the expand-contract sequence: add the new column nullable, dual-write to both, backfill in batches, switch reads, then remove the old column in a later release.",
      "Names the operational details: backfill in bounded batches to avoid locking and replication lag, and keep the migration online rather than taking a write lock.",
      "Names how traffic is moved: drain and deregister from the load balancer, a health check that reflects readiness, and a connection-draining window so in-flight requests finish.",
      "Names what is irreversible: once the old column is dropped or a destructive migration is applied, rolling back the code no longer restores the data.",
      "States the tradeoff: dual-writing and a nullable column carry cost and complexity for the duration of the migration, which is why the contract step should not be deferred indefinitely.",
    ],
    commonMistakes: [
      "Describes a single migration that renames the column in place, which breaks the old code still running.",
      "Runs the backfill in one unbounded statement and takes a lock on the table.",
      "Never says which step cannot be rolled back.",
    ],
  },
  {
    slug: "feature-flags",
    group: "delivery",
    title: "Feature flags",
    statement:
      "A feature is behind a flag that has been on for everyone for a year. Explain the lifecycle a flag should have and what goes wrong when it does not.",
    summary:
      "A flag is temporary control flow that decouples deploy from release, so it needs an owner and an expiry or it becomes permanent untested branching.",
    lookFor: [
      "Names the purpose: deploying code and releasing a feature are separate events, and a flag lets the code ship dark and be turned on independently.",
      "Names the flag types and their different lifetimes: a release flag is short-lived, an operational kill switch is long-lived, an experiment flag is bounded by the experiment.",
      "Names the failure mode of a stale flag: two code paths both nominally supported but only one exercised, so the untested path rots and the flag becomes an untested branch.",
      "Names the hygiene: an owner and an expiry recorded when the flag is created, and removal as an explicit follow-up task rather than a hope.",
      "Names the risk of flag evaluation itself: a flag service on the request path is a dependency, so a cached default is needed for when it is unreachable.",
    ],
    commonMistakes: [
      "Treats flags as free and never mentions removing them.",
      "Conflates a kill switch with a release flag and gives them the same lifecycle.",
      "Puts the flag check in many places and never records who owns it or when it should die.",
    ],
  },
  {
    slug: "rollback-plan",
    group: "delivery",
    title: "The rollback plan",
    statement:
      "A deploy is causing errors in production and you have five minutes to decide. Explain what you would check before rolling back and what makes a rollback unsafe.",
    summary:
      "Rollback is only a plan if the previous version and the schema it expects are still there, so the decision is about reversibility rather than about the error rate alone.",
    lookFor: [
      "Names the first checks: whether the errors started with the deploy, whether they are widespread or one path, and whether a config or flag change is a faster lever than a redeploy.",
      "Names what makes rollback unsafe: a migration that already dropped or rewrote data, a message or event format other services now depend on, or a stateful side effect that cannot be undone.",
      "Names the mechanism: redeploy the previous artefact, not a rebuild, so the version rolled back to is the one that was running.",
      "Names the alternatives to a full rollback: turn off the flag, disable the new code path, shed or rate-limit the failing route, or roll forward with a hotfix if the change is not reversible.",
      "States the preconditions decided in advance: a known-good artefact kept, a schema compatible with the previous version, and a rehearsal of the rollback rather than a first attempt under pressure.",
    ],
    commonMistakes: [
      "Rolls back first and investigates later without checking whether the deploy is actually the cause.",
      "Assumes rollback is always possible and never asks what the migration already did.",
      "Rebuilds from an older commit instead of redeploying the known-good artefact, so the rollback target is unverified.",
    ],
  },

  // ------------------------------------------------- debugging and diagnosis
  {
    slug: "read-a-stack-trace",
    group: "debugging",
    title: "Reading a stack trace",
    statement:
      "A crash report gives you a stack trace with a dozen frames and the top one is a library you have never seen. Walk me through how you would read it and where you would start.",
    summary:
      "A stack trace is the call path to the failure, so the frame to trust is the deepest one in your own code rather than the library frame where it surfaced.",
    lookFor: [
      "Reads the trace in order and distinguishes the throw site from the frames that merely propagated the error.",
      "Identifies the deepest frame in the application's own code, which is the boundary where the bad input or the violated assumption entered.",
      "Names the message and the exception type as evidence, and separates them from the frames, rather than reading the top frame as the cause.",
      "Names the practical moves: reproduce with the same input, read the library frame's contract to see what it expected, and inspect the arguments at the application frame.",
      "Accounts for the missing frames: an async boundary, a rethrow that dropped the original, a minified build with no source map, or a wrapper that swallowed the cause.",
      "Names the fix direction: correct the caller's input or assumption, and preserve the cause when rethrowing so the next trace is complete.",
    ],
    commonMistakes: [
      "Reads the top frame as the bug and starts changing the library.",
      "Ignores the exception type and message and works only from the frame list.",
      "Never considers that frames may be missing because of an async boundary or a swallowed cause.",
    ],
  },
  {
    slug: "reproduce-a-flake",
    group: "debugging",
    title: "Reproducing a flake",
    statement:
      "A test fails roughly one run in fifty and passes when you run it alone. Explain how you would turn that into a reliable reproduction rather than a guess.",
    summary:
      "A flake is a hidden dependency on time, order, concurrency or shared state, so the reproduction is an experiment that isolates which of those the failure depends on.",
    lookFor: [
      "Names the candidate causes as a list: wall-clock time or timezone, ordering or shared state between tests, unawaited asynchronous work, real concurrency, a network or filesystem dependency, and randomness without a fixed seed.",
      "Names the reproduction method: run the suite repeatedly with a fixed seed and record which run fails, or run it in a loop under load until the failure is captured with a full log.",
      "Names the isolation experiment: run the test alone versus in the suite, run it with a shuffled order, and freeze or fake the clock — each rules a cause in or out.",
      "Names what to capture when it does fail: the full log and the seeded random input, so the failure can be replayed deterministically rather than waited for again.",
      "Names the fix class once the cause is known: await the pending work, reset the shared state between tests, inject a clock, or remove the real dependency for a fake.",
    ],
    commonMistakes: [
      "Reruns the test until it passes and marks it fixed.",
      "Adds a sleep to make the timing work instead of finding the unawaited work or the race.",
      "Declares it a flaky test and skips it, which removes the signal rather than the defect.",
    ],
  },
  {
    slug: "bisect-a-regression",
    group: "debugging",
    title: "Bisecting a regression",
    statement:
      "A metric was fine last week and is degraded now, across a few hundred commits. Explain how you would find the change that caused it, and what you would check before starting.",
    summary:
      "A bisect turns a range of changes into a logarithmic search for the first bad revision, and it only works if you can define a binary test for good and bad.",
    lookFor: [
      "Names the precondition: a reproducible, binary check for whether a revision is good or bad, because a bisect with a fuzzy criterion converges on nothing.",
      "Names the method: `git bisect` over the commit range, or the deploy history if the change is only observable in an environment, halving the range each step.",
      "Names the starting bounds: a known-good revision and a known-bad revision, verified, rather than an assumed last-known-good.",
      "Names the confounders to rule out first: the metric may have shifted from traffic, a data change, a dependency release or an infrastructure change rather than a commit in the range.",
      "Names what to do at the end: confirm the culprit by reverting it in isolation or reproducing on that revision, because a bisect points at a candidate and not a proof.",
    ],
    commonMistakes: [
      "Starts bisecting without a defined pass/fail test and gets a meaningless midpoint.",
      "Assumes the regression came from an application commit and never checks the dependency or infrastructure timeline.",
      "Reports the bisected commit as the cause without confirming it in isolation.",
    ],
  },
];

export type StackPromptSummary = {
  slug: string;
  group: StackGroup;
  title: string;
  summary: string;
};

/** The list view. `statement`, `lookFor` and `commonMistakes` are stripped: the answer key must not reach the client. */
export function listStackPrompts(): StackPromptSummary[] {
  return STACK_PROMPTS.map(({ slug, group, title, summary }) => ({ slug, group, title, summary }));
}

export function getStackPrompt(slug: string): StackPrompt | null {
  return STACK_PROMPTS.find((p) => p.slug === slug) ?? null;
}
