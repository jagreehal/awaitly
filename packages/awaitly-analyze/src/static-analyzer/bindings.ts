/**
 * Callback parameter binding extraction.
 *
 * Parses workflow/saga callback parameter lists — (step), ({ step }),
 * ({ steps: { getUser } }), (s, { step }), ({ saga }) — into the info the
 * analysis core uses to recognize step calls.
 */

// Type-only imports - erased at compile time, no runtime dependency
import type { Node } from "ts-morph";
import { loadTsMorph } from "../ts-morph-loader";

/**
 * Info about saga parameter destructuring.
 * e.g., `async ({ saga }) => {...}` -> { isDestructured: true, sagaAlias: "saga" }
 * e.g., `async ({ step, tryStep }) => {...}` -> { isDestructured: true, stepAlias: "step", tryStepAlias: "tryStep" }
 */
export interface SagaParameterInfo {
  name?: string;
  isDestructured: boolean;
  stepAlias?: string;
  tryStepAlias?: string;
  /** When destructured as ({ saga }), the alias for the saga context object */
  sagaAlias?: string;
}

/**
 * Context for saga analysis.
 */
export interface SagaContext {
  isSagaWorkflow: boolean;
  sagaParamInfo?: SagaParameterInfo;
}

/**
 * Extract step parameter info from a workflow callback.
 * Handles: (step), ({ step }), ({ step: s }), ({ step = default }), ({ step: s = default })
 */
export interface StepParameterInfo {
  name?: string;
  isDestructured: boolean;
  stepAlias?: string;
  /** Alias for the bound-steps object: ({ steps }) or ({ steps: s }) */
  stepsAlias?: string;
  /** Nested destructuring of bound steps: ({ steps: { getUser } }) — binding name -> dep key */
  stepsBareAliases?: Map<string, string>;
}

export function extractStepParameterInfo(callback: Node): StepParameterInfo | undefined {
  const { Node } = loadTsMorph();

  let params: Node[] = [];
  if (Node.isArrowFunction(callback)) {
    params = callback.getParameters();
  } else if (Node.isFunctionExpression(callback)) {
    params = callback.getParameters();
  }

  if (params.length === 0) return undefined;

  const firstParam = params[0];
  if (!Node.isParameterDeclaration(firstParam)) return undefined;

  const nameNode = firstParam.getNameNode();

  // Check if it's destructured: ({ step }) or ({ step: s })
  if (Node.isObjectBindingPattern(nameNode)) {
    const result: StepParameterInfo = { isDestructured: true };

    for (const element of nameNode.getElements()) {
      const elementNameNode = element.getNameNode();

      // Nested destructuring of the bound-steps object: ({ steps: { getUser } })
      if (Node.isObjectBindingPattern(elementNameNode)) {
        const propName = element.getPropertyNameNode()?.getText();
        if (propName === "steps") {
          const bareAliases = new Map<string, string>();
          for (const inner of elementNameNode.getElements()) {
            const innerProp = inner.getPropertyNameNode()?.getText() || inner.getName();
            bareAliases.set(inner.getName(), innerProp);
          }
          result.stepsBareAliases = bareAliases;
        }
        continue;
      }

      const propName = element.getPropertyNameNode()?.getText() || element.getName();
      const bindingName = element.getName();

      if (propName === "step") {
        result.stepAlias = bindingName;
      }
      if (propName === "steps") {
        result.stepsAlias = bindingName;
      }
    }

    return result;
  }

  // Not destructured: (step) or (s)
  return {
    name: nameNode.getText(),
    isDestructured: false,
  };
}

/**
 * Extract saga parameter info from a callback.
 * e.g., `async ({ saga }) => {...}` -> { isDestructured: true, sagaAlias: "saga" }
 * e.g., `async ({ step, tryStep }) => {...}` -> { isDestructured: true, stepAlias: "step", tryStepAlias: "tryStep" }
 */
export function extractSagaParameterInfo(callback: Node): SagaParameterInfo | undefined {
  const { Node } = loadTsMorph();

  let params: Node[] = [];
  if (Node.isArrowFunction(callback)) {
    params = callback.getParameters();
  } else if (Node.isFunctionExpression(callback)) {
    params = callback.getParameters();
  }

  if (params.length === 0) return undefined;

  const firstParam = params[0];
  if (!Node.isParameterDeclaration(firstParam)) return undefined;

  const nameNode = firstParam.getNameNode();

  if (Node.isObjectBindingPattern(nameNode)) {
    const result: SagaParameterInfo = { isDestructured: true };

    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText() || element.getName();
      const bindingName = element.getName();

      if (propName === "saga") {
        result.sagaAlias = bindingName;
      } else if (propName === "step") {
        result.stepAlias = bindingName;
      } else if (propName === "tryStep") {
        result.tryStepAlias = bindingName;
      }
    }

    return result;
  }

  // Not destructured: (saga)
  return {
    name: nameNode.getText(),
    isDestructured: false,
  };
}

/**
 * Extended context for analyzing workflow structure.
 * Tracks whether we're inside the workflow callback to properly count
 * control structures regardless of whether they contain step calls.
 */
export interface AnalysisContext {
  /** Names that refer to the step function */
  stepNames: Set<string>;
  /** Whether we're currently inside the workflow callback body */
  isInWorkflowCallback: boolean;
  /** Nesting depth for tracking nested functions */
  depth: number;
  /** Bound-steps info for the deps-first form run(deps, fn) */
  boundSteps?: BoundStepsInfo;
}

/**
 * Steps-object parameter info for the deps-first form `run(deps, fn)`.
 * The callback's first parameter is the bound-steps object: calls like
 * `s.getOrder(id)` are steps whose ID is the property (= dep key).
 */
export interface BoundStepsInfo {
  /** Plain identifier names of the steps object, e.g. "s" in (s) => s.getOrder() */
  objectNames: Set<string>;
  /** Destructured form: local binding name -> dep key, e.g. ({ getOrder: fetch }) */
  bareAliases: Map<string, string>;
  /** Alias for the classic step escape hatch from the second parameter: (s, { step }) */
  stepAlias?: string;
}

/**
 * Extract bound-steps parameter info from a deps-first run(deps, fn) callback.
 * Handles: (s), ({ getOrder }), ({ getOrder: fetch }), and the optional
 * second parameter (s, { step }) / (s, { step: st }) escape hatch.
 */
export function extractBoundStepsInfo(callback: Node): BoundStepsInfo | undefined {
  const { Node } = loadTsMorph();

  let params: Node[] = [];
  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    params = callback.getParameters();
  }
  if (params.length === 0) return undefined;

  const info: BoundStepsInfo = {
    objectNames: new Set(),
    bareAliases: new Map(),
  };

  const firstParam = params[0];
  if (Node.isParameterDeclaration(firstParam)) {
    const nameNode = firstParam.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const propName = element.getPropertyNameNode()?.getText() || element.getName();
        info.bareAliases.set(element.getName(), propName);
      }
    } else {
      info.objectNames.add(nameNode.getText());
    }
  }

  const secondParam = params[1];
  if (secondParam && Node.isParameterDeclaration(secondParam)) {
    const nameNode = secondParam.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const propName = element.getPropertyNameNode()?.getText() || element.getName();
        if (propName === "step") {
          info.stepAlias = element.getName();
        }
      }
    }
  }

  return info;
}
