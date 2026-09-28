/**
 * Python 3 — pre-DSA language fundamentals.
 *
 * `starter` is the faded scaffold a student is given; `solution` is the exemplar that must
 * pass every case in `catalog.ts`. The harness binds `class Solution` and calls the method
 * named by `fnNameFor("python3", name)` — snake_case of the catalogue's canonical name.
 *
 * The examples lean on the standard library where the library IS the lesson: `collections`
 * is a module of built-ins, so `deque`, `heapq`, `Counter` and `sorted` appear as the
 * idiomatic answer rather than as something to reimplement.
 */

export const PYTHON: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  "dynamic-array": {
    starter: `class Solution:
    def build_range(self, n):
        # Dynamic array: grow by appending, not by preallocating and appending.
        xs = [0] * n
        for i in range(n):
            xs.append(i)
        return xs`,
    solution: `class Solution:
    def build_range(self, n):
        return list(range(n))`,
  },

  "hash-map": {
    starter: `class Solution:
    def most_frequent(self, words):
        counts = {}
        for w in words:
            counts[w] = counts.get(w, 0) + 1
        return max(counts, key=counts.get) if counts else ""`,
    solution: `class Solution:
    def most_frequent(self, words):
        if not words:
            return ""
        counts = {}
        for w in words:
            counts[w] = counts.get(w, 0) + 1
        # Descending count, then ascending word: the tie-break must be total.
        return min(counts, key=lambda w: (-counts[w], w))`,
  },

  "hash-set": {
    starter: `class Solution:
    def unique_count(self, nums):
        seen = set()
        for n in nums:
            seen.add(n)
        return len(nums)`,
    solution: `class Solution:
    def unique_count(self, nums):
        return len(set(nums))`,
  },

  stack: {
    starter: `class Solution:
    def is_balanced(self, s):
        pairs = {")": "(", "]": "[", "}": "{"}
        stack = []
        for ch in s:
            if ch in "([{":
                stack.append(ch)
            elif ch in pairs:
                if not stack or stack.pop() != pairs[ch]:
                    return False
        return True`,
    solution: `class Solution:
    def is_balanced(self, s):
        pairs = {")": "(", "]": "[", "}": "{"}
        stack = []
        for ch in s:
            if ch in "([{":
                stack.append(ch)
            elif ch in pairs:
                if not stack or stack.pop() != pairs[ch]:
                    return False
        # Leftover openers mean the input was never balanced.
        return not stack`,
  },

  queue: {
    starter: `class Solution:
    def simulate_queue(self, ops, values):
        q = []
        popped = []
        for op, v in zip(ops, values):
            if op == "push":
                q.append(v)
            elif q:
                popped.append(q.pop())
        return popped`,
    solution: `from collections import deque


class Solution:
    def simulate_queue(self, ops, values):
        # deque: O(1) at both ends. list.pop(0) would be O(n) per pop.
        q = deque()
        popped = []
        for op, v in zip(ops, values):
            if op == "push":
                q.append(v)
            elif q:
                popped.append(q.popleft())
        return popped`,
  },

  deque: {
    starter: `from collections import deque


class Solution:
    def max_sliding_window(self, nums, k):
        dq = deque()
        out = []
        for i, n in enumerate(nums):
            while dq and nums[dq[-1]] <= n:
                dq.pop()
            dq.append(i)
            if i >= k - 1:
                out.append(nums[dq[0]])
        return out`,
    solution: `from collections import deque


class Solution:
    def max_sliding_window(self, nums, k):
        dq = deque()
        out = []
        for i, n in enumerate(nums):
            # Drop dominated candidates from the back.
            while dq and nums[dq[-1]] <= n:
                dq.pop()
            dq.append(i)
            # Drop the maximum once it leaves the window.
            if dq[0] <= i - k:
                dq.popleft()
            if i >= k - 1:
                out.append(nums[dq[0]])
        return out`,
  },

  heap: {
    starter: `import heapq


class Solution:
    def k_smallest(self, nums, k):
        # heapq is a min-heap; negation turns it into a max-heap.
        h = []
        for n in nums:
            heapq.heappush(h, -n)
        return [-heapq.heappop(h) for _ in range(k)]`,
    solution: `import heapq


class Solution:
    def k_smallest(self, nums, k):
        # nsmallest keeps a k-sized max-heap internally and returns them ascending.
        return heapq.nsmallest(k, nums)`,
  },

  "sorted-map": {
    starter: `class Solution:
    def rank_values(self, nums):
        order = {v: i + 1 for i, v in enumerate(sorted(set(nums), reverse=True))}
        return [order[n] for n in nums]`,
    solution: `class Solution:
    def rank_values(self, nums):
        # No ordered map in the stdlib: sort the distinct keys once, then look up.
        order = {v: i + 1 for i, v in enumerate(sorted(set(nums)))}
        return [order[n] for n in nums]`,
  },

  // ---------------------------------------------------------------------------
  // Strings
  // ---------------------------------------------------------------------------
  "immutability-and-building": {
    starter: `class Solution:
    def repeat_join(self, words, sep):
        out = ""
        for w in words:
            out += w + sep
        return out`,
    solution: `class Solution:
    def repeat_join(self, words, sep):
        # One allocation instead of one per concatenation.
        return sep.join(words)`,
  },

  reverse: {
    starter: `class Solution:
    def reverse_string(self, s):
        out = ""
        for ch in s:
            out += ch
        return out`,
    solution: `class Solution:
    def reverse_string(self, s):
        return s[::-1]`,
  },

  "char-codes": {
    starter: `class Solution:
    def sum_char_codes(self, s):
        total = 0
        for ch in s:
            total += ord(ch) - ord("a")
        return total`,
    solution: `class Solution:
    def sum_char_codes(self, s):
        return sum(ord(ch) for ch in s)`,
  },

  "split-join": {
    starter: `class Solution:
    def normalize_spaces(self, s):
        return s.strip()`,
    solution: `class Solution:
    def normalize_spaces(self, s):
        # split() with no argument splits on any run of whitespace and drops empties.
        return " ".join(s.split())`,
  },

  comparison: {
    starter: `class Solution:
    def is_lexicographically_smaller(self, a, b):
        return a <= b`,
    solution: `class Solution:
    def is_lexicographically_smaller(self, a, b):
        # Code point order: a prefix sorts before the longer string.
        return a < b`,
  },

  // ---------------------------------------------------------------------------
  // Matrices
  // ---------------------------------------------------------------------------
  "2d-init": {
    // The scaffold keeps the ALIASING construction on purpose. The concept is that bug, and a
    // starter that already allocates independent rows lets a student pass by adding the
    // missing `grid[0][0] = v` line without ever confronting the aliasing.
    starter: `class Solution:
    def make_grid_then_set(self, rows, cols, v):
        grid = [[0] * cols] * rows
        # The set-and-observe step is missing.
        return grid[rows - 1][cols - 1]`,
    solution: `class Solution:
    def make_grid_then_set(self, rows, cols, v):
        # The comprehension runs [0] * cols once per row, so rows are independent.
        grid = [[0] * cols for _ in range(rows)]
        grid[0][0] = v
        return grid[rows - 1][cols - 1]`,
  },

  "3d-init": {
    starter: `class Solution:
    def cube_checksum(self, d, r, c):
        # One comprehension per level: each layer and each row is its own object.
        cube = [[[0] * c for _ in range(r)] for _ in range(d)]
        cube[0][0][0] = 1
        return cube[d - 1][r - 1][c - 1]`,
    solution: `class Solution:
    def cube_checksum(self, d, r, c):
        # One comprehension per level: each layer and each row is its own object.
        cube = [[[0] * c for _ in range(r)] for _ in range(d)]
        cube[0][0][0] = 1
        return sum(cell for layer in cube for row in layer for cell in row)`,
  },

  traverse: {
    starter: `class Solution:
    def row_major_sum(self, flat, cols):
        rows = len(flat) // cols if cols else 0
        total = 0
        for r in range(rows):
            total += flat[r * cols]
        return total`,
    solution: `class Solution:
    def row_major_sum(self, flat, cols):
        rows = len(flat) // cols if cols else 0
        # (r, c) lives at r * cols + c: the stride is the number of COLUMNS.
        return sum(flat[r * cols + c] for r in range(rows) for c in range(cols))`,
  },

  transpose: {
    starter: `class Solution:
    def transpose_flat(self, flat, rows, cols):
        out = []
        for r in range(rows):
            for c in range(cols):
                out.append(flat[r * cols + c])
        return out`,
    solution: `class Solution:
    def transpose_flat(self, flat, rows, cols):
        # Columns on the outside, so the output is row-major in the new cols-by-rows shape.
        return [flat[r * cols + c] for c in range(cols) for r in range(rows)]`,
  },

  bounds: {
    starter: `class Solution:
    def in_bounds(self, rows, cols, r, c):
        return 0 <= r < rows and 0 <= c <= cols`,
    solution: `class Solution:
    def in_bounds(self, rows, cols, r, c):
        # Half-open on both axes: a negative index is out of bounds, not the last element.
        return 0 <= r < rows and 0 <= c < cols`,
  },

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------
  "default-sort": {
    starter: `class Solution:
    def sort_ascending(self, nums):
        return sorted(nums, reverse=True)`,
    solution: `class Solution:
    def sort_ascending(self, nums):
        # sorted() returns a new list; list.sort() mutates and returns None.
        return sorted(nums)`,
  },

  "custom-comparator": {
    starter: `class Solution:
    def sort_by_abs_desc(self, nums):
        return sorted(nums, key=abs)`,
    solution: `class Solution:
    def sort_by_abs_desc(self, nums):
        # key is a projection, so the tuple encodes both levels of the order.
        return sorted(nums, key=lambda n: (-abs(n), n))`,
  },

  "sort-by-key": {
    starter: `class Solution:
    def sort_words_by_length(self, words):
        return ",".join(sorted(words, key=len))`,
    solution: `class Solution:
    def sort_words_by_length(self, words):
        # Ties are broken in the key, so the result does not depend on input order.
        return ",".join(sorted(words, key=lambda w: (len(w), w)))`,
  },

  "stable-sort": {
    starter: `class Solution:
    def stable_sort_keys(self, keys, values):
        return [v for _, v in sorted(zip(keys, values), reverse=True)]`,
    solution: `class Solution:
    def stable_sort_keys(self, keys, values):
        # Tuple compare orders by key and keeps equal keys in their original order.
        return [v for _, v in sorted(zip(keys, values))]`,
  },

  // ---------------------------------------------------------------------------
  // Idioms
  // ---------------------------------------------------------------------------
  enumerate: {
    starter: `class Solution:
    def index_of_max(self, nums):
        if not nums:
            return -1
        best = 0
        for i, n in enumerate(nums):
            if n >= nums[best]:
                best = i
        return best`,
    solution: `class Solution:
    def index_of_max(self, nums):
        if not nums:
            return -1
        best = 0
        for i, n in enumerate(nums):
            # Strict: the FIRST occurrence of the maximum wins.
            if n > nums[best]:
                best = i
        return best`,
  },

  zip: {
    starter: `class Solution:
    def dot_product(self, a, b):
        total = 0
        for x in a:
            total += x
        return total`,
    solution: `class Solution:
    def dot_product(self, a, b):
        return sum(x * y for x, y in zip(a, b))`,
  },

  slicing: {
    starter: `class Solution:
    def last_k(self, nums, k):
        return nums[:k]`,
    solution: `class Solution:
    def last_k(self, nums, k):
        # A negative start counts from the end; k = 0 needs its own branch, because
        # nums[-0:] is the whole list.
        if k <= 0:
            return []
        return nums[-k:]`,
  },

  "range-vs-iterator": {
    starter: `class Solution:
    def every_other(self, nums):
        return nums[1::2]`,
    solution: `class Solution:
    def every_other(self, nums):
        return nums[::2]`,
  },

  // ---------------------------------------------------------------------------
  // Pitfalls
  // ---------------------------------------------------------------------------
  "mutable-default-arg": {
    starter: `class Solution:
    def collect(self, value):
        # Every call must get its own accumulator.
        acc = []
        return acc`,
    solution: `class Solution:
    def collect(self, value):
        # A fresh list per call: nothing is shared between calls.
        return [value]`,
  },

  "integer-division": {
    starter: `class Solution:
    def floor_div(self, a, b):
        return int(a / b)`,
    solution: `class Solution:
    def floor_div(self, a, b):
        # Floor division: -7 // 2 is -4; truncating toward zero would give -3.
        return a // b`,
  },

  "integer-overflow": {
    starter: `class Solution:
    def sum_as_int(self, nums):
        total = 0
        for n in nums:
            total = n
        return total`,
    solution: `class Solution:
    def sum_as_int(self, nums):
        # Python integers are arbitrary precision: there is nothing to overflow.
        return sum(nums)`,
  },

  "shallow-copy": {
    starter: `class Solution:
    def copy_then_set(self, flat, cols, v):
        flat[0] = v
        return flat[0]`,
    solution: `class Solution:
    def copy_then_set(self, flat, cols, v):
        # list(flat) is a real copy of the flat data; writing to it cannot reach the input.
        copy = list(flat)
        copy[0] = v
        return flat[0]`,
  },

  "recursion-depth": {
    starter: `class Solution:
    def sum_recursive(self, n):
        if n <= 0:
            return 0
        return n + self.sum_recursive(n - 1)`,
    solution: `class Solution:
    def sum_recursive(self, n):
        # Python has no tail-call elimination and a default limit of 1000 frames, so the
        # recursive form cannot reach n = 100000. A loop is the only option.
        total = 0
        for i in range(1, n + 1):
            total += i
        return total`,
  },
};
