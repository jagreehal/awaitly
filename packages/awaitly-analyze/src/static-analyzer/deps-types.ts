/**
 * Dependency and type extraction.
 *
 * Extracts workflow dependencies (with typed signatures via the type
 * checker), infers step input/output/error types from inner calls, and
 * enriches the analyzed tree with read/output/error type information.
 */

// Type-only imports - erased at compile time, no runtime dependency
import type { Node } from "ts-morph";
import type * as ts from "typescript";
import { loadTsMorph, loadTypescript } from "../ts-morph-loader";

import { extractResultLike } from "../type-extractor";
import {
  extractFunctionName,
  getStaticChildren,
  type StaticWorkflowNode,
  type StaticFlowNode,
  type StaticStepNode,
  type DependencyInfo,
  type AnalysisWarning,
  type TypeInfo,
} from "../types";

/** Policy wrappers recognized structurally in deps literals. */
const POLICY_KINDS = new Set(["retry", "timeout", "fallback"] as const);
type PolicyKind = "retry" | "timeout" | "fallback";

/**
 * Unwrap per-dep policy calls in a deps-literal initializer:
 * `retry(timeout(fn, 5000), { attempts: 3 })` resolves to the base `fn`
 * expression plus the policy chain in application order (innermost first).
 * Returns undefined when the initializer is not a policy call.
 */
function unwrapPolicyCalls(
  init: Node
): { base: Node; policies: NonNullable<DependencyInfo["policies"]> } | undefined {
  const { Node } = loadTsMorph();
  const policies: NonNullable<DependencyInfo["policies"]> = [];
  let current: Node = init;

  while (Node.isCallExpression(current)) {
    const callee = current.getExpression();
    if (!Node.isIdentifier(callee) || !POLICY_KINDS.has(callee.getText() as PolicyKind)) {
      break;
    }
    const [baseArg, optionsArg] = current.getArguments();
    if (!baseArg) break;
    policies.unshift({
      kind: callee.getText() as PolicyKind,
      options: optionsArg?.getText(),
    });
    current = baseArg;
  }

  if (policies.length === 0) return undefined;
  return { base: current, policies };
}

export function extractDependencies(
  depsNode: Node,
  _warnings: AnalysisWarning[]
): DependencyInfo[] {
  const { Node } = loadTsMorph();
  const dependencies: DependencyInfo[] = [];

  if (!Node.isObjectLiteralExpression(depsNode)) {
    return dependencies;
  }

  for (const prop of depsNode.getProperties()) {
    let name: string;
    let typeSignature: string | undefined;
    let signature: DependencyInfo["signature"] = undefined;
    let policies: DependencyInfo["policies"];

    if (Node.isPropertyAssignment(prop)) {
      name = prop.getName();
      let init: Node | undefined = prop.getInitializer();

      // Policy-wrapped dep: extract types from the BASE function so error
      // inference doesn't depend on resolving the wrapper's generics, and
      // record the policy chain as structural fact for diagrams.
      if (init) {
        const unwrapped = unwrapPolicyCalls(init);
        if (unwrapped) {
          policies = unwrapped.policies;
          init = unwrapped.base;
        }
      }

      if (init && typeof (init as { getType?: () => MorphTypeForExtraction }).getType === "function") {
        try {
          const morphType = (init as { getType: () => MorphTypeForExtraction }).getType();
          typeSignature = morphType.getText();
          signature = extractTypedSignature(init, morphType);
        } catch {
          // Type checker may be unavailable (e.g. no tsconfig); leave typeSignature/signature undefined
        }
      }
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      name = prop.getName();
      const ident = prop.getNameNode();
      if (ident && typeof (ident as { getType?: () => MorphTypeForExtraction }).getType === "function") {
        try {
          const morphType = (ident as { getType: () => MorphTypeForExtraction }).getType();
          typeSignature = morphType.getText();
          signature = extractTypedSignature(ident, morphType);
        } catch {
          // Type checker may be unavailable; leave typeSignature/signature undefined
        }
      }
    } else {
      continue;
    }

    let errorTypes = inferErrorTypesFromSignature(typeSignature);

    // Apply policy error-union math (mirrors the runtime wrappers):
    // retry preserves errors; timeout adds TimeoutError; fallback consumes
    // the base union (only the handler's errors remain, which we cannot
    // reliably extract from text — leave empty rather than guess).
    if (policies) {
      for (const policy of policies) {
        if (policy.kind === "timeout" && !errorTypes.includes("TimeoutError")) {
          errorTypes = [...errorTypes, "TimeoutError"];
        } else if (policy.kind === "fallback") {
          errorTypes = [];
        }
      }
    }

    dependencies.push({
      name,
      typeSignature,
      errorTypes,
      signature,
      ...(policies ? { policies } : {}),
    });
  }

  return dependencies;
}

/**
 * Populate step.readTypes from root.dependencies so data-flow can report type mismatches.
 * Maps each read key to the dependency param type by index (first ref -> first param, etc.).
 */
export function enrichStepReadTypes(root: StaticWorkflowNode): void {
  const depMap = new Map(root.dependencies.map((d) => [d.name, d]));
  function visit(node: StaticFlowNode): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      const reads = step.reads;
      const callee = step.callee ?? step.name;
      if (reads?.length && callee) {
        const dep = depMap.get(callee) ?? depMap.get(extractFunctionName(callee));
        const sig = dep?.signature;
        if (sig?.params?.length) {
          const readTypes: Record<string, TypeInfo> = {};
          const paramIndices = step.readParamIndices;
          reads.forEach((key, i) => {
            const paramIndex = paramIndices?.[i];
            if (paramIndex === undefined) return;
            const param = sig.params[paramIndex];
            if (param?.type) readTypes[key] = param.type;
          });
          if (Object.keys(readTypes).length > 0) step.readTypes = readTypes;
        }
      }
    }
    for (const c of getStaticChildren(node)) visit(c);
  }
  for (const c of root.children) visit(c);
}

/**
 * When inferStepIOFromInnerCall did not resolve (e.g. in-memory source), populate
 * step outputTypeInfo/errorTypeInfo/causeTypeInfo from root.dependencies by matching step callee.
 */
export function enrichStepOutputTypes(root: StaticWorkflowNode): void {
  const depMap = new Map(root.dependencies.map((d) => [d.name, d]));
  function visit(node: StaticFlowNode): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      if (step.outputTypeInfo) return;
      const callee = step.callee ?? step.name;
      if (!callee) return;
      const dep = depMap.get(callee) ?? depMap.get(extractFunctionName(callee));
      const sig = dep?.signature;
      if (!sig?.returnType) return;
      const resultLike = extractResultLikeFromTypeString(sig.returnType.display);
      if (resultLike) {
        step.outputTypeInfo = resultLike.okType;
        step.errorTypeInfo = resultLike.errorType;
        step.causeTypeInfo = resultLike.causeType;
        step.outputTypeKind = "declared";
      }
    }
    for (const c of getStaticChildren(node)) visit(c);
  }
  for (const c of root.children) visit(c);
}

/**
 * When step.errors is not explicitly set but errorTypeInfo has been resolved,
 * populate step.errors from errorTypeInfo.display by splitting union types.
 */
export function inferErrorsFromErrorTypeInfo(root: StaticWorkflowNode): void {
  function visit(node: StaticFlowNode): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      // Don't override explicit errors declaration (including explicit empty array)
      if (step.errors !== undefined) return;

      const errorDisplay = step.errorTypeInfo?.display;
      if (!errorDisplay || errorDisplay === "unknown" || errorDisplay === "never") return;

      const errorNames = splitTopLevelUnion(errorDisplay)
        .filter((s) => s && s !== "unknown" && s !== "never");

      if (errorNames.length > 0) {
        step.errors = errorNames;
        step.errorsSource = "inferred";
      }
    }
    for (const c of getStaticChildren(node)) visit(c);
  }
  for (const c of root.children) visit(c);
}

/**
 * Split a type string on top-level `|` only, respecting angle brackets.
 * e.g. `Envelope<"A" | "B"> | FooError` → [`Envelope<"A" | "B">`, `FooError`]
 */
function splitTopLevelUnion(typeStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < typeStr.length; i++) {
    const ch = typeStr[i];
    if (inString) {
      if (ch === "\\" ) { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "|" && depth === 0) {
      parts.push(typeStr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(typeStr.slice(start).trim());
  return parts;
}

/** Built-in step callees: use stepKind for display, not depSource. */
const BUILTIN_STEP_CALLEES = new Set([
  "step.sleep",
  "step.withResource",
  "step.retry",
  "step.withTimeout",
  "step.try",
  "step.fromResult",
]);

/**
 * Ensure every step has a display source: depSource (workflow dep) or stepKind (built-in).
 * For built-in steps (sleep, withResource, etc.) sets stepKind when missing; for others sets depSource from callee.
 */
export function enrichStepDepSource(root: StaticWorkflowNode): void {
  function visit(node: StaticFlowNode): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      if (!step.callee) return;
      const kind = extractFunctionName(step.callee);
      if (BUILTIN_STEP_CALLEES.has(step.callee)) {
        if (!step.stepKind) step.stepKind = kind;
      } else if (!step.depSource) {
        step.depSource = kind;
      }
    }
    for (const c of getStaticChildren(node)) visit(c);
  }
  for (const c of root.children) visit(c);
}

/** Ts-morph Type shape: getText() and compiler type for type-extractor. */
type MorphTypeForExtraction = { getText: () => string; compilerType: ts.Type };

function extractTypedSignature(
  node: Node,
  morphType: MorphTypeForExtraction
): DependencyInfo["signature"] {
  const tsLib = loadTypescript();

  const tsNode = (node as unknown as { compilerNode: ts.Node }).compilerNode;
  if (!tsNode) return undefined;

  const kind = tsNode.kind;
  const isFunctionLike =
    kind === tsLib.SyntaxKind.FunctionDeclaration ||
    kind === tsLib.SyntaxKind.ArrowFunction ||
    kind === tsLib.SyntaxKind.FunctionExpression ||
    kind === tsLib.SyntaxKind.MethodDeclaration;

  try {
    const project = node.getSourceFile().getProject();
    const typeChecker = project.getTypeChecker();
    const tc = typeChecker.compilerObject as ts.TypeChecker;

    let sig: ts.Signature | undefined;
    if (isFunctionLike) {
      sig = tc.getSignatureFromDeclaration(tsNode as ts.SignatureDeclaration);
    } else if (kind === tsLib.SyntaxKind.Identifier) {
      // Shorthand property: { fetchUser } – use ts-morph type and pass compiler type for extraction
      const type = morphType.compilerType;
      const callSigs = type.getCallSignatures?.();
      sig = callSigs?.length ? callSigs[0] : undefined;
    }
    if (!sig) return undefined;

    const params = sig.getParameters().map((param, index) => {
      const decl = param.valueDeclaration;
      const paramType = decl
        ? tc.getTypeOfSymbolAtLocation(param, decl)
        : tc.getAnyType();
      const paramTypeString = tc.typeToString(paramType);
      return {
        name: param.getName() ?? `param${index}`,
        type: {
          display: paramTypeString,
          canonical: paramTypeString.replace(/\s+/g, " ").trim(),
          kind: "plain" as const,
          confidence: "exact" as const,
          source: "checker" as const,
        },
      };
    });

    const returnType = sig.getReturnType();
    const returnTypeString = tc.typeToString(returnType);

    const returnTypeInfo: TypeInfo = {
      display: returnTypeString,
      canonical: returnTypeString.replace(/\s+/g, " ").trim(),
      kind: detectTypeKindFromString(returnTypeString),
      confidence: "exact",
      source: "checker",
    };

    const resultLike = extractResultLike(returnType, tc);

    return {
      params,
      returnType: returnTypeInfo,
      resultLike: resultLike ? {
        okType: resultLike.okType,
        errorType: resultLike.errorType,
        causeType: resultLike.causeType,
      } : undefined,
    };
  } catch {
    return undefined;
  }
}

function detectTypeKindFromString(typeString: string): TypeInfo["kind"] {
  if (typeString.includes("AsyncResult")) return "asyncResult";
  if (typeString.includes("Promise<Result")) return "promiseResult";
  if (typeString.includes("Result")) return "result";
  return "plain";
}

/**
 * Best-effort: infer error type union from Result<T, E> in a type signature string.
 * Handles Promise<Result<T, E>> and Result<T, E>. Extracts string literal union members.
 * T may contain commas (e.g. tuple [number, string]), so we only treat a comma at
 * depth 1 (outside any nested <>, [], {}, ()) as the T/E separator.
 */
function inferErrorTypesFromSignature(typeSignature: string | undefined): string[] {
  if (!typeSignature) return [];
  const resultMatch = typeSignature.match(/Result\s*</);
  if (!resultMatch) return [];
  const start = resultMatch.index! + resultMatch[0].length;
  let depth = 1;
  let i = start;
  let firstComma = -1;
  while (i < typeSignature.length && depth > 0) {
    const c = typeSignature[i];
    if (c === "<" || c === "[" || c === "{" || c === "(") depth++;
    else if (c === ">" || c === "]" || c === "}" || c === ")") depth--;
    else if (c === "," && depth === 1 && firstComma < 0) firstComma = i;
    i++;
  }
  if (firstComma < 0 || depth !== 0) return [];
  const secondArg = typeSignature.slice(firstComma + 1, i - 1).trim();
  const parts = secondArg.split(/\s*\|\s*/).map((s) => s.trim().replace(/^["']|["']$/g, ""));
  return parts.filter((s) => s.length > 0 && /^[A-Z_][A-Z0-9_]*$/i.test(s));
}

export function extractErrorTypes(dependencies: DependencyInfo[]): string[] {
  const errorTypes = new Set<string>();
  for (const dep of dependencies) {
    for (const error of dep.errorTypes) {
      errorTypes.add(error);
    }
  }
  return Array.from(errorTypes);
}

/**
 * Best-effort: infer stepNode.outputType and stepNode.inputType from the inner call.
 * Uses ts-morph's getType() for the call's return type (passed to type-extractor); uses
 * getResolvedSignature(compilerNode) only for parameter types (inputType).
 * For step.retry/withTimeout/try/fromResult we use the inner operation's type. When that
 * stays unknown/any or does not extract as Result-like, we refine by following the
 * callee's type (e.g. deps.fetchData) and use its call signature's return type.
 */
export function inferStepIOFromInnerCall(
  contextNode: Node,
  innerCallNode: Node | undefined,
  stepNode: StaticStepNode
): void {
  const { Node } = loadTsMorph();
  if (!innerCallNode || !Node.isCallExpression(innerCallNode)) return;
  try {
    const project = contextNode.getSourceFile().getProject();
    const typeChecker = project.getTypeChecker();
    const tc = typeChecker.compilerObject as ts.TypeChecker;
    const tsNode = (innerCallNode as { compilerNode: ts.CallExpression }).compilerNode;

    // Return type via ts-morph so we pass a single ts.Type into type-extractor
    const morphReturnType = innerCallNode.getType() as MorphTypeForExtraction;
    const returnType = morphReturnType.compilerType;
    stepNode.outputType = morphReturnType.getText();

    let resultLike = extractResultLike(returnType, tc);
    const needsRefinement =
      !resultLike ||
      stepNode.outputType === "any" ||
      stepNode.outputType === "unknown";

    if (needsRefinement) {
      // Refine by following the callee: type of deps.fetchData -> call signature -> return type
      const calleeTsNode = tsNode.expression;
      const calleeType = tc.getTypeAtLocation(calleeTsNode);
      const callSigs = calleeType.getCallSignatures?.() ?? [];
      const sig = callSigs[0];
      if (sig) {
        const refinedReturnType = sig.getReturnType();
        const refinedTypeStr = tc.typeToString(refinedReturnType);
        stepNode.outputType = refinedTypeStr;
        resultLike = extractResultLike(refinedReturnType, tc);
      }
    }

    if (resultLike) {
      stepNode.outputTypeInfo = resultLike.okType;
      stepNode.errorTypeInfo = resultLike.errorType;
      stepNode.causeTypeInfo = resultLike.causeType;
      stepNode.outputTypeKind = "declared";
    } else {
      stepNode.outputTypeKind =
        stepNode.outputType === "any" ? "unknown" : "inferred";
    }

    // Parameter types: resolved signature from call, or fallback to callee's first signature
    let sig = tc.getResolvedSignature(tsNode);
    if (!sig) {
      const calleeTsNode = tsNode.expression;
      const calleeType = tc.getTypeAtLocation(calleeTsNode);
      const callSigs = calleeType.getCallSignatures?.() ?? [];
      sig = callSigs[0];
    }
    if (sig) {
      const decl = sig.getDeclaration();
      if (decl && "parameters" in decl && Array.isArray((decl as ts.SignatureDeclaration).parameters)) {
        const params = (decl as ts.SignatureDeclaration).parameters;
        if (params.length > 0) {
          const parts = params
            .map((p: ts.ParameterDeclaration) => (p.type ? tc.getTypeFromTypeNode(p.type) : null))
            .filter((t: ts.Type | null): t is ts.Type => t != null)
            .map((t: ts.Type) => tc.typeToString(t));
          if (parts.length > 0) stepNode.inputType = parts.join(", ");
        }
      }
    }
  } catch {
    // Type checker may be unavailable or call not resolved
  }
}

/**
 * Extract Result-like ok/error/cause types from a type string (e.g. from dependency returnType.display).
 * Handles AsyncResult<T,E,C>, Promise<Result<...>>, Promise<AsyncResult<...>>, and Result<T,E,C>.
 * Uses bracket-aware parsing to handle nested generics like Envelope<"A" | "B">.
 */
function extractResultLikeFromTypeString(
  typeString: string
): { okType: TypeInfo; errorType: TypeInfo; causeType?: TypeInfo } | null {
  // Unwrap Promise< ... > if present
  let inner = typeString;
  const promiseMatch = typeString.match(/^Promise<\s*([\s\S]+)\s*>$/);
  if (promiseMatch) inner = promiseMatch[1].trim();

  // Match AsyncResult< or Result< prefix
  let kind: "asyncResult" | "result" | "promiseResult";
  let argsStart: number;
  const asyncResultIdx = inner.indexOf("AsyncResult<");
  const resultIdx = inner.indexOf("Result<");
  if (asyncResultIdx !== -1) {
    kind = promiseMatch ? "asyncResult" : "asyncResult";
    argsStart = asyncResultIdx + "AsyncResult<".length;
  } else if (resultIdx !== -1) {
    kind = promiseMatch ? "promiseResult" : "result";
    argsStart = resultIdx + "Result<".length;
  } else {
    return null;
  }

  // Extract the content between the outermost < > of the Result type
  // by finding the matching closing >
  let depth = 1;
  let argsEnd = argsStart;
  for (let i = argsStart; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") { depth--; if (depth === 0) { argsEnd = i; break; } }
  }
  const argsStr = inner.slice(argsStart, argsEnd);

  // Split on top-level commas (respecting nested brackets)
  const args = splitTopLevelCommas(argsStr);
  if (args.length < 2) return null;

  return {
    okType: createTypeInfoFromString(args[0], kind),
    errorType: createTypeInfoFromString(args[1], kind),
    causeType: args[2] ? createTypeInfoFromString(args[2], kind) : undefined,
  };
}

/**
 * Split a type string on top-level commas, respecting angle brackets and parens.
 */
function splitTopLevelCommas(typeStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < typeStr.length; i++) {
    const ch = typeStr[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(typeStr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(typeStr.slice(start).trim());
  return parts;
}

function createTypeInfoFromString(typeStr: string, _parentKind: "asyncResult" | "result" | "promiseResult"): TypeInfo {
  return {
    display: typeStr,
    canonical: typeStr.replace(/\s+/g, " ").trim(),
    kind: "plain",
    confidence: "inferred",
    source: "checker",
  };
}
