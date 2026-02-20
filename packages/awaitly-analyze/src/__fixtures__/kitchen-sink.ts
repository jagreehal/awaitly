/**
 * Kitchen-sink fixture for static analysis integration testing.
 *
 * Exercises every IR node type and step variant the analyzer recognizes.
 * This file is type-checked against the real awaitly API via tsconfig.fixtures.json.
 *
 * Some patterns use @ts-expect-error where the analyzer's expected AST pattern
 * differs from the current runtime API — documenting intentional drift.
 */
import {
  ok,
  allAsync,
  allSettledAsync,
  anyAsync,
  type AsyncResult,
} from "awaitly";
import { createWorkflow } from "awaitly/workflow";
import { when, unless, whenOr, unlessOr } from "awaitly/conditional";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

const fetchUser = async (
  id: string
): AsyncResult<
  { id: string; name: string; isPremium: boolean; role: string },
  "NOT_FOUND"
> => {
  return ok({ id, name: "Alice", isPremium: true, role: "admin" });
};

const fetchPosts = async (
  _userId: string
): AsyncResult<Array<{ id: string; title: string }>, "FETCH_ERROR"> => {
  return ok([{ id: "1", title: "Hello" }]);
};

const fetchFriends = async (
  _userId: string
): AsyncResult<string[], "FETCH_ERROR"> => {
  return ok(["bob", "carol"]);
};

const riskyOp = async (): AsyncResult<number, "RISKY_ERROR"> => {
  return ok(42);
};

const computeValue = async (): AsyncResult<number, "COMPUTE_ERROR"> => {
  return ok(99);
};

const chargeCard = async (
  _amount: number
): AsyncResult<{ chargeId: string }, "CARD_DECLINED"> => {
  return ok({ chargeId: "ch_1" });
};

const fetchFromCacheA = async (): AsyncResult<string, "CACHE_MISS"> => {
  return ok("a");
};

const fetchFromCacheB = async (): AsyncResult<string, "CACHE_MISS"> => {
  return ok("b");
};

const processItem = async (
  _item: string
): AsyncResult<string, "PROCESS_ERROR"> => {
  return ok("done");
};

const auditAdmin = async (): AsyncResult<boolean, "AUDIT_FAILED"> => {
  return ok(true);
};

const cleanup = async (): AsyncResult<void, never> => {
  return ok(undefined);
};

const enrichUser = async (
  _id: string
): AsyncResult<{ enriched: true }, "ENRICH_ERROR"> => {
  return ok({ enriched: true });
};

// ---------------------------------------------------------------------------
// Secondary workflow (used for workflow-ref detection)
// ---------------------------------------------------------------------------

export const otherWorkflow = createWorkflow("otherWorkflow", {
  enrichUser,
});

// ---------------------------------------------------------------------------
// Main kitchen-sink workflow
// ---------------------------------------------------------------------------

export const kitchenSink = createWorkflow("kitchenSink", {
  fetchUser,
  fetchPosts,
  fetchFriends,
  riskyOp,
  computeValue,
  chargeCard,
  fetchFromCacheA,
  fetchFromCacheB,
  processItem,
  auditAdmin,
  cleanup,
});

export async function runKitchenSink(userId: string) {
  return await kitchenSink.run(async ({ step, deps }) => {
    // -----------------------------------------------------------------------
    // 1. Basic step with key, out, errors
    // -----------------------------------------------------------------------
    const user = await step("fetch-user", () => deps.fetchUser(userId), {
      key: "user",
      // @ts-expect-error out option type not generic in step overload
      out: "user",
      errors: ["NOT_FOUND"],
    });

    // -----------------------------------------------------------------------
    // 2. step.sleep
    // -----------------------------------------------------------------------
    await step.sleep("pause", "500ms");

    // -----------------------------------------------------------------------
    // 3. step.try
    // -----------------------------------------------------------------------
    await step.try("try-risky", () => {
      if (Math.random() > 0.5) throw new Error("boom");
      return 1;
    }, { error: "RISKY_ERROR" as const });

    // -----------------------------------------------------------------------
    // 4. step.fromResult
    // -----------------------------------------------------------------------
    await step.fromResult("from-result", () => deps.riskyOp(), {
      error: "RISKY_ERROR" as const,
    });

    // -----------------------------------------------------------------------
    // 5. step.retry
    // -----------------------------------------------------------------------
    await step.retry("retry-fetch", () => deps.fetchPosts(user.id), {
      attempts: 3,
      backoff: "exponential",
    });

    // -----------------------------------------------------------------------
    // 6. step.withTimeout
    // -----------------------------------------------------------------------
    await step.withTimeout("timed-fetch", () => deps.fetchFriends(user.id), {
      ms: 5000,
    });

    // -----------------------------------------------------------------------
    // 7. step.dep
    // -----------------------------------------------------------------------
    await step(
      "dep-step",
      step.dep("userService", () => deps.fetchUser(userId))
    );

    // -----------------------------------------------------------------------
    // 8. step.parallel (object form)
    // -----------------------------------------------------------------------
    await step.parallel("fetch-parallel", {
      posts: () => deps.fetchPosts(user.id),
      friends: () => deps.fetchFriends(user.id),
    });

    // -----------------------------------------------------------------------
    // 9. allAsync — analyzer recognizes top-level allAsync([step(), ...])
    // -----------------------------------------------------------------------
    await allAsync([
      deps.fetchFromCacheA(),
      deps.fetchFromCacheB(),
    ]);

    // -----------------------------------------------------------------------
    // 10. allSettledAsync
    // -----------------------------------------------------------------------
    await allSettledAsync([
      deps.fetchFromCacheA(),
      deps.fetchFromCacheB(),
    ]);

    // -----------------------------------------------------------------------
    // 11. step.race (array form) — analyzer AST pattern
    // @ts-expect-error Analyzer expects step.race([...]) but runtime API is step.race(name, op)
    // -----------------------------------------------------------------------
    await step.race([
      () => deps.fetchFromCacheA(),
      () => deps.fetchFromCacheB(),
    ]);

    // -----------------------------------------------------------------------
    // 12. step.race (object form) — analyzer AST pattern
    // @ts-expect-error Analyzer expects step.race({...}) but runtime API is step.race(name, op)
    // -----------------------------------------------------------------------
    await step.race({
      cacheA: () => deps.fetchFromCacheA(),
      cacheB: () => deps.fetchFromCacheB(),
    });

    // -----------------------------------------------------------------------
    // 13. anyAsync
    // -----------------------------------------------------------------------
    await anyAsync([
      deps.fetchFromCacheA(),
      deps.fetchFromCacheB(),
    ]);

    // -----------------------------------------------------------------------
    // 14. step.if
    // -----------------------------------------------------------------------
    if (step.if("premium-check", "user.isPremium", () => user.isPremium)) {
      await step("premium-action", () => deps.auditAdmin());
    } else {
      await step("free-action", () => deps.computeValue());
    }

    // -----------------------------------------------------------------------
    // 15. step.label
    // -----------------------------------------------------------------------
    if (step.label("role-check", "user.role === admin", () => user.role === "admin")) {
      await step("admin-action", () => deps.auditAdmin());
    }

    // -----------------------------------------------------------------------
    // 16. step.branch
    // -----------------------------------------------------------------------
    await step.branch("payment", {
      conditionLabel: "cart.total > 0",
      condition: () => true,
      then: () => deps.chargeCard(100),
      thenErrors: ["CARD_DECLINED"],
      else: () => ok({ chargeId: "free" }),
      elseErrors: [],
    });

    // -----------------------------------------------------------------------
    // 17. Plain if/else (conditional, helper=null)
    // -----------------------------------------------------------------------
    if (user.isPremium) {
      await step("if-premium", () => deps.auditAdmin());
    } else {
      await step("if-free", () => deps.computeValue());
    }

    // -----------------------------------------------------------------------
    // 18. when
    // -----------------------------------------------------------------------
    await when(user.isPremium, () =>
      step("when-step", () => deps.auditAdmin())
    );

    // -----------------------------------------------------------------------
    // 19. unless
    // -----------------------------------------------------------------------
    await unless(user.isPremium, () =>
      step("unless-step", () => deps.computeValue())
    );

    // -----------------------------------------------------------------------
    // 20. whenOr
    // -----------------------------------------------------------------------
    const whenOrVal = await whenOr(
      user.isPremium,
      () => step("when-or-step", () => deps.auditAdmin()),
      false
    );

    // -----------------------------------------------------------------------
    // 21. unlessOr
    // -----------------------------------------------------------------------
    const unlessOrVal = await unlessOr(
      user.isPremium,
      () => step("unless-or-step", () => deps.computeValue()),
      0
    );

    // -----------------------------------------------------------------------
    // 22. switch
    // -----------------------------------------------------------------------
    switch (user.role) {
      case "admin":
        await step("switch-admin", () => deps.auditAdmin());
        break;
      case "user":
        await step("switch-user", () => deps.computeValue());
        break;
      default:
        await step("switch-default", () => deps.cleanup());
        break;
    }

    // -----------------------------------------------------------------------
    // 23. for loop
    // -----------------------------------------------------------------------
    for (let i = 0; i < 3; i++) {
      await step("for-step", () => deps.processItem(String(i)));
    }

    // -----------------------------------------------------------------------
    // 24. for...of loop
    // -----------------------------------------------------------------------
    const items = ["a", "b", "c"];
    for (const item of items) {
      await step("for-of-step", () => deps.processItem(item));
    }

    // -----------------------------------------------------------------------
    // 25. for...in loop
    // -----------------------------------------------------------------------
    const obj = { x: 1, y: 2 };
    for (const key in obj) {
      await step("for-in-step", () => deps.processItem(key));
    }

    // -----------------------------------------------------------------------
    // 26. while loop
    // -----------------------------------------------------------------------
    let counter = 0;
    while (counter < 3) {
      await step("while-step", () => deps.processItem(String(counter)));
      counter++;
    }

    // -----------------------------------------------------------------------
    // 27. step.forEach (run form)
    // -----------------------------------------------------------------------
    await step.forEach("foreach-run", items, {
      run: (item) => deps.processItem(item),
    });

    // -----------------------------------------------------------------------
    // 28. step.forEach (item form)
    // -----------------------------------------------------------------------
    await step.forEach("foreach-item", items, {
      item: step.item((item: string, i: number, s) => {
        s("foreach-inner", () => deps.processItem(item));
      }),
    });

    // -----------------------------------------------------------------------
    // 29. step.getWritable — analyzer extracts namespace from string first arg
    // @ts-expect-error Analyzer expects step.getWritable('ns') but runtime takes options object
    // -----------------------------------------------------------------------
    const writer = step.getWritable("progress");

    // -----------------------------------------------------------------------
    // 30. step.getReadable — analyzer extracts namespace from string first arg
    // @ts-expect-error Analyzer expects step.getReadable('ns') but runtime takes options object
    // -----------------------------------------------------------------------
    const reader = step.getReadable("data");

    // -----------------------------------------------------------------------
    // 31. step.streamForEach — analyzer extracts namespace from string first arg
    // @ts-expect-error Analyzer expects step.streamForEach('ns', fn) but runtime takes reader
    // -----------------------------------------------------------------------
    await step.streamForEach("events", async (item: string) => {
      await step("stream-process", () => deps.processItem(item));
      return ok(item);
    });

    // -----------------------------------------------------------------------
    // 32. try/catch/finally
    // -----------------------------------------------------------------------
    try {
      await step("try-step", () => deps.riskyOp());
    } catch {
      await step("catch-step", () => deps.cleanup());
    } finally {
      await step("finally-step", () => deps.cleanup());
    }

    // -----------------------------------------------------------------------
    // 33. Promise.all with steps
    // -----------------------------------------------------------------------
    await Promise.all([
      step("promise-all-a", () => deps.fetchFromCacheA()),
      step("promise-all-b", () => deps.fetchFromCacheB()),
    ]);

    // -----------------------------------------------------------------------
    // 34. .map with step
    // -----------------------------------------------------------------------
    const mapped = items.map((item) =>
      step("map-step", () => deps.processItem(item))
    );

    // -----------------------------------------------------------------------
    // 35. Ternary with steps
    // -----------------------------------------------------------------------
    const ternaryResult = user.isPremium
      ? await step("ternary-true", () => deps.auditAdmin())
      : await step("ternary-false", () => deps.computeValue());

    // -----------------------------------------------------------------------
    // 36. Workflow ref (call another workflow)
    // -----------------------------------------------------------------------
    const enriched = await otherWorkflow.run(async ({ step: s, deps: d }) => {
      return await s("enrich", () => d.enrichUser(user.id));
    });

    return { user, enriched, whenOrVal, unlessOrVal, ternaryResult, writer, reader, mapped };
  });
}
