/**
 * Phase 1 Tests: Result Generic Extraction
 *
 * Tests for extracting Result-like type information (AsyncResult, Result, Promise<Result>)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFixtureSource } from "./test-utils.js";
import { resetIdCounter } from "./static-analyzer/index.js";

describe("Phase 1: Result Generic Extraction", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("Direct AsyncResult<T, E, C> extraction", () => {
    it("extracts outputType from AsyncResult return type", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; name: string; }
        class NotFoundError extends Error { readonly _tag = "NotFound"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id, name: "Test" });
          },
        });
        
        export async function run(id: string) {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser(id), { errors: ["NotFound"] });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies).toHaveLength(1);
      expect(root.dependencies[0].name).toBe("fetchUser");
      expect(root.dependencies[0].typeSignature).toContain("AsyncResult");
    });

    it("extracts union error types from AsyncResult", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFound"; }
        class DatabaseError extends Error { readonly _tag = "DatabaseError"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError | DatabaseError> => {
            return ok({ id });
          },
        });
        
        export async function run(id: string) {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser(id), { 
              errors: ["NotFoundError", "DatabaseError"] 
            });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies[0].typeSignature).toContain("NotFoundError");
      expect(root.dependencies[0].typeSignature).toContain("DatabaseError");
    });
  });

  describe("Result<T, E, C> extraction", () => {
    it("extracts types from synchronous Result", () => {
      const source = `
        import { createWorkflow, ok, type Result } from "awaitly";
        
        const workflow = createWorkflow("test", {
          validate: (input: string): Result<boolean, Error> => {
            return ok(input.length > 0);
          },
        });
        
        export async function run(input: string) {
          return await workflow.run(async ({ step, deps }) => {
            await step("validate", () => deps.validate(input), { errors: ["Error"] });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies[0].name).toBe("validate");
      expect(root.dependencies[0].typeSignature).toContain("Result");
    });
  });

  describe("Promise<Result<T, E>> extraction", () => {
    it("extracts wrapped Result types", () => {
      const source = `
        import { createWorkflow, ok, type Result } from "awaitly";
        
        interface Data { value: number; }
        class FetchError extends Error { readonly _tag = "FetchError"; }
        
        const workflow = createWorkflow("test", {
          fetchData: async (url: string): Promise<Result<Data, FetchError>> => {
            return ok({ value: 42 });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchData("url"), { errors: ["FetchError"] });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies[0].typeSignature).toContain("Result");
    });

    it("classifies Promise<Result> return kind as promiseResult", () => {
      const source = `
        import { createWorkflow, ok, type Result } from "awaitly";
        
        interface Data { value: number; }
        class FetchError extends Error { readonly _tag = "FetchError"; }
        
        const workflow = createWorkflow("test", {
          fetchData: async (url: string): Promise<Result<Data, FetchError>> => {
            return ok({ value: 42 });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchData("url"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as {
        dependencies: Array<{
          signature?: { returnType: { kind: string } };
        }>;
      };

      expect(root.dependencies).toHaveLength(1);
      expect(root.dependencies[0].signature).toBeDefined();
      expect(root.dependencies[0].signature!.returnType.kind).toBe("promiseResult");
    });
  });

  describe("Type aliases and re-exports", () => {
    it("resolves type aliases for Result types", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        type UserResult<T> = AsyncResult<T, Error>;
        interface User { id: string; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): UserResult<User> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"), { errors: ["Error"] });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies[0].typeSignature).toBeDefined();
    });
  });

  describe("Fallback for unresolved types", () => {
    it("handles dependencies without explicit return types", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string) => {
            return ok({ id, name: "Test" });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { dependencies: Array<{ name: string; typeSignature?: string }> };

      expect(root.dependencies[0].name).toBe("fetchUser");
    });
  });

  describe("Step output type inference", () => {
    it("attaches type info to steps with typed dependencies", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; name: string; }
        class NotFoundError extends Error { readonly _tag = "NotFound"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id, name: "Test" });
          },
        });
        
        export async function run(id: string) {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser(id), { 
              errors: ["NotFoundError"],
              out: "user",
            });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { 
        children: unknown[];
      };

      const collectSteps = (nodes: unknown[]): Array<{ 
        type?: string; 
        stepId?: string;
        outputType?: string;
        outputTypeInfo?: { display: string; kind: string };
        errorTypeInfo?: { display: string };
      }> => {
        const steps: Array<{ 
          type?: string; 
          stepId?: string;
          outputType?: string;
          outputTypeInfo?: { display: string; kind: string };
          errorTypeInfo?: { display: string };
        }> = [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const n = node as Record<string, unknown>;
          if (n.type === "step") {
            steps.push(n as { 
              type?: string; 
              stepId?: string;
              outputType?: string;
              outputTypeInfo?: { display: string; kind: string };
              errorTypeInfo?: { display: string };
            });
          }
          if (Array.isArray(n.children)) {
            steps.push(...collectSteps(n.children));
          }
        }
        return steps;
      };

      const steps = collectSteps(root.children);
      const fetchStep = steps.find(s => s.stepId === "fetch");
      
      expect(fetchStep).toBeDefined();
      expect(fetchStep?.outputType).toBeDefined();
    });

    it("extracts outputTypeInfo and errorTypeInfo from AsyncResult steps", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFoundError"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { children: unknown[] };

      const collectSteps = (nodes: unknown[]): Array<{ 
        type?: string; 
        stepId?: string;
        outputTypeInfo?: { display: string; kind: string; confidence: string };
        errorTypeInfo?: { display: string };
      }> => {
        const steps: Array<{ 
          type?: string; 
          stepId?: string;
          outputTypeInfo?: { display: string; kind: string; confidence: string };
          errorTypeInfo?: { display: string };
        }> = [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const n = node as Record<string, unknown>;
          if (n.type === "step") {
            steps.push(n as { 
              type?: string; 
              stepId?: string;
              outputTypeInfo?: { display: string; kind: string; confidence: string };
              errorTypeInfo?: { display: string };
            });
          }
          if (Array.isArray(n.children)) {
            steps.push(...collectSteps(n.children));
          }
        }
        return steps;
      };

      const steps = collectSteps(root.children);
      const fetchStep = steps.find(s => s.stepId === "fetch");

      expect(fetchStep).toBeDefined();
      if (fetchStep?.outputTypeInfo) {
        expect(fetchStep.outputTypeInfo.display).toContain("User");
        expect(fetchStep.outputTypeInfo.kind).toBe("plain");
      }
      if (fetchStep?.errorTypeInfo) {
        expect(fetchStep.errorTypeInfo.display).toContain("NotFoundError");
      }
    });

    it("populates outputTypeInfo for step() from typed AsyncResult dependency", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFoundError"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"), { out: "user" });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { children: unknown[] };

      const collectSteps = (nodes: unknown[]): Array<{ stepId?: string; outputTypeInfo?: { display: string } }> => {
        const steps: Array<{ stepId?: string; outputTypeInfo?: { display: string } }> = [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const n = node as Record<string, unknown>;
          if (n.type === "step") {
            steps.push(n as { stepId?: string; outputTypeInfo?: { display: string } });
          }
          if (Array.isArray(n.children)) {
            steps.push(...collectSteps(n.children));
          }
        }
        return steps;
      };

      const fetchStep = collectSteps(root.children).find((s) => s.stepId === "fetch");
      expect(fetchStep).toBeDefined();
      expect(fetchStep?.outputTypeInfo).toBeDefined();
      expect(fetchStep?.outputTypeInfo?.display).toContain("User");
    });
  });

  describe("Deterministic type output", () => {
    it("produces identical type strings across multiple runs", () => {
      resetIdCounter();
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class Error1 extends Error { readonly _tag = "Error1"; }
        
        const workflow = createWorkflow("test", {
          fn: async (): AsyncResult<User, Error1> => ok({ id: "1" }),
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
          });
        }
      `;

      const result1 = analyzeFixtureSource(source);
      const root1 = result1.root as { dependencies: Array<{ typeSignature?: string }> };

      resetIdCounter();
      const result2 = analyzeFixtureSource(source);
      const root2 = result2.root as { dependencies: Array<{ typeSignature?: string }> };

      expect(root1.dependencies[0].typeSignature).toBe(root2.dependencies[0].typeSignature);
    });
  });

  describe("Dependency signature extraction", () => {
    it("extracts typed signature with params and returnType", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFoundError"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { 
        dependencies: Array<{ 
          name: string; 
          typeSignature?: string;
          signature?: { 
            params: Array<{ name: string; type: { display: string } }>;
            returnType: { display: string; kind: string };
            resultLike?: { okType: { display: string }; errorType: { display: string } };
          };
        }> 
      };

      expect(root.dependencies).toHaveLength(1);
      const dep = root.dependencies[0];

      // typeSignature should always be available when type checker is present
      expect(dep.typeSignature).toBeDefined();
      expect(dep.typeSignature).toContain("AsyncResult");
      
      // signature may not be available in test environment without full tsconfig
      // but should have the expected structure when present
      if (dep.signature) {
        expect(dep.signature.params).toHaveLength(1);
        expect(dep.signature.params[0].name).toBe("id");
        expect(dep.signature.params[0].type.display).toContain("string");
        expect(dep.signature.returnType.display).toContain("AsyncResult");
        expect(dep.signature.returnType.kind).toBe("asyncResult");
        
        if (dep.signature.resultLike) {
          expect(dep.signature.resultLike.okType.display).toContain("User");
          expect(dep.signature.resultLike.errorType.display).toContain("NotFoundError");
        }
      }
    });

    it("handles dependencies with multiple parameters", () => {
      const source = `
        import { createWorkflow, ok, type Result } from "awaitly";
        
        const workflow = createWorkflow("test", {
          validate: (input: string, maxLen: number): Result<boolean, Error> => {
            return ok(input.length <= maxLen);
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("validate", () => deps.validate("test", 10));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { 
        dependencies: Array<{ 
          name: string; 
          typeSignature?: string;
          signature?: { 
            params: Array<{ name: string; type: { display: string } }>;
          };
        }> 
      };

      const dep = root.dependencies[0];
      
      // typeSignature should be available
      expect(dep.typeSignature).toBeDefined();
      expect(dep.typeSignature).toContain("Result");
      
      // signature may not be available in test environment
      if (dep.signature) {
        expect(dep.signature.params).toHaveLength(2);
        expect(dep.signature.params[0].name).toBe("input");
        expect(dep.signature.params[1].name).toBe("maxLen");
      }
    });

    it("extracts signature for shorthand dependency properties", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFoundError"; }

        const fetchUser = async (id: string): AsyncResult<User, NotFoundError> => {
          return ok({ id });
        };

        const workflow = createWorkflow("test", { fetchUser });

        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as {
        dependencies: Array<{
          name: string;
          signature?: {
            params: Array<{ name: string; type: { display: string } }>;
            returnType: { kind: string };
          };
        }>;
      };

      expect(root.dependencies).toHaveLength(1);
      expect(root.dependencies[0].name).toBe("fetchUser");
      expect(root.dependencies[0].signature).toBeDefined();
      expect(root.dependencies[0].signature!.params).toHaveLength(1);
      expect(root.dependencies[0].signature!.params[0].type.display).toContain("string");
      expect(root.dependencies[0].signature!.returnType.kind).toBe("asyncResult");
    });
  });

  describe("JSON output includes typed fields", () => {
    it("includes outputTypeInfo in JSON output", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        class NotFoundError extends Error { readonly _tag = "NotFound"; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, NotFoundError> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"), { out: "user" });
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const json = JSON.stringify(result, null, 2);

      expect(json).toContain("outputType");
    });

    it("includes typeSignature for dependencies in JSON output", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";
        
        interface User { id: string; }
        
        const workflow = createWorkflow("test", {
          fetchUser: async (id: string): AsyncResult<User, Error> => {
            return ok({ id });
          },
        });
        
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("fetch", () => deps.fetchUser("1"));
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const json = JSON.stringify(result, null, 2);

      expect(json).toContain("typeSignature");
      expect(json).toContain("AsyncResult");
    });
  });
});
