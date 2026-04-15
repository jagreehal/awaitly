import { describe, expect, it } from "vitest";
import { analyzeWorkflowSource } from "../static-analyzer";
import { renderRailwayMermaid } from "./railway";

function analyzeFirst(source: string) {
  const results = analyzeWorkflowSource(source);
  return results[0]!;
}

const linearWorkflowSource = `
  import { createWorkflow, ok } from "awaitly";
  const wf = createWorkflow("transfer", {
    validateInput: async () => ok(1),
    fetchRate: async () => ok(2),
    convert: async () => ok(3),
    executeTransfer: async () => ok(4),
    sendConfirmation: async () => ok(5),
  });
  export async function run() {
    return wf.run(async ({ step, deps }) => {
      await step("validate", () => deps.validateInput(), { errors: ["ValidationError"] });
      await step("fetch-rate", () => deps.fetchRate(), { errors: ["RateUnavailableError"] });
      await step("convert", () => deps.convert(), { errors: ["InsufficientFundsError"] });
      await step("execute", () => deps.executeTransfer(), { errors: ["TransferRejected", "ProviderUnavailable"] });
      await step("confirm", () => deps.sendConfirmation(), { errors: ["ConfirmationFailedError"] });
      return ok(undefined);
    });
  }
`;

describe("renderRailwayMermaid", () => {
  it("generates railway diagram with ok/err edges", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir);

    expect(output).toContain("flowchart LR");
    expect(output).toContain("-->|ok|");
    expect(output).toContain("-->|err|");
    expect(output).toContain("Done((Success))");
  });

  it("connects all steps with ok edges in sequence", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir);

    // Should have ok edges between consecutive steps and to Done
    const okEdges = output.match(/-->\|ok\|/g);
    // 5 steps → 4 step-to-step ok edges + 1 last-to-Done = 5
    expect(okEdges).toHaveLength(5);
  });

  it("creates error branches for each step with errors", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir);

    const errEdges = output.match(/-->\|err\|/g);
    // 5 steps all have errors → 5 err edges
    expect(errEdges).toHaveLength(5);

    expect(output).toContain("ValidationError");
    expect(output).toContain("RateUnavailableError");
    expect(output).toContain("InsufficientFundsError");
    expect(output).toContain("ConfirmationFailedError");
  });

  it("joins multiple errors on one step with /", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir);

    expect(output).toContain("TransferRejected / ProviderUnavailable");
  });

  it("omits err branch for steps without declared errors", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const wf = createWorkflow("simple", { a: async () => ok(1), b: async () => ok(2) });
      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("first", () => deps.a());
          await step("second", () => deps.b(), { errors: ["SomeError"] });
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // Only 1 err edge (for "second")
    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges).toHaveLength(1);
    expect(output).toContain("SomeError");
  });

  it("respects stepLabel: stepId option", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir, { stepLabel: "stepId" });

    expect(output).toContain("validate");
    expect(output).toContain("fetch-rate");
    expect(output).toContain("convert");
    expect(output).toContain("execute");
    expect(output).toContain("confirm");
  });

  it("respects direction: TD option", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir, { direction: "TD" });

    expect(output).toContain("flowchart TD");
    expect(output).not.toContain("flowchart LR");
  });

  it("handles empty workflow gracefully", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const wf = createWorkflow("empty", {});
      export async function run() {
        return wf.run(async () => ok(undefined));
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    expect(output).toContain("flowchart LR");
    expect(output).toContain("Done((Success))");
    expect(output).not.toContain("-->|ok|");
  });

  it("flattens steps inside conditionals/sequences into linear view", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const wf = createWorkflow("branched", {
        a: async () => ok(1),
        b: async () => ok(2),
        c: async () => ok(3),
      });
      export async function run() {
        return wf.run(async ({ step, deps, ctx }) => {
          await step("first", () => deps.a(), { errors: ["E1"] });
          if (ctx.input.flag) {
            await step("branch-step", () => deps.b(), { errors: ["E2"] });
          }
          await step("last", () => deps.c(), { errors: ["E3"] });
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // All steps should appear in the railway view
    const okEdges = output.match(/-->\|ok\|/g);
    expect(okEdges!.length).toBeGreaterThanOrEqual(2);
    expect(output).toContain("Done((Success))");
  });

  it("uses callee function name by default (not deps prefix)", () => {
    const ir = analyzeFirst(linearWorkflowSource);
    const output = renderRailwayMermaid(ir);

    // Should show "validateInput", not "deps.validateInput"
    expect(output).toContain("validateInput");
    expect(output).toContain("fetchRate");
  });

  it("generates unique short IDs for steps", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const wf = createWorkflow("collisions", {
        fooBar: async () => ok(1),
        fooBaz: async () => ok(2),
      });
      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("s1", () => deps.fooBar());
          await step("s2", () => deps.fooBaz());
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // Both steps should render without ID collision
    expect(output).toContain("-->|ok|");
    expect(output).toContain("Done((Success))");
  });

  it("shows error edges from inferred errors (no explicit errors option)", () => {
    const source = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";

      type ValidationError = { tag: "ValidationError" };
      type RateError = { tag: "RateError" };

      const wf = createWorkflow("transfer", {
        validate: async (_input: string): Promise<AsyncResult<string, ValidationError>> => ok("valid"),
        fetchRate: async (): Promise<AsyncResult<number, RateError>> => ok(1.5),
        execute: async (): Promise<AsyncResult<void, never>> => ok(undefined),
      });

      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("validate", () => deps.validate("usd"));
          await step("fetch-rate", () => deps.fetchRate());
          await step("execute", () => deps.execute());
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // Should have error edges for validate and fetchRate (not execute — it's "never")
    expect(output).toContain("ValidationError");
    expect(output).toContain("RateError");

    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges).toHaveLength(2);
  });

  it("respects includeInferredErrors: false option", () => {
    const source = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";

      type ValidationError = { tag: "ValidationError" };

      const wf = createWorkflow("transfer", {
        validate: async (): Promise<AsyncResult<string, ValidationError>> => ok("valid"),
        confirm: async () => ok(undefined),
      });

      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("validate", () => deps.validate());
          await step("confirm", () => deps.confirm(), { errors: ["ConfirmError"] });
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir, { includeInferredErrors: false });

    // Only explicit errors should show
    expect(output).toContain("ConfirmError");
    expect(output).not.toContain("ValidationError");

    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges).toHaveLength(1);
  });

  it("does not render inferred errors when the step explicitly declares errors: []", () => {
    const source = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";

      type ValidationError = { tag: "ValidationError" };

      const wf = createWorkflow("transfer", {
        validate: async (): Promise<AsyncResult<string, ValidationError>> => ok("valid"),
      });

      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("validate", () => deps.validate(), { errors: [] });
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    expect(output).not.toContain("ValidationError");

    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges ?? []).toHaveLength(0);
  });

  it("keeps generic inferred error types intact when they contain nested unions", () => {
    const source = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";

      type Envelope<T> = { tag: "Envelope"; reason: T };

      const wf = createWorkflow("transfer", {
        validate: async (): Promise<AsyncResult<string, Envelope<"A" | "B">>> => ok("valid"),
      });

      export async function run() {
        return wf.run(async ({ step, deps }) => {
          await step("validate", () => deps.validate());
          return ok(undefined);
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // escapeLabel converts " to ' for Mermaid compatibility
    expect(output).toContain("Envelope<'A' | 'B'>");
    expect(output).not.toContain("Envelope<'A' / 'B'>");
  });

  it("renders signup workflow with all inferred string-literal errors", () => {
    const source = `
      import { ok, err, type AsyncResult } from "awaitly";
      import { createWorkflow } from "awaitly/workflow";

      type User = { id: string; email: string };
      type CreateUserInput = { email: string; passwordHash: string };

      const validateEmail = async (email: string): AsyncResult<string, "INVALID_EMAIL"> =>
        email.includes("@") ? ok(email) : err("INVALID_EMAIL");

      const findUser = async (email: string): AsyncResult<User | null, "DB_ERROR"> =>
        ok(null);

      const checkNotTaken = async (user: User | null): AsyncResult<void, "EMAIL_TAKEN"> =>
        user ? err("EMAIL_TAKEN") : ok();

      const createUser = async (input: CreateUserInput): AsyncResult<User, "DB_ERROR"> =>
        ok({ id: "new-user", email: input.email });

      const sendWelcome = async (email: string): AsyncResult<void, "EMAIL_SERVICE_DOWN"> =>
        ok();

      export const signup = createWorkflow("signup", {
        validateEmail,
        findUser,
        checkNotTaken,
        createUser,
        sendWelcome,
      });

      export async function run(rawEmail: string, password: string) {
        return signup.run(async ({ step, deps }) => {
          const email = await step("validate", () => deps.validateEmail(rawEmail));
          const existing = await step("find", () => deps.findUser(email));
          await step("checkNotTaken", () => deps.checkNotTaken(existing));
          const user = await step("create", () => deps.createUser({ email, passwordHash: "hashed" }));
          await step("welcome", () => deps.sendWelcome(email));
          return user;
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir);

    // All 5 steps should be connected with ok edges
    const okEdges = output.match(/-->\|ok\|/g);
    expect(okEdges).toHaveLength(5);

    // Each step's inferred error should appear
    expect(output).toContain("INVALID_EMAIL");
    expect(output).toContain("DB_ERROR");
    expect(output).toContain("EMAIL_TAKEN");
    expect(output).toContain("EMAIL_SERVICE_DOWN");

    // 5 steps with errors → 5 err edges
    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges).toHaveLength(5);

    expect(output).toContain("Done((Success))");
  });

  it("signup workflow respects includeInferredErrors: false", () => {
    const source = `
      import { ok, err, type AsyncResult } from "awaitly";
      import { createWorkflow } from "awaitly/workflow";

      const validateEmail = async (email: string): AsyncResult<string, "INVALID_EMAIL"> =>
        email.includes("@") ? ok(email) : err("INVALID_EMAIL");

      const sendWelcome = async (email: string): AsyncResult<void, "EMAIL_SERVICE_DOWN"> =>
        ok();

      export const signup = createWorkflow("signup", { validateEmail, sendWelcome });

      export async function run(email: string) {
        return signup.run(async ({ step, deps }) => {
          const e = await step("validate", () => deps.validateEmail(email));
          await step("welcome", () => deps.sendWelcome(e));
          return e;
        });
      }
    `;
    const ir = analyzeFirst(source);
    const output = renderRailwayMermaid(ir, { includeInferredErrors: false });

    // No error edges since all errors are inferred (none explicit)
    expect(output).not.toContain("INVALID_EMAIL");
    expect(output).not.toContain("EMAIL_SERVICE_DOWN");
    const errEdges = output.match(/-->\|err\|/g);
    expect(errEdges ?? []).toHaveLength(0);
  });
});
