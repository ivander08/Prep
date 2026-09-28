/**
 * Pre-DSA language fundamentals — the shared catalogue.
 *
 * One entry per concept, language-independent: the signature, the tests, and the prose.
 * Per-language code lives in `concepts/<lang>.ts` and supplies only `starter` and
 * `solution`. Keeping tests here rather than per language is deliberate — it makes it
 * impossible for two languages to disagree about what a concept is supposed to do, and it
 * makes the "every exemplar passes its own tests" check a single loop.
 *
 * WHY THESE TESTS LOOK CONSERVATIVE. They must pass through the same five harnesses the DSA
 * problems use, and those harnesses have real, verified limits:
 *
 *   - C++ return types are code-generated from `meta.return.type`, and only `integer`,
 *     `integer[]`, `boolean`, `string` and `string[]` have a comparison. A `int[][]` return
 *     is not expressible, so no concept returns a matrix — matrix concepts return a scalar
 *     or a flat array instead.
 *   - Java's argument coercion has no `int[][]` case, so no concept takes a matrix either;
 *     matrix inputs are passed flat with an explicit `cols` (or `rows, cols`).
 *   - C++ `to_string(result)` is the integer comparison, so anything that can exceed 32 bits
 *     returns a 64-bit integer in every language.
 *
 * Those limits shape the signatures. They are not cosmetic: a concept whose tests cannot
 * run in a language is not a concept that language can be taught here.
 */

export type Module = "collections" | "strings" | "matrix" | "sorting" | "idioms" | "pitfalls";

export type ConceptTest = { args: unknown[]; expected: unknown };

export type ConceptSpec = {
  slug: string;
  module: Module;
  title: string;
  /**
   * Canonical camelCase name. Per-language casing is DERIVED from this (see `fnNameFor`)
   * rather than written five times, so a typo cannot make one language's tests call a
   * function that does not exist.
   */
  name: string;
  /** The worked example. Kept under ~120 words so it reads as an explanation, not an essay. */
  conceptMd: string;
  /** What to do, in one or two sentences. */
  promptMd: string;
  tests: ConceptTest[];
  prereq?: string[];
  /**
   * Standard-library packages this concept's GO exemplar needs.
   *
   * Go requires every import to precede all declarations, and the user's code is spliced in
   * after the harness's imports, so user code cannot import anything itself. Listed per
   * concept rather than globally because Go rejects unused imports — a blanket list would
   * break every DSA submission. Ignored by the other four languages.
   */
  goImports?: string[];
};

export const MODULE_LABEL: Record<Module, string> = {
  collections: "Collections",
  strings: "Strings",
  matrix: "Matrices",
  sorting: "Sorting",
  idioms: "Idioms",
  pitfalls: "Pitfalls",
};

export const MODULE_ORDER: Module[] = ["collections", "strings", "matrix", "sorting", "idioms", "pitfalls"];

export const CONCEPTS: ConceptSpec[] = [
  // -------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------
  {
    slug: "dynamic-array",
    module: "collections",
    title: "Dynamic array",
    name: "buildRange",
    conceptMd: [
      "A dynamic array grows as you append, and its length is always available.",
      "",
      "```python",
      "xs = []",
      "for i in range(5):",
      "    xs.append(i)   # amortised O(1); capacity doubles when full",
      "len(xs)            # 5",
      "```",
      "",
      "`append` is amortised O(1) because the buffer doubles rather than growing by one. In a",
      "typed language the same structure is `vector` (C++), `ArrayList` (Java), or a slice with",
      "`append` (Go) — and in JavaScript a plain array is already dynamic, with `push`.",
      "",
      "The trap is preallocating `n` slots and then appending, which gives `2n` elements rather",
      "than `n`. Push onto an empty array, or index into a preallocated one, but not both.",
    ].join("\n"),
    promptMd: "Return an array of the integers `0` to `n - 1`. For `n = 0`, return an empty array.",
    tests: [
      { args: [0], expected: [] },
      { args: [1], expected: [0] },
      { args: [5], expected: [0, 1, 2, 3, 4] },
    ],
  },
  {
    slug: "hash-map",
    module: "collections",
    title: "Hash map",
    name: "mostFrequent",
    conceptMd: [
      "A hash map maps a key to a value in expected O(1). Counting is the canonical use.",
      "",
      "```python",
      "counts = {}",
      "for w in words:",
      "    counts[w] = counts.get(w, 0) + 1   # .get avoids a KeyError",
      "```",
      "",
      "In Java and Go the zero value does the same job: `counts.merge(w, 1, Integer::sum)` and",
      "`counts[w]++` both work because a missing key reads as `0`. In JavaScript and C++ the",
      "subscript operator inserts a `0` on first read, so `counts[w]++` is correct there too.",
      "",
      "The Python trap is `counts[w] += 1` on a missing key, which raises. The other trap is",
      "iteration order: only a sorted map has one, so any output built from a hash map needs an",
      "explicit tie-break to be deterministic.",
    ].join("\n"),
    promptMd: [
      "Return the most frequent word. On a tie, return the lexicographically smallest of the",
      "tied words. For an empty input, return the empty string.",
    ].join(" "),
    tests: [
      { args: [[]], expected: "" },
      { args: [["x"]], expected: "x" },
      { args: [["a", "b", "a"]], expected: "a" },
      // 2-2 tie: the tie-break decides this, and it is not the insertion order.
      { args: [["b", "a", "b", "a"]], expected: "a" },
      { args: [["c", "c", "a", "b", "b", "b"]], expected: "b" },
    ],
  },
  {
    slug: "hash-set",
    module: "collections",
    title: "Hash set",
    name: "uniqueCount",
    conceptMd: [
      "A hash set stores keys with no values, so membership is expected O(1) and duplicates",
      "collapse on insert.",
      "",
      "```python",
      "seen = set()",
      "for n in nums:",
      "    seen.add(n)",
      "len(seen)",
      "```",
      "",
      "`set(nums)` builds the same thing in one step. Java has `HashSet`, C++ `unordered_set`,",
      "Go `map[int]struct{}` (the empty struct costs no memory), and JavaScript `Set`.",
      "",
      "Two things worth knowing: iterating a set has no defined order in any of these, so never",
      "build output from that iteration; and the C++ `set` is a balanced tree, not a hash set —",
      "`set` is ordered and O(log n), `unordered_set` is the hash one.",
    ].join("\n"),
    promptMd: "Return the number of distinct integers in `nums`.",
    tests: [
      { args: [[]], expected: 0 },
      { args: [[1, 1, 2]], expected: 2 },
      { args: [[1, 2, 3]], expected: 3 },
      { args: [[7, 7, 7, 7]], expected: 1 },
    ],
  },
  {
    slug: "stack",
    module: "collections",
    title: "Stack",
    name: "isBalanced",
    conceptMd: [
      "A stack is last-in-first-out. Push on open, pop on close, and the most recent opener is",
      "the one that must match.",
      "",
      "```python",
      "pairs = {')': '(', ']': '[', '}': '{'}",
      "stack = []",
      "for ch in s:",
      "    if ch in '([{': stack.append(ch)",
      "    elif not stack or stack.pop() != pairs[ch]: return False",
      "return not stack",
      "```",
      "",
      "`not stack` at the end is the part that is easy to forget: an unbalanced input with too",
      "many openers leaves the stack non-empty.",
      "",
      "The same structure is `ArrayDeque` in Java (never the legacy `Stack` class), `vector` in",
      "C++, and a slice with `append`/index-the-tail in Go. In every case push and pop are both",
      "O(1) at the end, which is why a list works and shifting from the front does not.",
    ].join("\n"),
    promptMd: "Return true when every bracket in `s` is closed by the matching type, in the correct nesting order.",
    tests: [
      { args: [""], expected: true },
      { args: ["()"], expected: true },
      { args: ["()[]{}"], expected: true },
      { args: ["([{}])"], expected: true },
      { args: ["([)]"], expected: false },
      { args: ["("], expected: false },
      { args: [")("], expected: false },
    ],
  },
  {
    slug: "queue",
    module: "collections",
    title: "Queue",
    name: "simulateQueue",
    conceptMd: [
      "A queue is first-in-first-out. Push at the back, pop from the front.",
      "",
      "```python",
      "from collections import deque",
      "q = deque()",
      "q.append(x)      # back,  O(1)",
      "q.popleft()      # front, O(1)",
      "```",
      "",
      "`deque` matters: `list.pop(0)` is O(n) because every remaining element shifts, so a loop",
      "that pops a plain list is quadratic and looks linear. In Java the queue is",
      "`ArrayDeque`; in C++ `std::queue`; in Go a slice with a head index; in JavaScript a plain",
      "array with `push`/`shift`.",
      "",
      "Ops arrive as two parallel arrays: `ops[i]` is `\"push\"` or `\"pop\"`, and `ops[i]`'s",
      "`values[i]` is the number to push (ignored for a pop). A pop on an empty queue is a no-op.",
    ].join("\n"),
    promptMd: "Apply the operations in order and return the values popped, in the order they were popped.",
    tests: [
      { args: [["pop"], [0]], expected: [] },
      { args: [["push", "pop", "push", "pop"], [1, 0, 2, 0]], expected: [1, 2] },
      {
        args: [["push", "push", "pop", "push", "pop", "pop"], [1, 2, 0, 3, 0, 0]],
        expected: [1, 2, 3],
      },
      // LIFO would give [2, 3, 1] here; FIFO gives [1, 2, 3].
      {
        args: [["push", "push", "push", "pop", "pop", "pop"], [1, 2, 3, 0, 0, 0]],
        expected: [1, 2, 3],
      },
    ],
  },
  {
    slug: "deque",
    module: "collections",
    title: "Deque",
    name: "maxSlidingWindow",
    conceptMd: [
      "A double-ended queue supports O(1) push and pop at both ends. It is the tool for keeping a",
      "monotonic candidate list.",
      "",
      "```python",
      "dq = deque()   # indices, values decreasing",
      "for i, n in enumerate(nums):",
      "    while dq and nums[dq[-1]] <= n: dq.pop()   # the new value dominates",
      "    dq.append(i)",
      "    if dq[0] <= i - k: dq.popleft()            # the max left the window",
      "    if i >= k - 1: out.append(nums[dq[0]])",
      "```",
      "",
      "Each index enters and leaves the deque at most once, so this is O(n) rather than the O(nk)",
      "of rescanning every window. The two `while`/`if` guards are the whole algorithm: drop",
      "dominated candidates from the back, drop expired ones from the front.",
    ].join("\n"),
    promptMd: "Return the maximum of every window of `k` consecutive elements, left to right.",
    tests: [
      { args: [[1], 1], expected: [1] },
      { args: [[1, -1], 1], expected: [1, -1] },
      { args: [[1, 3, -1, -3, 5, 3, 6, 7], 3], expected: [3, 3, 5, 5, 6, 7] },
      { args: [[9, 8, 7, 6], 2], expected: [9, 8, 7] },
    ],
  },
  {
    slug: "heap",
    module: "collections",
    title: "Heap / priority queue",
    name: "kSmallest",
    conceptMd: [
      "A binary heap gives O(log n) push and pop and O(1) peek at the extreme. A min-heap pops",
      "the smallest; a max-heap pops the largest.",
      "",
      "```python",
      "import heapq",
      "h = []",
      "heapq.heappush(h, 3)",
      "heapq.heappop(h)     # 3, the smallest",
      "```",
      "",
      "Python's `heapq` is a MIN-heap only. For a max-heap, push negated values — there is no",
      "flag for it. Java's `PriorityQueue` is also min-first by default; C++ `priority_queue` is",
      "MAX-first, so it is the one that needs the comparator argument; Go's `container/heap`",
      "requires you to implement `Len/Less/Swap/Push/Pop` on a type. JavaScript has no built-in",
      "heap at all, so it is the one place you must write the sift-down yourself.",
      "",
      "`heapify` on an existing array is O(n), which beats n pushes at O(n log n).",
    ].join("\n"),
    promptMd: "Return the `k` smallest values of `nums` in ascending order. For `k = 0`, return an empty array.",
    tests: [
      { args: [[], 0], expected: [] },
      { args: [[1], 1], expected: [1] },
      { args: [[3, 1, 2], 2], expected: [1, 2] },
      { args: [[5, 4, 3, 2, 1], 3], expected: [1, 2, 3] },
      { args: [[2, 2, 1], 2], expected: [1, 2] },
    ],
    goImports: ["container/heap"],
  },
  {
    slug: "sorted-map",
    module: "collections",
    title: "Sorted map",
    name: "rankValues",
    conceptMd: [
      "A sorted map keeps its keys in order, so iteration is ordered and lookups are O(log n)",
      "rather than the expected O(1) of a hash map. You pay the logarithm to get the order.",
      "",
      "```python",
      "# No built-in. Sort the distinct keys, then map each to its position.",
      "order = {v: i + 1 for i, v in enumerate(sorted(set(nums)))}",
      "return [order[n] for n in nums]",
      "```",
      "",
      "C++ has `std::map` (ordered) alongside `unordered_map`; Java has `TreeMap` alongside",
      "`HashMap`. Python, JavaScript and Go have no ordered map in the standard library, so the",
      "idiom is sort-then-look-up, which is O(n log n) once rather than O(log n) per access.",
      "",
      "That trade is usually the right one: if you need every key in order exactly once, sorting",
      "is cheaper than maintaining an ordered structure.",
    ].join("\n"),
    promptMd: [
      "Return each value's rank in the original order, where the smallest value has rank 1.",
      "Values are distinct.",
    ].join(" "),
    tests: [
      { args: [[]], expected: [] },
      { args: [[1]], expected: [1] },
      { args: [[40, 10, 20, 30]], expected: [4, 1, 2, 3] },
      { args: [[5, 1, 4, 2, 3]], expected: [5, 1, 4, 2, 3] },
    ],
    goImports: ["sort"],
  },

  // -------------------------------------------------------------------------
  // Strings
  // -------------------------------------------------------------------------
  {
    slug: "immutability-and-building",
    module: "strings",
    title: "Immutability and building",
    name: "repeatJoin",
    conceptMd: [
      "In Python, Java, JavaScript and Go a string is immutable: `s += x` in a loop allocates a",
      "new string every time, which is O(n²) for n appends. Build with a buffer instead.",
      "",
      "```python",
      "parts = []",
      "for w in words:",
      "    parts.append(w)",
      "sep.join(parts)      # one allocation",
      "```",
      "",
      "The buffer is `StringBuilder` in Java, `strings.Builder` in Go, `std::string` with `+=`",
      "in C++ (which IS amortised, unlike the others), and `Array.join` in JavaScript.",
      "",
      "C++ is the exception in both directions: `std::string` grows amortised so `+=` is fine,",
      "while Java's `String +=` compiles to a fresh `StringBuilder` per statement — correct, but",
      "quadratic when it is inside the loop rather than around it.",
    ].join("\n"),
    promptMd: "Join the strings with `sep` between them. An empty list gives an empty string; a single element gives itself, with no separator.",
    tests: [
      { args: [[], "-"], expected: "" },
      { args: [["x"], "-"], expected: "x" },
      { args: [["a", "b"], "-"], expected: "a-b" },
      { args: [["a", "b", "c"], ", "], expected: "a, b, c" },
    ],
    goImports: ["strings"],
  },
  {
    slug: "reverse",
    module: "strings",
    title: "Reversing a string",
    name: "reverseString",
    conceptMd: [
      "Reversing is O(n) and there is a built-in in every language except C++'s in-place one.",
      "",
      "```python",
      "s[::-1]              # Python",
      "```",
      "```javascript",
      "[...s].reverse().join('')   // spread: reverse() mutates, and strings have no reverse",
      "```",
      "```java",
      "new StringBuilder(s).reverse().toString()",
      "```",
      "",
      "C++ is the odd one out: `std::reverse` reorders in place, so it needs a copy first —",
      "`string t = s; reverse(t.begin(), t.end());`. Go has no built-in reverse at all, so it is",
      "a two-pointer swap.",
      "",
      "The trap that does not appear in ASCII: reversing by code point splits surrogate pairs,",
      "so an emoji comes back broken. Splitting on grapheme clusters is the correct fix, and is",
      "worth knowing before it bites.",
    ].join("\n"),
    promptMd: "Return `s` with its characters in reverse order.",
    tests: [
      { args: [""], expected: "" },
      { args: ["a"], expected: "a" },
      { args: ["abc"], expected: "cba" },
      { args: ["abba"], expected: "abba" },
    ],
  },
  {
    slug: "char-codes",
    module: "strings",
    title: "Characters and code points",
    name: "sumCharCodes",
    conceptMd: [
      "A character is an integer with a code point. That is what makes counting arrays work:",
      "`count[ch - 'a']` indexes a 26-slot array with no hash map.",
      "",
      "```python",
      "ord('a')            # 97",
      "chr(97)             # 'a'",
      "sum(ord(c) for c in s)",
      "```",
      "",
      "`ord`/`chr` in Python, `charCodeAt`/`String.fromCharCode` in JavaScript, `(int) c` in",
      "Java, `(int) c` in C++, and `int(c)` / `string(rune(n))` in Go.",
      "",
      "Use code point arithmetic only when the alphabet is known and small. The moment input can",
      "contain anything outside it — accented letters, emoji, CJK — the offset trick silently",
      "collapses, and a map is the honest choice.",
    ].join("\n"),
    promptMd: "Return the sum of the code points of every character in `s`.",
    tests: [
      { args: [""], expected: 0 },
      { args: ["A"], expected: 65 },
      { args: ["AB"], expected: 131 },
      { args: ["abc"], expected: 294 },
    ],
  },
  {
    slug: "split-join",
    module: "strings",
    title: "Split and join",
    name: "normalizeSpaces",
    conceptMd: [
      "`split` turns a string into pieces; `join` turns pieces back into a string. Almost every",
      "text cleanup is one of the two.",
      "",
      "```python",
      "' '.join(s.split())    # splits on ANY run of whitespace, drops empties, rejoins",
      "```",
      "",
      "The no-argument `split()` is the important part: it treats consecutive whitespace as one",
      "separator and ignores leading and trailing runs, so no filtering is needed. `split(' ')`",
      "does not — it produces empty strings for every run and every leading or trailing space,",
      "which then have to be filtered out by hand.",
      "",
      "The equivalent elsewhere: `s.split(/\\s+/).filter(Boolean).join(' ')` in JavaScript,",
      "`s.trim().split(/\\s+/)` in Java, and `strings.Fields(s)` in Go — which is the",
      "no-argument Python behaviour, exactly.",
    ].join("\n"),
    promptMd: "Collapse every run of whitespace in `s` to a single space, and strip leading and trailing whitespace.",
    tests: [
      { args: [""], expected: "" },
      { args: ["a"], expected: "a" },
      { args: ["  a   b "], expected: "a b" },
      { args: ["a\tb"], expected: "a b" },
      { args: ["   "], expected: "" },
    ],
    goImports: ["strings"],
  },
  {
    slug: "comparison",
    module: "strings",
    title: "Comparing strings",
    name: "isLexicographicallySmaller",
    conceptMd: [
      "String comparison is lexicographic by code point, and it is what every `sort` uses by",
      "default. It is not the same as `==` on the characters: `\"a\" < \"ab\"` is true, because a",
      "prefix sorts before the longer string.",
      "",
      "```python",
      "\"apple\" < \"banana\"   # True",
      "\"Z\" < \"a\"            # True — uppercase sorts first, by code point",
      "```",
      "",
      "That second line is the surprise. Sorting a mixed-case list gives all the capitals first,",
      "which is rarely what a human means. The fix is a case-folded key: `sorted(xs, key=str.lower)`",
      "in Python, `xs.sort(String.CASE_INSENSITIVE_ORDER)` in Java, `localeCompare` in",
      "JavaScript, and `strings.ToLower` in Go.",
      "",
      "One more trap: JavaScript's `<` on strings compares UTF-16 code units, so it disagrees",
      "with Python for characters above the BMP.",
    ].join("\n"),
    promptMd: "Return true when `a` sorts before `b` lexicographically by code point.",
    tests: [
      { args: ["apple", "banana"], expected: true },
      { args: ["banana", "apple"], expected: false },
      { args: ["a", "a"], expected: false },
      // A prefix sorts first, and uppercase sorts before lowercase.
      { args: ["a", "ab"], expected: true },
      { args: ["Z", "a"], expected: true },
    ],
  },

  // -------------------------------------------------------------------------
  // Matrices
  // -------------------------------------------------------------------------
  {
    slug: "2d-init",
    module: "matrix",
    title: "2D initialisation and the aliasing bug",
    name: "makeGridThenSet",
    conceptMd: [
      "The single most common matrix bug is this line:",
      "",
      "```python",
      "grid = [[0] * cols] * rows     # WRONG — rows is the SAME list, repeated",
      "grid[0][0] = 5                 # every row's first cell is now 5",
      "```",
      "",
      "`[[0] * cols] * rows` builds one inner list and stores `rows` references to it. The fix is",
      "a comprehension, which runs the inner expression once per row:",
      "",
      "```python",
      "grid = [[0] * cols for _ in range(rows)]   # independent rows",
      "```",
      "",
      "The same trap exists as `new Array(rows).fill(new Array(cols))` in JavaScript, and as",
      "`Arrays.fill` with a shared array in Java. C++ `vector<vector<int>>(rows, vector<int>(cols))`",
      "copies, so it is safe — which is why the bug is easy to carry between languages.",
    ].join("\n"),
    promptMd: [
      "Build a `rows` by `cols` grid of zeros with INDEPENDENT rows, set `grid[0][0] = v`, then",
      "return `grid[rows - 1][cols - 1]`. If the rows share storage this returns `v`; with",
      "independent rows it returns `0` (or `v` when there is only one cell).",
    ].join(" "),
    tests: [
      { args: [1, 1, 5], expected: 5 },
      { args: [2, 2, 7], expected: 0 },
      { args: [2, 3, 9], expected: 0 },
      { args: [3, 3, 9], expected: 0 },
      // Single column is the ONLY shape that separates the two constructions. With cols > 1
      // the aliased grid writes grid[0][0] and reads grid[rows-1][cols-1] — a different cell,
      // so it returns 0 either way and the test cannot tell. Verified by evaluating both:
      // for every case above, shared and independent rows return the same value. Without
      // these two, a student can ship `[[0]*cols]*rows` and pass a concept about that exact bug.
      { args: [2, 1, 7], expected: 0 },
      { args: [3, 1, 9], expected: 0 },
    ],
  },
  {
    slug: "3d-init",
    module: "matrix",
    title: "3D initialisation",
    name: "cubeChecksum",
    conceptMd: [
      "The aliasing bug compounds with each dimension. Two levels of repetition share the whole",
      "sub-structure:",
      "",
      "```python",
      "# WRONG: every layer is the same grid, and every row is the same row.",
      "cube = [[[0] * c] * r] * d",
      "",
      "# Right: one comprehension per level.",
      "cube = [[[0] * c for _ in range(r)] for _ in range(d)]",
      "```",
      "",
      "Setting `cube[0][0][0] = 1` in the wrong version sets it in every layer, so the total sum",
      "becomes `d * r * c` instead of `1`. That is the diagnostic: the bug is visible as a sum",
      "that scales with the dimensions.",
      "",
      "In C++ and Java, `vector`/arrays-of-arrays are constructed by copy, so the nested form is",
      "safe; in Go a slice-of-slices built with `make` is independent per level, but",
      "`make([][]int, d)` leaves nil inner slices that must each be allocated.",
    ].join("\n"),
    promptMd: [
      "Build a `d` by `r` by `c` cube of zeros with every level independent, set",
      "`cube[0][0][0] = 1`, then return the sum of all its elements.",
    ].join(" "),
    tests: [
      { args: [1, 1, 1], expected: 1 },
      { args: [2, 2, 2], expected: 1 },
      { args: [3, 2, 2], expected: 1 },
      // A shared innermost row would give 1 * 4 * 3 = 12 here.
      { args: [4, 3, 2], expected: 1 },
    ],
  },
  {
    slug: "traverse",
    module: "matrix",
    title: "Traversing a matrix",
    name: "rowMajorSum",
    conceptMd: [
      "A matrix is passed flat here, with `cols`, so the indexing is explicit: element",
      "`(r, c)` is at `flat[r * cols + c]`. Getting that stride wrong is the second most common",
      "matrix bug after aliasing.",
      "",
      "```python",
      "total = 0",
      "for r in range(rows):",
      "    for c in range(cols):",
      "        total += flat[r * cols + c]",
      "```",
      "",
      "Iterating the flat array directly and summing is equivalent for a total, which is the",
      "point: reach for `(r, c)` indexing only when the position matters. When it does, the",
      "stride is `cols`, never `rows`.",
      "",
      "A ragged input is the failure mode to expect in real data — `rows` derived from",
      "`len(flat) / cols` silently truncates, so the caller's shape is authoritative.",
    ].join("\n"),
    promptMd: "Return the sum of every element of the row-major matrix in `flat`, which has `cols` columns.",
    tests: [
      { args: [[], 0], expected: 0 },
      { args: [[5], 1], expected: 5 },
      { args: [[1, 2, 3, 4], 2], expected: 10 },
      { args: [[1, 2, 3, 4, 5, 6], 3], expected: 21 },
    ],
  },
  {
    slug: "transpose",
    module: "matrix",
    title: "Transpose",
    name: "transposeFlat",
    conceptMd: [
      "A transpose swaps the two indices: `out[c * rows + r] = in[r * cols + c]`. The output is",
      "`cols` by `rows`, so the output stride is `rows`.",
      "",
      "```python",
      "out = []",
      "for c in range(cols):",
      "    for r in range(rows):",
      "        out.append(flat[r * cols + c])",
      "```",
      "",
      "Looping columns on the outside is what makes the result row-major in the new shape. If",
      "you instead write it as `out[r * cols + c] = flat[c * rows + r]` you have transposed the",
      "formula and not the data — a bug that passes whenever the matrix is square, because",
      "`rows == cols` there.",
      "",
      "In-place transpose is only possible for a square matrix, and needs a triangular swap:",
      "`swap(m[i][j], m[j][i])` for `j > i`.",
    ].join("\n"),
    promptMd: "Return the transpose of the `rows` by `cols` row-major matrix in `flat`, also row-major.",
    tests: [
      { args: [[], 0, 0], expected: [] },
      { args: [[1], 1, 1], expected: [1] },
      { args: [[1, 2, 3, 4, 5, 6], 2, 3], expected: [1, 4, 2, 5, 3, 6] },
      // Square: the transposed formula would pass this one, so it is not enough on its own.
      { args: [[1, 2, 3, 4], 2, 2], expected: [1, 3, 2, 4] },
    ],
  },
  {
    slug: "bounds",
    module: "matrix",
    title: "Bounds checking",
    name: "inBounds",
    conceptMd: [
      "Grid traversal in four or eight directions needs a bounds test before every neighbour",
      "lookup, because indexing out of range is an exception in Python, Java and C++, and",
      "`undefined` in JavaScript — which then propagates silently instead of throwing.",
      "",
      "```python",
      "def ok(r, c):",
      "    return 0 <= r < rows and 0 <= c < cols",
      "```",
      "",
      "Write it as a half-open range test on both axes. A common shortcut, `if 0 <= r < rows and",
      "0 <= c < cols` collapsed to a single comparison, breaks on negative indices: Python's",
      "`flat[-1]` is the LAST element, so a negative row silently reads real data instead of",
      "failing.",
      "",
      "The other half of the guard is the direction list: `dirs = [(-1,0),(1,0),(0,-1),(0,1)]`",
      "for orthogonal neighbours, extended with the four diagonals for the 8-neighbour form.",
    ].join("\n"),
    promptMd: "Return true when the cell `(r, c)` exists in a grid of `rows` by `cols`.",
    tests: [
      { args: [0, 0, 0, 0], expected: false },
      { args: [3, 3, 0, 0], expected: true },
      { args: [3, 3, 2, 2], expected: true },
      { args: [3, 3, 3, 0], expected: false },
      { args: [3, 3, 0, 3], expected: false },
      { args: [3, 3, -1, 0], expected: false },
    ],
  },

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------
  {
    slug: "default-sort",
    module: "sorting",
    title: "The default sort",
    name: "sortAscending",
    conceptMd: [
      "Every language here sorts ascending by default, in O(n log n), and every one of them is",
      "comparison-based and not stable unless stated.",
      "",
      "```python",
      "sorted(xs)          # returns a new list",
      "xs.sort()           # in place, returns None",
      "```",
      "",
      "The Python distinction catches people: `xs = xs.sort()` sets `xs` to `None`. C++",
      "`sort(v.begin(), v.end())` is in place; Java `Arrays.sort` is in place and",
      "`stream().sorted()` is not; Go `sort.Ints` is in place; JavaScript `xs.sort()` is in",
      "place AND compares as strings by default, so `[10, 9].sort()` gives `[10, 9]`.",
      "",
      "That JavaScript default is the single most common sorting bug outside Python: numbers",
      "sort lexicographically unless a comparator is supplied.",
    ].join("\n"),
    promptMd: "Return the values of `nums` in ascending order. Do not mutate the input if your language passes it by reference.",
    tests: [
      { args: [[]], expected: [] },
      { args: [[1]], expected: [1] },
      { args: [[3, 1, 2]], expected: [1, 2, 3] },
      { args: [[2, 2, 1]], expected: [1, 2, 2] },
      // Catches the JavaScript default: string comparison would give [10, 2, 9] here.
      { args: [[9, 10, 2]], expected: [2, 9, 10] },
    ],
    goImports: ["sort"],
  },
  {
    slug: "custom-comparator",
    module: "sorting",
    title: "Custom comparators",
    name: "sortByAbsDesc",
    conceptMd: [
      "A comparator returns negative, zero, or positive — not a boolean. Returning a boolean is",
      "the classic error, and in JavaScript it silently leaves the array unsorted.",
      "",
      "```python",
      "xs.sort(key=lambda n: (-abs(n), n))     # descending abs, then ascending value",
      "```",
      "```javascript",
      "xs.sort((a, b) => Math.abs(b) - Math.abs(a) || a - b)",
      "```",
      "",
      "Python's `key` is a projection, not a comparator, which is why the tuple encodes both",
      "levels of the order. Java's `Comparator.comparingInt(...).reversed().thenComparing(...)`",
      "builds the same thing. C++ and Go take a real comparator returning `bool` (strict weak",
      "ordering), which is the one place a boolean IS correct.",
      "",
      "Whatever the language, the tie-break must be total. Without it the order is",
      "implementation-defined and your tests pass by luck.",
    ].join("\n"),
    promptMd: "Sort by absolute value descending. Break ties by value ascending.",
    tests: [
      { args: [[]], expected: [] },
      { args: [[1, -1]], expected: [-1, 1] },
      { args: [[-3, 1, 2]], expected: [-3, 2, 1] },
      { args: [[3, -3, 2, -2]], expected: [-3, 3, -2, 2] },
    ],
    goImports: ["sort"],
  },
  {
    slug: "sort-by-key",
    module: "sorting",
    title: "Sorting by a key",
    name: "sortWordsByLength",
    conceptMd: [
      "Sorting records by one field is the everyday case, and the key function is what keeps it",
      "readable.",
      "",
      "```python",
      "words.sort(key=len)                        # ties keep their input order (stable)",
      "sorted(words, key=lambda w: (len(w), w))   # ties broken explicitly",
      "```",
      "",
      "Python's sort is stable, so equal keys keep their original order — which means",
      "`sort(key=len)` alone gives an order that depends on the input, and is therefore not",
      "reproducible from the result. Adding the value as a second key makes it total.",
      "",
      "That is the general rule: a key is only sufficient when it is unique, or when you do not",
      "care about ties. When a test or a user cares, encode every level of the order in the key",
      "rather than relying on stability.",
    ].join("\n"),
    promptMd: "Sort the words by length ascending, breaking ties lexicographically, and return them joined with commas.",
    tests: [
      { args: [[]], expected: "" },
      { args: [["a"]], expected: "a" },
      { args: [["b", "a"]], expected: "a,b" },
      { args: [["bb", "a", "ccc"]], expected: "a,bb,ccc" },
      // Same lengths, so the lexicographic tie-break decides it.
      { args: [["dd", "cc", "a", "b"]], expected: "a,b,cc,dd" },
    ],
    goImports: ["sort", "strings"],
  },
  {
    slug: "stable-sort",
    module: "sorting",
    title: "Stable sorting",
    name: "stableSortKeys",
    conceptMd: [
      "A stable sort preserves the relative order of elements with equal keys. That property is",
      "what makes multi-pass sorting work: sort by the least significant key first, then the most",
      "significant, and the earlier passes survive.",
      "",
      "```python",
      "pairs = sorted(zip(keys, values))     # tuple compare: key, then value",
      "```",
      "",
      "Stability is not free and not universal. Python's and Java's object sorts are stable;",
      "C++ `std::sort` is NOT (use `stable_sort`); Java's `Arrays.sort` on primitives is not, and",
      "cannot be, because primitives carry no identity to preserve; Go's `sort.Slice` is not,",
      "`sort.SliceStable` is.",
      "",
      "The safe habit is to encode the full order in the comparator, as the Python example does,",
      "and treat stability as an optimisation rather than a guarantee.",
    ].join("\n"),
    promptMd: [
      "Sort the values by their corresponding key ascending, keeping the original relative order",
      "of equal keys, and return the values in that order.",
    ].join(" "),
    tests: [
      { args: [[], []], expected: [] },
      { args: [[1], [9]], expected: [9] },
      { args: [[2, 1], [10, 20]], expected: [20, 10] },
      // Keys [1,1,2,2]: a non-stable sort could give [40,20,30,10] here.
      { args: [[2, 1, 2, 1], [10, 20, 30, 40]], expected: [20, 40, 10, 30] },
    ],
    goImports: ["sort"],
  },

  // -------------------------------------------------------------------------
  // Idioms
  // -------------------------------------------------------------------------
  {
    slug: "enumerate",
    module: "idioms",
    title: "Enumerate / entries",
    name: "indexOfMax",
    conceptMd: [
      "Most loops need the index as well as the value. Reaching for `range(len(xs))` works but",
      "reads worse and is easy to get wrong.",
      "",
      "```python",
      "for i, n in enumerate(nums):",
      "    ...",
      "```",
      "",
      "`enumerate` (Python), `entries()` (JavaScript), `Objects.entries` / an indexed loop",
      "(Java has no zip-with-index, so `IntStream.range` is the idiom), `for i, n := range nums`",
      "(Go — index first, value second, and the reverse of Python's order), and an index loop in",
      "C++.",
      "",
      "The Go order is the one to remember: `range` yields index then value, so `for n, i :=`",
      "silently compiles and produces nonsense. Getting the index for free is the whole point;",
      "getting it in the wrong variable is worse than not having it.",
    ].join("\n"),
    promptMd: "Return the index of the first occurrence of the largest value, or -1 for an empty array.",
    tests: [
      { args: [[]], expected: -1 },
      { args: [[1]], expected: 0 },
      { args: [[1, 3, 2]], expected: 1 },
      // First, not last: a `>=` in the comparison would return 2.
      { args: [[5, 5, 5]], expected: 0 },
      { args: [[-3, -1, -2]], expected: 1 },
    ],
  },
  {
    slug: "zip",
    module: "idioms",
    title: "Zip",
    name: "dotProduct",
    conceptMd: [
      "Zip walks two sequences in step, pairing element `i` with element `i`.",
      "",
      "```python",
      "sum(a * b for a, b in zip(xs, ys))",
      "```",
      "",
      "`zip` in Python, an index loop or `map` in JavaScript (there is no `zip`),",
      "`IntStream.range(0, n).map(i -> xs[i] * ys[i])` in Java, an index loop in C++, and an",
      "explicit index loop in Go (`for i := range xs`).",
      "",
      "The behaviour to know is what happens on unequal lengths, because the languages disagree:",
      "Python's `zip` stops at the shorter one, JavaScript's `map` runs to the length of the",
      "array it is called on and yields `undefined` past the end, and an index loop over the",
      "wrong array throws or reads garbage. Decide explicitly, do not inherit the default.",
    ].join("\n"),
    promptMd: "Return the dot product of `a` and `b`, which have equal length.",
    tests: [
      { args: [[], []], expected: 0 },
      { args: [[2], [3]], expected: 6 },
      { args: [[1, 2, 3], [4, 5, 6]], expected: 32 },
      { args: [[-1, 1], [1, -1]], expected: -2 },
    ],
  },
  {
    slug: "slicing",
    module: "idioms",
    title: "Slicing",
    name: "lastK",
    conceptMd: [
      "A slice takes a contiguous range with a start, an end, and a step. Half-open ranges are",
      "the convention: `xs[i:j]` includes `i` and excludes `j`.",
      "",
      "```python",
      "nums[-k:]        # the last k, and empty when k is 0",
      "```",
      "",
      "Negative indices count from the end, which makes `nums[-k:]` the natural way to write",
      "this. Without them, C++ uses `vector(begin() + n - k, end())`, Java",
      "`Arrays.copyOfRange(xs, n - k, n)`, JavaScript `xs.slice(-k)`, and Go `xs[n-k:]`.",
      "",
      "Two boundary rules worth internalising: a slice past the end is truncated rather than an",
      "error in Python and JavaScript, but panics in Go and throws in Java. And `xs[-0:]` is the",
      "WHOLE array, not the empty one, because `-0 == 0` — so a `k = 0` case needs its own",
      "branch.",
    ].join("\n"),
    promptMd: "Return the last `min(k, length)` values. For `k = 0` or an empty input, return an empty array.",
    tests: [
      { args: [[], 3], expected: [] },
      { args: [[1, 2], 0], expected: [] },
      { args: [[1], 5], expected: [1] },
      { args: [[1, 2, 3, 4], 2], expected: [3, 4] },
      { args: [[1, 2, 3], 3], expected: [1, 2, 3] },
    ],
  },
  {
    slug: "range-vs-iterator",
    module: "idioms",
    title: "Range versus iterator",
    name: "everyOther",
    conceptMd: [
      "A range produces indices; an iterator produces values. Knowing which one you have is what",
      "lets you take every second element without an index.",
      "",
      "```python",
      "nums[::2]                    # slice with step 2",
      "nums[0::2]                   # the same thing",
      "```",
      "```javascript",
      "nums.filter((_, i) => i % 2 === 0)",
      "```",
      "",
      "In Java and C++ there is no stride slice, so it is an index loop with `i += 2`. In Go it is",
      "`for i := 0; i < len(xs); i += 2`.",
      "",
      "The conceptual point: `range(n)` is lazy and re-iterable, while a generator or file handle",
      "is single-use. Consuming an iterator twice is the bug that produces an empty second loop,",
      "and it is silent — `list(gen)` followed by another `list(gen)` gives data then nothing.",
    ].join("\n"),
    promptMd: "Return the elements at even indices, in order.",
    tests: [
      { args: [[]], expected: [] },
      { args: [[1]], expected: [1] },
      { args: [[1, 2]], expected: [1] },
      { args: [[1, 2, 3, 4, 5]], expected: [1, 3, 5] },
    ],
  },

  // -------------------------------------------------------------------------
  // Pitfalls
  // -------------------------------------------------------------------------
  {
    slug: "mutable-default-arg",
    module: "pitfalls",
    title: "State that leaks between calls",
    name: "collect",
    conceptMd: [
      "Python's most famous trap: a default argument is evaluated once, at definition, so a",
      "mutable default is shared by every call.",
      "",
      "```python",
      "def collect(value, acc=[]):     # WRONG: acc persists",
      "    acc.append(value)",
      "    return acc",
      "```",
      "",
      "The first call returns `[1]` and the second returns `[1, 2]`. The fix is a sentinel:",
      "`def collect(value, acc=None): acc = [] if acc is None else acc`.",
      "",
      "Every other language here has the same failure under a different name — a module-level or",
      "static accumulator, a cached array, a shared object literal. The contract this exercise",
      "tests is the one that matters regardless of mechanism: a call must not be able to observe",
      "an earlier call. Test it by calling twice and comparing, because the bug is invisible",
      "until the second call.",
    ].join("\n"),
    promptMd: "Return a new array containing only `value`. Calling it twice must give the same result both times.",
    tests: [
      { args: [0], expected: [0] },
      { args: [1], expected: [1] },
      // With a shared accumulator this returns [1, 2] and the test fails.
      { args: [2], expected: [2] },
      { args: [1], expected: [1] },
    ],
  },
  {
    slug: "integer-division",
    module: "pitfalls",
    title: "Integer division",
    name: "floorDiv",
    conceptMd: [
      "There are two integer divisions and they disagree for negative numbers.",
      "",
      "```python",
      "7 // 2      #  3   floor",
      "-7 // 2     # -4   floor",
      "int(-7 / 2) # -3   truncation — a different answer",
      "```",
      "",
      "Python's `//` floors. Java's `/`, C++'s `/` and Go's `/` truncate toward zero, and",
      "JavaScript's `/` produces a float that `Math.trunc` then truncates. So `-7 / 2` is `-4` in",
      "Python and `-3` in the other four.",
      "",
      "That difference is a real bug source: binary search midpoints, bucket indices and page",
      "counts all break when a negative intermediate truncates instead of flooring. The portable",
      "form is `(a - (a % b + b) % b) / b`, or in Python simply `//`.",
    ].join("\n"),
    promptMd: "Return the floor of `a / b`, where `b` is positive and `a` may be negative.",
    tests: [
      { args: [0, 5], expected: 0 },
      { args: [7, 2], expected: 3 },
      { args: [6, 3], expected: 2 },
      // Truncation gives -3 and -0 here; floor gives -4 and -1.
      { args: [-7, 2], expected: -4 },
      { args: [-1, 2], expected: -1 },
    ],
  },
  {
    slug: "integer-overflow",
    module: "pitfalls",
    title: "Integer width and overflow",
    name: "sumAsInt",
    conceptMd: [
      "Integer width is fixed per type and overflow is not checked. In Java and C++ an `int` is",
      "32-bit two's complement, so it wraps silently: `Integer.MAX_VALUE + 1` is",
      "`-2147483648`, not an error.",
      "",
      "```java",
      "int sum = 0;",
      "for (int n : nums) sum += n;   // wraps",
      "long sum64 = 0;                // does not, for this input",
      "```",
      "",
      "Python integers are arbitrary precision and JavaScript numbers are doubles, so neither",
      "overflows here — which is exactly why this bug is found in Java and C++ and not before.",
      "Go's `int` is 64-bit on a 64-bit platform, so it is the one that is safe by accident.",
      "",
      "The habit: decide the needed range before choosing the type, and prefer 64-bit for any",
      "sum. Two Sum's `target - n` and a product of two 10^9 values both overflow 32 bits.",
    ].join("\n"),
    promptMd: "Return the sum of `nums`, which may exceed the range of a 32-bit integer.",
    tests: [
      { args: [[]], expected: 0 },
      { args: [[1, 2]], expected: 3 },
      // 2147483647 + 1: wraps to -2147483648 in 32-bit arithmetic.
      { args: [[2147483647, 1]], expected: 2147483648 },
      { args: [[2147483647, 2147483647]], expected: 4294967294 },
    ],
  },
  {
    slug: "shallow-copy",
    module: "pitfalls",
    title: "Shallow copies",
    name: "copyThenSet",
    conceptMd: [
      "An assignment copies the reference, not the data. In Python `b = a` makes `a` and `b` the",
      "same list; in Java `int[] b = a` does the same; in JavaScript `const b = a` too. Only C++",
      "`vector<int> b = a` and Go's array assignment copy by value.",
      "",
      "```python",
      "b = a[:]              # a real copy of a flat list",
      "b = copy.deepcopy(a)  # needed once the elements are themselves lists",
      "```",
      "",
      "`list(a)`, `a[:]` and `a.copy()` are all SHALLOW: they copy the outer container and share",
      "the inner objects. For a flat list of numbers that is indistinguishable from a deep copy;",
      "for a list of lists it is the aliasing bug again.",
      "",
      "A function that mutates its argument has an observable side effect on the caller. That is",
      "the contract this exercise checks: take a copy before you write.",
    ].join("\n"),
    promptMd: [
      "Make a copy of the row-major matrix in `flat` (which has `cols` columns), set the copy's",
      "`[0][0]` to `v`, and return the ORIGINAL's first element. The input must not be modified.",
    ].join(" "),
    tests: [
      { args: [[7], 1, 0], expected: 7 },
      { args: [[1, 2, 3, 4], 2, 9], expected: 1 },
      { args: [[0, 0, 0, 0], 2, 5], expected: 0 },
      { args: [[3, 1], 2, 8], expected: 3 },
    ],
  },
  {
    slug: "recursion-depth",
    module: "pitfalls",
    title: "Recursion depth",
    name: "sumRecursive",
    conceptMd: [
      "Every recursive call adds a frame, and every language caps the stack.",
      "",
      "```python",
      "sys.getrecursionlimit()   # 1000 by default",
      "```",
      "",
      "Python raises `RecursionError` around 1000 frames; JavaScript raises `RangeError` around",
      "10,000; Java and C++ overflow the real stack with a segmentation fault rather than an",
      "exception, so the failure is a crash and not a catchable error. Go grows goroutine stacks",
      "dynamically and is the outlier that survives much deeper recursion.",
      "",
      "So a recursive traversal of a 100,000-node list works in Go and fails in the other four.",
      "The fix is a loop, and it is usually available: a tail-recursive accumulator is a `for`",
      "loop with an extra variable. Python does not do tail-call elimination, so rewriting is the",
      "only option there — there is no flag.",
    ].join("\n"),
    promptMd: "Return the sum of 1 to `n`. It must work for `n` up to 100000.",
    tests: [
      { args: [0], expected: 0 },
      { args: [10], expected: 55 },
      { args: [1000], expected: 500500 },
      // Deep enough to exhaust a default stack: recursion must be replaced by a loop.
      { args: [100000], expected: 5000050000 },
    ],
  },
];

/** Snake case, for Python. */
function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Pascal case, for Go. */
function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The function name a language's harness will call.
 *
 * Derived from the canonical name rather than stored per language, so the catalogue cannot
 * disagree with itself about what a concept's entry point is called.
 */
export function fnNameFor(lang: string, name: string): string {
  if (lang === "python3") return snake(name);
  if (lang === "go") return pascal(name);
  return name;
}

/** Every (language, concept) pair, in catalogue order. */
export function allSlugs(): Array<{ lang: string; slug: string; spec: ConceptSpec }> {
  const out: Array<{ lang: string; slug: string; spec: ConceptSpec }> = [];
  for (const lang of ["python3", "javascript", "java", "cpp", "go"]) {
    for (const spec of CONCEPTS) out.push({ lang, slug: `${lang}/${spec.slug}`, spec });
  }
  return out;
}
