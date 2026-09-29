/**
 * JavaScript: pre-DSA language fundamentals. `starter` is the faded scaffold a student is
 * given; `solution` is the exemplar that must pass every case in `catalog.ts`. The harness
 * looks for a BARE top-level function named by the catalogue's canonical name. There is no
 * `class Solution` here, and a class would not be found.
 *
 * The examples lean on the standard library where the library IS the lesson: `Map`/`Set`,
 * `Array.prototype.sort`, spread, `slice`, `split`/`join`. One exception: `heap`, since
 * JavaScript has no built-in priority queue, so the exemplar writes the sift-down itself,
 * which is what that concept teaches.
 */

export const JAVASCRIPT: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  "dynamic-array": {
    starter: `var buildRange = function(n) {
  // Dynamic array: preallocating and then pushing gives 2n elements.
  const xs = new Array(n).fill(0);
  for (let i = 0; i < n; i++) xs.push(i);
  return xs;
};`,
    solution: `var buildRange = function(n) {
  // A plain array is already dynamic; push onto an empty one.
  return Array.from({ length: n }, (_, i) => i);
};`,
  },

  "hash-map": {
    starter: `var mostFrequent = function(words) {
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = "";
  for (const w of counts.keys()) if (best === "" || counts.get(w) > counts.get(best)) best = w;
  return best;
};`,
    solution: `var mostFrequent = function(words) {
  if (words.length === 0) return "";
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Highest count, then lexicographically smallest: the tie-break must be total,
  // because a Map's iteration order is insertion order, not sorted.
  let best = "";
  let bestCount = -1;
  for (const [w, n] of counts) {
    if (n > bestCount || (n === bestCount && w < best)) {
      best = w;
      bestCount = n;
    }
  }
  return best;
};`,
  },

  "hash-set": {
    starter: `var uniqueCount = function(nums) {
  const seen = new Set();
  for (const n of nums) seen.add(n);
  return nums.length;
};`,
    solution: `var uniqueCount = function(nums) {
  return new Set(nums).size;
};`,
  },

  stack: {
    starter: `var isBalanced = function(s) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (pairs[ch]) {
      if (stack.length === 0 || stack.pop() !== pairs[ch]) return false;
    }
  }
  return true;
};`,
    solution: `var isBalanced = function(s) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (pairs[ch]) {
      if (stack.length === 0 || stack.pop() !== pairs[ch]) return false;
    }
  }
  // Leftover openers mean the input was never balanced.
  return stack.length === 0;
};`,
  },

  queue: {
    starter: `var simulateQueue = function(ops, values) {
  const q = [];
  const popped = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "push") q.push(values[i]);
    else if (q.length > 0) popped.push(q.pop());
  }
  return popped;
};`,
    solution: `var simulateQueue = function(ops, values) {
  // FIFO: push at the back, shift from the front. shift is O(n) but that is the
  // standard-library queue JavaScript actually has.
  const q = [];
  const popped = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "push") q.push(values[i]);
    else if (q.length > 0) popped.push(q.shift());
  }
  return popped;
};`,
  },

  deque: {
    starter: `var maxSlidingWindow = function(nums, k) {
  const out = [];
  const dq = [];
  for (let i = 0; i < nums.length; i++) {
    while (dq.length > 0 && nums[dq[dq.length - 1]] <= nums[i]) dq.pop();
    dq.push(i);
    if (i >= k - 1) out.push(nums[dq[0]]);
  }
  return out;
};`,
    solution: `var maxSlidingWindow = function(nums, k) {
  const out = [];
  const dq = []; // indices; nums at those indices is decreasing
  let head = 0;
  for (let i = 0; i < nums.length; i++) {
    // The new value dominates everything smaller behind it.
    while (dq.length > head && nums[dq[dq.length - 1]] <= nums[i]) dq.pop();
    dq.push(i);
    // The front has left the window.
    if (dq[head] <= i - k) head++;
    if (i >= k - 1) out.push(nums[dq[head]]);
  }
  return out;
};`,
  },

  heap: {
    starter: `var kSmallest = function(nums, k) {
  // Heap: build the array, then pop k times.
  const heap = [...nums];
  const out = [];
  for (let i = 0; i < k && heap.length > 0; i++) out.push(heap.pop());
  return out;
};`,
    solution: `var kSmallest = function(nums, k) {
  // JavaScript has no built-in heap, so the sift-down is the lesson.
  const heap = [...nums];

  const siftDown = (size, i) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < size && heap[l] < heap[smallest]) smallest = l;
      if (r < size && heap[r] < heap[smallest]) smallest = r;
      if (smallest === i) return;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  };

  // Heapify is O(n), cheaper than n pushes at O(n log n).
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) siftDown(heap.length, i);

  const out = [];
  for (let i = 0; i < k && heap.length > 0; i++) {
    out.push(heap[0]);
    heap[0] = heap[heap.length - 1];
    heap.pop();
    siftDown(heap.length, 0);
  }
  return out;
};`,
  },

  "sorted-map": {
    starter: `var rankValues = function(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const rank = new Map();
  sorted.forEach((v, i) => rank.set(v, i));
  return nums.map((n) => rank.get(n));
};`,
    solution: `var rankValues = function(nums) {
  // No ordered map in the standard library, so sort the distinct keys once and
  // look up the position. O(n log n) total rather than O(log n) per access.
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const rank = new Map();
  sorted.forEach((v, i) => rank.set(v, i + 1));
  return nums.map((n) => rank.get(n));
};`,
  },

  // ---------------------------------------------------------------------------
  // Strings
  // ---------------------------------------------------------------------------
  "immutability-and-building": {
    starter: `var repeatJoin = function(words, sep) {
  // String += in a loop: correct, but quadratic for many appends.
  let out = "";
  for (const w of words) out += w + sep;
  return out;
};`,
    solution: `var repeatJoin = function(words, sep) {
  // One allocation, and the separator is never trailing.
  return words.join(sep);
};`,
  },

  reverse: {
    starter: `var reverseString = function(s) {
  let out = "";
  for (let i = s.length - 1; i > 0; i--) out += s[i];
  return out;
};`,
    solution: `var reverseString = function(s) {
  // Spread first: reverse() mutates, and a string has no reverse of its own.
  return [...s].reverse().join("");
};`,
  },

  "char-codes": {
    starter: `var sumCharCodes = function(s) {
  let total = 0;
  for (let i = 1; i < s.length; i++) total += s.charCodeAt(i);
  return total;
};`,
    solution: `var sumCharCodes = function(s) {
  let total = 0;
  for (const ch of s) total += ch.charCodeAt(0);
  return total;
};`,
  },

  "split-join": {
    starter: `var normalizeSpaces = function(s) {
  // split(" ") keeps every empty run as an empty string.
  return s.split(" ").join(" ");
};`,
    solution: `var normalizeSpaces = function(s) {
  // The regex splits on any run of whitespace; filter drops the leading, trailing
  // and consecutive runs that leaves behind.
  return s.split(/\\s+/).filter(Boolean).join(" ");
};`,
  },

  comparison: {
    starter: `var isLexicographicallySmaller = function(a, b) {
  return a <= b;
};`,
    solution: `var isLexicographicallySmaller = function(a, b) {
  // UTF-16 code unit order, which is what sort() uses by default.
  return a < b;
};`,
  },

  // ---------------------------------------------------------------------------
  // Matrices
  // ---------------------------------------------------------------------------
  "2d-init": {
    // The scaffold keeps the ALIASING construction: that bug is the concept, and a starter
    // with independent rows lets a student pass by adding the missing set line alone.
    starter: `var makeGridThenSet = function(rows, cols, v) {
  // One inner array, referenced rows times.
  const grid = new Array(rows).fill(new Array(cols).fill(0));
  // The set-and-observe step is missing.
  return grid[rows - 1][cols - 1];
};`,
    solution: `var makeGridThenSet = function(rows, cols, v) {
  // A callback runs the inner expression once per row, so the rows are independent.
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  grid[0][0] = v;
  return grid[rows - 1][cols - 1];
};`,
  },

  "3d-init": {
    starter: `var cubeChecksum = function(d, r, c) {
  // WRONG: every layer is the same grid, and every row is the same row.
  const cube = new Array(d).fill(new Array(r).fill(new Array(c).fill(0)));
  cube[0][0][0] = 1;
  let total = 0;
  for (const layer of cube) for (const row of layer) for (const x of row) total += x;
  return total;
};`,
    solution: `var cubeChecksum = function(d, r, c) {
  // One Array.from per level: independent at every depth.
  const cube = Array.from({ length: d }, () =>
    Array.from({ length: r }, () => new Array(c).fill(0)),
  );
  cube[0][0][0] = 1;
  let total = 0;
  for (const layer of cube) for (const row of layer) for (const x of row) total += x;
  return total;
};`,
  },

  traverse: {
    starter: `var rowMajorSum = function(flat, cols) {
  let total = 0;
  for (let r = 0; r < flat.length / cols - 1; r++)
    for (let c = 0; c < cols; c++) total += flat[r * cols + c];
  return total;
};`,
    solution: `var rowMajorSum = function(flat, cols) {
  // Element (r, c) is at r * cols + c: the stride is cols, never rows.
  let total = 0;
  for (let r = 0; r * cols < flat.length; r++)
    for (let c = 0; c < cols; c++) total += flat[r * cols + c];
  return total;
};`,
  },

  transpose: {
    starter: `var transposeFlat = function(flat, rows, cols) {
  const out = new Array(rows * cols).fill(0);
  // WRONG: the formula is transposed, but the output layout is not.
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out[r * cols + c] = flat[c * rows + r];
  return out;
};`,
    solution: `var transposeFlat = function(flat, rows, cols) {
  // The output is cols by rows, so its stride is rows.
  const out = new Array(rows * cols).fill(0);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out[c * rows + r] = flat[r * cols + c];
  return out;
};`,
  },

  bounds: {
    starter: `var inBounds = function(rows, cols, r, c) {
  return r >= 0 && r <= rows && c >= 0 && c <= cols;
};`,
    solution: `var inBounds = function(rows, cols, r, c) {
  // Half-open on both axes: flat[-1] is undefined here, so a bad index would
  // propagate silently rather than throw.
  return r >= 0 && r < rows && c >= 0 && c < cols;
};`,
  },

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------
  "default-sort": {
    starter: `var sortAscending = function(nums) {
  return nums.sort();
};`,
    solution: `var sortAscending = function(nums) {
  // sort() without a comparator compares as strings, so [9, 10, 2] gives
  // [10, 2, 9]. The comparator is the whole lesson. Copy first: sort is in place.
  return [...nums].sort((a, b) => a - b);
};`,
  },

  "custom-comparator": {
    starter: `var sortByAbsDesc = function(nums) {
  return [...nums].sort((a, b) => Math.abs(b) - Math.abs(a));
};`,
    solution: `var sortByAbsDesc = function(nums) {
  // Descending absolute value, then ascending value. Without the tie-break the
  // order of equal keys is implementation-defined.
  return [...nums].sort((a, b) => Math.abs(b) - Math.abs(a) || a - b);
};`,
  },

  "sort-by-key": {
    starter: `var sortWordsByLength = function(words) {
  return [...words].sort((a, b) => a.length - b.length).join(",");
};`,
    solution: `var sortWordsByLength = function(words) {
  // Length ascending, then lexicographic: encode every level in the comparator
  // rather than relying on the sort being stable.
  return [...words]
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .join(",");
};`,
  },

  "stable-sort": {
    starter: `var stableSortKeys = function(keys, values) {
  const pairs = values.map((v, i) => [keys[i], v]);
  pairs.sort((a, b) => b[0] - a[0]);
  return pairs.map((p) => p[1]);
};`,
    solution: `var stableSortKeys = function(keys, values) {
  // Sort the indices, tie-breaking on the original position. That makes the
  // result reproducible without depending on the engine's stability.
  const order = values.map((_, i) => i);
  order.sort((i, j) => keys[i] - keys[j] || i - j);
  return order.map((i) => values[i]);
};`,
  },

  // ---------------------------------------------------------------------------
  // Idioms
  // ---------------------------------------------------------------------------
  enumerate: {
    starter: `var indexOfMax = function(nums) {
  let best = -1;
  for (let i = 0; i < nums.length; i++) if (best === -1 || nums[i] >= nums[best]) best = i;
  return best;
};`,
    solution: `var indexOfMax = function(nums) {
  // entries() gives the index for free. Strict > keeps the FIRST maximum.
  let best = -1;
  for (const [i, n] of nums.entries()) if (best === -1 || n > nums[best]) best = i;
  return best;
};`,
  },

  zip: {
    starter: `var dotProduct = function(a, b) {
  let total = 0;
  for (let i = 1; i < a.length; i++) total += a[i] * b[i];
  return total;
};`,
    solution: `var dotProduct = function(a, b) {
  // There is no zip in JavaScript: walk the index explicitly, and pick the array
  // you bound the loop by deliberately.
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
};`,
  },

  slicing: {
    starter: `var lastK = function(nums, k) {
  return nums.slice(-k);
};`,
    solution: `var lastK = function(nums, k) {
  // -0 === 0, so slice(-0) is the WHOLE array, not the empty one.
  return k <= 0 ? [] : nums.slice(-k);
};`,
  },

  "range-vs-iterator": {
    starter: `var everyOther = function(nums) {
  return nums.filter((_, i) => i % 2 === 1);
};`,
    solution: `var everyOther = function(nums) {
  return nums.filter((_, i) => i % 2 === 0);
};`,
  },

  // ---------------------------------------------------------------------------
  // Pitfalls
  // ---------------------------------------------------------------------------
  "mutable-default-arg": {
    starter: `const acc = [];

var collect = function(value) {
  // WRONG: a module-level accumulator leaks state between calls.
  acc.push(value);
  return acc;
};`,
    solution: `var collect = function(value) {
  // A fresh array per call: no call can observe an earlier one.
  return [value];
};`,
  },

  "integer-division": {
    starter: `var floorDiv = function(a, b) {
  return Math.trunc(a / b);
};`,
    solution: `var floorDiv = function(a, b) {
  // Math.trunc(-7 / 2) is -3; floor is -4. The two divisions disagree for
  // negatives, which is what breaks binary-search midpoints.
  return Math.floor(a / b);
};`,
  },

  "integer-overflow": {
    starter: `var sumAsInt = function(nums) {
  // 32-bit accumulator, as in Java and C++.
  let sum = 0;
  for (const n of nums) sum = (sum + n) | 0;
  return sum;
};`,
    solution: `var sumAsInt = function(nums) {
  // JavaScript numbers are doubles, so there is no 32-bit wrap here.
  let sum = 0;
  for (const n of nums) sum += n;
  return sum;
};`,
  },

  "shallow-copy": {
    starter: `var copyThenSet = function(flat, cols, v) {
  const copy = flat;
  copy[0] = v;
  return flat[0];
};`,
    solution: `var copyThenSet = function(flat, cols, v) {
  // slice() copies the outer container; assignment would alias the same array.
  const copy = flat.slice();
  copy[0] = v;
  return flat[0];
};`,
  },

  "recursion-depth": {
    starter: `var sumRecursive = function(n) {
  if (n <= 0) return 0;
  return n + sumRecursive(n - 1);
};`,
    solution: `var sumRecursive = function(n) {
  // Node's stack overflows around 10,000 frames, so 100000 needs the loop.
  let total = 0;
  for (let i = 1; i <= n; i++) total += i;
  return total;
};`,
  },
};
