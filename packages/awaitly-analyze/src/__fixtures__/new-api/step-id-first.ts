/**
 * Test fixture: New step('id', fn, opts) signature
 *
 * Tests analyzer extraction of:
 * - Step ID from first argument
 * - errors array from options
 * - out key for data flow
 * - ctx.ref() for read tracking
 */
import { createWorkflow, ok, err, type AsyncResult } from "awaitly";

// Mock dependencies with typed errors
const getCart = async (
  cartId: string
): AsyncResult<{ id: string; total: number; items: string[] }, "CART_NOT_FOUND" | "CART_EMPTY"> => {
  if (!cartId) return err("CART_NOT_FOUND");
  return ok({ id: cartId, total: 99.99, items: ["item1", "item2"] });
};

const chargeCard = async (
  amount: number
): AsyncResult<{ chargeId: string; amount: number }, "CARD_DECLINED" | "INSUFFICIENT_FUNDS"> => {
  if (amount <= 0) return err("CARD_DECLINED");
  return ok({ chargeId: "ch_123", amount });
};

const sendReceipt = async (
  userId: string,
  chargeId: string
): AsyncResult<{ sent: boolean }, "EMAIL_FAILED"> => {
  return ok({ sent: true });
};

// Workflow using new API
export const checkoutWorkflow = createWorkflow({
  id: 'checkout',
  deps: { getCart, chargeCard, sendReceipt },
});

export async function runCheckout(userId: string, cartId: string) {
  return await checkoutWorkflow(async (step, ctx) => {
    // Step with ID, errors, and out
    const cart = await step('getCart', () => ctx.deps.getCart(cartId), {
      errors: ['CART_NOT_FOUND', 'CART_EMPTY'],
      out: 'cart',
    });

    // Step using ctx.ref() for tracked reads
    const charge = await step('chargeCard', () => ctx.deps.chargeCard(ctx.ref('cart').total), {
      errors: ['CARD_DECLINED', 'INSUFFICIENT_FUNDS'],
      out: 'charge',
    });

    // Step with multiple ctx.ref() reads
    await step('sendReceipt', () => ctx.deps.sendReceipt(userId, ctx.ref('charge').chargeId), {
      errors: ['EMAIL_FAILED'],
    });

    return { cart, charge };
  });
}
