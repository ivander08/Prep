/**
 * Design concept library tests.
 *
 * The two checks that matter are the index range and the prompt slugs. An out-of-range
 * `probeFamilies` index silently resolves to `undefined` in the endpoint's name lookup, and a
 * typo'd prompt slug renders a chip that switches to a round that cannot start — both are
 * invisible until a user clicks, which is why they are asserted here rather than trusted.
 */

import { describe, expect, test } from "bun:test";
import { DESIGN_CONCEPTS, GROUP_LABEL, GROUP_ORDER, conceptsForProbeFamily, getDesignConcept, listDesignConcepts } from "./concepts.ts";
import { DESIGN_PROMPTS } from "./catalog.ts";
import { PROBE_FAMILIES } from "./policy.ts";

describe("design concept library", () => {
  test("slugs are unique", () => {
    const slugs = DESIGN_CONCEPTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every group is a declared group with a label", () => {
    for (const c of DESIGN_CONCEPTS) {
      expect({ slug: c.slug, group: c.group }).toEqual({
        slug: c.slug,
        group: expect.stringMatching(new RegExp(`^(${GROUP_ORDER.join("|")})$`)),
      });
      expect(GROUP_LABEL[c.group]).toBeTruthy();
    }
  });

  test("every probe family index is in range and non-empty", () => {
    for (const c of DESIGN_CONCEPTS) {
      expect({ slug: c.slug, n: c.probeFamilies.length > 0 }).toEqual({ slug: c.slug, n: true });
      for (const i of c.probeFamilies) {
        expect({ slug: c.slug, inRange: Number.isInteger(i) && i >= 0 && i < PROBE_FAMILIES.length }).toEqual({
          slug: c.slug,
          inRange: true,
        });
      }
    }
  });

  test("every prompt reference is a real design prompt", () => {
    const slugs = new Set(DESIGN_PROMPTS.map((p) => p.slug));
    for (const c of DESIGN_CONCEPTS) {
      expect({ slug: c.slug, n: c.prompts.length > 0 }).toEqual({ slug: c.slug, n: true });
      for (const p of c.prompts) {
        expect({ concept: c.slug, known: slugs.has(p) }).toEqual({ concept: c.slug, known: true });
      }
    }
  });

  test("every entry has a title, a summary and a body", () => {
    for (const c of DESIGN_CONCEPTS) {
      expect({ slug: c.slug, filled: Boolean(c.title && c.summary && c.bodyMd) }).toEqual({
        slug: c.slug,
        filled: true,
      });
    }
  });

  test("the list strips the bodies", () => {
    const first = listDesignConcepts()[0]!;
    expect("bodyMd" in first).toBe(false);
  });

  test("getDesignConcept returns null for an unknown slug", () => {
    expect(getDesignConcept("no-such-concept")).toBeNull();
  });

  test("conceptsForProbeFamily returns the tagged concepts, and nothing for an unasked family", () => {
    // Family 0 is "The multiplier", the family the most concepts answer, so it is the one a
    // regression in the filter would empty out first.
    const hits = conceptsForProbeFamily(0);
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) expect(c.probeFamilies).toContain(0);

    // Out of range is a normal call: the results panel can be asked about a family the library
    // simply has nothing for.
    expect(conceptsForProbeFamily(PROBE_FAMILIES.length + 5)).toEqual([]);
  });
});
