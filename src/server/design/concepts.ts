/**
 * The design concept library: sixty-one short tradeoff notes in seven groups, the topic index
 * for the design round. The prose is original. `Designing Data-Intensive Applications` and the
 * ByteByteGo System Design Handbook served only as a topic index (a checklist of what a design
 * round touches) and an accuracy check on the mechanisms; no text from either is reproduced.
 *
 * Held in code, like `design/catalog.ts`, `concepts/catalog.ts` and `patterns.ts`, so a prose
 * edit is a source edit, not a migration. Every concept names the PROBE FAMILIES it answers,
 * as indices into `PROBE_FAMILIES` in `design/policy.ts`: the round's probe ladder walks the
 * same eight families, so a weak dimension in a finished round can point at the concept that
 * covers it, and a group of notes answering no probe family is one the round never asks about.
 */

export type ConceptGroup =
  | "foundations"
  | "replication"
  | "caching"
  | "partitioning"
  | "storage"
  | "messaging"
  | "resilience";

export const GROUP_LABEL: Record<ConceptGroup, string> = {
  foundations: "Foundations",
  replication: "Replication & consistency",
  caching: "Caching",
  partitioning: "Partitioning",
  storage: "Storage engines",
  messaging: "Messaging & delivery",
  resilience: "Resilience",
};

export const GROUP_ORDER: ConceptGroup[] = [
  "foundations",
  "replication",
  "caching",
  "partitioning",
  "storage",
  "messaging",
  "resilience",
];

export type DesignConcept = {
  slug: string;
  group: ConceptGroup;
  title: string;
  /** The one-line answer, shown collapsed. */
  summary: string;
  /** The note. 120-220 words, markdown, ending in the tradeoff, not a definition. */
  bodyMd: string;
  /** Indices into `PROBE_FAMILIES` (design/policy.ts) that this concept answers. */
  probeFamilies: number[];
  /** Design prompts from `design/catalog.ts` this most often comes up in. */
  prompts: string[];
};

export const DESIGN_CONCEPTS: DesignConcept[] = [
  // ---------------------------------------------------------------- foundations
  {
    slug: "back-of-envelope",
    group: "foundations",
    title: "Back-of-envelope estimation",
    summary:
      "Fix the write rate, the record size and the retention window, and the arithmetic decides which components exist — the number is only useful as a bracket, because the assumption behind it is what gets audited.",
    bodyMd: `Estimates are a design tool, not a formality: they decide which components exist at all. The method is to fix the write rate, multiply by the size of one record and the retention window, then divide by a node's capacity to get a machine count. Rounding hard is the point — 86,400 seconds in a day becomes 100,000, and a byte per second becomes a terabyte per day. The tradeoff is that every estimate is wrong by an order of magnitude in some dimension, so the number is only useful as a bracket: if 40 TB of storage is required and the largest single box holds 16 TB, partitioning is forced, and if the answer had been 4 TB it would not be.

What fails is using the estimate as if it were a measurement. An estimate that assumed uniform keys produces a capacity plan that collapses the first time traffic is skewed, and an estimate that forgot replication multiplies the storage answer by three in production. State the assumption next to the number, because the assumption is the part that gets audited — the arithmetic is usually fine.`,
    probeFamilies: [0, 4],
    prompts: ["rate-limiter", "ticketmaster", "youtube"],
  },
  {
    slug: "latency-numbers",
    group: "foundations",
    title: "Latency numbers every engineer should know",
    summary:
      "A handful of comparative figures — nanoseconds in memory, milliseconds on disk, a hundred milliseconds across a continent — bound what a design can do, and treating them as guarantees rather than floors produces a p99 ten times the estimate.",
    bodyMd: `The numbers worth carrying are the ones that decide whether a design is possible: a memory read is roughly 100 ns, an SSD read 100 microseconds, a disk seek 10 ms, a round trip inside a datacenter under 1 ms, and a cross-continent round trip 100 to 150 ms. Their value is comparative, not absolute. They say that reading from cache instead of disk is a thousandfold change, and that any design where one request fans out to another continent has spent its latency budget before doing any work.

The tradeoff is that these figures are capacity-planning inputs, not promises. A 1 ms intra-datacenter hop is the floor when the network is idle; under load, queueing adds an order of magnitude and the same hop becomes 10 ms. Treating the table as a guarantee produces a design whose p99 is ten times its estimate, because the estimate modelled transfer time and ignored contention.

The failure is arithmetic that is correct and useless: a fan-out of 100 services at 1 ms each is 100 ms of pure network, which no amount of faster disk will fix. The answer is structural — fewer hops or a parallel fan-out — not a faster machine.`,
    probeFamilies: [0, 4],
    prompts: ["twitter-feed", "search-autocomplete"],
  },
  {
    slug: "availability-nines",
    group: "foundations",
    title: "Availability and the nines",
    summary:
      "Three nines is 43 minutes a month and every further nine costs more than the last, so the budget has to be spent deliberately on redundancy and failover rather than claimed.",
    bodyMd: `Availability is a budget, and the nines are how the budget is spent. Three nines allows about 43 minutes of downtime a month, four nines about four minutes, five nines about 26 seconds. The figures are computed against the whole month, so a single unplanned 10-minute restart already consumes a quarter of a three-nines month, and the interesting work is deciding where those 43 minutes go.

The tradeoff is that each additional nine costs more than the last, and the cost lands in different places: redundancy, automated failover, and the testing that proves the failover works. Two services each at 99.9% in series give 99.8%, so composing services silently spends the budget — which is why a dependency graph full of three-nines components cannot produce a four-nines system without adding parallel paths or a degraded mode.

What fails is claiming a number that nothing measures. An availability target with no health check, no failover drill and no per-endpoint measurement is a wish, and the first incident is when the real figure appears. Write the target down, then design the mechanism that keeps it and the probe that would notice it slipping.`,
    probeFamilies: [1, 4],
    prompts: ["notification-system", "chat-slack"],
  },
  {
    slug: "slo-vs-sla",
    group: "foundations",
    title: "SLO versus SLA",
    summary:
      "An SLO is set stricter than the SLA so the contract is never what wakes you up, and the error budget it creates turns reliability into a decision about what to ship.",
    bodyMd: `An SLA is a contract with a customer and carries a penalty; an SLO is an internal target set strictly tighter so the contract is never the thing that wakes you up. If the SLA promises 99.9%, the SLO is 99.95%, and the error budget — the 0.05% you are allowed to miss — is what the team spends on deploys and experiments. The budget turns reliability into an engineering decision instead of an argument: burn it and you freeze risky changes, stay under it and you ship.

The tradeoff is that the tighter number has to be measured the way the customer experiences it. A backend metric that excludes the load balancer, the CDN and the client retry will report five nines while users see three, because the failures that annoy people are the ones at the edge.

The failure is an SLO nobody enforces. If the budget can be exceeded indefinitely with no consequence it is decoration, and the first sign the SLA was breached is the invoice. The change request that follows an incident — a new endpoint, a stricter dependency — should be priced against the remaining budget rather than argued on taste.`,
    probeFamilies: [1, 3],
    prompts: ["notification-system", "google-drive"],
  },
  {
    slug: "tail-latency",
    group: "foundations",
    title: "Tail latency",
    summary:
      "Measure p99 rather than the mean because one slow request in a hundred is the one users leave over, and fan-out across shards makes the request's tail the shard's far tail.",
    bodyMd: `Measure p99 rather than the mean because the mean hides the users who leave. A service whose median is 20 ms and whose p99 is 2 s looks fine in an average and is unusable for one request in a hundred, and at a page that makes 20 backend calls, one page load in five contains a slow call. The tail is not noise to be averaged away; it is the experience of a measurable fraction of traffic.

Fan-out is what turns a tail into the common case. If a request waits on 100 shards and any one of them can be slow, the request's latency is the maximum of 100 draws, so the p99 of the request is roughly the p99.99 of the shard. Hedged requests — send to a second replica after the p95 deadline and take the first answer — cut this at the cost of extra load, and they only help when the work is idempotent.

The failure is optimising the average: a change that trims 2 ms off the median and adds a garbage-collection pause that doubles the p99 makes the dashboard better and the product worse.`,
    probeFamilies: [0, 5],
    prompts: ["twitter-feed", "search-autocomplete"],
  },
  {
    slug: "load-parameters",
    group: "foundations",
    title: "Load parameters",
    summary:
      "Name the one number everything scales with — and its peak, not its average — or every later capacity decision is unfalsifiable.",
    bodyMd: `A load parameter is the one number the whole design scales with, and choosing it is the first real decision: for a feed it is writes per second, for a crawler it is pages per second, for a ticket sale it is requests per second in a ten-second window. Everything else — shard count, queue depth, cache size, connection pool — is derived from it, so an unstated parameter means every later number is unfalsifiable.

The tradeoff is that a single parameter cannot describe a spiky workload. The peak-to-average ratio is what actually sizes the system: a service at 1,000 rps average and 20,000 rps at the top of the hour needs capacity for the peak and pays for it all day, which is where autoscaling, queues and load shedding earn their keep.

What fails is a design that quietly assumed the average. A ticket sale is the canonical case: the load is 50,000 requests in the first minute and almost nothing afterwards, so a fleet sized for the daily average melts at the on-sale while a fleet sized for the peak idles for 23 hours. Name the peak, then decide what happens to the excess.`,
    probeFamilies: [0],
    prompts: ["ticketmaster", "twitter-feed"],
  },
  {
    slug: "stateless-vs-stateful",
    group: "foundations",
    title: "Stateless versus stateful services",
    summary:
      "Stateless services restart and scale freely and pay a hop per request; stateful ones are fast until the instance is replaced, so the question is where the state lives, not which is better.",
    bodyMd: `A stateless service keeps nothing between requests, so any instance can serve any request and a load balancer is free to route anywhere; a stateful one holds per-client data — a session, a cursor, an open connection — and that data has to live somewhere the request can find it. The choice is not moral: stateless services scale horizontally and restart without ceremony, and stateful ones avoid a network hop and a serialisation step on every operation.

The tradeoff is where the state goes. Pushing it into a shared store or a signed token makes the service stateless and adds a dependency and a round trip to every request; keeping it in the instance is fast until the instance is replaced, at which point the client's session is gone. Sticky routing hides the problem for a while and then fails precisely during a rolling deploy, when the session it needs has just been moved.

The change request that breaks a stateless design is usually a long-lived one: live presence, a collaborative document, a streaming cursor. Those want the state to be an addressable object with a home — a room, a shard, an actor — rather than a piece of connection-local memory.`,
    probeFamilies: [3],
    prompts: ["web-crawler", "url-shortener"],
  },
  {
    slug: "idempotency",
    group: "foundations",
    title: "Idempotency",
    summary:
      "Make the operation safe to repeat under a client-supplied key, and the retry that would otherwise duplicate a charge becomes free.",
    bodyMd: `An idempotent operation produces the same result whether it runs once or five times, which is what makes retries safe: the network drops a response, the client retries, and the second execution must not charge the card again. The usual mechanism is a client-supplied key stored with the operation's outcome — the first request writes the key and the result, later requests with the same key return the stored result instead of doing the work.

The tradeoff is the store. The key table has to be written and read atomically with the effect, or a crash between them leaves either a duplicate charge or a lost one, so the key lives in the same transaction as the state change, and the table grows with every request and needs an expiry that matches the client's retry window. Too short and a late retry duplicates; too long and the table is a second database.

The hostile input is the natural test: a client that replays a malformed request with a reused key, or two clients that collide on a key, should get the stored outcome rather than a second side effect. Operations with no natural key — sends, transfers, appends — need one invented, and the invention is where the bugs live.`,
    probeFamilies: [2, 5],
    prompts: ["ticketmaster", "notification-system"],
  },

  // ---------------------------------------------------------------- replication
  {
    slug: "single-leader",
    group: "replication",
    title: "Single-leader replication",
    summary:
      "One writer gives a total order over updates and costs a failover event and a write bottleneck; the hard part is deciding what happens to the old leader's unreplicated tail.",
    bodyMd: `One node accepts writes and streams its change log to followers, which apply the changes in order. Reads can go anywhere; writes have one address. That single write path is what gives the system a total order over updates, which is why almost every transactional database starts here — no conflict resolution, no quorum, just a log applied in sequence.

The tradeoff is the leader. It is a write bottleneck, a failover event, and a single place where a network partition can split the world into a leader that no longer deserves the name and a majority that has elected a new one. Failover also has to decide whether the old leader's unreplicated tail is committed: discard it and you lose acknowledged writes, keep it and you have two histories. Synchronous replication removes that ambiguity by making the client wait for a follower, at the cost of a write that stalls whenever the follower is slow.

What fails in practice is the failover, not the steady state. The leader is fine for months and then a 30-second election window drops writes, promotes a lagging replica, and leaves the split-brain case to be discovered by whoever reconciles the data afterwards. Moving off a single leader means a period with two writers and an explicit rule for which one wins.`,
    probeFamilies: [4, 6],
    prompts: ["chat-slack", "google-drive"],
  },
  {
    slug: "multi-leader",
    group: "replication",
    title: "Multi-leader replication",
    summary:
      "Several writers keep working through a partition and make conflicts normal, so every merge rule is a policy that silently discards one of the two writes.",
    bodyMd: `Several nodes accept writes and exchange them asynchronously, so a writer never waits on a distant peer. Each leader applies local writes immediately and forwards them as a stream of operations, which the other leaders merge into their own history. It is the natural fit for a system spread across regions, or across devices that must keep working while offline.

The tradeoff is that the same record can be written twice in two places and both writes are valid. Merge rules decide the outcome: last-write-wins by a clock that cannot order events, per-field merge for independent attributes, or an application rule that joins both values. Every rule is a policy, and each one loses information — last-write-wins silently discards one of the two writes, which for a counter is a lost update and for a document is lost work.

What fails is assuming the merge is invisible. A calendar that accepts two bookings for the same slot has resolved a conflict that should have been rejected, and the fix is not a better clock but a constraint that forces the second write to be a decision rather than a merge. Use multi-leader where writes are genuinely independent or offline, and a single leader where they are not.`,
    probeFamilies: [3, 4],
    prompts: ["google-drive", "chat-slack"],
  },
  {
    slug: "leaderless-quorum",
    group: "replication",
    title: "Leaderless replication and quorums",
    summary:
      "W + R > N makes reads and writes overlap, which is not the same as linearizable — the price of always accepting a write is a read that can miss it.",
    bodyMd: `No leader: the client writes to several replicas and reads from several, and the write is considered durable when W replicas acknowledge while a read consults R, with W + R > N so the sets overlap. Tuning W and R trades write latency against read latency against the chance of a stale read, and the failure of any single node is absorbed by the remaining quorum.

The tradeoff is that overlapping sets are not the same as linearizability. A write can be acknowledged by a quorum and then lost if the replicas holding it fail before the read set includes them, so the system needs read repair, hinted handoff or anti-entropy to converge — and until it does, two readers can see two histories. Sloppy quorums keep availability through a partition by writing to nodes outside the home set, which is exactly when the read path may miss the write.

The outage probe is the interesting one: losing one replica is free, losing a majority stops writes but not reads, and a partition can leave both sides believing they are the majority unless the quorums actually intersect. Dynamo-style stores are built for availability on the write path and accept that reads may be behind.`,
    probeFamilies: [1, 4],
    prompts: ["chat-slack", "ticketmaster"],
  },
  {
    slug: "replication-lag",
    group: "replication",
    title: "Replication lag",
    summary:
      "Asynchronous followers mean reads can be behind, and the workflows that assume otherwise — read your own write, read in order — fail exactly when the lag widens.",
    bodyMd: `Followers apply the leader's log asynchronously, so there is always a window — milliseconds to seconds — in which they are behind. Reads served from a follower therefore return a state the leader has already moved past, and the gap widens when the follower is busy, when the network is congested, or when a bulk write arrives faster than one replica can replay it.

The tradeoff is read capacity against read freshness. Sending every read to the leader guarantees the latest state and puts the entire read load on one node; spreading reads to followers multiplies capacity and returns stale rows. The lag is not constant, so a design that is correct on average is wrong at the moment it matters — the second after a user submits a form, the minute after a leader failover.

What fails is a workflow that assumes read-after-write without saying so. A comment appears, the page reloads, the follower has not applied the write, and the comment is gone; the user submits it again. The fixes are per-request, not global: route the author's own reads to the leader, remember a version for that session, or write a token the follower can wait on. Choosing none of them means the bug appears under exactly the load the design was built for.`,
    probeFamilies: [1, 5],
    prompts: ["twitter-feed", "news-feed"],
  },
  {
    slug: "read-your-writes",
    group: "replication",
    title: "Read-your-writes consistency",
    summary:
      "Route a user's reads to the leader for a window, or carry a version token, because a follower serving the next page has not necessarily seen the write.",
    bodyMd: `Read-your-writes is the guarantee that a user who just wrote something will see it on their next read, even though reads are served by a replica that may not have applied the write yet. The mechanism is per-user routing: pin that session's reads to the leader for a short window, carry a version token from the write and make the replica wait until it has reached that version.

The tradeoff is that the guarantee is scoped to one user and costs either leader read capacity or a wait on the replica. Pinning everyone to the leader after any write collapses the read scaling the followers existed to provide; waiting on a token adds the lag as latency to the read, and a lagging replica can turn a 5 ms read into a 500 ms one. The cheap version — remember the last write timestamp in the session and require the replica to be at least that fresh — still fails if the replica is far behind.

What fails is applying the rule to the wrong scope. The user sees their own edit, then reloads a page served by a different service reading a different replica, and the guarantee is gone. It is a property of the read path, so every path that serves that user's data has to honour it.`,
    probeFamilies: [5],
    prompts: ["twitter-feed", "chat-slack"],
  },
  {
    slug: "monotonic-reads",
    group: "replication",
    title: "Monotonic reads",
    summary:
      "Pin a user's reads to replicas that are at least as fresh as the last one, or they will watch a value revert between two page loads.",
    bodyMd: `Monotonic reads guarantee that a user never sees time run backwards: once they have read a value, later reads will not return an older one. The mechanism is affinity — a given user's reads consistently land on the same replica, or on a replica known to be at least as fresh as the last one they read from. Without it, a request can be served by a caught-up replica and the next by a lagging one, and the user watches a value revert.

The tradeoff is routing freedom. Pinning reads for affinity means an unbalanced assignment and a replica that becomes a hot spot for the sessions it owns; the alternative, a freshness token that follows the session, is more flexible and more machinery. Both add state to a path that would otherwise be a stateless fan-out.

What fails is a UI that is correct per request and wrong across two. A message list loads with the new message, the next poll hits a different replica, and the message vanishes and returns — which users read as data loss, not as replication lag. The boundary probe is the one that finds it: two reads in a row from the same user, seconds apart, against different replicas.`,
    probeFamilies: [5],
    prompts: ["chat-slack", "news-feed"],
  },
  {
    slug: "conflict-resolution",
    group: "replication",
    title: "Conflict resolution",
    summary:
      "Every replicated write needs a merge rule, and each rule — last-write-wins, per-field, keep-both — destroys something, so the rule is the specification.",
    bodyMd: `Concurrent writes to the same key need a rule, and the rule is where a replicated system's semantics actually live. The options are to prevent the conflict with a lock or a quorum, to detect and merge it, or to detect and surface it. Merging is done by a data type with a defined join — a counter that sums, a set that unions, a register that keeps a timestamp — or by an application rule that combines the fields.

The tradeoff is that every automatic rule destroys information. Last-write-wins is the cheapest and loses the other write entirely, which is fine for a display name and catastrophic for a balance. Per-field merge preserves more and produces states neither client ever wrote. Keeping both versions and asking a human is correct and pushes the problem into the product, where someone has to build the merge UI.

The hostile input is the test that matters: a client that writes with a clock far in the future wins every conflict forever, so wall-clock timestamps are an attack surface unless the clock is a logical counter or a hybrid the server can clamp. Decide what a conflict means before choosing the mechanism: the merge rule is the specification, and every retry and offline edit exercises it.`,
    probeFamilies: [2, 3],
    prompts: ["google-drive", "chat-slack"],
  },
  {
    slug: "cap-and-consistency-models",
    group: "replication",
    title: "CAP and consistency models",
    summary:
      "Under a partition you give up either availability or linearizability, and consistency is a per-operation choice along a spectrum, not a label for the system.",
    bodyMd: `CAP is a statement about a network partition, not a menu for ordinary days: when the network splits, a system must choose between refusing some requests and answering with data that may be stale. The useful part is the constraint it names — you cannot have both linearizable consistency and availability across a partition — and the useless part is calling a system "CP" or "AP" without saying which operation, because a single system usually makes the choice per request.

The tradeoff is that consistency is not binary. Linearizability is the strictest, then sequential and causal, then read-your-writes and monotonic reads, then eventual. Each step down the list is cheaper and gives up a guarantee someone will notice, and the design work is naming the weakest level each operation can tolerate — a balance read wants linearizability, a like count does not.

What fails is a system that claims strong consistency on the strength of a single-leader setup and then serves reads from a lagging replica. The consistency model is a property of the whole read and write path, caches and queues included, and has to be stated per operation. Under partition the choice is real: the side that cannot reach the quorum must block writes or accept divergence, and someone has to decide which before the incident.`,
    probeFamilies: [4, 6],
    prompts: ["ticketmaster", "chat-slack"],
  },
  {
    slug: "consensus-raft",
    group: "replication",
    title: "Consensus and Raft",
    summary:
      "A majority vote gives agreement and a total order on the metadata that needs it, at the cost of a round trip per commit and a log that must never become the data plane.",
    bodyMd: `Consensus is how a group of nodes agrees on a single value — a leader, a log position, a membership change — while some of them are unreachable. Raft makes it legible: candidates request votes for a term, a candidate with a majority becomes leader, and the leader replicates entries to followers, committing an entry once a majority has it. Terms and log indexes are the ordering, and a stale log cannot win an election.

The tradeoff is that every committed write costs a round trip to a majority before it is durable, and the group tolerates failures only up to a minority — three nodes lose one, five lose two. Adding nodes adds fault tolerance and adds latency to every commit, so the size is chosen against the failure it must survive, not against the machine budget. A partition that separates the leader from the majority stops writes until a new election, and the election timeout is the knob that trades recovery speed against spurious elections under load.

What fails is using consensus for the data plane. Running every request through the log makes it the throughput ceiling and the blast radius, which is why it belongs on metadata — leader election, configuration, locks — and not on the requests themselves.`,
    probeFamilies: [1, 6],
    prompts: ["ticketmaster", "chat-slack"],
  },

  // ------------------------------------------------------------------- caching
  {
    slug: "cache-aside",
    group: "caching",
    title: "Cache-aside",
    summary:
      "Read the cache, fall back to the store, invalidate on write, so the cache is a pure optimisation — with a cold start and a write race that a TTL has to bound.",
    bodyMd: `The application reads the cache first and, on a miss, reads the database and populates the cache itself. Writes go to the database and invalidate the key, so the cache is a pure optimisation that can be dropped at any time and the system still works, just slower. That property is why it is the default: no write path depends on the cache being up.

The tradeoff is that the pattern has three round trips in the miss case and a race in the write case. A read that misses reads the database, and a concurrent write updates it and deletes the key before the reader's populate lands — the stale value is now cached with no expiry, and it stays until the TTL or the next write. Deleting rather than updating the key narrows the window but does not close it; a short TTL bounds the damage.

What fails is the cold start after a deploy or a flush: with the cache empty, every request reaches the database, which is the capacity the cache was hiding. That is the multiplier probe — the cache is what makes the read volume survivable, so the design has to say what the database does for the minutes it takes to warm.`,
    probeFamilies: [0, 4],
    prompts: ["twitter-feed", "news-feed"],
  },
  {
    slug: "write-through-vs-write-back",
    group: "caching",
    title: "Write-through versus write-back",
    summary:
      "Write-through keeps the cache a correct mirror at the cost of a store write per update; write-back absorbs bursts and loses the dirty entries if the cache node dies.",
    bodyMd: `Write-through updates the cache and the store in the same operation, so the cache is never behind; write-back updates the cache and marks the entry dirty, flushing it to the store later, usually in batches. Write-through makes the cache a mirror and the read path always correct; write-back makes the cache the source of truth for a window and turns many small writes into fewer large ones.

The tradeoff is latency and durability. Write-through pays a store write on every update, which is exactly the write amplification the cache was supposed to remove, and it writes data that may never be read. Write-back absorbs bursts and cuts store traffic, and it loses the dirty entries if the cache node dies — the writes that were acknowledged are gone. Replicating the cache narrows that loss and adds another consistency problem to solve.

The failure is choosing write-back for the throughput and then treating the cache as disposable. An eviction policy that drops a dirty entry under memory pressure is silent data loss, so write-back caches need a durable backing log or replication, and a flush path that survives a restart. Write-through is the safe default; write-back is a throughput decision with a durability bill attached.`,
    probeFamilies: [4, 6],
    prompts: ["google-drive", "twitter-feed"],
  },
  {
    slug: "eviction-policies",
    group: "caching",
    title: "Eviction policies",
    summary:
      "LRU, LFU and their variants are guesses about reuse, and the one that matters is the one that does not collapse when the working set exceeds the cache.",
    bodyMd: `When the cache is full something has to go, and the policy decides what that costs. LRU evicts the least recently used entry and matches access patterns where recency predicts reuse; LFU keeps the popular entries and adapts slowly, so it protects a stable hot set and fails when the workload shifts; FIFO and random are cheap and surprisingly hard to beat when access is uniform. The right question is not which policy is best but what the miss penalty is, because a policy is only worth its bookkeeping if the misses it prevents are expensive.

The tradeoff is that every policy is a guess about the future. LRU is defeated by a scan — one sequential read through a large table evicts the entire working set, which is why real caches use segmented LRU or a scan-resistant variant. LFU is defeated by a stale popularity count and needs decay, or an entry that was hot last week never leaves.

What fails is a working set larger than the cache. No policy fixes that; the hit rate falls to the ratio of cache to working set and the database takes the rest. Size the cache against the working set before choosing how to evict.`,
    probeFamilies: [0, 5],
    prompts: ["twitter-feed", "search-autocomplete"],
  },
  {
    slug: "ttl-and-staleness",
    group: "caching",
    title: "TTL and staleness",
    summary:
      "A TTL is the staleness bound for a key, and jitter matters more than the length, because a set of keys that expires together is a spike on the origin.",
    bodyMd: `A TTL bounds how long a cached value can be wrong, and picking it is picking the amount of staleness the product tolerates. The mechanism is simple — the entry is treated as absent after the deadline and the next reader repopulates it — and the useful part is that the bound is a property of the key, not of the write path, so it holds even when an invalidation is missed.

The tradeoff is between hit rate and freshness, and between load and correctness. A short TTL keeps values close to the truth and sends more requests to the origin; a long one raises the hit rate and means an update can be invisible for the whole window. Adding a random fraction to each TTL spreads the expiry times, which matters more than the length: without jitter, a batch of keys written together expires together and the origin sees a spike instead of a trickle.

What fails is a TTL that was set once and never revisited. A key whose TTL is a day is a day of stale reads on the one field that turned out to be updated constantly, and the fix is per-key TTLs chosen against how often the underlying data changes, not one global number chosen for the cache as a whole.`,
    probeFamilies: [5],
    prompts: ["news-feed", "twitter-feed"],
  },
  {
    slug: "cache-stampede",
    group: "caching",
    title: "Cache stampede",
    summary:
      "When a popular key expires, every request misses at once and the origin serves the whole population — single-flight or staggered TTLs, and each costs something.",
    bodyMd: `When a popular key expires, every request that was hitting it misses at the same instant, and all of them go to the origin together. The origin, which was serving a fraction of the traffic, now serves all of it, and the surge is worst exactly for the keys that are most requested — so the effect is a thundering herd on the database for the duration of one repopulation, repeated on every expiry.

Two fixes, with different costs. Single-flight, where the first miss takes a lock and the rest wait for its result, collapses the herd into one query; the cost is that every waiter blocks on the leader, so a slow origin query now blocks the whole set, and the lock needs a timeout or the key is dead until it clears. Staggered TTLs, adding jitter to the expiry so a set of keys never dies together, spread the repopulation in time; the cost is that freshness is now uneven and the jitter has to be large relative to the query.

The failure without either is a self-inflicted outage that repeats on a schedule, and it gets worse as the cache gets better at its job: the higher the hit rate, the more traffic the miss releases at once.`,
    probeFamilies: [0, 1],
    prompts: ["twitter-feed", "news-feed"],
  },
  {
    slug: "hot-key",
    group: "caching",
    title: "Hot keys",
    summary:
      "One key cannot be spread by sharding it, so a hot key saturates one node while the fleet idles, and the fixes are local caching, replication or key splitting.",
    bodyMd: `A hot key is one key receiving a disproportionate share of requests — a celebrity's profile, a trending topic, a single product on sale — and it breaks the assumption that load spreads across a cluster. Sharding by key cannot help, because the key is one key: it lives on one shard, one cache node, one connection, and the rest of the fleet is idle while that one instance saturates.

The tradeoff is that the usual remedies each cost something. Caching the value at the edge or in a process-local tier removes the network hop and multiplies the effective capacity by the number of callers, at the cost of memory in every instance and a staleness window that varies per instance. Replicating the hot key across several nodes with a random choice on read spreads the load and needs a broadcast or a short TTL to keep the copies aligned. Splitting the key into N sub-keys and aggregating adds a fan-in step and turns a read into N reads.

What fails is treating a hot key as a capacity problem. Adding shards does nothing, and the probe is the one that finds it: the single most requested key, at the peak of its popularity, against a fleet sized for the average. Detect it with per-key metrics, not per-node ones.`,
    probeFamilies: [0, 5],
    prompts: ["twitter-feed", "ticketmaster"],
  },
  {
    slug: "cdn-and-edge",
    group: "caching",
    title: "CDN and edge caching",
    summary:
      "Serving from the edge removes the network hop and makes invalidation a broadcast, so the cache key and the TTL are correctness decisions, not tuning.",
    bodyMd: `A CDN puts copies of content close to users, so the request never crosses the network that would have added latency and the origin serves each object once per edge rather than once per user. The mechanism is a cache with a geographic distribution and a routing layer that sends each client to the nearest point of presence; the origin sets cache headers and the edge obeys them.

The tradeoff is control. Anything cacheable at the edge is also hard to invalidate: purging is a broadcast that takes time to reach every point of presence, and a stale object at the edge is served to everyone behind it. Signed URLs and short TTLs bound the exposure and complicate the application. Dynamic, personalised responses do not belong at the edge at all — caching them risks serving one user's page to another, which is a security bug rather than a performance one.

What fails is a purge that is assumed to be instant. An incident response that "just purges the CDN" leaves the wrong object live in regions the purge has not reached, and a cache key that omits a header or a query parameter quietly serves the wrong variant. Design the cache key deliberately: everything that changes the response belongs in it, and nothing else.`,
    probeFamilies: [0, 3],
    prompts: ["youtube", "news-feed"],
  },
  {
    slug: "negative-caching",
    group: "caching",
    title: "Negative caching",
    summary:
      "Caching the absence of a value protects the origin from a stream of unique misses, and the cost is that a thing created during the TTL stays invisible.",
    bodyMd: `Negative caching stores the fact that a lookup found nothing — a missing user, a free username, a 404 — so repeated requests for absent data do not reach the origin. It matters because the miss path is usually the expensive one: a lookup by a nonexistent key scans, and an attacker can generate a stream of unique missing keys, each of which is a cache miss and a full query.

The tradeoff is that absence is a claim that expires. A username registered a second after the negative entry was written stays unavailable for the TTL, so a registration flow that checks availability and then writes can reject a name the user just chose. The TTL for negative entries therefore wants to be shorter than for positive ones, and the create path has to write through the negative entry rather than relying on expiry.

What fails is a negative entry that outlives the thing it denies. A deleted-then-recreated object, a retried request against a key that was provisionally absent, a DNS-style record where the client caches the NXDOMAIN longer than the server intended — each is a bug that only appears when the timing lines up. Cap the negative TTL, and make the write path invalidate.`,
    probeFamilies: [2, 5],
    prompts: ["search-autocomplete", "url-shortener"],
  },
  {
    slug: "cache-invalidation",
    group: "caching",
    title: "Cache invalidation",
    summary:
      "Expiry is passive and always stale for a window; explicit invalidation is immediate and only as good as the writer's list of caches, which is why versioned keys are usually the answer.",
    bodyMd: `There are only two ways to invalidate: expire the entry and let the next reader repopulate, or tell the cache the value changed. Expiry is passive and self-healing but always stale for some window; explicit invalidation is immediate and requires the writer to know every cache that holds the key — which, with a local tier in every process and an edge in every region, is a set nobody can enumerate.

The tradeoff is that the choice determines where correctness lives. Expiry puts it in the TTL, which is a single number for a whole class of keys and cannot express that one field changes every second while another changes weekly. Explicit invalidation puts it in the write path, where a missed publish leaves a stale value forever, so it needs the TTL as a backstop anyway.

The change request that exposes this is a new reader — a new service, a new materialised view, a new edge location — that nobody remembered to add to the invalidation fan-out. Versioned keys sidestep it: the value's identity includes its version, so a write produces a new key and every reader naturally picks it up, at the cost of garbage that only expiry collects.`,
    probeFamilies: [3, 4],
    prompts: ["news-feed", "twitter-feed"],
  },

  // -------------------------------------------------------------- partitioning
  {
    slug: "hash-vs-range-partitioning",
    group: "partitioning",
    title: "Hash versus range partitioning",
    summary:
      "Hash spreads writes evenly and destroys ordering; range preserves ordering and concentrates writes, so the partition key follows the query, not the load.",
    bodyMd: `Hash partitioning applies a function to the key and assigns the result to a partition, which spreads writes evenly and destroys ordering; range partitioning keeps contiguous key ranges together, which preserves ordering and concentrates writes on whatever range is hot. The choice follows from the query: a lookup by exact key wants the hash, a scan over a time range or a sorted listing wants the range.

The tradeoff is that the write pattern and the query pattern pull in opposite directions. Hashing gives a uniform distribution and makes range queries expensive, because the rows that are adjacent in key space live on different nodes and the query becomes a scatter-gather. Ranging makes sequential reads cheap and turns an append-heavy workload into a single hot partition at the end of the range, which is the case every time-series table hits.

What fails is choosing one and needing the other. A hash-partitioned store that later needs "give me everything between two dates" either scans every partition or grows a secondary index to compensate. The change request is the probe that finds it: adding a query the partition key cannot serve is a redesign, not a config change, so name the access pattern before choosing the function.`,
    probeFamilies: [3, 4],
    prompts: ["url-shortener", "ticketmaster"],
  },
  {
    slug: "consistent-hashing",
    group: "partitioning",
    title: "Consistent hashing",
    summary:
      "Put keys and nodes on a ring so a membership change moves only one node's share, and pay for it with a membership protocol every client has to agree on.",
    bodyMd: `Consistent hashing places both keys and nodes on a ring, and each key belongs to the next node clockwise. Adding or removing a node moves only the keys in the arc it now owns — roughly 1/N of the total — instead of the near-total reshuffle that modulo arithmetic causes. That property is what makes a cache cluster able to grow without a cold start, and it is the reason the technique exists.

The tradeoff is that the ring is only as balanced as the node placement. A handful of nodes land unevenly and one owns a double share of the keys; the standard fix is to give each node many positions on the ring, which is virtual nodes. Membership changes also need a protocol — who owns the ring, how a new node learns its arc, how clients find the current map — and that coordination is the actual complexity, not the hash function.

What fails is a ring whose membership is stale on the clients. A client with an old view sends a key to a node that no longer owns it, and the node either serves a miss or fetches from the right owner. It is used well beyond caches: partition assignment, sharding and load balancing all lean on the same ring.`,
    probeFamilies: [0, 3],
    prompts: ["url-shortener", "ticketmaster"],
  },
  {
    slug: "virtual-nodes",
    group: "partitioning",
    title: "Virtual nodes",
    summary:
      "Giving each machine many ring positions averages out the hash's imbalance and makes the unit of recovery a virtual node instead of a machine.",
    bodyMd: `A virtual node is one physical machine taking many positions on the hash ring instead of one. With a single position per node, the variance in how much of the ring each node owns is enormous — with ten nodes, some own 5% and some own 20% — and the imbalance persists because it is a property of the hash, not of the load. Assigning each machine a hundred positions averages the arcs and brings every node close to its fair share.

The tradeoff is bookkeeping and churn granularity. The ring now holds thousands of entries and every client needs the map, so membership changes are bigger messages. The benefit is that the unit of movement is a virtual node rather than a machine: when a node dies, its hundred arcs are redistributed across the survivors in proportion, and when it returns it takes them back, which is finer-grained recovery than a machine-level rebalance.

What fails is choosing the virtual-node count by feel. Too few and the imbalance returns; too many and the map and the membership protocol dominate. The count should be derived from the acceptable spread — the point is a bounded imbalance, and the probe is one node failing and the survivors' load after the ring settles.`,
    probeFamilies: [1, 5],
    prompts: ["ticketmaster", "url-shortener"],
  },
  {
    slug: "rebalancing",
    group: "partitioning",
    title: "Rebalancing",
    summary:
      "Move whole partitions between nodes while serving traffic, which is why the partition count is fixed and large and the assignment never derives from the node count.",
    bodyMd: `Rebalancing moves partitions between nodes when the cluster grows, shrinks or becomes uneven. The rule that matters is that a rebalance must move as little data as possible and must not depend on a partition count that cannot change: a fixed number of partitions, many more than nodes, lets a node take whole partitions from another and nothing else moves. Deriving the assignment from a hash of the node count — modulo N — invalidates every key on every change and is the mistake the fixed-partition scheme exists to avoid.

The tradeoff is the duration of the move. A rebalance copies data while serving traffic, so the source has to keep serving reads for its partitions until the transfer commits, and the new owner has to catch up on writes that arrived during the copy. Cutting over early loses writes; cutting over late extends the window in which two nodes can answer for the same range.

What fails is an automatic rebalance triggered by a transient condition. A node that is briefly slow looks underloaded and attracts partitions it then cannot serve, and a flapping health check starts a copy storm. Throttle the movement and require the change to persist before acting on it — this runs against live traffic, not in a maintenance window.`,
    probeFamilies: [3, 6],
    prompts: ["ticketmaster", "google-drive"],
  },
  {
    slug: "hot-partitions",
    group: "partitioning",
    title: "Hot partitions",
    summary:
      "A hot partition comes from the key, not the traffic, so the fix changes what the key is and the average utilisation metric will never show it.",
    bodyMd: `A hot partition is one shard taking far more than its share of the load, and it usually comes from the partition key, not from the traffic. A key like a timestamp puts every new write at the end of the range; a key like a country code concentrates a large population on one shard; a key like a user id is only even if the users are. The fleet has capacity and the requests queue behind one node.

The tradeoff is that fixing it means changing what the key is, and that changes the queries the store can serve cheaply. Adding a random suffix to a hot key spreads writes and makes reading one entity a scatter across N partitions. Splitting the range spreads writes and leaves the sub-ranges that are still hot. Isolating the hot tenant onto its own shard protects everyone else and leaves that shard unredundant.

What fails is measuring the average. A cluster reporting even node utilisation can still have a partition over capacity while others idle, because the metric is aggregated. The probe is the single hot entity at its peak: name the partition key, then say what happens when one value of it receives a thousand times the traffic of the rest, because with a monotonic key that is the expected case.`,
    probeFamilies: [0, 5],
    prompts: ["twitter-feed", "ticketmaster"],
  },
  {
    slug: "secondary-indexes",
    group: "partitioning",
    title: "Secondary indexes on partitioned data",
    summary:
      "A local index scatters every read across partitions and keeps writes cheap; a global index makes reads cheap and writes distributed and eventually consistent.",
    bodyMd: `A secondary index maps an attribute that is not the partition key to the rows that carry it, and in a partitioned store it has to be built one of two ways. A local index is written alongside the data on each partition, so a query has to be sent to every partition and the results merged; a global index is partitioned by the indexed attribute, so the query goes to one partition and the write has to update a partition that may be on another node, asynchronously.

The tradeoff is read fan-out against write fan-out. Local indexes keep writes single-partition and make every read a scatter-gather whose cost grows with the partition count; global indexes make reads cheap and turn a write into a distributed update that can be stale, so a row written a moment ago may not yet appear in the index. Neither is wrong, but the read path's latency and the index's freshness are decided by the choice.

What fails is assuming the index is consistent with the data. A global index updated asynchronously returns an empty result for a row that exists, and a local index needs the query to tolerate one partition timing out. Decide per query: exact lookup against a global index, or a scan across local ones.`,
    probeFamilies: [3, 4],
    prompts: ["search-autocomplete", "twitter-feed"],
  },
  {
    slug: "request-routing",
    group: "partitioning",
    title: "Request routing",
    summary:
      "Someone has to know which node owns a key, and the choice between a client map, a routing tier and a coordinator is a choice about where a stale map hurts.",
    bodyMd: `Someone has to know which node owns a key, and the options form a spectrum of coupling. A client-side map is fastest — the client hashes and connects directly, no hop — and every client must be updated when membership changes. A routing tier is a stable address that holds the map, so clients stay simple and the tier becomes a hop and a scaling concern. A coordinator node forwards each request to the owner, which is convenient and doubles the network cost of every operation.

The tradeoff is where a stale map hurts. With client-side routing, a client holding an old map sends a key to the wrong node, and the node must either proxy it or reject it; with a routing tier, only one place needs updating, but that tier is now on the critical path and its failure takes the whole cluster with it.

What fails is a routing layer that caches the map too long. During a rebalance the map is changing and every stale entry is a misrouted request — the probe is a node going down, where the map has to be correct within the failover window, and a client that retries against a dead owner without refreshing makes the outage look longer than it is.`,
    probeFamilies: [1, 4],
    prompts: ["url-shortener", "ticketmaster"],
  },
  {
    slug: "celebrity-problem",
    group: "partitioning",
    title: "The celebrity problem",
    summary:
      "Fan-out is asymmetric, so push is cheap on average and explosive at the top while pull is the reverse — the usual answer is hybrid and the threshold moves.",
    bodyMd: `The celebrity problem is the fan-out asymmetry: most users have a handful of followers and a few have tens of millions, so any operation that touches every follower is fine on average and impossible at the top. A push model writes each post into every follower's feed, which is cheap for the many and a write storm for the few; a pull model reads from every followee when a feed is opened, which is cheap for the few and a scatter-gather for a user who follows thousands.

The tradeoff is which side pays. Pure push makes reads fast and writes explode at the top; pure pull makes writes trivial and every feed read a fan-in over the follow graph. The usual answer is hybrid: push for ordinary accounts, pull for the ones above a follower threshold, so the celebrity's post is fetched at read time by the readers who care. The threshold is a moving target and the two paths have to produce a consistent feed.

What fails is a design that picked one model without measuring the distribution. The probe is the single account with fifty million followers posting once, and the second-order question is what happens when two such accounts post in the same second. Count the fan-out at the tail before choosing.`,
    probeFamilies: [0, 5],
    prompts: ["twitter-feed", "news-feed"],
  },

  // ------------------------------------------------------------------- storage
  {
    slug: "b-tree-vs-lsm",
    group: "storage",
    title: "B-tree versus LSM tree",
    summary:
      "B-trees update in place for predictable reads and fragment; LSM trees append for fast writes and pay read and space amplification, until compaction falls behind.",
    bodyMd: `A B-tree updates pages in place and keeps the tree balanced, so a read follows a short path of known depth to a page that is already the current value; an LSM tree buffers writes in memory, sorts them into immutable files and merges files in the background, so a write is an append and a read may have to check several files and a bloom filter.

The tradeoff is write throughput against read amplification and space. The LSM absorbs writes far faster because it never seeks to modify a page, which is why write-heavy workloads land there, and it pays with read amplification, background compaction competing for I/O, and space amplification from versions not yet collected. The B-tree has predictable read latency and a write that costs a page write plus a WAL append, and it fragments over time.

What fails is compaction falling behind. An LSM under sustained write pressure reaches a state where the merge cannot keep up and read latency degrades as the number of files grows — the same workload that was fast for months becomes slow in a way that looks like a mystery until you look at the pending compactions. Migrating between the two is not a config change; it means rewriting the data.`,
    probeFamilies: [4, 6],
    prompts: ["chat-slack", "ticketmaster"],
  },
  {
    slug: "write-ahead-log",
    group: "storage",
    title: "Write-ahead log",
    summary:
      "Append the change before applying it, and a crash replays into a consistent state — at the cost of a disk write per commit and a checkpoint that must keep up.",
    bodyMd: `A write-ahead log appends the intended change to durable storage before the change is applied to the data structure, so a crash can replay the log and reconstruct the state. The rule is ordering, not content: the log record must be on disk before the page it describes, and that ordering is what turns a random in-place update into a recoverable one. Every database with a B-tree has one, and it is why a commit is a sequential append rather than a tree walk.

The tradeoff is that durability now costs a write and a group commit. Waiting for each record to reach disk makes every transaction a disk round trip; batching several transactions into one flush amortises it and widens the window in which an acknowledged commit is not yet durable. The log also grows, so it needs checkpointing — periodically flush the dirty pages and truncate — and the checkpoint interval trades recovery time against background I/O.

What fails is a checkpoint that never completes under load, leaving a log that grows until the disk fills, at which point the database stops accepting writes. The outage probe is the restart: recovery replays from the last checkpoint, so the checkpoint frequency is the recovery time, and a log that was never truncated is an outage measured in hours.`,
    probeFamilies: [1, 6],
    prompts: ["chat-slack", "ticketmaster"],
  },
  {
    slug: "sstables-and-compaction",
    group: "storage",
    title: "SSTables and compaction",
    summary:
      "Immutable sorted files make reads binary searches and merges the background work that bounds them, and the engine fails when compaction cannot absorb the write rate.",
    bodyMd: `An SSTable is a sorted, immutable file of key-value pairs, written once and never modified; the log-structured engine's job is to produce them from an in-memory table and merge them in the background. Because each file is sorted, a lookup is a binary search within a file and a check of a few candidates, and a bloom filter per file answers "not here" without a read. Compaction merges several files into one, discarding overwritten keys and tombstones, which is what keeps the number of files bounded.

The tradeoff is that compaction is invisible work competing with the work you asked for. It consumes disk bandwidth and CPU, and the merge bounds read amplification — too little and reads check too many files, too much and the engine rewrites data that has not changed. The write amplification is real: one logical write is rewritten several times as it moves through levels.

What fails is a compaction strategy that never catches up. The pending work grows, reads slow down, and space amplification rises because versions are not collected, all while the disk is busy rewriting. The probe is the sustained write rate: the engine is fine at a burst and falls over at a rate slightly above what compaction can absorb, and the threshold is not obvious from the dashboard.`,
    probeFamilies: [0, 6],
    prompts: ["chat-slack", "youtube"],
  },
  {
    slug: "column-oriented-storage",
    group: "storage",
    title: "Column-oriented storage",
    summary:
      "Column layout and compression make analytical scans cheap and single-row writes expensive, so it is the wrong engine for a transactional path.",
    bodyMd: `A column store keeps the values of one column together instead of one row, so a scan that needs three of fifty columns reads only those three. The layout also compresses far better, because a column holds values of the same type and often with low cardinality, so run-length and dictionary encoding shrink it by an order of magnitude, and the compressed blocks can be skipped with metadata about their min and max. That combination is why analytical queries over billions of rows finish in seconds.

The tradeoff is the write path. Rows arrive one at a time and the column layout wants them batched and sorted, so writes are buffered and flushed as large immutable blocks, and a single-row update means rewriting a block or maintaining a delta. Point lookups by a non-sort key are slow because the row is spread across many files. A column store is the wrong engine for a transactional workload and a bad one for a single-row fetch.

What fails is using it as a general store because the analytics are fast. The probe is the change request: adding an interactive, per-row update path to a column store means either a delta table that complicates every read or a separate row store alongside it.`,
    probeFamilies: [0, 3],
    prompts: ["youtube", "google-drive"],
  },
  {
    slug: "index-types",
    group: "storage",
    title: "Index types",
    summary:
      "Match the index to the predicate — hash for equality, tree for range, postings for text — and remember every index is a tax on the write path.",
    bodyMd: `An index is a structure that answers a query without reading the whole table, and the type has to match the predicate. A hash index answers equality only; a B-tree answers equality and range and, when the sort order matches, avoids a sort; a full-text index maps terms to postings lists and answers ranked matching, not substring; a geospatial index handles proximity; a bloom filter answers "definitely not present" cheaply and is a filter, not an index. Choosing the wrong one leaves the query doing a scan with an index attached that never gets used.

The tradeoff is that every index costs write time and storage. Each one has to be updated on every insert and update, and a table with six indexes writes seven times, so the read path improves and the write path degrades, which matters in a write-heavy system. An index that is never used is pure cost, and finding it means reading the query plans.

What fails is adding indexes until the query is fast. The audit: for each index, name the query it serves and the plan that uses it. An index added for a query that later changed is a tax with no benefit, and a composite index whose column order does not match the predicate is one the planner cannot use.`,
    probeFamilies: [4],
    prompts: ["search-autocomplete", "google-drive"],
  },
  {
    slug: "schema-evolution",
    group: "storage",
    title: "Schema evolution",
    summary:
      "Add optional fields and never change a name's meaning, and a schema change becomes expand, backfill, switch, contract — each step independently revertible.",
    bodyMd: `A schema changes while old and new code are both running and old and new data both exist. The compatible way is to add optional fields with defaults, never reuse a name with a new meaning, and let readers ignore fields they do not know — which works because both ends agree on the wire format and can be deployed in either order. Avro, Protobuf and Thrift formalise this with a registry and compatibility rules; a JSON column does it by convention, and nothing enforces the convention.

The tradeoff is that compatibility constrains the change. Removing a field is a two-phase operation: stop writing it, deploy everywhere, then delete it, because a reader that still expects it breaks the moment it is gone. Renaming is the same. Widening a type is safe in one direction and silently truncating in the other, and a required field cannot be added to an existing record at all.

What fails is a migration that runs in one deploy. The time machine is the interesting case: the schema has to change while traffic is flowing, so the sequence is expand, backfill, switch reads, contract — and each step has to be independently revertible. A backfill that assumes the new field is populated will run against rows written before the deploy.`,
    probeFamilies: [3, 6],
    prompts: ["google-drive", "chat-slack"],
  },
  {
    slug: "blob-vs-metadata",
    group: "storage",
    title: "Blobs versus metadata",
    summary:
      "Keep the bytes in an object store and the queryable fields in a database, and accept that the two are not atomic, so a reconciler has to sweep the orphans.",
    bodyMd: `Metadata is small, queried and updated constantly; a blob is large, written once and read whole. Putting them in the same store makes every query drag the blob's size through the query path and every blob write contend with the rows around it, so the usual split is a database for the metadata and an object store for the bytes, with the metadata row holding the blob's key.

The tradeoff is that the two stores are not atomic together. A write that stores the blob and then the row can fail between them, leaving an orphaned object or a row pointing at nothing, so the order matters and a reconciler has to sweep. A delete has the same problem in reverse. Serving a download then takes two lookups — authorise from the metadata, stream from the object store — and the second hop has to be authorised too, or the object store becomes a public bucket.

What fails is a delete that removes the row and leaves the bytes. Storage grows with content nobody can reach, and only the billing shows it. The boundary probe is the small file: an object store per 4 KB thumbnail pays a request and a latency for something a row could hold, so the split needs a size threshold.`,
    probeFamilies: [3, 5],
    prompts: ["youtube", "google-drive"],
  },
  {
    slug: "data-retention",
    group: "storage",
    title: "Data retention",
    summary:
      "Retention is a growth rate with a deadline, and partitioning by time makes the delete a partition drop instead of a tombstone storm.",
    bodyMd: `Retention is a design decision with a date attached: every table has a growth rate, and the growth rate determines when the storage, the backup and the query latency stop working. The mechanism is a policy per class of data — keep the raw event for 30 days, the hourly aggregate for a year, the monthly rollup forever — so the volume of what is stored shrinks as it ages and the expensive detail expires before it becomes the problem.

The tradeoff is that deleting data is itself work. A bulk delete of millions of rows from a B-tree leaves tombstones, bloats pages and competes with the write path, so the delete has to be chunked and the store vacuumed afterwards. Partitioning by time makes it trivial — drop the partition — which is a strong argument for the partition key even when nothing else needs it. The other cost is that aggregation must run before the raw data goes, or the history is lost.

What fails is a retention policy that was never implemented, and the discovery is a table past what a backup window can handle. The change request is the one that adds a legal deletion requirement: deleting one user's rows from a partitioned store is easy, and from an append-only log it is a rewrite.`,
    probeFamilies: [3, 6],
    prompts: ["chat-slack", "google-drive"],
  },

  // ----------------------------------------------------------------- messaging
  {
    slug: "queue-vs-log",
    group: "messaging",
    title: "Queue versus log",
    summary:
      "A queue holds work and forgets it on acknowledgement; a log holds history and lets each consumer track its own position, which buys replay and costs retention.",
    bodyMd: `A queue delivers each message to one consumer and deletes it on acknowledgement, so the message is gone once it is processed; a log appends messages to an ordered, retained sequence and each consumer tracks its own position, so the message stays and can be read again. The choice determines whether the broker holds work or holds history.

The tradeoff is in the replay and the fan-out. A log can be reread from an earlier offset, which is what makes a new consumer possible without re-emitting anything, and several consumer groups can each read the whole stream independently — the cost is retention: the log holds everything for its window and the disk bill scales with throughput times window. A queue is simpler and self-limiting because messages leave, and it cannot answer "what did we process last Tuesday" or support a second reader of the same stream.

What fails is using a queue for an event stream. Two consumers that both need every message force either a fan-out exchange with one queue per consumer or a copy of the data into a second system, and the missing replay means a bug fix cannot be applied to the messages that were already processed and dropped. A log for point-to-point work leaves every consumer managing offsets and rebalances the queue handled.`,
    probeFamilies: [4],
    prompts: ["notification-system", "uber"],
  },
  {
    slug: "delivery-semantics",
    group: "messaging",
    title: "Delivery semantics",
    summary:
      "At-least-once plus idempotent processing is the honest claim; exactly-once is a property of a pipeline boundary, not of a transport.",
    bodyMd: `At-most-once delivers without retrying, so a message can be lost but never duplicated; at-least-once retries until acknowledged, so nothing is lost and duplicates are expected; exactly-once means the effect happens once, which is achieved by making the consumer's work idempotent or by committing the consumer's offset and its output in one transaction, not by the transport being clever.

The tradeoff is where the duplicate is absorbed. At-least-once pushes the problem to the consumer, which needs a dedupe key or an idempotent operation — and every consumer that forgets is a double charge or a double email waiting for a retry. Exactly-once via a transactional consumer couples the message system to the store that holds the output, which is available inside one system, a stream processor writing to its own state, and much harder across two services.

What fails is a retry that is invisible to the consumer. A broker redelivers a message whose acknowledgement was lost, and a consumer that increments a counter has now counted twice, with no error anywhere. The hostile data probe is the one that finds it: a replayed message, a reused key, a duplicate delivery under load. The design has to name which of the three semantics it has and what makes the effect idempotent.`,
    probeFamilies: [2, 4],
    prompts: ["notification-system", "uber"],
  },
  {
    slug: "ordering-guarantees",
    group: "messaging",
    title: "Ordering guarantees",
    summary:
      "Order is per partition, so the key decides which events stay ordered and how much of the throughput one entity can use.",
    bodyMd: `Ordering is per partition, not per topic: a log gives total order within a partition and no order between partitions, so two messages with the same key land in the same partition and are ordered, and two with different keys are not. That is the guarantee a partitioned broker can actually keep, and the design work is choosing a key coarse enough to keep the events that must be ordered together and fine enough to keep partitions balanced.

The tradeoff is that the key becomes a serialisation point. Ordering all events for one entity through one partition means that entity's throughput is one partition's throughput, so an account that must process its events in order cannot be scaled by adding consumers — the hot key is now also an ordering constraint. Adding partitions to increase parallelism changes the key-to-partition mapping, which reorders the stream for existing keys unless the mapping is stable.

What fails is assuming global order. A consumer that reads from several partitions and assumes the timestamps are monotonic will process an event before its cause, and the failure appears as state that briefly goes backwards — a delete before the create, a payment before the order. The boundary probe is the smallest version: two events, one key, and whether a retry can reorder them.`,
    probeFamilies: [5, 6],
    prompts: ["chat-slack", "uber"],
  },
  {
    slug: "consumer-groups",
    group: "messaging",
    title: "Consumer groups",
    summary:
      "One partition goes to one consumer, so the partition count is the parallelism ceiling and every rebalance stalls the partitions it moves.",
    bodyMd: `A consumer group is a set of workers that share a subscription, with the broker assigning each partition to exactly one member so the work is split without coordination on the consumer side. Adding a member triggers a rebalance that moves partitions; a member dying triggers another. The group is what makes a topic with N partitions process N-way in parallel and no further.

The tradeoff is the rebalance. During one, the affected partitions stop being consumed, so a large group with a slow rebalance stalls processing for the duration, and a member that is merely slow rather than dead can be evicted by the heartbeat timeout, causing a rebalance that makes it slower. The number of consumers is also capped by the partition count: a tenth consumer in a nine-partition topic sits idle, which means the partition count is a hard ceiling chosen at topic creation.

What fails is a partition count that was picked for the current volume. Raising it later is possible and changes the key mapping, which reorders events for existing keys, so the decision is closer to permanent than it looks. The multiplier probe is the one that finds it: ten times the traffic, ten times the consumers, and a topic that cannot grow because it has six partitions.`,
    probeFamilies: [0, 3],
    prompts: ["notification-system", "web-crawler"],
  },
  {
    slug: "backpressure",
    group: "messaging",
    title: "Backpressure",
    summary:
      "Slow the producer, buffer or drop — an unbounded buffer converts a load problem into a memory failure, which is slower and worse than refusing the work.",
    bodyMd: `Backpressure is what a system does when it receives work faster than it can process it, and the options are to slow the producer, to buffer, or to drop. Slowing the producer propagates the limit upstream, which is correct and only works if the producer can be told — a queue that never returns a full signal just grows. Buffering converts a load problem into a latency problem, and then into a memory problem if the burst is a step change rather than a spike. Dropping keeps the system alive and loses work.

The tradeoff is that each option fails differently. An unbounded buffer makes the failure worse by delaying it until memory runs out, at which point the process dies and loses everything queued. A bounded queue that blocks the producer can deadlock if the producer also consumes another queue. Dropping needs a policy for what to discard — oldest, newest, or by class — and a metric that makes the loss visible.

What fails is a queue sized for the average. The multiplier probe is exactly this: ten times the traffic through a buffer meant to smooth a spike, and the queue grows without bound until the node runs out of memory — a slower and more expensive outage than rejecting the excess at the door.`,
    probeFamilies: [0, 1],
    prompts: ["notification-system", "web-crawler"],
  },
  {
    slug: "dead-letter-queues",
    group: "messaging",
    title: "Dead-letter queues",
    summary:
      "Park the messages a consumer cannot handle so the queue keeps moving, and own the queue afterwards, because nothing else forces anyone to look at it.",
    bodyMd: `A dead-letter queue holds the messages a consumer could not process, so the main queue keeps moving and the poison message does not block everything behind it. The mechanism is a retry policy with a limit: after N attempts the message is moved, along with the failure reason, and the consumer continues with the next one.

The tradeoff is that the DLQ is a place where work goes to be forgotten. Nothing in the pattern forces anyone to look at it, so it fills silently and the real signal — a systematic bug in the consumer, or a schema change the consumer has not learned — is buried under messages that were never going to succeed. A message that fails because of a transient dependency should be retried later, not dead-lettered, and a message that fails because it is malformed should never have been retried at all; the retry policy has to distinguish them.

What fails is a DLQ with no owner and no alert. The hostile data probe is the one that finds it: one client sends a message the consumer cannot parse, every message after it succeeds, and the loss is invisible until someone reconciles counts. Give the queue a retention window, an alert on depth and a documented replay path, or it is a write-only graveyard.`,
    probeFamilies: [2],
    prompts: ["notification-system", "uber"],
  },
  {
    slug: "exactly-once-claims",
    group: "messaging",
    title: "Exactly-once claims",
    summary:
      "Exactly-once delivery over a network is impossible, so the label means the effect is applied once — and the guarantee stops at the boundary of the system that provides it.",
    bodyMd: `Exactly-once delivery over a network is impossible — an acknowledgement can always be lost after the effect landed — so what a system advertising exactly-once actually means is exactly-once processing: the effect is applied once because the consumer's offset and its output commit together, or because the operation is idempotent under a key the broker preserves. The distinction matters because the first is a property of the whole pipeline and the second is a property of one component.

The tradeoff is the scope of the guarantee. A stream processor that manages its own state can make the commit atomic and get exactly-once inside its boundary, and the moment the output leaves that boundary — an external API call, a second database, a webhook — the guarantee stops and the application is back to at-least-once with an idempotency key it has to supply. Cross-system exactly-once needs a two-phase protocol that most brokers do not offer and that costs latency and availability.

What fails is trusting the label. The time machine probe is the one that finds it: replay the pipeline from an earlier offset after a bug fix, and a sink that was not idempotent writes every record twice. The honest claim is at-least-once delivery plus idempotent processing, and the second half is the part that has to be built.`,
    probeFamilies: [4, 6],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "event-sourcing",
    group: "messaging",
    title: "Event sourcing",
    summary:
      "The log of changes is the source of truth and every query is a projection, so history is free and a schema change invalidates everything downstream of it.",
    bodyMd: `Event sourcing stores the sequence of changes as the source of truth and derives current state by replaying them, so the log is the database and the read model is a projection. The benefits follow: the full history is available for audit and for new read models, the write path is an append, and a projection can be rebuilt when its logic changes.

The tradeoff is that every query now needs a projection, and every projection is a denormalisation that has to be maintained and can lag. Replaying a long history to rebuild a projection is expensive, so most implementations snapshot and replay from the last one, which reintroduces state that must itself be versioned. Events are permanent in a way a mutable row is not: a correction is a compensating event, not an update, so a wrong event cannot be edited out, only superseded — and any consumer that did not expect the correction applies it twice.

What fails is an event schema that was designed before the requirements settled. Adding a field is fine; changing what an existing event means invalidates every projection and every consumer, because the old events are still there and still authoritative. The change request probe finds it, and the answer is usually versioning the event type rather than editing the past.`,
    probeFamilies: [3, 6],
    prompts: ["ticketmaster", "google-drive"],
  },
  {
    slug: "change-data-capture",
    group: "messaging",
    title: "Change data capture",
    summary:
      "Reading the database's own log captures writes nothing can forget, and makes the database's internal schema an API that consumers depend on.",
    bodyMd: `Change data capture reads the database's own replication log and turns committed changes into a stream, so a downstream system can react to writes without the application emitting anything. It is attractive because it cannot be forgotten — every write is captured, including the ones made by a migration or an operator — and because it does not add a write path the application has to maintain.

The tradeoff is that the stream carries the database's internal representation, so a column rename becomes a schema change for every consumer, and the row image in the log is whatever the table holds, not what the domain means. Ordering is per-partition of the source log, which may not match the key the consumer cares about, and the stream is only as complete as the retention window: a consumer that falls behind past it cannot catch up from the log and needs a full snapshot. The snapshot and the stream have to be stitched without missing or duplicating the writes in between.

What fails is treating the log as an API. The time machine probe finds it: a schema migration runs while consumers are live, and a consumer keyed on a dropped column writes nulls into its own store, with nothing in the pipeline reporting an error.`,
    probeFamilies: [3, 6],
    prompts: ["uber", "google-drive"],
  },

  // ---------------------------------------------------------------- resilience
  {
    slug: "timeouts-and-retries",
    group: "resilience",
    title: "Timeouts and retries",
    summary:
      "A timeout stops one slow dependency from consuming the caller and a retry multiplies load on the thing that is already failing, so the budget comes from the deadline and the effect must be safe to repeat.",
    bodyMd: `A timeout bounds how long a caller waits before giving up, and a retry re-sends the request; together they are the first line of resilience and the most common way to make an outage worse. Without a timeout, a slow dependency consumes a connection and a thread indefinitely, so the caller's own pool drains and the failure spreads upstream. With one, the caller fails fast and can shed the load.

The tradeoff is that the retry multiplies the load on something that is already struggling. A caller that retries three times triples the request rate at exactly the moment the dependency is slow, and if every caller in a fleet does it, the dependency sees a multiple of its normal traffic. The timeout also has to be shorter than the caller's own deadline, or the retry happens after the caller has already given up and the work is wasted — a retry budget that is not derived from the deadline is a source of duplicate work, not resilience.

What fails is a retry without jitter or a limit. The boundary probe is the pair of requests that arrive twice: the operation has to be idempotent, or the retry charges twice. Set the timeout from the caller's deadline, cap the attempts, and make the effect safe to repeat.`,
    probeFamilies: [1, 5],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "exponential-backoff-and-jitter",
    group: "resilience",
    title: "Exponential backoff and jitter",
    summary:
      "Wait longer after each failure and randomise the wait, or every client that failed together returns together and the recovery is a second outage.",
    bodyMd: `Backoff waits longer after each failure so a struggling dependency is not hammered while it recovers; jitter randomises the wait so that a fleet of callers that failed together does not retry together. Without jitter, every client that backed off for the same interval returns at the same instant — a synchronised thundering herd on a service that has just come back, and a second outage the backoff was meant to prevent.

The tradeoff is latency against load. Longer intervals are kinder to the dependency and slower for the user, so the schedule has to be capped, and the cap interacts with the caller's deadline: an attempt that cannot finish before the caller times out is wasted work. Full jitter — a uniform random value between zero and the computed interval — spreads arrivals best and widens the latency distribution; equal jitter keeps a floor and narrows it. Both are fine; no jitter is not.

What fails is a retry policy tuned in a test environment with one client. The multiplier probe is the one that finds it: ten thousand callers backing off on the same schedule, and the service's recovery window is defined by when the last of them gives up, not when it became healthy. Jitter the first retry too, because the first wave is the largest.`,
    probeFamilies: [0, 1],
    prompts: ["notification-system", "uber"],
  },
  {
    slug: "circuit-breakers",
    group: "resilience",
    title: "Circuit breakers",
    summary:
      "Stop calling a dependency that is failing so the caller's resources are free, and define the fallback first, because an open breaker without one just moves the failure.",
    bodyMd: `A circuit breaker watches the failure rate of calls to a dependency and, past a threshold, stops sending them for a while, returning an error immediately. It converts a slow failure into a fast one, which is the point: a dependency that is timing out ties up caller resources for the full timeout, and the breaker releases them so the caller can serve the requests that do not need that dependency.

The tradeoff is the state machine and its thresholds. A breaker that opens on too few samples trips on noise and takes a healthy dependency out of service; one that opens too late does nothing. Half-open probing — let a few requests through and close if they succeed — is how it recovers, and the probe rate decides whether recovery is detected in seconds or minutes. The breaker is per-dependency and per-instance, so a fleet's breakers do not agree, and a dependency that is fine for nine callers and slow for the tenth is a state no single breaker sees.

What fails is a fallback that is not actually defined. Opening the breaker returns an error, and if the caller has no degraded path the user sees a failure the dependency's slowness did not require. A breaker without a fallback moves the failure rather than absorbing it.`,
    probeFamilies: [1, 4],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "bulkheads",
    group: "resilience",
    title: "Bulkheads",
    summary:
      "Give each dependency its own pool so one slow backend cannot drain the shared one, at the cost of idle capacity in every partition.",
    bodyMd: `A bulkhead partitions a resource — threads, connections, memory — so that one workload cannot consume all of it and take the others down. The classic form is a separate connection pool per dependency: if one backend hangs, only the pool assigned to it fills, and the pools for the healthy backends keep serving. Without the partition, a single slow dependency consumes the shared pool and every request that needs any dependency fails.

The tradeoff is that partitions waste capacity. Each pool has to be sized for its own peak, so the sum of the pools is larger than a shared pool would need to be, and an idle dependency's allocation sits unused while another is queued. Sizing them well requires knowing each dependency's concurrency, which is often guesswork, and a pool that is too small turns a fast dependency into a queue.

What fails is a bulkhead that covers the common case and not the shared one. A logging call, a metrics flush, a configuration lookup — something every request path touches — is the one that will saturate its pool and take everything with it, and the partition is only as good as its least considered member. The probe is one dependency hanging while the rest are healthy, and the answer should be that the rest keep working.`,
    probeFamilies: [1, 4],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "graceful-degradation",
    group: "resilience",
    title: "Graceful degradation",
    summary:
      "Rank what the system gives up first and signal when it does, because a fallback that runs untested and unmeasured is a guess that looks like health.",
    bodyMd: `Graceful degradation is a ranked list of what the system gives up first when it is short of capacity or a dependency is gone. The mechanism is that each feature is assigned a fallback: recommendations become a cached list, personalised ranking becomes chronological, the live counter becomes a stale value, the expensive query becomes a cheaper one. The system stays useful at a lower fidelity instead of failing.

The tradeoff is that every fallback is code that runs only under stress and is therefore rarely exercised. A degraded path that has never been tested in production is a guess, and a fallback that returns an empty list is worse than an error because nothing reports it. The ranked list has to be decided before the incident, by product, not by whoever is on call at three in the morning: the ordering is a decision about which feature matters least.

What fails is degradation that is invisible. If the fallback is served and no metric records it, the system looks healthy while every user gets the degraded experience, and the incident is discovered from a support queue. Emit a signal on every fallback, and treat its presence as an incident, not as success. A new feature has to be slotted into the ranking when it ships, or it degrades unpredictably.`,
    probeFamilies: [1, 3],
    prompts: ["news-feed", "youtube"],
  },
  {
    slug: "load-shedding",
    group: "resilience",
    title: "Load shedding",
    summary:
      "Reject work at the edge before the queue grows, because a refused request is far cheaper than one that holds a connection until it times out.",
    bodyMd: `Load shedding rejects work deliberately when the system is past capacity, so the requests that are served are served well. The mechanism is admission control at the edge: a queue with a bound, a rate limit per client or per endpoint, and a policy that returns 429 or 503 immediately instead of accepting a request that will time out anyway. A rejected request is cheaper than a queued one and much cheaper than one that consumes a connection for thirty seconds and then fails.

The tradeoff is deciding what to drop and being honest about it. Dropping by arrival order is simple and drops the users who arrived during the spike; dropping by priority preserves the paying traffic and needs a classification someone maintains. Shedding early is counterintuitive — rejecting at 80% utilisation keeps latency bounded, while waiting until 100% makes every accepted request slow. Shed on queue depth or latency, not CPU, because CPU is what a saturated system measures least accurately.

What fails is shedding that starts too late or never stops. The multiplier probe is the case: ten times the traffic, a bounded queue rejecting the excess, and recovery depends on how fast the queue drains. Without a shed path the same load takes the system down.`,
    probeFamilies: [0, 1],
    prompts: ["ticketmaster", "rate-limiter"],
  },
  {
    slug: "health-checks",
    group: "resilience",
    title: "Health checks",
    summary:
      "Readiness decides routing and liveness decides restarts, and a check that tests the wrong one either hides a broken instance or removes the whole fleet.",
    bodyMd: `A health check is how a load balancer or an orchestrator decides whether an instance should receive traffic, and the design question is what it tests. A shallow check that returns 200 when the process is running says nothing about whether it can serve: an instance whose database connection pool is exhausted, whose dependency is unreachable, or whose disk is full is alive and useless. A deep check that calls every dependency makes the instance unhealthy whenever anything downstream is, which removes the entire fleet at once.

The tradeoff is that the check's verdict is binary and immediate. Failing it removes the instance from rotation and, in an orchestrator, restarts it — so a check with a tight timeout flaps under load, and a restart loop takes capacity out exactly when it is needed. Liveness and readiness are different questions: readiness decides routing and should fail when the instance cannot serve; liveness decides restarting and should fail only when the process is genuinely wedged.

What fails is a health check that tests the wrong thing. The probe is one instance with a saturated pool: the check passes, the balancer keeps sending traffic, and users get errors from a machine the platform believes is healthy. Report dependency degradation as a separate signal, and make the check cheap enough to run often.`,
    probeFamilies: [1],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "blast-radius",
    group: "resilience",
    title: "Blast radius",
    summary:
      "Blast radius is topology, not component quality, so the goal is a named limit — how many services go down with each shared thing — and a failure domain you can measure.",
    bodyMd: `Blast radius is how much of the system stops working when one thing fails, and it is a property of the topology rather than of any component. A shared database behind twenty services means one failure takes all twenty; twenty services with their own stores and a fallback means the failure takes one path. The mechanism is the same as bulkheads at a larger scale: partition the failure domain and make the partitions independent — deployment, capacity, dependencies.

The tradeoff is cost and coupling. Independent deployments mean duplicated infrastructure and more operational surface, and a shared component exists because duplicating it is wasteful. The realistic goal is not zero coupling but a named limit: for each shared component, say how many services go down with it. Cell-based architectures make this explicit by replicating the stack per cell and routing users to one, so a failure costs one cell's users and the radius is a percentage instead of a total.

What fails is a shared component whose failure mode is not isolated — a control plane every data plane needs to start, a DNS record, a certificate that expires. The time machine probe is the one that finds it: a rolling change that has to touch every cell at once has a fleet-wide radius, however the cells are drawn.`,
    probeFamilies: [1, 6],
    prompts: ["uber", "ticketmaster"],
  },
  {
    slug: "chaos-and-failure-injection",
    group: "resilience",
    title: "Chaos and failure injection",
    summary:
      "Inject the failures you claim to handle, in production and in a bounded scope, because a failover that has never been exercised is a hypothesis.",
    bodyMd: `Chaos engineering injects failures on purpose — kill an instance, add latency to a dependency, blackhole a region — to find out whether the failure handling that exists on paper actually works. The mechanism is a hypothesis and an experiment: measure the steady state, apply a fault in a controlled scope, compare the result. What it tests is not the component but the response: the failover, the retry, the breaker, the alert, the runbook.

The tradeoff is that the experiment runs against production, because staging's failures are not the ones that matter and a failover that has never been exercised is a hypothesis. That means a blast radius for the experiment itself: start in one cell or one instance, have a way to stop it, and be ready for it to find a real bug at an inconvenient time. A chaos programme without the ability to observe the outcome is just an outage with a name.

What fails is testing only the failures you already handle. Killing a stateless instance proves the balancer works and says nothing about the dependency that hangs instead of failing, the clock that drifts, or the disk that fills. The time machine probe is the one that finds it: run the fault during a deploy, because that is when the redundancy is temporarily absent.`,
    probeFamilies: [1, 6],
    prompts: ["uber", "notification-system"],
  },
  {
    slug: "capacity-planning",
    group: "resilience",
    title: "Capacity planning",
    summary:
      "Size for the peak plus the largest failure you must tolerate, and alert on headroom, because autoscaling handles growth and not a step change.",
    bodyMd: `Capacity planning turns a traffic forecast into a machine count, and the honest version is a range with the assumptions exposed: peak requests per second, the per-request cost, the failover headroom, the growth rate. The headroom is the part teams skip — capacity that exactly matches the peak means losing one node takes the service over the limit, so usable capacity is the fleet minus the largest failure.

The tradeoff is that provisioning for the peak is expensive and provisioning for the average is an outage. A ticket sale or a product launch produces a peak a hundred times the daily average, so the choice is to own the capacity all year, buy it on demand, or shed the excess. Autoscaling is slow relative to a spike — minutes to boot, warm the cache, pass health checks — so it handles growth and not a step change. Reserved capacity handles the step change and idles.

What fails is planning on the average with a growth assumption. The time machine probe is the one that finds it: a forecast that was right for two quarters and a workload that changed shape, so the fleet is sized for last year's traffic at the moment this year's arrives. Track headroom as a metric and alert on it, not on a machine's utilisation.`,
    probeFamilies: [0, 6],
    prompts: ["ticketmaster", "youtube"],
  },
];

export type DesignConceptSummary = {
  slug: string;
  group: ConceptGroup;
  title: string;
  summary: string;
  probeFamilies: number[];
};

/** The list view. `bodyMd` is stripped: the list is browsed by title and summary. */
export function listDesignConcepts(): DesignConceptSummary[] {
  return DESIGN_CONCEPTS.map(({ slug, group, title, summary, probeFamilies }) => ({
    slug,
    group,
    title,
    summary,
    probeFamilies,
  }));
}

export function getDesignConcept(slug: string): DesignConcept | null {
  return DESIGN_CONCEPTS.find((c) => c.slug === slug) ?? null;
}

/** Concepts answering a probe family, for the round-results link. Empty array if none. */
export function conceptsForProbeFamily(index: number): DesignConceptSummary[] {
  return listDesignConcepts().filter((c) => c.probeFamilies.includes(index));
}
