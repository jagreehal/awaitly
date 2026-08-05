import { describe, expect, it } from "vitest";
import { deriveIdFromExpression } from "./derive-id";

describe("deriveIdFromExpression", () => {
  it("kebab-cases property access", () => {
    expect(deriveIdFromExpression("user.isPremium")).toBe("user-is-premium");
    expect(deriveIdFromExpression("order.items")).toBe("order-items");
    expect(deriveIdFromExpression("isReady")).toBe("is-ready");
  });

  it("renders comparison operators as words", () => {
    expect(deriveIdFromExpression("order.total > 100")).toBe("order-total-gt-100");
    expect(deriveIdFromExpression("count <= 5")).toBe("count-lte-5");
    expect(deriveIdFromExpression("status === 'paid'")).toBe("status-eq-paid");
    expect(deriveIdFromExpression("a !== b")).toBe("a-ne-b");
  });

  it("renders logical operators as words", () => {
    expect(deriveIdFromExpression("user.active && user.verified")).toBe(
      "user-active-and-user-verified"
    );
    expect(deriveIdFromExpression("a || b")).toBe("a-or-b");
  });

  it("encodes negation in every position, not just leading", () => {
    expect(deriveIdFromExpression("!user.verified")).toBe("not-user-verified");
    // Regression: a non-leading `!` used to be stripped, so `a && !b` and
    // `a && b` derived the same id and merged into one branch.
    expect(deriveIdFromExpression("a && !b")).toBe("a-and-not-b");
    expect(deriveIdFromExpression("a && !b")).not.toBe(deriveIdFromExpression("a && b"));
    expect(deriveIdFromExpression("!!user.verified")).not.toBe(
      deriveIdFromExpression("user.verified")
    );
  });

  it("keeps distinct operators distinct", () => {
    const ids = [
      "a || b", "a ?? b", "a && b",
      "a === b", "a !== b", "a == b", "a != b",
      "a > b", "a < b", "a >= b", "a <= b",
    ].map((e) => deriveIdFromExpression(e));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses operators it cannot encode losslessly", () => {
    // These would otherwise collapse into a separator and collide.
    expect(deriveIdFromExpression("count + 1 > 2")).toBeUndefined();
    expect(deriveIdFromExpression("a - b")).toBeUndefined();
    expect(deriveIdFromExpression("flags & MASK")).toBeUndefined();
    expect(deriveIdFromExpression("a ? b : c")).toBeUndefined();
    expect(deriveIdFromExpression("total * rate")).toBeUndefined();
  });

  it("is stable across formatting differences", () => {
    expect(deriveIdFromExpression("order.total>100")).toBe(
      deriveIdFromExpression("order.total  >  100")
    );
    expect(deriveIdFromExpression(" isReady ")).toBe(deriveIdFromExpression("isReady"));
  });

  it("distinguishes conditions that differ semantically", () => {
    expect(deriveIdFromExpression("a > b")).not.toBe(deriveIdFromExpression("a < b"));
    expect(deriveIdFromExpression("x")).not.toBe(deriveIdFromExpression("!x"));
  });

  it("refuses expressions whose identity is not readable from the text", () => {
    expect(deriveIdFromExpression("isPremium(user)")).toBeUndefined();
    expect(deriveIdFromExpression("items[i].ready")).toBeUndefined();
    expect(deriveIdFromExpression("`user-${id}`")).toBeUndefined();
    expect(deriveIdFromExpression("")).toBeUndefined();
    expect(deriveIdFromExpression("   ")).toBeUndefined();
    expect(deriveIdFromExpression("!!!")).toBeUndefined();
  });

  it("produces filename-safe ids and bounds their length", () => {
    const id = deriveIdFromExpression("a.veryLongPropertyName".repeat(12));
    expect(id).toBeDefined();
    expect(id!.length).toBeLessThanOrEqual(60);
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id!.endsWith("-")).toBe(false);
  });
});
