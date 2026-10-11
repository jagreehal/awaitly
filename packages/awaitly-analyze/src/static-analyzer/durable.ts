/**
 * Static analysis of AWS Lambda durable functions written with the native SDK
 * (`@aws/durable-execution-sdk-js`, or its drop-in `awaitly-durable-lambda`).
 *
 * A handler passed to `withDurableExecution` is analysed like a workflow
 * callback: the shared walker handles control flow, and calls on a durable
 * context (`context.step`, `context.wait`, ...) map onto the IR here.
 */
import type { ArrowFunction, FunctionExpression, Node } from "ts-morph";
import { loadTsMorph } from "../ts-morph-loader";
import type {
  AnalysisStats,
  StaticFlowNode,
  StaticLoopNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticSequenceNode,
  StaticStepNode,
} from "../types";
import { generateId, getLocation, type AnalyzerOptions } from "./shared";

/** Modules whose `withDurableExecution` marks a durable handler. */
export const DURABLE_MODULES = new Set(["@aws/durable-execution-sdk-js", "awaitly-durable-lambda"]);

/** `context.<operation>` callees that run one durable operation, keyed to their display kind. */
const STEP_LIKE_OPERATIONS: Record<string, string> = {
  step: "step",
  wait: "wait",
  waitForCallback: "callback",
  createCallback: "callback",
  invoke: "invoke",
  waitForCondition: "condition",
};

export interface DurableAnalysisHelpers {
  opts: Required<AnalyzerOptions>;
  stats: AnalysisStats;
  /** Analyze a callback body, adding its parameter at `contextParam` as a durable context. */
  analyzeCallback: (fn: Node, contextParam: number | undefined) => StaticFlowNode[];
  /** Analyze an expression (e.g. a promise passed to a combinator) in the current context. */
  analyzeExpression: (expression: Node) => StaticFlowNode[];
}

/** Canonical callee for a durable operation, independent of the local context name. */
export const durableCallee = (operation: string): string => `context.${operation}`;

function isStringLike(node: Node | undefined): boolean {
  const { Node } = loadTsMorph();
  return Boolean(
    node &&
      (Node.isStringLiteral(node) ||
        Node.isNoSubstitutionTemplateLiteral(node) ||
        Node.isTemplateExpression(node))
  );
}

/**
 * Whether an argument is an invoke target (function ARN) rather than its input:
 * a string, a `durableFunction(...)` brand, or anything typed as either.
 * Undefined when that cannot be told statically.
 */
function isInvokeTarget(node: Node | undefined): boolean | undefined {
  const { Node } = loadTsMorph();
  if (!node) return false;
  let target: Node = node;
  while (Node.isNonNullExpression(target) || Node.isParenthesizedExpression(target) || Node.isAsExpression(target)) {
    target = target.getExpression();
  }
  if (isStringLike(target)) return true;
  if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) return false;
  if (Node.isCallExpression(target)) return /(^|\.)durableFunction$/.test(target.getExpression().getText());

  // const payments = durableFunction<typeof handler>(arn)
  for (const declaration of target.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const init = declaration.getInitializer();
    if (init && Node.isCallExpression(init) && /(^|\.)durableFunction$/.test(init.getExpression().getText())) {
      return true;
    }
  }

  const type = target.getType();
  if (type.isAny() || type.isUnknown()) return undefined;
  if (type.isString() || type.isStringLiteral() || type.getText().includes("DurableFunction<")) return true;
  return type.isObject() ? false : undefined;
}

/** The operation's name and the arguments after it (the name is optional on every operation). */
function splitName(operation: string, args: Node[]): { name?: string; dynamicName: boolean; rest: Node[] } {
  const { Node } = loadTsMorph();
  const first = args[0];
  // invoke(funcId, input?) also starts with a string: it is named only when a
  // function target follows the name.
  const named =
    operation === "invoke"
      ? isStringLike(first) && (isInvokeTarget(args[1]) ?? args.length >= 3)
      : isStringLike(first) || (first !== undefined && Node.isIdentifier(first) && first.getText() === "undefined");
  if (!named || !first) return { dynamicName: false, rest: args };
  if (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) {
    return { name: first.getLiteralValue(), dynamicName: false, rest: args.slice(1) };
  }
  if (Node.isTemplateExpression(first)) {
    return { name: first.getText().slice(1, -1), dynamicName: true, rest: args.slice(1) };
  }
  return { dynamicName: false, rest: args.slice(1) };
}

const DURATION_UNITS: Array<[key: string, suffix: string, ms: number]> = [
  ["days", "d", 86_400_000],
  ["hours", "h", 3_600_000],
  ["minutes", "m", 60_000],
  ["seconds", "s", 1_000],
];

/** A `Duration` literal (`{ days: 1, hours: 2 }`) as `"1d2h"` and milliseconds, when static. */
function readDuration(node: Node | undefined): { label: string; ms?: number } | undefined {
  const { Node } = loadTsMorph();
  if (!node) return undefined;
  if (!Node.isObjectLiteralExpression(node)) return { label: node.getText() };
  let label = "";
  let ms = 0;
  for (const [key, suffix, unitMs] of DURATION_UNITS) {
    const prop = node.getProperty(key);
    if (!prop) continue;
    const value = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined;
    if (!value || !Node.isNumericLiteral(value)) return { label: node.getText() };
    const amount = value.getLiteralValue();
    label += `${amount}${suffix}`;
    ms += amount * unitMs;
  }
  return label ? { label, ms } : { label: node.getText() };
}

/** The `timeout` of an operation's config object, when written inline. */
function readConfigTimeout(config: Node | undefined): { label: string; ms?: number } | undefined {
  const { Node } = loadTsMorph();
  if (!config || !Node.isObjectLiteralExpression(config)) return undefined;
  const timeout = config.getProperty("timeout");
  return timeout && Node.isPropertyAssignment(timeout) ? readDuration(timeout.getInitializer()) : undefined;
}

/** The function a step runs calls, e.g. `getUser` in `() => getUser(id)`. */
function innerCallee(fn: Node | undefined): string | undefined {
  const { Node } = loadTsMorph();
  if (!fn || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined;
  let body: Node | undefined = fn.getBody();
  if (Node.isBlock(body)) {
    const ret = body.getStatements().find((s) => Node.isReturnStatement(s));
    body = ret && Node.isReturnStatement(ret) ? ret.getExpression() : undefined;
  }
  while (body && (Node.isAwaitExpression(body) || Node.isParenthesizedExpression(body))) {
    body = body.getExpression();
  }
  return body && Node.isCallExpression(body) ? body.getExpression().getText() : undefined;
}

const isFunction = (node: Node | undefined): node is ArrowFunction | FunctionExpression => {
  const { Node } = loadTsMorph();
  return Boolean(node && (Node.isArrowFunction(node) || Node.isFunctionExpression(node)));
};

function stepLikeNode(
  node: Node,
  operation: string,
  args: Node[],
  { opts, stats }: DurableAnalysisHelpers
): StaticStepNode {
  stats.totalSteps++;
  const { name, dynamicName, rest } = splitName(operation, args);
  const step: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId: name ?? operation,
    name: name ?? operation,
    callee: durableCallee(operation),
    stepKind: STEP_LIKE_OPERATIONS[operation],
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
  if (dynamicName) step.key = "<dynamic>";

  switch (operation) {
    case "step": {
      const dep = innerCallee(rest.find(isFunction));
      if (dep) {
        step.depSource = dep;
        delete step.stepKind;
      }
      break;
    }
    case "wait":
      step.sleepDuration = readDuration(rest[0])?.label;
      break;
    case "waitForCallback":
    case "createCallback": {
      const timeout = readConfigTimeout(rest.at(-1));
      if (timeout) step.timeout = { ms: timeout.ms ?? "<dynamic>" };
      break;
    }
    case "invoke":
      // The invoked function: an ARN, alias, or the expression that holds it.
      if (rest[0]) step.depSource = isStringLike(rest[0]) ? rest[0].getText().slice(1, -1) : rest[0].getText().replace(/!$/, "");
      break;
  }
  return step;
}

/** A block body analyses to one unnamed sequence; its children are the body. */
function bodyNodes(nodes: StaticFlowNode[]): StaticFlowNode[] {
  const [only] = nodes;
  return nodes.length === 1 && only?.type === "sequence" && !only.name ? only.children : nodes;
}

/** A branch's nodes as one child: a lone node as-is, several as a sequence. */
function asChild(nodes: StaticFlowNode[], name: string | undefined): StaticFlowNode | undefined {
  if (nodes.length === 0) return undefined;
  const child: StaticFlowNode =
    nodes.length === 1 && nodes[0] ? nodes[0] : ({ id: generateId(), type: "sequence", children: nodes } as StaticSequenceNode);
  if (name) child.name = name;
  return child;
}

/**
 * Map a call on a durable context to IR. Returns undefined for methods that
 * are not durable operations (e.g. `context.logger.info`).
 */
export function analyzeDurableOperation(
  node: Node,
  operation: string,
  args: Node[],
  isCombinator: boolean,
  helpers: DurableAnalysisHelpers
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();
  const { opts, stats } = helpers;
  const location = opts.includeLocations ? getLocation(node) : undefined;

  if (isCombinator) {
    // context.promise.all/allSettled/any/race(name?, promises[])
    const { name, rest } = splitName(operation, args);
    const promises = rest[0];
    const children =
      promises && Node.isArrayLiteralExpression(promises)
        ? promises.getElements().flatMap((element) => helpers.analyzeExpression(element))
        : [];
    if (operation === "any" || operation === "race") {
      stats.raceCount++;
      return { id: generateId(), type: "race", name, children, callee: `context.promise.${operation}`, location } as StaticRaceNode;
    }
    if (operation !== "all" && operation !== "allSettled") return undefined;
    stats.parallelCount++;
    return {
      id: generateId(),
      type: "parallel",
      name,
      mode: operation,
      children,
      callee: `context.promise.${operation}`,
      location,
    } as StaticParallelNode;
  }

  if (operation in STEP_LIKE_OPERATIONS) return stepLikeNode(node, operation, args, helpers);

  const { name, rest } = splitName(operation, args);
  switch (operation) {
    case "runInChildContext": {
      const fn = rest.find(isFunction);
      const children = fn ? bodyNodes(helpers.analyzeCallback(fn, 0)) : [];
      return { id: generateId(), type: "sequence", name, children, location } as StaticSequenceNode;
    }
    case "parallel": {
      stats.parallelCount++;
      const branches = rest[0];
      const children: StaticFlowNode[] = [];
      if (branches && Node.isArrayLiteralExpression(branches)) {
        for (const branch of branches.getElements()) {
          if (isFunction(branch)) {
            const child = asChild(helpers.analyzeCallback(branch, 0), undefined);
            if (child) children.push(child);
          } else if (Node.isObjectLiteralExpression(branch)) {
            // { name, func } named branch
            const func = branch.getProperty("func");
            const fn = func && Node.isPropertyAssignment(func) ? func.getInitializer() : undefined;
            const branchName = branch.getProperty("name");
            const nameInit = branchName && Node.isPropertyAssignment(branchName) ? branchName.getInitializer() : undefined;
            const label = nameInit && Node.isStringLiteral(nameInit) ? nameInit.getLiteralValue() : undefined;
            const child = isFunction(fn) ? asChild(helpers.analyzeCallback(fn, 0), label) : undefined;
            if (child) children.push(child);
          }
        }
      }
      return { id: generateId(), type: "parallel", name, mode: "all", children, callee: durableCallee("parallel"), location } as StaticParallelNode;
    }
    case "map": {
      stats.loopCount++;
      const [items, fn] = rest;
      return {
        id: generateId(),
        type: "loop",
        name,
        loopType: "map",
        loopId: name,
        iterSource: items?.getText(),
        body: isFunction(fn) ? bodyNodes(helpers.analyzeCallback(fn, 0)) : [],
        boundKnown: false,
        location,
      } as StaticLoopNode;
    }
    default:
      return undefined;
  }
}

/** Mermaid / DSL label suffix for durable step kinds; empty for other steps. */
export function durableStepKindSuffix(node: StaticStepNode): string {
  switch (node.callee) {
    case durableCallee("wait"):
      return node.sleepDuration ? ` (Wait: ${node.sleepDuration})` : " (Wait)";
    case durableCallee("waitForCallback"):
    case durableCallee("createCallback"): {
      const ms = node.timeout?.ms;
      return typeof ms === "number" ? ` (Callback, timeout ${formatMs(ms)})` : " (Callback)";
    }
    case durableCallee("invoke"):
      return node.depSource ? ` (Invoke: ${node.depSource})` : " (Invoke)";
    case durableCallee("waitForCondition"):
      return " (Poll)";
    default:
      return "";
  }
}

function formatMs(ms: number): string {
  for (const [, suffix, unitMs] of DURATION_UNITS) {
    if (ms % unitMs === 0) return `${ms / unitMs}${suffix}`;
  }
  return `${ms}ms`;
}
