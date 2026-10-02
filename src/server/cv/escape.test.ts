/**
 * LaTeX escaping, and the ordering trap in it.
 *
 * The single-pass requirement is the whole point of this file: chained `.replace` calls that escape
 * `\` before `{`/`}` would rewrite their own replacement text and emit `\textbackslash\{\}`, which
 * compiles to a literal `\{` and looks almost right.
 */

import { describe, expect, test } from "bun:test";
import { escapeLatex, renderLatex } from "./latex.ts";
import { emptyDoc, validateDoc } from "./doc.ts";
import type { CvDoc } from "./doc.ts";

function doc(overrides: Partial<CvDoc> = {}): CvDoc {
  return {
    name: "Jane Doe",
    email: "jane.doe@example.com",
    links: [],
    sections: [],
    skills: [],
    ...overrides,
  };
}

describe("escapeLatex", () => {
  test("every special character maps to its command", () => {
    expect(escapeLatex("a & b")).toBe("a \\& b");
    expect(escapeLatex("50%")).toBe("50\\%");
    expect(escapeLatex("$5")).toBe("\\$5");
    expect(escapeLatex("#1")).toBe("\\#1");
    expect(escapeLatex("snake_case")).toBe("snake\\_case");
    expect(escapeLatex("a~b")).toBe("a\\textasciitilde{}b");
    expect(escapeLatex("2^3")).toBe("2\\textasciicircum{}3");
  });

  test("a backslash does not escape the braces in its own replacement", () => {
    // The trap. A chained implementation emits `\textbackslash\{\}` here.
    expect(escapeLatex("a\\b")).toBe("a\\textbackslash{}b");
    expect(escapeLatex("\\")).toBe("\\textbackslash{}");
    expect(escapeLatex("C:\\path\\{x}")).toBe("C:\\textbackslash{}path\\textbackslash{}\\{x\\}");
  });

  test("terms with punctuation survive as text, not as markup", () => {
    // These are the terms a CV is most likely to name and the ones a naive escape would break.
    expect(escapeLatex("C++")).toBe("C++");
    expect(escapeLatex("C#")).toBe("C\\#");
    expect(escapeLatex("node.js")).toBe("node.js");
    expect(escapeLatex("CI/CD")).toBe("CI/CD");
  });
});

describe("renderLatex", () => {
  test("the preamble carries the extraction fix", () => {
    const tex = renderLatex(doc());
    expect(tex).toContain("\\usepackage[T1]{fontenc}");
    expect(tex).toContain("\\usepackage{lmodern}");
    expect(tex).toContain("\\usepackage{cmap}");
    // One column: no multicol, no minipage sidebars.
    expect(tex).not.toContain("multicol");
    expect(tex).not.toContain("minipage");
  });

  test("a valid link becomes href, and an invalid one renders as a plain label", () => {
    const tex = renderLatex(
      doc({
        links: [
          { label: "GitHub", url: "https://github.com/jane" },
          { label: "Portfolio", url: "not a url" },
        ],
      }),
    );
    expect(tex).toContain("\\href{https://github.com/jane}{GitHub}");
    expect(tex).toContain("Portfolio");
    expect(tex).not.toContain("\\href{not a url}");
  });

  test("dates render on the title line, not in a separate column", () => {
    const tex = renderLatex(
      doc({
        sections: [
          {
            title: "Experience",
            entries: [{ org: "Acme Corp", role: "Software Engineer", start: "Jan 2023", end: "Present", bullets: ["Did a thing."] }],
          },
        ],
      }),
    );
    expect(tex).toContain("\\cventry{Software Engineer}{Acme Corp}{Jan 2023 -- Present}");
    expect(tex).toContain("\\begin{itemize}[leftmargin=*]");
  });

  test("skills render once, even when a section also claims the title", () => {
    const tex = renderLatex(
      doc({
        sections: [{ title: "Skills", entries: [{ org: "x", role: "y", start: "", end: "", bullets: ["b"] }] }],
        skills: [{ label: "Languages", items: ["Python", "Go"] }],
      }),
    );
    expect(tex.split("\\cvsection{Skills}").length - 1).toBe(1);
    expect(tex).toContain("\\textbf{Languages}: Python, Go");
  });
});

describe("validateDoc", () => {
  test("caps a pasted essay so it cannot produce a twelve-page PDF", () => {
    const check = validateDoc({
      name: "Jane",
      email: "j@example.com",
      summary: "x".repeat(5_000),
      sections: [
        {
          title: "Experience",
          entries: [
            {
              org: "Acme",
              role: "Engineer",
              start: "2023",
              end: "Present",
              bullets: Array.from({ length: 50 }, () => "y".repeat(1_000)),
            },
          ],
        },
      ],
    });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.value.summary!.length).toBeLessThanOrEqual(600);
    expect(check.value.sections[0]!.entries[0]!.bullets.length).toBeLessThanOrEqual(30);
    expect(check.value.sections[0]!.entries[0]!.bullets[0]!.length).toBeLessThanOrEqual(400);
  });

  test("name and email are required", () => {
    const check = validateDoc({ name: "  ", email: "" });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors).toContain("name is required");
    expect(check.errors).toContain("email is required");
  });

  test("an empty entry is dropped rather than rendered as a stray line", () => {
    const check = validateDoc({
      name: "Jane",
      email: "j@example.com",
      sections: [{ title: "Experience", entries: [{ org: "", role: "", start: "", end: "", bullets: ["", "  "] }] }],
    });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.value.sections[0]!.entries).toEqual([]);
  });

  test("emptyDoc gives one entry under each canonical section, in order", () => {
    const d = emptyDoc("Jane Doe");
    expect(d.sections.map((s) => s.title)).toEqual(["Education", "Experience", "Projects", "Skills"]);
    expect(d.sections.every((s) => s.entries.length === 1)).toBe(true);
  });
});
