/**
 * The ATS checks, run against a real compile.
 *
 * Skipped when this machine has no TeX engine, because there is nothing to assert without one. When
 * it does run, the second case is the important one: the same document rendered WITHOUT the font
 * packages must make `keywords-survive` FAIL. A check that cannot fail is not a check, and that
 * assertion is what proves the preamble is load-bearing rather than decorative.
 */

import { describe, expect, test } from "bun:test";
import { compileLatex, detectLatexEngine, probeTool } from "./compile.ts";
import { runAtsChecks } from "./checks.ts";
import { renderLatex } from "./latex.ts";
import type { CvDoc } from "./doc.ts";

const engine = await detectLatexEngine();
const tools =
  (await probeTool("pdftotext")) && (await probeTool("pdffonts")) && (await probeTool("pdfinfo"));

/**
 * A real compile is two engine passes plus three extraction tools, which is several seconds — over
 * bun's 5 s default. The timeout is raised rather than the work trimmed, because the work is the
 * assertion.
 */
const SLOW = 60_000;

/** A document whose bullets carry ligature-forming words, which is what the font preamble protects. */
const DOC: CvDoc = {
  name: "Jane Doe",
  headline: "Backend Engineer",
  email: "jane.doe@example.com",
  phone: "+62 812 3456 7890",
  location: "Jakarta, Indonesia",
  links: [{ label: "GitHub", url: "https://github.com/janedoe" }],
  summary: "Backend engineer working on financial reporting and efficient workflow automation.",
  sections: [
    {
      title: "Experience",
      entries: [
        {
          org: "Acme Corp",
          role: "Software Engineer",
          start: "Jan 2023",
          end: "Present",
          bullets: ["Cut financial reporting latency 40% by profiling efficient workflow paths."],
        },
      ],
    },
    {
      title: "Education",
      entries: [{ org: "Universitas", role: "BSc Computer Science", start: "2019", end: "2023", bullets: [] }],
    },
  ],
  skills: [{ label: "Languages", items: ["TypeScript", "Go", "Python"] }],
};

describe("runAtsChecks", () => {
  test.skipIf(!engine || !tools)(
    "every check passes on a correctly built CV",
    async () => {
      const built = await compileLatex(renderLatex(DOC));
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const checks = await runAtsChecks(built.pdf, DOC);
      const failed = checks.filter((c) => !c.ok);
      // Reported together so a failure names which check, rather than stopping at the first.
      expect(failed.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);

      // The ligature words are what the font preamble exists for; `keywords-survive` is the check
      // that reads them back out of the extracted text.
      const keywords = checks.find((c) => c.id === "keywords-survive");
      expect(keywords!.ok).toBe(true);
      expect(keywords!.detail).toContain("round-tripped");
    },
    SLOW,
  );

  test.skipIf(!engine || !tools)(
    "the font preamble is load-bearing: dropping it fails keywords-survive and fonts-embedded",
    async () => {
      // Measured on MiKTeX 26.1: without `lmodern`, pdfTeX falls back to Type 3 bitmap fonts with
      // `uni=no`, and `pdftotext` then loses every ligature — "financial" extracts as "nancial",
      // "efficient" as "ecient". That is the regression the preamble guards against.
      //
      // `cmap` alone does NOT reproduce it here: with `lmodern` present it changes nothing, because
      // `lmodern` already ships Type 1 fonts with a ToUnicode map. It stays in the template as the
      // portable belt to `lmodern`'s braces for a distribution where the fallback fonts differ, and
      // this test deliberately targets the line that is observable on this machine.
      const withoutFonts = renderLatex(DOC).replace("\\usepackage{lmodern}\n", "");
      expect(withoutFonts).not.toContain("\\usepackage{lmodern}");

      const built = await compileLatex(withoutFonts);
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const checks = await runAtsChecks(built.pdf, DOC);
      expect(checks.find((c) => c.id === "keywords-survive")!.ok).toBe(false);
      expect(checks.find((c) => c.id === "fonts-embedded")!.ok).toBe(false);
    },
    SLOW,
  );

  test.skipIf(!engine)(
    "a broken document fails the compile with the offending line named",
    async () => {
      const broken = renderLatex(DOC).replace("\\begin{document}", "\\begin{document}\n\\undefinedcommand");
      const built = await compileLatex(broken);
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.error).toContain("undefinedcommand");
    },
    SLOW,
  );
});
