/**
 * Data Flow Analysis
 *
 * Analyzes data dependencies between steps in a workflow based on
 * `out` (writes) and `reads` (ctx.ref calls) extracted from the IR.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
} from "./types";
import { getStaticChildren } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * A node in the data flow graph representing a step that produces or consumes data.
 */
export interface DataFlowNode {
  /** Step ID (stepId or generated id) */
  id: string;
  /** Step name for display */
  name?: string;
  /** Key this step writes to (from `out` option) */
  writes?: string;
  /** Keys this step reads (from ctx.ref() calls) */
  reads: string[];
  /** Source location */
  location?: {
    line: number;
    column: number;
  };
}

/**
 * An edge in the data flow graph representing a data dependency.
 */
export interface DataFlowEdge {
  /** The step that produces the data */
  from: string;
  /** The step that consumes the data */
  to: string;
  /** The key being transferred */
  key: string;
}

/**
 * Complete data flow graph for a workflow.
 */
export interface DataFlowGraph {
  /** All steps that participate in data flow */
  nodes: DataFlowNode[];
  /** Data dependency edges */
  edges: DataFlowEdge[];
  /** Keys that are written by steps */
  producedKeys: Set<string>;
  /** Keys that are read but never written (potential issues) */
  undefinedReads: UndefinedRead[];
  /** Keys written multiple times (potential issues) */
  duplicateWrites: DuplicateWrite[];
}

/**
 * A read of a key that has no producer.
 */
export interface UndefinedRead {
  /** The key being read */
  key: string;
  /** Step that reads it */
  readerId: string;
  /** Step name for display */
  readerName?: string;
}

/**
 * A key written by multiple steps.
 */
export interface DuplicateWrite {
  /** The key being written */
  key: string;
  /** Steps that write to it */
  writerIds: string[];
}

// =============================================================================
// Graph Building
// =============================================================================

/**
 * Build a data flow graph from a workflow IR.
 */
export function buildDataFlowGraph(ir: StaticWorkflowIR): DataFlowGraph {
  const nodes: DataFlowNode[] = [];
  const edges: DataFlowEdge[] = [];
  const producedKeys = new Set<string>();
  const keyProducers = new Map<string, string[]>(); // key -> step ids that write it

  // Collect all steps with data flow info
  collectDataFlowNodes(ir.root.children, nodes);

  // Build producer map
  for (const node of nodes) {
    if (node.writes) {
      producedKeys.add(node.writes);
      const producers = keyProducers.get(node.writes) ?? [];
      producers.push(node.id);
      keyProducers.set(node.writes, producers);
    }
  }

  // Build edges and find undefined reads
  const undefinedReads: UndefinedRead[] = [];
  for (const node of nodes) {
    for (const key of node.reads) {
      const producers = keyProducers.get(key);
      if (producers && producers.length > 0) {
        // Add edge from each producer to this consumer
        for (const producerId of producers) {
          edges.push({
            from: producerId,
            to: node.id,
            key,
          });
        }
      } else {
        // This is a read of an undefined key
        undefinedReads.push({
          key,
          readerId: node.id,
          readerName: node.name,
        });
      }
    }
  }

  // Find duplicate writes
  const duplicateWrites: DuplicateWrite[] = [];
  for (const [key, writers] of keyProducers) {
    if (writers.length > 1) {
      duplicateWrites.push({
        key,
        writerIds: writers,
      });
    }
  }

  return {
    nodes,
    edges,
    producedKeys,
    undefinedReads,
    duplicateWrites,
  };
}

/**
 * Recursively collect steps with data flow information.
 */
function collectDataFlowNodes(
  flowNodes: StaticFlowNode[],
  result: DataFlowNode[]
): void {
  for (const node of flowNodes) {
    if (node.type === "step") {
      const stepNode = node as StaticStepNode;
      // Only include if it has out or reads
      if (stepNode.out || (stepNode.reads && stepNode.reads.length > 0)) {
        result.push({
          id: stepNode.stepId ?? stepNode.id,
          name: stepNode.name,
          writes: stepNode.out,
          reads: stepNode.reads ?? [],
          location: stepNode.location
            ? { line: stepNode.location.line, column: stepNode.location.column }
            : undefined,
        });
      }
    }

    // Recurse into children
    const children = getStaticChildren(node);
    if (children.length > 0) {
      collectDataFlowNodes(children, result);
    }
  }
}

// =============================================================================
// Analysis Utilities
// =============================================================================

/**
 * Get the topological order of steps based on data dependencies.
 * Returns undefined if there's a cycle.
 */
export function getDataFlowOrder(graph: DataFlowGraph): string[] | undefined {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency and in-degree
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If we didn't process all nodes, there's a cycle
  if (result.length !== graph.nodes.length) {
    return undefined;
  }

  return result;
}

/**
 * Get all steps that produce data consumed by the given step.
 */
export function getProducers(
  graph: DataFlowGraph,
  stepId: string
): DataFlowNode[] {
  const producerIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.to === stepId) {
      producerIds.add(edge.from);
    }
  }

  return graph.nodes.filter((n) => producerIds.has(n.id));
}

/**
 * Get all steps that consume data produced by the given step.
 */
export function getConsumers(
  graph: DataFlowGraph,
  stepId: string
): DataFlowNode[] {
  const consumerIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.from === stepId) {
      consumerIds.add(edge.to);
    }
  }

  return graph.nodes.filter((n) => consumerIds.has(n.id));
}

/**
 * Get all transitive dependencies for a step (all steps it depends on).
 */
export function getTransitiveDependencies(
  graph: DataFlowGraph,
  stepId: string
): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    for (const edge of graph.edges) {
      if (edge.to === id) {
        result.push(edge.from);
        visit(edge.from);
      }
    }
  }

  visit(stepId);
  return result;
}

/**
 * Find cycles in the data flow graph.
 * Returns an array of cycles, where each cycle is an array of step IDs.
 */
export function findCycles(graph: DataFlowGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const adjacency = new Map<string, string[]>();

  // Build adjacency list
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  function dfs(id: string, path: string[]): void {
    visited.add(id);
    recStack.add(id);
    path.push(id);

    for (const neighbor of adjacency.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path);
      } else if (recStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      }
    }

    path.pop();
    recStack.delete(id);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Result of validating a data flow graph.
 */
export interface DataFlowValidation {
  /** Whether the graph is valid (no issues) */
  valid: boolean;
  /** Validation issues */
  issues: DataFlowIssue[];
}

/**
 * A data flow validation issue.
 */
export interface DataFlowIssue {
  /** Issue severity */
  severity: "error" | "warning";
  /** Issue type */
  type: "undefined-read" | "duplicate-write" | "cycle";
  /** Human-readable message */
  message: string;
  /** Related step IDs */
  stepIds: string[];
  /** Related key (for read/write issues) */
  key?: string;
}

/**
 * Validate a data flow graph and return any issues.
 */
export function validateDataFlow(graph: DataFlowGraph): DataFlowValidation {
  const issues: DataFlowIssue[] = [];

  // Check for undefined reads
  for (const read of graph.undefinedReads) {
    issues.push({
      severity: "warning",
      type: "undefined-read",
      message: `Step "${read.readerName ?? read.readerId}" reads key "${read.key}" which is never written`,
      stepIds: [read.readerId],
      key: read.key,
    });
  }

  // Check for duplicate writes
  for (const write of graph.duplicateWrites) {
    issues.push({
      severity: "warning",
      type: "duplicate-write",
      message: `Key "${write.key}" is written by multiple steps: ${write.writerIds.join(", ")}`,
      stepIds: write.writerIds,
      key: write.key,
    });
  }

  // Check for cycles
  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    issues.push({
      severity: "error",
      type: "cycle",
      message: `Circular data dependency detected: ${cycle.join(" -> ")}`,
      stepIds: cycle,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Render a data flow graph as Mermaid flowchart.
 */
export function renderDataFlowMermaid(graph: DataFlowGraph): string {
  const lines: string[] = [];

  lines.push("flowchart LR");
  lines.push("");
  lines.push("  %% Data Flow Graph");
  lines.push("");

  // Render nodes
  for (const node of graph.nodes) {
    const label = node.name ?? node.id;
    const writes = node.writes ? ` [out: ${node.writes}]` : "";
    lines.push(`  ${sanitizeId(node.id)}["${label}${writes}"]`);
  }

  lines.push("");

  // Render edges with key labels
  for (const edge of graph.edges) {
    lines.push(
      `  ${sanitizeId(edge.from)} -->|${edge.key}| ${sanitizeId(edge.to)}`
    );
  }

  // Add undefined reads as warning nodes
  if (graph.undefinedReads.length > 0) {
    lines.push("");
    lines.push("  %% Undefined Reads (warnings)");
    for (const read of graph.undefinedReads) {
      const warningId = `undefined_${read.key}`;
      lines.push(`  ${warningId}[/"${read.key} (undefined)"/]`);
      lines.push(`  ${warningId} -.-> ${sanitizeId(read.readerId)}`);
    }
    lines.push("");
    lines.push("  classDef warning fill:#fff3cd,stroke:#856404");
    for (const read of graph.undefinedReads) {
      lines.push(`  class undefined_${read.key} warning`);
    }
  }

  return lines.join("\n");
}

/**
 * Sanitize a string for use as a Mermaid node ID.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
