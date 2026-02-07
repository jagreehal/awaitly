/**
 * Test fixture: tags() helper for error declarations
 *
 * Tests analyzer extraction of:
 * - tags() calls that define error arrays
 * - Same-module const resolution
 * - Error aggregation across steps
 */
import { createWorkflow, ok, err, tags, type AsyncResult } from "awaitly";

// Error tags defined with tags() helper
const cartErrors = tags('CART_NOT_FOUND', 'CART_EMPTY');
const paymentErrors = tags('CARD_DECLINED', 'INSUFFICIENT_FUNDS', 'PAYMENT_TIMEOUT');

const getCart = async (
  cartId: string
): AsyncResult<{ id: string; total: number }, "CART_NOT_FOUND" | "CART_EMPTY"> => {
  return ok({ id: cartId, total: 100 });
};

const processPayment = async (
  amount: number
): AsyncResult<{ transactionId: string }, "CARD_DECLINED" | "INSUFFICIENT_FUNDS" | "PAYMENT_TIMEOUT"> => {
  return ok({ transactionId: "txn_123" });
};

const sendConfirmation = async (
  email: string
): AsyncResult<{ sent: boolean }, "EMAIL_FAILED"> => {
  return ok({ sent: true });
};

export const orderWorkflow = createWorkflow("orderWorkflow", {
  getCart,
  processPayment,
  sendConfirmation,
});

export async function processOrder(cartId: string, email: string) {
  return await orderWorkflow(async (step, deps) => {
    // Using tags() const for errors
    const cart = await step('getCart', () => deps.getCart(cartId), {
      errors: cartErrors,
      out: 'cart',
    });

    // Using tags() const for errors
    const payment = await step('processPayment', () => deps.processPayment(cart.total), {
      errors: paymentErrors,
      out: 'payment',
    });

    // Inline errors array
    await step('sendConfirmation', () => deps.sendConfirmation(email), {
      errors: ['EMAIL_FAILED'],
    });

    return { cart, payment };
  });
}
