/**
 * Tests verifying examples from the workflows.md documentation.
 * These tests ensure the documentation examples are accurate and work correctly.
 *
 */
import { describe, it, expect, vi } from "vitest";
import {
  ok,
  err,
  allAsync,
  allSettledAsync,
  anyAsync,
  type AsyncResult,
  isUnexpectedError,
} from "./index";
import { createWorkflow } from "./workflow-entry";
import {
  isPendingApproval,
  createApprovalStep,
  injectApproval,
} from "./hitl-entry";
import {
  createSagaWorkflow,
  isSagaCompensationError,
} from "./saga";
import {
  processInBatches,
  isBatchProcessingError,
  batchPresets,
} from "./batch";

// =============================================================================
// Type Definitions (matching the docs)
// =============================================================================

interface Payment {
  id: string;
  amount: number;
}

interface Reservation {
  id: string;
  items: CartItem[];
}

interface Order {
  id: string;
  userId: string;
  items: CartItem[];
  paymentId: string;
  reservationId: string;
}

interface CartItem {
  productId: string;
  quantity: number;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Post {
  id: string;
  title: string;
  userId: string;
}

// =============================================================================
// Section: Your First Workflow
// =============================================================================

describe("Workflows Documentation - Your First Workflow", () => {
  it("creates a basic workflow that composes Result-returning functions", async () => {
    // From docs: Define operations that return Results
    const chargePayment = async (
      args: { amount: number; method: string }
    ): AsyncResult<Payment, "PAYMENT_DECLINED" | "PAYMENT_ERROR"> => {
      if (args.method === "invalid") return err("PAYMENT_DECLINED");
      return ok({ id: "pay_123", amount: args.amount });
    };

    const reserveInventory = async (
      args: { items: CartItem[] }
    ): AsyncResult<Reservation, "OUT_OF_STOCK"> => {
      if (args.items.length === 0) return err("OUT_OF_STOCK");
      return ok({ id: "res_456", items: args.items });
    };

    const createOrder = async (
      args: { userId: string; payment: Payment; reservation: Reservation }
    ): AsyncResult<Order, "ORDER_CREATION_FAILED"> => {
      return ok({
        id: "order_789",
        userId: args.userId,
        items: args.reservation.items,
        paymentId: args.payment.id,
        reservationId: args.reservation.id,
      });
    };

    // From docs: Compose them with a workflow
    const checkout = createWorkflow({ chargePayment, reserveInventory, createOrder });

    const cartItems: CartItem[] = [{ productId: "prod_1", quantity: 2 }];
    const userId = "user_123";

    const result = await checkout(async (step, deps) => {
      // deps contains { chargePayment, reserveInventory, createOrder }
      const payment = await step('chargePayment', () => deps.chargePayment({ amount: 99, method: "card_xxx" }));
      const reservation = await step('reserveInventory', () => deps.reserveInventory({ items: cartItems }));
      const order = await step('createOrder', () => deps.createOrder({ userId, payment, reservation }));
      return order;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("order_789");
      expect(result.value.paymentId).toBe("pay_123");
      expect(result.value.reservationId).toBe("res_456");
    }
  });

  it("early exits on first error with typed error union", async () => {
    const chargePayment = async (): AsyncResult<Payment, "PAYMENT_DECLINED" | "PAYMENT_ERROR"> => {
      return err("PAYMENT_DECLINED");
    };

    const reserveInventory = vi.fn().mockResolvedValue(ok({ id: "res_456", items: [] }));
    const createOrder = vi.fn();

    const checkout = createWorkflow({ chargePayment, reserveInventory, createOrder });

    const result = await checkout(async (step, deps) => {
      const payment = await step('chargePayment', () => deps.chargePayment());
      // These should never be called because of early exit
      await step('reserveInventory', () => deps.reserveInventory({ items: [] }));
      await step('createOrder', () => deps.createOrder({ userId: "1", payment, reservation: { id: "", items: [] } }));
      return payment;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error type is automatically the union from all functions
      expect(result.error).toBe("PAYMENT_DECLINED");
    }

    // Verify early exit - later functions not called
    expect(reserveInventory).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("supports UnexpectedError for uncaught exceptions", async () => {
    const fetchData = async (): AsyncResult<string, "FETCH_ERROR"> => {
      throw new Error("Network timeout");
    };

    const workflow = createWorkflow({ fetchData });

    const result = await workflow(async (step, deps) => {
      return await step('fetchData', () => deps.fetchData());
    });

    expect(result.ok).toBe(false);
    if (!result.ok && isUnexpectedError(result.error)) {
      // UnexpectedError wraps uncaught exceptions
      expect(result.error.type).toBe("UNEXPECTED_ERROR");
    }
  });
});

// =============================================================================
// Section: When Failure Means Rollback - The Saga Pattern
// =============================================================================

describe("Workflows Documentation - Saga Pattern", () => {
  it("runs compensations in reverse order (LIFO) on failure", async () => {
    const compensationOrder: string[] = [];

    // Define operations
    const chargePayment = async (
      args: { amount: number; method: string }
    ): AsyncResult<Payment, "PAYMENT_ERROR"> => {
      return ok({ id: "pay_123", amount: args.amount });
    };

    const refundPayment = vi.fn().mockImplementation(async () => {
      compensationOrder.push("refund-payment");
    });

    const reserveInventory = async (
      args: { items: CartItem[] }
    ): AsyncResult<Reservation, "OUT_OF_STOCK"> => {
      return ok({ id: "res_456", items: args.items });
    };

    const releaseInventory = vi.fn().mockImplementation(async () => {
      compensationOrder.push("release-inventory");
    });

    const createOrder = async (): AsyncResult<Order, "ORDER_CREATION_FAILED"> => {
      return err("ORDER_CREATION_FAILED");
    };

    const cancelOrder = vi.fn();

    // From docs: Pass all operations to createSagaWorkflow
    const sagaCheckout = createSagaWorkflow({
      chargePayment,
      refundPayment,
      reserveInventory,
      releaseInventory,
      createOrder,
      cancelOrder,
    });

    const cartItems: CartItem[] = [{ productId: "prod_1", quantity: 1 }];

    const result = await sagaCheckout(async (saga, deps) => {
      // Step 1: Charge with compensation
      await saga.step(
        () => deps.chargePayment({ amount: 99, method: "card_xxx" }),
        {
          name: "charge-payment",
          compensate: (payment) => deps.refundPayment({ paymentId: payment.id }),
        }
      );

      // Step 2: Reserve inventory with compensation
      await saga.step(
        () => deps.reserveInventory({ items: cartItems }),
        {
          name: "reserve-inventory",
          compensate: (reservation) => deps.releaseInventory({ reservationId: reservation.id }),
        }
      );

      // Step 3: Create order with compensation (this will fail)
      const order = await saga.step(
        () => deps.createOrder(),
        {
          name: "create-order",
          compensate: (order) => deps.cancelOrder({ orderId: order.id }),
        }
      );

      return order;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ORDER_CREATION_FAILED");
    }

    // From docs: Compensation order (LIFO) - reverse order
    // 1. releaseInventory(reservation.id)
    // 2. refundPayment(payment.id)
    expect(compensationOrder).toEqual(["release-inventory", "refund-payment"]);
  });

  it("handles compensation errors with SagaCompensationError", async () => {
    const chargePayment = async (): AsyncResult<Payment, "PAYMENT_ERROR"> => {
      return ok({ id: "pay_123", amount: 99 });
    };

    const reserveInventory = async (): AsyncResult<Reservation, "RESERVE_ERROR"> => {
      return err("RESERVE_ERROR");
    };

    const saga = createSagaWorkflow({ chargePayment, reserveInventory });

    const result = await saga(async (ctx, deps) => {
      const payment = await ctx.step(
        "charge-payment",
        () => deps.chargePayment(),
        {
          compensate: async () => {
            throw new Error("Refund service unavailable");
          },
        }
      );

      await ctx.step('reserveInventory', () => deps.reserveInventory());

      return payment;
    });

    expect(result.ok).toBe(false);
    if (!result.ok && isSagaCompensationError(result.error)) {
      // From docs: Check for compensation errors
      expect(result.error.originalError).toBe("RESERVE_ERROR");
      expect(result.error.compensationErrors.length).toBe(1);
      expect(result.error.compensationErrors[0].stepName).toBe("charge-payment");
    }
  });

  it("does not require compensation for read operations", async () => {
    const fetchUser = async (args: { userId: string }): AsyncResult<User, "NOT_FOUND"> => {
      return ok({ id: args.userId, name: "Alice", email: "alice@example.com" });
    };

    const chargePayment = async (): AsyncResult<Payment, "PAYMENT_ERROR"> => {
      return ok({ id: "pay_123", amount: 99 });
    };

    const refundPayment = vi.fn();

    const saga = createSagaWorkflow({ fetchUser, chargePayment, refundPayment });

    const result = await saga(async (ctx, deps) => {
      // No compensation needed for reads
      const user = await ctx.step(
        () => deps.fetchUser({ userId: "user_1" }),
        { name: "fetch-user" }
      );

      // Needs compensation - creates state
      const payment = await ctx.step(
        () => deps.chargePayment(),
        {
          name: "charge-payment",
          compensate: (p) => deps.refundPayment({ paymentId: p.id }),
        }
      );

      return { user, payment };
    });

    expect(result.ok).toBe(true);
    // refundPayment not called because workflow succeeded
    expect(refundPayment).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Section: Multi-API Orchestration - Parallel Operations
// =============================================================================

describe("Workflows Documentation - Parallel Operations", () => {
  it("runs independent operations in parallel with allAsync", async () => {
    const callOrder: string[] = [];

    const fetchProfile = async (args: { userId: string }): AsyncResult<User, "PROFILE_ERROR"> => {
      callOrder.push("profile");
      return ok({ id: args.userId, name: "Alice", email: "alice@example.com" });
    };

    const fetchOrders = async (): AsyncResult<string[], "ORDERS_ERROR"> => {
      callOrder.push("orders");
      return ok(["order_1", "order_2"]);
    };

    const fetchRecommendations = async (): AsyncResult<string[], "RECS_ERROR"> => {
      callOrder.push("recs");
      return ok(["rec_1", "rec_2"]);
    };

    // From docs: loadDashboard pattern
    const loadDashboard = createWorkflow({ fetchProfile, fetchOrders, fetchRecommendations });

    const result = await loadDashboard(async (step, deps) => {
      const userId = "user_123";

      // Run all three in parallel - fail fast if any fails
      const [profile, orders, recs] = await step.fromResult(
        "fetchDashboardData",
        () =>
          allAsync([
            deps.fetchProfile({ userId }),
            deps.fetchOrders(),
            deps.fetchRecommendations(),
          ]),
        { onError: (): "PROFILE_ERROR" => "PROFILE_ERROR" }
      );

      return { profile, orders, recommendations: recs };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile.name).toBe("Alice");
      expect(result.value.orders).toHaveLength(2);
      expect(result.value.recommendations).toHaveLength(2);
    }
  });

  it("uses allSettledAsync to collect all errors (not partial success)", async () => {
    const fetchProfile = async (): AsyncResult<User, "PROFILE_ERROR"> => {
      return ok({ id: "1", name: "Alice", email: "alice@example.com" });
    };

    const fetchOrders = async (): AsyncResult<string[], "ORDERS_ERROR"> => {
      return err("ORDERS_ERROR"); // This fails
    };

    const fetchRecommendations = async (): AsyncResult<string[], "RECS_ERROR"> => {
      return ok(["rec_1"]);
    };

    // IMPORTANT API NOTE: allSettledAsync does NOT provide "partial success".
    // It returns err() if ANY input fails, collecting all errors.
    // This differs from Promise.allSettled() behavior.
    const results = await allSettledAsync([
      fetchProfile(),
      fetchOrders(),
      fetchRecommendations(),
    ]);

    // If any result fails, allSettledAsync returns err with collected errors
    expect(results.ok).toBe(false);
    if (!results.ok) {
      // result.error is an array of SettledError objects
      expect(Array.isArray(results.error)).toBe(true);
      expect(results.error.length).toBe(1); // One error from fetchOrders
      expect(results.error[0].error).toBe("ORDERS_ERROR");
    }
  });

  it("uses allSettledAsync - succeeds when all inputs succeed", async () => {
    const fetchProfile = async (): AsyncResult<User, "PROFILE_ERROR"> => {
      return ok({ id: "1", name: "Alice", email: "alice@example.com" });
    };

    const fetchOrders = async (): AsyncResult<string[], "ORDERS_ERROR"> => {
      return ok(["order_1", "order_2"]);
    };

    const fetchRecommendations = async (): AsyncResult<string[], "RECS_ERROR"> => {
      return ok(["rec_1"]);
    };

    // allSettledAsync returns ok() only when ALL inputs succeed
    const results = await allSettledAsync([
      fetchProfile(),
      fetchOrders(),
      fetchRecommendations(),
    ]);

    expect(results.ok).toBe(true);
    if (results.ok) {
      // results.value is the tuple of unwrapped values
      const [profile, orders, recs] = results.value;
      expect(profile.name).toBe("Alice");
      expect(orders).toEqual(["order_1", "order_2"]);
      expect(recs).toHaveLength(1);
    }
  });

  it("uses anyAsync for first success wins (failover)", async () => {
    const fetchFromPrimary = async (): AsyncResult<string, "PRIMARY_ERROR"> => {
      return err("PRIMARY_ERROR"); // Primary fails
    };

    const fetchFromBackup = async (): AsyncResult<string, "BACKUP_ERROR"> => {
      return ok("data from backup");
    };

    // From docs: anyAsync for failover
    const result = await anyAsync([
      fetchFromPrimary(),
      fetchFromBackup(),
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("data from backup");
    }
  });

  it("chains sequential then parallel operations", async () => {
    const fetchUser = async (args: { userId: string }): AsyncResult<User, "USER_ERROR"> => {
      return ok({ id: args.userId, name: "Alice", email: "alice@example.com" });
    };

    const fetchPosts = async (args: { userId: string }): AsyncResult<Post[], "POSTS_ERROR"> => {
      return ok([{ id: "1", title: "Hello", userId: args.userId }]);
    };

    const fetchFriends = async (): AsyncResult<string[], "FRIENDS_ERROR"> => {
      return ok(["friend_1", "friend_2"]);
    };

    const fetchSettings = async (): AsyncResult<Record<string, boolean>, "SETTINGS_ERROR"> => {
      return ok({ darkMode: true, notifications: false });
    };

    const userDashboard = createWorkflow({ fetchUser, fetchPosts, fetchFriends, fetchSettings });

    const result = await userDashboard(async (step, deps) => {
      // Fetch user first (sequential dependency)
      const user = await step('fetchUser', () => deps.fetchUser({ userId: "user_1" }));

      // Then fetch user's data in parallel (independent calls)
      const [posts, friends, settings] = await step.fromResult(
        "fetchUserData",
        () =>
          allAsync([
            deps.fetchPosts({ userId: user.id }),
            deps.fetchFriends(),
            deps.fetchSettings(),
          ]),
        { onError: (): "POSTS_ERROR" => "POSTS_ERROR" }
      );

      return { user, posts, friends, settings };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("Alice");
      expect(result.value.posts).toHaveLength(1);
      expect(result.value.friends).toHaveLength(2);
      expect(result.value.settings.darkMode).toBe(true);
    }
  });
});

// =============================================================================
// Section: Batch Processing at Scale
// =============================================================================

describe("Workflows Documentation - Batch Processing", () => {
  it("processes items in batches with progress tracking", async () => {
    const users = Array.from({ length: 50 }, (_, i) => ({ id: `user_${i}`, name: `User ${i}` }));
    const progressUpdates: number[] = [];

    const migrateUser = async (): AsyncResult<{ migrated: boolean }, "MIGRATION_FAILED"> => {
      return ok({ migrated: true });
    };

    const result = await processInBatches(
      users,
      async () => {
        return migrateUser();
      },
      {
        batchSize: 10,
        concurrency: 5,
        batchDelayMs: 10,
      },
      {
        onProgress: (progress) => {
          progressUpdates.push(progress.percent);
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(50);
    }

    // Should have 5 progress updates (50 items / 10 batch size = 5 batches)
    expect(progressUpdates).toHaveLength(5);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  it("stops on first error with BatchProcessingError details", async () => {
    const users = Array.from({ length: 20 }, (_, i) => ({ id: `user_${i}` }));

    const result = await processInBatches(
      users,
      async (_user, index): AsyncResult<{ migrated: boolean }, "MIGRATION_FAILED"> => {
        if (index === 15) {
          return err("MIGRATION_FAILED");
        }
        return ok({ migrated: true });
      },
      {
        batchSize: 20, // All in one batch
        concurrency: 1, // Sequential to ensure order
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok && isBatchProcessingError(result.error)) {
      // From docs: error includes context
      expect(result.error.itemIndex).toBe(15);
      expect(result.error.batchNumber).toBe(1);
      expect(result.error.error).toBe("MIGRATION_FAILED");
    }
  });

  it("uses preset configurations", async () => {
    const items = [1, 2, 3, 4, 5];

    // From docs: batchPresets.conservative
    const conservativeResult = await processInBatches(
      items,
      async (n) => ok(n * 2),
      batchPresets.conservative
    );

    expect(conservativeResult.ok).toBe(true);

    // Verify preset values
    expect(batchPresets.conservative.batchSize).toBe(20);
    expect(batchPresets.conservative.concurrency).toBe(3);
    expect(batchPresets.conservative.batchDelayMs).toBe(50);

    expect(batchPresets.balanced.batchSize).toBe(50);
    expect(batchPresets.balanced.concurrency).toBe(5);

    expect(batchPresets.aggressive.batchSize).toBe(100);
    expect(batchPresets.aggressive.concurrency).toBe(10);
  });

  it("calls afterBatch hook for checkpointing", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const checkpointCalls: number[] = [];

    const afterBatch = vi.fn().mockImplementation(async () => {
      checkpointCalls.push(Date.now());
      return ok(undefined);
    });

    const result = await processInBatches(
      items,
      async (n) => ok(n),
      { batchSize: 3, concurrency: 2 },
      { afterBatch }
    );

    expect(result.ok).toBe(true);
    // 10 items / 3 batch size = 4 batches (3, 3, 3, 1)
    expect(afterBatch).toHaveBeenCalledTimes(4);
  });
});

// =============================================================================
// Section: Human-in-the-Loop - Approval Workflows
// =============================================================================

describe("Workflows Documentation - Approval Workflows", () => {
  it("creates an approval step that returns pending status", async () => {
    // From docs: createApprovalStep usage
    const requireApproval = createApprovalStep<{ approvedBy: string }>({
      key: "refund-approval:refund_123",
      checkApproval: async () => {
        // Simulate checking a database - not approved yet
        return { status: "pending" };
      },
    });

    const calculateRefund = async (): AsyncResult<{ amount: number }, "CALC_ERROR"> => {
      return ok({ amount: 1500 });
    };

    // Include requireApproval in deps so its error types are part of the workflow's union
    const refundWorkflow = createWorkflow({ calculateRefund, requireApproval });

    const result = await refundWorkflow(
      async (step, deps) => {
        const refund = await step('calculateRefund', () => deps.calculateRefund());

        // Workflow pauses here until approved
        if (refund.amount > 1000) {
          const approval = await step('requireApproval', requireApproval, { key: "refund-approval:refund_123" });
          return { refund, approval };
        }

        return { refund, approval: null };
      }
    );

    // From docs: Check for pending approval
    expect(result.ok).toBe(false);
    if (!result.ok && isPendingApproval(result.error)) {
      expect(result.error.type).toBe("PENDING_APPROVAL");
      expect(result.error.stepKey).toBe("refund-approval:refund_123");
    }
  });

  it("allows injecting approvals for testing via resumeState", async () => {
    // Define the approval step first so we can include it in deps
    const requireApproval = createApprovalStep<{ approvedBy: string }>({
      key: "refund-approval:test-refund-123",
      checkApproval: async () => {
        return { status: "pending" }; // Would normally check DB
      },
    });

    const calculateRefund = async (): AsyncResult<{ amount: number }, "CALC_ERROR"> => {
      return ok({ amount: 1500 });
    };

    const processRefund = async (): AsyncResult<{ processed: boolean }, "PROCESS_ERROR"> => {
      return ok({ processed: true });
    };

    // From docs: Testing approval workflows with injected approvals
    // Use injectApproval() to add an approval to an empty resumeState
    const emptyState = { steps: new Map() };
    const resumeState = injectApproval(emptyState, {
      stepKey: "refund-approval:test-refund-123",
      value: { approvedBy: "test@test.com" },
    });

    // Include requireApproval in deps for type safety
    const refundWorkflow = createWorkflow({ calculateRefund, processRefund, requireApproval }, {
      resumeState,
    });

    const result = await refundWorkflow(async (step, deps) => {
      const refund = await step('calculateRefund', () => deps.calculateRefund());
      // The approval step uses cache from resumeState (key must match)
      // step() returns the unwrapped value directly, not a Result
      const approval = await step('requireApproval', requireApproval, { key: "refund-approval:test-refund-123" });
      const processed = await step('processRefund', () => deps.processRefund());
      return { refund, approval, processed };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.approval.approvedBy).toBe("test@test.com");
      expect(result.value.processed.processed).toBe(true);
    }
  });

  it("supports injecting approval into resume state", async () => {
    // Create empty initial state
    const initialState = { steps: new Map() };

    // From docs: injectApproval usage
    const updatedState = injectApproval(initialState, {
      stepKey: "refund-approval:refund_123",
      value: { approvedBy: "manager@company.com", timestamp: Date.now() },
    });

    // The state now has the approval
    expect(updatedState.steps.has("refund-approval:refund_123")).toBe(true);
    const entry = updatedState.steps.get("refund-approval:refund_123");
    expect(entry?.result.ok).toBe(true);
    if (entry?.result.ok) {
      const value = entry.result.value;
      if (value && typeof value === "object" && "approvedBy" in value) {
        expect(value.approvedBy).toBe("manager@company.com");
      }
    }
  });
});

// =============================================================================
// Section: Combining Patterns
// =============================================================================

describe("Workflows Documentation - Combining Patterns", () => {
  it("combines saga with parallel operations", async () => {
    const compensationOrder: string[] = [];

    const validateOrder = async (args: { orderId: string }): AsyncResult<{ id: string; items: CartItem[]; total: number }, "VALIDATION_ERROR"> => {
      return ok({ id: args.orderId, items: [{ productId: "p1", quantity: 1 }], total: 99 });
    };

    const reserveInventory = async (args: { items: CartItem[] }): AsyncResult<Reservation, "RESERVE_ERROR"> => {
      return ok({ id: "res_1", items: args.items });
    };

    const releaseInventory = vi.fn().mockImplementation(async () => {
      compensationOrder.push("release-inventory");
    });

    const chargePayment = async (args: { amount: number }): AsyncResult<Payment, "PAYMENT_ERROR"> => {
      return ok({ id: "pay_1", amount: args.amount });
    };

    const refundPayment = vi.fn().mockImplementation(async () => {
      compensationOrder.push("refund-payment");
    });

    const createShipment = async (): AsyncResult<{ id: string }, "SHIPMENT_ERROR"> => {
      return err("SHIPMENT_ERROR"); // This fails
    };

    const cancelShipment = vi.fn();

    const notifyCustomer = vi.fn().mockResolvedValue(ok(undefined));

    // From docs: Combining patterns
    const orderFulfillment = createSagaWorkflow({
      validateOrder,
      reserveInventory,
      releaseInventory,
      chargePayment,
      refundPayment,
      createShipment,
      cancelShipment,
      notifyCustomer,
    });

    const result = await orderFulfillment(async (saga, deps) => {
      // Validation (no compensation needed)
      const order = await saga.step(
        () => deps.validateOrder({ orderId: "order_1" }),
        { name: "validate-order" }
      );

      // Reserve inventory with compensation
      await saga.step(
        () => deps.reserveInventory({ items: order.items }),
        {
          name: "reserve-inventory",
          compensate: (r) => deps.releaseInventory({ reservationId: r.id }),
        }
      );

      // Charge payment with compensation
      const payment = await saga.step(
        () => deps.chargePayment({ amount: order.total }),
        {
          name: "charge-payment",
          compensate: (p) => deps.refundPayment({ paymentId: p.id }),
        }
      );

      // Create shipment with compensation (this will fail)
      const shipment = await saga.step(
        () => deps.createShipment(),
        {
          name: "create-shipment",
          compensate: (s) => deps.cancelShipment({ shipmentId: s.id }),
        }
      );

      // Notify customer (no compensation - can't un-send)
      await saga.step(
        () => deps.notifyCustomer({ email: "customer@example.com", shipment }),
        { name: "notify-customer" }
      );

      return { order, shipment, payment };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("SHIPMENT_ERROR");
    }

    // Compensations run in reverse order
    expect(compensationOrder).toEqual(["refund-payment", "release-inventory"]);
    // cancelShipment not called because shipment creation failed
    expect(cancelShipment).not.toHaveBeenCalled();
  });
});

// =============================================================================
// API Verification - Checking for discrepancies
// =============================================================================

describe("Workflows Documentation - API Verification", () => {
  it("verifies createWorkflow callback receives (step, deps, ctx)", async () => {
    const fetchData = async (): AsyncResult<number, "ERROR"> => ok(42);

    const workflow = createWorkflow({ fetchData });

    // Verify the callback signature
    const result = await workflow(async (step, deps, ctx) => {
      // step is the step function
      expect(typeof step).toBe("function");

      // deps contains the passed functions
      expect(deps.fetchData).toBe(fetchData);

      // ctx is the workflow context (always provided)
      expect(ctx).toBeDefined();
      expect(typeof ctx.workflowId).toBe("string");

      return await step('fetchData', () => deps.fetchData());
    });

    expect(result.ok).toBe(true);
  });

  it("verifies createSagaWorkflow callback receives (saga, deps)", async () => {
    const fetchData = async (): AsyncResult<number, "ERROR"> => ok(42);

    const saga = createSagaWorkflow({ fetchData });

    // Verify the callback signature
    const result = await saga(async (ctx, deps) => {
      // ctx has step method
      expect(typeof ctx.step).toBe("function");

      // deps contains the passed functions
      expect(deps.fetchData).toBe(fetchData);

      return await ctx.step('fetchData', () => deps.fetchData());
    });

    expect(result.ok).toBe(true);
  });

  it("verifies step() requires function wrapper (thunk)", async () => {
    const fetchData = async (): AsyncResult<number, "ERROR"> => ok(42);

    const workflow = createWorkflow({ fetchData });

    // step() requires a thunk (function wrapper)
    const result = await workflow(async (step, deps) => {
      // Form 1: Function wrapper (required form)
      const val1 = await step('fetchData1', () => deps.fetchData());

      // Form 2: Also function wrapper
      const val2 = await step('fetchData2', () => deps.fetchData());

      return val1 + val2;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(84);
    }
  });
});
