/**
 * Test: how close can we get to a payment-flow style diagram from an awaitly workflow?
 *
 * Uses a real workflow fixture file (payment-workflow.ts); the test analyzes that file
 * and renders static + enhanced Mermaid, then asserts on what we get and documents
 * what changes would be needed to get closer to the target.
 *
 * Target style (conceptually):
 *   Raw Request -> Validate -> Check Existing -> Acquire Lock -> Call Provider (retry) -> Persist -> Return ID
 *   With branches: Valid/Invalid, Found/Not Found, Success/Failed, and error exit nodes.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import mermaid from "mermaid";
import { analyzeWorkflowSource, resetIdCounter } from "./static-analyzer";
import { renderStaticMermaid, renderEnhancedMermaid } from "./output/mermaid";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
});

/** Validate generated Mermaid with the mermaid lib; throws if invalid. */
async function validateMermaid(diagram: string): Promise<void> {
  const result = await mermaid.parse(diagram);
  if (!result) throw new Error("Mermaid parse returned false");
}

const FIXTURES_DIR = join(__dirname, "__fixtures__");
const PAYMENT_WORKFLOW_FILE = join(FIXTURES_DIR, "payment-workflow.ts");

describe("Payment-flow style diagram", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  function getPaymentWorkflowIR() {
    const source = readFileSync(PAYMENT_WORKFLOW_FILE, "utf-8");
    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    expect(results).toHaveLength(1);
    return results[0]!;
  }

  it("analyzes the payment-workflow fixture file and produces static Mermaid with main steps and decisions", () => {
    const ir = getPaymentWorkflowIR();
    const mermaid = renderStaticMermaid(ir);

    // Main flow steps (node labels)
    expect(mermaid).toContain("validate-input");
    expect(mermaid).toContain("check-existing");
    expect(mermaid).toContain("acquire-lock");
    expect(mermaid).toContain("call-provider");
    expect(mermaid).toContain("persist-payment");
    expect(mermaid).toContain("return-payment-id");
    expect(mermaid).toContain("return-existing-id");

    // Decision diamonds use conditionLabel from step.if()
    expect(mermaid).toContain("Valid");
    expect(mermaid).toContain("Found");

    // Semantic edge labels from decisions (conditionLabel)
    expect(mermaid).toContain("|Valid|");
    expect(mermaid).toContain("|Found|");

    // Step kind suffix for retry
    expect(mermaid).toContain("Retry");

    // Flowchart structure
    expect(mermaid).toContain("flowchart");
    expect(mermaid).toContain("Start");
    expect(mermaid).toContain("End");
  });

  it("produces static Mermaid with inline error exit nodes when showInlineErrors is enabled", () => {
    const ir = getPaymentWorkflowIR();
    const mermaid = renderStaticMermaid(ir, { showInlineErrors: true });

    // Inline error exit nodes for steps with declared errors
    expect(mermaid).toContain("ValidationError");
    expect(mermaid).toContain("NotFound");
    expect(mermaid).toContain("IdempotencyConflict");
    expect(mermaid).toContain("ProviderRejected");
    expect(mermaid).toContain("ProviderUnavailable");
    expect(mermaid).toContain("PersistError");

    // Error exit nodes have error edges from their parent step
    expect(mermaid).toContain("|ValidationError|");
    expect(mermaid).toContain("|PersistError|");

    // Error exit style is defined
    expect(mermaid).toContain("classDef errorExitStyle");
  });

  it("produces static Mermaid with expanded retry node when expandRetry is enabled", () => {
    const ir = getPaymentWorkflowIR();
    const mermaid = renderStaticMermaid(ir, { expandRetry: true });

    // Retry logic node for call-provider (which uses step.retry with attempts: 3)
    expect(mermaid).toContain("Retry Logic");
    expect(mermaid).toContain("3 attempts");
    expect(mermaid).toContain("|Success|");
    expect(mermaid).toContain("|Retries Exhausted|");

    // Retry logic style is defined
    expect(mermaid).toContain("classDef retryLogicStyle");
  });

  it("produces static Mermaid with both inline errors and expanded retry", () => {
    const ir = getPaymentWorkflowIR();
    const mermaid = renderStaticMermaid(ir, {
      showInlineErrors: true,
      expandRetry: true,
    });

    // Both features active simultaneously
    expect(mermaid).toContain("ValidationError");
    expect(mermaid).toContain("Retry Logic");
    expect(mermaid).toContain("|Retries Exhausted|");
    expect(mermaid).toContain("classDef errorExitStyle");
    expect(mermaid).toContain("classDef retryLogicStyle");
  });

  it("produces enhanced Mermaid with error annotations and error nodes from the fixture", () => {
    const ir = getPaymentWorkflowIR();
    const mermaidWithErrors = renderEnhancedMermaid(ir, {
      showErrorNodes: true,
      showErrors: true,
      showDataFlow: true,
    });

    // Error annotations / error nodes
    expect(mermaidWithErrors).toContain("ValidationError");
    expect(mermaidWithErrors).toContain("IdempotencyConflict");
    expect(mermaidWithErrors).toContain("PersistError");
    expect(mermaidWithErrors).toContain("NotFound");

    // Error subgraph when showErrorNodes is true
    expect(mermaidWithErrors).toContain("subgraph Errors");
    expect(mermaidWithErrors).toContain("|throws|");
  });

  it("enhanced Mermaid uses static renderer as base with full IR structure", () => {
    const ir = getPaymentWorkflowIR();
    const enhanced = renderEnhancedMermaid(ir, {
      showErrorNodes: true,
      showErrors: true,
      showDataFlow: true,
    });

    // Enhanced now uses static renderer base, so it has the full IR tree structure
    // including decision diamonds and semantic edge labels
    expect(enhanced).toContain("Valid");
    expect(enhanced).toContain("Found");
    expect(enhanced).toContain("|Valid|");
    expect(enhanced).toContain("|Found|");

    // Still has enhanced overlays
    expect(enhanced).toContain("subgraph Errors");
    expect(enhanced).toContain("classDef errorStyle");
  });
});

describe("Choose-path style diagram (graph TD)", () => {
  /**
   * Target:
   *   graph TD
   *   A[Start] --> B{Choose Path}
   *   B -->|Left| C[Option A]
   *   B -->|Right| D[Option B]
   *   C --> E[End]
   *   D --> E
   */
  beforeEach(() => {
    resetIdCounter();
  });

  const choosePathSource = `
    const { createWorkflow } = await import("awaitly");
    const w = createWorkflow("w", {
      doA: async () => ({ path: "A" }),
      doB: async () => ({ path: "B" }),
    });
    async function run() {
      return await w(async ({ step, deps }) => {
        if (step.if("choose-path", "Choose Path", () => true)) {
          await step("option-a", () => deps.doA(), { name: "Option A" });
        } else {
          await step("option-b", () => deps.doB(), { name: "Option B" });
        }
      });
    }
  `;

  it("produces diagram with Start, decision, two branches, and End", async () => {
    const results = analyzeWorkflowSource(choosePathSource, undefined, {
      assumeImported: true,
    });
    expect(results).toHaveLength(1);
    const diagram = renderStaticMermaid(results[0]!);

    // Start and End
    expect(diagram).toContain("Start");
    expect(diagram).toContain("End");

    // flowchart TD (valid Mermaid)
    expect(diagram).toContain("flowchart TD");

    // Decision diamond with condition label
    expect(diagram).toContain("Choose Path");

    // Both branch steps: quoted labels so (dep: ...) is valid, e.g. step_2["option-a (dep: doA)"]
    expect(diagram).toContain("option-a");
    expect(diagram).toContain("option-b");
    expect(diagram).toMatch(/\[".*\(dep: doA\)"\]/);
    expect(diagram).toMatch(/\[".*\(dep: doB\)"\]/);

    // Semantic edge labels: decision -> branches with conditionLabel (Choose Path / Not Choose Path)
    expect(diagram).toContain("|Choose Path|");
    expect(diagram).toContain("|Not Choose Path|");

    // Both branches converge to End
    expect(diagram).toContain("step_2 --> end_node");
    expect(diagram).toContain("step_3 --> end_node");

    await validateMermaid(diagram);
  });
});
