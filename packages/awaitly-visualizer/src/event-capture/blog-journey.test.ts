/**
 * Blog journey tests: minimal checkout workflow used in the "Visualising
 * Awaitly Workflows with awaitly-visualizer" post. Code here matches the
 * snippets in the post so they are copy-paste accurate.
 */

import { describe, it, expect } from "vitest";
import { ok, err, type AsyncResult } from "awaitly/core";
import { createWorkflow } from "awaitly/workflow";
import type { WorkflowEvent } from "awaitly/workflow";
import {
  createVisualizer,
  createEventCollector,
  combineEventHandlers,
} from "../index";

// =============================================================================
// Minimal checkout deps (same as blog post)
// =============================================================================

type Cart = { id: string; itemCount: number; totalCents: number };

const fetchCart = async (
  cartId: string
): AsyncResult<Cart, "CART_NOT_FOUND"> => {
  if (cartId === "missing") return err("CART_NOT_FOUND");
  return ok({
    id: cartId,
    itemCount: 2,
    totalCents: 5999,
  });
};

const validateCart = async (
  cart: Cart
): AsyncResult<boolean, "INVALID_CART"> => {
  if (cart.itemCount < 1) return err("INVALID_CART");
  return ok(true);
};

const processPayment = async (
  cart: Cart
): AsyncResult<{ transactionId: string }, "PAYMENT_FAILED"> => {
  return ok({ transactionId: "txn-123" });
};

const completeOrder = async (
  cartId: string
): AsyncResult<{ orderId: string }, "COMPLETE_ERROR"> => {
  return ok({ orderId: `order-${cartId}` });
};

const deps = {
  fetchCart,
  validateCart,
  processPayment,
  completeOrder,
};

// =============================================================================
// Workflow runner (same shape as blog: checkout with four steps)
// =============================================================================

async function runCheckout(
  cartId: string,
  opts: {
    onEvent?: (event: WorkflowEvent<unknown>) => void;
  } = {}
) {
  const workflow = createWorkflow("checkout", deps, {
    onEvent: opts.onEvent,
  });

  return workflow(async (step, { fetchCart, validateCart, processPayment, completeOrder }) => {
    const cart = await step("fetchCart", () => fetchCart(cartId));
    await step("validateCart", () => validateCart(cart));
    const payment = await step("processPayment", () => processPayment(cart));
    const order = await step("completeOrder", () => completeOrder(cart.id));
    return { cart, payment, order };
  });
}

// =============================================================================
// Tests: createVisualizer, createEventCollector, combineEventHandlers
// =============================================================================

describe("blog-journey: checkout workflow and visualisation", () => {
  it("createVisualizer: run workflow, render contains workflow name and step names", async () => {
    const viz = createVisualizer({
      workflowName: "checkout",
      detectParallel: false,
    });

    const result = await runCheckout("cart-1", {
      onEvent: viz.handleEvent,
    });

    expect(result.ok).toBe(true);

    const output = viz.render();
    expect(output).toContain("checkout");
    expect(output).toContain("fetchCart");
    expect(output).toContain("validateCart");
    expect(output).toContain("processPayment");
    expect(output).toContain("completeOrder");

    if (process.env.PRINT_BLOG_OUTPUT === "1") {
      console.log("\n=== ASCII (viz.render()) ===\n");
      console.log(viz.render());
      console.log("\n=== Mermaid (viz.renderAs('mermaid')) ===\n");
      console.log(viz.renderAs("mermaid"));
    }
  });

  it("createVisualizer: error path (CART_NOT_FOUND) for blog post", async () => {
    const viz = createVisualizer({
      workflowName: "checkout",
      detectParallel: false,
    });

    const result = await runCheckout("missing", {
      onEvent: viz.handleEvent,
    });

    expect(result.ok).toBe(false);

    if (process.env.PRINT_BLOG_OUTPUT === "1") {
      console.log("\n=== ASCII error path (viz.render()) ===\n");
      console.log(viz.render());
      console.log("\n=== Mermaid error path (viz.renderAs('mermaid')) ===\n");
      console.log(viz.renderAs("mermaid"));
    }
  });

  it("createVisualizer: renderAs('mermaid') contains flowchart and steps", async () => {
    const viz = createVisualizer({
      workflowName: "checkout",
      detectParallel: false,
    });

    await runCheckout("cart-1", { onEvent: viz.handleEvent });

    const mermaid = viz.renderAs("mermaid");
    expect(mermaid).toContain("flowchart");
    expect(mermaid).toContain("fetchCart");
    expect(mermaid).toContain("completeOrder");
  });

  it("createEventCollector: visualize() contains workflow name and key steps", async () => {
    const collector = createEventCollector({
      workflowName: "checkout",
      detectParallel: false,
    });

    await runCheckout("cart-1", {
      onEvent: collector.handleEvent,
    });

    const output = collector.visualize();
    expect(output).toContain("checkout");
    expect(output).toContain("fetchCart");
    expect(output).toContain("validateCart");
    expect(output).toContain("processPayment");
    expect(output).toContain("completeOrder");
  });

  it("createEventCollector: visualizeAs('mermaid') produces mermaid output", async () => {
    const collector = createEventCollector({
      workflowName: "checkout",
      detectParallel: false,
    });

    await runCheckout("cart-1", {
      onEvent: collector.handleEvent,
    });

    const mermaid = collector.visualizeAs("mermaid");
    expect(mermaid).toContain("flowchart");
    expect(mermaid).toContain("fetchCart");
  });

  it("combineEventHandlers: viz and collector both receive events", async () => {
    const viz = createVisualizer({
      workflowName: "checkout",
      detectParallel: false,
    });
    const collectedEvents: WorkflowEvent<unknown>[] = [];

    const combined = combineEventHandlers(
      viz.handleEvent,
      (e: WorkflowEvent<unknown>) => collectedEvents.push(e)
    );

    await runCheckout("cart-1", { onEvent: combined });

    const vizOutput = viz.render();
    expect(vizOutput).toContain("checkout");
    expect(vizOutput).toContain("fetchCart");

    expect(collectedEvents.length).toBeGreaterThan(0);
    expect(collectedEvents[0].type).toBe("workflow_start");
  });
});
