import { describe, expect, test } from "bun:test";
import { formatElapsed, isOverLimit } from "./Stopwatch.tsx";

describe("formatElapsed", () => {
  test("zero-pads minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(59)).toBe("00:59");
    expect(formatElapsed(60)).toBe("01:00");
    expect(formatElapsed(1200)).toBe("20:00");
  });

  test("adds an hour field only once there is an hour", () => {
    expect(formatElapsed(3599)).toBe("59:59");
    expect(formatElapsed(3600)).toBe("1:00:00");
  });

  test("clamps a negative elapsed to zero rather than rendering a negative clock", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("isOverLimit", () => {
  test("exactly at the limit is NOT over, matching gradeAttempt's strict >", () => {
    expect(isOverLimit(1200, 1200)).toBe(false);
    expect(isOverLimit(1201, 1200)).toBe(true);
  });
});
