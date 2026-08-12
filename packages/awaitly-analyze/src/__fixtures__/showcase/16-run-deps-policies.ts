/**
 * Showcase: dependency-first run() with policy wrappers.
 * The analyzer reads bound steps, inferred errors, and the retry/timeout chain.
 */
import { ok, retry, run, timeout, type AsyncResult } from "awaitly";

interface User {
  id: string;
  name: string;
}

interface Order {
  id: string;
  total: number;
}

const getUser = async (id: string): AsyncResult<User, "USER_NOT_FOUND"> =>
  ok({ id, name: "Alice" });

const getOrders = async (userId: string): AsyncResult<Order[], "ORDERS_UNAVAILABLE"> =>
  ok([{ id: `order-${userId}`, total: 99 }]);

export const result = await run(
  {
    getUser,
    getOrders: retry(timeout(getOrders, 2_000), {
      attempts: 3,
      delay: 100,
      backoff: "exponential",
    }),
  },
  async (steps) => {
    const user = await steps.getUser("user-1");
    const orders = await steps.getOrders(user.id);
    return { user, orders };
  },
);
