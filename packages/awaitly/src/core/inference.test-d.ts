import { expectType } from "tsd";
import {
  type AsyncResult,
  type Err,
  type Result,
  UnexpectedError,
  err,
  ok,
  run,
} from "../index";

type NotFound = { type: "NOT_FOUND"; id: string };
type Forbidden = { type: "FORBIDDEN"; actor: string };
type RateLimited = { type: "RATE_LIMITED"; retryAfterMs: number };

declare const raw: string;
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

/**
 * A step whose callback branches into two of the workflow's declared errors
 * must keep both lanes. `StepE` used to be inferred from the first `Err`
 * member of the callback's union, so the second branch failed to compile.
 */
async function inlineBranchErrorInference() {
  const result = await run<string, NotFound | Forbidden>(async ({ step }) => {
    return step("parse", async () => {
      if (raw === "") return err({ type: "NOT_FOUND", id: "u-1" } as NotFound);
      if (raw === "?") return err({ type: "FORBIDDEN", actor: "x" } as Forbidden);
      return ok(raw);
    });
  });

  expectType<Result<string, NotFound | Forbidden | UnexpectedError>>(result);
}

/**
 * The step helpers share the same lane-collapse: `StepE` came from the first
 * `Err` member of the callback's union. Each helper below branches into two of
 * the workflow's declared errors.
 */
const branchyList = async () => {
  if (raw === "") return err({ type: "NOT_FOUND", id: "u-1" } as NotFound);
  if (raw === "?") return err({ type: "FORBIDDEN", actor: "x" } as Forbidden);
  return ok([raw]);
};

async function stepAllBranchInference() {
  const result = await run<string[], NotFound | Forbidden>(async ({ step }) =>
    step.all("fan-out", branchyList)
  );

  expectType<Result<string[], NotFound | Forbidden | UnexpectedError>>(result);
}

const branchy = async () => {
  if (raw === "") return err({ type: "NOT_FOUND", id: "u-1" } as NotFound);
  if (raw === "?") return err({ type: "FORBIDDEN", actor: "x" } as Forbidden);
  return ok(raw);
};

async function stepRaceBranchInference() {
  const result = await run<string, NotFound | Forbidden>(async ({ step }) =>
    step.race("fastest", branchy)
  );

  expectType<Result<string, NotFound | Forbidden | UnexpectedError>>(result);
}

async function stepRetryBranchInference() {
  const result = await run<string, NotFound | Forbidden>(async ({ step }) =>
    step.retry("flaky", branchy, {
      attempts: 2,
      shouldRetry: (error) => error.type === "NOT_FOUND",
    })
  );

  expectType<Result<string, NotFound | Forbidden | UnexpectedError>>(result);
}

async function stepWithTimeoutBranchInference() {
  const result = await run<string, NotFound | Forbidden>(async ({ step }) =>
    step.withTimeout("slow", branchy, { ms: 100 })
  );

  expectType<Result<string, NotFound | Forbidden | UnexpectedError>>(result);
}

async function stepMapBranchInference() {
  const result = await run<string[], NotFound | Forbidden>(async ({ step }) =>
    step.map("each", ["a", "b"], async (item) => {
      if (item === "") return err({ type: "NOT_FOUND", id: item } as NotFound);
      if (item === "?") return err({ type: "FORBIDDEN", actor: item } as Forbidden);
      return ok(item.length);
    }).then((lengths) => lengths.map(String))
  );

  expectType<Result<string[], NotFound | Forbidden | UnexpectedError>>(result);
}

declare const messages: AsyncIterable<string>;

async function stepStreamForEachBranchInference() {
  const result = await run<number, NotFound | Forbidden>(async ({ step }) => {
    const outcome = await step.streamForEach(messages, async (message) => {
      if (message === "") return err({ type: "NOT_FOUND", id: message } as NotFound);
      if (message === "?")
        return err({ type: "FORBIDDEN", actor: message } as Forbidden);
      return ok(message.length);
    });
    return outcome.processedCount;
  });

  expectType<Result<number, NotFound | Forbidden | UnexpectedError>>(result);
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
void inlineBranchErrorInference;
void stepAllBranchInference;
void stepRaceBranchInference;
void stepRetryBranchInference;
void stepWithTimeoutBranchInference;
void stepMapBranchInference;
void stepStreamForEachBranchInference;
void voidInference;
