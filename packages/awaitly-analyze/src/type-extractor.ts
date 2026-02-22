/**
 * Type Extraction Layer
 *
 * Provides reusable helpers for extracting Result-like type information
 * from TypeScript type checker. Handles:
 * - AsyncResult<T, E, C>
 * - Result<T, E, C>
 * - Promise<Result<T, E, C>>
 * - Aliases and re-exports
 * - Fallback for unresolved types
 */

import * as ts from "typescript";

export interface ExtractedResultLike {
  okType: TypeInfo;
  errorType: TypeInfo;
  causeType?: TypeInfo;
  kind: "asyncResult" | "result" | "promiseResult";
}

export interface TypeInfo {
  display: string;
  canonical: string;
  kind: "asyncResult" | "result" | "promiseResult" | "plain" | "unknown";
  confidence: "exact" | "inferred" | "fallback";
  source: "checker" | "annotation" | "fallback";
}

export interface SignatureInfo {
  params: Array<{ name: string; type: TypeInfo }>;
  returnType: TypeInfo;
  resultLike?: ExtractedResultLike;
}

export interface TypeExtractorOptions {
  strictTypes?: boolean;
}

const _RESULT_TYPE_NAMES = new Set([
  "AsyncResult",
  "Result",
  "ResultAsync",
]);

const _AWAITLY_MODULES = new Set([
  "awaitly",
  "awaitly/result",
  "neverthrow",
]);

export function extractResultLike(
  type: ts.Type,
  checker: ts.TypeChecker,
  _options: TypeExtractorOptions = {}
): ExtractedResultLike | null {

  if (isAsyncResult(type, checker)) {
    return extractAsyncResultGenerics(type, checker);
  }

  if (isResult(type, checker)) {
    return extractResultGenerics(type, checker);
  }

  if (isPromiseResult(type, checker)) {
    return extractPromiseResultGenerics(type, checker);
  }

  return null;
}

function isAsyncResult(type: ts.Type, checker: ts.TypeChecker): boolean {
  const typeString = checker.typeToString(type);
  if (typeString.startsWith("AsyncResult<")) return true;

  const symbol = type.getSymbol();
  if (symbol?.getName() === "AsyncResult") return true;

  if (type.isIntersection?.()) {
    return type.types.some(t => isAsyncResult(t, checker));
  }

  return false;
}

function isResult(type: ts.Type, checker: ts.TypeChecker): boolean {
  const typeString = checker.typeToString(type);
  if (typeString.startsWith("Result<")) return true;

  const symbol = type.getSymbol();
  if (symbol?.getName() === "Result") return true;

  if (type.isIntersection?.()) {
    return type.types.some(t => isResult(t, checker));
  }

  return false;
}

function isPromiseResult(type: ts.Type, checker: ts.TypeChecker): boolean {
  const typeString = checker.typeToString(type);
  if (typeString.startsWith("Promise<Result<")) return true;
  if (typeString.startsWith("PromiseLike<Result<")) return true;

  return false;
}

function extractAsyncResultGenerics(
  type: ts.Type,
  checker: ts.TypeChecker
): ExtractedResultLike {
  const typeArgs = getTypeArguments(type, checker);

  return {
    okType: createTypeInfo(typeArgs[0], checker, "asyncResult"),
    errorType: createTypeInfo(typeArgs[1], checker, "asyncResult"),
    causeType: typeArgs[2] ? createTypeInfo(typeArgs[2], checker, "asyncResult") : undefined,
    kind: "asyncResult",
  };
}

function extractResultGenerics(
  type: ts.Type,
  checker: ts.TypeChecker
): ExtractedResultLike {
  const typeArgs = getTypeArguments(type, checker);

  return {
    okType: createTypeInfo(typeArgs[0], checker, "result"),
    errorType: createTypeInfo(typeArgs[1], checker, "result"),
    causeType: typeArgs[2] ? createTypeInfo(typeArgs[2], checker, "result") : undefined,
    kind: "result",
  };
}

function extractPromiseResultGenerics(
  type: ts.Type,
  checker: ts.TypeChecker
): ExtractedResultLike | null {
  const typeArgs = getTypeArguments(type, checker);

  if (!typeArgs[0]) return null;

  const innerType = typeArgs[0];
  if (isResult(innerType, checker)) {
    const resultGenerics = extractResultGenerics(innerType, checker);
    return {
      ...resultGenerics,
      kind: "promiseResult",
    };
  }

  return null;
}

/** TypeScript compiler types may have type arguments; public Type interface doesn't declare them. */
interface TypeWithArguments extends ts.Type {
  typeArguments?: ts.Type[];
  aliasTypeArguments?: ts.Type[];
  resolvedTypeArguments?: readonly ts.Type[];
}

function getTypeArguments(type: ts.Type, _checker: ts.TypeChecker): ts.Type[] {
  const t = type as TypeWithArguments;
  if (t.typeArguments?.length) return t.typeArguments;
  if (t.aliasTypeArguments?.length) return t.aliasTypeArguments;
  if (t.resolvedTypeArguments?.length) return [...t.resolvedTypeArguments];
  return [];
}

function createTypeInfo(
  type: ts.Type | undefined,
  checker: ts.TypeChecker,
  _parentKind: "asyncResult" | "result" | "promiseResult"
): TypeInfo {
  if (!type) {
    return {
      display: "unknown",
      canonical: "unknown",
      kind: "unknown",
      confidence: "fallback",
      source: "fallback",
    };
  }

  const display = checker.typeToString(type);
  const canonical = normalizeTypeString(type, checker);

  return {
    display,
    canonical,
    kind: "plain",
    confidence: "exact",
    source: "checker",
  };
}

export function extractNodeType(
  node: ts.Node,
  checker: ts.TypeChecker,
  _options: TypeExtractorOptions = {}
): TypeInfo {
  const type = checker.getTypeAtLocation(node);
  const display = checker.typeToString(type);
  const canonical = normalizeTypeString(type, checker);

  const kind = detectTypeKind(type, checker);

  return {
    display,
    canonical,
    kind,
    confidence: "exact",
    source: "checker",
  };
}

function detectTypeKind(
  type: ts.Type,
  checker: ts.TypeChecker
): TypeInfo["kind"] {
  if (isAsyncResult(type, checker)) return "asyncResult";
  if (isResult(type, checker)) return "result";
  if (isPromiseResult(type, checker)) return "promiseResult";

  const typeString = checker.typeToString(type);
  if (typeString.includes("AsyncResult")) return "asyncResult";
  if (typeString.includes("Promise<Result")) return "promiseResult";
  if (typeString.includes("Result")) return "result";

  return "plain";
}

export function extractFunctionSignature(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  options: TypeExtractorOptions = {}
): SignatureInfo | null {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return null;

  const decl = declarations[0];

  if (!isFunctionLike(decl, checker)) return null;

  const signature = checker.getSignatureFromDeclaration(decl as ts.SignatureDeclaration);
  if (!signature) return null;

  const params = signature.getParameters().map((param) => ({
    name: param.getName(),
    type: extractNodeType(param.valueDeclaration!, checker, options),
  }));

  const returnType = signature.getReturnType();
  const returnTypeInfo: TypeInfo = {
    display: checker.typeToString(returnType),
    canonical: normalizeTypeString(returnType, checker),
    kind: detectTypeKind(returnType, checker),
    confidence: "exact",
    source: "checker",
  };

  const resultLike = extractResultLike(returnType, checker, options);

  return {
    params,
    returnType: returnTypeInfo,
    resultLike: resultLike ?? undefined,
  };
}

function isFunctionLike(node: ts.Node, _checker: ts.TypeChecker): boolean {
  const kind = node.kind;
  return (
    kind === ts.SyntaxKind.FunctionDeclaration ||
    kind === ts.SyntaxKind.ArrowFunction ||
    kind === ts.SyntaxKind.FunctionExpression ||
    kind === ts.SyntaxKind.MethodDeclaration
  );
}

export function normalizeTypeString(type: ts.Type, checker: ts.TypeChecker): string {
  let typeString = checker.typeToString(type);

  typeString = typeString.replace(/\s+/g, " ").trim();

  typeString = typeString.replace(/import\(".*?"\)\./g, "");

  typeString = typeString.replace(/\s*,\s*/g, ", ");
  typeString = typeString.replace(/\s*<\s*/g, "<");
  typeString = typeString.replace(/\s*>\s*/g, ">");

  return typeString;
}

export function extractTypeFromNode(
  node: ts.Node,
  checker: ts.TypeChecker,
  options: TypeExtractorOptions = {}
): TypeInfo {
  try {
    return extractNodeType(node, checker, options);
  } catch {
    return {
      display: "unknown",
      canonical: "unknown",
      kind: "unknown",
      confidence: "fallback",
      source: "fallback",
    };
  }
}

export function extractResultLikeFromType(
  typeString: string
): { okType: string; errorType: string; causeType?: string } | null {
  const asyncResultMatch = typeString.match(/AsyncResult<\s*([^,]+)\s*,\s*([^,>]+)(?:\s*,\s*([^>]+))?\s*>/);
  if (asyncResultMatch) {
    return {
      okType: asyncResultMatch[1].trim(),
      errorType: asyncResultMatch[2].trim(),
      causeType: asyncResultMatch[3]?.trim(),
    };
  }

  const resultMatch = typeString.match(/Result<\s*([^,]+)\s*,\s*([^,>]+)(?:\s*,\s*([^>]+))?\s*>/);
  if (resultMatch) {
    return {
      okType: resultMatch[1].trim(),
      errorType: resultMatch[2].trim(),
      causeType: resultMatch[3]?.trim(),
    };
  }

  return null;
}
