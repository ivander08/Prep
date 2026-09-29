/**
 * Pattern reference cards: the shared catalogue.
 *
 * One entry per roadmap pattern, held in code, not a table, the same way `concepts/catalog.ts` and `design/catalog.ts` are: a prose edit is then a source edit, not a migration.
 *
 * The `pattern` field is a foreign key without a constraint. The roadmap vocabulary is INGESTED (`patterns.ts` writes `problems.pattern`), not declared here, so a re-ingest can add or rename a pattern with no code change. That is why `getPatternRef` returns null, not throws: "no card yet" is a normal state the roadmap renders as nothing at all. A lookup that throws would turn a data refresh into a 500.
 *
 * `stdlib` is required in all five languages. The app runs five languages and grades all five, so a card that only helps Python teaches the wrong lesson: the reference answers "what do I call here", and "nothing, write it yourself" is a different answer per language. `reference.test.ts` fails if any language key is missing.
 *
 * `cornerCases` and `pitfalls` are separate. Corner cases are properties of the INPUT that break the obvious implementation; pitfalls are mistakes in the IMPLEMENTATION that pass the sample case and fail the hidden one. They are the two ways a submission dies and they call for different fixes, so merging them would lose the distinction that makes the card useful.
 * `complexity` is the canonical operation's cost, not a data-structure table: two or three rows for the operation the pattern is built around. A full complexity table is what the textbook is for; this is the line you need mid-interview.
 */

import { LANGS } from "../concepts.ts";

export type Lang = (typeof LANGS)[number];

/**
 * Interview weight, from techinterviewhandbook's cheatsheet priority column. Drives the
 * roadmap's ordering: the roadmap sorts by Elo alone today, so a pattern with no attempts has
 * no ordering signal at all.
 */
export type Priority = "High" | "Mid" | "Low";

export type PatternRef = {
  /** Exactly `problems.pattern`, character for character. */
  pattern: string;
  priority: Priority;
  /** The canonical operation's cost. Two or three rows, not a complexity-table dump. */
  complexity: Array<{ operation: string; cost: string }>;
  /** Inputs that break the obvious implementation. The reason this card exists. */
  cornerCases: string[];
  /** Mistakes that pass the sample case and fail the hidden one. */
  pitfalls: string[];
  /**
   * The call that already does this, per language. All five keys REQUIRED: the app runs five
   * languages and a card that helps only Python teaches the wrong lesson.
   */
  stdlib: Record<Lang, string>;
};

const NA = "not applicable — this pattern is JavaScript-only";

export const PATTERN_REFS: PatternRef[] = [
  {
    pattern: "Arrays & Hashing",
    priority: "High",
    complexity: [
      { operation: "insert / lookup / delete by key", cost: "O(1) average, O(n) worst case" },
      { operation: "single pass with a hash map", cost: "O(n) time, O(n) space" },
      { operation: "sort then two-pointer alternative", cost: "O(n log n) time, O(1) extra space" },
    ],
    cornerCases: [
      "Empty array — the map is built but the loop never runs, and an unguarded `max()` or `[0]` throws.",
      "Single element — every pair-based answer must not match the element against itself.",
      "Duplicates — `[2,2,4]` with target 6 is two DIFFERENT indices, so the check must precede the insert.",
      "Negative numbers — an array-as-bucket trick keyed on the value breaks the moment a value is below zero.",
      "Values that collide under a mod/bitmask hash — the worst case is O(n) per lookup, not O(1).",
    ],
    pitfalls: [
      "Counting with `if x in dict` on every element instead of `Counter` — correct but silently O(n) with a large constant.",
      "Assuming the input is sorted because the examples are; the statement rarely says so.",
      "Mutating the array while iterating over it, so indices shift under the loop.",
      "Returning the map itself when the question asked for an ordered list — dict order is insertion order, not answer order.",
    ],
    stdlib: {
      python3: "collections.Counter / dict.get(k, 0) + 1",
      javascript: "new Map() / Object.groupBy(items, fn)",
      java: "HashMap<K, Integer> with merge(k, 1, Integer::sum)",
      cpp: "std::unordered_map<K, int>, counting with `++m[k]`",
      go: "map[string]int, counting with `m[k]++` (zero value is ready to use)",
    },
  },
  {
    pattern: "Two Pointers",
    priority: "Mid",
    complexity: [
      { operation: "opposite-end scan over a sorted array", cost: "O(n) time, O(1) space" },
      { operation: "same-direction (fast/slow) scan", cost: "O(n) time, O(1) space" },
      { operation: "the sort that makes two pointers legal", cost: "O(n log n) — and it dominates" },
    ],
    cornerCases: [
      "Two elements — the loop body must run exactly once, so `while (l < r)` and `while (l <= r)` give different answers.",
      "All elements equal — a sum-based search moves one pointer per step; a value-based one can stall.",
      "Pointer crossing — the loop must stop BEFORE the pointers pass, or the same pair is counted twice.",
      "A pair that uses the same index twice (`[3,3]`, target 6) — valid only if the statement says distinct indices.",
    ],
    pitfalls: [
      "Advancing both pointers when only one should move — on a sorted sum, moving both can skip the answer entirely.",
      "Forgetting that two pointers on an unsorted array requires a sort first, which changes the index meaning the answer may rely on.",
      "Using `l <= r` in a dedup loop and emitting the middle element twice.",
    ],
    stdlib: {
      python3: "slicing — `nums[i:j]`, `nums[::-1]`",
      javascript: "Array.prototype.slice / arr.at(-1) for the far end",
      java: "Arrays.copyOfRange(a, from, to)",
      cpp: "std::vector iterators — `nums.begin() + i`; std::reverse",
      go: "slice expressions — `s[i:j]`, with the caveat that they share the backing array",
    },
  },
  {
    pattern: "Sliding Window",
    priority: "Mid",
    complexity: [
      { operation: "fixed-size window over the array", cost: "O(n) time, O(1) space" },
      { operation: "variable-size window (each index enters and leaves once)", cost: "O(n) time, O(k) space" },
      { operation: "window contents in a hash map", cost: "O(n) time, O(k) space" },
    ],
    cornerCases: [
      "Window longer than the input — the first `k` elements never fill it, and a `sum -= nums[i-k]` guard reads a negative index.",
      "All-negative values — a `max(0, sum)` reset makes every window zero and the answer wrong.",
      "Shrink condition that is never true — the right pointer runs to the end and the window is the whole array.",
      "k = 0 — the window is empty and the answer is degenerate, not the first element.",
    ],
    pitfalls: [
      "Shrinking with `if` instead of `while` — one shrink per step is not enough when the invariant is violated by more than one element.",
      "Recomputing the window sum from scratch each step, which is O(n·k) and passes small cases.",
      "Subtracting the element at the wrong end of the window (left instead of the one just passed).",
      "Tracking a `best` that is updated before the window is valid, so an invalid window wins.",
    ],
    stdlib: {
      python3: "collections.deque with maxlen for a bounded window",
      javascript: "an array used as a queue, or a plain `l`/`r` index pair (faster than shift())",
      java: "ArrayDeque<T> for the window's contents",
      cpp: "std::deque<T> for the window's contents",
      go: "re-slicing the same backing array — `s[l:r]`, no allocation",
    },
  },
  {
    pattern: "Stack",
    priority: "Mid",
    complexity: [
      { operation: "push / pop / peek", cost: "O(1)" },
      { operation: "monotonic stack over n elements", cost: "O(n) amortised — each element is pushed and popped once" },
      { operation: "recursion replaced by an explicit stack", cost: "O(n) space, but on the heap instead of the call stack" },
    ],
    cornerCases: [
      "Popping an empty stack — every `pop` in a bracket/expression problem needs an emptiness guard first.",
      "Unbalanced input that ends with the stack non-empty — the loop finishes 'cleanly' and the answer is still no.",
      "A single opening bracket — the closing check never runs, so the final emptiness check is the only thing that catches it.",
      "Nested different types (`([)]`) — matching by count instead of by pair accepts it.",
    ],
    pitfalls: [
      "Checking the closing bracket's match before checking the stack is empty, which throws instead of returning false.",
      "Building a monotonic stack but pushing every element unconditionally, so it is no longer monotonic.",
      "Using a stack where the answer needs indices rather than values — storing values loses the distance.",
    ],
    stdlib: {
      python3: "list — append() / pop(), peek with `stack[-1]`",
      javascript: "Array — push() / pop(), peek with `a[a.length - 1]`",
      java: "ArrayDeque<T> (prefer over the legacy synchronized Stack)",
      cpp: "std::stack<T> (or std::vector used as one when you need indexing)",
      go: "a slice — `append(s, x)` and `s = s[:len(s)-1]`",
    },
  },
  {
    pattern: "Binary Search",
    priority: "High",
    complexity: [
      { operation: "search in a sorted array", cost: "O(log n) time, O(1) space" },
      { operation: "search over an answer space (binary search on the value)", cost: "O(log range · cost of the check)" },
      { operation: "finding a boundary rather than an exact match", cost: "O(log n), but needs lower_bound semantics" },
    ],
    cornerCases: [
      "Empty array — the loop never runs and `lo` is 0, so an unguarded `nums[lo]` throws or returns the wrong thing.",
      "Single element — the loop must execute exactly once, which is where `<` vs `<=` shows up.",
      "All elements equal — an exact-match search can land on any of them; a boundary search must land on the first or last.",
      "Target at either end — off-by-one loop bounds return -1 for an element that is present.",
      "Duplicates with a 'first/last occurrence' requirement — plain binary search finds *a* match, not the boundary.",
    ],
    pitfalls: [
      "`mid = (lo + hi) / 2` overflowing for large indices — `lo + (hi - lo) / 2` is the safe form (and in Java it is a real overflow).",
      "Infinite loop when `lo == hi`: if the update is `lo = mid` rather than `lo = mid + 1`, the range never shrinks.",
      "Returning `mid` from inside the loop when the question asks for the insertion point, so a missing value returns -1 instead of `lo`.",
      "Recomputing the check on a non-monotonic predicate — binary search is only valid if the predicate is monotone.",
    ],
    stdlib: {
      python3: "bisect.bisect_left / bisect_right (bisect_left for lower bound)",
      javascript: "no stdlib — hand-rolled `lo + ((hi - lo) >> 1)`",
      java: "Arrays.binarySearch (returns -(insertion point) - 1 when absent)",
      cpp: "std::lower_bound / std::upper_bound",
      go: "sort.Search(n, func(i int) bool) — the predicate is 'index i satisfies it'",
    },
  },
  {
    pattern: "Linked List",
    priority: "Mid",
    complexity: [
      { operation: "traverse to the end", cost: "O(n) time, O(1) space" },
      { operation: "insert / delete given the node", cost: "O(1) — the whole reason to use a list" },
      { operation: "find by index", cost: "O(n) — no random access" },
    ],
    cornerCases: [
      "Empty list — `head === null` must return before any dereference.",
      "Single node — reversing or deleting it must produce null/empty, not a self-loop.",
      "A cycle — any traversal without a visited set or a fast/slow pair never terminates.",
      "Odd vs even length for the middle-node problem — the two cases want different halves, and the examples usually show only one.",
      "Removing the head — the answer is the second node, so the return value must change, not `head.next`.",
    ],
    pitfalls: [
      "Losing the head when mutating in place — the old `head` is now the tail, and returning it returns one node.",
      "Reversing with `prev/curr/next` but forgetting to advance `prev` at the end of the loop.",
      "Allocating a new node per iteration where the problem says to rearrange in place.",
      "Comparing node values instead of node identity when checking for a cycle.",
    ],
    stdlib: {
      python3: "the provided ListNode — walk with `while node: node = node.next`",
      javascript: "the provided ListNode — walk with `while (node) node = node.next`",
      java: "the provided ListNode — walk with `while (node != null) node = node.next`",
      cpp: "the provided ListNode* — walk with `while (node) node = node->next`",
      go: "the provided *ListNode — walk with `for node != nil { node = node.Next }`",
    },
  },
  {
    pattern: "Trees",
    priority: "High",
    complexity: [
      { operation: "DFS traversal (recursive or explicit stack)", cost: "O(n) time, O(h) space" },
      { operation: "BFS / level order", cost: "O(n) time, O(w) space where w is the widest level" },
      { operation: "BST search", cost: "O(h) — O(log n) balanced, O(n) for a skewed tree" },
    ],
    cornerCases: [
      "Empty tree — `root === null` must be answered without recursing, or the recursion dereferences null.",
      "Single node — leaf handling runs on the root, so a `left && right` guard silently skips it.",
      "Skewed tree (depth = n) — an O(h) recursion is now O(n) stack, which blows the stack on a 10^5-node chain.",
      "Duplicate keys in a BST — the 'strictly less / strictly greater' range check must decide which side they belong on.",
      "A node with one child — 'count leaves' and 'sum left leaves' both need the childless test, not the one-child test.",
    ],
    pitfalls: [
      "Recursing on null without a base case, so the empty tree throws instead of returning the identity value.",
      "Validating a BST by comparing each node to its parent rather than to the running (lo, hi) bounds — it accepts trees that are locally sorted and globally wrong.",
      "Using a list as a BFS queue and `pop(0)`, which is O(n) per pop and turns BFS into O(n²).",
      "Mixing up the order of an inorder traversal when the problem needs sorted output.",
    ],
    stdlib: {
      python3: "collections.deque — popleft() for BFS, append() for the queue",
      javascript: "an array with a head index for BFS (shift() is O(n))",
      java: "ArrayDeque<TreeNode> — addLast() / pollFirst()",
      cpp: "std::queue<TreeNode*>",
      go: "a slice as a queue — `q = q[1:]` (note it keeps the backing array alive)",
    },
  },
  {
    pattern: "Tries",
    priority: "Mid",
    complexity: [
      { operation: "insert / search a word of length L", cost: "O(L) time, independent of the dictionary size" },
      { operation: "space for n words", cost: "O(total characters) — often the reason not to use a trie" },
      { operation: "prefix query", cost: "O(L) — the pattern's whole advantage over a hash set" },
    ],
    cornerCases: [
      "Empty word — inserting it creates no nodes, so `search(\"\")` must be defined explicitly.",
      "Shared prefixes — `car` then `cart`: the terminal flag must live on the node, not on the path.",
      "Word vs prefix — `search(\"car\")` must be false after only `cart` was inserted, while `startsWith(\"car\")` is true.",
      "A word that is a prefix of another — the shorter one must still be marked terminal.",
    ],
    pitfalls: [
      "Marking a node terminal at insert time (on the way down) instead of at the end of the word, which makes every prefix a word.",
      "Using a plain `{}` for children and colliding with inherited keys like `constructor` in JavaScript.",
      "Forgetting to clear the terminal flag on delete, so a deleted word still searches true.",
      "Recursing over the whole alphabet at each node instead of iterating the node's actual children.",
    ],
    stdlib: {
      python3: "dict-of-dicts, terminal marked by a sentinel key such as `'#'`",
      javascript: "Object.create(null) for children (no prototype keys) plus a `word`/`end` flag",
      java: "HashMap<Character, Node> per node, or Node[26] for lowercase-only input",
      cpp: "std::unordered_map<char, Node*> per node, or Node* children[26]",
      go: "map[rune]*Node per node — map, not [26]*Node, unless the alphabet is fixed",
    },
  },
  {
    pattern: "Heap / Priority Queue",
    priority: "Mid",
    complexity: [
      { operation: "push / pop the extreme element", cost: "O(log n)" },
      { operation: "peek the extreme element", cost: "O(1)" },
      { operation: "heapify n elements", cost: "O(n) — cheaper than n pushes, which is O(n log n)" },
    ],
    cornerCases: [
      "Empty heap — `heappop` on an empty heap raises rather than returning null.",
      "Single element — a top-k loop that pops k times overflows when k > n.",
      "k > n — 'the k-th largest' is undefined, so the problem either guarantees k ≤ n or expects the smallest.",
      "Ties — with equal priorities the heap's internal order decides, so a two-key problem needs a tuple/struct comparison.",
    ],
    pitfalls: [
      "Forgetting Python's `heapq` is a MIN-heap, so a max-heap needs negated values — and then the answer needs negating back.",
      "Pushing all n elements when the question asks for the k largest, which is O(n log n) instead of O(n log k).",
      "Comparing tuples where the second element is a non-comparable type (a list or a custom object) — the comparison throws.",
      "Reaching for a heap when the answer needs the full sorted order anyway.",
    ],
    stdlib: {
      python3: "heapq — heappush/heappop, negate for a max-heap or push (-priority, item)",
      javascript: "no stdlib — hand-rolled binary heap",
      java: "PriorityQueue<T> with a Comparator",
      cpp: "std::priority_queue<T> — std::greater<T> for a min-heap",
      go: "container/heap — implement Len/Less/Swap/Push/Pop on a slice type",
    },
  },
  {
    pattern: "Backtracking",
    priority: "Mid",
    complexity: [
      { operation: "explore the whole search tree", cost: "O(b^d) time — exponential, and the point is to prune it" },
      { operation: "recursion depth", cost: "O(d) space, plus O(d) for the current path copy" },
      { operation: "copying a solution into the result", cost: "O(d) per solution — the hidden cost of a correct answer" },
    ],
    cornerCases: [
      "Empty candidate set — the answer is the empty combination, not an empty result list.",
      "Duplicates in the input — without a sort-and-skip rule, `[2,2]` produces the same subset twice.",
      "A candidate that can be reused — the recursive call must pass `i`, not `i + 1`, and vice versa.",
      "Pruning order — pruning on `remaining < 0` before the append avoids generating and then discarding a whole subtree.",
    ],
    pitfalls: [
      "Appending the live `cur` list to the result instead of a copy — every result then aliases the same list, and they all end up empty.",
      "Not undoing the choice on the way out (no `pop`), so the path accumulates across sibling branches.",
      "Deduping with a set of solutions at the end, which is O(number of solutions) extra work and often still wrong on ordering.",
      "Skipping duplicates by value without also skipping only the LATER equal element at the same level.",
    ],
    stdlib: {
      python3: "recursion + `cur.copy()` / `path[:]` when appending to the result",
      javascript: "recursion + spread `[...cur]` when appending to the result",
      java: "recursion + `new ArrayList<>(cur)` when appending to the result",
      cpp: "recursion + push_back/pop_back on a shared vector, copying only on emit",
      go: "recursion + `append([]int(nil), cur...)` when appending to the result",
    },
  },
  {
    pattern: "Graphs",
    priority: "High",
    complexity: [
      { operation: "BFS / DFS over the whole graph", cost: "O(V + E) time, O(V) space" },
      { operation: "adjacency matrix instead of a list", cost: "O(V²) space — fine for dense, wasteful for sparse" },
      { operation: "union-find over E edges", cost: "O(E α(V)) — effectively linear" },
    ],
    cornerCases: [
      "Disconnected graph — one traversal from node 0 visits one component; the answer usually needs a loop over all nodes.",
      "Self-loop (`0 → 0`) — cycle detection that only checks the parent will call it a cycle or miss it entirely.",
      "Multi-edge (two edges between the same pair) — an adjacency set vs list decides whether you process it twice.",
      "Single node with no edges — the answer is 1, and an empty adjacency map gives 0.",
      "Cycle in a directed graph — undirected parent-checking cycle detection is wrong here; a colour/on-stack set is required.",
    ],
    pitfalls: [
      "Marking a node visited when it is POPPED instead of when it is PUSHED, so a node is queued several times and BFS becomes exponential on dense graphs.",
      "Recursive DFS on a 10^5-node path, which overflows the call stack — the iterative form is the safe one.",
      "Treating the graph as undirected when the edges are directed, or the reverse.",
      "Counting components by counting traversals that start from an unvisited node but forgetting to mark the start node first.",
    ],
    stdlib: {
      python3: "collections.defaultdict(list) for the adjacency list, deque for BFS",
      javascript: "Map<string, string[]> for the adjacency list, array with a head index for BFS",
      java: "List<List<Integer>> adjacency, ArrayDeque<Integer> for BFS",
      cpp: "vector<vector<int>> adjacency, std::queue<int> for BFS",
      go: "map[int][]int adjacency, a slice as a queue",
    },
  },
  {
    pattern: "Advanced Graphs",
    priority: "High",
    complexity: [
      { operation: "Dijkstra with a binary heap", cost: "O((V + E) log V) — needs non-negative weights" },
      { operation: "Bellman-Ford", cost: "O(V·E) — slower, but handles negative edges" },
      { operation: "Kruskal / Prim MST", cost: "O(E log E) / O(E log V)" },
    ],
    cornerCases: [
      "Negative edges — Dijkstra is invalid and returns a plausible wrong number, not an error.",
      "Unreachable target — the distance stays at the sentinel, and the answer must be a defined value, not a huge int.",
      "A cycle — MST algorithms must detect and skip an edge whose ends are already connected.",
      "A single node — the MST weight is 0 and the path length is 0, not 'no answer'.",
      "Equal-weight ties — the MST is not unique, so only the TOTAL weight is safe to return.",
    ],
    pitfalls: [
      "Using Dijkstra where Bellman-Ford is required (any negative edge), which passes the sample case and fails the hidden one.",
      "Pushing a neighbour into the heap without checking whether the new distance improves the known one, so the heap grows without bound.",
      "Forgetting the stale-entry check on pop (`if d > dist[u] continue`), which is correct but turns the algorithm into O(V·E log V).",
      "Union-find without path compression or union by rank, which is still correct but loses the near-linear bound.",
    ],
    stdlib: {
      python3: "heapq for the priority queue; a parent list for union-find",
      javascript: "no stdlib heap — hand-rolled binary heap",
      java: "PriorityQueue<int[]> keyed on distance",
      cpp: "std::priority_queue<std::pair<int,int>, vector<...>, greater<>>",
      go: "container/heap with a custom Less, or a simple O(V²) scan for dense graphs",
    },
  },
  {
    pattern: "1-D Dynamic Programming",
    priority: "Low",
    complexity: [
      { operation: "bottom-up over n states", cost: "O(n) time, O(1) space with a rolling window" },
      { operation: "top-down memoised recursion", cost: "O(n) time, O(n) stack + O(n) memo" },
      { operation: "the naive recursion it replaces", cost: "O(2^n) — exponential without memoisation" },
    ],
    cornerCases: [
      "n = 0 — the base case must be a real value, not an out-of-bounds read of `dp[0]`.",
      "n = 1 — a rolling-window update can return the wrong variable when only one step ran.",
      "Negative results / negative inputs — `max(0, ...)` clamps a legitimate negative answer to zero.",
      "Base case off-by-one — `dp[i] = dp[i-1] + dp[i-2]` needs dp[0] and dp[1] both seeded.",
    ],
    pitfalls: [
      "Memoising on the wrong key — memoising on the index when the state is (index, remaining) returns stale answers.",
      "Building a table of size n but indexing it from 1, so the last state is never written.",
      "Updating the rolling window in the wrong order, so a value is read after being overwritten.",
      "Returning the memo table's last entry when the answer is the max over all states, not the final one.",
    ],
    stdlib: {
      python3: "functools.lru_cache(None) over a recursive helper",
      javascript: "a Map used as a memo, keyed on the full state",
      java: "HashMap<Key, Integer> memo, or an int[] when the state is a single index",
      cpp: "std::vector<int> table, or two scalars for the rolling window",
      go: "a slice sized n+1, allocated once and indexed directly",
    },
  },
  {
    pattern: "2-D Dynamic Programming",
    priority: "Low",
    complexity: [
      { operation: "fill an m×n table", cost: "O(m·n) time, O(m·n) space" },
      { operation: "rolling rows", cost: "O(m·n) time, O(n) space" },
      { operation: "the naive recursion it replaces", cost: "exponential in m+n without memoisation" },
    ],
    cornerCases: [
      "Empty strings / an empty dimension — dp[0][j] and dp[i][0] are the base row and column, and getting them wrong shifts every answer.",
      "One dimension of length 1 — the answer is a single row or column of the table, not the corner.",
      "A result that exceeds 32 bits — distinct-paths counts blow past INT_MAX around 35×35, so use 64-bit.",
      "Unreachable cells (a blocked grid cell) — the recurrence must propagate 'impossible' rather than treating it as 0 paths.",
    ],
    pitfalls: [
      "The aliased-row 2-D init bug: `[[0] * n] * m` makes every row the SAME list, so writing one cell writes all of them.",
      "Iterating the table in the wrong direction for the recurrence, so a cell reads a neighbour that has not been computed.",
      "Forgetting the base case for the first row and column, which is where most 2-D problems actually fail.",
      "Allocating the full table when only two rows are needed — correct, but the memory bound in the statement is usually the constraint being tested.",
    ],
    stdlib: {
      python3: "list comprehension per row — `[[0] * n for _ in range(m)]`",
      javascript: "Array.from({length: m}, () => new Array(n).fill(0))",
      java: "`new int[m][n]` (rows are distinct arrays by construction)",
      cpp: "vector<vector<int>> dp(m, vector<int>(n, 0))",
      go: "make([][]int, m) then a make([]int, n) per row",
    },
  },
  {
    pattern: "Greedy",
    priority: "Mid",
    complexity: [
      { operation: "one pass with a running best", cost: "O(n) time, O(1) space" },
      { operation: "sort then scan", cost: "O(n log n) — the sort usually dominates" },
      { operation: "heap-based greedy (always take the current best)", cost: "O(n log n) time, O(n) space" },
    ],
    cornerCases: [
      "Single element — 'take the max difference' has no pair, so the answer is 0 or the element itself.",
      "All elements equal — a strict-inequality greedy makes no progress and can loop or return a sentinel.",
      "Ties in the sort — if the greedy depends on a secondary order, ties must be broken deliberately.",
      "Greedy that needs the last element (jump game) — the loop bound must include the final index.",
    ],
    pitfalls: [
      "Proving a greedy choice that is not actually safe — the exchange argument has to hold for the actual problem, not a similar one.",
      "Sorting when the greedy needs input order (interval scheduling vs interval merging want opposite things).",
      "Tracking a local best and returning it instead of the running global best.",
      "Assuming 'take the largest first' works without checking that the choice cannot foreclose a better combination.",
    ],
    stdlib: {
      python3: "sorted(items, key=...) / list.sort(key=...)",
      javascript: "arr.sort((a, b) => a - b) — the comparator is required for numbers",
      java: "Arrays.sort with a Comparator, or Comparator.comparingInt",
      cpp: "std::sort(v.begin(), v.end(), [](auto& a, auto& b){ return ...; })",
      go: "sort.Slice(s, func(i, j int) bool { ... })",
    },
  },
  {
    pattern: "Intervals",
    priority: "Mid",
    complexity: [
      { operation: "sort then single merge pass", cost: "O(n log n) time, O(n) space" },
      { operation: "insert into a sorted, non-overlapping list", cost: "O(n) — one pass, no re-sort" },
      { operation: "the sweep without a sort", cost: "O(n log n) anyway once you sort the endpoints" },
    ],
    cornerCases: [
      "Touching vs overlapping — `[1,2]` and `[2,3]` merge under `<=` and do not under `<`, and the statement decides which.",
      "Single interval — the merge loop's first iteration is the answer, and an unguarded `result[-1]` is empty.",
      "Fully contained — `[1,10]` then `[2,3]`: the merged end must be the MAX, not the new interval's end.",
      "Unsorted input — the problem may or may not promise sorted intervals.",
      "Zero-length intervals (`[5,5]`) — they overlap everything that touches 5 under `<=`.",
    ],
    pitfalls: [
      "Not sorting by start before merging, so a later-starting interval that extends an earlier one is appended separately.",
      "Merging by replacing the end with the new end rather than the max, which truncates the merged interval.",
      "Mutating the interval objects in the input array, which corrupts the caller's data and shows up when the same input is reused.",
      "Confusing this with interval scheduling, where the sort key is the END and overlaps must NOT be merged.",
    ],
    stdlib: {
      python3: "intervals.sort(key=lambda x: x[0])",
      javascript: "intervals.sort((a, b) => a[0] - b[0])",
      java: "Arrays.sort(intervals, Comparator.comparingInt(a -> a[0]))",
      cpp: "std::sort(intervals.begin(), intervals.end(), [](auto& a, auto& b){ return a[0] < b[0]; })",
      go: "sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })",
    },
  },
  {
    pattern: "Math & Geometry",
    priority: "Low",
    complexity: [
      { operation: "Euclid's gcd", cost: "O(log min(a, b))" },
      { operation: "matrix transpose / rotate in place", cost: "O(m·n) time, O(1) space" },
      { operation: "pow by squaring", cost: "O(log n) multiplications" },
    ],
    cornerCases: [
      "Zero — division by zero, gcd(0, 0), and 'count trailing zeros of 0' all behave differently from the general case.",
      "Negative inputs — Euclid's algorithm needs `abs`, and modulo in C++/Java keeps the sign of the dividend.",
      "Integer overflow — `a * b` before the modulo, or `abs(INT_MIN)`, which has no positive representation.",
      "A non-square matrix for rotate-in-place — the transpose/reflect trick only works on n×n.",
      "Floating-point answers — comparing `sqrt` results with `==` fails; the statement usually wants an integer or a tolerance.",
    ],
    pitfalls: [
      "`abs(INT_MIN)` overflowing and staying negative, which then propagates into a loop bound.",
      "Computing `pow(x, n)` with n multiplications when n is 10^9, which times out on the hidden case.",
      "Rotating by building a new matrix when the statement requires in-place (O(1) extra space).",
      "Integer division truncating toward zero on negatives where the problem expects floor.",
    ],
    stdlib: {
      python3: "math.gcd / math.isqrt / divmod (Python ints do not overflow)",
      javascript: "Math.abs / Number.isInteger — and note JS numbers are doubles, so > 2^53 loses precision",
      java: "Math.abs / Math.gcd / Math.multiplyExact (throws on overflow) / BigInteger",
      cpp: "std::gcd / std::lcm (C++17), std::llabs for 64-bit",
      go: "hand-rolled gcd (no stdlib generic one), math/bits for 64-bit counts",
    },
  },
  {
    pattern: "Bit Manipulation",
    priority: "Low",
    complexity: [
      { operation: "test / set / clear one bit", cost: "O(1)" },
      { operation: "XOR-fold an array (the 'find the single number' trick)", cost: "O(n) time, O(1) space" },
      { operation: "iterate the set bits with `x &= x - 1`", cost: "O(popcount) instead of O(width)" },
    ],
    cornerCases: [
      "0 — `x & (x - 1)` is 0 for 0, and `x - 1` on an unsigned 0 underflows.",
      "Negative values — two's complement means the top bit is set, so `x >> 31` is not 'sign-extend to 1 bit' in every language.",
      "Shift by ≥ the width — undefined behaviour in C++/Java, and `<< 32` is a no-op in JavaScript because the shift count is masked to 5 bits.",
      "Signed vs unsigned shift right — `>>` on a negative value fills with 1s and never reaches 0.",
    ],
    pitfalls: [
      "Using `>>` instead of `>>>` in JavaScript on a value that could be negative, so the loop never terminates.",
      "Forgetting operator precedence — `1 << i + 1` is `1 << (i + 1)`, and `a & b == 0` is `a & (b == 0)`.",
      "Mixing 32-bit and 53-bit arithmetic in JavaScript, where bitwise operators truncate to 32 bits signed.",
      "Building a bitmask as a number for more than 31 flags, where it silently becomes negative.",
    ],
    stdlib: {
      python3: "bin(x) / x.bit_count() (3.10+) / x.bit_length() — ints are arbitrary precision",
      javascript: ">>> for an unsigned shift, (x >>> 0) to coerce to uint32, BigInt for > 32 bits",
      java: "Integer.bitCount / Integer.highestOneBit / Integer.toBinaryString",
      cpp: "__builtin_popcount / std::bitset<64> / std::countr_zero (C++20)",
      go: "math/bits — bits.OnesCount64 / bits.TrailingZeros64 / bits.Len64",
    },
  },
  {
    pattern: "JavaScript",
    priority: "Low",
    complexity: [
      { operation: "this card", cost: "n/a — see the pitfalls" },
    ],
    cornerCases: [
      "n/a — this is a LeetCode topic label, not an algorithm family, so it has no canonical operation and no input shape that breaks it.",
    ],
    pitfalls: [
      "`JavaScript` is a LeetCode TOPIC (a language tag) that has been misfiled into the pattern vocabulary by the ingest, not an algorithm family.",
      "The problems under it are ordinary array/string/closure problems; use the pattern card for the technique the problem actually needs.",
      "Treating this card as a signal about language difficulty — it is a data artifact, and it is the only card here that says so.",
    ],
    stdlib: {
      python3: NA,
      javascript: "Object.groupBy / Array.prototype.at / structuredClone — the modern stdlib calls these problems exist to exercise",
      java: NA,
      cpp: NA,
      go: NA,
    },
  },
];

/** Null when the pattern has no card. The vocabulary is ingested, so this is a normal state. */
export function getPatternRef(pattern: string): PatternRef | null {
  return PATTERN_REFS.find((r) => r.pattern === pattern) ?? null;
}
