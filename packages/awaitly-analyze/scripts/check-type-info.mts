#!/usr/bin/env node
/**
 * Run the analyzer on fixture files and print type-related output.
 * Usage: pnpm exec tsx scripts/check-type-info.mts [--json] [--strict]
 */
import { analyze } from "../src/analyze.js";
import { buildDataFlowGraph } from "../src/data-flow.js";
import { getStaticChildren } from "../src/types.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const json = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");

type StaticWorkflowIR = import("../src/types.js").StaticWorkflowIR;
type StaticFlowNode = import("../src/types.js").StaticFlowNode;
type StaticStepNode = import("../src/types.js").StaticStepNode;

interface StepCounts {
  total: number;
  withOutputTypeInfo: number;
  withReadTypes: number;
}

interface WorkflowSummary {
  workflowName: string;
  file?: string;
  source?: "inline";
  dependencies: Array<{
    name: string;
    typeSignature: string | undefined;
    hasSignature: boolean;
    paramCount?: number;
    returnKind?: string;
  }>;
  stepCounts: StepCounts;
  dataFlow: {
    edges: number;
    typeMismatchCount: number;
    typeMismatches?: Array<{ key: string; producerType?: string; consumerType?: string }>;
  };
  warnings: string[];
}

function countSteps(root: { children: StaticFlowNode[] }): StepCounts {
  let total = 0;
  let withOutputTypeInfo = 0;
  let withReadTypes = 0;
  function visit(node: StaticFlowNode): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      total++;
      if (step.outputTypeInfo) withOutputTypeInfo++;
      if (step.readTypes && Object.keys(step.readTypes).length > 0) withReadTypes++;
    }
    for (const c of getStaticChildren(node)) visit(c);
  }
  for (const child of root.children) visit(child);
  return { total, withOutputTypeInfo, withReadTypes };
}

function buildSummary(
  ir: StaticWorkflowIR,
  sourceLabel: string,
  sourceType: "file" | "inline"
): WorkflowSummary {
  const root = ir.root;
  const warnings: string[] = [];
  for (const dep of root.dependencies) {
    if (!dep.signature) {
      warnings.push(`Dependency '${dep.name}' has no signature`);
    }
  }
  const stepCounts = countSteps(root);
  const graph = buildDataFlowGraph(ir);
  const dependencies = root.dependencies.map((dep) => ({
    name: dep.name,
    typeSignature: dep.typeSignature,
    hasSignature: !!dep.signature,
    paramCount: dep.signature?.params.length,
    returnKind: dep.signature?.returnType.kind,
  }));
  const summary: WorkflowSummary = {
    workflowName: root.workflowName,
    ...(sourceType === "file" ? { file: sourceLabel } : { source: "inline" }),
    dependencies,
    stepCounts,
    dataFlow: {
      edges: graph.edges.length,
      typeMismatchCount: graph.typeMismatches.length,
      typeMismatches:
        graph.typeMismatches.length > 0
          ? graph.typeMismatches.map((m) => ({
              key: m.key,
              producerType: m.producerType?.display,
              consumerType: m.consumerType?.display,
            }))
          : undefined,
    },
    warnings,
  };
  return summary;
}

function printTypeInfo(label: string, ir: StaticWorkflowIR, summary: WorkflowSummary): void {
  const root = ir.root;
  console.log("\n" + "=".repeat(60));
  console.log(label);
  console.log("=".repeat(60));
  console.log("Workflow:", root.workflowName);

  console.log("\n--- Dependencies ---");
  for (const dep of root.dependencies) {
    console.log(" ", dep.name);
    console.log("    typeSignature:", dep.typeSignature ?? "(none)");
    if (dep.signature) {
      console.log("    signature.params:", dep.signature.params.length);
      dep.signature.params.forEach((p, i) => {
        console.log(`      [${i}] ${p.name}: ${p.type.display} (kind: ${p.type.kind})`);
      });
      console.log(
        "    signature.returnType:",
        dep.signature.returnType.display,
        "| kind:",
        dep.signature.returnType.kind
      );
      if (dep.signature.resultLike) {
        console.log(
          "    resultLike:",
          dep.signature.resultLike.okType.display,
          dep.signature.resultLike.errorType.display
        );
      }
    } else {
      console.log("    signature: (not extracted)");
    }
  }

  function visitSteps(node: StaticFlowNode, indent: string): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      console.log(
        indent + "Step:",
        step.stepId ?? step.name,
        "| out:",
        step.out ?? "-",
        "| reads:",
        step.reads?.join(", ") ?? "-"
      );
      if (step.outputTypeInfo) {
        console.log(
          indent + "  outputTypeInfo:",
          step.outputTypeInfo.display,
          "| kind:",
          step.outputTypeInfo.kind
        );
      }
      if (step.readTypes && Object.keys(step.readTypes).length) {
        console.log(
          indent + "  readTypes:",
          JSON.stringify(
            Object.fromEntries(Object.entries(step.readTypes).map(([k, v]) => [k, v.display]))
          )
        );
      }
    }
    const children = getStaticChildren(node);
    for (const c of children) visitSteps(c, indent + "  ");
  }
  console.log("\n--- Steps (type info) ---");
  for (const child of root.children) {
    visitSteps(child, "  ");
  }
  console.log("  Steps with outputTypeInfo:", summary.stepCounts.withOutputTypeInfo);
  console.log("  Steps with readTypes:", summary.stepCounts.withReadTypes);

  const graph = buildDataFlowGraph(ir);
  console.log("\n--- Data flow ---");
  console.log("  Edges:", graph.edges.length);
  console.log("  Type mismatches:", graph.typeMismatches.length);
  if (graph.typeMismatches.length) {
    graph.typeMismatches.forEach((m) =>
      console.log(
        "    ",
        m.key,
        "| producer:",
        m.producerType?.display,
        "| consumer:",
        m.consumerType?.display
      )
    );
  }
  if (summary.warnings.length) {
    console.log("  Warnings:", summary.warnings.length);
  }
  console.log("");
}

const summaries: WorkflowSummary[] = [];
let hasAnyWarnings = false;

try {
  const typedPath = join(pkgRoot, "src/__fixtures__/typed/workflow-basic.ts");
  const ir = analyze(typedPath).single();
  const summary = buildSummary(ir, typedPath, "file");
  summaries.push(summary);
  if (summary.warnings.length) hasAnyWarnings = true;
  if (!json) {
    for (const w of summary.warnings) console.error("Warning:", w);
    printTypeInfo("Fixture: typed/workflow-basic.ts", ir, summary);
  }
} catch (e) {
  console.error("Typed fixture failed:", e);
  if (strict) process.exit(1);
}

const sourceWithReads = `
  import { createWorkflow, ok, type AsyncResult } from "awaitly";
  interface User { id: string }
  const workflow = createWorkflow("workflow", {
    getUser: async (): AsyncResult<User, Error> => ok({ id: "u1" }),
    charge: async (amount: number): AsyncResult<boolean, Error> => ok(true),
  });
  export async function run() {
    return await workflow.run(async ({ step, deps, ctx }) => {
      await step("get-user", () => deps.getUser(), { out: "user" });
      await step("charge", () => deps.charge(ctx.ref("user")), { reads: ["user"] });
    });
  }
`;
try {
  const ir2 = analyze.source(sourceWithReads).single();
  const summary2 = buildSummary(ir2, "inline", "inline");
  summaries.push(summary2);
  if (summary2.warnings.length) hasAnyWarnings = true;
  if (!json) {
    for (const w of summary2.warnings) console.error("Warning:", w);
    printTypeInfo("Inline: workflow with reads + type mismatch", ir2, summary2);
  }
} catch (e) {
  console.error("Inline source failed:", e);
  if (strict) process.exit(1);
}

if (json) {
  const payload = summaries.length === 1 ? summaries[0] : summaries;
  console.log(JSON.stringify(payload, null, 2));
}

if (strict && hasAnyWarnings) {
  process.exit(1);
}
