import { detectViolations, findRealSyntax } from "./src/server/tutor/detector.ts";
import { detectDesignViolations } from "./src/server/design/detector.ts";
import { HINT_RULES } from "./src/server/tutor/policy.ts";

const turn = (message: string) => ({ hint_level: 0, contains_solution: false, contains_real_code: false, message });

console.log("=== 5.1 real syntax at every ceiling below 6 ===");
const draft = turn("Try this:\n```\ndef solve(nums):\n    return nums\n```");
for (const c of [1, 2, 3, 4, 5, 6]) {
  const v = detectViolations(draft, c);
  console.log(`  ceiling ${c}: ${v.length ? v.map((x) => x.kind).join(",") : "accepted"}`);
}
console.log("  findRealSyntax('def solve():') =", findRealSyntax("def solve():"));
console.log("  HINT_RULES[4] =", JSON.stringify(HINT_RULES[4]));
console.log("  HINT_RULES[5] =", JSON.stringify(HINT_RULES[5]));

console.log("\n=== 5.2 a handed-over design is a violation at every probe level 1..7 ===");
const dTurn = { message: "Sure, here is the design.", revealsDesign: true, probeLevel: null };
for (let lvl = 1; lvl <= 7; lvl++) {
  const v = detectDesignViolations(dTurn as never, { maxProbeLevel: lvl });
  console.log(`  level ${lvl}: ${v.length ? v.map((x) => x.kind).join(",") : "ACCEPTED (bug)"}`);
}
