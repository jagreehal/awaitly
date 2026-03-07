#!/usr/bin/env node
/**
 * Generate analyzer-showcase.data.json from showcase fixtures in this folder.
 * Output is written as a sibling of the showcase folder:
 *   __fixtures__/analyzer-showcase.data.json
 *
 * Usage (from packages/awaitly-analyze after build):
 *   node src/__fixtures__/showcase/generate-showcase.mjs
 *
 * Or from repo root:
 *   node packages/awaitly-analyze/src/__fixtures__/showcase/generate-showcase.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  analyze,
  renderStaticMermaid,
  getStaticChildren,
  isStaticStepNode,
  isStaticSagaStepNode,
} = require("../../../dist/index.cjs");
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

/**
 * Collect step and saga-step nodes from the IR tree with detailed info (including types).
 * @param {unknown[]} nodes - IR nodes to walk
 * @param {{ inLoop?: { loopType: string; iterSource?: string } }} [ctx] - optional context (e.g. when inside a loop)
 */
function collectStepDetails(nodes, ctx = {}) {
  const steps = [];
  for (const node of nodes) {
    if (isStaticStepNode(node)) {
      const display = node.outputTypeInfo?.display;
      const kind = node.outputTypeKind;
      // Prefer display; only use outputType when not "any" or when kind is "unknown"
      const outputTypeText =
        display ??
        (node.outputType !== "any"
          ? node.outputType
          : kind === "unknown"
            ? node.outputType
            : undefined);
      // Canonical type: use outputTypeText when present; omit outputType when it would be "any" so we don't contradict outputTypeKind/outputTypeText
      const canonicalType = outputTypeText ?? node.outputType;
      const step = {
        stepId: node.stepId,
        name: node.name,
        callee: node.callee,
        description: node.description ?? node.jsdocDescription,
        key: node.key,
        retry: node.retry,
        timeout: node.timeout,
        errors: node.errors,
        out: node.out,
        reads: node.reads,
        depSource: node.depSource,
        inputType: node.inputType,
        ...(canonicalType !== "any" && { outputType: canonicalType }),
        outputTypeKind: kind,
        outputTypeDisplay: display,
        outputTypeText: outputTypeText ?? undefined,
        errorTypeDisplay: node.errorTypeInfo?.display,
      };
      if (node.resourceOps) {
        step.kind = "resource";
        step.acquire = node.resourceOps.acquire;
        step.use = node.resourceOps.use;
        step.release = node.resourceOps.release;
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
        ? { inLoop: { loopType: node.loopType, iterSource: node.iterSource } }
        : ctx;
    for (const child of getStaticChildren(node)) {
      steps.push(...collectStepDetails([child], childCtx));
    }
  }
  return steps;
}

function main() {
  const results = [];

  for (const { file, title, workflowName } of SHOWCASE_ENTRIES) {
    const absPath = join(showcaseDir, file);
    let code;
    try {
      code = readFileSync(absPath, "utf8");
    } catch (err) {
      console.error(`Failed to read ${absPath}:`, err.message);
      process.exit(1);
    }

    let ir;
    try {
      const result = analyze(absPath, { tsConfigPath });
      ir = workflowName ? result.named(workflowName) : result.single();
    } catch (err) {
      console.error(`Failed to analyze ${file}:`, err.message);
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
