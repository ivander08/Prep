/**
 * JavaScript: executable system-design components.
 *
 * `starter` compiles but fails its tests; `solution` must pass every case in `catalog.ts`.
 * Both are enforced by `components.test.ts` through the real executor.
 *
 * The harness calls a bare top-level function named by `fnNameFor("javascript", name)`, the
 * camelCase of the catalogue's canonical name. There is no `Solution` class in JavaScript.
 *
 * The hash is part of the contract for `consistent-hash` and `bloom-filter`: both are
 * unsatisfiable without agreeing on it, so it appears identically in all five languages.
 */

const HASH_DOC = `// hash(s) = fold over characters: h = (h * 31 + c.charCodeAt(i)) % 1000003`;

export const JAVASCRIPT: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------
  "lru-cache": {
    starter: `function runLru(capacity, ops) {
  // TODO: a get must refresh recency, and a put over capacity must evict the LRU key.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "get") out.push(-1);
  }
  return out;
}`,
    solution: `function runLru(capacity, ops) {
  const out = [];
  const order = [];
  const store = new Map();
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "put") {
      const key = Number(parts[1]), val = Number(parts[2]);
      const at = order.indexOf(key);
      if (at !== -1) order.splice(at, 1);
      store.set(key, val);
      order.push(key);
      if (store.size > capacity) {
        const evicted = order.shift();
        store.delete(evicted);
      }
    } else {
      const key = Number(parts[1]);
      if (store.has(key)) {
        const at = order.indexOf(key);
        order.splice(at, 1);
        order.push(key);
        out.push(store.get(key));
      } else {
        out.push(-1);
      }
    }
  }
  return out;
}`,
  },

  "lfu-cache": {
    starter: `function runLfu(capacity, ops) {
  // TODO: evict the least FREQUENTLY used key, breaking ties by least recently used.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "get") out.push(-1);
  }
  return out;
}`,
    solution: `function runLfu(capacity, ops) {
  const out = [];
  const store = new Map();
  const freq = new Map();
  const seq = new Map();
  let clock = 0;
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "put") {
      const key = Number(parts[1]), val = Number(parts[2]);
      if (store.has(key)) {
        store.set(key, val);
        freq.set(key, freq.get(key) + 1);
        clock++;
        seq.set(key, clock);
      } else {
        if (store.size >= capacity) {
          let victim = null;
          for (const k of store.keys()) {
            if (victim === null) { victim = k; continue; }
            const a = freq.get(k), b = freq.get(victim);
            if (a < b || (a === b && seq.get(k) < seq.get(victim))) victim = k;
          }
          store.delete(victim); freq.delete(victim); seq.delete(victim);
        }
        store.set(key, val);
        freq.set(key, 1);
        clock++;
        seq.set(key, clock);
      }
    } else {
      const key = Number(parts[1]);
      if (store.has(key)) {
        freq.set(key, freq.get(key) + 1);
        clock++;
        seq.set(key, clock);
        out.push(store.get(key));
      } else {
        out.push(-1);
      }
    }
  }
  return out;
}`,
  },

  "ttl-cache": {
    starter: `function runTtl(capacity, ops) {
  // TODO: TTL is 3 ticks. An entry written at clock t is live until clock t + 3.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "get") out.push(-1);
  }
  return out;
}`,
    solution: `function runTtl(capacity, ops) {
  const TTL = 3;
  const out = [];
  const store = new Map();
  const expiry = new Map();
  const order = [];
  let clock = 0;

  const purge = () => {
    for (const key of [...store.keys()]) {
      if (clock >= expiry.get(key)) {
        store.delete(key); expiry.delete(key);
        order.splice(order.indexOf(key), 1);
      }
    }
  };

  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "tick") {
      clock++;
      purge();
    } else if (parts[0] === "put") {
      const key = Number(parts[1]), val = Number(parts[2]);
      purge();
      const at = order.indexOf(key);
      if (at !== -1) order.splice(at, 1);
      store.set(key, val);
      expiry.set(key, clock + TTL);
      order.push(key);
      if (store.size > capacity) {
        const evicted = order.shift();
        store.delete(evicted); expiry.delete(evicted);
      }
    } else {
      purge();
      const key = Number(parts[1]);
      if (store.has(key)) {
        order.splice(order.indexOf(key), 1);
        order.push(key);
        out.push(store.get(key));
      } else {
        out.push(-1);
      }
    }
  }
  return out;
}`,
  },

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  "fixed-window": {
    starter: `function runFixedWindow(limit, ops) {
  // TODO: the window is Math.floor(t / 10). The counter resets when the window changes.
  return ops.map(() => 0);
}`,
    solution: `function runFixedWindow(limit, ops) {
  const out = [];
  const counts = new Map();
  for (const op of ops) {
    const tick = Number(op.split(" ")[1]);
    const window = Math.floor(tick / 10);
    const used = counts.get(window) ?? 0;
    if (used < limit) {
      counts.set(window, used + 1);
      out.push(1);
    } else {
      out.push(0);
    }
  }
  return out;
}`,
  },

  "sliding-window-log": {
    starter: `function runSlidingWindow(limit, ops) {
  // TODO: keep the timestamps of accepted requests; drop those at or before t - 10.
  return ops.map(() => 0);
}`,
    solution: `function runSlidingWindow(limit, ops) {
  const out = [];
  let accepted = [];
  for (const op of ops) {
    const tick = Number(op.split(" ")[1]);
    accepted = accepted.filter((x) => x > tick - 10);
    if (accepted.length < limit) {
      accepted.push(tick);
      out.push(1);
    } else {
      out.push(0);
    }
  }
  return out;
}`,
  },

  "token-bucket": {
    starter: `function runTokenBucket(rate, ops) {
  // TODO: capacity is 2 * rate, the bucket starts FULL, and it refills rate per tick.
  return ops.map(() => 0);
}`,
    solution: `function runTokenBucket(rate, ops) {
  const out = [];
  const capacity = rate * 2;
  let tokens = capacity;
  let last = 0;
  for (const op of ops) {
    const tick = Number(op.split(" ")[1]);
    tokens = Math.min(capacity, tokens + (tick - last) * rate);
    last = tick;
    if (tokens >= 1) {
      tokens -= 1;
      out.push(1);
    } else {
      out.push(0);
    }
  }
  return out;
}`,
  },

  "leaky-bucket": {
    starter: `function runLeakyBucket(rate, ops) {
  // TODO: capacity is rate, the bucket starts EMPTY, and it drains rate per tick.
  return ops.map(() => 0);
}`,
    solution: `function runLeakyBucket(rate, ops) {
  const out = [];
  const capacity = rate;
  let level = 0;
  let last = 0;
  for (const op of ops) {
    const tick = Number(op.split(" ")[1]);
    level = Math.max(0, level - (tick - last) * rate);
    last = tick;
    if (level < capacity) {
      level += 1;
      out.push(1);
    } else {
      out.push(0);
    }
  }
  return out;
}`,
  },

  // ---------------------------------------------------------------------------
  // Coordination
  // ---------------------------------------------------------------------------
  "consistent-hash": {
    starter: `function runConsistentHash(vnodes, ops) {
  ${HASH_DOC}
  // TODO: build the ring, map keys to the first position at or after hash(key) % 360.
  // Report "low"/"high" for moved and "even"/"uneven" for spread.
  return ops.map(() => "");
}`,
    solution: `function runConsistentHash(vnodes, ops) {
  ${HASH_DOC}
  const RING = 360;
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return h;
  };
  const buildRing = (nodes) => {
    const points = [];
    for (const node of nodes) {
      for (let i = 0; i < vnodes; i++) points.push([hash(node + "#" + i) % RING, node]);
    }
    points.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    return points;
  };
  const assign = (points, key) => {
    if (points.length === 0) return "";
    const target = hash(key) % RING;
    for (const [pos, node] of points) if (pos >= target) return node;
    return points[0][1];
  };

  const out = [];
  const nodes = ["a", "b", "c"];
  let points = buildRing(nodes);
  let loaded = {};
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "node") {
      nodes.push(parts[1]);
      points = buildRing(nodes);
    } else if (parts[0] === "load") {
      const n = Number(parts[1]);
      loaded = {};
      for (let k = 0; k < n; k++) loaded[String(k)] = assign(points, String(k));
    } else if (parts[0] === "moved") {
      const keys = Object.keys(loaded);
      if (keys.length === 0) { out.push("none"); continue; }
      const moved = keys.filter((k) => assign(points, k) !== loaded[k]).length;
      out.push(moved / keys.length < 0.5 ? "low" : "high");
    } else if (parts[0] === "spread") {
      const keys = Object.keys(loaded);
      if (keys.length === 0) { out.push("none"); continue; }
      const counts = new Map();
      for (const k of keys) {
        const node = assign(points, k);
        counts.set(node, (counts.get(node) ?? 0) + 1);
      }
      const average = keys.length / counts.size;
      out.push(Math.max(...counts.values()) <= average * 1.8 ? "even" : "uneven");
    }
  }
  return out;
}`,
  },

  "snowflake-id": {
    starter: `function runSnowflake(workerId, ops) {
  // TODO: pack (t << 22) | (workerId << 12) | seq, resetting seq on a new millisecond.
  // The result exceeds 32 bits, so it is returned as a decimal STRING.
  return ops.map(() => "");
}`,
    solution: `function runSnowflake(workerId, ops) {
  const out = [];
  let last = -1;
  let seq = 0;
  for (const op of ops) {
    const tick = Number(op.split(" ")[1]);
    if (tick === last) {
      seq++;
    } else {
      last = tick;
      seq = 0;
    }
    out.push(String(tick * 4194304 + workerId * 4096 + seq));
  }
  return out;
}`,
  },

  "bloom-filter": {
    starter: `function runBloom(bits, ops) {
  ${HASH_DOC}
  // TODO: set three positions per key and check all three on a lookup.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "check" || parts[0] === "bits") out.push(0);
  }
  return out;
}`,
    solution: `function runBloom(bits, ops) {
  ${HASH_DOC}
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return h;
  };
  const positions = (s) => [hash(s) % bits, hash(s + "1") % bits, hash(s + "2") % bits];

  const out = [];
  const array = new Array(bits).fill(0);
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "add") {
      for (const i of positions(parts[1])) array[i] = 1;
    } else if (parts[0] === "check") {
      out.push(positions(parts[1]).every((i) => array[i] === 1) ? 1 : 0);
    } else if (parts[0] === "bits") {
      out.push(array.reduce((a, b) => a + b, 0));
    }
  }
  return out;
}`,
  },

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  "wal-kv": {
    starter: `function runWalKv(capacity, ops) {
  // TODO: append to the log before applying, and compact when the log exceeds capacity.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "get") out.push(-1);
    else if (parts[0] === "logsize") out.push(0);
  }
  return out;
}`,
    solution: `function runWalKv(capacity, ops) {
  const out = [];
  let log = [];
  let state = new Map();

  const compact = () => {
    if (log.length > capacity) {
      log = [...state.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ["set", k, v]);
    }
  };

  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "set") {
      const key = Number(parts[1]), val = Number(parts[2]);
      state.set(key, val);
      log.push(["set", key, val]);
      compact();
    } else if (parts[0] === "del") {
      const key = Number(parts[1]);
      state.delete(key);
      log.push(["del", key, 0]);
      compact();
    } else if (parts[0] === "get") {
      const key = Number(parts[1]);
      out.push(state.has(key) ? state.get(key) : -1);
    } else if (parts[0] === "replay") {
      const rebuilt = new Map();
      for (const entry of log) {
        if (entry[0] === "set") rebuilt.set(entry[1], entry[2]);
        else rebuilt.delete(entry[1]);
      }
      state = rebuilt;
    } else if (parts[0] === "logsize") {
      out.push(log.length);
    }
  }
  return out;
}`,
  },

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------
  "inverted-index": {
    starter: `function runInvertedIndex(limit, ops) {
  // TODO: postings per term, returned ascending and truncated to limit.
  const out = [];
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "search") out.push("");
  }
  return out;
}`,
    solution: `function runInvertedIndex(limit, ops) {
  const out = [];
  const postings = new Map();
  for (const op of ops) {
    const parts = op.split(" ");
    if (parts[0] === "index") {
      const doc = Number(parts[1]);
      for (const term of parts.slice(2)) {
        if (!postings.has(term)) postings.set(term, new Set());
        postings.get(term).add(doc);
      }
    } else if (parts[0] === "search") {
      const docs = [...(postings.get(parts[1]) ?? new Set())].sort((a, b) => a - b).slice(0, limit);
      out.push(docs.join(","));
    }
  }
  return out;
}`,
  },
};
