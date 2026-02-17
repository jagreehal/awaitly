/**
 * Payment workflow fixture for diagram tests.
 *
 * Target diagram style: Validate -> Check Existing -> Acquire Lock -> Call Provider (retry) -> Persist -> Return ID
 * with branches Valid/Invalid, Found/Not Found, and error exit nodes.
 */
import { createWorkflow } from "../../workflow";
import { ok } from "../../core";

const validateInput = async (_input: unknown) => ok({ valid: true });
const checkExisting = async (_input: unknown) => ok({ found: false as boolean });
const acquireLock = async (_input: unknown) => ok({ acquired: true });
const callProvider = async (_input: unknown) => ok({ id: "pay_1" });
const persistPayment = async (result: { id: string }) => ok({ id: result.id });

export const paymentWorkflow = createWorkflow("paymentWorkflow", {
  validateInput,
  checkExisting,
  acquireLock,
  callProvider,
  persistPayment,
});

export async function runPayment(input: unknown) {
  return await paymentWorkflow(async ({ step, deps }) => {
    await step("validate-input", () => deps.validateInput(input), {
      errors: ["ValidationError"],
      out: "validation",
    });
    if (step.if("valid", "Valid", () => true)) {
      const existing = await step("check-existing", () => deps.checkExisting(input), {
        errors: ["NotFound"],
        out: "existing",
      });
      if (step.if("found", "Found", () => existing.found)) {
        await step("return-existing-id", () => Promise.resolve(existing.id), {
          out: "paymentId",
        });
        return { paymentId: existing.id };
      }
      const lock = await step("acquire-lock", () => deps.acquireLock(input), {
        errors: ["IdempotencyConflict"],
        out: "lock",
      });
      if (!lock.acquired) return { error: "IdempotencyConflict" };
      const providerResult = await step.retry("call-provider", () => deps.callProvider(input), {
        attempts: 3,
        errors: ["ProviderRejected", "ProviderUnavailable"],
      });
      const persisted = await step("persist-payment", () => deps.persistPayment(providerResult), {
        errors: ["PersistError"],
        out: "payment",
      });
      await step("return-payment-id", () => Promise.resolve(persisted.id));
      return { paymentId: persisted.id };
    }
    return { error: "ValidationError" };
  });
}
