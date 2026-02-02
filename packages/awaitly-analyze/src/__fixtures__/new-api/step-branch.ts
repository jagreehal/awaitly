/**
 * Test fixture: step.branch() for explicit conditional metadata
 *
 * step.branch() provides explicit metadata for conditionals:
 * - conditionLabel for human-readable condition
 * - thenErrors/elseErrors for per-arm error tracking
 * - out for data flow
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const getCart = async (
  cartId: string
): AsyncResult<{ cartId: string; total: number }, "CART_NOT_FOUND"> => {
  return ok({ cartId, total: 100 });
};

const chargeCard = async (
  amount: number
): AsyncResult<{ chargeId: string; amount: number }, "CARD_DECLINED" | "INSUFFICIENT_FUNDS"> => {
  return ok({ chargeId: "ch_123", amount });
};

const skipPayment = async (): AsyncResult<{ skipped: true }, never> => {
  return ok({ skipped: true });
};

export const checkoutWorkflow = createWorkflow({
  id: 'checkout-with-branch',
  deps: { getCart, chargeCard, skipPayment },
});

export async function checkout(cartId: string) {
  return await checkoutWorkflow(async (step, ctx) => {
    const cart = await step('getCart', () => ctx.deps.getCart(cartId), {
      errors: ['CART_NOT_FOUND'],
      out: 'cart',
    });

    // Explicit conditional using step.branch()
    const charge = await step.branch('payment', {
      conditionLabel: 'cart.total > 0',
      condition: () => cart.total > 0,
      out: 'charge',
      then: () => ctx.deps.chargeCard(cart.total),
      thenErrors: ['CARD_DECLINED', 'INSUFFICIENT_FUNDS'],
      else: () => ctx.deps.skipPayment(),
      elseErrors: [],
    });

    return { cart, charge };
  });
}
