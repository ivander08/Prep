import { COMPONENTS } from "./src/server/components/catalog.ts";
let bad = 0, maxRatio = 0, minExp = Infinity;
for (const spec of COMPONENTS) {
  for (const [i, t] of spec.tests.entries()) {
    const ops = t.args[1];
    if (t.expected.length > ops.length) { bad++; console.log("FAIL", spec.slug, i, "expected", t.expected.length, "> ops", ops.length); }
    if (ops.some((o) => typeof o !== "string" || o.trim().length === 0)) { bad++; console.log("EMPTY OP", spec.slug, i); }
    maxRatio = Math.max(maxRatio, t.expected.length / ops.length);
    minExp = Math.min(minExp, t.expected.length);
  }
}
console.log("components:", COMPONENTS.length, "violations:", bad, "max expected/ops ratio:", maxRatio.toFixed(2), "min expected len:", minExp);
