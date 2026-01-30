import { describe, it, expect } from "vitest";
import { formatDuration } from "./timing";

describe("formatDuration", () => {
  it("rolls seconds into minutes when rounding hits 60s", () => {
    expect(formatDuration(119_999)).toBe("2m");
  });
});
