/**
 * Java exemplars for the pre-DSA fundamentals track.
 *
 * Binding rule: `class Solution` — deliberately NOT public, because the harness writes the
 * file as `Main.java` and only `Main` may be public there. Methods are public and
 * non-static, named exactly as the catalogue's `name`, so the harness can find them by
 * reflection.
 *
 * Signatures are constrained by the harness's argument coercion, which handles only `int`,
 * `long`, `double`, `boolean`, `char`, `String`, `int[]`, `double[]`, `String[]`,
 * `boolean[]` — there is no `int[][]` case. Matrix concepts therefore take a FLAT array plus
 * explicit dimensions, exactly as the catalogue's tests show.
 *
 * `sumAsInt` and `sumRecursive` return `long`: their expected values exceed 2^31, and an
 * `int` accumulator would wrap — which is precisely what those two concepts teach against.
 * `sumRecursive` is written as a loop because Java has no tail-call elimination and the
 * n = 100000 case would otherwise overflow the stack.
 */

export const JAVA: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  "dynamic-array": {
    solution: `class Solution {
    public int[] buildRange(int n) {
        List<Integer> xs = new ArrayList<>();
        for (int i = 0; i < n; i++) xs.add(i);
        int[] out = new int[xs.size()];
        for (int i = 0; i < out.length; i++) out[i] = xs.get(i);
        return out;
    }
}`,
    starter: `class Solution {
    public int[] buildRange(int n) {
        List<Integer> xs = new ArrayList<>();
        int[] out = new int[xs.size()];
        for (int i = 0; i < out.length; i++) out[i] = xs.get(i);
        return out;
    }
}`,
  },

  "hash-map": {
    solution: `class Solution {
    public String mostFrequent(String[] words) {
        Map<String, Integer> counts = new HashMap<>();
        for (String w : words) counts.merge(w, 1, Integer::sum);

        // A hash map has no iteration order, so the tie-break has to be explicit.
        String best = "";
        int bestCount = 0;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            String w = e.getKey();
            int c = e.getValue();
            if (c > bestCount || (c == bestCount && w.compareTo(best) < 0)) {
                best = w;
                bestCount = c;
            }
        }
        return best;
    }
}`,
    starter: `class Solution {
    public String mostFrequent(String[] words) {
        Map<String, Integer> counts = new HashMap<>();
        for (String w : words) counts.merge(w, 1, Integer::sum);

        String best = "";
        for (String w : words) {
            if (counts.get(w) > counts.getOrDefault(best, 0)) best = w;
        }
        return best;
    }
}`,
  },

  "hash-set": {
    solution: `class Solution {
    public int uniqueCount(int[] nums) {
        Set<Integer> seen = new HashSet<>();
        for (int n : nums) seen.add(n);
        return seen.size();
    }
}`,
    starter: `class Solution {
    public int uniqueCount(int[] nums) {
        return nums.length;
    }
}`,
  },

  stack: {
    solution: `class Solution {
    public boolean isBalanced(String s) {
        Deque<Character> stack = new ArrayDeque<>();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '(' || ch == '[' || ch == '{') {
                stack.push(ch);
            } else if (ch == ')' || ch == ']' || ch == '}') {
                if (stack.isEmpty()) return false;
                char open = stack.pop();
                if (ch == ')' && open != '(') return false;
                if (ch == ']' && open != '[') return false;
                if (ch == '}' && open != '{') return false;
            }
        }
        return stack.isEmpty();
    }
}`,
    starter: `class Solution {
    public boolean isBalanced(String s) {
        Deque<Character> stack = new ArrayDeque<>();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '(' || ch == '[' || ch == '{') stack.push(ch);
        }
        return stack.isEmpty();
    }
}`,
  },

  queue: {
    solution: `class Solution {
    public int[] simulateQueue(String[] ops, int[] values) {
        Deque<Integer> q = new ArrayDeque<>();
        List<Integer> popped = new ArrayList<>();
        for (int i = 0; i < ops.length; i++) {
            if (ops[i].equals("push")) {
                q.addLast(values[i]);
            } else if (!q.isEmpty()) {
                popped.add(q.pollFirst());
            }
        }
        int[] out = new int[popped.size()];
        for (int i = 0; i < out.length; i++) out[i] = popped.get(i);
        return out;
    }
}`,
    starter: `class Solution {
    public int[] simulateQueue(String[] ops, int[] values) {
        Deque<Integer> q = new ArrayDeque<>();
        List<Integer> popped = new ArrayList<>();
        for (int i = 0; i < ops.length; i++) {
            if (ops[i].equals("push")) {
                q.addLast(values[i]);
            } else if (!q.isEmpty()) {
                popped.add(q.peekFirst());
            }
        }
        int[] out = new int[popped.size()];
        for (int i = 0; i < out.length; i++) out[i] = popped.get(i);
        return out;
    }
}`,
  },

  deque: {
    solution: `class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        int n = nums.length;
        if (n == 0 || k <= 0) return new int[0];

        int[] out = new int[n - k + 1];
        Deque<Integer> dq = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) dq.pollLast();
            dq.addLast(i);
            if (dq.peekFirst() <= i - k) dq.pollFirst();
            if (i >= k - 1) out[i - k + 1] = nums[dq.peekFirst()];
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        int n = nums.length;
        if (n == 0 || k <= 0) return new int[0];

        int[] out = new int[n - k + 1];
        Deque<Integer> dq = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) dq.pollLast();
            dq.addLast(i);
            if (i >= k - 1) out[i - k + 1] = nums[dq.peekFirst()];
        }
        return out;
    }
}`,
  },

  heap: {
    solution: `class Solution {
    public int[] kSmallest(int[] nums, int k) {
        if (k <= 0) return new int[0];

        // A max-heap of the k smallest seen so far: the top is the one to evict.
        PriorityQueue<Integer> pq = new PriorityQueue<>(Comparator.reverseOrder());
        for (int n : nums) {
            pq.add(n);
            if (pq.size() > k) pq.poll();
        }

        int[] out = new int[pq.size()];
        for (int i = out.length - 1; i >= 0; i--) out[i] = pq.poll();
        return out;
    }
}`,
    starter: `class Solution {
    public int[] kSmallest(int[] nums, int k) {
        if (k <= 0) return new int[0];

        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int n : nums) {
            pq.add(n);
            if (pq.size() > k) pq.poll();
        }

        int[] out = new int[pq.size()];
        for (int i = 0; i < out.length; i++) out[i] = pq.poll();
        return out;
    }
}`,
  },

  "sorted-map": {
    solution: `class Solution {
    public int[] rankValues(int[] nums) {
        TreeMap<Integer, Integer> rank = new TreeMap<>();
        for (int n : nums) rank.put(n, 0);
        int r = 1;
        for (Map.Entry<Integer, Integer> e : rank.entrySet()) e.setValue(r++);

        int[] out = new int[nums.length];
        for (int i = 0; i < nums.length; i++) out[i] = rank.get(nums[i]);
        return out;
    }
}`,
    starter: `class Solution {
    public int[] rankValues(int[] nums) {
        TreeMap<Integer, Integer> rank = new TreeMap<>();
        for (int n : nums) rank.put(n, 0);
        int r = 1;
        for (Map.Entry<Integer, Integer> e : rank.entrySet()) e.setValue(r++);

        int[] out = new int[rank.size()];
        int i = 0;
        for (int v : rank.keySet()) out[i++] = v;
        return out;
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Strings
  // ---------------------------------------------------------------------------

  "immutability-and-building": {
    solution: `class Solution {
    public String repeatJoin(String[] words, String sep) {
        return String.join(sep, words);
    }
}`,
    starter: `class Solution {
    public String repeatJoin(String[] words, String sep) {
        StringBuilder sb = new StringBuilder();
        for (String w : words) sb.append(w).append(sep);
        return sb.toString();
    }
}`,
  },

  reverse: {
    solution: `class Solution {
    public String reverseString(String s) {
        return new StringBuilder(s).reverse().toString();
    }
}`,
    starter: `class Solution {
    public String reverseString(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = s.length() - 1; i > 0; i--) sb.append(s.charAt(i));
        return sb.toString();
    }
}`,
  },

  "char-codes": {
    solution: `class Solution {
    public int sumCharCodes(String s) {
        int total = 0;
        for (int i = 0; i < s.length(); i++) total += s.charAt(i);
        return total;
    }
}`,
    starter: `class Solution {
    public int sumCharCodes(String s) {
        int total = 0;
        for (int i = 0; i < s.length() - 1; i++) total += s.charAt(i);
        return total;
    }
}`,
  },

  "split-join": {
    solution: `class Solution {
    public String normalizeSpaces(String s) {
        String trimmed = s.trim();
        if (trimmed.isEmpty()) return "";
        return String.join(" ", trimmed.split("\\\\s+"));
    }
}`,
    starter: `class Solution {
    public String normalizeSpaces(String s) {
        return String.join(" ", s.split(" "));
    }
}`,
  },

  comparison: {
    solution: `class Solution {
    public boolean isLexicographicallySmaller(String a, String b) {
        return a.compareTo(b) < 0;
    }
}`,
    starter: `class Solution {
    public boolean isLexicographicallySmaller(String a, String b) {
        int n = Math.min(a.length(), b.length());
        for (int i = 0; i < n; i++) {
            if (a.charAt(i) != b.charAt(i)) return a.charAt(i) < b.charAt(i);
        }
        return false;
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Matrices
  // ---------------------------------------------------------------------------

  "2d-init": {
    solution: `class Solution {
    public int makeGridThenSet(int rows, int cols, int v) {
        // Java allocates a fresh array per row, so the rows are independent.
        int[][] grid = new int[rows][cols];
        grid[0][0] = v;
        return grid[rows - 1][cols - 1];
    }
}`,
    // The scaffold reproduces the aliasing bug — one shared row stored `rows` times — so the
    // student has to recognise it, not just fill in the missing assignment.
    starter: `class Solution {
    public int makeGridThenSet(int rows, int cols, int v) {
        int[][] grid = new int[rows][];
        int[] shared = new int[cols];
        Arrays.fill(grid, shared);
        return grid[rows - 1][cols - 1];
    }
}`,
  },

  "3d-init": {
    solution: `class Solution {
    public int cubeChecksum(int d, int r, int c) {
        int[][][] cube = new int[d][r][c];
        cube[0][0][0] = 1;
        int total = 0;
        for (int[][] plane : cube) {
            for (int[] row : plane) {
                for (int x : row) total += x;
            }
        }
        return total;
    }
}`,
    starter: `class Solution {
    public int cubeChecksum(int d, int r, int c) {
        int[][][] cube = new int[d][][];
        int[][] shared = new int[r][c];
        Arrays.fill(cube, shared);
        cube[0][0][0] = 1;
        int total = 0;
        for (int[][] plane : cube) {
            for (int[] row : plane) {
                for (int x : row) total += x;
            }
        }
        return total;
    }
}`,
  },

  traverse: {
    solution: `class Solution {
    public int rowMajorSum(int[] flat, int cols) {
        if (cols <= 0) return 0;
        int rows = flat.length / cols;
        int total = 0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) total += flat[r * cols + c];
        }
        return total;
    }
}`,
    starter: `class Solution {
    public int rowMajorSum(int[] flat, int cols) {
        int total = 0;
        for (int c = 0; c < cols && c < flat.length; c++) total += flat[c];
        return total;
    }
}`,
  },

  transpose: {
    solution: `class Solution {
    public int[] transposeFlat(int[] flat, int rows, int cols) {
        int[] out = new int[flat.length];
        for (int c = 0; c < cols; c++) {
            for (int r = 0; r < rows; r++) out[c * rows + r] = flat[r * cols + c];
        }
        return out;
    }
}`,
    starter: `class Solution {
    public int[] transposeFlat(int[] flat, int rows, int cols) {
        int[] out = new int[flat.length];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) out[c * cols + r] = flat[r * cols + c];
        }
        return out;
    }
}`,
  },

  bounds: {
    // The tests order the arguments (rows, cols, r, c) — see [3, 3, 0, 0] -> true.
    solution: `class Solution {
    public boolean inBounds(int rows, int cols, int r, int c) {
        return r >= 0 && r < rows && c >= 0 && c < cols;
    }
}`,
    starter: `class Solution {
    public boolean inBounds(int rows, int cols, int r, int c) {
        return r < rows && c < cols;
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  "default-sort": {
    solution: `class Solution {
    public int[] sortAscending(int[] nums) {
        int[] out = nums.clone();
        Arrays.sort(out);
        return out;
    }
}`,
    starter: `class Solution {
    public int[] sortAscending(int[] nums) {
        int[] out = new int[nums.length];
        if (nums.length > 0) {
            int min = nums[0];
            for (int n : nums) min = Math.min(min, n);
            out[0] = min;
        }
        return out;
    }
}`,
  },

  "custom-comparator": {
    solution: `class Solution {
    public int[] sortByAbsDesc(int[] nums) {
        Integer[] boxed = new Integer[nums.length];
        for (int i = 0; i < nums.length; i++) boxed[i] = nums[i];

        Arrays.sort(boxed, Comparator.comparingInt((Integer n) -> Math.abs(n)).reversed()
                .thenComparingInt(n -> n));

        int[] out = new int[nums.length];
        for (int i = 0; i < nums.length; i++) out[i] = boxed[i];
        return out;
    }
}`,
    starter: `class Solution {
    public int[] sortByAbsDesc(int[] nums) {
        int[] out = new int[nums.length];
        if (nums.length > 0) {
            int pick = 0;
            for (int i = 1; i < nums.length; i++) {
                if (Math.abs(nums[i]) > Math.abs(nums[pick])) pick = i;
            }
            out[0] = nums[pick];
        }
        return out;
    }
}`,
  },

  "sort-by-key": {
    solution: `class Solution {
    public String sortWordsByLength(String[] words) {
        String[] copy = words.clone();
        Arrays.sort(copy, Comparator.comparingInt(String::length).thenComparing(Comparator.naturalOrder()));
        return String.join(",", copy);
    }
}`,
    starter: `class Solution {
    public String sortWordsByLength(String[] words) {
        String[] copy = words.clone();
        Arrays.sort(copy, Comparator.comparingInt(String::length));
        return String.join(",", copy);
    }
}`,
  },

  "stable-sort": {
    solution: `class Solution {
    public int[] stableSortKeys(int[] keys, int[] values) {
        Integer[] order = new Integer[keys.length];
        for (int i = 0; i < order.length; i++) order[i] = i;
        // Arrays.sort on objects is stable, so equal keys keep their input order.
        Arrays.sort(order, Comparator.comparingInt((Integer i) -> keys[i]));

        int[] out = new int[keys.length];
        for (int i = 0; i < order.length; i++) out[i] = values[order[i]];
        return out;
    }
}`,
    starter: `class Solution {
    public int[] stableSortKeys(int[] keys, int[] values) {
        Integer[] order = new Integer[keys.length];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt((Integer i) -> keys[i]));

        int[] out = new int[keys.length];
        for (int i = 0; i < order.length; i++) out[i] = order[i];
        return out;
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Idioms
  // ---------------------------------------------------------------------------

  enumerate: {
    solution: `class Solution {
    public int indexOfMax(int[] nums) {
        if (nums.length == 0) return -1;
        int best = 0;
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] > nums[best]) best = i;
        }
        return best;
    }
}`,
    starter: `class Solution {
    public int indexOfMax(int[] nums) {
        return nums.length - 1;
    }
}`,
  },

  zip: {
    solution: `class Solution {
    public int dotProduct(int[] a, int[] b) {
        int total = 0;
        for (int i = 0; i < a.length; i++) total += a[i] * b[i];
        return total;
    }
}`,
    starter: `class Solution {
    public int dotProduct(int[] a, int[] b) {
        if (a.length == 0) return 0;
        return a[0] * b[0];
    }
}`,
  },

  slicing: {
    solution: `class Solution {
    public int[] lastK(int[] nums, int k) {
        int from = Math.max(0, nums.length - k);
        return Arrays.copyOfRange(nums, from, nums.length);
    }
}`,
    starter: `class Solution {
    public int[] lastK(int[] nums, int k) {
        return Arrays.copyOf(nums, k);
    }
}`,
  },

  "range-vs-iterator": {
    solution: `class Solution {
    public int[] everyOther(int[] nums) {
        int n = (nums.length + 1) / 2;
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = nums[i * 2];
        return out;
    }
}`,
    starter: `class Solution {
    public int[] everyOther(int[] nums) {
        int n = nums.length / 2;
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = nums[i * 2 + 1];
        return out;
    }
}`,
  },

  // ---------------------------------------------------------------------------
  // Pitfalls
  // ---------------------------------------------------------------------------

  "mutable-default-arg": {
    solution: `class Solution {
    public int[] collect(int value) {
        // A fresh container per call: no call may observe an earlier one.
        return new int[] { value };
    }
}`,
    starter: `class Solution {
    private static final List<Integer> ACC = new ArrayList<>();

    public int[] collect(int value) {
        ACC.add(value);
        int[] out = new int[ACC.size()];
        for (int i = 0; i < out.length; i++) out[i] = ACC.get(i);
        return out;
    }
}`,
  },

  "integer-division": {
    solution: `class Solution {
    public int floorDiv(int a, int b) {
        return Math.floorDiv(a, b);
    }
}`,
    starter: `class Solution {
    public int floorDiv(int a, int b) {
        return a / b;
    }
}`,
  },

  "integer-overflow": {
    solution: `class Solution {
    public long sumAsInt(int[] nums) {
        long sum = 0;
        for (int n : nums) sum += n;
        return sum;
    }
}`,
    starter: `class Solution {
    public long sumAsInt(int[] nums) {
        int sum = 0;
        for (int n : nums) sum += n;
        return sum;
    }
}`,
  },

  "shallow-copy": {
    solution: `class Solution {
    public int copyThenSet(int[] flat, int cols, int v) {
        int[] copy = flat.clone();
        copy[0] = v;
        return flat[0];
    }
}`,
    starter: `class Solution {
    public int copyThenSet(int[] flat, int cols, int v) {
        flat[0] = v;
        return flat[0];
    }
}`,
  },

  "recursion-depth": {
    solution: `class Solution {
    public long sumRecursive(int n) {
        // Written as a loop on purpose: Java has no tail-call elimination, so the recursive
        // form overflows the stack long before n = 100000.
        long total = 0;
        for (int i = 1; i <= n; i++) total += i;
        return total;
    }
}`,
    starter: `class Solution {
    public long sumRecursive(int n) {
        if (n <= 0) return 0;
        return n + sumRecursive(n - 1);
    }
}`,
  },
};
