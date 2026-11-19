/**
 * Tests for strict mode diagnostics
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import {
  validateStrict,
  formatDiagnostics,
  getSummary,
} from "../../strict-diagnostics";

describe("Strict Mode Diagnostics", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("validateStrict", () => {
    it("passes for fully compliant workflow", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), {
              errors: ['NOT_FOUND'],
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("warns on legacy step signature", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'), { name: 'getUser' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const legacyWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-step-id"
      );
      expect(legacyWarning).toBeDefined();
      expect(legacyWarning?.severity).toBe("warning");
    });

    it("warns on missing errors declaration", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const missingErrorsWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-errors"
      );
      expect(missingErrorsWarning).toBeDefined();
      expect(missingErrorsWarning?.fix).toContain("errors:");
    });

    it("does not warn when errors are explicitly empty", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const missingErrorsWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-errors"
      );
      expect(missingErrorsWarning).toBeUndefined();
    });

    it("can treat warnings as errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0], { warningsAsErrors: true });

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it("can disable specific checks", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0], {
        requireStepId: false,
        requireErrors: false,
      });

      expect(validation.diagnostics).toHaveLength(0);
    });
  });

  describe("formatDiagnostics", () => {
    it("formats passing result", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const formatted = formatDiagnostics(validation);

      expect(formatted).toContain("✓");
      expect(formatted).toContain("passes");
    });

    it("formats failing result with fix suggestions", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const formatted = formatDiagnostics(validation);

      expect(formatted).toContain("Fix:");
    });
  });

  describe("getSummary", () => {
    it("returns concise summary", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const summary = getSummary(validation);

      expect(summary).toContain("✓");
      expect(summary.toLowerCase()).toContain("passed");
    });
  });

  describe("parallel-missing-errors", () => {
    it("warns on parallel branches without errors in shorthand form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}), fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            const { user, posts } = await step.parallel("Fetch user and posts", {
              user: () => deps.fetchUser("1"),
              posts: () => deps.fetchPosts("1"),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const parallelWarnings = validation.diagnostics.filter(
        (d) => d.rule === "parallel-missing-errors"
      );
      expect(parallelWarnings.length).toBeGreaterThan(0);
      expect(parallelWarnings[0].fix).toContain("{ fn:");
    });

    it("passes for parallel branches with canonical { fn, errors } form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}), fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            const { user, posts } = await step.parallel("Fetch user and posts", {
              user: { fn: () => deps.fetchUser("1"), errors: ['NOT_FOUND'] },
              posts: { fn: () => deps.fetchPosts("1"), errors: ['FETCH_ERROR'] },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const parallelWarnings = validation.diagnostics.filter(
        (d) => d.rule === "parallel-missing-errors"
      );
      expect(parallelWarnings).toHaveLength(0);
    });
  });

  describe("loop-missing-collect", () => {
    it("warns on step.forEach with out but no collect option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              out: 'results',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeDefined();
      expect(loopWarning?.fix).toContain("collect:");
    });

    it("passes for step.forEach with out and collect option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              out: 'results',
              collect: 'array',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeUndefined();
    });

    it("passes for step.forEach without out option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeUndefined();
    });
  });

  describe("unnamed-trace", () => {
    const unnamedTrace = (source: string) =>
      analyzeWorkflowSource(source).map(
        (ir) => validateStrict(ir).diagnostics.find((d) => d.rule === "unnamed-trace")?.fix,
      );
    const load = `import { createWorkflow, run, ok } from "awaitly";
      const load = async () => ok("user");`;

    it("suggests naming a deps-first createWorkflow after its variable", () => {
      expect(unnamedTrace(`${load}
        const checkout = createWorkflow({ load });
        await checkout.run(async ({ step, deps }) => step("load", () => deps.load()));
      `)).toEqual(["Name it where it is created: createWorkflow('checkout', deps)"]);
    });

    it("suggests a workflowName for an inline run, from the function around it", () => {
      expect(unnamedTrace(`${load}
        export async function checkout() {
          return run({ load }, async (s) => s.load());
        }
      `)).toEqual([
        "Pass the name: run(deps, fn, { workflowName: 'checkout' }), or pass a named function",
      ]);
    });

    it("stays quiet for runs the runtime can name", () => {
      expect(unnamedTrace(`${load}
        const named = createWorkflow("named", { load });
        await named.run(async ({ step, deps }) => step("load", () => deps.load()));
        export async function a() { return run({ load }, async (s) => s.load(), { workflowName: "a" }); }
        export async function b() { return run({ load }, async function checkout(s) { return s.load(); }); }
        export async function c(options: { workflowName: string }) { return run({ load }, async (s) => s.load(), options); }
      `)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it("stays quiet when a deps-first workflow's run callback has its own name", () => {
      expect(unnamedTrace(`${load}
        const checkout = createWorkflow({ load });
        await checkout.run(async function custom({ step, deps }) { return step("load", () => deps.load()); });
      `)).toEqual([undefined]);
    });

    it("suggests the run(fn) overload for a run without deps", () => {
      expect(unnamedTrace(`${load}
        export async function checkout() {
          return run(async () => load());
        }
      `)).toEqual(["Pass the name: run(fn, { workflowName: 'checkout' }), or pass a named function"]);
    });

    it("warns on an empty workflowName, which traces as a bare run", () => {
      expect(unnamedTrace(`${load}
        export async function checkout() {
          return run({ load }, async function named(s) { return s.load(); }, { workflowName: "" });
        }
      `)).toEqual([
        "Replace workflowName: '' with workflowName: 'checkout', or remove it and pass a named function",
      ]);
    });

    it("reads workflowName as the runtime does", () => {
      const nameOf = (options: string) =>
        analyzeWorkflowSource(`${load}
          declare const rest: { workflowName?: string };
          export async function handle() {
            return run({ load }, async (s) => s.load(), ${options});
          }
        `)[0].root.workflowName;
      expect(nameOf(`{ workflowName: " checkout " }`)).toBe(" checkout ");
      expect(nameOf("{ workflowName: `checkout` }")).toBe("checkout");
      expect(nameOf(`{ ...rest, workflowName: "checkout" }`)).toBe("checkout");
      // A later spread may override it, so the analyzer can't claim the literal.
      expect(nameOf(`{ workflowName: "checkout", ...rest }`)).toBe("handle");
      expect(nameOf(`{ ["workflowName"]: "checkout" }`)).toBe("checkout");
      // An unresolved computed key may be workflowName.
      expect(nameOf(`{ workflowName: "checkout", [String(1)]: "x" }`)).toBe("handle");
    });

    it("stays quiet for computed keys the runtime may name it by", () => {
      expect(unnamedTrace(`${load}
        declare const key: string;
        export async function a() { return run({ load }, async (s) => s.load(), { ["workflowName"]: "a" }); }
        export async function b() { return run({ load }, async (s) => s.load(), { [key]: "b" }); }
      `)).toEqual([undefined, undefined]);
    });

    it("names a three-argument run by its workflowName when the handler's type is unknown", () => {
      const [ir] = analyzeWorkflowSource(`${load}
        declare const handler: any;
        export async function handle() {
          return run({ load }, handler, { workflowName: "checkout" });
        }
      `);
      expect(ir.root.workflowName).toBe("checkout");
      expect(ir.root.dependencies.map((d) => d.name)).toEqual(["load"]);
    });

    it("reads through redundant parentheses", () => {
      expect(unnamedTrace(`${load}
        export async function checkout() { return run({ load }, (async (s) => s.load())); }
      `)).toEqual([
        "Pass the name: run(deps, fn, { workflowName: 'checkout' }), or pass a named function",
      ]);
      const [ir] = analyzeWorkflowSource(`${load}
        export async function handle() { return run({ load }, async (s) => s.load(), ({ workflowName: "checkout" })); }
      `);
      expect(ir.root.workflowName).toBe("checkout");
    });

    it("reads through as const and satisfies", () => {
      const nameOf = (options: string) =>
        analyzeWorkflowSource(`${load}
          export async function handle() { return run({ load }, async (s) => s.load(), ${options}); }
        `)[0].root.workflowName;
      expect(nameOf(`{ workflowName: "checkout" } as const`)).toBe("checkout");
      expect(nameOf(`{ workflowName: "checkout" } satisfies { workflowName: string }`)).toBe("checkout");
    });

    it("warns when workflowName or the options are explicitly undefined", () => {
      expect(unnamedTrace(`${load}
        export async function a() { return run(async () => load(), undefined); }
        export async function b() { return run(async () => load(), { workflowName: undefined }); }
      `)).toEqual([
        "Pass the name: run(fn, { workflowName: 'a' }), or pass a named function",
        "Pass the name: run(fn, { workflowName: 'b' }), or pass a named function",
      ]);
    });

    it("stays quiet when telemetry is off, since no run span is emitted", () => {
      expect(unnamedTrace(`${load}
        export async function a() { return run({ load }, async (s) => s.load(), { telemetry: false }); }
        const b = createWorkflow({ load }, { telemetry: false });
        await b.run(async ({ step, deps }) => step("load", () => deps.load()));
        export async function c() { return run({ load }, async (s) => s.load(), { telemetry: true }); }
      `)).toEqual([
        undefined,
        undefined,
        "Pass the name: run(deps, fn, { workflowName: 'c' }), or pass a named function",
      ]);
    });

    it("lets a run's own telemetry override the workflow's, as the runtime does", () => {
      expect(unnamedTrace(`${load}
        const on = createWorkflow({ load }, { telemetry: false });
        await on.run(async ({ step, deps }) => step("load", () => deps.load()), { telemetry: true });
        const off = createWorkflow({ load }, { telemetry: true });
        await off.run(async ({ step, deps }) => step("load", () => deps.load()), { telemetry: false });
      `)).toEqual(["Name it where it is created: createWorkflow('on', deps)", undefined]);
    });

    it("reads a workflow's telemetry through as const", () => {
      expect(unnamedTrace(`${load}
        const off = createWorkflow({ load }, { telemetry: false } as const);
        await off.run(async ({ step, deps }) => step("load", () => deps.load()));
      `)).toEqual([undefined]);
    });

    it("suggests a valid string literal for any name", () => {
      const [fix] = unnamedTrace(`${load}
        class Store {
          async "customer's checkout"() { return run(async () => load()); }
        }
      `);
      expect(fix).toContain("workflowName: 'customer\\'s checkout'");
    });

    it("escapes line breaks, backslashes and double quotes in the suggested name", () => {
      const [fix] = unnamedTrace(`${load}
        class Store {
          async "a\\nb \\\\ \\"q\\""() { return run(async () => load()); }
        }
      `);
      const literal = /workflowName: ('.*?[^\\]') \}/.exec(fix ?? "")?.[1];
      expect(literal).toBe("'a\\nb \\\\ \"q\"'");
      // It parses back to the method's name.
      expect(new Function(`return ${literal}`)()).toBe('a\nb \\ "q"');
    });

    it("reads the overload from an asserted handler's type", () => {
      const [ir] = analyzeWorkflowSource(`${load}
        type Handler = (s: { load: typeof load }) => Promise<unknown>;
        declare const handler: any;
        export async function handle() { return run({ load }, handler as Handler); }
      `);
      expect(ir.root.dependencies.map((d) => d.name)).toEqual(["load"]);
    });

    it("names a run with a handler passed by identifier by its workflowName", () => {
      const [ir] = analyzeWorkflowSource(`${load}
        const handler = async (s: { load: typeof load }) => s.load();
        export async function handle() {
          return run({ load }, handler, { workflowName: "checkout" });
        }
      `);
      expect(ir.root.workflowName).toBe("checkout");
      expect(ir.root.unnamedTrace).toBeUndefined();
    });

    it("names a run by its workflowName, the name its traces carry", () => {
      const [ir] = analyzeWorkflowSource(`${load}
        export async function handle() {
          return run({ load }, async (s) => s.load(), { workflowName: "checkout" });
        }
      `);
      expect(ir.root.workflowName).toBe("checkout");
    });
  });
});
