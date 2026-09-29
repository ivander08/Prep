/**
 * Pre-DSA language fundamentals: Go.
 *
 * One entry per catalogue concept, keyed by slug, supplying only `starter` and `solution`; the
 * tests, prompt and concept prose live in `catalog.ts`. The Go harness in `runner.ts` dictates
 * the code shape: a BARE top-level `func Name(...)` (Go has no `Solution` type) with naturally
 * typed parameters (`[]int`, `[]string`, `int`, `string`, `bool`) that it JSON-decodes into.
 * No `import` is possible here: the harness emits its own import block and splices user code in
 * after it, so a concept needing the standard library declares packages in the catalogue's
 * `goImports`, and a starter must USE each one (Go rejects an unused import). Results compare
 * as `json.Marshal` output, so a nil slice (`null`) differs from an empty slice (`[]`).
 */

export const GO: Record<string, { starter: string; solution: string }> = {
  // -------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------
  "dynamic-array": {
    solution: `func BuildRange(n int) []int {
	out := make([]int, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, i)
	}
	return out
}`,
    starter: `func BuildRange(n int) []int {
	out := []int{}
	for i := 0; i <= n; i++ {
		out = append(out, i)
	}
	return out
}`,
  },

  "hash-map": {
    solution: `func MostFrequent(words []string) string {
	counts := map[string]int{}
	for _, w := range words {
		counts[w]++
	}
	best := ""
	found := false
	for w, c := range counts {
		if !found || c > counts[best] || (c == counts[best] && w < best) {
			best, found = w, true
		}
	}
	return best
}`,
    starter: `func MostFrequent(words []string) string {
	if len(words) == 0 {
		return ""
	}
	return words[0]
}`,
  },

  "hash-set": {
    solution: `func UniqueCount(nums []int) int {
	seen := map[int]struct{}{}
	for _, n := range nums {
		seen[n] = struct{}{}
	}
	return len(seen)
}`,
    starter: `func UniqueCount(nums []int) int {
	return len(nums)
}`,
  },

  "stack": {
    solution: `func IsBalanced(s string) bool {
	pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}
	stack := []rune{}
	for _, ch := range s {
		switch ch {
		case '(', '[', '{':
			stack = append(stack, ch)
		case ')', ']', '}':
			if len(stack) == 0 || stack[len(stack)-1] != pairs[ch] {
				return false
			}
			stack = stack[:len(stack)-1]
		}
	}
	return len(stack) == 0
}`,
    starter: `func IsBalanced(s string) bool {
	depth := 0
	for _, ch := range s {
		switch ch {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		}
	}
	return depth == 0
}`,
  },

  "queue": {
    solution: `func SimulateQueue(ops []string, values []int) []int {
	out := []int{}
	queue := []int{}
	head := 0
	for i, op := range ops {
		if op == "push" {
			queue = append(queue, values[i])
			continue
		}
		if head < len(queue) {
			out = append(out, queue[head])
			head++
		}
	}
	return out
}`,
    starter: `func SimulateQueue(ops []string, values []int) []int {
	out := []int{}
	q := []int{}
	for i, op := range ops {
		if op == "push" {
			q = append(q, values[i])
			continue
		}
		if len(q) > 0 {
			out = append(out, q[len(q)-1])
			q = q[:len(q)-1]
		}
	}
	return out
}`,
  },

  "deque": {
    solution: `func MaxSlidingWindow(nums []int, k int) []int {
	out := []int{}
	dq := []int{}
	for i, n := range nums {
		for len(dq) > 0 && nums[dq[len(dq)-1]] <= n {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if dq[0] <= i-k {
			dq = dq[1:]
		}
		if i >= k-1 {
			out = append(out, nums[dq[0]])
		}
	}
	return out
}`,
    starter: `func MaxSlidingWindow(nums []int, k int) []int {
	out := []int{}
	running := 0
	for i, n := range nums {
		if i == 0 || n > running {
			running = n
		}
		if i >= k-1 {
			out = append(out, running)
		}
	}
	return out
}`,
  },

  "heap": {
    solution: `type intHeap []int

func (h intHeap) Len() int           { return len(h) }
func (h intHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h intHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *intHeap) Push(x any) { *h = append(*h, x.(int)) }

func (h *intHeap) Pop() any {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

func KSmallest(nums []int, k int) []int {
	h := intHeap(append([]int{}, nums...))
	heap.Init(&h)
	out := make([]int, 0, k)
	for i := 0; i < k && h.Len() > 0; i++ {
		out = append(out, heap.Pop(&h).(int))
	}
	return out
}`,
    starter: `type intHeap []int

func (h intHeap) Len() int           { return len(h) }
func (h intHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h intHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *intHeap) Push(x any) { *h = append(*h, x.(int)) }

func (h *intHeap) Pop() any {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

func KSmallest(nums []int, k int) []int {
	h := intHeap(append([]int{}, nums...))
	heap.Init(&h)
	if k > len(h) {
		k = len(h)
	}
	return []int(h)[:k]
}`,
  },

  "sorted-map": {
    solution: `func RankValues(nums []int) []int {
	sorted := append([]int{}, nums...)
	sort.Ints(sorted)
	rank := map[int]int{}
	for i, v := range sorted {
		rank[v] = i + 1
	}
	out := make([]int, 0, len(nums))
	for _, n := range nums {
		out = append(out, rank[n])
	}
	return out
}`,
    starter: `func RankValues(nums []int) []int {
	sorted := append([]int{}, nums...)
	sort.Ints(sorted)
	return sorted
}`,
  },

  // -------------------------------------------------------------------------
  // Strings
  // -------------------------------------------------------------------------
  "immutability-and-building": {
    solution: `func RepeatJoin(words []string, sep string) string {
	var b strings.Builder
	for i, w := range words {
		if i > 0 {
			b.WriteString(sep)
		}
		b.WriteString(w)
	}
	return b.String()
}`,
    starter: `func RepeatJoin(words []string, sep string) string {
	var b strings.Builder
	for _, w := range words {
		b.WriteString(w)
	}
	return b.String()
}`,
  },

  "reverse": {
    solution: `func ReverseString(s string) string {
	rs := []rune(s)
	for i, j := 0, len(rs)-1; i < j; i, j = i+1, j-1 {
		rs[i], rs[j] = rs[j], rs[i]
	}
	return string(rs)
}`,
    starter: `func ReverseString(s string) string {
	out := ""
	for _, ch := range s {
		out += string(ch)
	}
	return out
}`,
  },

  "char-codes": {
    solution: `func SumCharCodes(s string) int {
	total := 0
	for _, ch := range s {
		total += int(ch)
	}
	return total
}`,
    starter: `func SumCharCodes(s string) int {
	total := 0
	for range s {
		total++
	}
	return total
}`,
  },

  "split-join": {
    solution: `func NormalizeSpaces(s string) string {
	return strings.Join(strings.Fields(s), " ")
}`,
    starter: `func NormalizeSpaces(s string) string {
	return strings.TrimSpace(s)
}`,
  },

  "comparison": {
    solution: `func IsLexicographicallySmaller(a string, b string) bool {
	return a < b
}`,
    starter: `func IsLexicographicallySmaller(a string, b string) bool {
	return len(a) < len(b)
}`,
  },

  // -------------------------------------------------------------------------
  // Matrices
  // -------------------------------------------------------------------------
  "2d-init": {
    solution: `func MakeGridThenSet(rows int, cols int, v int) int {
	grid := make([][]int, rows)
	for i := range grid {
		grid[i] = make([]int, cols)
	}
	grid[0][0] = v
	return grid[rows-1][cols-1]
}`,
    starter: `func MakeGridThenSet(rows int, cols int, v int) int {
	row := make([]int, cols)
	grid := make([][]int, rows)
	for i := range grid {
		grid[i] = row
	}
	return grid[rows-1][cols-1]
}`,
  },

  "3d-init": {
    solution: `func CubeChecksum(d int, r int, c int) int {
	cube := make([][][]int, d)
	for i := range cube {
		cube[i] = make([][]int, r)
		for j := range cube[i] {
			cube[i][j] = make([]int, c)
		}
	}
	cube[0][0][0] = 1
	total := 0
	for _, layer := range cube {
		for _, row := range layer {
			for _, cell := range row {
				total += cell
			}
		}
	}
	return total
}`,
    starter: `func CubeChecksum(d int, r int, c int) int {
	row := make([]int, c)
	layer := make([][]int, r)
	for j := range layer {
		layer[j] = row
	}
	cube := make([][][]int, d)
	for i := range cube {
		cube[i] = layer
	}
	cube[0][0][0] = 1
	total := 0
	for _, l := range cube {
		for _, rr := range l {
			for _, cell := range rr {
				total += cell
			}
		}
	}
	return total
}`,
  },

  "traverse": {
    solution: `func RowMajorSum(flat []int, cols int) int {
	if cols <= 0 {
		return 0
	}
	rows := len(flat) / cols
	total := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			total += flat[r*cols+c]
		}
	}
	return total
}`,
    starter: `func RowMajorSum(flat []int, cols int) int {
	total := 0
	for c := 0; c < cols && c < len(flat); c++ {
		total += flat[c]
	}
	return total
}`,
  },

  "transpose": {
    solution: `func TransposeFlat(flat []int, rows int, cols int) []int {
	out := make([]int, 0, len(flat))
	for c := 0; c < cols; c++ {
		for r := 0; r < rows; r++ {
			out = append(out, flat[r*cols+c])
		}
	}
	return out
}`,
    starter: `func TransposeFlat(flat []int, rows int, cols int) []int {
	out := make([]int, 0, len(flat))
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			out = append(out, flat[r*cols+c])
		}
	}
	return out
}`,
  },

  "bounds": {
    solution: `func InBounds(rows int, cols int, r int, c int) bool {
	return r >= 0 && r < rows && c >= 0 && c < cols
}`,
    starter: `func InBounds(rows int, cols int, r int, c int) bool {
	return r < rows && c < cols
}`,
  },

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------
  "default-sort": {
    solution: `func SortAscending(nums []int) []int {
	out := append([]int{}, nums...)
	sort.Ints(out)
	return out
}`,
    starter: `func SortAscending(nums []int) []int {
	out := append([]int{}, nums...)
	sort.Ints(out)
	return nums
}`,
  },

  "custom-comparator": {
    solution: `func SortByAbsDesc(nums []int) []int {
	out := append([]int{}, nums...)
	sort.Slice(out, func(i, j int) bool {
		ai, aj := out[i], out[j]
		if ai < 0 {
			ai = -ai
		}
		if aj < 0 {
			aj = -aj
		}
		if ai != aj {
			return ai > aj
		}
		return out[i] < out[j]
	})
	return out
}`,
    starter: `func SortByAbsDesc(nums []int) []int {
	out := append([]int{}, nums...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}`,
  },

  "sort-by-key": {
    solution: `func SortWordsByLength(words []string) string {
	out := append([]string{}, words...)
	sort.Slice(out, func(i, j int) bool {
		if len(out[i]) != len(out[j]) {
			return len(out[i]) < len(out[j])
		}
		return out[i] < out[j]
	})
	return strings.Join(out, ",")
}`,
    starter: `func SortWordsByLength(words []string) string {
	out := append([]string{}, words...)
	sort.Slice(out, func(i, j int) bool { return len(out[i]) > len(out[j]) })
	return strings.Join(out, ",")
}`,
  },

  "stable-sort": {
    solution: `func StableSortKeys(keys []int, values []int) []int {
	order := make([]int, len(keys))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool { return keys[order[i]] < keys[order[j]] })
	out := make([]int, 0, len(values))
	for _, i := range order {
		out = append(out, values[i])
	}
	return out
}`,
    starter: `func StableSortKeys(keys []int, values []int) []int {
	out := append([]int{}, values...)
	sort.Ints(out)
	return out
}`,
  },

  // -------------------------------------------------------------------------
  // Idioms
  // -------------------------------------------------------------------------
  "enumerate": {
    solution: `func IndexOfMax(nums []int) int {
	if len(nums) == 0 {
		return -1
	}
	best := 0
	for i, n := range nums {
		if n > nums[best] {
			best = i
		}
	}
	return best
}`,
    starter: `func IndexOfMax(nums []int) int {
	if len(nums) == 0 {
		return -1
	}
	best := 0
	for i, n := range nums {
		if n >= nums[best] {
			best = i
		}
	}
	return best
}`,
  },

  "zip": {
    solution: `func DotProduct(a []int, b []int) int {
	total := 0
	for i := range a {
		total += a[i] * b[i]
	}
	return total
}`,
    starter: `func DotProduct(a []int, b []int) int {
	total := 0
	for i := range a {
		total += a[i] + b[i]
	}
	return total
}`,
  },

  "slicing": {
    solution: `func LastK(nums []int, k int) []int {
	if k <= 0 || len(nums) == 0 {
		return []int{}
	}
	if k > len(nums) {
		k = len(nums)
	}
	return append([]int{}, nums[len(nums)-k:]...)
}`,
    starter: `func LastK(nums []int, k int) []int {
	if k > len(nums) {
		k = len(nums)
	}
	return append([]int{}, nums[:k]...)
}`,
  },

  "range-vs-iterator": {
    solution: `func EveryOther(nums []int) []int {
	out := make([]int, 0, (len(nums)+1)/2)
	for i := 0; i < len(nums); i += 2 {
		out = append(out, nums[i])
	}
	return out
}`,
    starter: `func EveryOther(nums []int) []int {
	out := []int{}
	for i := 1; i < len(nums); i += 2 {
		out = append(out, nums[i])
	}
	return out
}`,
  },

  // -------------------------------------------------------------------------
  // Pitfalls
  // -------------------------------------------------------------------------
  "mutable-default-arg": {
    solution: `// Collect returns a fresh slice: no call may observe an earlier call's state.
func Collect(value int) []int {
	return []int{value}
}`,
    starter: `var collected []int

func Collect(value int) []int {
	collected = append(collected, value)
	return collected
}`,
  },

  "integer-division": {
    solution: `func FloorDiv(a int, b int) int {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}`,
    starter: `func FloorDiv(a int, b int) int {
	return a / b
}`,
  },

  "integer-overflow": {
    solution: `func SumAsInt(nums []int) int64 {
	var total int64
	for _, n := range nums {
		total += int64(n)
	}
	return total
}`,
    starter: `func SumAsInt(nums []int) int64 {
	var total int32
	for _, n := range nums {
		total += int32(n)
	}
	return int64(total)
}`,
  },

  "shallow-copy": {
    solution: `func CopyThenSet(flat []int, cols int, v int) int {
	cp := append([]int{}, flat...)
	cp[0] = v
	return flat[0]
}`,
    starter: `func CopyThenSet(flat []int, cols int, v int) int {
	flat[0] = v
	return flat[0]
}`,
  },

  "recursion-depth": {
    solution: `// SumRecursive sums 1..n with a loop: a deep recursion is what the concept warns about.
func SumRecursive(n int) int64 {
	var total int64
	for i := 1; i <= n; i++ {
		total += int64(i)
	}
	return total
}`,
    starter: `func SumRecursive(n int) int64 {
	var total int64
	for i := 1; i < n; i++ {
		total += int64(i)
	}
	return total
}`,
  },
};
