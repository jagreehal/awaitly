/**
 * Cross-Workflow Composition Resolver
 *
 * Resolves and analyzes workflows that call other workflows, building
 * a complete graph of the workflow composition tree.
 */

import * as path from "path";
import * as fs from "fs";
import { loadTsMorph } from "./ts-morph-loader";
import type {
  StaticWorkflowIR,
  StaticWorkflowRefNode,
  StaticFlowNode,
} from "./types";
import { analyzeWorkflow, type AnalyzerOptions } from "./static-analyzer";
import { calculateComplexity } from "./complexity";

// =============================================================================
// Types
// =============================================================================

/**
 * A node in the workflow call graph.
 */
export interface WorkflowGraphNode {
  /** Workflow name */
  name: string;
  /** File path where the workflow is defined */
  filePath: string;
  /** The analyzed IR for this workflow */
  ir: StaticWorkflowIR;
  /** Workflows this one calls */
  calls: WorkflowCallEdge[];
  /** Workflows that call this one */
  calledBy: string[];
}

/**
 * An edge representing a workflow calling another workflow.
 */
export interface WorkflowCallEdge {
  /** Name of the called workflow */
  targetWorkflow: string;
  /** Where in the source the call occurs */
  callSite?: {
    line: number;
    column: number;
  };
  /** Whether the target was successfully resolved */
  resolved: boolean;
}

/**
 * Complete workflow composition graph.
 */
export interface WorkflowGraph {
  /** All workflows in the graph, keyed by name */
  workflows: Map<string, WorkflowGraphNode>;
  /** The entry point workflow */
  entryWorkflow: string;
  /** Circular dependency warnings */
  circularDependencies: string[][];
  /** Unresolved workflow references */
  unresolvedReferences: UnresolvedReference[];
}

/**
 * An unresolved workflow reference.
 */
export interface UnresolvedReference {
  /** Name of the workflow that couldn't be resolved */
  workflowName: string;
  /** Where the reference occurred */
  referencedFrom: string;
  /** Reason it couldn't be resolved */
  reason: string;
}

// =============================================================================
// Options
// =============================================================================

export interface CompositionResolverOptions extends AnalyzerOptions {
  /** Maximum depth to resolve (prevents infinite recursion) */
  maxDepth?: number;
  /** Base directory for resolving relative imports */
  baseDir?: string;
  /** Whether to inline resolved workflows into parent IR */
  inlineResolved?: boolean;
  /** Additional files to search for workflow definitions */
  additionalFiles?: string[];
}

const DEFAULT_OPTIONS: Required<CompositionResolverOptions> = {
  tsConfigPath: "./tsconfig.json",
  resolveReferences: true,
  maxReferenceDepth: 5,
  includeLocations: true,
  maxDepth: 10,
  baseDir: process.cwd(),
  inlineResolved: false,
  additionalFiles: [],
};

// =============================================================================
// Main Resolver
// =============================================================================

/**
 * Analyze a workflow and all workflows it calls, building a complete graph.
 *
 * @param entryFilePath - Path to the entry workflow file
 * @param workflowName - Name of the workflow to start from
 * @param options - Resolution options
 * @returns Complete workflow composition graph
 */
export function analyzeWorkflowGraph(
  entryFilePath: string,
  workflowName?: string,
  options: CompositionResolverOptions = {}
): WorkflowGraph {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const graph: WorkflowGraph = {
    workflows: new Map(),
    entryWorkflow: "",
    circularDependencies: [],
    unresolvedReferences: [],
  };

  const visited = new Set<string>();
  const stack: string[] = [];

  // Analyze the entry workflow
  const entryIR = analyzeWorkflow(entryFilePath, workflowName, opts);
  graph.entryWorkflow = entryIR.root.workflowName;

  // Build the graph starting from entry
  resolveWorkflowRecursively(
    entryIR,
    entryFilePath,
    graph,
    visited,
    stack,
    opts,
    0
  );

  return graph;
}

// =============================================================================
// Recursive Resolution
// =============================================================================

function resolveWorkflowRecursively(
  ir: StaticWorkflowIR,
  filePath: string,
  graph: WorkflowGraph,
  visited: Set<string>,
  stack: string[],
  opts: Required<CompositionResolverOptions>,
  depth: number
): void {
  const workflowName = ir.root.workflowName;
  const nodeKey = `${filePath}:${workflowName}`;

  // Check for circular dependencies
  if (stack.includes(nodeKey)) {
    const cycleStart = stack.indexOf(nodeKey);
    const cycle = [...stack.slice(cycleStart), nodeKey];
    graph.circularDependencies.push(cycle);
    return;
  }

  // Skip if already visited
  if (visited.has(nodeKey)) {
    return;
  }

  // Check depth limit
  if (depth > opts.maxDepth) {
    graph.unresolvedReferences.push({
      workflowName,
      referencedFrom: stack[stack.length - 1] ?? "entry",
      reason: `Max depth (${opts.maxDepth}) exceeded`,
    });
    return;
  }

  visited.add(nodeKey);
  stack.push(nodeKey);

  // Find workflow references in the IR
  const workflowRefs = findWorkflowRefs(ir.root.children);
  const calls: WorkflowCallEdge[] = [];

  // Try to resolve each reference
  for (const ref of workflowRefs) {
    const resolved = tryResolveWorkflow(ref, filePath, opts);

    if (resolved) {
      calls.push({
        targetWorkflow: ref.workflowName,
        callSite: ref.location
          ? { line: ref.location.line, column: ref.location.column }
          : undefined,
        resolved: true,
      });

      // Recursively resolve the target
      resolveWorkflowRecursively(
        resolved.ir,
        resolved.filePath,
        graph,
        visited,
        stack,
        opts,
        depth + 1
      );

      // Update the reference node if inlining
      if (opts.inlineResolved) {
        ref.resolved = true;
        ref.resolvedPath = resolved.filePath;
        ref.inlinedIR = resolved.ir;
      }

      // Update calledBy for the target
      const targetNode = graph.workflows.get(resolved.ir.root.workflowName);
      if (targetNode && !targetNode.calledBy.includes(workflowName)) {
        targetNode.calledBy.push(workflowName);
      }
    } else {
      calls.push({
        targetWorkflow: ref.workflowName,
        callSite: ref.location
          ? { line: ref.location.line, column: ref.location.column }
          : undefined,
        resolved: false,
      });

      graph.unresolvedReferences.push({
        workflowName: ref.workflowName,
        referencedFrom: workflowName,
        reason: "Could not find workflow definition",
      });
    }
  }

  // Add this workflow to the graph
  graph.workflows.set(workflowName, {
    name: workflowName,
    filePath,
    ir,
    calls,
    calledBy: [],
  });

  stack.pop();
}

// =============================================================================
// Reference Finding
// =============================================================================

function findWorkflowRefs(nodes: StaticFlowNode[]): StaticWorkflowRefNode[] {
  const refs: StaticWorkflowRefNode[] = [];

  for (const node of nodes) {
    if (node.type === "workflow-ref") {
      refs.push(node);
    } else if (hasChildren(node)) {
      refs.push(...findWorkflowRefs(getChildren(node)));
    }
  }

  return refs;
}

function hasChildren(node: StaticFlowNode): boolean {
  return (
    node.type === "sequence" ||
    node.type === "parallel" ||
    node.type === "race" ||
    node.type === "conditional" ||
    node.type === "loop"
  );
}

function getChildren(node: StaticFlowNode): StaticFlowNode[] {
  switch (node.type) {
    case "sequence":
    case "parallel":
    case "race":
      return node.children;
    case "conditional":
      return [...node.consequent, ...(node.alternate ?? [])];
    case "loop":
      return node.body;
    default:
      return [];
  }
}

// =============================================================================
// Workflow Resolution
// =============================================================================

interface ResolvedWorkflow {
  ir: StaticWorkflowIR;
  filePath: string;
}

function tryResolveWorkflow(
  ref: StaticWorkflowRefNode,
  currentFilePath: string,
  opts: Required<CompositionResolverOptions>
): ResolvedWorkflow | null {
  const workflowName = ref.workflowName;

  // Strategy 1: Check if it's in the same file
  try {
    const ir = analyzeWorkflow(currentFilePath, workflowName, opts);
    return { ir, filePath: currentFilePath };
  } catch {
    // Not in same file, continue
  }

  // Strategy 2: Try to find in additional files
  for (const additionalFile of opts.additionalFiles) {
    try {
      const ir = analyzeWorkflow(additionalFile, workflowName, opts);
      return { ir, filePath: additionalFile };
    } catch {
      // Not in this file, continue
    }
  }

  // Strategy 3: Try to resolve from imports in the source file
  const resolved = tryResolveFromImports(
    workflowName,
    currentFilePath,
    opts
  );
  if (resolved) {
    return resolved;
  }

  return null;
}

function tryResolveFromImports(
  workflowName: string,
  currentFilePath: string,
  opts: Required<CompositionResolverOptions>
): ResolvedWorkflow | null {
  try {
    const { Project } = loadTsMorph();
    const project = new Project({
      tsConfigFilePath: opts.tsConfigPath,
      skipAddingFilesFromTsConfig: true,
    });

    const sourceFile = project.addSourceFileAtPath(currentFilePath);

    // Find import declarations
    const imports = sourceFile.getImportDeclarations();

    for (const importDecl of imports) {
      // Check if this import includes our workflow
      const namedImports = importDecl.getNamedImports();
      const hasWorkflow = namedImports.some(
        (ni) => ni.getName() === workflowName
      );

      if (hasWorkflow) {
        // Get the module specifier
        const moduleSpecifier = importDecl.getModuleSpecifierValue();

        // Resolve the module path
        const resolvedPath = resolveModulePath(
          moduleSpecifier,
          currentFilePath,
          opts
        );

        if (resolvedPath) {
          try {
            const ir = analyzeWorkflow(resolvedPath, workflowName, opts);
            return { ir, filePath: resolvedPath };
          } catch {
            // Couldn't analyze, continue
          }
        }
      }
    }
  } catch {
    // Couldn't process imports
  }

  return null;
}

function resolveModulePath(
  moduleSpecifier: string,
  currentFilePath: string,
  _opts: Required<CompositionResolverOptions>
): string | null {
  // Handle relative imports
  if (moduleSpecifier.startsWith(".")) {
    const currentDir = path.dirname(currentFilePath);
    const resolved = path.resolve(currentDir, moduleSpecifier);

    // Try common extensions
    const extensions = [".ts", ".tsx", "/index.ts", "/index.tsx"];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      try {
        fs.accessSync(withExt);
        return withExt;
      } catch {
        // File doesn't exist, try next
      }
    }

    // Maybe it already has extension
    try {
      fs.accessSync(resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  // For non-relative imports, we'd need more sophisticated resolution
  // (node_modules, path aliases, etc.) - skip for now
  return null;
}

// =============================================================================
// Graph Analysis Utilities
// =============================================================================

/**
 * Get workflows in topological order (dependencies first).
 */
export function getTopologicalOrder(graph: WorkflowGraph): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (temp.has(name)) return; // Cycle detected, skip

    temp.add(name);

    const node = graph.workflows.get(name);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) {
          visit(call.targetWorkflow);
        }
      }
    }

    temp.delete(name);
    visited.add(name);
    result.push(name);
  }

  for (const name of graph.workflows.keys()) {
    visit(name);
  }

  return result;
}

/**
 * Get all workflows that a given workflow depends on (transitively).
 */
export function getDependencies(
  graph: WorkflowGraph,
  workflowName: string
): string[] {
  const deps = new Set<string>();
  const visited = new Set<string>();

  function collect(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const node = graph.workflows.get(name);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) {
          deps.add(call.targetWorkflow);
          collect(call.targetWorkflow);
        }
      }
    }
  }

  collect(workflowName);
  return Array.from(deps);
}

/**
 * Get all workflows that depend on a given workflow (transitively).
 */
export function getDependents(
  graph: WorkflowGraph,
  workflowName: string
): string[] {
  const dependents = new Set<string>();
  const visited = new Set<string>();

  function collect(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const node = graph.workflows.get(name);
    if (node) {
      for (const caller of node.calledBy) {
        dependents.add(caller);
        collect(caller);
      }
    }
  }

  collect(workflowName);
  return Array.from(dependents);
}

/**
 * Calculate the total complexity across all workflows in the graph.
 */
export function calculateGraphComplexity(graph: WorkflowGraph): {
  totalCyclomaticComplexity: number;
  totalWorkflows: number;
  maxDepth: number;
  hasCircularDependencies: boolean;
} {
  let totalCC = 0;
  let maxDepth = 0;

  for (const node of graph.workflows.values()) {
    const metrics = calculateComplexity(node.ir);
    totalCC += metrics.cyclomaticComplexity;
  }

  // Calculate max depth using topological order
  const order = getTopologicalOrder(graph);
  const depths = new Map<string, number>();

  for (const name of order) {
    const node = graph.workflows.get(name);
    if (!node) continue;

    let depth = 0;
    for (const call of node.calls) {
      if (call.resolved) {
        const calledDepth = depths.get(call.targetWorkflow) ?? 0;
        depth = Math.max(depth, calledDepth + 1);
      }
    }
    depths.set(name, depth);
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    totalCyclomaticComplexity: totalCC,
    totalWorkflows: graph.workflows.size,
    maxDepth,
    hasCircularDependencies: graph.circularDependencies.length > 0,
  };
}

// =============================================================================
// Visualization
// =============================================================================

/**
 * Generate a Mermaid diagram of the workflow graph.
 */
export function renderGraphMermaid(graph: WorkflowGraph): string {
  const lines: string[] = [];

  lines.push("flowchart TD");
  lines.push("");
  lines.push("  %% Workflow Composition Graph");
  lines.push("");

  // Add nodes
  for (const [name, _node] of graph.workflows) {
    const isEntry = name === graph.entryWorkflow;
    const shape = isEntry ? `${name}[["${name}"]]` : `${name}["${name}"]`;
    lines.push(`  ${shape}`);
  }

  lines.push("");

  // Add edges
  for (const [name, graphNode] of graph.workflows) {
    for (const call of graphNode.calls) {
      const style = call.resolved ? "-->" : "-.->"; // Dashed for unresolved
      lines.push(`  ${name} ${style} ${call.targetWorkflow}`);
    }
  }

  // Add unresolved references
  if (graph.unresolvedReferences.length > 0) {
    lines.push("");
    lines.push("  %% Unresolved References");
    for (const ref of graph.unresolvedReferences) {
      if (!graph.workflows.has(ref.workflowName)) {
        lines.push(`  ${ref.workflowName}[/"${ref.workflowName} (?)"/]`);
      }
    }
  }

  // Add styles
  lines.push("");
  lines.push("  %% Styles");
  lines.push("  classDef entry fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px");
  lines.push("  classDef unresolved fill:#ffcdd2,stroke:#c62828,stroke-dasharray:5");
  lines.push(`  class ${graph.entryWorkflow} entry`);

  for (const ref of graph.unresolvedReferences) {
    lines.push(`  class ${ref.workflowName} unresolved`);
  }

  return lines.join("\n");
}
