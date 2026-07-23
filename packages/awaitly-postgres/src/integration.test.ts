import { describe, it, expect, beforeAll } from "vitest";
import { postgres } from "./index";
import { durable } from "awaitly/durable";
import { ok, err, type AsyncResult } from "awaitly";
import type { WorkflowSnapshot } from "awaitly/persistence";

const TEST_CONNECTION_STRING = process.env.TEST_POSTGRES_CONNECTION_STRING ??
  (process.env.CI ? "postgresql://postgres:postgres@localhost:5432/test_awaitly" : undefined);
const shouldSkip = !TEST_CONNECTION_STRING && !process.env.CI;

describe.skipIf(shouldSkip)("Integration with durable.run", () => {
  let postgresAvailable = false;

  beforeAll(async () => {
    try {
      const store = postgres({
        url: TEST_CONNECTION_STRING!,
        table: `test_integration_ping_${Date.now()}`,
      });
      const minimalSnapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: { status: "completed", lastUpdated: new Date().toISOString() },
      };
      await store.save("ping", minimalSnapshot);
      await store.delete("ping");
      await store.close();
      postgresAvailable = true;
    } catch {
      postgresAvailable = false;
    }
  });

  it.skipIf(() => !postgresAvailable)("should work with durable.run", async () => {
    const store = postgres({
      url: TEST_CONNECTION_STRING || "postgresql://postgres:postgres@localhost:5432/test_awaitly",
      table: `test_integration_${Date.now()}`,
    });

    // Define a simple workflow
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
      if (id === "123") {
        return ok({ id: "123", name: "Alice" });
      }
      return err("NOT_FOUND");
    };

    const createOrder = async (user: { id: string; name: string }): AsyncResult<{ id: string; userId: string }, "EMPTY"> => {
      return ok({ id: "order-1", userId: user.id });
    };

    // Run workflow
    const result1 = await durable.run(
      { fetchUser, createOrder },
      async ({ step, deps: { fetchUser, createOrder } }) => {
        const user = await step("fetch-user", () => fetchUser("123"));
        const order = await step("create-order", () => createOrder(user));
        return order;
      },
      {
        id: `test-workflow-${Date.now()}`,
        store,
      }
    );

    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.value.id).toBe("order-1");
    }

    // Clean up
    await store.close();
  });
});
