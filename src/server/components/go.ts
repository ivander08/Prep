/**
 * Go: executable system-design components. `starter` compiles and FAILS its tests; `solution` must
 * pass every case in `catalog.ts`; `components.test.ts` enforces both via the executor. The Go
 * harness in `runner.ts` fixes the shape: a bare top-level `func Name(...)` (Go has no `Solution`
 * type); no `import` statement, since the harness emits its own block and splices user code in
 * after it, so a component declares packages in the catalogue's `goImports`, and a starter must
 * USE each one (Go rejects an unused import). Arguments are JSON-decoded into naturally typed
 * parameters (`int`, `[]string`), and the result is compared as `json.Marshal` output, so a nil
 * slice (`null`) differs from an empty slice (`[]`); array-returning components return a non-nil
 * empty slice. `snowflake-id` uses `int64` and returns decimal `[]string` because `(t << 22)`
 * exceeds 2^31; `consistent-hash` and `bloom-filter` share one hash contract, all five languages.
 */

const HASH_DOC = `// hash(s) = fold over characters: h = (h*31 + int(c)) % 1000003`;

export const GO: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------
  "lru-cache": {
    solution: `func RunLru(capacity int, ops []string) []int {
	out := []int{}
	order := []int{}
	store := map[int]int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "put" {
			key, _ := strconv.Atoi(parts[1])
			val, _ := strconv.Atoi(parts[2])
			for i, k := range order {
				if k == key {
					order = append(order[:i], order[i+1:]...)
					break
				}
			}
			store[key] = val
			order = append(order, key)
			if len(store) > capacity {
				evicted := order[0]
				order = order[1:]
				delete(store, evicted)
			}
		} else {
			key, _ := strconv.Atoi(parts[1])
			if val, ok := store[key]; ok {
				for i, k := range order {
					if k == key {
						order = append(order[:i], order[i+1:]...)
						break
					}
				}
				order = append(order, key)
				out = append(out, val)
			} else {
				out = append(out, -1)
			}
		}
	}
	return out
}`,
    starter: `func RunLru(capacity int, ops []string) []int {
	// TODO: a get must refresh recency, and a put over capacity must evict the LRU key.
	out := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "get" {
			out = append(out, -1)
		}
	}
	return out
}`,
  },

  "lfu-cache": {
    solution: `func RunLfu(capacity int, ops []string) []int {
	out := []int{}
	store := map[int]int{}
	freq := map[int]int{}
	seq := map[int]int{}
	clock := 0
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "put" {
			key, _ := strconv.Atoi(parts[1])
			val, _ := strconv.Atoi(parts[2])
			if _, ok := store[key]; ok {
				store[key] = val
				freq[key]++
				clock++
				seq[key] = clock
			} else {
				if len(store) >= capacity {
					victim := -1
					for k := range store {
						if victim == -1 {
							victim = k
							continue
						}
						if freq[k] < freq[victim] || (freq[k] == freq[victim] && seq[k] < seq[victim]) {
							victim = k
						}
					}
					delete(store, victim)
					delete(freq, victim)
					delete(seq, victim)
				}
				store[key] = val
				freq[key] = 1
				clock++
				seq[key] = clock
			}
		} else {
			key, _ := strconv.Atoi(parts[1])
			if val, ok := store[key]; ok {
				freq[key]++
				clock++
				seq[key] = clock
				out = append(out, val)
			} else {
				out = append(out, -1)
			}
		}
	}
	return out
}`,
    starter: `func RunLfu(capacity int, ops []string) []int {
	// TODO: evict the least FREQUENTLY used key, breaking ties by least recently used.
	out := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "get" {
			out = append(out, -1)
		}
	}
	return out
}`,
  },

  "ttl-cache": {
    solution: `func RunTtl(capacity int, ops []string) []int {
	const ttl = 3
	out := []int{}
	store := map[int]int{}
	expiry := map[int]int{}
	order := []int{}
	clock := 0

	purge := func() {
		dead := []int{}
		for k := range store {
			if clock >= expiry[k] {
				dead = append(dead, k)
			}
		}
		for _, k := range dead {
			delete(store, k)
			delete(expiry, k)
			for i, o := range order {
				if o == k {
					order = append(order[:i], order[i+1:]...)
					break
				}
			}
		}
	}

	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "tick" {
			clock++
		} else if parts[0] == "put" {
			key, _ := strconv.Atoi(parts[1])
			val, _ := strconv.Atoi(parts[2])
			purge()
			for i, o := range order {
				if o == key {
					order = append(order[:i], order[i+1:]...)
					break
				}
			}
			store[key] = val
			expiry[key] = clock + ttl
			order = append(order, key)
			if len(store) > capacity {
				evicted := order[0]
				order = order[1:]
				delete(store, evicted)
				delete(expiry, evicted)
			}
		} else {
			purge()
			key, _ := strconv.Atoi(parts[1])
			if val, ok := store[key]; ok {
				for i, o := range order {
					if o == key {
						order = append(order[:i], order[i+1:]...)
						break
					}
				}
				order = append(order, key)
				out = append(out, val)
			} else {
				out = append(out, -1)
			}
		}
	}
	return out
}`,
    starter: `func RunTtl(capacity int, ops []string) []int {
	// TODO: TTL is 3 ticks. An entry written at clock t is live until clock t + 3.
	out := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "get" {
			out = append(out, -1)
		}
	}
	return out
}`,
  },

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  "fixed-window": {
    solution: `func RunFixedWindow(limit int, ops []string) []int {
	out := []int{}
	counts := map[int]int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		tick, _ := strconv.Atoi(parts[1])
		window := tick / 10
		if counts[window] < limit {
			counts[window]++
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
	}
	return out
}`,
    starter: `func RunFixedWindow(limit int, ops []string) []int {
	// TODO: the window is t / 10. The counter resets when the window changes.
	out := []int{}
	for range ops {
		out = append(out, 0)
	}
	return out
}`,
  },

  "sliding-window-log": {
    solution: `func RunSlidingWindow(limit int, ops []string) []int {
	out := []int{}
	accepted := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		tick, _ := strconv.Atoi(parts[1])
		kept := []int{}
		for _, t := range accepted {
			if t > tick-10 {
				kept = append(kept, t)
			}
		}
		accepted = kept
		if len(accepted) < limit {
			accepted = append(accepted, tick)
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
	}
	return out
}`,
    starter: `func RunSlidingWindow(limit int, ops []string) []int {
	// TODO: keep the timestamps of accepted requests; drop those at or before t - 10.
	out := []int{}
	for range ops {
		out = append(out, 0)
	}
	return out
}`,
  },

  "token-bucket": {
    solution: `func RunTokenBucket(rate int, ops []string) []int {
	out := []int{}
	capacity := rate * 2
	tokens := capacity
	last := 0
	for _, op := range ops {
		parts := strings.Fields(op)
		tick, _ := strconv.Atoi(parts[1])
		tokens += (tick - last) * rate
		if tokens > capacity {
			tokens = capacity
		}
		last = tick
		if tokens >= 1 {
			tokens--
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
	}
	return out
}`,
    starter: `func RunTokenBucket(rate int, ops []string) []int {
	// TODO: capacity is 2 * rate, the bucket starts FULL, and it refills rate per tick.
	out := []int{}
	for range ops {
		out = append(out, 0)
	}
	return out
}`,
  },

  "leaky-bucket": {
    solution: `func RunLeakyBucket(rate int, ops []string) []int {
	out := []int{}
	capacity := rate
	level := 0
	last := 0
	for _, op := range ops {
		parts := strings.Fields(op)
		tick, _ := strconv.Atoi(parts[1])
		level -= (tick - last) * rate
		if level < 0 {
			level = 0
		}
		last = tick
		if level < capacity {
			level++
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
	}
	return out
}`,
    starter: `func RunLeakyBucket(rate int, ops []string) []int {
	// TODO: capacity is rate, the bucket starts EMPTY, and it drains rate per tick.
	out := []int{}
	for range ops {
		out = append(out, 0)
	}
	return out
}`,
  },

  // ---------------------------------------------------------------------------
  // Coordination
  // ---------------------------------------------------------------------------
  "consistent-hash": {
    solution: `${HASH_DOC}
type ringPoint struct {
	pos  int
	node string
}

func ringHash(s string) int {
	h := 0
	for _, c := range s {
		h = (h*31 + int(c)) % 1000003
	}
	return h
}

func buildRing(nodes []string, vnodes int) []ringPoint {
	points := []ringPoint{}
	for _, node := range nodes {
		for i := 0; i < vnodes; i++ {
			points = append(points, ringPoint{ringHash(node + "#" + strconv.Itoa(i)) % 360, node})
		}
	}
	sort.Slice(points, func(a, b int) bool {
		if points[a].pos != points[b].pos {
			return points[a].pos < points[b].pos
		}
		return points[a].node < points[b].node
	})
	return points
}

func ringAssign(ring []ringPoint, key string) string {
	if len(ring) == 0 {
		return ""
	}
	target := ringHash(key) % 360
	for _, p := range ring {
		if p.pos >= target {
			return p.node
		}
	}
	return ring[0].node
}

func RunConsistentHash(vnodes int, ops []string) []string {
	out := []string{}
	nodes := []string{"a", "b", "c"}
	ring := buildRing(nodes, vnodes)
	loaded := map[string]string{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "node" {
			nodes = append(nodes, parts[1])
			ring = buildRing(nodes, vnodes)
		} else if parts[0] == "load" {
			n, _ := strconv.Atoi(parts[1])
			loaded = map[string]string{}
			for k := 0; k < n; k++ {
				key := strconv.Itoa(k)
				loaded[key] = ringAssign(ring, key)
			}
		} else if parts[0] == "moved" {
			if len(loaded) == 0 {
				out = append(out, "none")
				continue
			}
			moved := 0
			for k, v := range loaded {
				if ringAssign(ring, k) != v {
					moved++
				}
			}
			if float64(moved)/float64(len(loaded)) < 0.5 {
				out = append(out, "low")
			} else {
				out = append(out, "high")
			}
		} else if parts[0] == "spread" {
			if len(loaded) == 0 {
				out = append(out, "none")
				continue
			}
			counts := map[string]int{}
			for k := 0; k < len(loaded); k++ {
				counts[ringAssign(ring, strconv.Itoa(k))]++
			}
			most := 0
			for _, c := range counts {
				if c > most {
					most = c
				}
			}
			average := float64(len(loaded)) / float64(len(counts))
			if float64(most) <= average*1.8 {
				out = append(out, "even")
			} else {
				out = append(out, "uneven")
			}
		}
	}
	return out
}`,
    starter: `${HASH_DOC}
func RunConsistentHash(vnodes int, ops []string) []string {
	// TODO: build the ring, map keys to the first position at or after hash(key) % 360.
	// Report "low"/"high" for moved and "even"/"uneven" for spread.
	out := []string{}
	for range ops {
		out = append(out, "")
	}
	return out
}`,
  },

  "snowflake-id": {
    solution: `func RunSnowflake(workerId int, ops []string) []string {
	out := []string{}
	last := int64(-1)
	seq := int64(0)
	for _, op := range ops {
		parts := strings.Fields(op)
		tick, _ := strconv.ParseInt(parts[1], 10, 64)
		if tick == last {
			seq++
		} else {
			last = tick
			seq = 0
		}
		id := (tick << 22) | (int64(workerId) << 12) | seq
		out = append(out, strconv.FormatInt(id, 10))
	}
	return out
}`,
    starter: `func RunSnowflake(workerId int, ops []string) []string {
	// TODO: pack (t << 22) | (workerId << 12) | seq, resetting seq on a new millisecond.
	// The result exceeds 32 bits, so it is returned as a decimal STRING.
	out := []string{}
	for range ops {
		out = append(out, "")
	}
	return out
}`,
  },

  "bloom-filter": {
    solution: `${HASH_DOC}
func bloomHash(s string) int {
	h := 0
	for _, c := range s {
		h = (h*31 + int(c)) % 1000003
	}
	return h
}

func bloomPositions(s string, bits int) []int {
	return []int{bloomHash(s) % bits, bloomHash(s+"1") % bits, bloomHash(s+"2") % bits}
}

func RunBloom(bits int, ops []string) []int {
	out := []int{}
	array := make([]int, bits)
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "add" {
			for _, i := range bloomPositions(parts[1], bits) {
				array[i] = 1
			}
		} else if parts[0] == "check" {
			all := true
			for _, i := range bloomPositions(parts[1], bits) {
				if array[i] == 0 {
					all = false
				}
			}
			if all {
				out = append(out, 1)
			} else {
				out = append(out, 0)
			}
		} else if parts[0] == "bits" {
			sum := 0
			for _, b := range array {
				sum += b
			}
			out = append(out, sum)
		}
	}
	return out
}`,
    starter: `${HASH_DOC}
func RunBloom(bits int, ops []string) []int {
	// TODO: set three positions per key and check all three on a lookup.
	out := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "check" || parts[0] == "bits" {
			out = append(out, 0)
		}
	}
	return out
}`,
  },

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  "wal-kv": {
    solution: `func RunWalKv(capacity int, ops []string) []int {
	out := []int{}
	log := [][3]int{}
	state := map[int]int{}

	snapshot := func() [][3]int {
		keys := []int{}
		for k := range state {
			keys = append(keys, k)
		}
		sort.Ints(keys)
		compacted := [][3]int{}
		for _, k := range keys {
			compacted = append(compacted, [3]int{1, k, state[k]})
		}
		return compacted
	}

	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "set" {
			key, _ := strconv.Atoi(parts[1])
			val, _ := strconv.Atoi(parts[2])
			state[key] = val
			log = append(log, [3]int{1, key, val})
			if len(log) > capacity {
				log = snapshot()
			}
		} else if parts[0] == "del" {
			key, _ := strconv.Atoi(parts[1])
			delete(state, key)
			log = append(log, [3]int{0, key, 0})
			if len(log) > capacity {
				log = snapshot()
			}
		} else if parts[0] == "get" {
			key, _ := strconv.Atoi(parts[1])
			if val, ok := state[key]; ok {
				out = append(out, val)
			} else {
				out = append(out, -1)
			}
		} else if parts[0] == "replay" {
			rebuilt := map[int]int{}
			for _, entry := range log {
				if entry[0] == 1 {
					rebuilt[entry[1]] = entry[2]
				} else {
					delete(rebuilt, entry[1])
				}
			}
			state = rebuilt
		} else if parts[0] == "logsize" {
			out = append(out, len(log))
		}
	}
	return out
}`,
    starter: `func RunWalKv(capacity int, ops []string) []int {
	// TODO: append to the log before applying, and compact when the log exceeds capacity.
	out := []int{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "get" {
			out = append(out, -1)
		} else if parts[0] == "logsize" {
			out = append(out, 0)
		}
	}
	return out
}`,
  },

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------
  "inverted-index": {
    solution: `func RunInvertedIndex(limit int, ops []string) []string {
	out := []string{}
	postings := map[string]map[int]bool{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "index" {
			doc, _ := strconv.Atoi(parts[1])
			for _, term := range parts[2:] {
				if postings[term] == nil {
					postings[term] = map[int]bool{}
				}
				postings[term][doc] = true
			}
		} else if parts[0] == "search" {
			docs := []int{}
			for d := range postings[parts[1]] {
				docs = append(docs, d)
			}
			sort.Ints(docs)
			if len(docs) > limit {
				docs = docs[:limit]
			}
			joined := []string{}
			for _, d := range docs {
				joined = append(joined, strconv.Itoa(d))
			}
			out = append(out, strings.Join(joined, ","))
		}
	}
	return out
}`,
    starter: `func RunInvertedIndex(limit int, ops []string) []string {
	// TODO: postings per term, returned ascending and truncated to limit.
	out := []string{}
	for _, op := range ops {
		parts := strings.Fields(op)
		if parts[0] == "search" {
			out = append(out, "")
		}
	}
	return out
}`,
  },
};
