/**
 * Behavioral prompt catalogue tests.
 *
 * The checks that matter are the shape of the list endpoint and the completeness of the
 * answer key. `listBehavioralPrompts` is what the client receives, so a field that leaks
 * through it hands the candidate the rubric they are being graded against; and a prompt with
 * an empty `lookFor` gives the grader nothing to score, which surfaces as a graded answer
 * with no evidence rather than as an error. Both are invisible until someone answers a
 * prompt, which is why they are asserted here rather than trusted.
 *
 * The per-group count is asserted because the track is meant to be balanced across the six
 * axes: three prompts per group is what stops a candidate drilling ownership for a week
 * without ever being asked about ambiguity.
 */

import { describe, expect, test } from "bun:test";
import { BEHAVIORAL_PROMPTS, GROUP_LABEL, GROUP_ORDER, getBehavioralPrompt, listBehavioralPrompts } from "./catalog.ts";

describe("behavioral prompt catalogue", () => {
  test("holds eighteen prompts", () => {
    expect(BEHAVIORAL_PROMPTS.length).toBe(18);
  });

  test("slugs are unique", () => {
    const slugs = BEHAVIORAL_PROMPTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every group is a declared group with a label", () => {
    for (const p of BEHAVIORAL_PROMPTS) {
      expect({ slug: p.slug, group: p.group }).toEqual({
        slug: p.slug,
        group: expect.stringMatching(new RegExp(`^(${GROUP_ORDER.join("|")})$`)),
      });
      expect(GROUP_LABEL[p.group]).toBeTruthy();
    }
  });

  test("every group has exactly three prompts", () => {
    for (const group of GROUP_ORDER) {
      const inGroup = BEHAVIORAL_PROMPTS.filter((p) => p.group === group);
      expect({ group, n: inGroup.length }).toEqual({ group, n: 3 });
    }
  });

  test("every entry has a title, a statement, a summary and a populated answer key", () => {
    for (const p of BEHAVIORAL_PROMPTS) {
      expect({
        slug: p.slug,
        filled: Boolean(p.title && p.statement && p.summary),
        lookFor: p.lookFor.length > 0,
        commonMistakes: p.commonMistakes.length > 0,
      }).toEqual({ slug: p.slug, filled: true, lookFor: true, commonMistakes: true });
    }
  });

  test("the list strips the answer key", () => {
    const first = listBehavioralPrompts()[0]!;
    expect("statement" in first).toBe(false);
    expect("lookFor" in first).toBe(false);
    expect("commonMistakes" in first).toBe(false);
  });

  test("getBehavioralPrompt returns null for an unknown slug", () => {
    expect(getBehavioralPrompt("no-such-prompt")).toBeNull();
  });

  test("getBehavioralPrompt returns the full entry for a known slug", () => {
    const prompt = getBehavioralPrompt("biggest-mistake");
    expect(prompt?.slug).toBe("biggest-mistake");
    expect(prompt?.group).toBe("failure");
    expect(prompt?.lookFor.length).toBeGreaterThan(0);
    expect(prompt?.commonMistakes.length).toBeGreaterThan(0);
  });
});
