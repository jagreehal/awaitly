/**
 * Kitchen-sink workflow for event capture testing.
 *
 * E-commerce "processOrder" pipeline with ~10 steps exercising:
 * sequential steps, step.parallel + allAsync, step.race + anyAsync,
 * trackIf, trackSwitch, step.retry, conditionals (when), and error paths.
 */

import { ok, err, anyAsync, type AsyncResult } from "awaitly/core";
import { createWorkflow } from "awaitly/workflow";
import type { WorkflowEvent } from "awaitly/workflow";
import { when } from "awaitly/conditional";
import {
  createVisualizer,
  createEventCollector,
  trackIf,
  trackSwitch,
  type CollectableEvent,
} from "../index";

// =============================================================================
// Mock Dependencies
// =============================================================================

export type CartItem = { id: string; name: string; price: number };
export type Cart = { id: string; items: CartItem[]; total: number };
export type OrderResult = { orderId: string; status: string };

let chargeCardAttempt = 0;

export function resetChargeCardAttempt(): void {
  chargeCardAttempt = 0;
}

const fetchCart = async (
  cartId: string
): AsyncResult<Cart, "CART_NOT_FOUND"> => {
  if (cartId === "missing") return err("CART_NOT_FOUND");
  return ok({
    id: cartId,
    items: [
      { id: "item-1", name: "Widget", price: 50 },
      { id: "item-2", name: "Gadget", price: 75 },
    ],
    total: 125,
  });
};

const checkInventory = async (
  _items: CartItem[]
): AsyncResult<boolean, "OUT_OF_STOCK"> => {
  return ok(true);
};

const checkFraud = async (
  _cartId: string
): AsyncResult<boolean, "FRAUD_DETECTED"> => {
  return ok(false);
};

const chargeCard = async (
  _amount: number
): AsyncResult<{ transactionId: string }, "CARD_DECLINED"> => {
  chargeCardAttempt++;
  if (chargeCardAttempt === 1) {
    return err("CARD_DECLINED");
  }
  return ok({ transactionId: "txn-123" });
};

const chargeWallet = async (
  _amount: number
): AsyncResult<{ transactionId: string }, "WALLET_ERROR"> => {
  return ok({ transactionId: "wallet-456" });
};

const chargeCrypto = async (
  _amount: number
): AsyncResult<{ transactionId: string }, "CRYPTO_ERROR"> => {
  return ok({ transactionId: "crypto-789" });
};

const getPrimaryShipping = async (): AsyncResult<
  { estimate: string; days: number },
  "SHIPPING_ERROR"
> => {
  await new Promise((r) => setTimeout(r, 5));
  return ok({ estimate: "3-5 days", days: 4 });
};

const getFallbackShipping = async (): AsyncResult<
  { estimate: string; days: number },
  "SHIPPING_ERROR"
> => {
  await new Promise((r) => setTimeout(r, 20));
  return ok({ estimate: "7-10 days", days: 8 });
};

const applyBundleDiscount = async (
  _cart: Cart
): AsyncResult<{ discount: number }, "DISCOUNT_ERROR"> => {
  return ok({ discount: 10 });
};

const reserveShipping = async (
  _cartId: string
): AsyncResult<{ reservationId: string }, "RESERVATION_ERROR"> => {
  return ok({ reservationId: "res-001" });
};

const sendEmail = async (
  _to: string
): AsyncResult<boolean, "EMAIL_ERROR"> => {
  return ok(true);
};

const sendPush = async (
  _userId: string
): AsyncResult<boolean, "PUSH_ERROR"> => {
  return ok(true);
};

const finalizeOrder = async (
  _cartId: string
): AsyncResult<OrderResult, "FINALIZE_ERROR"> => {
  return ok({ orderId: "order-001", status: "completed" });
};

// All mock deps
const deps = {
  fetchCart,
  checkInventory,
  checkFraud,
  chargeCard,
  chargeWallet,
  chargeCrypto,
  getPrimaryShipping,
  getFallbackShipping,
  applyBundleDiscount,
  reserveShipping,
  sendEmail,
  sendPush,
  finalizeOrder,
};

type Deps = typeof deps;

// =============================================================================
// Workflow Runners
// =============================================================================

export interface RunOptions {
  onEvent?: (event: WorkflowEvent<unknown>) => void;
  onDecisionEvent?: (event: CollectableEvent) => void;
}

/**
 * Run the processOrder workflow (happy path).
 * cartId defaults to "cart-1", paymentMethod defaults to "card".
 */
export async function runProcessOrder(
  args: { cartId?: string; paymentMethod?: string; singleItem?: boolean } = {},
  opts: RunOptions = {}
) {
  resetChargeCardAttempt();

  const { cartId = "cart-1", paymentMethod = "card", singleItem = false } = args;
  const decisionEvents: CollectableEvent[] = [];

  const onDecisionEvent = opts.onDecisionEvent ?? ((e: CollectableEvent) => decisionEvents.push(e));

  const workflow = createWorkflow("processOrder", deps, {
    onEvent: opts.onEvent,
  });

  const result = await workflow(async (step, deps, ctx) => {
    // Step 1: fetchCart (sequential)
    const cart = await step("fetchCart", () => deps.fetchCart(cartId));

    // Step 2: validateOrder (parallel: checkInventory + checkFraud)
    await step.parallel("validateOrder", {
      inventory: () => deps.checkInventory(cart.items),
      fraud: () => deps.checkFraud(cart.id),
    });

    // Step 3: isPremium? (trackIf)
    const isPremium = cart.total > 100;
    const premiumDecision = trackIf("isPremium", isPremium, {
      condition: "cart.total > 100",
      name: "Premium Check",
      workflowId: ctx.workflowId,
      emit: (e) => {
        onDecisionEvent(e);
      },
    });
    if (premiumDecision.condition) {
      premiumDecision.then();
    } else {
      premiumDecision.else();
    }
    premiumDecision.end();

    // Step 4: paymentMethod (trackSwitch)
    const switchDecision = trackSwitch("paymentMethod", paymentMethod, {
      name: "Payment Method",
      workflowId: ctx.workflowId,
      emit: (e) => {
        onDecisionEvent(e);
      },
    });
    switchDecision.case("card", paymentMethod === "card");
    switchDecision.case("wallet", paymentMethod === "wallet");
    switchDecision.case("crypto", paymentMethod === "crypto");
    switchDecision.end();

    // Step 5: chargeCard (with retry — fails once, succeeds on attempt 2)
    let payment: { transactionId: string };
    if (paymentMethod === "card") {
      payment = await step.retry("chargeCard", () => deps.chargeCard(cart.total), {
        attempts: 3,
        initialDelay: 1,
        jitter: false,
        backoff: "fixed",
      });
    } else if (paymentMethod === "wallet") {
      payment = await step("chargeWallet", () => deps.chargeWallet(cart.total));
    } else {
      payment = await step("chargeCrypto", () => deps.chargeCrypto(cart.total));
    }

    // Step 6: shippingEstimate (race: primary vs fallback)
    const shipping = await step.race("shippingEstimate", () =>
      anyAsync([
        deps.getPrimaryShipping(),
        deps.getFallbackShipping(),
      ]) as AsyncResult<{ estimate: string; days: number }, "SHIPPING_ERROR">
    );

    // Step 7: bundleDiscount (conditional — skipped for single-item carts)
    const multipleItems = !singleItem && cart.items.length > 1;
    const discount = await when(
      multipleItems,
      () => step("bundleDiscount", () => deps.applyBundleDiscount(cart)),
      { name: "bundleDiscount", key: "bundleDiscount", reason: "Single item cart" },
      { workflowId: ctx.workflowId, onEvent: ctx.onEvent },
    );

    // Step 8: reserveShipping (sequential)
    const reservation = await step("reserveShipping", () =>
      deps.reserveShipping(cart.id)
    );

    // Step 9: sendNotifications (parallel: email + push)
    await step.parallel("sendNotifications", {
      email: () => deps.sendEmail("user@example.com"),
      push: () => deps.sendPush("user-1"),
    });

    // Step 10: finalizeOrder (sequential)
    const order = await step("finalizeOrder", () =>
      deps.finalizeOrder(cart.id)
    );

    return {
      order,
      payment,
      shipping,
      discount,
      reservation,
    };
  });

  return { result, decisionEvents };
}

/**
 * Run the processOrder workflow with an error (cart not found at step 1).
 */
export async function runProcessOrderError(opts: RunOptions = {}) {
  return runProcessOrder({ cartId: "missing" }, opts);
}

/**
 * Run the processOrder workflow with hooks (shouldRun + onBeforeStart + onAfterStep).
 */
export async function runProcessOrderWithHooks(opts: RunOptions = {}) {
  resetChargeCardAttempt();

  const decisionEvents: CollectableEvent[] = [];
  const onDecisionEvent = opts.onDecisionEvent ?? ((e: CollectableEvent) => decisionEvents.push(e));

  const workflow = createWorkflow("processOrder", deps, {
    onEvent: opts.onEvent,
    shouldRun: () => true,
    onBeforeStart: () => true,
    onAfterStep: () => {},
  });

  const result = await workflow(async (step, deps, ctx) => {
    const cart = await step("fetchCart", () => deps.fetchCart("cart-1"), {
      key: "fetchCart",
    });

    // Simple 2-step workflow with hooks
    const isPremium = cart.total > 100;
    const premiumDecision = trackIf("isPremium", isPremium, {
      condition: "cart.total > 100",
      name: "Premium Check",
      workflowId: ctx.workflowId,
      emit: (e) => onDecisionEvent(e),
    });
    if (premiumDecision.condition) {
      premiumDecision.then();
    } else {
      premiumDecision.else();
    }
    premiumDecision.end();

    const order = await step("finalizeOrder", () =>
      deps.finalizeOrder(cart.id), {
        key: "finalizeOrder",
      }
    );

    return { order, cart };
  });

  return { result, decisionEvents };
}
