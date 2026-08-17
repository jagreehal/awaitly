import { expectType } from "tsd";
import { fromPromise, tryAsync } from "./index";
import type { Err, Ok } from "./index";

declare const foreign: PromiseLike<{ id: string }>;

async function assertions() {
  expectType<Ok<{ id: string }> | Err<unknown, unknown>>(
    await fromPromise(foreign)
  );
  expectType<Ok<{ id: string }> | Err<"FETCH_FAILED", unknown>>(
    await fromPromise(foreign, () => "FETCH_FAILED" as const)
  );
  expectType<Ok<{ id: string }> | Err<"FETCH_FAILED">>(
    await tryAsync(() => foreign, () => "FETCH_FAILED" as const)
  );
}

void assertions;
