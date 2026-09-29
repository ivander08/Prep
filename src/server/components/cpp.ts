/**
 * C++17 executable system-design components. `components.test.ts` runs both through the real
 * executor: `starter` must compile and fail, `solution` must pass every case in `catalog.ts`.
 * The harness emits `#include <bits/stdc++.h>` and `using namespace std;` ahead of this code
 * and code-generates the call site from the parameter and return types, so nothing here
 * declares an include. Every component takes `int` and `vector<string>` and returns
 * `vector<int>` or `vector<string>`, the types `cppUnpack` and `cppCompare` handle.
 * `snowflake-id` uses `long long`: `(t << 22)` exceeds 2^31 for any plausible clock, and a
 * 32-bit shift would wrap, so the return is a decimal `vector<string>`.
 * The hash is part of the contract for `consistent-hash` and `bloom-filter`: both are
 * unsatisfiable without agreeing on it, so all five languages carry it identically.
 */

const HASH_DOC = `    // hash(s) = fold over characters: h = (h * 31 + c) % 1000003`;

export const CPP: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------
  "lru-cache": {
    solution: `class Solution {
public:
    vector<int> runLru(int capacity, vector<string> ops) {
        vector<int> out;
        list<int> order;
        unordered_map<int, int> store;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "put") {
                int key, val;
                in >> key >> val;
                order.remove(key);
                store[key] = val;
                order.push_back(key);
                if ((int)store.size() > capacity) {
                    int evicted = order.front();
                    order.pop_front();
                    store.erase(evicted);
                }
            } else {
                int key;
                in >> key;
                auto it = store.find(key);
                if (it != store.end()) {
                    order.remove(key);
                    order.push_back(key);
                    out.push_back(it->second);
                } else {
                    out.push_back(-1);
                }
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runLru(int capacity, vector<string> ops) {
        // TODO: a get must refresh recency, and a put over capacity must evict the LRU key.
        vector<int> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "get") out.push_back(-1);
        }
        return out;
    }
};`,
  },

  "lfu-cache": {
    solution: `class Solution {
public:
    vector<int> runLfu(int capacity, vector<string> ops) {
        vector<int> out;
        unordered_map<int, int> store;
        unordered_map<int, int> freq;
        unordered_map<int, int> seq;
        int clock = 0;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "put") {
                int key, val;
                in >> key >> val;
                if (store.count(key)) {
                    store[key] = val;
                    freq[key]++;
                    seq[key] = ++clock;
                } else {
                    if ((int)store.size() >= capacity) {
                        int victim = -1;
                        for (auto& kv : store) {
                            if (victim == -1) { victim = kv.first; continue; }
                            if (freq[kv.first] < freq[victim]
                                || (freq[kv.first] == freq[victim] && seq[kv.first] < seq[victim])) {
                                victim = kv.first;
                            }
                        }
                        store.erase(victim);
                        freq.erase(victim);
                        seq.erase(victim);
                    }
                    store[key] = val;
                    freq[key] = 1;
                    seq[key] = ++clock;
                }
            } else {
                int key;
                in >> key;
                auto it = store.find(key);
                if (it != store.end()) {
                    freq[key]++;
                    seq[key] = ++clock;
                    out.push_back(it->second);
                } else {
                    out.push_back(-1);
                }
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runLfu(int capacity, vector<string> ops) {
        // TODO: evict the least FREQUENTLY used key, breaking ties by least recently used.
        vector<int> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "get") out.push_back(-1);
        }
        return out;
    }
};`,
  },

  "ttl-cache": {
    solution: `class Solution {
public:
    static const int TTL = 3;

    void purge(unordered_map<int, int>& store, unordered_map<int, int>& expiry,
               list<int>& order, int clock) {
        vector<int> dead;
        for (auto& kv : store) {
            if (clock >= expiry[kv.first]) dead.push_back(kv.first);
        }
        for (int key : dead) {
            store.erase(key);
            expiry.erase(key);
            order.remove(key);
        }
    }

    vector<int> runTtl(int capacity, vector<string> ops) {
        vector<int> out;
        unordered_map<int, int> store;
        unordered_map<int, int> expiry;
        list<int> order;
        int clock = 0;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "tick") {
                clock++;
            } else if (cmd == "put") {
                int key, val;
                in >> key >> val;
                purge(store, expiry, order, clock);
                order.remove(key);
                store[key] = val;
                expiry[key] = clock + TTL;
                order.push_back(key);
                if ((int)store.size() > capacity) {
                    int evicted = order.front();
                    order.pop_front();
                    store.erase(evicted);
                    expiry.erase(evicted);
                }
            } else {
                purge(store, expiry, order, clock);
                int key;
                in >> key;
                auto it = store.find(key);
                if (it != store.end()) {
                    order.remove(key);
                    order.push_back(key);
                    out.push_back(it->second);
                } else {
                    out.push_back(-1);
                }
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runTtl(int capacity, vector<string> ops) {
        // TODO: TTL is 3 ticks. An entry written at clock t is live until clock t + 3.
        vector<int> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "get") out.push_back(-1);
        }
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  "fixed-window": {
    solution: `class Solution {
public:
    vector<int> runFixedWindow(int limit, vector<string> ops) {
        vector<int> out;
        unordered_map<int, int> counts;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            int tick;
            in >> cmd >> tick;
            int window = tick / 10;
            int used = counts[window];
            if (used < limit) {
                counts[window] = used + 1;
                out.push_back(1);
            } else {
                out.push_back(0);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runFixedWindow(int limit, vector<string> ops) {
        // TODO: the window is t / 10. The counter resets when the window changes.
        return vector<int>(ops.size(), 0);
    }
};`,
  },

  "sliding-window-log": {
    solution: `class Solution {
public:
    vector<int> runSlidingWindow(int limit, vector<string> ops) {
        vector<int> out;
        vector<int> accepted;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            int tick;
            in >> cmd >> tick;
            vector<int> kept;
            for (int t : accepted) if (t > tick - 10) kept.push_back(t);
            accepted = kept;
            if ((int)accepted.size() < limit) {
                accepted.push_back(tick);
                out.push_back(1);
            } else {
                out.push_back(0);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runSlidingWindow(int limit, vector<string> ops) {
        // TODO: keep the timestamps of accepted requests; drop those at or before t - 10.
        return vector<int>(ops.size(), 0);
    }
};`,
  },

  "token-bucket": {
    solution: `class Solution {
public:
    vector<int> runTokenBucket(int rate, vector<string> ops) {
        vector<int> out;
        int capacity = rate * 2;
        int tokens = capacity;
        int last = 0;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            int tick;
            in >> cmd >> tick;
            tokens = min(capacity, tokens + (tick - last) * rate);
            last = tick;
            if (tokens >= 1) {
                tokens -= 1;
                out.push_back(1);
            } else {
                out.push_back(0);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runTokenBucket(int rate, vector<string> ops) {
        // TODO: capacity is 2 * rate, the bucket starts FULL, and it refills rate per tick.
        return vector<int>(ops.size(), 0);
    }
};`,
  },

  "leaky-bucket": {
    solution: `class Solution {
public:
    vector<int> runLeakyBucket(int rate, vector<string> ops) {
        vector<int> out;
        int capacity = rate;
        int level = 0;
        int last = 0;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            int tick;
            in >> cmd >> tick;
            level = max(0, level - (tick - last) * rate);
            last = tick;
            if (level < capacity) {
                level += 1;
                out.push_back(1);
            } else {
                out.push_back(0);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runLeakyBucket(int rate, vector<string> ops) {
        // TODO: capacity is rate, the bucket starts EMPTY, and it drains rate per tick.
        return vector<int>(ops.size(), 0);
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Coordination
  // ---------------------------------------------------------------------------
  "consistent-hash": {
    solution: `class Solution {
public:
${HASH_DOC}
    static const int RING = 360;

    int hashOf(const string& s) {
        int h = 0;
        for (char c : s) h = (h * 31 + (unsigned char)c) % 1000003;
        return h;
    }

    vector<pair<int, string>> buildRing(vector<string> nodes, int vnodes) {
        vector<pair<int, string>> points;
        for (const string& node : nodes) {
            for (int i = 0; i < vnodes; i++) {
                points.push_back({ hashOf(node + "#" + to_string(i)) % RING, node });
            }
        }
        sort(points.begin(), points.end());
        return points;
    }

    string assign(const vector<pair<int, string>>& points, const string& key) {
        if (points.empty()) return "";
        int target = hashOf(key) % RING;
        for (auto& p : points) if (p.first >= target) return p.second;
        return points[0].second;
    }

    vector<string> runConsistentHash(int vnodes, vector<string> ops) {
        vector<string> out;
        vector<string> nodes = { "a", "b", "c" };
        auto points = buildRing(nodes, vnodes);
        map<string, string> loaded;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "node") {
                string name;
                in >> name;
                nodes.push_back(name);
                points = buildRing(nodes, vnodes);
            } else if (cmd == "load") {
                int n;
                in >> n;
                loaded.clear();
                for (int k = 0; k < n; k++) loaded[to_string(k)] = assign(points, to_string(k));
            } else if (cmd == "moved") {
                if (loaded.empty()) {
                    out.push_back("none");
                    continue;
                }
                int moved = 0;
                for (auto& kv : loaded) if (assign(points, kv.first) != kv.second) moved++;
                out.push_back((double)moved / loaded.size() < 0.5 ? "low" : "high");
            } else if (cmd == "spread") {
                if (loaded.empty()) {
                    out.push_back("none");
                    continue;
                }
                map<string, int> counts;
                for (int k = 0; k < (int)loaded.size(); k++) counts[assign(points, to_string(k))]++;
                double average = (double)loaded.size() / counts.size();
                int most = 0;
                for (auto& kv : counts) most = max(most, kv.second);
                out.push_back(most <= average * 1.8 ? "even" : "uneven");
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
${HASH_DOC}
public:
    vector<string> runConsistentHash(int vnodes, vector<string> ops) {
        // TODO: build the ring, map keys to the first position at or after hash(key) % 360.
        // Report "low"/"high" for moved and "even"/"uneven" for spread.
        return vector<string>(ops.size(), "");
    }
};`,
  },

  "snowflake-id": {
    solution: `class Solution {
public:
    vector<string> runSnowflake(int workerId, vector<string> ops) {
        vector<string> out;
        long long last = -1;
        long long seq = 0;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            long long tick;
            in >> cmd >> tick;
            if (tick == last) {
                seq++;
            } else {
                last = tick;
                seq = 0;
            }
            out.push_back(to_string((tick << 22) | ((long long)workerId << 12) | seq));
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<string> runSnowflake(int workerId, vector<string> ops) {
        // TODO: pack (t << 22) | (workerId << 12) | seq, resetting seq on a new millisecond.
        // The result exceeds 32 bits, so it is returned as a decimal STRING.
        return vector<string>(ops.size(), "");
    }
};`,
  },

  "bloom-filter": {
    solution: `class Solution {
public:
${HASH_DOC}
    int hashOf(const string& s) {
        int h = 0;
        for (char c : s) h = (h * 31 + (unsigned char)c) % 1000003;
        return h;
    }

    vector<int> positions(const string& s, int bits) {
        return { hashOf(s) % bits, hashOf(s + "1") % bits, hashOf(s + "2") % bits };
    }

    vector<int> runBloom(int bits, vector<string> ops) {
        vector<int> out;
        vector<int> array(bits, 0);
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "add") {
                string key;
                in >> key;
                for (int i : positions(key, bits)) array[i] = 1;
            } else if (cmd == "check") {
                string key;
                in >> key;
                bool all = true;
                for (int i : positions(key, bits)) if (!array[i]) all = false;
                out.push_back(all ? 1 : 0);
            } else if (cmd == "bits") {
                int sum = 0;
                for (int b : array) sum += b;
                out.push_back(sum);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
${HASH_DOC}
public:
    vector<int> runBloom(int bits, vector<string> ops) {
        // TODO: set three positions per key and check all three on a lookup.
        vector<int> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "check" || cmd == "bits") out.push_back(0);
        }
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  "wal-kv": {
    solution: `class Solution {
    vector<vector<long long>> snapshot(const map<int, int>& state) {
        vector<vector<long long>> log;
        for (auto& kv : state) log.push_back({ 1, kv.first, kv.second });
        return log;
    }

public:
    vector<int> runWalKv(int capacity, vector<string> ops) {
        vector<int> out;
        vector<vector<long long>> log;
        map<int, int> state;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "set") {
                int key, val;
                in >> key >> val;
                state[key] = val;
                log.push_back({ 1, key, val });
                if ((int)log.size() > capacity) log = snapshot(state);
            } else if (cmd == "del") {
                int key;
                in >> key;
                state.erase(key);
                log.push_back({ 0, key, 0 });
                if ((int)log.size() > capacity) log = snapshot(state);
            } else if (cmd == "get") {
                int key;
                in >> key;
                auto it = state.find(key);
                out.push_back(it == state.end() ? -1 : it->second);
            } else if (cmd == "replay") {
                map<int, int> rebuilt;
                for (auto& entry : log) {
                    if (entry[0] == 1) rebuilt[(int)entry[1]] = (int)entry[2];
                    else rebuilt.erase((int)entry[1]);
                }
                state = rebuilt;
            } else if (cmd == "logsize") {
                out.push_back((int)log.size());
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> runWalKv(int capacity, vector<string> ops) {
        // TODO: append to the log before applying, and compact when the log exceeds capacity.
        vector<int> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "get") out.push_back(-1);
            else if (cmd == "logsize") out.push_back(0);
        }
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------
  "inverted-index": {
    solution: `class Solution {
public:
    vector<string> runInvertedIndex(int limit, vector<string> ops) {
        vector<string> out;
        map<string, set<int>> postings;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "index") {
                int doc;
                in >> doc;
                string term;
                while (in >> term) postings[term].insert(doc);
            } else if (cmd == "search") {
                string term;
                in >> term;
                string joined;
                int n = 0;
                for (int d : postings[term]) {
                    if (n >= limit) break;
                    if (n > 0) joined += ",";
                    joined += to_string(d);
                    n++;
                }
                out.push_back(joined);
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<string> runInvertedIndex(int limit, vector<string> ops) {
        // TODO: postings per term, returned ascending and truncated to limit.
        vector<string> out;
        for (const string& op : ops) {
            istringstream in(op);
            string cmd;
            in >> cmd;
            if (cmd == "search") out.push_back("");
        }
        return out;
    }
};`,
  },
};
