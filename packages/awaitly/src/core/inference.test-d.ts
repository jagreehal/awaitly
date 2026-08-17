import { expectType } from "tsd";
import {
  type AsyncResult,
  type Err,
  type Result,
  UnexpectedError,
  ok,
  run,
} from "../index";

type NotFound = { type: "NOT_FOUND"; id: string };
type Forbidden = { type: "FORBIDDEN"; actor: string };
type RateLimited = { type: "RATE_LIMITED"; retryAfterMs: number };

declare const findUser: (
  id: string
) => AsyncResult<{ id: string; teamId: string }, NotFound>;
declare const checkAccess: (
  teamId: string
) => AsyncResult<{ teamId: string }, Forbidden>;
declare const loadQuota: (
  teamId: string
) => AsyncResult<number, RateLimited>;

async function dependencyInference() {
  const result = await run(
    { findUser, checkAccess, loadQuota },
    async (steps) => {
      const user = await steps.findUser("u-1");
      const access = await steps.checkAccess(user.teamId);
      return steps.loadQuota(access.teamId);
    }
  );

  expectType<
    Result<number, NotFound | Forbidden | RateLimited | UnexpectedError>
  >(result);
}

async function controlFlowInference() {
  const loop = await run({ findUser, loadQuota }, async (steps) => {
    let total = 0;
    for (const id of ["u-1", "u-2"]) {
      const user = await steps.findUser(id);
      total += await steps.loadQuota(user.teamId);
    }
    return total;
  });
  expectType<Result<number, NotFound | RateLimited | UnexpectedError>>(loop);

  const branch = await run({ findUser, checkAccess }, async (steps) => {
    const user = await steps.findUser("u-1");
    return user.teamId === "t-1"
      ? (await steps.checkAccess(user.teamId)).teamId
      : user.teamId;
  });
  expectType<Result<string, NotFound | Forbidden | UnexpectedError>>(branch);
}

async function earlyReturnInference() {
  async function loadTeam(
    id: string
  ): AsyncResult<string, NotFound | Forbidden> {
    const user = await findUser(id);
    if (!user.ok) {
      expectType<Err<NotFound>>(user);
      return user;
    }
    return ok(user.value.teamId);
  }

  expectType<Result<string, NotFound | Forbidden>>(await loadTeam("u-1"));
}

async function voidInference() {
  const revoke = async (_id: string): AsyncResult<void, Forbidden> => ok();
  const result = await run({ revoke }, async (steps) => {
    await steps.revoke("u-1");
  });

  expectType<Result<void, Forbidden | UnexpectedError>>(result);
}

void dependencyInference;
void controlFlowInference;
void earlyReturnInference;
void voidInference;
