/**
 * Step options and documentation parsing.
 *
 * Extracts step('id', fn, opts) options objects, workflow options
 * (description/markdown/strict/errors), retry/timeout configs, literal
 * values, JSDoc descriptions/tags, and dep definition locations.
 */

// Type-only imports - erased at compile time, no runtime dependency
import type { Node } from "ts-morph";
import type * as ts from "typescript";
import { loadTsMorph } from "../ts-morph-loader";

import {
  type SourceLocation,
  type StaticRetryConfig,
  type StaticStepNode,
  type StaticTimeoutConfig,
} from "../types";

import { getLocation, type AnalyzerOptions } from "./shared";

/**
 * Extract description and markdown from workflow options.
 * Can be in either the deps object or a separate options object.
 */
export function extractWorkflowDocumentation(optionsNode: Node): {
  description?: string;
  markdown?: string;
} {
  const { Node } = loadTsMorph();
  const result: { description?: string; markdown?: string } = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return result;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "description" && init) {
      result.description = extractStringValue(init);
    } else if (propName === "markdown" && init) {
      result.markdown = extractStringValue(init);
    }
  }

  return result;
}

/**
 * Extract strict mode options from workflow options.
 */
export function extractWorkflowStrictOptions(optionsNode: Node): {
  strict?: boolean;
  declaredErrors?: string[];
} {
  const { Node } = loadTsMorph();
  const result: { strict?: boolean; declaredErrors?: string[] } = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return result;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "strict" && init) {
      if (Node.isTrueLiteral(init)) {
        result.strict = true;
      } else if (Node.isFalseLiteral(init)) {
        result.strict = false;
      }
    } else if (propName === "errors" && init) {
      result.declaredErrors = extractErrorsArray(init);
    }
  }

  return result;
}

/**
 * Attach JSDoc metadata from the containing statement and the dep's
 * definition location to a step node. Shared by the classic step analyzer
 * (analyzeStepCall) and the bound-step analyzer (analyzeBoundStepCall).
 */
export function attachStepDocsAndDepLocation(
  stepNode: StaticStepNode,
  node: Node,
  innerCallNode: Node | undefined,
  opts: Required<AnalyzerOptions>
): void {
  const { Node } = loadTsMorph();

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
  }

  if (opts.includeLocations && innerCallNode && Node.isCallExpression(innerCallNode)) {
    const calleeExpr = innerCallNode.getExpression();
    stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
  }
}

/**
 * Step options we extract from step('id', fn, opts).
 * Aligns with awaitly: step identity/name is always the first argument, never in opts.
 * Same in awaitly: step('id', ...), step.sleep/retry/withTimeout/try/fromResult('id', ...),
 * step.parallel(name, ...), step.race(name, ...), saga.step(name, ...), saga.tryStep(name, ...).
 */
export interface StepOptions {
  key?: string;
  description?: string;
  markdown?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
  errors?: string[];
  out?: string;
  dep?: string;
  reads?: string[];
  intent?: string;
  domain?: string;
  owner?: string;
  tags?: string[];
  stateChanges?: string[];
  emits?: string[];
  calls?: string[];
  errorMeta?: Record<
    string,
    { retryable?: boolean; severity?: string; description?: string }
  >;
  ttl?: number | "<dynamic>";
}

export function extractStepOptions(optionsNode: Node): StepOptions {
  const { Node } = loadTsMorph();
  const options: StepOptions = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return options;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    // Intentionally do not extract "name": in awaitly, step name/ID is always the first argument.
    if (propName === "name") continue;

    if (propName === "key" && init) {
      options.key = extractStringValue(init);
    } else if (propName === "description" && init) {
      options.description = extractStringValue(init);
    } else if (propName === "markdown" && init) {
      options.markdown = extractStringValue(init);
    } else if (propName === "retry" && init && Node.isObjectLiteralExpression(init)) {
      options.retry = extractRetryConfig(init);
    } else if (propName === "timeout" && init && Node.isObjectLiteralExpression(init)) {
      options.timeout = extractTimeoutConfig(init);
    } else if (propName === "errors" && init) {
      // Extract errors array: errors: ['A', 'B'] or errors: tags('A', 'B') or errors: someConst
      options.errors = extractErrorsArray(init);
    } else if (propName === "out" && init) {
      options.out = extractStringValue(init);
    } else if (propName === "dep" && init) {
      options.dep = extractStringValue(init);
    } else if (propName === "reads" && init) {
      // Extract reads array: reads: ['a', 'b']
      options.reads = extractStringArrayValue(init);
    } else if (propName === "intent" && init) {
      options.intent = extractStringValue(init);
    } else if (propName === "domain" && init) {
      options.domain = extractStringValue(init);
    } else if (propName === "owner" && init) {
      options.owner = extractStringValue(init);
    } else if (propName === "tags" && init) {
      options.tags = extractStringArrayValue(init);
    } else if (propName === "stateChanges" && init) {
      options.stateChanges = extractStringArrayValue(init);
    } else if (propName === "emits" && init) {
      options.emits = extractStringArrayValue(init);
    } else if (propName === "calls" && init) {
      options.calls = extractStringArrayValue(init);
    } else if (
      propName === "errorMeta" &&
      init &&
      Node.isObjectLiteralExpression(init)
    ) {
      options.errorMeta = extractErrorMeta(init);
    } else if (propName === "ttl" && init) {
      options.ttl = extractNumberValue(init);
    }
  }

  return options;
}

function extractErrorMeta(
  node: Node
):
  | Record<
      string,
      { retryable?: boolean; severity?: string; description?: string }
    >
  | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isObjectLiteralExpression(node)) return undefined;

  const meta: Record<
    string,
    { retryable?: boolean; severity?: string; description?: string }
  > = {};

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const errorKey = prop.getName();
    const init = prop.getInitializer();
    if (!init || !Node.isObjectLiteralExpression(init)) continue;

    const entry: {
      retryable?: boolean;
      severity?: string;
      description?: string;
    } = {};
    for (const subProp of init.getProperties()) {
      if (!Node.isPropertyAssignment(subProp)) continue;
      const subName = subProp.getName();
      const subInit = subProp.getInitializer();
      if (!subInit) continue;

      if (subName === "retryable") {
        entry.retryable = extractBooleanValue(subInit);
      } else if (subName === "severity") {
        const val = extractStringValue(subInit);
        if (val && val !== "<dynamic>") entry.severity = val;
      } else if (subName === "description") {
        const val = extractStringValue(subInit);
        if (val && val !== "<dynamic>") entry.description = val;
      }
    }
    meta[errorKey] = entry;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Extract a string array from an array literal: ['a', 'b']
 */
function extractStringArrayValue(node: Node): string[] | undefined {
  const { Node } = loadTsMorph();

  if (Node.isArrayLiteralExpression(node)) {
    const values: string[] = [];
    for (const element of node.getElements()) {
      const val = extractStringValue(element);
      if (val && val !== "<dynamic>") {
        values.push(val);
      }
    }
    return values.length > 0 ? values : undefined;
  }

  // Identifier - try to resolve const in same file
  if (Node.isIdentifier(node)) {
    const resolved = resolveConstValue(node);
    if (resolved) {
      return extractStringArrayValue(resolved);
    }
  }

  return undefined;
}

/**
 * Extract errors array from various forms:
 * - Array literal: ['A', 'B']
 * - tags() call: tags('A', 'B')
 * - err() call: err('A', 'B')
 * - Identifier (const reference): someErrors
 */
export function extractErrorsArray(node: Node): string[] | undefined {
  const { Node } = loadTsMorph();

  // Array literal: ['A', 'B'] or []
  // Return empty array for explicit [], not undefined (distinguishes from "not declared")
  if (Node.isArrayLiteralExpression(node)) {
    const errors: string[] = [];
    for (const element of node.getElements()) {
      const val = extractStringValue(element);
      if (val && val !== "<dynamic>") {
        errors.push(val);
      }
    }
    return errors;
  }

  // tags() or err() call: tags('A', 'B') or tags()
  // Return empty array for explicit tags(), not undefined
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const calleeName = callee.getText();
    if (calleeName === "tags" || calleeName === "err") {
      const errors: string[] = [];
      for (const arg of node.getArguments()) {
        const val = extractStringValue(arg);
        if (val && val !== "<dynamic>") {
          errors.push(val);
        }
      }
      return errors;
    }
  }

  // Identifier - try to resolve const in same file
  if (Node.isIdentifier(node)) {
    const resolved = resolveConstValue(node);
    if (resolved) {
      return extractErrorsArray(resolved);
    }
  }

  return undefined;
}

/**
 * Try to resolve a const identifier to its initializer value.
 * Only works for same-file const declarations.
 */
function resolveConstValue(identifier: Node): Node | undefined {
  const { Node } = loadTsMorph();

  if (!Node.isIdentifier(identifier)) {
    return undefined;
  }

  const sourceFile = identifier.getSourceFile();
  const name = identifier.getText();

  // Look for const declaration in the same file
  for (const stmt of sourceFile.getStatements()) {
    if (Node.isVariableStatement(stmt)) {
      const declList = stmt.getDeclarationList();
      // Only resolve const declarations
      if (declList.getDeclarationKind() !== "const") {
        continue;
      }
      for (const decl of declList.getDeclarations()) {
        if (decl.getName() === name) {
          return decl.getInitializer();
        }
      }
    }
  }

  return undefined;
}

export function extractRetryConfig(node: Node): StaticRetryConfig {
  const { Node } = loadTsMorph();
  const config: StaticRetryConfig = {};

  if (!Node.isObjectLiteralExpression(node)) {
    return config;
  }

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "attempts" && init) {
      config.attempts = extractNumberValue(init);
    } else if (propName === "backoff" && init) {
      const val = extractStringValue(init);
      if (val === "fixed" || val === "linear" || val === "exponential") {
        config.backoff = val;
      } else {
        config.backoff = "<dynamic>";
      }
    } else if (propName === "baseDelay" && init) {
      config.baseDelay = extractNumberValue(init);
    } else if (propName === "retryOn" && init) {
      config.retryOn = init.getText();
    } else if (propName === "initialDelay" && init) {
      config.initialDelay = extractNumberValue(init);
    } else if (propName === "maxDelay" && init) {
      config.maxDelay = extractNumberValue(init);
    } else if (propName === "jitter" && init) {
      config.jitter = extractBooleanValue(init) ?? "<dynamic>";
    }
  }

  return config;
}

export function extractTimeoutConfig(node: Node): StaticTimeoutConfig {
  const { Node } = loadTsMorph();
  const config: StaticTimeoutConfig = {};

  if (!Node.isObjectLiteralExpression(node)) {
    return config;
  }

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "ms" && init) {
      config.ms = extractNumberValue(init);
    } else if (propName === "signal" && init) {
      config.signal = extractBooleanValue(init) ?? "<dynamic>";
    } else if (propName === "onTimeout" && init) {
      const val = extractStringValue(init);
      if (val === "error" || val === "option" || val === "disconnect") {
        config.onTimeout = val;
      } else {
        config.onTimeout = "<dynamic>";
      }
    }
  }

  return config;
}

export function extractStringValue(node: Node): string {
  const { Node } = loadTsMorph();
  if (Node.isStringLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isTemplateExpression(node)) {
    return "<dynamic>";
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return node.getText();
}

function extractNumberValue(node: Node): number | "<dynamic>" {
  const { Node } = loadTsMorph();
  if (Node.isNumericLiteral(node)) {
    return node.getLiteralValue();
  }
  return "<dynamic>";
}

function extractBooleanValue(node: Node): boolean | undefined {
  const { Node } = loadTsMorph();
  if (Node.isTrueLiteral(node)) return true;
  if (Node.isFalseLiteral(node)) return false;
  return undefined;
}

/**
 * Resolve the definition location of a callee expression (e.g. deps.getBatch).
 * Uses the type checker: symbol at location, or for property access the type's symbol.
 */
export function getDefinitionLocationForCallee(calleeNode: Node): SourceLocation | undefined {
  const { Node } = loadTsMorph();
  try {
    const project = calleeNode.getSourceFile().getProject();
    const typeChecker = project.getTypeChecker();
    const tsNode = calleeNode as Parameters<typeof typeChecker.getSymbolAtLocation>[0];
    let sym = typeChecker.getSymbolAtLocation(tsNode);
    if (!sym && Node.isPropertyAccessExpression(calleeNode)) {
      const nameNode = calleeNode.getNameNode();
      if (nameNode) sym = typeChecker.getSymbolAtLocation(nameNode as typeof tsNode);
    }
    if (!sym) {
      const type = (calleeNode.getType() as { compilerType: ts.Type }).compilerType;
      if (type) {
        const maybeSym = type.getSymbol?.() ?? (type as { symbol?: unknown }).symbol;
        if (maybeSym) sym = maybeSym as ReturnType<typeof typeChecker.getSymbolAtLocation>;
      }
    }
    if (!sym) return undefined;
    const decls = sym.getDeclarations();
    if (!decls?.length) return undefined;
    const decl = decls[0];
    const tsDecl = (decl as unknown as { compilerNode?: ts.Node }).compilerNode ?? (decl as unknown as ts.Node);
    const sf = tsDecl.getSourceFile();
    const start = tsDecl.getStart();
    const end = tsDecl.getEnd();
    const startPos = sf.getLineAndCharacterOfPosition(start);
    const endPos = sf.getLineAndCharacterOfPosition(end);
    return {
      filePath: sf.fileName,
      line: startPos.line + 1,
      column: startPos.character,
      endLine: endPos.line + 1,
      endColumn: endPos.character,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get the statement that contains the given node (e.g. ExpressionStatement for `await step(...)`).
 */
export function getContainingStatement(node: Node): Node | undefined {
  const { Node } = loadTsMorph();
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (!parent) return current;
    if (Node.isExpressionStatement(parent) || Node.isVariableStatement(parent)) return parent;
    if (Node.isBlock(parent)) return current;
    current = parent;
  }
  return undefined;
}

/**
 * Parse JSDoc comment text to extract description (text before first @tag).
 */
function parseJSDocCommentText(text: string): string | undefined {
  const inner = text
    .replace(/^\s*\/\*\*?\s*/, "")
    .replace(/\s*\*\/\s*$/, "")
    .replace(/^\s*\*\s?/gm, "\n")
    .trim();
  const beforeAt = inner.split(/\s*@/)[0].trim();
  return beforeAt || undefined;
}

/** Structured JSDoc tags for steps/workflows */
export interface JSDocTagsResult {
  params?: Array<{ name: string; description?: string }>;
  returns?: string;
  throws?: string[];
  example?: string;
}

/**
 * Extract JSDoc @param, @returns, @throws, @example from a node that has getJsDocs().
 */
export function getJSDocTagsFromNode(node: Node): JSDocTagsResult | undefined {
  const n = node as {
    getJsDocs?: () => Array<{
      getTags?: () => Array<{ getTagName?: () => string; getText: () => string }>;
    }>;
  };
  if (typeof n.getJsDocs !== "function") return undefined;
  try {
    const docs = n.getJsDocs();
    if (!docs || docs.length === 0) return undefined;
    const first = docs[0];
    const tags = first.getTags?.();
    if (!tags || tags.length === 0) return undefined;

    const result: JSDocTagsResult = {};
    for (const tag of tags) {
      const raw = tag.getTagName?.() ?? (tag as { getName?: () => string }).getName?.();
      const tagName = typeof raw === "string" ? raw.toLowerCase() : undefined;
      const text = tag.getText().trim();
      if (!tagName) continue;
      if (tagName === "param" || tagName === "argument" || tagName === "arg") {
        // JSDoc: @param [type] name - desc or @param [type] [name] - desc (optional param). Capture name without brackets.
        const match = text.match(/^(?:@?\w+\s+)?(?:\{[^}]*\}\s*)?\[?(\w+)\]?\s*[-–—]\s*(.*)$/s);
        const words = text.split(/\s+/);
        const tagWords = ["@param", "param", "@argument", "argument", "@arg", "arg"];
        const isTypeToken = (w: string) => /^\{.*\}$/.test(w);
        const nameFromFallback = words.find((w) => !tagWords.includes(w) && !isTypeToken(w)) ?? words[0] ?? "?";
        const rawName = match ? match[1]!.trim() : nameFromFallback;
        // Strip optional brackets and default value: [id="guest"] -> id
        const name = rawName.replace(/^@/, "").replace(/^\[|\]$/g, "").split("=")[0]!.trim();
        let desc: string | undefined;
        if (match) {
          desc = match[2]!.trim().replace(/\s*\*+\s*$/, "");
        } else {
          // No dash separator: @param {string} id User identifier — description is everything after the param name
          const wordsForDesc = words.filter((w) => !isTypeToken(w));
          const nameToken = rawName.replace(/^@/, "");
          const nameIdx = wordsForDesc.indexOf(nameToken);
          const descStr = nameIdx >= 0 ? wordsForDesc.slice(nameIdx + 1).join(" ") : wordsForDesc.slice(1).join(" ");
          desc = descStr.replace(/^\s*[-–—]\s*/, "").trim().replace(/\s*\*+\s*$/, "") || undefined;
        }
        result.params = result.params ?? [];
        result.params.push({ name, description: desc || undefined });
      } else if (tagName === "returns" || tagName === "return") {
        // Strip tag then optional @returns {Type}; keep only the description
        const afterTag = text.replace(/^@?(?:returns?|return)\s+/i, "").trim();
        const afterType = afterTag.replace(/^\s*\{[^}]*\}\s*/, "").trim().replace(/\s*\*+\s*$/, "");
        result.returns = afterType || undefined;
      } else if (tagName === "throws" || tagName === "exception") {
        // Strip tag and optional {Type}; keep only the description (consistent with @returns)
        const raw = text.trim();
        const afterTag = raw.replace(/^@?(?:throws|exception)\s+/i, "").trim();
        const afterType = afterTag.replace(/^\s*\{[^}]*\}\s*/, "").trim().replace(/\s*\*+\s*$/, "");
        result.throws = result.throws ?? [];
        result.throws.push(afterType || "");
      } else if (tagName === "example") {
        // Store only the example content, not the @example tag prefix
        const clean = text.replace(/^@?example\s*/i, "").trim();
        result.example = clean || undefined;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract JSDoc description from a node that may have getJsDocs() (e.g. VariableStatement)
 * or from leading comment ranges (e.g. ExpressionStatement).
 * Returns the main description text (text before first @tag).
 */
export function getJSDocDescriptionFromNode(node: Node): string | undefined {

  // Try getJsDocs() first (VariableStatement, FunctionDeclaration, etc.)
  const n = node as { getJsDocs?: () => { getDescription: () => string; getInnerText?: () => string }[] };
  if (typeof n.getJsDocs === "function") {
    try {
      const docs = n.getJsDocs();
      if (docs && docs.length > 0) {
        const first = docs[0];
        const desc = first.getDescription?.();
        if (desc && desc.trim()) return desc.trim();
        const inner = first.getInnerText?.();
        if (inner) {
          const beforeAt = inner.split(/\s*@/)[0].trim();
          if (beforeAt) return beforeAt;
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback: leading comment ranges (for ExpressionStatement, VariableStatement, etc.)
  if (typeof node.getLeadingCommentRanges === "function") {
    const ranges = node.getLeadingCommentRanges();
    if (ranges && ranges.length > 0) {
      for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        const text = range.getText();
        if (text.startsWith("/**")) {
          const parsed = parseJSDocCommentText(text);
          if (parsed) return parsed;
          break;
        }
      }
    }
  }

  // Fallback: scan source text. Node may start with JSDoc (e.g. VariableStatement) or have JSDoc immediately before it.
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const start = node.getStart();

  // If node starts with /** then JSDoc is the first token (e.g. VariableStatement in TS AST)
  if (fullText.slice(start, start + 3) === "/**") {
    const afterStart = fullText.slice(start);
    const endMatch = afterStart.match(/\*\/\s*/);
    if (endMatch && endMatch.index != null) {
      const commentText = afterStart.slice(0, endMatch.index + 2);
      const parsed = parseJSDocCommentText(commentText);
      if (parsed) return parsed;
    }
  }

  // Otherwise look for /** ... */ that ends immediately before the node (only whitespace between)
  const textBefore = fullText.slice(0, start);
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | null = null;
  while ((match = re.exec(textBefore)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const afterComment = lastMatch.index + lastMatch[0].length;
    const between = textBefore.slice(afterComment);
    if (/^\s*$/.test(between)) {
      const parsed = parseJSDocCommentText(lastMatch[0]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}
