import type { Rule } from 'eslint';
import type {
  CallExpression,
  MemberExpression,
  Node,
  VariableDeclarator,
} from 'estree';

/**
 * Rule: require-result-handling
 *
 * Warns when accessing `.value` on a Result without checking `.ok` first.
 * This prevents runtime errors when the Result is an Err.
 *
 * BAD:
 *   const result = await run(...);
 *   console.log(result.value);  // Could be Err!
 *
 * GOOD:
 *   const result = await run(...);
 *   if (result.ok) {
 *     console.log(result.value);  // TypeScript knows this is safe
 *   }
 *
 * GOOD:
 *   const result = await run(...);
 *   if (!result.ok) {
 *     return result;  // Early return on error
 *   }
 *   console.log(result.value);  // Safe after guard
 */

// Functions that return Result types
const RESULT_FUNCTIONS = new Set(['run', 'step', 'ok', 'err', 'fromPromise', 'fromThrowable']);

// Step methods that return Result types
const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult', 'parallel', 'race', 'allSettled', 'all']);

interface ResultVariable {
  name: string;
  node: VariableDeclarator;
  checkedScopes: Set<Node>; // Scopes where .ok has been checked
}

interface SafetyInfo {
  valueAllowed: boolean;
  errorAllowed: boolean;
}

interface BranchInfo {
  varName: string;
  isNegated: boolean; // true for !result.ok
}

/**
 * Checks if a statement block has an early exit (return, throw).
 * This is used to detect the early return pattern.
 */
function hasEarlyExit(node: Node): boolean {
  if (node.type === 'BlockStatement') {
    const body = (node as { body: Node[] }).body;
    return body.some((stmt) => {
      if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') {
        return true;
      }
      // Check nested if statements for early returns
      // An if is only an unconditional exit if BOTH branches have early exits
      if (stmt.type === 'IfStatement') {
        const ifStmt = stmt as { consequent: Node; alternate?: Node };
        if (
          ifStmt.alternate &&
          hasEarlyExit(ifStmt.consequent) &&
          hasEarlyExit(ifStmt.alternate)
        ) {
          return true;
        }
      }
      return false;
    });
  }
  // Single statement (not a block)
  return node.type === 'ReturnStatement' || node.type === 'ThrowStatement';
}

function isResultProducingCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct run() or step() call
  if (callee.type === 'Identifier' && RESULT_FUNCTIONS.has(callee.name)) {
    return true;
  }

  // step.method() calls
  if (callee.type === 'MemberExpression') {
    const { object, property } = callee as MemberExpression;
    if (
      object.type === 'Identifier' &&
      object.name === 'step' &&
      property.type === 'Identifier' &&
      STEP_METHODS.has(property.name)
    ) {
      return true;
    }
  }

  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require checking Result.ok before accessing Result.value to prevent runtime errors',
      recommended: true,
    },
    schema: [],
    messages: {
      unsafeValueAccess:
        "Unsafe access to '{{property}}' on Result '{{name}}'. Check '.ok' first: if ({{name}}.ok) { ... {{name}}.{{property}} ... }",
    },
  },

  create(context) {
    const resultVariables = new Map<string, ResultVariable>();
    // Track what's allowed per variable: { valueAllowed, errorAllowed }
    const variableSafety = new Map<string, SafetyInfo>();
    const safetyStack: Map<string, SafetyInfo>[] = [];
    // Map from block node to branch info for applying branch-specific rules
    const branchBlocks = new Map<Node, BranchInfo>();

    function enterScope() {
      safetyStack.push(new Map(variableSafety));
    }

    function exitScope() {
      const previousScope = safetyStack.pop();
      if (previousScope) {
        variableSafety.clear();
        previousScope.forEach((v, k) => variableSafety.set(k, v));
      }
    }

    function markSafety(varName: string, info: SafetyInfo) {
      variableSafety.set(varName, info);
    }

    function isSafe(varName: string, property: 'value' | 'error'): boolean {
      const info = variableSafety.get(varName);
      if (!info) return false;
      return property === 'value' ? info.valueAllowed : info.errorAllowed;
    }

    return {
      // Track scope for proper variable checking
      BlockStatement(node: Node) {
        enterScope();

        // Clear safety when entering a function body - the function can execute later
        // when the .ok check is no longer guaranteed
        const parent = (node as unknown as { parent?: Node }).parent;
        if (
          parent?.type === 'FunctionDeclaration' ||
          parent?.type === 'FunctionExpression' ||
          parent?.type === 'ArrowFunctionExpression'
        ) {
          variableSafety.clear();
        }

        // Apply branch-specific safety rules if this block is part of an if statement
        const branchInfo = branchBlocks.get(node);
        if (branchInfo) {
          // Determine what's allowed based on which branch we're in
          // For consequent: if (result.ok) -> value safe; if (!result.ok) -> error safe
          // For alternate: if (result.ok) -> error safe; if (!result.ok) -> value safe
          // branchInfo.isNegated tells us if the test was !result.ok
          // We need to check if this is consequent or alternate
          const parent = (node as unknown as { parent?: Node }).parent;
          if (parent?.type === 'IfStatement') {
            const ifStmt = parent as { consequent: Node; alternate?: Node };
            const isConsequent = ifStmt.consequent === node;
            const isAlternate = ifStmt.alternate === node;

            if (isConsequent) {
              // In consequent of if (result.ok) -> value allowed
              // In consequent of if (!result.ok) -> error allowed
              markSafety(branchInfo.varName, {
                valueAllowed: !branchInfo.isNegated,
                errorAllowed: branchInfo.isNegated,
              });
            } else if (isAlternate) {
              // In alternate of if (result.ok) -> error allowed
              // In alternate of if (!result.ok) -> value allowed
              markSafety(branchInfo.varName, {
                valueAllowed: branchInfo.isNegated,
                errorAllowed: !branchInfo.isNegated,
              });
            }
          }
        }
      },
      'BlockStatement:exit'() {
        exitScope();
      },

      // Track Result-producing variable declarations
      VariableDeclarator(node: VariableDeclarator) {
        const { id, init } = node;
        if (!init || id.type !== 'Identifier') return;

        // Unwrap await expressions
        let valueNode = init;
        if (valueNode.type === 'AwaitExpression' && valueNode.argument) {
          valueNode = valueNode.argument;
        }

        // Check if this is a Result-producing call
        if (valueNode.type === 'CallExpression' && isResultProducingCall(valueNode)) {
          resultVariables.set(id.name, {
            name: id.name,
            node,
            checkedScopes: new Set(),
          });
        }
      },

      // Track .ok checks in if statements
      IfStatement(node) {
        const { test, consequent, alternate } = node;

        // if (result.ok) or if (!result.ok)
        let memberExpr: MemberExpression | null = null;
        let isNegated = false;

        if (test.type === 'MemberExpression') {
          memberExpr = test;
        } else if (
          test.type === 'UnaryExpression' &&
          test.operator === '!' &&
          test.argument.type === 'MemberExpression'
        ) {
          memberExpr = test.argument;
          isNegated = true;
        }

        if (memberExpr) {
          const { object, property } = memberExpr;
          if (
            object.type === 'Identifier' &&
            property.type === 'Identifier' &&
            property.name === 'ok' &&
            resultVariables.has(object.name)
          ) {
            const varName = object.name;

            // Only mark as safe for code AFTER the if statement if there's an early exit
            // Early exit in consequent:
            //   if (!result.ok) { return; } -> .value is safe after
            //   if (result.ok) { return; } -> .error is safe after
            // Early exit in alternate:
            //   if (result.ok) { ... } else { return; } -> .value is safe after
            //   if (!result.ok) { ... } else { return; } -> .error is safe after
            if (hasEarlyExit(consequent)) {
              if (isNegated) {
                // if (!result.ok) { return; } - value is safe after
                markSafety(varName, { valueAllowed: true, errorAllowed: false });
              } else {
                // if (result.ok) { return; } - error is safe after
                markSafety(varName, { valueAllowed: false, errorAllowed: true });
              }
            } else if (alternate && hasEarlyExit(alternate)) {
              if (isNegated) {
                // if (!result.ok) { ... } else { return; } - error is safe after
                markSafety(varName, { valueAllowed: false, errorAllowed: true });
              } else {
                // if (result.ok) { ... } else { return; } - value is safe after
                markSafety(varName, { valueAllowed: true, errorAllowed: false });
              }
            }

            // Register branches for branch-specific rules (both block and single-statement)
            const branchInfo: BranchInfo = { varName, isNegated };
            branchBlocks.set(consequent, branchInfo);
            if (alternate) {
              branchBlocks.set(alternate, branchInfo);
            }
          }
        }
      },

      // Check for unsafe .value or .error access
      MemberExpression(node: MemberExpression) {
        const { object, property } = node;

        // Check for result.value or result.error access
        if (
          object.type === 'Identifier' &&
          property.type === 'Identifier' &&
          (property.name === 'value' || property.name === 'error')
        ) {
          const varName = object.name;

          // Only check if this is a tracked Result variable
          if (!resultVariables.has(varName)) return;

          // Check if we're inside a function that's inside a result.ok branch
          // If so, don't trust scope-based safety because the function can be called later
          let insideFunctionInBranch = false;
          let checkNode: Node | undefined = (node as unknown as { parent?: Node }).parent;
          let foundFunction = false;
          while (checkNode) {
            if (
              checkNode.type === 'FunctionDeclaration' ||
              checkNode.type === 'FunctionExpression' ||
              checkNode.type === 'ArrowFunctionExpression'
            ) {
              foundFunction = true;
            }
            // If we found a function and then find a branch block, the function is inside the branch
            if (foundFunction && branchBlocks.has(checkNode)) {
              insideFunctionInBranch = true;
              break;
            }
            checkNode = (checkNode as unknown as { parent?: Node }).parent;
          }

          // Skip if this access is safe in current scope (but not if inside a function in a branch)
          if (!insideFunctionInBranch && isSafe(varName, property.name as 'value' | 'error')) return;

          // Check if we're inside a single-statement branch of an if that checks this variable
          // Walk up the AST to find if we're in a registered branch
          // Stop at function boundaries since the function can be called later
          let current: Node | undefined = node as unknown as Node;
          while (current) {
            // Stop at function boundaries - the function can execute later when .ok is no longer guaranteed
            if (
              current.type === 'FunctionDeclaration' ||
              current.type === 'FunctionExpression' ||
              current.type === 'ArrowFunctionExpression'
            ) {
              break;
            }
            const branchInfo = branchBlocks.get(current);
            if (branchInfo && branchInfo.varName === varName) {
              // We're inside a branch - determine if this access is safe
              const parent = (current as unknown as { parent?: Node }).parent;
              if (parent?.type === 'IfStatement') {
                const ifStmt = parent as { consequent: Node; alternate?: Node };
                const isConsequent = ifStmt.consequent === current;
                const isAlternate = ifStmt.alternate === current;

                if (isConsequent) {
                  // In consequent: value safe if not negated, error safe if negated
                  if (property.name === 'value' && !branchInfo.isNegated) return;
                  if (property.name === 'error' && branchInfo.isNegated) return;
                } else if (isAlternate) {
                  // In alternate: value safe if negated, error safe if not negated
                  if (property.name === 'value' && branchInfo.isNegated) return;
                  if (property.name === 'error' && !branchInfo.isNegated) return;
                }
              }
              break; // Found the branch, stop walking
            }
            current = (current as unknown as { parent?: Node }).parent;
          }

          // Check if this access is within a conditional that checks .ok
          const parent = (node as unknown as { parent?: Node }).parent;

          // Allow: result.ok && result.value
          if (
            parent?.type === 'LogicalExpression' &&
            parent.operator === '&&'
          ) {
            const { left } = parent;
            if (
              left.type === 'MemberExpression' &&
              left.object.type === 'Identifier' &&
              left.object.name === varName &&
              left.property.type === 'Identifier' &&
              left.property.name === 'ok'
            ) {
              return; // Safe: checked with &&
            }
          }

          // Allow: result.ok ? result.value : ... (value in consequent)
          // Allow: result.ok ? ... : result.error (error in alternate)
          if (parent?.type === 'ConditionalExpression') {
            const { test } = parent;
            // Check if test is result.ok
            if (
              test.type === 'MemberExpression' &&
              test.object.type === 'Identifier' &&
              test.object.name === varName &&
              test.property.type === 'Identifier' &&
              test.property.name === 'ok'
            ) {
              // .value is safe in consequent (result.ok is true)
              if (parent.consequent === node && property.name === 'value') {
                return; // Safe: checked in ternary consequent
              }
              // .error is safe in alternate (result.ok is false)
              if (parent.alternate === node && property.name === 'error') {
                return; // Safe: checked in ternary alternate
              }
            }
            // Check if test is !result.ok
            if (
              test.type === 'UnaryExpression' &&
              test.operator === '!' &&
              test.argument.type === 'MemberExpression' &&
              test.argument.object.type === 'Identifier' &&
              (test.argument.object as { name: string }).name === varName &&
              test.argument.property.type === 'Identifier' &&
              (test.argument.property as { name: string }).name === 'ok'
            ) {
              // .error is safe in consequent (!result.ok means error case)
              if (parent.consequent === node && property.name === 'error') {
                return; // Safe: checked in ternary consequent
              }
              // .value is safe in alternate (!result.ok is false means ok is true)
              if (parent.alternate === node && property.name === 'value') {
                return; // Safe: checked in ternary alternate
              }
            }
          }

          context.report({
            node,
            messageId: 'unsafeValueAccess',
            data: {
              name: varName,
              property: property.name,
            },
          });
        }
      },
    };
  },
};

export default rule;
