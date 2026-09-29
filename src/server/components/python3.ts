/**
 * Python 3: executable system-design components. `starter` is a scaffold that COMPILES and
 * FAILS its tests; `solution` is the exemplar that must pass every case in `catalog.ts`.
 * `components.test.ts` enforces that by running every starter and every exemplar through the
 * executor: a starter that already passes teaches nothing, and a wrong exemplar would ship as
 * the taught answer.
 *
 * The harness binds `class Solution` and calls the method named by `fnNameFor("python3", name)`,
 * snake_case of the catalogue's canonical name. The hash is part of the contract for
 * `consistent-hash` and `bloom-filter`: both are unsatisfiable without agreeing on it, and it
 * appears identically in all five languages and in the prompt.
 */

const HASH_DOC = `# hash(s) = fold over characters: h = (h * 31 + ord(c)) % 1000003`;

export const PYTHON: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------
  "lru-cache": {
    starter: `class Solution:
    def run_lru(self, capacity, ops):
        # TODO: a get must refresh recency, and a put over capacity must evict the LRU key.
        # Returning an empty list compiles and fails every case.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "get":
                out.append(-1)
        return out`,
    solution: `class Solution:
    def run_lru(self, capacity, ops):
        out = []
        order = []
        store = {}
        for op in ops:
            parts = op.split()
            if parts[0] == "put":
                key, val = int(parts[1]), int(parts[2])
                if key in store:
                    order.remove(key)
                store[key] = val
                order.append(key)
                if len(store) > capacity:
                    evicted = order.pop(0)
                    del store[evicted]
            else:
                key = int(parts[1])
                if key in store:
                    order.remove(key)
                    order.append(key)
                    out.append(store[key])
                else:
                    out.append(-1)
        return out`,
  },

  "lfu-cache": {
    starter: `class Solution:
    def run_lfu(self, capacity, ops):
        # TODO: evict the least FREQUENTLY used key, breaking ties by least recently used.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "get":
                out.append(-1)
        return out`,
    solution: `class Solution:
    def run_lfu(self, capacity, ops):
        out = []
        store = {}
        freq = {}
        seq = {}
        clock = 0
        for op in ops:
            parts = op.split()
            if parts[0] == "put":
                key, val = int(parts[1]), int(parts[2])
                if key in store:
                    store[key] = val
                    freq[key] += 1
                    clock += 1
                    seq[key] = clock
                else:
                    if len(store) >= capacity:
                        victim = min(store, key=lambda k: (freq[k], seq[k]))
                        del store[victim]
                        del freq[victim]
                        del seq[victim]
                    store[key] = val
                    freq[key] = 1
                    clock += 1
                    seq[key] = clock
            else:
                key = int(parts[1])
                if key in store:
                    freq[key] += 1
                    clock += 1
                    seq[key] = clock
                    out.append(store[key])
                else:
                    out.append(-1)
        return out`,
  },

  "ttl-cache": {
    starter: `class Solution:
    def run_ttl(self, capacity, ops):
        # TODO: TTL is 3 ticks. An entry written at clock t is live until clock t + 3.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "get":
                out.append(-1)
        return out`,
    solution: `class Solution:
    TTL = 3

    def run_ttl(self, capacity, ops):
        out = []
        store = {}
        expiry = {}
        order = []
        clock = 0

        def purge():
            for key in [k for k in store if clock >= expiry[k]]:
                del store[key]
                del expiry[key]
                order.remove(key)

        for op in ops:
            parts = op.split()
            if parts[0] == "tick":
                clock += 1
                purge()
            elif parts[0] == "put":
                key, val = int(parts[1]), int(parts[2])
                purge()
                if key in store:
                    order.remove(key)
                store[key] = val
                expiry[key] = clock + self.TTL
                order.append(key)
                if len(store) > capacity:
                    evicted = order.pop(0)
                    del store[evicted]
                    del expiry[evicted]
            else:
                purge()
                key = int(parts[1])
                if key in store:
                    order.remove(key)
                    order.append(key)
                    out.append(store[key])
                else:
                    out.append(-1)
        return out`,
  },

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  "fixed-window": {
    starter: `class Solution:
    def run_fixed_window(self, limit, ops):
        # TODO: the window is t // 10. The counter resets when the window changes.
        return [0 for _ in ops]`,
    solution: `class Solution:
    def run_fixed_window(self, limit, ops):
        out = []
        counts = {}
        for op in ops:
            tick = int(op.split()[1])
            window = tick // 10
            used = counts.get(window, 0)
            if used < limit:
                counts[window] = used + 1
                out.append(1)
            else:
                out.append(0)
        return out`,
  },

  "sliding-window-log": {
    starter: `class Solution:
    def run_sliding_window(self, limit, ops):
        # TODO: keep the timestamps of accepted requests; drop those at or before t - 10.
        return [0 for _ in ops]`,
    solution: `class Solution:
    def run_sliding_window(self, limit, ops):
        out = []
        accepted = []
        for op in ops:
            tick = int(op.split()[1])
            accepted = [x for x in accepted if x > tick - 10]
            if len(accepted) < limit:
                accepted.append(tick)
                out.append(1)
            else:
                out.append(0)
        return out`,
  },

  "token-bucket": {
    starter: `class Solution:
    def run_token_bucket(self, rate, ops):
        # TODO: capacity is 2 * rate, the bucket starts FULL, and it refills rate per tick.
        return [0 for _ in ops]`,
    solution: `class Solution:
    def run_token_bucket(self, rate, ops):
        out = []
        capacity = rate * 2
        tokens = capacity
        last = 0
        for op in ops:
            tick = int(op.split()[1])
            tokens = min(capacity, tokens + (tick - last) * rate)
            last = tick
            if tokens >= 1:
                tokens -= 1
                out.append(1)
            else:
                out.append(0)
        return out`,
  },

  "leaky-bucket": {
    starter: `class Solution:
    def run_leaky_bucket(self, rate, ops):
        # TODO: capacity is rate, the bucket starts EMPTY, and it drains rate per tick.
        return [0 for _ in ops]`,
    solution: `class Solution:
    def run_leaky_bucket(self, rate, ops):
        out = []
        capacity = rate
        level = 0
        last = 0
        for op in ops:
            tick = int(op.split()[1])
            level = max(0, level - (tick - last) * rate)
            last = tick
            if level < capacity:
                level += 1
                out.append(1)
            else:
                out.append(0)
        return out`,
  },

  // ---------------------------------------------------------------------------
  // Coordination
  // ---------------------------------------------------------------------------
  "consistent-hash": {
    starter: `class Solution:
    ${HASH_DOC}
    def run_consistent_hash(self, vnodes, ops):
        # TODO: build the ring, map keys to the first position at or after hash(key) % 360.
        # Report "low"/"high" for moved and "even"/"uneven" for spread.
        return ["" for _ in ops]`,
    solution: `class Solution:
    ${HASH_DOC}
    RING = 360

    def _hash(self, s):
        h = 0
        for ch in s:
            h = (h * 31 + ord(ch)) % 1000003
        return h

    def _ring(self, nodes, vnodes):
        points = []
        for node in nodes:
            for i in range(vnodes):
                points.append((self._hash(node + "#" + str(i)) % self.RING, node))
        points.sort()
        return points

    def _assign(self, points, key):
        if not points:
            return ""
        target = self._hash(key) % self.RING
        for pos, node in points:
            if pos >= target:
                return node
        return points[0][1]

    def run_consistent_hash(self, vnodes, ops):
        out = []
        nodes = ["a", "b", "c"]
        points = self._ring(nodes, vnodes)
        loaded = {}
        for op in ops:
            parts = op.split()
            if parts[0] == "node":
                nodes.append(parts[1])
                points = self._ring(nodes, vnodes)
            elif parts[0] == "load":
                loaded = {str(k): self._assign(points, str(k)) for k in range(int(parts[1]))}
            elif parts[0] == "moved":
                if not loaded:
                    out.append("none")
                else:
                    moved = sum(1 for k, v in loaded.items() if self._assign(points, k) != v)
                    out.append("low" if moved / len(loaded) < 0.5 else "high")
            elif parts[0] == "spread":
                if not loaded:
                    out.append("none")
                else:
                    counts = {}
                    for k in range(len(loaded)):
                        node = self._assign(points, str(k))
                        counts[node] = counts.get(node, 0) + 1
                    average = len(loaded) / len(counts)
                    out.append("even" if max(counts.values()) <= average * 1.8 else "uneven")
        return out`,
  },

  "snowflake-id": {
    starter: `class Solution:
    def run_snowflake(self, worker_id, ops):
        # TODO: pack (t << 22) | (worker_id << 12) | seq, resetting seq on a new millisecond.
        return ["" for _ in ops]`,
    solution: `class Solution:
    def run_snowflake(self, worker_id, ops):
        out = []
        last = -1
        seq = 0
        for op in ops:
            tick = int(op.split()[1])
            if tick == last:
                seq += 1
            else:
                last = tick
                seq = 0
            out.append(str((tick << 22) | (worker_id << 12) | seq))
        return out`,
  },

  "bloom-filter": {
    starter: `class Solution:
    ${HASH_DOC}
    def run_bloom(self, bits, ops):
        # TODO: set three positions per key and check all three on a lookup.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "check" or parts[0] == "bits":
                out.append(0)
        return out`,
    solution: `class Solution:
    ${HASH_DOC}
    def _hash(self, s):
        h = 0
        for ch in s:
            h = (h * 31 + ord(ch)) % 1000003
        return h

    def _positions(self, s, bits):
        return [self._hash(s) % bits, self._hash(s + "1") % bits, self._hash(s + "2") % bits]

    def run_bloom(self, bits, ops):
        out = []
        array = [0] * bits
        for op in ops:
            parts = op.split()
            if parts[0] == "add":
                for i in self._positions(parts[1], bits):
                    array[i] = 1
            elif parts[0] == "check":
                out.append(1 if all(array[i] for i in self._positions(parts[1], bits)) else 0)
            elif parts[0] == "bits":
                out.append(sum(array))
        return out`,
  },

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  "wal-kv": {
    starter: `class Solution:
    def run_wal_kv(self, capacity, ops):
        # TODO: append to the log before applying, and compact when the log exceeds capacity.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "get":
                out.append(-1)
            elif parts[0] == "logsize":
                out.append(0)
        return out`,
    solution: `class Solution:
    def run_wal_kv(self, capacity, ops):
        out = []
        log = []
        state = {}

        def compact():
            if len(log) > capacity:
                return [("set", k, v) for k, v in sorted(state.items())]
            return log

        for op in ops:
            parts = op.split()
            if parts[0] == "set":
                key, val = int(parts[1]), int(parts[2])
                state[key] = val
                log.append(("set", key, val))
                log = compact()
            elif parts[0] == "del":
                key = int(parts[1])
                state.pop(key, None)
                log.append(("del", key, 0))
                log = compact()
            elif parts[0] == "get":
                out.append(state.get(int(parts[1]), -1))
            elif parts[0] == "replay":
                rebuilt = {}
                for entry in log:
                    if entry[0] == "set":
                        rebuilt[entry[1]] = entry[2]
                    else:
                        rebuilt.pop(entry[1], None)
                state = rebuilt
            elif parts[0] == "logsize":
                out.append(len(log))
        return out`,
  },

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------
  "inverted-index": {
    starter: `class Solution:
    def run_inverted_index(self, limit, ops):
        # TODO: postings per term, returned ascending and truncated to limit.
        out = []
        for op in ops:
            parts = op.split()
            if parts[0] == "search":
                out.append("")
        return out`,
    solution: `class Solution:
    def run_inverted_index(self, limit, ops):
        out = []
        postings = {}
        for op in ops:
            parts = op.split()
            if parts[0] == "index":
                doc = int(parts[1])
                for term in parts[2:]:
                    postings.setdefault(term, set()).add(doc)
            elif parts[0] == "search":
                docs = sorted(postings.get(parts[1], set()))[:limit]
                out.append(",".join(str(d) for d in docs))
        return out`,
  },
};
