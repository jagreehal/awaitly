import { describe, it, expect } from "vitest";
import { Duration } from "./duration";

describe("Duration", () => {
  describe("constructors", () => {
    it("creates duration from milliseconds", () => {
      const d = Duration.millis(500);
      expect(Duration.toMillis(d)).toBe(500);
    });

    it("creates duration from seconds", () => {
      const d = Duration.seconds(5);
      expect(Duration.toMillis(d)).toBe(5000);
    });

    it("creates duration from minutes", () => {
      const d = Duration.minutes(2);
      expect(Duration.toMillis(d)).toBe(120000);
    });

    it("creates duration from hours", () => {
      const d = Duration.hours(1);
      expect(Duration.toMillis(d)).toBe(3600000);
    });

    it("creates duration from days", () => {
      const d = Duration.days(1);
      expect(Duration.toMillis(d)).toBe(86400000);
    });

    it("has zero constant", () => {
      expect(Duration.toMillis(Duration.zero)).toBe(0);
    });

    it("has infinity constant", () => {
      expect(Duration.toMillis(Duration.infinity)).toBe(Infinity);
    });
  });

  describe("conversions", () => {
    it("converts to seconds", () => {
      expect(Duration.toSeconds(Duration.millis(5000))).toBe(5);
    });

    it("converts to minutes", () => {
      expect(Duration.toMinutes(Duration.seconds(120))).toBe(2);
    });

    it("converts to hours", () => {
      expect(Duration.toHours(Duration.minutes(60))).toBe(1);
    });

    it("converts to days", () => {
      expect(Duration.toDays(Duration.hours(24))).toBe(1);
    });
  });

  describe("operations", () => {
    it("adds durations", () => {
      const a = Duration.seconds(5);
      const b = Duration.millis(500);
      const result = Duration.add(a, b);
      expect(Duration.toMillis(result)).toBe(5500);
    });

    it("subtracts durations", () => {
      const a = Duration.seconds(5);
      const b = Duration.seconds(2);
      const result = Duration.subtract(a, b);
      expect(Duration.toMillis(result)).toBe(3000);
    });

    it("clamps subtraction to zero", () => {
      const a = Duration.seconds(2);
      const b = Duration.seconds(5);
      const result = Duration.subtract(a, b);
      expect(Duration.toMillis(result)).toBe(0);
    });

    it("multiplies duration", () => {
      const d = Duration.seconds(5);
      const result = Duration.multiply(d, 2);
      expect(Duration.toMillis(result)).toBe(10000);
    });

    it("divides duration", () => {
      const d = Duration.seconds(10);
      const result = Duration.divide(d, 2);
      expect(Duration.toMillis(result)).toBe(5000);
    });
  });

  describe("comparisons", () => {
    it("compares less than", () => {
      expect(Duration.lessThan(Duration.seconds(1), Duration.seconds(2))).toBe(true);
      expect(Duration.lessThan(Duration.seconds(2), Duration.seconds(1))).toBe(false);
    });

    it("compares greater than", () => {
      expect(Duration.greaterThan(Duration.seconds(2), Duration.seconds(1))).toBe(true);
      expect(Duration.greaterThan(Duration.seconds(1), Duration.seconds(2))).toBe(false);
    });

    it("compares equality", () => {
      expect(Duration.equals(Duration.seconds(1), Duration.millis(1000))).toBe(true);
      expect(Duration.equals(Duration.seconds(1), Duration.seconds(2))).toBe(false);
    });

    it("gets minimum", () => {
      const result = Duration.min(Duration.seconds(5), Duration.seconds(2));
      expect(Duration.toMillis(result)).toBe(2000);
    });

    it("gets maximum", () => {
      const result = Duration.max(Duration.seconds(5), Duration.seconds(2));
      expect(Duration.toMillis(result)).toBe(5000);
    });

    it("clamps within range", () => {
      const value = Duration.seconds(10);
      const result = Duration.clamp(value, Duration.seconds(2), Duration.seconds(5));
      expect(Duration.toMillis(result)).toBe(5000);
    });
  });

  describe("predicates", () => {
    it("checks if zero", () => {
      expect(Duration.isZero(Duration.zero)).toBe(true);
      expect(Duration.isZero(Duration.seconds(1))).toBe(false);
    });

    it("checks if infinite", () => {
      expect(Duration.isInfinite(Duration.infinity)).toBe(true);
      expect(Duration.isInfinite(Duration.seconds(1))).toBe(false);
    });

    it("checks if finite", () => {
      expect(Duration.isFinite(Duration.seconds(1))).toBe(true);
      expect(Duration.isFinite(Duration.zero)).toBe(false);
      expect(Duration.isFinite(Duration.infinity)).toBe(false);
    });

    it("type guard works", () => {
      expect(Duration.isDuration(Duration.seconds(1))).toBe(true);
      expect(Duration.isDuration({ millis: 1000 })).toBe(false);
      expect(Duration.isDuration(null)).toBe(false);
      expect(Duration.isDuration(1000)).toBe(false);
    });
  });

  describe("formatting", () => {
    it("formats milliseconds only", () => {
      expect(Duration.format(Duration.millis(500))).toBe("500ms");
    });

    it("formats seconds", () => {
      expect(Duration.format(Duration.seconds(30))).toBe("30s");
    });

    it("formats minutes and seconds", () => {
      expect(Duration.format(Duration.seconds(90))).toBe("1m 30s");
    });

    it("formats hours", () => {
      expect(Duration.format(Duration.minutes(90))).toBe("1h 30m");
    });

    it("formats days", () => {
      expect(Duration.format(Duration.hours(36))).toBe("1d 12h");
    });

    it("formats zero", () => {
      expect(Duration.format(Duration.zero)).toBe("0ms");
    });

    it("formats infinity", () => {
      expect(Duration.format(Duration.infinity)).toBe("∞");
    });
  });

  describe("parsing", () => {
    it("parses milliseconds", () => {
      const d = Duration.parse("500ms");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(500);
    });

    it("parses seconds", () => {
      const d = Duration.parse("5s");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(5000);
    });

    it("parses minutes", () => {
      const d = Duration.parse("2m");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(120000);
    });

    it("parses hours", () => {
      const d = Duration.parse("1h");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(3600000);
    });

    it("parses days", () => {
      const d = Duration.parse("1d");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(86400000);
    });

    it("parses decimal values", () => {
      const d = Duration.parse("1.5s");
      expect(d).toBeDefined();
      expect(Duration.toMillis(d!)).toBe(1500);
    });

    it("returns undefined for invalid input", () => {
      expect(Duration.parse("invalid")).toBeUndefined();
      expect(Duration.parse("5")).toBeUndefined();
      expect(Duration.parse("")).toBeUndefined();
    });
  });
});
