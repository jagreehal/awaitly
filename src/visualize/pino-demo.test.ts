/**
 * Demo test showing pino integration with the logger renderer.
 */

import { describe, it, expect } from "vitest";
import { ok, err, type AsyncResult } from "../core";
import { createWorkflow } from "../workflow";
import { createVisualizer, type LoggerOutput } from "./index";
import pino from "pino";

describe("Pino Integration Demo", () => {
  it("should produce clean pino output", async () => {
    // Create a pino logger that captures output
    const logs: unknown[] = [];
    const logger = pino({
      level: "info",
    }, {
      write: (msg: string) => {
        logs.push(JSON.parse(msg));
      },
    });

    // Sample workflow dependencies
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return ok({ id, name: "Alice" });
    };

    const processPayment = async (userId: string): AsyncResult<{ transactionId: string }, "PAYMENT_FAILED"> => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return ok({ transactionId: `tx_${userId}_123` });
    };

    // Create visualizer and workflow
    const viz = createVisualizer({ workflowName: "checkout" });
    const workflow = createWorkflow({ fetchUser, processPayment }, {
      onEvent: viz.handleEvent,
    });

    // Run workflow
    await workflow(async (step, deps) => {
      const user = await step(() => deps.fetchUser("user_1"), {
        name: "Fetch user",
        key: "user:1",
      });

      await step(() => deps.processPayment(user.id), {
        name: "Process payment",
        key: "payment:1",
      });
    });

    // Log with pino
    const logData = JSON.parse(viz.renderAs("logger")) as LoggerOutput;
    logger.info(logData, "Workflow completed successfully");

    // Verify the log output
    expect(logs).toHaveLength(1);
    const logEntry = logs[0] as { workflow: LoggerOutput["workflow"]; steps: LoggerOutput["steps"]; summary: LoggerOutput["summary"]; diagram: string; msg: string };

    expect(logEntry.msg).toBe("Workflow completed successfully");
    expect(logEntry.workflow.name).toBe("checkout");
    expect(logEntry.workflow.state).toBe("success");
    expect(logEntry.steps).toHaveLength(2);
    expect(logEntry.summary.totalSteps).toBe(2);
    expect(logEntry.summary.successCount).toBe(2);
    expect(logEntry.diagram).toContain("checkout");

  });

  it("should show errors in pino output", async () => {
    const logs: unknown[] = [];
    const logger = pino({
      level: "error",
    }, {
      write: (msg: string) => {
        logs.push(JSON.parse(msg));
      },
    });

    const alwaysFails = async (): AsyncResult<string, "PAYMENT_DECLINED"> => {
      return err("PAYMENT_DECLINED");
    };

    const viz = createVisualizer({ workflowName: "failing-checkout" });
    const workflow = createWorkflow({ alwaysFails }, {
      onEvent: viz.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.alwaysFails(), {
        name: "Process payment",
      });
    });

    const logData = JSON.parse(viz.renderAs("logger")) as LoggerOutput;
    logger.error(logData, "Workflow failed");

    expect(logs).toHaveLength(1);
    const logEntry = logs[0] as { workflow: LoggerOutput["workflow"]; steps: LoggerOutput["steps"]; summary: LoggerOutput["summary"]; msg: string };

    expect(logEntry.msg).toBe("Workflow failed");
    expect(logEntry.workflow.state).toBe("error");
    expect(logEntry.steps[0].error).toBe("PAYMENT_DECLINED");
    expect(logEntry.summary.errorCount).toBe(1);
  });

  it("should show retries in pino output", async () => {
    const logs: unknown[] = [];
    const logger = pino({
      level: "warn",
    }, {
      write: (msg: string) => {
        logs.push(JSON.parse(msg));
      },
    });

    let attempts = 0;
    const unreliableService = async (): AsyncResult<string, "SERVICE_ERROR"> => {
      attempts++;
      if (attempts < 3) {
        return err("SERVICE_ERROR");
      }
      return ok("success");
    };

    const viz = createVisualizer({ workflowName: "retry-demo" });
    const workflow = createWorkflow({ unreliableService }, {
      onEvent: viz.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.unreliableService(), {
        name: "Call unreliable service",
        retry: { attempts: 3 },
      });
    });

    const logData = JSON.parse(viz.renderAs("logger")) as LoggerOutput;
    logger.warn(logData, "Workflow completed with retries");

    expect(logs).toHaveLength(1);
    const logEntry = logs[0] as { workflow: LoggerOutput["workflow"]; steps: LoggerOutput["steps"]; summary: LoggerOutput["summary"]; msg: string };

    expect(logEntry.steps[0].retryCount).toBe(2);
    expect(logEntry.summary.totalRetries).toBe(2);
  });
});
