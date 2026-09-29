import { DESIGN_PROMPTS } from "./src/server/design/catalog.ts";
let n = 0;
for (const p of DESIGN_PROMPTS) {
  for (const e of p.estimates) {
    n++;
    console.log(`[${p.slug}] ${e.label}\n   value:   ${e.value}\n   working: ${e.working.slice(0, 220)}\n`);
  }
}
console.log("total estimates:", n, "prompts:", DESIGN_PROMPTS.length);
