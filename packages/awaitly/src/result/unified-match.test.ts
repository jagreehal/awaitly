/**
 * The unified match: one function for every error shape.
 *
 * Canonical error model — `type` is the discriminant everywhere:
 * - string literals are unit variants and match themselves
 * - tagged objects match on `type`
 * - TaggedError instances match on `type` (with `_tag` as deprecated alias)
 * The two-arm { ok, err } form remains as the catch-all.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { err, match, ok, type Result } from "./index";
import { TaggedError } from "../tagged-error";
import { retry, run, timeout } from "../index";
import type { AsyncResult } from "../index";

type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
type ChargeDeclined = { type: "CHARGE_DECLINED"; reason: string };

describe("unified match — per-type arms", () => {
  it("matches tagged-object errors on type, exhaustively", () => {
    const r: Result<number, UserNotFound | ChargeDeclined> = err({
      type: "CHARGE_DECLINED",
      reason: "limit",
    });

    const out = match(r, {
      ok: (v) => `value:${v}`,
      USER_NOT_FOUND: (e) => `missing:${e.userId}`,
      CHARGE_DECLINED: (e) => `declined:${e.reason}`,
    });

    expect(out).toBe("declined:limit");
  });

  it("matches string-literal errors as unit variants", () => {
    const r: Result<number, "NOT_FOUND" | "FORBIDDEN"> = err("NOT_FOUND");

    const out = match(r, {
      ok: (v) => `value:${v}`,
      NOT_FOUND: (e) => {
        expectTypeOf(e).toEqualTypeOf<"NOT_FOUND">();
        return "missing";
      },
      FORBIDDEN: () => "denied",
    });

    expect(out).toBe("missing");
  });

  it("matches TaggedError instances on the canonical type discriminant", () => {
    class DbDown extends TaggedError("DB_DOWN", {
      message: (p: { host: string }) => `db down: ${p.host}`,
    }) {}

    const r: Result<number, InstanceType<typeof DbDown>> = err(new DbDown({ host: "pg-1" }));

    const out = match(r, {
      ok: (v) => `value:${v}`,
      DB_DOWN: (e) => `db:${e.host}`,
    });

    expect(out).toBe("db:pg-1");
    // the canonical discriminant and the deprecated alias agree
    if (!r.ok) {
      expect(r.error.type).toBe("DB_DOWN");
      expect(r.error._tag).toBe("DB_DOWN");
    }
  });

  it("handles mixed unions (string + object) — one dispatch", () => {
    type E = "TIMEOUT" | UserNotFound;
    const cases: Array<[Result<number, E>, string]> = [
      [err("TIMEOUT"), "timed-out"],
      [err({ type: "USER_NOT_FOUND", userId: "u-9" }), "missing:u-9"],
      [ok(7), "value:7"],
    ];

    for (const [r, expected] of cases) {
      const out = match(r, {
        ok: (v) => `value:${v}`,
        TIMEOUT: () => "timed-out",
        USER_NOT_FOUND: (e) => `missing:${(e as UserNotFound).userId}`,
      });
      expect(out).toBe(expected);
    }
  });

  it("keeps the two-arm catch-all form working (including curried)", () => {
    const r: Result<number, UserNotFound> = err({ type: "USER_NOT_FOUND", userId: "u-1" });

    expect(match(r, { ok: (v) => v, err: (e) => e.userId })).toBe("u-1");

    const toStatus = match<number, UserNotFound, unknown, number>({
      ok: () => 200,
      err: () => 404,
    });
    expect(toStatus(r)).toBe(404);
    expect(toStatus(ok(1))).toBe(200);
  });

  it("throws loudly when a runtime error has no handler (unsound cast)", () => {
    const r = err({ type: "SURPRISE" }) as unknown as Result<number, UserNotFound>;
    expect(() =>
      match(r, {
        ok: () => "ok",
        USER_NOT_FOUND: () => "missing",
      })
    ).toThrow(/no handler for error type "SURPRISE"/);
  });

  it("is the railway terminus for run(deps, fn) — one expression, all exits named", async () => {
    const getUser = async (id: string): AsyncResult<{ id: string }, UserNotFound> =>
      id === "u-1" ? ok({ id }) : err({ type: "USER_NOT_FOUND", userId: id });
    const charge = async (amount: number): AsyncResult<{ txId: string }, ChargeDeclined> =>
      amount <= 500 ? ok({ txId: "t1" }) : err({ type: "CHARGE_DECLINED", reason: "limit" });

    const result = await run(
      { getUser, charge: retry(timeout(charge, 1000), { attempts: 2 }) },
      async (s) => {
        const user = await s.getUser("u-1");
        return s.charge(user.id.length * 1000); // 4000 > 500 → declined
      }
    );

    const http = match(result, {
      ok: (v) => ({ status: 200 as const, body: v }),
      USER_NOT_FOUND: (e) => ({ status: 404 as const, body: e.userId }),
      CHARGE_DECLINED: (e) => ({ status: 402 as const, body: e.reason }),
      TimeoutError: () => ({ status: 504 as const, body: "timeout" }),
      UnexpectedError: () => ({ status: 500 as const, body: "internal" }),
    });

    expect(http).toEqual({ status: 402, body: "limit" });
  });
});
