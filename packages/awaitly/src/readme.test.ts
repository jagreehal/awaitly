/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for all code examples in README.md
 * This file verifies that all code examples work correctly and pass type checking.
 */
import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult } from "./index";
import { createWorkflow, UNEXPECTED_ERROR } from "./workflow-entry";
import { createApprovalStep, isPendingApproval } from "./hitl-entry";
import { type WorkflowSnapshot } from "./persistence-entry";
import { run } from "./workflow-entry";

describe("README Examples", () => {
  describe("Results as Data", () => {
    it("should work as shown in README", async () => {
      type User = { id: string; name: string };
      type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };

      async function getUser(id: string): AsyncResult<User, UserNotFound> {
        if (id === "u-1") return ok({ id, name: "Alice" });
        return err({ type: "USER_NOT_FOUND", userId: id });
      }

      const result = await getUser("u-2");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.userId).toBe("u-2");
      }

      const successResult = await getUser("u-1");
      expect(successResult.ok).toBe(true);
      if (successResult.ok) {
        expect(successResult.value.name).toBe("Alice");
      }
    });
  });

  describe("run() — Simple Composition", () => {
    it("should work as shown in README", async () => {
      type Order = { id: string; userId: string; total: number };
      type Payment = { id: string };
      type OrderNotFound = { type: "ORDER_NOT_FOUND" };
      type UserNotFound = { type: "USER_NOT_FOUND" };
      type ChargeFailed = { type: "CHARGE_FAILED" };

      const getOrder = async (orderId: string): AsyncResult<Order, OrderNotFound> => {
        if (orderId === "order-1") return ok({ id: orderId, userId: "user-1", total: 100 });
        return err({ type: "ORDER_NOT_FOUND" });
      };

      const getUser = async (userId: string): AsyncResult<{ id: string }, UserNotFound> => {
        if (userId === "user-1") return ok({ id: userId });
        return err({ type: "USER_NOT_FOUND" });
      };

      const charge = async (total: number): AsyncResult<Payment, ChargeFailed> => {
        return ok({ id: "payment-123" });
      };

      const orderId = "order-1";
      const result = await run(async (step) => {
        const order = await step('getOrder', () => getOrder(orderId)); // unwraps ok, exits on err
        const user = await step('getUser', () => getUser(order.userId)); // same
        const payment = await step('charge', () => charge(order.total)); // same
        return payment;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("payment-123");
      }
    });
  });

  describe("UnexpectedError — The Safety Net", () => {
    it("should work as shown in README", async () => {
      const result = await run(async (step) => {
        // Simulate throwing code
        throw new Error("Something went wrong");
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(UNEXPECTED_ERROR);
        // Check that cause is defined
        expect(result.error.cause).toBeDefined();
      }
    });
  });

  describe("createWorkflow — Production API", () => {
    it("should work as shown in README", async () => {
      type User = { id: string; name: string };
      type Order = { id: string; userId: string };
      type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
      type OrderNotFound = { type: "ORDER_NOT_FOUND"; orderId: string };

      const deps = {
        getUser: async (id: string): AsyncResult<User, UserNotFound> => {
          if (id === "user-1") return ok({ id, name: "Alice" });
          return err({ type: "USER_NOT_FOUND", userId: id });
        },
        getOrder: async (id: string): AsyncResult<Order, OrderNotFound> => {
          if (id === "order-1") return ok({ id, userId: "user-1" });
          return err({ type: "ORDER_NOT_FOUND", orderId: id });
        },
      };

      const workflow = createWorkflow(deps);

      const userId = "user-1";
      const orderId = "order-1";
      const result = await workflow(async (step, deps) => {
        const user = await step('getUser', () => deps.getUser(userId));
        const order = await step('getOrder', () => deps.getOrder(orderId));
        return { user, order };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.name).toBe("Alice");
        expect(result.value.order.id).toBe("order-1");
      }
    });
  });

  describe("Quickstart example", () => {
    it("should work as shown in README", async () => {
      type Task = { id: string };
      type TaskNotFound = { type: "TASK_NOT_FOUND"; id: string };

      // 1. Define dependencies that return Results
      const deps = {
        loadTask: async (id: string): AsyncResult<Task, TaskNotFound> => {
          if (id === "t-1") return ok({ id });
          return err({ type: "TASK_NOT_FOUND", id });
        },
      };

      // 2. Create and run a workflow
      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        return await step('loadTask', () => deps.loadTask("t-1"));
      });

      // 3. Handle the result
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("t-1");
      }
    });
  });

  describe("Money transfer example (with workflow)", () => {
    it("should work as shown in README", async () => {
      type User = { id: string; balance: number };
      type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
      type InsufficientFunds = { type: "INSUFFICIENT_FUNDS"; required: number; available: number };
      type TransferFailed = { type: "TRANSFER_FAILED"; reason: string };

      const deps = {
        getUser: async (userId: string): AsyncResult<User, UserNotFound> => {
          if (userId === "unknown") return err({ type: "USER_NOT_FOUND", userId });
          return ok({ id: userId, balance: 1000 });
        },

        validateBalance: (user: User, amount: number): AsyncResult<void, InsufficientFunds> => {
          if (user.balance < amount) {
            return err({ type: "INSUFFICIENT_FUNDS", required: amount, available: user.balance });
          }
          return ok(undefined);
        },

        executeTransfer: async (): AsyncResult<{ transactionId: string }, TransferFailed> => {
          return ok({ transactionId: "tx-12345" });
        },
      };

      const transfer = createWorkflow(deps);

      // In an HTTP handler
      async function handler(fromUserId: string, toUserId: string, amount: number) {
        const result = await transfer(async (step, deps) => {
          const fromUser = await step('getFromUser', () => deps.getUser(fromUserId));
          const toUser = await step('getToUser', () => deps.getUser(toUserId));
          await step('validateBalance', () => deps.validateBalance(fromUser, amount));
          return await step('executeTransfer', () => deps.executeTransfer());
        });

        // TypeScript knows ALL possible errors - map them to HTTP responses
        if (result.ok) return { statusCode: 200, body: result.value };

        switch (result.error.type) {
          case "USER_NOT_FOUND":
            return { statusCode: 404, body: { message: "User not found", userId: result.error.userId } };
          case "INSUFFICIENT_FUNDS":
            return { statusCode: 400, body: result.error };
          case "TRANSFER_FAILED":
          case UNEXPECTED_ERROR:
            return { statusCode: 500, body: { message: "Internal error" } };
        }
      }

      const response = await handler("user1", "user2", 100);
      expect(response.statusCode).toBe(200);
      if (response.statusCode === 200) {
        expect(response.body.transactionId).toBe("tx-12345");
      }
    });
  });

  describe("Mapping errors at the boundary", () => {
    it("should work as shown in README", async () => {
      type TaskNotFound = { type: "TASK_NOT_FOUND"; id: string };

      const deps = {
        loadTask: async (id: string): AsyncResult<{ id: string }, TaskNotFound> => {
          if (id === "t-1") return ok({ id });
          return err({ type: "TASK_NOT_FOUND", id });
        },
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        return await step('loadTask', () => deps.loadTask("missing"));
      });

      // In an HTTP handler
      if (result.ok) {
        expect.fail("Should have failed");
      } else {
        switch (result.error.type) {
          case "TASK_NOT_FOUND":
            expect(result.error.id).toBe("missing");
            break;

          case UNEXPECTED_ERROR:
            // Log the cause for debugging (it's the original thrown error)
            expect(result.error.cause).toBeDefined();
            break;

          default:
            expect.fail("Unexpected error type");
        }
      }
    });
  });

  describe("Built-in Reliability", () => {
    it("should work with retry as shown in README", async () => {
      const deps = {
        loadTask: async (id: string): AsyncResult<{ id: string }, { type: "ERROR" }> => {
          return ok({ id });
        },
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        // Retry 3 times with exponential backoff, timeout after 5 seconds
        const task = await step.retry(
          "loadTask",
          () => deps.loadTask("t-1"),
          { attempts: 3, backoff: "exponential", timeout: { ms: 5000 } }
        );
        return task;
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("Smart Caching", () => {
    it("should work with caching as shown in README", async () => {
      const chargeCard = async (amount: number): AsyncResult<{ id: string }, never> => {
        return ok({ id: `charge-${Date.now()}` });
      };

      const saveToDatabase = async (charge: { id: string }): AsyncResult<void, never> => {
        return ok(undefined);
      };

      const processPayment = createWorkflow({ chargeCard, saveToDatabase });

      const order = { idempotencyKey: "key-123" };
      const amount = 100;

      const result = await processPayment(async (step, deps) => {
        // If the workflow crashes after charging but before saving,
        // the next run skips the charge - it's already cached.
        const charge = await step('chargeCard', () => deps.chargeCard(amount), {
          key: `charge:${order.idempotencyKey}`,
        });

        await step('saveToDatabase', () => deps.saveToDatabase(charge), {
          key: `save:${charge.id}`,
        });

        return charge;
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("Save & Resume - Save to database", () => {
    it("should work with getSnapshot as shown in README (new API)", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string }, never> => {
        return ok({ id });
      };

      const workflow = createWorkflow({ fetchUser });

      await workflow(async (step, deps) => {
        await step('fetchUser', () => deps.fetchUser("1"), { key: "user:1" });
      });

      // Get snapshot and serialize to JSON (new API)
      const workflowId = "123";
      const snapshot = workflow.getSnapshot();
      const json = JSON.stringify(snapshot);

      expect(json).toBeDefined();
      expect(typeof json).toBe("string");
      expect(snapshot.formatVersion).toBe(1);
      expect(snapshot.steps["user:1"]).toBeDefined();

      // Save to your database (simulated)
      const dbRecord = {
        id: workflowId,
        state: json,
        createdAt: new Date(),
      };

      expect(dbRecord.id).toBe("123");
      expect(dbRecord.state).toBe(json);
    });
  });

  describe("Save & Resume - Step 3: Resume from saved state", () => {
    it("should work with snapshot option as shown in README (new API)", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, never> => {
        return ok({ id, name: "Alice" });
      };

      const fetchPosts = async (userId: string): AsyncResult<Array<{ id: string }>, never> => {
        return ok([{ id: "post-1" }]);
      };

      // First run - execute workflow
      const workflow1 = createWorkflow({ fetchUser, fetchPosts });

      await workflow1(async (step, deps) => {
        await step('fetchUser', () => deps.fetchUser("1"), { key: "user:1" });
        await step('fetchPosts', () => deps.fetchPosts("1"), { key: "posts:1" });
      });

      // Get snapshot and serialize (new API)
      const snapshot = workflow1.getSnapshot();
      const json = JSON.stringify(snapshot);

      // Load from database and parse
      const saved = { state: json }; // Simulated database record
      const loadedSnapshot = JSON.parse(saved.state) as WorkflowSnapshot;

      // Resume workflow with snapshot option (new API)
      const workflow2 = createWorkflow({ fetchUser, fetchPosts }, {
        snapshot: loadedSnapshot, // Pre-populates cache from saved snapshot
      });

      const result = await workflow2(async (step, deps) => {
        const user = await step('fetchUser', () => deps.fetchUser("1"), { key: "user:1" }); // Cache hit
        const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), { key: `posts:${user.id}` }); // Cache hit
        return { user, posts };
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("Human-in-the-Loop", () => {
    it("should work with createApprovalStep as shown in README", async () => {
      // Mock database
      const approvalStatuses = new Map<string, { status: string; value?: unknown }>();

      const requireApproval = createApprovalStep({
        key: "approve:refund",
        checkApproval: async () => {
          const status = approvalStatuses.get("refund_123");
          return status ? { status: "approved" as const, value: status } : { status: "pending" as const };
        },
      });

      const calculateRefund = async (orderId: string): AsyncResult<{ amount: number }, never> => {
        return ok({ amount: 100 });
      };

      const processRefund = async (
        refund: { amount: number },
        approval: unknown
      ): AsyncResult<{ id: string }, never> => {
        return ok({ id: "refund-123" });
      };

      const refundWorkflow = createWorkflow({ calculateRefund, processRefund, requireApproval });

      // First run - should be pending
      const result1 = await refundWorkflow(async (step, deps) => {
        const refund = await step('calculateRefund', () => deps.calculateRefund("order-123"));

        // Workflow pauses here until someone approves
        const approval = await step('requireApproval', () => requireApproval(), { key: "approve:refund" });

        return await step('processRefund', () => deps.processRefund(refund, approval));
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok && isPendingApproval(result1.error)) {
        // Notify Slack, send email, etc.
        // Later: injectApproval(savedState, { stepKey, value })
        expect(result1.error.stepKey).toBe("approve:refund");
      }

      // Simulate approval
      approvalStatuses.set("refund_123", { status: "approved", value: { approvedBy: "admin" } });

      // Second run - should succeed
      const result2 = await refundWorkflow(async (step, deps) => {
        const refund = await step('calculateRefund', () => deps.calculateRefund("order-123"));
        const approval = await step('requireApproval', () => requireApproval(), { key: "approve:refund" });
        return await step('processRefund', () => deps.processRefund(refund, approval));
      });

      expect(result2.ok).toBe(true);
    });
  });

  describe("Common Patterns", () => {
    it("should work with step.try as shown in README", async () => {
      const workflow = createWorkflow({});
      const result = await workflow(async (step) => {
        // Wrap throwing code
        const data = await step.try("httpFetch", () => Promise.resolve({ foo: "bar" }), { error: "HTTP_FAILED" as const });
        return data;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.foo).toBe("bar");
      }
    });

    it("should work with step.retry as shown in README", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string }, never> => {
        return ok({ id });
      };

      const workflow = createWorkflow({ fetchUser });
      const result = await workflow(async (step, deps) => {
        // Retries with backoff
        const user = await step.retry("fetchUser", () => deps.fetchUser("id"), { attempts: 3, backoff: "exponential" });
        return user;
      });

      expect(result.ok).toBe(true);
    });

    it("should work with step.withTimeout as shown in README", async () => {
      const slowOperation = async (): AsyncResult<string, never> => {
        return ok("done");
      };

      const workflow = createWorkflow({ slowOperation });
      const result = await workflow(async (step, deps) => {
        // Timeout protection
        const result = await step.withTimeout("slowOperation", () => deps.slowOperation(), { ms: 5000 });
        return result;
      });

      expect(result.ok).toBe(true);
    });

    it("should work with caching as shown in README", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string }, never> => {
        return ok({ id });
      };

      const workflow = createWorkflow({ fetchUser });
      const result = await workflow(async (step, deps) => {
        // Caching (use thunk + key)
        const user = await step('fetchUser', () => deps.fetchUser("id"), { key: "user:id" });
        return user;
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("run() - Advanced usage", () => {
    it("should work as shown in README", async () => {
      type Output = { id: string; name: string };
      
      const fetchUser = async (userId: string): AsyncResult<Output, "NOT_FOUND" | "FETCH_ERROR"> => {
        if (userId === "user-123") {
          return ok({ id: userId, name: "Alice" });
        }
        if (userId === "error") {
          return err("FETCH_ERROR");
        }
        return err("NOT_FOUND");
      };

      const userId = "user-123";
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      const result = await run<Output, "NOT_FOUND" | "FETCH_ERROR">(
        async (step) => {
          const user = await step('fetchUser', () => fetchUser(userId)); // thunk for consistency
          return user;
        },
        { onError: (e) => console.log("Failed:", e) }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("user-123");
        expect(result.value.name).toBe("Alice");
      }
      
      consoleSpy.mockRestore();
    });
  });

  describe("Imports", () => {
    it("should work with basic imports as shown in README", async () => {
      // Most apps only need:
      // import { ok, err, type AsyncResult } from "awaitly";
      // import { createWorkflow, UNEXPECTED_ERROR } from "awaitly/workflow";

      type User = { id: string };
      type UserNotFound = { type: "USER_NOT_FOUND" };

      const deps = {
        getUser: async (id: string): AsyncResult<User, UserNotFound> => {
          return ok({ id });
        },
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        return await step('getUser', () => deps.getUser("1"));
      });

      expect(result.ok).toBe(true);
      // UNEXPECTED_ERROR is a constant string
      expect(UNEXPECTED_ERROR).toBe("UNEXPECTED_ERROR");
    });
  });
});
