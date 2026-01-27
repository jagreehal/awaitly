import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresPersistence } from "./index";
import { durable } from "awaitly/durable";
import { ok, err, type AsyncResult } from "awaitly";

const TEST_CONNECTION_STRING = process.env.TEST_POSTGRES_CONNECTION_STRING;
const shouldSkip = !TEST_CONNECTION_STRING && !process.env.CI;

describe.skipIf(shouldSkip)("Integration with durable.run", () => {
  it("should work with durable.run", async () => {
    const store = await createPostgresPersistence({
      connectionString: TEST_CONNECTION_STRING || "postgresql://test:test@localhost:5433/postgres",
      tableName: `test_integration_${Date.now()}`,
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
      async (step, { fetchUser, createOrder }) => {
        const user = await step(() => fetchUser("123"), { key: "fetch-user" });
        const order = await step(() => createOrder(user), { key: "create-order" });
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
    await (store as any).close?.();
  });
});
