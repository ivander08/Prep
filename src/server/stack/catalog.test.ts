/**
 * Stack prompt catalogue tests.
 *
 * The checks that matter are the slug set and the group partition. A typo'd slug is a prompt
 * whose detail endpoint 404s and whose grading path has no `lookFor` to score against, both
 * invisible until someone opens it. A group missing from `GROUP_ORDER` renders a section the
 * list view never shows. The list-stripping check protects the answer key: `lookFor` and
 * `commonMistakes` must not travel to the client.
 */

import { describe, expect, test } from "bun:test";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  STACK_PROMPTS,
  getStackPrompt,
  listStackPrompts,
} from "./catalog.ts";

describe("stack prompt catalogue", () => {
  test("holds exactly twenty-seven prompts", () => {
    expect(STACK_PROMPTS.length).toBe(27);
  });

  test("slugs are unique", () => {
    const slugs = STACK_PROMPTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every group is a declared group with a label", () => {
    for (const p of STACK_PROMPTS) {
      expect({ slug: p.slug, group: p.group }).toEqual({
        slug: p.slug,
        group: expect.stringMatching(new RegExp(`^(${GROUP_ORDER.join("|")})$`)),
      });
      expect(GROUP_LABEL[p.group]).toBeTruthy();
    }
  });

  test("every entry has a title, a statement, a summary, a look-for key and common mistakes", () => {
    for (const p of STACK_PROMPTS) {
      expect({
        slug: p.slug,
        filled: Boolean(p.title && p.statement && p.summary),
        lookFor: p.lookFor.length > 0,
        mistakes: p.commonMistakes.length > 0,
      }).toEqual({ slug: p.slug, filled: true, lookFor: true, mistakes: true });
    }
  });

  test("every group has the expected number of prompts", () => {
    for (const group of GROUP_ORDER) {
      const expected = group === "language-depth" ? 12 : 3;
      expect({ group, n: STACK_PROMPTS.filter((p) => p.group === group).length }).toEqual({
        group,
        n: expected,
      });
    }
  });

  test("the list strips the statement and the answer key", () => {
    const first = listStackPrompts()[0]!;
    expect("statement" in first).toBe(false);
    expect("lookFor" in first).toBe(false);
    expect("commonMistakes" in first).toBe(false);
  });

  test("getStackPrompt returns null for an unknown slug", () => {
    expect(getStackPrompt("no-such-prompt")).toBeNull();
  });

  test("getStackPrompt returns the full entry for a known slug", () => {
    const known = STACK_PROMPTS[0]!;
    expect(getStackPrompt(known.slug)).toEqual(known);
  });
});
