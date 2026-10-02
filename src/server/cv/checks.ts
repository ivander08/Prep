/**
 * The deterministic ATS self-check.
 *
 * Every check runs a real extraction tool on the real PDF the engine produced, so the result
 * describes what an ATS will actually see rather than what the template intended. No model call:
 * this is a measurement, and a measurement that costs a model call is one the user will not run.
 *
 * The checks are ordered so the first failure explains the rest: no text layer means every keyword
 * check fails too, and saying so once is more useful than eight failures.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CvDoc } from "./doc.ts";
import { probeTool, runTool } from "./compile.ts";
import { extractKeywords } from "./keywords.ts";

export type CvCheck = { id: string; label: string; ok: boolean; detail: string };

/** Code points a PDF extraction should never produce: replacement chars, soft hyphens, PUA glyphs. */
function hasGlyphJunk(text: string): boolean {
  if (text.includes("\uFFFD") || text.includes("\u00AD")) return true;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  }
  return false;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Digits only, so "+62 812-3456" matches "628123456". */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Run every check against a compiled PDF.
 *
 * When a tool is missing the whole table is replaced by ONE row. Eight false failures would read as
 * "your CV is broken" when the real problem is that `poppler-utils` is not installed, and the render
 * itself still succeeded.
 */
export async function runAtsChecks(
  pdf: Uint8Array,
  doc: CvDoc,
  opts: { maxPages?: number } = {},
): Promise<CvCheck[]> {
  const [hasText, hasFonts, hasInfo] = await Promise.all([
    probeTool("pdftotext"),
    probeTool("pdffonts"),
    probeTool("pdfinfo"),
  ]);

  if (!hasText || !hasFonts || !hasInfo) {
    return [
      {
        id: "tools",
        label: "ATS checks",
        ok: false,
        detail:
          "pdftotext/pdffonts not found — install poppler-utils (or MiKTeX, which ships them on Windows)",
      },
    ];
  }

  const dir = await mkdtemp(join(tmpdir(), "prep_ats_"));
  try {
    const file = join(dir, "cv.pdf");
    await writeFile(file, pdf);

    const [textOut, fontsOut, infoOut] = await Promise.all([
      runTool(["pdftotext", "-layout", file, "-"]),
      runTool(["pdffonts", file]),
      runTool(["pdfinfo", file]),
    ]);

    if (textOut === null) {
      return [{ id: "text-layer", label: "Text layer", ok: false, detail: "pdftotext could not read the PDF" }];
    }

    const text = textOut;
    const checks: CvCheck[] = [];
    const lines = text.split(/\r?\n/);

    // 1. A real text layer, not an image of one.
    checks.push({
      id: "text-layer",
      label: "Text layer extractable",
      ok: text.trim().length > 200,
      detail: `${text.trim().length} characters extracted`,
    });

    // 2. The name is the first thing a parser reads.
    const firstLine = lines.find((l) => l.trim().length > 0) ?? "";
    checks.push({
      id: "name-first",
      label: "Name is the first line",
      ok: firstLine.includes(doc.name),
      detail: firstLine.trim().slice(0, 80) || "(no first line)",
    });

    // 3. Contact details parse as contact details, not as junk glued to a glyph.
    const emailMatch = EMAIL_RE.exec(text);
    checks.push({
      id: "email-parses",
      label: "Email parses",
      ok: emailMatch !== null && emailMatch[0].toLowerCase() === doc.email.toLowerCase(),
      detail: emailMatch ? emailMatch[0] : "no email-shaped token found",
    });

    if (doc.phone) {
      const wanted = digits(doc.phone);
      const found = digits(text).includes(wanted);
      checks.push({
        id: "phone-parses",
        label: "Phone parses",
        ok: found && wanted.length > 0,
        detail: found ? "digits found in the extracted text" : `digits of ${doc.phone} not found`,
      });
    }

    // 4. Every section heading survives as its own line, which is how a parser classifies sections.
    const wantedTitles = [
      ...doc.sections.map((s) => s.title),
      ...(doc.skills.some((g) => g.items.length > 0) ? ["Skills"] : []),
    ];
    const presentTitles = wantedTitles.filter((t) => lines.some((l) => l.trim() === t));
    checks.push({
      id: "sections-present",
      label: "Section headings survive",
      ok: presentTitles.length === wantedTitles.length,
      detail:
        presentTitles.length === wantedTitles.length
          ? `${wantedTitles.length} headings`
          : `missing: ${wantedTitles.filter((t) => !presentTitles.includes(t)).join(", ")}`,
    });

    // 5. No glyph junk. An icon font extracts as private-use code points glued to the email.
    checks.push({
      id: "no-glyph-junk",
      label: "No glyph junk",
      ok: !hasGlyphJunk(text),
      detail: hasGlyphJunk(text) ? "replacement, soft-hyphen or private-use characters found" : "clean",
    });

    // 6. Fonts embedded AND with a ToUnicode map. `uni=no` is the failure that makes text
    // unextractable: without it `pdftotext` loses ligatures ("financial" → "nancial").
    if (fontsOut === null) {
      checks.push({ id: "fonts-embedded", label: "Fonts embedded with a Unicode map", ok: false, detail: "pdffonts failed" });
    } else {
      // Columns are: name, type, encoding, emb, sub, uni, object, id. The first three contain
      // spaces, so the flags are read from the END of the line rather than by splitting on
      // whitespace.
      const rows = fontsOut
        .split(/\r?\n/)
        .slice(2)
        .filter((l) => l.trim().length > 0);
      const bad = rows.filter((r) => {
        const m = /\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(r);
        return !m || m[1] !== "yes" || m[3] !== "yes";
      });
      checks.push({
        id: "fonts-embedded",
        label: "Fonts embedded with a Unicode map",
        ok: rows.length > 0 && bad.length === 0,
        detail:
          rows.length === 0
            ? "no fonts reported"
            : bad.length === 0
              ? `${rows.length} fonts, all emb+uni`
              : `${bad.length} of ${rows.length} fonts lack emb/uni`,
      });
    }

    // 7. One page. Two columns or a stray section are what push a CV to page 2, and a length limit
    // is the most common explicit instruction in a posting.
    const maxPages = opts.maxPages ?? 1;
    const pages = infoOut === null ? null : Number(/^Pages:\s+(\d+)/m.exec(infoOut)?.[1] ?? NaN);
    checks.push({
      id: "page-limit",
      label: `Fits in ${maxPages} page${maxPages === 1 ? "" : "s"}`,
      ok: pages !== null && Number.isFinite(pages) && pages <= maxPages,
      detail: pages === null || !Number.isFinite(pages) ? "pdfinfo could not report a page count" : `${pages} page${pages === 1 ? "" : "s"}`,
    });

    // 8. The user's own vocabulary survives extraction. This is the LIGATURE test: drop
    // `\usepackage{cmap}` and "financial" stops matching here, which is exactly the regression the
    // preamble guards against.
    const own = extractKeywords([doc.summary ?? "", ...doc.skills.flatMap((g) => g.items)].join("\n"), 40);
    const missingWords = own.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
    checks.push({
      id: "keywords-survive",
      label: "Your own keywords survive extraction",
      ok: own.length === 0 || missingWords.length === 0,
      detail:
        own.length === 0
          ? "no keywords in the summary or skills to check"
          : missingWords.length === 0
            ? `${own.length} terms round-tripped`
            : `lost: ${missingWords.slice(0, 8).join(", ")}`,
    });

    return checks;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
