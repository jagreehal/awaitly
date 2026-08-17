import { describe, expect, it } from "vitest";
import { fromPromise, isErr, isOk, tryAsync } from "./index";

/**
 * Foreign thenables.
 *
 * A promise that crosses a realm boundary is not an instance of the local
 * `Promise`. React server components hand the client a promise built by the
 * framework, `node:vm` contexts have their own `Promise` constructor, and a
 * library may hand back its own thenable. `await` resolves all of them, so the
 * boundary helpers accept all of them.
 */

/** Stands in for a promise built somewhere the local `Promise` cannot reach. */
function foreignThenable<T>(value: T): PromiseLike<T> {
  return {
    then(onFulfilled) {
      return foreignThenable(onFulfilled ? onFulfilled(value) : (value as never));
    },
  };
}

function rejectingThenable(reason: unknown): PromiseLike<never> {
  return {
    then(_onFulfilled, onRejected) {
      if (!onRejected) throw reason;
      return foreignThenable(onRejected(reason)) as PromiseLike<never>;
    },
  };
}

describe("fromPromise", () => {
  it("resolves a thenable that is not a native Promise", async () => {
    const result = await fromPromise(foreignThenable({ id: "u1" }));

    expect(isOk(result) && result.value).toEqual({ id: "u1" });
  });

  it("maps a rejected thenable through the error function", async () => {
    const result = await fromPromise(rejectingThenable(new Error("boom")), () => "FETCH_FAILED" as const);

    expect(isErr(result) && result.error).toBe("FETCH_FAILED");
  });
});

describe("tryAsync", () => {
  it("resolves a function returning a thenable that is not a native Promise", async () => {
    const result = await tryAsync(() => foreignThenable(42));

    expect(isOk(result) && result.value).toBe(42);
  });
});
