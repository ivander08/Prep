/**
 * Sketch persistence tests.
 *
 * The regression these exist for: the sketch used to be rasterised to a PNG and written to
 * `design_sessions.sketch_png`, which `loadSession` never selected — so a reloaded round
 * restored its drafts and left the pad empty, and nothing in the codebase noticed because no
 * test ever read a sketch back.
 *
 * `sanitiseShapes` is exercised through `saveSketch`/`loadSession` rather than directly: the
 * numbers it accepts are interpolated straight into SVG geometry attributes, so what matters
 * is what survives the round trip, not that the helper returns a value.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db, migrate } from "../db.ts";
import { loadSession, saveSketch, startDesignSession, type SketchShape } from "./index.ts";

/** The slug of any real design prompt; the session only needs to exist. */
const SLUG = "rate-limiter";

beforeAll(() => {
  // The test database's schema is copied from the live one, so migration 015 — which adds
  // `sketch_shapes` — has to be applied explicitly for the column to exist.
  migrate();
});

afterAll(() => {
  db.run("DELETE FROM design_sessions");
});

const shapes: SketchShape[] = [
  { kind: "rect", x: 10, y: 20, w: 100, h: 50 },
  { kind: "arrow", x1: 5, y1: 6, x2: 200, y2: 60 },
  { kind: "label", x: 40, y: 80, text: "cache" },
];

describe("design sketch persistence", () => {
  test("a drawn sketch survives save and load", () => {
    const id = startDesignSession(SLUG);
    saveSketch(id, shapes);
    expect(loadSession(id).sketch).toEqual(shapes);
  });

  test("malformed entries are dropped, not stored", () => {
    const id = startDesignSession(SLUG);
    saveSketch(id, [
      { kind: "rect", x: 1, y: 2, w: 3, h: 4 },
      { kind: "blob" },
      { kind: "rect", x: "nope", y: 0, w: 1, h: 1 },
      { kind: "arrow", x1: 0, y1: 0, x2: Number.NaN, y2: 5 },
      null,
      { kind: "label", x: 7, y: 8, text: "   " },
      { kind: "label", x: 9, y: 10, text: "  kept  " },
    ]);
    // The survivors, not just a count: a sanitiser that dropped everything would pass a length.
    expect(loadSession(id).sketch).toEqual([
      { kind: "rect", x: 1, y: 2, w: 3, h: 4 },
      { kind: "label", x: 9, y: 10, text: "kept" },
    ]);
  });

  test("a session with no sketch loads an empty list", () => {
    const id = startDesignSession(SLUG);
    expect(loadSession(id).sketch).toEqual([]);
  });

  test("an unknown session id throws", () => {
    expect(() => saveSketch(999999, [])).toThrow(/^unknown design session/);
  });
});
