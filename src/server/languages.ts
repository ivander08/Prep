/**
 * Multi-language execution harnesses.
 * The binding rule differs per language, and getting it wrong fails EVERY submission; that was the first bug found in Phase 1. LeetCode's stubs are:
 *   Python      `class Solution:` with a method taking `self`  -> instantiate + bind
 *   JavaScript  `var twoSum = function(...)`, a bare function  -> no class at all
 *   Java        `class Solution { public int[] twoSum(...) }`  -> instantiate + bind
 *   C++         `class Solution { public: vector<int> twoSum(...) }`
 *   Go          `func twoSum(nums []int, target int) []int`    -> bare function, no class
 * Two of the five have no class. Applying the Python rule to JS fails everything, and the reverse, so each language gets its own harness.
 * Verified locally: python 3.13, node 22, java 17, gcc/g++ 13.2, go. No rustc.
 */

export type LanguageId = "python3" | "javascript" | "java" | "cpp" | "go";

export type LanguageSpec = {
  id: LanguageId;
  label: string;
  /** LeetCode's langSlug in `codeSnippets`, used to seed the editor. */
  langSlug: string;
  /** Executable to invoke. */
  command: string[];
  /** File extension for the temp source file. */
  ext: string;
  /** Whether the runtime needs a compile step. */
  compile?: (file: string) => string[];
};

export const LANGUAGES: LanguageSpec[] = [
  { id: "python3", label: "Python 3", langSlug: "python3", command: ["python"], ext: "py" },
  { id: "javascript", label: "JavaScript", langSlug: "javascript", command: ["node"], ext: "js" },
  { id: "java", label: "Java", langSlug: "java", command: ["java"], ext: "java" },
  { id: "cpp", label: "C++", langSlug: "cpp", command: [], ext: "cpp" },
  { id: "go", label: "Go", langSlug: "golang", command: ["go", "run"], ext: "go" },
];

export function languageById(id: string): LanguageSpec {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]!;
}

/**
 * Check which runtimes actually exist on this machine.
 *
 * Reported to the UI, not assumed: a language listed but not installed should be visibly
 * unavailable, not fail at submit time.
 */
export async function detectAvailableLanguages(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  await Promise.all(
    LANGUAGES.map(async (lang) => {
      const probe = lang.id === "cpp" ? "g++" : lang.command[0];
      if (!probe) {
        results[lang.id] = false;
        return;
      }
      try {
        const proc = Bun.spawn([probe, lang.id === "java" ? "-version" : "--version"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const timer = setTimeout(() => proc.kill(), 5000);
        await new Response(proc.stderr).text();
        await new Response(proc.stdout).text();
        clearTimeout(timer);
        // `java -version` writes to stderr and exits 0; a missing binary throws instead.
        results[lang.id] = true;
      } catch {
        results[lang.id] = false;
      }
    }),
  );

  return results;
}
