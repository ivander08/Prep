/**
 * C++17 exemplars and faded scaffolds for the language-fundamentals track.
 *
 * Keyed by catalogue slug; the tests themselves live in `catalog.ts` so no language can
 * disagree about what a concept does.
 *
 * The harness emits `#include <bits/stdc++.h>` and `using namespace std;` ahead of this code
 * and code-generates the call site from the parameter and return types, so nothing here
 * declares an include, and no concept takes or returns a matrix — matrices arrive flat with
 * explicit dimensions, exactly as the tests show.
 *
 * `sumAsInt` and `sumRecursive` return `long long`: both exceed 2^31 on the given inputs, and
 * a 32-bit accumulator wrapping there is the very bug the `integer-overflow` concept teaches.
 * `sumRecursive` is written as a loop on purpose — the harness compiles at `-O0`, where C++
 * gives no tail-call guarantee, so a recursive version would exhaust the stack at n = 100000.
 */

export const CPP: Record<string, { starter: string; solution: string }> = {
  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  "dynamic-array": {
    solution: `class Solution {
public:
    vector<int> buildRange(int n) {
        vector<int> out;
        out.reserve(n);
        for (int i = 0; i < n; i++) out.push_back(i);
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> buildRange(int n) {
        vector<int> out(n);
        for (int i = 0; i < n; i++) out.push_back(i);
        return out;
    }
};`,
  },

  "hash-map": {
    solution: `class Solution {
public:
    string mostFrequent(vector<string> words) {
        unordered_map<string, int> counts;
        for (const auto& w : words) counts[w]++;
        string best;
        int bestCount = 0;
        for (const auto& [w, c] : counts) {
            if (c > bestCount || (c == bestCount && !best.empty() && w < best)) {
                bestCount = c;
                best = w;
            }
        }
        return best;
    }
};`,
    starter: `class Solution {
public:
    string mostFrequent(vector<string> words) {
        unordered_map<string, int> counts;
        for (const auto& w : words) counts[w] = 0;
        string best;
        int bestCount = 0;
        for (const auto& [w, c] : counts) {
            if (c > bestCount) {
                bestCount = c;
                best = w;
            }
        }
        return best;
    }
};`,
  },

  "hash-set": {
    solution: `class Solution {
public:
    int uniqueCount(vector<int> nums) {
        unordered_set<int> seen(nums.begin(), nums.end());
        return (int)seen.size();
    }
};`,
    starter: `class Solution {
public:
    int uniqueCount(vector<int> nums) {
        unordered_set<int> seen;
        return (int)seen.size();
    }
};`,
  },

  stack: {
    solution: `class Solution {
public:
    bool isBalanced(string s) {
        unordered_map<char, char> pairs = {{')', '('}, {']', '['}, {'}', '{'}};
        vector<char> stack;
        for (char c : s) {
            if (c == '(' || c == '[' || c == '{') {
                stack.push_back(c);
            } else {
                if (stack.empty() || stack.back() != pairs[c]) return false;
                stack.pop_back();
            }
        }
        return stack.empty();
    }
};`,
    starter: `class Solution {
public:
    bool isBalanced(string s) {
        vector<char> stack;
        for (char c : s) {
            if (c == '(' || c == '[' || c == '{') stack.push_back(c);
            else if (!stack.empty()) stack.pop_back();
        }
        return true;
    }
};`,
  },

  queue: {
    solution: `class Solution {
public:
    vector<int> simulateQueue(vector<string> ops, vector<int> values) {
        queue<int> q;
        vector<int> out;
        for (size_t i = 0; i < ops.size(); i++) {
            if (ops[i] == "push") {
                q.push(values[i]);
            } else if (!q.empty()) {
                out.push_back(q.front());
                q.pop();
            }
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> simulateQueue(vector<string> ops, vector<int> values) {
        vector<int> q;
        vector<int> out;
        for (size_t i = 0; i < ops.size(); i++) {
            if (ops[i] == "push") {
                q.push_back(values[i]);
            } else if (!q.empty()) {
                out.push_back(q.back());
                q.pop_back();
            }
        }
        return out;
    }
};`,
  },

  deque: {
    solution: `class Solution {
public:
    vector<int> maxSlidingWindow(vector<int> nums, int k) {
        deque<int> dq;
        vector<int> out;
        for (int i = 0; i < (int)nums.size(); i++) {
            while (!dq.empty() && nums[dq.back()] <= nums[i]) dq.pop_back();
            dq.push_back(i);
            if (dq.front() <= i - k) dq.pop_front();
            if (i >= k - 1) out.push_back(nums[dq.front()]);
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> maxSlidingWindow(vector<int> nums, int k) {
        vector<int> out;
        for (int i = 0; i + k <= (int)nums.size(); i++) out.push_back(nums[i]);
        return out;
    }
};`,
  },

  heap: {
    solution: `class Solution {
public:
    vector<int> kSmallest(vector<int> nums, int k) {
        // priority_queue is MAX-first by default; greater<int> is what turns it into the
        // min-heap, and heapifying from the range is O(n) rather than n pushes.
        priority_queue<int, vector<int>, greater<int>> pq(nums.begin(), nums.end());
        vector<int> out;
        for (int i = 0; i < k && !pq.empty(); i++) {
            out.push_back(pq.top());
            pq.pop();
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> kSmallest(vector<int> nums, int k) {
        priority_queue<int> pq(nums.begin(), nums.end());
        vector<int> out;
        for (int i = 0; i < k && !pq.empty(); i++) {
            out.push_back(pq.top());
            pq.pop();
        }
        sort(out.begin(), out.end());
        return out;
    }
};`,
  },

  "sorted-map": {
    solution: `class Solution {
public:
    vector<int> rankValues(vector<int> nums) {
        map<int, int> rank;
        for (int x : nums) rank[x] = 0;
        int next = 1;
        for (auto& [value, position] : rank) position = next++;
        vector<int> out;
        out.reserve(nums.size());
        for (int x : nums) out.push_back(rank[x]);
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> rankValues(vector<int> nums) {
        map<int, int> rank;
        for (int x : nums) rank[x] = 0;
        vector<int> out;
        for (int x : nums) out.push_back(rank[x]);
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Strings
  // ---------------------------------------------------------------------------
  "immutability-and-building": {
    solution: `class Solution {
public:
    string repeatJoin(vector<string> words, string sep) {
        // std::string grows amortised, so += is linear here unlike Java's String +=.
        string out;
        for (size_t i = 0; i < words.size(); i++) {
            if (i) out += sep;
            out += words[i];
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    string repeatJoin(vector<string> words, string sep) {
        string out;
        for (const auto& w : words) out += w;
        return out;
    }
};`,
  },

  reverse: {
    solution: `class Solution {
public:
    string reverseString(string s) {
        string t = s;
        reverse(t.begin(), t.end());
        return t;
    }
};`,
    starter: `class Solution {
public:
    string reverseString(string s) {
        string t = s;
        for (size_t i = 0; i + 1 < t.size() / 2; i++) swap(t[i], t[t.size() - 1 - i]);
        return t;
    }
};`,
  },

  "char-codes": {
    solution: `class Solution {
public:
    int sumCharCodes(string s) {
        int total = 0;
        for (char c : s) total += (unsigned char)c;
        return total;
    }
};`,
    starter: `class Solution {
public:
    int sumCharCodes(string s) {
        int total = 0;
        for (char c : s) total += c - '0';
        return total;
    }
};`,
  },

  "split-join": {
    solution: `class Solution {
public:
    string normalizeSpaces(string s) {
        istringstream in(s);
        string word;
        string out;
        while (in >> word) {
            if (!out.empty()) out += " ";
            out += word;
        }
        return out;
    }
};`,
    starter: `class Solution {
public:
    string normalizeSpaces(string s) {
        vector<string> parts;
        string cur;
        for (char c : s) {
            if (c == ' ') {
                parts.push_back(cur);
                cur.clear();
            } else {
                cur += c;
            }
        }
        parts.push_back(cur);
        string out;
        for (size_t i = 0; i < parts.size(); i++) {
            if (i) out += " ";
            out += parts[i];
        }
        return out;
    }
};`,
  },

  comparison: {
    solution: `class Solution {
public:
    bool isLexicographicallySmaller(string a, string b) {
        return a < b;
    }
};`,
    starter: `class Solution {
public:
    bool isLexicographicallySmaller(string a, string b) {
        return a.size() < b.size();
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Matrices (flat, with explicit dimensions)
  // ---------------------------------------------------------------------------
  "2d-init": {
    solution: `class Solution {
public:
    int makeGridThenSet(int rows, int cols, int v) {
        // vector copies on construction, so the rows are independent here.
        vector<vector<int>> grid(rows, vector<int>(cols, 0));
        grid[0][0] = v;
        return grid[rows - 1][cols - 1];
    }
};`,
    starter: `class Solution {
public:
    int makeGridThenSet(int rows, int cols, int v) {
        // FADED: one inner row, referenced by every slot in the outer vector.
        vector<int> row(cols, 0);
        vector<vector<int>*> grid(rows, &row);
        return (*grid[rows - 1])[cols - 1];
    }
};`,
  },

  "3d-init": {
    solution: `class Solution {
public:
    int cubeChecksum(int d, int r, int c) {
        vector<vector<vector<int>>> cube(d, vector<vector<int>>(r, vector<int>(c, 0)));
        cube[0][0][0] = 1;
        int total = 0;
        for (const auto& layer : cube)
            for (const auto& row : layer)
                for (int x : row) total += x;
        return total;
    }
};`,
    starter: `class Solution {
public:
    int cubeChecksum(int d, int r, int c) {
        vector<vector<vector<int>>> cube(d, vector<vector<int>>(r, vector<int>(c, 0)));
        cube[0][0][0] = 1;
        return d * r * c;
    }
};`,
  },

  traverse: {
    solution: `class Solution {
public:
    int rowMajorSum(vector<int> flat, int cols) {
        int total = 0;
        int rows = cols > 0 ? (int)flat.size() / cols : 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                total += flat[r * cols + c];
        return total;
    }
};`,
    starter: `class Solution {
public:
    int rowMajorSum(vector<int> flat, int cols) {
        int total = 0;
        int rows = cols > 0 ? (int)flat.size() / cols : 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                total += flat[r * rows + c];
        return total;
    }
};`,
  },

  transpose: {
    solution: `class Solution {
public:
    vector<int> transposeFlat(vector<int> flat, int rows, int cols) {
        vector<int> out;
        out.reserve(flat.size());
        for (int c = 0; c < cols; c++)
            for (int r = 0; r < rows; r++)
                out.push_back(flat[r * cols + c]);
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> transposeFlat(vector<int> flat, int rows, int cols) {
        vector<int> out;
        out.reserve(flat.size());
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                out.push_back(flat[r * cols + c]);
        return out;
    }
};`,
  },

  bounds: {
    solution: `class Solution {
public:
    bool inBounds(int rows, int cols, int r, int c) {
        return r >= 0 && r < rows && c >= 0 && c < cols;
    }
};`,
    starter: `class Solution {
public:
    bool inBounds(int rows, int cols, int r, int c) {
        return r < rows && c < cols;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------
  "default-sort": {
    solution: `class Solution {
public:
    vector<int> sortAscending(vector<int> nums) {
        vector<int> out = nums;
        sort(out.begin(), out.end());
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> sortAscending(vector<int> nums) {
        vector<int> out = nums;
        sort(out.begin(), out.end(), greater<int>());
        return out;
    }
};`,
  },

  "custom-comparator": {
    solution: `class Solution {
public:
    vector<int> sortByAbsDesc(vector<int> nums) {
        vector<int> out = nums;
        sort(out.begin(), out.end(), [](int a, int b) {
            int x = abs(a), y = abs(b);
            if (x != y) return x > y;
            return a < b;
        });
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> sortByAbsDesc(vector<int> nums) {
        vector<int> out = nums;
        sort(out.begin(), out.end());
        return out;
    }
};`,
  },

  "sort-by-key": {
    solution: `class Solution {
public:
    string sortWordsByLength(vector<string> words) {
        vector<string> out = words;
        sort(out.begin(), out.end(), [](const string& a, const string& b) {
            if (a.size() != b.size()) return a.size() < b.size();
            return a < b;
        });
        string res;
        for (size_t i = 0; i < out.size(); i++) {
            if (i) res += ",";
            res += out[i];
        }
        return res;
    }
};`,
    starter: `class Solution {
public:
    string sortWordsByLength(vector<string> words) {
        vector<string> out = words;
        sort(out.begin(), out.end(), [](const string& a, const string& b) {
            if (a.size() != b.size()) return a.size() < b.size();
            return a > b;
        });
        string res;
        for (size_t i = 0; i < out.size(); i++) {
            if (i) res += ",";
            res += out[i];
        }
        return res;
    }
};`,
  },

  "stable-sort": {
    solution: `class Solution {
public:
    vector<int> stableSortKeys(vector<int> keys, vector<int> values) {
        vector<int> order(keys.size());
        for (size_t i = 0; i < order.size(); i++) order[i] = (int)i;
        // std::sort is not stable; std::stable_sort is.
        stable_sort(order.begin(), order.end(), [&](int a, int b) { return keys[a] < keys[b]; });
        vector<int> out;
        out.reserve(order.size());
        for (int i : order) out.push_back(values[i]);
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> stableSortKeys(vector<int> keys, vector<int> values) {
        vector<int> order(keys.size());
        for (size_t i = 0; i < order.size(); i++) order[i] = (int)i;
        stable_sort(order.begin(), order.end(), [&](int a, int b) { return keys[a] < keys[b]; });
        vector<int> out;
        out.reserve(order.size());
        for (int i : order) out.push_back(keys[i]);
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Idioms
  // ---------------------------------------------------------------------------
  enumerate: {
    solution: `class Solution {
public:
    int indexOfMax(vector<int> nums) {
        if (nums.empty()) return -1;
        int best = 0;
        // Strictly greater, so the FIRST maximum wins.
        for (int i = 1; i < (int)nums.size(); i++) {
            if (nums[i] > nums[best]) best = i;
        }
        return best;
    }
};`,
    starter: `class Solution {
public:
    int indexOfMax(vector<int> nums) {
        if (nums.empty()) return -1;
        int best = 0;
        for (int i = 1; i < (int)nums.size(); i++) {
            if (nums[i] >= nums[best]) best = i;
        }
        return best;
    }
};`,
  },

  zip: {
    solution: `class Solution {
public:
    int dotProduct(vector<int> a, vector<int> b) {
        int total = 0;
        for (size_t i = 0; i < a.size(); i++) total += a[i] * b[i];
        return total;
    }
};`,
    starter: `class Solution {
public:
    int dotProduct(vector<int> a, vector<int> b) {
        if (a.empty()) return 0;
        return a[0] * b[0];
    }
};`,
  },

  slicing: {
    solution: `class Solution {
public:
    vector<int> lastK(vector<int> nums, int k) {
        if (k <= 0) return {};
        int take = min((int)nums.size(), k);
        return vector<int>(nums.end() - take, nums.end());
    }
};`,
    starter: `class Solution {
public:
    vector<int> lastK(vector<int> nums, int k) {
        if (k <= 0) return {};
        int take = min((int)nums.size(), k);
        return vector<int>(nums.begin(), nums.begin() + take);
    }
};`,
  },

  "range-vs-iterator": {
    solution: `class Solution {
public:
    vector<int> everyOther(vector<int> nums) {
        vector<int> out;
        for (int i = 0; i < (int)nums.size(); i += 2) out.push_back(nums[i]);
        return out;
    }
};`,
    starter: `class Solution {
public:
    vector<int> everyOther(vector<int> nums) {
        vector<int> out;
        for (int i = 0; i < (int)nums.size(); i++) out.push_back(nums[i]);
        return out;
    }
};`,
  },

  // ---------------------------------------------------------------------------
  // Pitfalls
  // ---------------------------------------------------------------------------
  "mutable-default-arg": {
    solution: `class Solution {
public:
    vector<int> collect(int value) {
        // A fresh container per call: a call must not observe an earlier call.
        return {value};
    }
};`,
    starter: `class Solution {
public:
    vector<int> collect(int value) {
        static vector<int> acc;
        acc.push_back(value);
        return acc;
    }
};`,
  },

  "integer-division": {
    solution: `class Solution {
public:
    int floorDiv(int a, int b) {
        // C++ / truncates toward zero, so correct the negative case.
        int q = a / b;
        if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
        return q;
    }
};`,
    starter: `class Solution {
public:
    int floorDiv(int a, int b) {
        return a / b;
    }
};`,
  },

  "integer-overflow": {
    solution: `class Solution {
public:
    long long sumAsInt(vector<int> nums) {
        long long total = 0;
        for (int n : nums) total += n;
        return total;
    }
};`,
    starter: `class Solution {
public:
    long long sumAsInt(vector<int> nums) {
        int total = 0;
        for (int n : nums) total += n;
        return total;
    }
};`,
  },

  "shallow-copy": {
    solution: `class Solution {
public:
    int copyThenSet(vector<int> flat, int cols, int v) {
        vector<int> copy = flat;
        if (!copy.empty()) copy[0] = v;
        return flat[0];
    }
};`,
    starter: `class Solution {
public:
    int copyThenSet(vector<int> flat, int cols, int v) {
        flat[0] = v;
        return flat[0];
    }
};`,
  },

  "recursion-depth": {
    solution: `class Solution {
public:
    long long sumRecursive(int n) {
        // A loop, not recursion: at -O0 there is no tail-call elimination, so n = 100000
        // would overflow the real stack with a segmentation fault.
        long long total = 0;
        for (int i = 1; i <= n; i++) total += i;
        return total;
    }
};`,
    starter: `class Solution {
public:
    long long sumRecursive(int n) {
        if (n <= 0) return 0;
        return (long long)n + sumRecursive(n - 1);
    }
};`,
  },
};
