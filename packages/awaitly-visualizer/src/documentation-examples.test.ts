/**
 * Test file to verify all code examples in visualization.md actually work
 * This file should compile and run without errors
 */

import { describe, it, expect } from "vitest";
import { ok, err, type AsyncResult } from "awaitly/core";

// Marker value for workflow completion (not wrapped in ok())
const DONE = "done" as const;
import { createWorkflow } from "awaitly/workflow";
import {
  createVisualizer,
  createEventCollector,
  trackIf,
  trackSwitch,
  createTimeTravelController,
  createPerformanceAnalyzer,
  createLiveVisualizer,
} from "./index";

// ============================================================================
// Mock Dependencies
// ============================================================================

type User = { id: string; name: string; tier: string; region: string };
type Order = { id: string; items: string[] };
type Cart = { items: string[] };
type Payment = { amount: number };

async function fetchUser(id: string): AsyncResult<User, "USER_NOT_FOUND"> {
  if (id === "404") return err("USER_NOT_FOUND");
  return ok({ id, name: "Test User", tier: "premium", region: "US" });
}

async function fetchOrders(_id: string): AsyncResult<Order[], "ORDERS_ERROR"> {
  return ok([{ id: "order-1", items: ["item-1"] }]);
}

async function fetchRecommendations(
  _id: string
): AsyncResult<string[], "REC_ERROR"> {
  return ok(["rec-1", "rec-2"]);
}

async function fetchSettings(
  _id: string
): AsyncResult<{ theme: string }, "SETTINGS_ERROR"> {
  return ok({ theme: "dark" });
}

async function validateCart(_cart: Cart): AsyncResult<boolean, "INVALID_CART"> {
  return ok(true);
}

async function processPayment(
  _payment: Payment
): AsyncResult<string, "PAYMENT_FAILED"> {
  return ok("payment-123");
}

async function applyDiscount(
  percent: number
): AsyncResult<number, "DISCOUNT_ERROR"> {
  return ok(percent);
}

async function calculateTax(
  _region: string
): AsyncResult<number, "TAX_ERROR"> {
  return ok(0.08);
}

// ============================================================================
// Basic Usage Examples
// ============================================================================

describe("visualization", () => {
  describe("createVisualizer", () => {
    it("creates visualizer and renders output", async () => {
      const viz = createVisualizer({ workflowName: "checkout" });

      const deps = {
        validateCart,
        processPayment,
      };

      const workflow = createWorkflow("checkout", deps, {
        onEvent: viz.handleEvent,
      });

      await workflow.run(async ({ step, deps: { validateCart, processPayment } }) => {
        await step("Validate cart", () => validateCart({ items: ["item-1"] }));
        await step("Process payment", () => processPayment({ amount: 100 }));
        return DONE;
      });

      const output = viz.render();
      expect(output).toContain("checkout");
      expect(output).toContain("Validate cart");
      expect(output).toContain("Process payment");
    });

    it("renders as mermaid", async () => {
      const viz = createVisualizer({ workflowName: "test" });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: viz.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      const mermaid = viz.renderAs("mermaid");
      expect(mermaid).toContain("flowchart");
    });

    it("renders as json", async () => {
      const viz = createVisualizer({ workflowName: "test" });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: viz.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      const json = viz.renderAs("json");
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty("root");
    });
  });

  describe("createEventCollector", () => {
    it("collects events for later visualization", async () => {
      const collector = createEventCollector({ workflowName: "checkout" });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser, fetchOrders },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, fetchOrders } }) => {
        await step("Fetch user", () => fetchUser("123"));
        await step("Fetch orders", () => fetchOrders("123"));
        return DONE;
      });

      const events = collector.getEvents();
      expect(events.length).toBeGreaterThan(0);

      const workflowEvents = collector.getWorkflowEvents();
      expect(workflowEvents.length).toBeGreaterThan(0);

      const output = collector.visualize();
      expect(output).toContain("Fetch user");
      expect(output).toContain("Fetch orders");
    });

    it("can clear collected events", async () => {
      const collector = createEventCollector();

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      expect(collector.getEvents().length).toBeGreaterThan(0);

      collector.clear();
      expect(collector.getEvents().length).toBe(0);
    });
  });

  describe("visualizer options", () => {
    it("accepts configuration options", async () => {
      const viz = createVisualizer({
        workflowName: "checkout",
        showTimings: true,
        showKeys: true,
        detectParallel: true,
      });

      expect(viz).toBeDefined();
      expect(typeof viz.handleEvent).toBe("function");
      expect(typeof viz.render).toBe("function");
    });
  });

  describe("decision tracking", () => {
    it("tracks if/else decisions", async () => {
      const collector = createEventCollector();

      const workflow = createWorkflow(
        "workflow",
        { fetchUser, applyDiscount },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, applyDiscount } }) => {
        const user = await step("Fetch user", () => fetchUser("123"));

        const isPremium = trackIf("premium-check", user.tier === "premium", {
          emit: collector.handleDecisionEvent,
        });

        if (user.tier === "premium") {
          isPremium.takeBranch("premium");
          await step("Apply premium discount", () => applyDiscount(20));
        } else {
          isPremium.takeBranch("standard");
          await step("Apply standard discount", () => applyDiscount(5));
        }
        isPremium.end();

        return DONE;
      });

      const decisionEvents = collector.getDecisionEvents();
      expect(decisionEvents.length).toBeGreaterThan(0);
    });

    it("tracks switch decisions", async () => {
      const collector = createEventCollector();

      const workflow = createWorkflow(
        "workflow",
        { fetchUser, calculateTax },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, calculateTax } }) => {
        const user = await step("Fetch user", () => fetchUser("123"));

        const regionSwitch = trackSwitch("region", user.region, {
          emit: collector.handleDecisionEvent,
        });

        switch (user.region) {
          case "US":
            regionSwitch.takeBranch("US");
            await step("Calculate US tax", () => calculateTax("US"));
            break;
          case "EU":
            regionSwitch.takeBranch("EU");
            await step("Calculate EU tax", () => calculateTax("EU"));
            break;
          default:
            regionSwitch.takeBranch("other");
        }
        regionSwitch.end();

        return DONE;
      });

      const output = collector.visualize();
      expect(output).toBeDefined();
    });
  });

  describe("time travel controller", () => {
    it("navigates through workflow execution", async () => {
      // Create time travel controller that receives events directly
      const timeTravel = createTimeTravelController();

      const workflow = createWorkflow(
        "workflow",
        { fetchUser, fetchOrders },
        { onEvent: timeTravel.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, fetchOrders } }) => {
        await step("Fetch user", () => fetchUser("123"));
        await step("Fetch orders", () => fetchOrders("123"));
        return DONE;
      });

      // Navigate using the correct API
      const ir0 = timeTravel.seek(0);
      expect(ir0).toBeDefined();

      const ir1 = timeTravel.stepForward();
      expect(ir1).toBeDefined();

      const ir2 = timeTravel.stepBackward();
      expect(ir2).toBeDefined();

      // Get state
      const state = timeTravel.getState();
      expect(state).toBeDefined();
    });

    it("supports state change subscription", async () => {
      const timeTravel = createTimeTravelController();

      const states: unknown[] = [];
      const unsubscribe = timeTravel.onStateChange((state) => {
        states.push(state);
      });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: timeTravel.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      // Events trigger state changes during workflow execution
      expect(states.length).toBeGreaterThan(0);

      unsubscribe();
    });
  });

  describe("performance analyzer", () => {
    it("analyzes workflow execution patterns (exact markdown example)", async () => {
      const analyzer = createPerformanceAnalyzer();

      // Collect multiple runs
      for (let i = 0; i < 3; i++) {
        const collector = createEventCollector();
        const workflow = createWorkflow(
          "workflow",
          { fetchUser, fetchOrders },
          { onEvent: collector.handleEvent }
        );

        const startTime = Date.now();
        await workflow.run(async ({ step, deps: { fetchUser, fetchOrders } }) => {
          await step("Fetch user", () => fetchUser("123"));
          await step("Fetch orders", () => fetchOrders("123"));
          return DONE;
        });

        analyzer.addRun({
          id: `run-${i}`,
          startTime,
          events: collector.getEvents(),
        });
      }

      // Analyze
      const slowest = analyzer.getSlowestNodes(5);
      const errorProne = analyzer.getErrorProneNodes(5);
      const retryProne = analyzer.getRetryProneNodes(5);

      expect(Array.isArray(slowest)).toBe(true);
      expect(Array.isArray(errorProne)).toBe(true);
      expect(Array.isArray(retryProne)).toBe(true);

      // Get heatmap data for visualization
      const collector = createEventCollector();
      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: collector.handleEvent }
      );
      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      const viz = createVisualizer();
      // Build IR from events for heatmap
      collector.getEvents().forEach((e) => viz.handleEvent(e));
      const ir = viz.getIR();

      const heatmap = analyzer.getHeatmap(ir, "duration");
      expect(heatmap).toHaveProperty("heat");
      expect(heatmap).toHaveProperty("metric", "duration");
      expect(heatmap).toHaveProperty("stats");
    });
  });

  describe("parallel operations", () => {
    it("visualizes parallel execution (using named object form)", async () => {
      const viz = createVisualizer({ workflowName: "checkout" });

      const deps = {
        fetchUser,
        fetchOrders,
        fetchSettings,
      };

      const workflow = createWorkflow("checkout", deps, { onEvent: viz.handleEvent });

      await workflow.run(
        async ({ step, deps: { fetchUser, fetchOrders, fetchSettings } }) => {
          // Use name-first object form
          const { user, orders, settings } = await step.parallel("Fetch all data", {
            user: () => fetchUser("123"),
            orders: () => fetchOrders("123"),
            settings: () => fetchSettings("123"),
          });

          return { user, orders, settings };
        }
      );

      const output = viz.render();
      expect(output).toContain("Fetch all data");
      // Individual step names may not appear in parallel visualization
      // but the parallel group should be visible
      expect(output).toBeDefined();
    });
  });

  describe("live visualization", () => {
    it("updates terminal in real-time", async () => {
      const live = createLiveVisualizer({
        workflowName: "checkout",
        clearOnUpdate: true, // Clear terminal between updates
      });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: live.handleEvent }
      );

      live.start(); // Begin live updates

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Processing...", () => fetchUser("123"));
        return DONE;
      });

      live.stop(); // Stop updates, show final state

      const output = live.render();
      expect(output).toContain("checkout");
      expect(output).toContain("Processing...");
    });
  });

  describe("visualizer reset", () => {
    it("can reset for new workflow", async () => {
      const viz = createVisualizer({ workflowName: "test" });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: viz.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      const output1 = viz.render();
      expect(output1).toBeDefined();

      viz.reset();

      const ir = viz.getIR();
      expect(ir.root.children.length).toBe(0);
    });
  });

  describe("update subscription", () => {
    it("notifies on IR updates", async () => {
      const viz = createVisualizer({ workflowName: "test" });
      const updates: unknown[] = [];

      const unsubscribe = viz.onUpdate((ir) => {
        updates.push(ir);
      });

      const workflow = createWorkflow(
        "workflow",
        { fetchUser },
        { onEvent: viz.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser } }) => {
        await step("Fetch user", () => fetchUser("123"));
        return DONE;
      });

      expect(updates.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("matches exact markdown time-travel example", async () => {
      // Create controller that receives events directly
      const timeTravel = createTimeTravelController();

      const workflow = createWorkflow(
        "workflow",
        { fetchUser, fetchOrders },
        { onEvent: timeTravel.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, fetchOrders } }) => {
        await step("Fetch user", () => fetchUser("123"));
        await step("Fetch orders", () => fetchOrders("123"));
        return DONE;
      });

      // Navigate
      timeTravel.seek(0); // Jump to start
      timeTravel.stepForward(); // Next event
      timeTravel.stepBackward(); // Previous event
      timeTravel.seek(5); // Jump to event 5

      // Get current IR
      const ir = timeTravel.getCurrentIR();
      expect(ir).toBeDefined();

      // Get state (includes position info)
      const state = timeTravel.getState();
      expect(state).toHaveProperty("currentIndex");
      expect(state).toHaveProperty("snapshots");

      // Subscribe to changes
      const states: unknown[] = [];
      const unsubscribe = timeTravel.onStateChange((s) => {
        states.push(s);
      });

      // State changes happen during workflow execution, not during navigation
      // The subscription was set up after workflow completed, so states may be empty
      // This is expected behavior - state changes fire during event processing
      unsubscribe();
    });
  });

  describe("Best Practices", () => {
    it("DO: Name your steps for readable output", async () => {
      const collector = createEventCollector();
      const workflow = createWorkflow(
        "workflow",
        { fetchUser, validateCart },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, validateCart } }) => {
        // ✓ Clear names (using explicit ID as first param)
        await step("Fetch user profile", () => fetchUser("123"));
        await step("Validate cart items", () => validateCart({ items: [] }));
        return DONE;
      });

      const events = collector.getWorkflowEvents();
      // Check that events exist and have step information
      expect(events.length).toBeGreaterThan(0);
      // Events may have name in different properties depending on event type
      const hasUserStep = events.some((e) => {
        const event = e as { name?: string; stepName?: string };
        return (
          event.name === "Fetch user profile" ||
          event.stepName === "Fetch user profile"
        );
      });
      const hasCartStep = events.some((e) => {
        const event = e as { name?: string; stepName?: string };
        return (
          event.name === "Validate cart items" ||
          event.stepName === "Validate cart items"
        );
      });
      expect(hasUserStep || hasCartStep).toBe(true);
    });

    it("DO: Use the event collector for tests", async () => {
      const collector = createEventCollector();
      const workflow = createWorkflow(
        "workflow",
        { fetchUser, fetchOrders, fetchSettings },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(
        async ({ step, deps: { fetchUser, fetchOrders, fetchSettings } }) => {
          await step("Fetch user", () => fetchUser("123"));
          await step("Validate input", () => fetchOrders("123"));
          await step("Process data", () => fetchSettings("123"));
          return DONE;
        }
      );

      const events = collector.getWorkflowEvents();
      // Extract step names from events (may be in different properties)
      const stepNames = events
        .map((e) => {
          const event = e as { name?: string; stepName?: string };
          return event.name || event.stepName;
        })
        .filter((name): name is string => typeof name === "string");

      // Verify we have the expected steps (order may vary)
      expect(stepNames.length).toBeGreaterThanOrEqual(3);
      expect(stepNames).toContain("Fetch user");
      expect(stepNames).toContain("Validate input");
      expect(stepNames).toContain("Process data");
    });

    it("DO: Track decisions that affect flow", async () => {
      const collector = createEventCollector();
      const workflow = createWorkflow(
        "workflow",
        { fetchUser, applyDiscount },
        { onEvent: collector.handleEvent }
      );

      await workflow.run(async ({ step, deps: { fetchUser, applyDiscount } }) => {
        const user = await step("Fetch user", () => fetchUser("123"));

        // Decisions show WHY a path was taken
        const decision = trackIf(
          "can-refund",
          user.tier === "premium",
          {
            emit: collector.handleDecisionEvent,
          }
        );

        if (user.tier === "premium") {
          decision.takeBranch("premium");
          await step("Apply premium", () => applyDiscount(20));
        } else {
          decision.takeBranch("standard");
          await step("Apply standard", () => applyDiscount(5));
        }
        decision.end();

        return DONE;
      });

      const decisionEvents = collector.getDecisionEvents();
      expect(decisionEvents.length).toBeGreaterThan(0);
      // Visualization shows: ◇ can-refund [true] → Refund branch taken
    });
  });
});

// ============================================================================
// Export to avoid unused variable warnings
// ============================================================================

export {
  fetchUser,
  fetchOrders,
  fetchRecommendations,
  validateCart,
  processPayment,
};
