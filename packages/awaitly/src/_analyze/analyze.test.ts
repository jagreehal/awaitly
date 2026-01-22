/**
 * Static Analysis Tests
 *
 * Tests for workflow static analysis including:
 * - AST extraction
 * - Path generation
 * - Complexity metrics
 * - Output formatting
 */

import { readFileSync } from "fs";
import * as path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { Project } from "ts-morph";
import {
  analyzeWorkflow,
  resetIdCounter,
  generatePaths,
  calculateComplexity,
  assessComplexity,
  renderStaticMermaid,
  generateTestMatrix,
  formatTestMatrixMarkdown,
} from "./index";

// =============================================================================
// Test Fixtures
// =============================================================================

const _SIMPLE_WORKFLOW = `
import { createWorkflow, ok } from 'awaitly';

const fetchUser = async (id: string) => ok({ id, name: 'Alice' });
const fetchPosts = async (userId: string) => ok([{ id: '1', title: 'Post' }]);

const simpleWorkflow = createWorkflow({
  fetchUser,
  fetchPosts,
});

const result = await simpleWorkflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('123'));
  const posts = await step(() => deps.fetchPosts(user.id));
  return { user, posts };
});
`;

const _CONDITIONAL_WORKFLOW = `
import { createWorkflow, ok, when } from 'awaitly';

const fetchUser = async (id: string) => ok({ id, name: 'Alice', isPremium: true });
const applyDiscount = async (userId: string) => ok({ discount: 10 });
const processOrder = async (data: any) => ok({ orderId: '123' });

const conditionalWorkflow = createWorkflow({
  fetchUser,
  applyDiscount,
  processOrder,
});

const result = await conditionalWorkflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('123'));

  if (user.isPremium) {
    await step(() => deps.applyDiscount(user.id));
  }

  return await step(() => deps.processOrder(user));
});
`;

const _PARALLEL_WORKFLOW = `
import { createWorkflow, ok, allAsync } from 'awaitly';

const fetchUser = async (id: string) => ok({ id, name: 'Alice' });
const fetchPosts = async (userId: string) => ok([{ id: '1' }]);
const fetchFriends = async (userId: string) => ok([{ id: '2' }]);

const parallelWorkflow = createWorkflow({
  fetchUser,
  fetchPosts,
  fetchFriends,
});

const result = await parallelWorkflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('123'));

  const [posts, friends] = await step(() => allAsync([
    deps.fetchPosts(user.id),
    deps.fetchFriends(user.id),
  ]));

  return { user, posts, friends };
});
`;

// =============================================================================
// Helper Functions
// =============================================================================

function _createTestProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
      strict: true,
    },
  });
}

function _createTestFile(project: Project, content: string): string {
  const filePath = "/test/workflow.ts";
  project.createSourceFile(filePath, content);
  return filePath;
}

// =============================================================================
// Type Tests
// =============================================================================

describe("Static Analysis Types", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("should export all required types", () => {
    // Type imports are checked at compile time
    // This test ensures the module loads without errors
    expect(analyzeWorkflow).toBeDefined();
    expect(generatePaths).toBeDefined();
    expect(calculateComplexity).toBeDefined();
    expect(assessComplexity).toBeDefined();
    expect(renderStaticMermaid).toBeDefined();
    expect(generateTestMatrix).toBeDefined();
    expect(formatTestMatrixMarkdown).toBeDefined();
  });
});

// =============================================================================
// Packaging Tests
// =============================================================================

describe("Packaging", () => {
  it("should list ts-morph as an optional peer dependency for analyze", () => {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(pkg.peerDependencies?.["ts-morph"]).toBeDefined();
    expect(pkg.peerDependenciesMeta?.["ts-morph"]?.optional).toBe(true);
  });
});

// =============================================================================
// Path Generation Tests
// =============================================================================

describe("Path Generation", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("should generate paths from IR", () => {
    // Create a minimal IR structure manually
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "testWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "step-1",
            type: "step" as const,
            name: "fetchUser",
          },
          {
            id: "step-2",
            type: "step" as const,
            name: "processData",
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].steps.length).toBe(2);
    expect(paths[0].steps[0].name).toBe("fetchUser");
    expect(paths[0].steps[1].name).toBe("processData");
  });

  it("should handle conditional branches", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "conditionalWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "step-1",
            type: "step" as const,
            name: "fetchUser",
          },
          {
            id: "conditional-1",
            type: "conditional" as const,
            condition: "user.isPremium",
            consequent: [
              {
                id: "step-2",
                type: "step" as const,
                name: "applyDiscount",
              },
            ],
            alternate: [],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 1,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir);

    // Should have 2 paths: one where condition is true, one where false
    expect(paths.length).toBe(2);

    // Find path where condition is true
    const truePath = paths.find((p) =>
      p.conditions.some((c) => c.expression === "user.isPremium" && c.mustBe)
    );
    expect(truePath).toBeDefined();
    expect(truePath?.steps.some((s) => s.name === "applyDiscount")).toBe(true);

    // Find path where condition is false
    const falsePath = paths.find((p) =>
      p.conditions.some((c) => c.expression === "user.isPremium" && !c.mustBe)
    );
    expect(falsePath).toBeDefined();
    expect(falsePath?.steps.some((s) => s.name === "applyDiscount")).toBe(false);
  });

  it("should respect maxPaths when branching", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "limitedWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "conditional-1",
            type: "conditional" as const,
            condition: "user.isAdmin",
            consequent: [
              { id: "step-1", type: "step" as const, name: "grantAccess" },
            ],
            alternate: [
              { id: "step-2", type: "step" as const, name: "denyAccess" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 1,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 1 });

    expect(paths.length).toBe(1);
  });

  it("should not truncate a single path when maxPaths is 1", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "simpleWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "step-1",
            type: "step" as const,
            name: "fetchUser",
          },
          {
            id: "step-2",
            type: "step" as const,
            name: "processData",
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 1 });

    expect(paths.length).toBe(1);
    expect(paths[0].steps.map((s) => s.name)).toEqual([
      "fetchUser",
      "processData",
    ]);
  });

  it("should include trailing steps even when maxPaths caps branching", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "branchingWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "conditional-1",
            type: "conditional" as const,
            condition: "user.isAdmin",
            consequent: [
              { id: "step-1", type: "step" as const, name: "grantAccess" },
            ],
            alternate: [
              { id: "step-2", type: "step" as const, name: "denyAccess" },
            ],
          },
          { id: "step-3", type: "step" as const, name: "auditLog" },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 3,
          conditionalCount: 1,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 1 });

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.steps.some((s) => s.name === "auditLog")).toBe(true);
    }
  });

  it("should not exceed maxPaths when a race has more branches than the limit", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "raceWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "race-1",
            type: "race" as const,
            children: [
              { id: "step-1", type: "step" as const, name: "first" },
              { id: "step-2", type: "step" as const, name: "second" },
              { id: "step-3", type: "step" as const, name: "third" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 3,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 1,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 2 });

    expect(paths.length).toBe(2);
  });

  it("should not exceed maxPaths when nested branching expands paths", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "nestedBranchingWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "conditional-1",
            type: "conditional" as const,
            condition: "user.isAdmin",
            consequent: [
              {
                id: "conditional-2",
                type: "conditional" as const,
                condition: "featureFlag",
                consequent: [
                  { id: "step-1", type: "step" as const, name: "pathA" },
                ],
                alternate: [
                  { id: "step-2", type: "step" as const, name: "pathB" },
                ],
              },
            ],
            alternate: [
              { id: "step-3", type: "step" as const, name: "pathC" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 3,
          conditionalCount: 2,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 2 });

    expect(paths.length).toBe(2);
  });

  it("should cap maxPaths when race branches each expand into multiple paths", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "raceBranchingWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "race-1",
            type: "race" as const,
            children: [
              {
                id: "conditional-1",
                type: "conditional" as const,
                condition: "flagA",
                consequent: [
                  { id: "step-1", type: "step" as const, name: "pathA1" },
                ],
                alternate: [
                  { id: "step-2", type: "step" as const, name: "pathA2" },
                ],
              },
              {
                id: "conditional-2",
                type: "conditional" as const,
                condition: "flagB",
                consequent: [
                  { id: "step-3", type: "step" as const, name: "pathB1" },
                ],
                alternate: [
                  { id: "step-4", type: "step" as const, name: "pathB2" },
                ],
              },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 4,
          conditionalCount: 2,
          parallelCount: 0,
          raceCount: 1,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const paths = generatePaths(ir, { maxPaths: 2 });

    expect(paths.length).toBe(2);
  });
});

// =============================================================================
// Complexity Metrics Tests
// =============================================================================

describe("Complexity Metrics", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("should calculate cyclomatic complexity for simple workflow", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "simpleWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          { id: "step-1", type: "step" as const, name: "step1" },
          { id: "step-2", type: "step" as const, name: "step2" },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const metrics = calculateComplexity(ir);

    // Simple linear workflow has cyclomatic complexity of 1
    expect(metrics.cyclomaticComplexity).toBe(1);
    expect(metrics.maxDepth).toBe(0);
    expect(metrics.decisionPoints).toBe(0);
  });

  it("should calculate higher complexity for conditional workflow", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "conditionalWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "conditional-1",
            type: "conditional" as const,
            condition: "a",
            consequent: [{ id: "step-1", type: "step" as const, name: "step1" }],
            alternate: [{ id: "step-2", type: "step" as const, name: "step2" }],
          },
          {
            id: "conditional-2",
            type: "conditional" as const,
            condition: "b",
            consequent: [{ id: "step-3", type: "step" as const, name: "step3" }],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 3,
          conditionalCount: 2,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const metrics = calculateComplexity(ir);

    // 1 (base) + 2 (conditionals) = 3
    expect(metrics.cyclomaticComplexity).toBe(3);
    expect(metrics.decisionPoints).toBe(2);
  });

  it("should assess complexity and generate warnings", () => {
    const metrics = {
      cyclomaticComplexity: 15,
      cognitiveComplexity: 20,
      pathCount: 100,
      maxDepth: 6,
      maxParallelBreadth: 3,
      decisionPoints: 14,
    };

    const assessment = assessComplexity(metrics);

    expect(assessment.level).toBe("high");
    expect(assessment.warnings.length).toBeGreaterThan(0);
    expect(assessment.recommendations.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Mermaid Output Tests
// =============================================================================

describe("Mermaid Diagram Generation", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("should generate valid Mermaid flowchart", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "testWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          { id: "step-1", type: "step" as const, name: "fetchUser" },
          { id: "step-2", type: "step" as const, name: "processData" },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const mermaid = renderStaticMermaid(ir);

    expect(mermaid).toContain("flowchart TB");
    expect(mermaid).toContain("Start");
    expect(mermaid).toContain("End");
    expect(mermaid).toContain("fetchUser");
    expect(mermaid).toContain("processData");
  });

  it("should include parallel blocks", () => {
    const ir = {
      root: {
        id: "workflow-1",
        type: "workflow" as const,
        workflowName: "parallelWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "parallel-1",
            type: "parallel" as const,
            mode: "all" as const,
            children: [
              { id: "step-1", type: "step" as const, name: "fetchPosts" },
              { id: "step-2", type: "step" as const, name: "fetchFriends" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "/test/workflow.ts",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 1,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    };

    const mermaid = renderStaticMermaid(ir);

    expect(mermaid).toContain("Parallel");
    expect(mermaid).toContain("Join");
    expect(mermaid).toContain("fetchPosts");
    expect(mermaid).toContain("fetchFriends");
  });
});

// =============================================================================
// Test Matrix Tests
// =============================================================================

describe("Test Matrix Generation", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("should generate test matrix from paths", () => {
    const paths = [
      {
        id: "path-1",
        description: "Happy path",
        steps: [
          { nodeId: "step-1", name: "fetchUser", repeated: false },
          { nodeId: "step-2", name: "processData", repeated: false },
        ],
        conditions: [],
        hasLoops: false,
        hasUnresolvedRefs: false,
      },
      {
        id: "path-2",
        description: "Error path",
        steps: [
          { nodeId: "step-1", name: "fetchUser", repeated: false },
        ],
        conditions: [
          { expression: "user.valid", mustBe: false },
        ],
        hasLoops: false,
        hasUnresolvedRefs: false,
      },
    ];

    const matrix = generateTestMatrix(paths);

    expect(matrix.paths.length).toBe(2);
    expect(matrix.summary.totalPaths).toBe(2);
    expect(matrix.conditions.length).toBe(1);
  });

  it("should format test matrix as Markdown", () => {
    const matrix = {
      paths: [
        {
          id: "path-1",
          suggestedTestName: "should fetch user then process data",
          description: "Happy path",
          setupConditions: [],
          expectedSteps: ["fetchUser", "processData"],
          priority: "high" as const,
        },
      ],
      conditions: [],
      summary: {
        totalPaths: 1,
        highPriorityPaths: 1,
        totalConditions: 0,
        minTestsForCoverage: 1,
      },
    };

    const markdown = formatTestMatrixMarkdown(matrix);

    expect(markdown).toContain("# Test Coverage Matrix");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("**Total Paths:** 1");
    expect(markdown).toContain("## Test Cases");
    expect(markdown).toContain("should fetch user then process data");
  });
});
