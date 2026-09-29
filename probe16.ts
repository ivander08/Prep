import { runInLanguage } from "./src/server/runner.ts";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
const glob = () => readdirSync(tmpdir()).filter((n) => n.startsWith("prep_cpp_"));
console.log("before:", glob().length);
try {
  await runInLanguage({ language: "cpp", code: "class Solution {};", fnName: "f", cases: [{ args: [], expected: 1 }], meta: null });
  console.log("no throw (unexpected)");
} catch (e) {
  console.log("threw:", String(e).slice(0, 90));
}
console.log("after:", glob().length, glob());
