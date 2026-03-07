/**
 * Showcase: linear steps only.
 * Analyzer produces a simple sequence: Start → step1 → step2 → step3 → End.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

interface User {
  id: string;
  name: string;
}
interface Order {
  id: string;
}

const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> =>
  ok({ id, name: "Alice" });
const fetchOrders = async (userId: string): AsyncResult<Order[], "FETCH_ERROR"> =>
  ok([{ id: "1" }]);
const sendEmail = async (_userId: string): AsyncResult<void, "SEND_ERROR"> => ok(undefined);

export const linearWorkflow = createWorkflow("linearWorkflow", {
  fetchUser,
  fetchOrders,
  sendEmail,
});

export async function runLinear(userId: string): Promise<{ user: User; orders: Order[] }> {
  return await linearWorkflow.run(
    async ({ step, deps }): Promise<{ user: User; orders: Order[] }> => {
      const user = await step("getUser", () => deps.fetchUser(userId), { errors: ["NOT_FOUND"] });
      const orders = await step("getOrders", () => deps.fetchOrders(user.id), { errors: ["FETCH_ERROR"] });
      await step("notify", () => deps.sendEmail(user.id), { errors: ["SEND_ERROR"] });
      return { user, orders };
    }
  );
}
