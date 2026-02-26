/**
 * Showcase: linear steps only.
 * Analyzer produces a simple sequence: Start → step1 → step2 → step3 → End.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
  ok({ id, name: "Alice" });
const fetchOrders = async (userId: string): AsyncResult<Array<{ id: string }>, "FETCH_ERROR"> =>
  ok([{ id: "1" }]);
const sendEmail = async (_userId: string): AsyncResult<void, "SEND_ERROR"> => ok(undefined);

export const linearWorkflow = createWorkflow("linearWorkflow", {
  fetchUser,
  fetchOrders,
  sendEmail,
});

export async function runLinear(userId: string) {
  return await linearWorkflow.run(async ({ step, deps }) => {
    const user = await step("getUser", () => deps.fetchUser(userId), { errors: ["NOT_FOUND"] });
    const orders = await step("getOrders", () => deps.fetchOrders(user.id), { errors: ["FETCH_ERROR"] });
    await step("notify", () => deps.sendEmail(user.id), { errors: ["SEND_ERROR"] });
    return { user, orders };
  });
}
