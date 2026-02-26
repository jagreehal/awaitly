/**
 * Showcase: when(), unless(), whenOr(), unlessOr()
 * Renders as conditional nodes with true/false branches.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";
import { when, unless, whenOr, unlessOr } from "awaitly/conditional";

const audit = async (): AsyncResult<boolean, "AUDIT_FAILED"> => ok(true);
const compute = async (): AsyncResult<number, "COMPUTE_ERROR"> => ok(99);

export const conditionalWorkflow = createWorkflow("conditionalWorkflow", { audit, compute });

export async function runConditional(isPremium: boolean) {
  return await conditionalWorkflow.run(async ({ step, deps }) => {
    await when(isPremium, () => step("whenStep", () => deps.audit()));
    await unless(isPremium, () => step("unlessStep", () => deps.compute()));
    const a = await whenOr(isPremium, () => step("whenOrStep", () => deps.audit()), false);
    const b = await unlessOr(isPremium, () => step("unlessOrStep", () => deps.compute()), 0);
    return { a, b };
  });
}
