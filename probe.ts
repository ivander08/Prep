// Throwaway probe. Deleted at the end of the sweep.
import { Database } from "bun:sqlite";
import { runSuiteAnyLanguage } from "./src/server/grading.ts";

const db = new Database("data/prep.db", { readonly: true });

function suite(slug: string) {
  return db
    .query<{ io_cases: string; entry_point: string | null }, [string]>(
      "SELECT io_cases, entry_point FROM full_tests WHERE slug = ?",
    )
    .get(slug)!;
}

function meta(slug: string) {
  const r = db
    .query<{ meta_json: string | null }, [string]>("SELECT meta_json FROM problems WHERE slug = ?")
    .get(slug);
  return r?.meta_json ? JSON.parse(r.meta_json) : null;
}

async function run(slug: string, code: string, language = "python3") {
  const s = suite(slug);
  const m = meta(slug);
  const r = await runSuiteAnyLanguage({
    slug,
    code,
    fnName: m?.name ?? s.entry_point ?? "",
    ioJson: s.io_cases,
    meta: m,
    language,
  });
  return { accepted: r.accepted, passed: r.passed, total: r.total, skipped: r.skipped, stderr: r.stderr };
}

const which = process.argv[2];

if (which === "sort-colors") {
  console.log("noop     ", await run("sort-colors", "class Solution:\n    def sortColors(self, nums):\n        pass\n"));
  console.log("reverse  ", await run("sort-colors", "class Solution:\n    def sortColors(self, nums):\n        nums.sort(reverse=True)\n"));
}

if (which === "two-sum") {
  const asc = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
        return []
`;
  const desc = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [i, seen[target - x]]
            seen[x] = i
        return []
`;
  console.log("asc  ", await run("two-sum", asc));
  console.log("desc ", await run("two-sum", desc));
}

if (which === "partition-labels") {
  const code = `class Solution:
    def partitionLabels(self, s):
        return [7, 8, 9]
`;
  console.log("wrong-order", await run("partition-labels", code));
}

if (which === "node-params") {
  console.log("rll  ", await run("reverse-linked-list", "class Solution:\n    def reverseList(self, head):\n        return head\n"));
  console.log("ibt  ", await run("invert-binary-tree", "class Solution:\n    def invertTree(self, root):\n        return root\n"));
}

if (which === "java-sudoku") {
  const code = `class Solution {
    public boolean isValidSudoku(char[][] board) {
        for (int i = 0; i < 9; i++) {
            java.util.Set<Character> r = new java.util.HashSet<>();
            java.util.Set<Character> c = new java.util.HashSet<>();
            for (int j = 0; j < 9; j++) {
                if (board[i][j] != '.' && !r.add(board[i][j])) return false;
                if (board[j][i] != '.' && !c.add(board[j][i])) return false;
            }
        }
        for (int b = 0; b < 9; b++) {
            java.util.Set<Character> s = new java.util.HashSet<>();
            for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
                char ch = board[(b / 3) * 3 + i][(b % 3) * 3 + j];
                if (ch != '.' && !s.add(ch)) return false;
            }
        }
        return true;
    }
}
`;
  console.log("java", await run("valid-sudoku", code, "java"));
  console.log("cpp ", await run("valid-sudoku", code.replace(/^class Solution \{/m, "class Solution {\npublic:"), "cpp"));
}
