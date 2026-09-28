/**
 * Java — executable system-design components.
 *
 * `starter` compiles and FAILS its tests; `solution` must pass every case in `catalog.ts`.
 * Both are enforced by `components.test.ts` through the real executor.
 *
 * Binding rule: `class Solution` — deliberately NOT public, because the harness writes the
 * file as `Main.java` and only `Main` may be public there. Methods are public and non-static,
 * named exactly as the catalogue's `name`, so the harness can find them by reflection.
 *
 * Signatures are constrained by the harness's argument coercion, which handles `int`, `long`,
 * `double`, `boolean`, `char`, `String`, `int[]`, `double[]`, `String[]`, `boolean[]` — there
 * is no `int[][]` case. Every component here therefore takes `int` and `String[]` and returns
 * `int[]` or `String[]`.
 *
 * `snowflake-id` uses `long` internally: `(t << 22)` exceeds 2^31 for any plausible clock, and
 * an `int` shift would silently wrap. The return is a decimal `String[]` for the same reason.
 *
 * THE HASH IS PART OF THE CONTRACT for `consistent-hash` and `bloom-filter`: both are
 * unsatisfiable without agreeing on it, so it appears identically in all five languages.
 */

const HASH_DOC = `    // hash(s) = fold over characters: h = (h * 31 + c) % 1000003`;

export const JAVA: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------
  "lru-cache": {
    solution: `class Solution {
    public int[] runLru(int capacity, String[] ops) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        java.util.LinkedList<Integer> order = new java.util.LinkedList<>();
        java.util.Map<Integer, Integer> store = new java.util.HashMap<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("put")) {
                int key = Integer.parseInt(parts[1]);
                int val = Integer.parseInt(parts[2]);
                order.remove((Integer) key);
                store.put(key, val);
                order.addLast(key);
                if (store.size() > capacity) {
                    int evicted = order.removeFirst();
                    store.remove(evicted);
                }
            } else {
                int key = Integer.parseInt(parts[1]);
                if (store.containsKey(key)) {
                    order.remove((Integer) key);
                    order.addLast(key);
                    out.add(store.get(key));
                } else {
                    out.add(-1);
                }
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
    starter: `class Solution {
    public int[] runLru(int capacity, String[] ops) {
        // TODO: a get must refresh recency, and a put over capacity must evict the LRU key.
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("get")) out.add(-1);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
  },

  "lfu-cache": {
    solution: `class Solution {
    public int[] runLfu(int capacity, String[] ops) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        java.util.Map<Integer, Integer> store = new java.util.HashMap<>();
        java.util.Map<Integer, Integer> freq = new java.util.HashMap<>();
        java.util.Map<Integer, Integer> seq = new java.util.HashMap<>();
        int clock = 0;
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("put")) {
                int key = Integer.parseInt(parts[1]);
                int val = Integer.parseInt(parts[2]);
                if (store.containsKey(key)) {
                    store.put(key, val);
                    freq.merge(key, 1, Integer::sum);
                    seq.put(key, ++clock);
                } else {
                    if (store.size() >= capacity) {
                        Integer victim = null;
                        for (int k : store.keySet()) {
                            if (victim == null) { victim = k; continue; }
                            if (freq.get(k) < freq.get(victim)
                                || (freq.get(k).equals(freq.get(victim)) && seq.get(k) < seq.get(victim))) {
                                victim = k;
                            }
                        }
                        store.remove(victim);
                        freq.remove(victim);
                        seq.remove(victim);
                    }
                    store.put(key, val);
                    freq.put(key, 1);
                    seq.put(key, ++clock);
                }
            } else {
                int key = Integer.parseInt(parts[1]);
                if (store.containsKey(key)) {
                    freq.merge(key, 1, Integer::sum);
                    seq.put(key, ++clock);
                    out.add(store.get(key));
                } else {
                    out.add(-1);
                }
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
    starter: `class Solution {
    public int[] runLfu(int capacity, String[] ops) {
        // TODO: evict the least FREQUENTLY used key, breaking ties by least recently used.
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("get")) out.add(-1);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
  },

  "ttl-cache": {
    solution: `class Solution {
    private static final int TTL = 3;

    public int[] runTtl(int capacity, String[] ops) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        java.util.Map<Integer, Integer> store = new java.util.HashMap<>();
        java.util.Map<Integer, Integer> expiry = new java.util.HashMap<>();
        java.util.LinkedList<Integer> order = new java.util.LinkedList<>();
        int clock = 0;

        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("tick")) {
                clock++;
            } else if (parts[0].equals("put")) {
                int key = Integer.parseInt(parts[1]);
                int val = Integer.parseInt(parts[2]);
                clock = purge(store, expiry, order, clock);
                order.remove((Integer) key);
                store.put(key, val);
                expiry.put(key, clock + TTL);
                order.addLast(key);
                if (store.size() > capacity) {
                    int evicted = order.removeFirst();
                    store.remove(evicted);
                    expiry.remove(evicted);
                }
            } else {
                clock = purge(store, expiry, order, clock);
                int key = Integer.parseInt(parts[1]);
                if (store.containsKey(key)) {
                    order.remove((Integer) key);
                    order.addLast(key);
                    out.add(store.get(key));
                } else {
                    out.add(-1);
                }
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }

    /** Drop every entry whose age has reached the TTL. */
    private int purge(java.util.Map<Integer, Integer> store, java.util.Map<Integer, Integer> expiry,
                      java.util.LinkedList<Integer> order, int clock) {
        java.util.List<Integer> dead = new java.util.ArrayList<>();
        for (int k : store.keySet()) {
            if (clock >= expiry.get(k)) dead.add(k);
        }
        for (int k : dead) {
            store.remove(k);
            expiry.remove(k);
            order.remove((Integer) k);
        }
        return clock;
    }
}`,
    starter: `class Solution {
    public int[] runTtl(int capacity, String[] ops) {
        // TODO: TTL is 3 ticks. An entry written at clock t is live until clock t + 3.
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("get")) out.add(-1);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  "fixed-window": {
    solution: `class Solution {
    public int[] runFixedWindow(int limit, String[] ops) {
        int[] out = new int[ops.length];
        java.util.Map<Integer, Integer> counts = new java.util.HashMap<>();
        for (int i = 0; i < ops.length; i++) {
            int tick = Integer.parseInt(ops[i].split(" ")[1]);
            int window = tick / 10;
            int used = counts.getOrDefault(window, 0);
            if (used < limit) {
                counts.put(window, used + 1);
                out[i] = 1;
            } else {
                out[i] = 0;
            }
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] runFixedWindow(int limit, String[] ops) {
        // TODO: the window is t / 10. The counter resets when the window changes.
        return new int[ops.length];
    }
}`,
  },

  "sliding-window-log": {
    solution: `class Solution {
    public int[] runSlidingWindow(int limit, String[] ops) {
        int[] out = new int[ops.length];
        java.util.List<Integer> accepted = new java.util.ArrayList<>();
        for (int i = 0; i < ops.length; i++) {
            int tick = Integer.parseInt(ops[i].split(" ")[1]);
            accepted.removeIf((x) -> x <= tick - 10);
            if (accepted.size() < limit) {
                accepted.add(tick);
                out[i] = 1;
            } else {
                out[i] = 0;
            }
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] runSlidingWindow(int limit, String[] ops) {
        // TODO: keep the timestamps of accepted requests; drop those at or before t - 10.
        return new int[ops.length];
    }
}`,
  },

  "token-bucket": {
    solution: `class Solution {
    public int[] runTokenBucket(int rate, String[] ops) {
        int[] out = new int[ops.length];
        int capacity = rate * 2;
        int tokens = capacity;
        int last = 0;
        for (int i = 0; i < ops.length; i++) {
            int tick = Integer.parseInt(ops[i].split(" ")[1]);
            tokens = Math.min(capacity, tokens + (tick - last) * rate);
            last = tick;
            if (tokens >= 1) {
                tokens -= 1;
                out[i] = 1;
            } else {
                out[i] = 0;
            }
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] runTokenBucket(int rate, String[] ops) {
        // TODO: capacity is 2 * rate, the bucket starts FULL, and it refills rate per tick.
        return new int[ops.length];
    }
}`,
  },

  "leaky-bucket": {
    solution: `class Solution {
    public int[] runLeakyBucket(int rate, String[] ops) {
        int[] out = new int[ops.length];
        int capacity = rate;
        int level = 0;
        int last = 0;
        for (int i = 0; i < ops.length; i++) {
            int tick = Integer.parseInt(ops[i].split(" ")[1]);
            level = Math.max(0, level - (tick - last) * rate);
            last = tick;
            if (level < capacity) {
                level += 1;
                out[i] = 1;
            } else {
                out[i] = 0;
            }
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] runLeakyBucket(int rate, String[] ops) {
        // TODO: capacity is rate, the bucket starts EMPTY, and it drains rate per tick.
        return new int[ops.length];
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Coordination
  // ---------------------------------------------------------------------------
  "consistent-hash": {
    solution: `class Solution {
${HASH_DOC}
    private static final int RING = 360;

    private int hash(String s) {
        int h = 0;
        for (int i = 0; i < s.length(); i++) h = (h * 31 + s.charAt(i)) % 1000003;
        return h;
    }

    /** Ring positions as (position, nodeIndex) pairs, sorted by position then node name. */
    private int[][] buildRing(java.util.List<String> nodes, int vnodes) {
        int[][] points = new int[nodes.size() * vnodes][2];
        int at = 0;
        for (int n = 0; n < nodes.size(); n++) {
            for (int i = 0; i < vnodes; i++) {
                points[at][0] = hash(nodes.get(n) + "#" + i) % RING;
                points[at][1] = n;
                at++;
            }
        }
        java.util.Arrays.sort(points, (a, b) -> a[0] != b[0]
            ? Integer.compare(a[0], b[0])
            : nodes.get(a[1]).compareTo(nodes.get(b[1])));
        return points;
    }

    private String assign(int[][] points, java.util.List<String> nodes, String key) {
        if (points.length == 0) return "";
        int target = hash(key) % RING;
        for (int[] p : points) {
            if (p[0] >= target) return nodes.get(p[1]);
        }
        return nodes.get(points[0][1]);
    }

    public String[] runConsistentHash(int vnodes, String[] ops) {
        java.util.List<String> out = new java.util.ArrayList<>();
        java.util.List<String> nodes = new java.util.ArrayList<>(java.util.Arrays.asList("a", "b", "c"));
        int[][] points = buildRing(nodes, vnodes);
        java.util.Map<String, String> loaded = new java.util.LinkedHashMap<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("node")) {
                nodes.add(parts[1]);
                points = buildRing(nodes, vnodes);
            } else if (parts[0].equals("load")) {
                int n = Integer.parseInt(parts[1]);
                loaded = new java.util.LinkedHashMap<>();
                for (int k = 0; k < n; k++) {
                    loaded.put(String.valueOf(k), assign(points, nodes, String.valueOf(k)));
                }
            } else if (parts[0].equals("moved")) {
                if (loaded.isEmpty()) {
                    out.add("none");
                    continue;
                }
                int moved = 0;
                for (java.util.Map.Entry<String, String> e : loaded.entrySet()) {
                    if (!assign(points, nodes, e.getKey()).equals(e.getValue())) moved++;
                }
                out.add((double) moved / loaded.size() < 0.5 ? "low" : "high");
            } else if (parts[0].equals("spread")) {
                if (loaded.isEmpty()) {
                    out.add("none");
                    continue;
                }
                java.util.Map<String, Integer> counts = new java.util.HashMap<>();
                for (int k = 0; k < loaded.size(); k++) {
                    counts.merge(assign(points, nodes, String.valueOf(k)), 1, Integer::sum);
                }
                double average = (double) loaded.size() / counts.size();
                int max = 0;
                for (int c : counts.values()) max = Math.max(max, c);
                out.add(max <= average * 1.8 ? "even" : "uneven");
            }
        }
        return out.toArray(new String[0]);
    }
}`,
    starter: `class Solution {
${HASH_DOC}
    public String[] runConsistentHash(int vnodes, String[] ops) {
        // TODO: build the ring, map keys to the first position at or after hash(key) % 360.
        // Report "low"/"high" for moved and "even"/"uneven" for spread.
        String[] out = new String[ops.length];
        for (int i = 0; i < ops.length; i++) out[i] = "";
        return out;
    }
}`,
  },

  "snowflake-id": {
    solution: `class Solution {
    public String[] runSnowflake(int workerId, String[] ops) {
        String[] out = new String[ops.length];
        long last = -1;
        long seq = 0;
        for (int i = 0; i < ops.length; i++) {
            long tick = Long.parseLong(ops[i].split(" ")[1]);
            if (tick == last) {
                seq++;
            } else {
                last = tick;
                seq = 0;
            }
            out[i] = String.valueOf((tick << 22) | ((long) workerId << 12) | seq);
        }
        return out;
    }
}`,
    starter: `class Solution {
    public String[] runSnowflake(int workerId, String[] ops) {
        // TODO: pack (t << 22) | (workerId << 12) | seq, resetting seq on a new millisecond.
        // The result exceeds 32 bits, so it is returned as a decimal STRING.
        String[] out = new String[ops.length];
        for (int i = 0; i < ops.length; i++) out[i] = "";
        return out;
    }
}`,
  },

  "bloom-filter": {
    solution: `class Solution {
${HASH_DOC}
    private int hash(String s) {
        int h = 0;
        for (int i = 0; i < s.length(); i++) h = (h * 31 + s.charAt(i)) % 1000003;
        return h;
    }

    private int[] positions(String s, int bits) {
        return new int[] { hash(s) % bits, hash(s + "1") % bits, hash(s + "2") % bits };
    }

    public int[] runBloom(int bits, String[] ops) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        int[] array = new int[bits];
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("add")) {
                for (int i : positions(parts[1], bits)) array[i] = 1;
            } else if (parts[0].equals("check")) {
                boolean all = true;
                for (int i : positions(parts[1], bits)) {
                    if (array[i] == 0) all = false;
                }
                out.add(all ? 1 : 0);
            } else if (parts[0].equals("bits")) {
                int sum = 0;
                for (int b : array) sum += b;
                out.add(sum);
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
    starter: `class Solution {
${HASH_DOC}
    public int[] runBloom(int bits, String[] ops) {
        // TODO: set three positions per key and check all three on a lookup.
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("check") || parts[0].equals("bits")) out.add(0);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  "wal-kv": {
    solution: `class Solution {
    public int[] runWalKv(int capacity, String[] ops) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        java.util.List<int[]> log = new java.util.ArrayList<>();
        java.util.Map<Integer, Integer> state = new java.util.HashMap<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("set")) {
                int key = Integer.parseInt(parts[1]);
                int val = Integer.parseInt(parts[2]);
                state.put(key, val);
                log.add(new int[] { 1, key, val });
                if (log.size() > capacity) log = snapshot(state);
            } else if (parts[0].equals("del")) {
                int key = Integer.parseInt(parts[1]);
                state.remove(key);
                log.add(new int[] { 0, key, 0 });
                if (log.size() > capacity) log = snapshot(state);
            } else if (parts[0].equals("get")) {
                int key = Integer.parseInt(parts[1]);
                out.add(state.getOrDefault(key, -1));
            } else if (parts[0].equals("replay")) {
                java.util.Map<Integer, Integer> rebuilt = new java.util.HashMap<>();
                for (int[] entry : log) {
                    if (entry[0] == 1) rebuilt.put(entry[1], entry[2]);
                    else rebuilt.remove(entry[1]);
                }
                state = rebuilt;
            } else if (parts[0].equals("logsize")) {
                out.add(log.size());
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }

    /** One set entry per live key, ordered by key — a log that replays to the same state. */
    private java.util.List<int[]> snapshot(java.util.Map<Integer, Integer> state) {
        java.util.List<Integer> keys = new java.util.ArrayList<>(state.keySet());
        java.util.Collections.sort(keys);
        java.util.List<int[]> log = new java.util.ArrayList<>();
        for (int k : keys) log.add(new int[] { 1, k, state.get(k) });
        return log;
    }
}`,
    starter: `class Solution {
    public int[] runWalKv(int capacity, String[] ops) {
        // TODO: append to the log before applying, and compact when the log exceeds capacity.
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("get")) out.add(-1);
            else if (parts[0].equals("logsize")) out.add(0);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------
  "inverted-index": {
    solution: `class Solution {
    public String[] runInvertedIndex(int limit, String[] ops) {
        java.util.List<String> out = new java.util.ArrayList<>();
        java.util.Map<String, java.util.TreeSet<Integer>> postings = new java.util.HashMap<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("index")) {
                int doc = Integer.parseInt(parts[1]);
                for (int i = 2; i < parts.length; i++) {
                    postings.computeIfAbsent(parts[i], (k) -> new java.util.TreeSet<>()).add(doc);
                }
            } else if (parts[0].equals("search")) {
                java.util.TreeSet<Integer> docs = postings.get(parts[1]);
                StringBuilder sb = new StringBuilder();
                if (docs != null) {
                    int n = 0;
                    for (int d : docs) {
                        if (n >= limit) break;
                        if (n > 0) sb.append(",");
                        sb.append(d);
                        n++;
                    }
                }
                out.add(sb.toString());
            }
        }
        return out.toArray(new String[0]);
    }
}`,
    starter: `class Solution {
    public String[] runInvertedIndex(int limit, String[] ops) {
        // TODO: postings per term, returned ascending and truncated to limit.
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String op : ops) {
            String[] parts = op.split(" ");
            if (parts[0].equals("search")) out.add("");
        }
        return out.toArray(new String[0]);
    }
}`,
  },
};
