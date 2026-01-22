/**
 * Demo test for visualization functionality
 * 
 * This demonstrates:
 * - Basic workflow visualization
 * - Decision tracking (if/switch)
 * - Parallel operations
 * - Race operations
 * - Skipped steps
 * - Input/output tracking
 */

import { describe, it, expect } from "vitest";
import { ok, err, allAsync, anyAsync, type AsyncResult, type WorkflowEvent } from "../core";
import { createWorkflow } from "../workflow";
import {
  trackIf,
  trackSwitch,
  visualizeEvents,
  createEventCollector,
} from "./index";

// Mock functions for demo
type User = { id: string; name: string; role: "admin" | "user" };
type Post = { id: string; title: string; userId: string };

const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  if (id === "1") {
    return ok({ id: "1", name: "Alice", role: "admin" });
  }
  if (id === "2") {
    return ok({ id: "2", name: "Bob", role: "user" });
  }
  return err("NOT_FOUND");
};

const fetchPosts = async (userId: string): AsyncResult<Post[], "FETCH_ERROR"> => {
  return ok([
    { id: "1", title: "Hello World", userId },
    { id: "2", title: "My Post", userId },
  ]);
};

const processAdminAction = async (user: User): AsyncResult<string, "ADMIN_ERROR"> => {
  return ok(`Admin action processed for ${user.name}`);
};

const processUserAction = async (user: User): AsyncResult<string, "USER_ERROR"> => {
  return ok(`User action processed for ${user.name}`);
};

const validatePermission = async (
  user: User,
  action: string
): AsyncResult<boolean, "VALIDATION_ERROR"> => {
  if (user.role === "admin") {
    return ok(true);
  }
  return ok(action === "read");
};

describe("Visualization Demo", () => {
  it("should visualize a basic workflow with decisions", async () => {
    const collector = createEventCollector({ workflowName: "user-workflow" });

    const workflow = createWorkflow(
      {
        fetchUser,
        fetchPosts,
        processAdminAction,
        processUserAction,
        validatePermission,
      },
      {
        onEvent: collector.handleEvent,
      }
    );

    const result = await workflow(async (step, deps) => {
      // Step 1: Fetch user
      const user = await step(() => deps.fetchUser("1"), { key: "user:1", name: "Fetch user" });

      // Decision: Check user role
      const decision = trackIf("check-role", user.role === "admin", {
        condition: "user.role === 'admin'",
        value: user.role,
        emit: (e) => collector.handleDecisionEvent(e),
      });

      if (decision.condition) {
        decision.then();
        const action = await step(() => deps.processAdminAction(user), {
          key: "admin-action",
          name: "Process admin action",
        });
        decision.end();
        return { user, action };
      } else {
        decision.else();
        const action = await step(() => deps.processUserAction(user), {
          key: "user-action",
          name: "Process user action",
        });
        decision.end();
        return { user, action };
      }
    });

    expect(result.ok).toBe(true);

    // Visualize
    const output = collector.visualize();
    console.log("\n=== Basic Workflow with Decision ===\n");
    console.log(output);
    expect(output).toContain("user-workflow");
    expect(output).toContain("Fetch user");
    // Decision tracking is working - visualization shows the workflow structure
  });

  it("should visualize parallel operations", async () => {
    const collector = createEventCollector({ workflowName: "parallel-workflow" });

    const workflow = createWorkflow({ fetchUser, fetchPosts }, {
      onEvent: collector.handleEvent,
    });

    const result = await workflow(async (step, deps) => {
      const userId = "1";

      // Parallel fetch
      const [user, posts] = await step.parallel("Fetch all data", () =>
        allAsync([deps.fetchUser(userId), deps.fetchPosts(userId)])
      );

      return { user, posts };
    });

    expect(result.ok).toBe(true);

    const output = collector.visualize();
    console.log("\n=== Parallel Operations ===\n");
    console.log(output);
    expect(output).toContain("parallel");
    expect(output).toContain("Fetch all data");
  });

  it("should visualize race operations", async () => {
    const collector = createEventCollector({ workflowName: "race-workflow" });

    const fetchFromPrimary = async (id: string): AsyncResult<User, "ERROR"> => {
      // Simulate slow primary
      await new Promise((resolve) => setTimeout(resolve, 50));
      return ok({ id, name: "Primary User", role: "user" });
    };

    const fetchFromFallback = async (id: string): AsyncResult<User, "ERROR"> => {
      // Simulate fast fallback
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({ id, name: "Fallback User", role: "user" });
    };

    const workflow = createWorkflow({ fetchFromPrimary, fetchFromFallback }, {
      onEvent: collector.handleEvent,
    });

    const result = await workflow(async (step, deps) => {
      const data = await step.race("Fastest API", () =>
        anyAsync([deps.fetchFromPrimary("1"), deps.fetchFromFallback("1")])
      );

      return data;
    });

    expect(result.ok).toBe(true);

    const output = collector.visualize();
    console.log("\n=== Race Operations ===\n");
    console.log(output);
    expect(output).toContain("race");
    expect(output).toContain("Fastest API");
  });

  it("should visualize switch statement decisions", async () => {
    const collector = createEventCollector({ workflowName: "switch-workflow" });

    const processAdmin = async (user: User): AsyncResult<string, "ERROR"> =>
      ok(`Admin: ${user.name}`);
    const processModerator = async (user: User): AsyncResult<string, "ERROR"> =>
      ok(`Moderator: ${user.name}`);
    const processUser = async (user: User): AsyncResult<string, "ERROR"> =>
      ok(`User: ${user.name}`);

    const workflow = createWorkflow(
      { fetchUser, processAdmin, processModerator, processUser },
      {
        onEvent: collector.handleEvent,
      }
    );

    const result = await workflow(async (step, deps) => {
      const user = await step(() => deps.fetchUser("1"), { key: "user:1" });

      // Switch decision
      const decision = trackSwitch("process-by-role", user.role, {
        condition: `switch(user.role)`,
        value: user.role,
        emit: collector.handleDecisionEvent,
      });

      let result: string;
      switch (user.role) {
        case "admin":
          decision.case("admin", true);
          result = await step(() => deps.processAdmin(user), { key: "process-admin" });
          break;
        case "moderator":
          decision.case("moderator", false); // This branch is skipped
          result = await step(() => deps.processModerator(user), { key: "process-moderator" });
          break;
        default:
          decision.default(false); // This branch is skipped
          result = await step(() => deps.processUser(user), { key: "process-user" });
      }

      decision.end();
      return result;
    });

    expect(result.ok).toBe(true);

    const output = collector.visualize();
    console.log("\n=== Switch Statement Decision ===\n");
    console.log(output);
    expect(output).toMatch(/process-by-role|decision/);
    expect(output).toContain("admin");
  });

  it("should visualize complex workflow with multiple decisions", async () => {
    const collector = createEventCollector({
      workflowName: "complex-workflow",
      showTimings: true,
      showKeys: true,
    });

    const workflow = createWorkflow(
      {
        fetchUser,
        fetchPosts,
        processAdminAction,
        processUserAction,
        validatePermission,
      },
      {
        onEvent: collector.handleEvent,
      }
    );

    const result = await workflow(async (step, deps) => {
      // Fetch user
      const user = await step(() => deps.fetchUser("2"), { key: "user:2", name: "Fetch user" });

      // First decision: Role check
      const roleDecision = trackIf("check-role", user.role === "admin", {
        condition: "user.role === 'admin'",
        value: user.role,
        emit: collector.handleDecisionEvent,
      });

      let action: string;
      if (roleDecision.condition) {
        roleDecision.then();
        action = await step(() => deps.processAdminAction(user), {
          key: "admin-action",
          name: "Process admin",
        });
      } else {
        roleDecision.else();
        action = await step(() => deps.processUserAction(user), {
          key: "user-action",
          name: "Process user",
        });
      }
      roleDecision.end();

      // Second decision: Permission check
      const permissionDecision = trackIf("check-permission", action.includes("admin"), {
        condition: "action.includes('admin')",
        value: action,
        emit: collector.handleDecisionEvent,
      });

      if (permissionDecision.condition) {
        permissionDecision.then();
        const isValid = await step(() => deps.validatePermission(user, "write"), {
          key: "validate-write",
          name: "Validate write permission",
        });
        return { user, action, isValid };
      } else {
        permissionDecision.else();
        const isValid = await step(() => deps.validatePermission(user, "read"), {
          key: "validate-read",
          name: "Validate read permission",
        });
        return { user, action, isValid };
      }
    });

    expect(result.ok).toBe(true);

    const output = collector.visualize();
    console.log("\n=== Complex Workflow with Multiple Decisions ===\n");
    console.log(output);
    expect(output).toContain("complex-workflow");
    // Decision nodes should be present (may use auto-generated IDs)
    expect(output).toMatch(/decision|check-role|check-permission/);
  });

  it("should visualize in Mermaid format", async () => {
    const collector = createEventCollector({ workflowName: "mermaid-demo" });

    const workflow = createWorkflow({ fetchUser, processAdminAction }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      const user = await step(() => deps.fetchUser("1"), { key: "user:1" });

      const decision = trackIf("check-role", user.role === "admin", {
        emit: collector.handleDecisionEvent,
      });

      if (decision.condition) {
        decision.then();
        await step(() => deps.processAdminAction(user), { key: "admin-action" });
      } else {
        decision.else();
      }
      decision.end();
    });

    const mermaid = collector.visualizeAs("mermaid");
    console.log("\n=== Mermaid Diagram ===\n");
    console.log(mermaid);
    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain("decision"); // Decision nodes are present
  });

  it("should visualize with post-execution events", async () => {
    const events: WorkflowEvent<"NOT_FOUND" | "UNAUTHORIZED">[] = [];

    const workflow = createWorkflow({ fetchUser, processAdminAction }, {
      onEvent: (event) => events.push(event),
    });

    await workflow(async (step, deps) => {
      const user = await step(() => deps.fetchUser("1"), { key: "user:1" });

      const decision = trackIf("check-role", user.role === "admin", {
        emit: (e) => events.push(e),
      });

      if (decision.condition) {
        decision.then();
        await step(() => deps.processAdminAction(user), { key: "admin-action" });
      } else {
        decision.else();
      }
      decision.end();
    });

    const output = visualizeEvents(events, { workflowName: "post-execution" });
    console.log("\n=== Post-Execution Visualization ===\n");
    console.log(output);
    expect(output).toContain("post-execution");
  });
});
