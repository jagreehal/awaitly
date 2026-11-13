import { expectType } from "tsd";
import { fromPromise, tryAsync } from "./index";
import type { Err, Ok } from "./index";

declare const foreign: PromiseLike<{ id: string }>;

async function assertions() {
  expectType<Ok<{ id: string }> | Err<unknown, unknown>>(
    await fromPromise(foreign)
  );
  expectType<Ok<{ id: string }> | Err<{ readonly type: "FETCH_FAILED" }, unknown>>(
    await fromPromise(foreign, () => ({ type: "FETCH_FAILED" }))
  );
  expectType<Ok<{ id: string }> | Err<{ readonly type: "FETCH_FAILED" }>>(
    await tryAsync(() => foreign, () => ({ type: "FETCH_FAILED" }))
  );
}

void assertions;
