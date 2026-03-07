/**
 * Generate analyzer-showcase.data.json from showcase fixtures in this folder.
 * Output is written as a sibling of the showcase folder:
 *   __fixtures__/analyzer-showcase.data.json
 *
 * Usage (from packages/awaitly-analyze):
 *   pnpm exec tsx src/__fixtures__/showcase/generate-showcase.ts
 *
 * Or: pnpm run generate-showcase
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  analyze,
  renderStaticMermaid,
  getStaticChildren,
  isStaticStepNode,
  isStaticSagaStepNode,
} from "../../index";
import type { StaticFlowNode, StaticStepNode } from "../../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const showcaseDir = __dirname;
const fixturesDir = join(showcaseDir, "..");
const pkgRoot = join(showcaseDir, "..", "..", "..");

const SHOWCASE_ENTRIES = [
  { file: "01-linear-steps.ts", title: "Linear steps" },
  { file: "02-step-sleep.ts", title: "step.sleep" },
  { file: "03-step-retry.ts", title: "step.retry" },
  { file: "04-step-withTimeout.ts", title: "step.withTimeout" },
  { file: "05-step-try-fromResult.ts", title: "step.try & step.fromResult" },
  { file: "06-step-withFallback.ts", title: "step.withFallback" },
  { file: "07-step-withResource.ts", title: "step.withResource" },
  { file: "08-step-dep.ts", title: "step.dep" },
  { file: "09-step-race.ts", title: "step.race" },
  { file: "10-conditional-when-unless.ts", title: "when / unless / whenOr / unlessOr" },
  { file: "11-switch.ts", title: "switch" },
  { file: "12-loop-for.ts", title: "for / while / for-of / for-in" },
  { file: "13-workflow-ref.ts", title: "Workflow ref", workflowName: "parentWorkflow" },
  { file: "14-complex.ts", title: "Complex (parallel + conditional + forEach)" },
  { file: "15-saga.ts", title: "Saga workflow" },
];

const tsConfigPath = join(pkgRoot, "tsconfig.json");
const outPath = join(fixturesDir, "analyzer-showcase.data.json");

interface StepDetailRecord {
  stepId?: string;
  name?: string;
  callee?: string;
  description?: string;
  key?: string;
  retry?: unknown;
  timeout?: unknown;
  errors?: string[];
  out?: string;
  reads?: string[];
  depSource?: string;
  stepKind?: string;
  inputType?: string;
  outputType?: string;
  outputTypeKind?: string;
  outputTypeDisplay?: string;
  outputTypeText?: string;
  errorTypeDisplay?: string;
  kind?: string;
  acquire?: string;
  use?: string;
  release?: string;
  repeats?: string;
  loopType?: string;
  iterationSource?: string;
  try?: boolean;
  compensate?: boolean;
  compensationCallee?: string;
}

interface LoopCtx {
  loopType?: string;
  iterSource?: string;
}

function collectStepDetails(
  nodes: StaticFlowNode[],
  ctx: { inLoop?: LoopCtx } = {}
): StepDetailRecord[] {
  const steps: StepDetailRecord[] = [];
  for (const node of nodes) {
    if (isStaticStepNode(node)) {
      const stepNode = node as StaticStepNode;
      const display = stepNode.outputTypeInfo?.display;
      const kind = stepNode.outputTypeKind;
      const outputTypeText =
        display ??
        (stepNode.outputType !== "any"
          ? stepNode.outputType
          : kind === "unknown"
            ? stepNode.outputType
            : undefined);
      const canonicalType = outputTypeText ?? stepNode.outputType;
      const step: StepDetailRecord = {
        stepId: stepNode.stepId,
        name: stepNode.name,
        callee: stepNode.callee,
        description: stepNode.description ?? stepNode.jsdocDescription,
        key: stepNode.key,
        retry: stepNode.retry,
        timeout: stepNode.timeout,
        errors: stepNode.errors,
        out: stepNode.out,
        reads: stepNode.reads,
        depSource: stepNode.depSource,
        stepKind: stepNode.stepKind,
        inputType: stepNode.inputType,
        ...(canonicalType !== "any" && canonicalType && { outputType: canonicalType }),
        outputTypeKind: kind,
        outputTypeDisplay: display,
        outputTypeText: outputTypeText ?? undefined,
        errorTypeDisplay: stepNode.errorTypeInfo?.display,
      };
      if (stepNode.resourceOps) {
        step.kind = "resource";
        step.acquire = stepNode.resourceOps.acquire;
        step.use = stepNode.resourceOps.use;
        step.release = stepNode.resourceOps.release;
      }
      if (ctx.inLoop) {
        step.repeats = "loop";
        step.loopType = ctx.inLoop.loopType;
        if (ctx.inLoop.iterSource) step.iterationSource = ctx.inLoop.iterSource;
      }
      steps.push(step);
    } else if (isStaticSagaStepNode(node)) {
      steps.push({
        stepId: node.name ?? node.id,
        name: node.name,
        callee: node.callee,
        depSource: node.depSource,
        try: node.isTryStep === true,
        compensate: node.hasCompensation === true,
        compensationCallee: node.compensationCallee,
        outputTypeDisplay: node.outputTypeInfo?.display,
        errorTypeDisplay: node.errorTypeInfo?.display,
      });
    }
    const childCtx =
      node.type === "loop"
        ? { inLoop: { loopType: (node as { loopType?: string }).loopType, iterSource: (node as { iterSource?: string }).iterSource } }
        : ctx;
    const children = getStaticChildren(node) as StaticFlowNode[];
    for (const child of children) {
      steps.push(...collectStepDetails([child], childCtx));
    }
  }
  return steps;
}

function main(): void {
  const results: Array<{ title: string; code: string; mermaid: string; stepDetails: StepDetailRecord[] }> = [];

  for (const { file, title, workflowName } of SHOWCASE_ENTRIES) {
    const absPath = join(showcaseDir, file);
    let code: string;
    try {
      code = readFileSync(absPath, "utf8");
    } catch (err) {
      console.error(`Failed to read ${absPath}:`, (err as Error).message);
      process.exit(1);
    }

    let ir: { root: { children: StaticFlowNode[] } };
    try {
      const result = analyze(absPath, { tsConfigPath });
      ir = workflowName ? result.named(workflowName)! : result.single()!;
    } catch (err) {
      console.error(`Failed to analyze ${file}:`, (err as Error).message);
      process.exit(1);
    }

    const mermaid = renderStaticMermaid(ir, { sameLevelConditionals: true });
    const stepDetails = collectStepDetails(ir.root.children);
    const resultType = ir.root.workflowReturnType ?? undefined;
    const incErrors =
      (ir.root.declaredErrors?.length ? ir.root.declaredErrors : ir.root.errorTypes) ?? undefined;
    results.push({
      title,
      code,
      mermaid,
      stepDetails,
      ...(resultType && { resultType }),
      ...(incErrors?.length && { incErrors }),
    });
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${results.length} entries to ${outPath}`);
}

main();
