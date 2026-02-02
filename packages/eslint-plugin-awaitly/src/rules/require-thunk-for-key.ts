import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression, ObjectExpression, Property, Identifier, VariableDeclarator, AssignmentExpression, Node, Pattern } from 'estree';

/**
 * Rule: require-thunk-for-key
 *
 * When using step() with a `key` option, the first argument MUST be a thunk.
 * Otherwise, the function executes immediately BEFORE step() can check the cache.
 *
 * With the direct pattern, the cache IS populated and step_complete events ARE emitted,
 * but the operation runs regardless of cache state - defeating the purpose of caching.
 *
 * BAD:  step(fetchUser('1'), { key: 'user:1' }) - fetchUser() runs immediately, even if cached
 * BAD:  const result = fetchUser('1'); step(result, { key }) - result is pre-computed
 * GOOD: step(() => fetchUser('1'), { key: 'user:1' }) - fetchUser() only runs on cache miss
 * GOOD: step(fetchUser, { key: 'user:1' }) - fetchUser is a function reference (thunk)
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult']);

function isStepCall(node: CallExpression): boolean {
  const { callee } = node;

  if (callee.type === 'Identifier' && callee.name === 'step') {
    return true;
  }

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

function isThunk(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string };
  return typed.type === 'ArrowFunctionExpression' || typed.type === 'FunctionExpression';
}

function getRootIdentifier(node: MemberExpression): Identifier | null {
  let current: Node = node.object;
  while (current.type === 'MemberExpression') {
    current = (current as MemberExpression).object;
  }
  return current.type === 'Identifier' ? current as Identifier : null;
}

// Variable names that suggest dependency/utility containers (properties are functions)
const UTILITY_OBJECT_PATTERNS = [
  /^deps?$/i,           // deps, dep
  /^dependencies$/i,    // dependencies
  /^services?$/i,       // services, service
  /^context$/i,         // context
  /^ctx$/i,             // ctx
  /^di$/i,              // di (dependency injection)
  /^container$/i,       // container
  /^providers?$/i,      // providers, provider
  /^adapters?$/i,       // adapters, adapter
  /^clients?$/i,        // clients, client
  /^api$/i,             // api
  /^sdk$/i,             // sdk
];

function _isUtilityObjectName(name: string): boolean {
  return UTILITY_OBJECT_PATTERNS.some(pattern => pattern.test(name));
}

// Property names that look like function references (verbs or common function patterns)
const FUNCTION_PROPERTY_PATTERNS = [
  /^fetch/i,      // fetchUser, fetchData
  /^get/i,        // getUser, getData
  /^create/i,     // createUser, createOrder
  /^update/i,     // updateUser, updateSettings
  /^delete/i,     // deleteUser, deleteRecord
  /^remove/i,     // removeItem, removeUser
  /^add/i,        // addItem, addUser
  /^set/i,        // setConfig, setValue
  /^handle/i,     // handleError, handleSubmit
  /^process/i,    // processData, processOrder
  /^validate/i,   // validateInput, validateUser
  /^parse/i,      // parseJSON, parseDate
  /^format/i,     // formatDate, formatCurrency
  /^load/i,       // loadData, loadUser
  /^save/i,       // saveData, saveUser
  /^send/i,       // sendEmail, sendMessage
  /^submit/i,     // submitForm, submitOrder
  /^execute/i,    // executeQuery, executeCommand
  /^run/i,        // runTask, runJob
  /^call/i,       // callApi, callService
  /^invoke/i,     // invokeFunction, invokeMethod
  /^init/i,       // initApp, initialize
  /^build/i,      // buildQuery, buildConfig
  /^generate/i,   // generateReport, generateToken
  /^compute/i,    // computeValue, computeHash
  /^calculate/i,  // calculateTotal, calculateTax
  /^find/i,       // findUser, findById
  /^search/i,     // searchUsers, searchProducts
  /^query/i,      // queryDatabase, queryUsers
  /^list/i,       // listUsers, listItems
  /^read/i,       // readFile, readData
  /^write/i,      // writeFile, writeData
  /^check/i,      // checkStatus, checkPermission
  /^verify/i,     // verifyToken, verifyUser
  /^transform/i,  // transformData, transformInput
  /^convert/i,    // convertDate, convertCurrency
  /^map/i,        // mapData, mapUsers
  /^filter/i,     // filterItems, filterUsers
  /^sort/i,       // sortItems, sortByDate
  /^merge/i,      // mergeData, mergeObjects
  /^split/i,      // splitString, splitData
  /^join/i,       // joinStrings, joinArrays
  /^render/i,     // renderComponent, renderPage
  /^dispatch/i,   // dispatchAction, dispatchEvent
  /^emit/i,       // emitEvent, emitSignal
  /^subscribe/i,  // subscribeToEvents, subscribeToChannel
  /^publish/i,    // publishEvent, publishMessage
  /^notify/i,     // notifyUser, notifyAdmin
  /^log/i,        // logError, logMessage
  /^track/i,      // trackEvent, trackUser
  /^record/i,     // recordEvent, recordMetric
  /^measure/i,    // measureTime, measurePerformance
  /^assert/i,     // assertEqual, assertValid
  /^test/i,       // testConnection, testApi
  /^mock/i,       // mockResponse, mockData
  /^stub/i,       // stubMethod, stubFunction
  /^spy/i,        // spyOn
  /^clone/i,      // cloneObject, cloneArray
  /^copy/i,       // copyData, copyFile
  /^reset/i,      // resetState, resetForm
  /^clear/i,      // clearCache, clearData
  /^flush/i,      // flushCache, flushBuffer
  /^close/i,      // closeConnection, closeFile
  /^open/i,       // openFile, openConnection
  /^start/i,      // startServer, startProcess
  /^stop/i,       // stopServer, stopProcess
  /^pause/i,      // pauseExecution, pauseTimer
  /^resume/i,     // resumeExecution, resumeTimer
  /^retry/i,      // retryOperation, retryRequest
  /^cancel/i,     // cancelRequest, cancelOperation
  /^abort/i,      // abortRequest, abortOperation
  /^connect/i,    // connectToDatabase, connectToServer
  /^disconnect/i, // disconnectFromDatabase
  /^authenticate/i, // authenticateUser
  /^authorize/i,  // authorizeRequest
  /^login/i,      // loginUser
  /^logout/i,     // logoutUser
  /^register/i,   // registerUser
  /^unregister/i, // unregisterUser
  /^enable/i,     // enableFeature
  /^disable/i,    // disableFeature
  /^toggle/i,     // toggleFeature
  /^show/i,       // showModal, showMessage
  /^hide/i,       // hideModal, hideMessage
  /^display/i,    // displayMessage
  /^present/i,    // presentView
  /^dismiss/i,    // dismissModal
  /^is[A-Z]/,     // isValid, isEmpty (predicates)
  /^has[A-Z]/,    // hasPermission, hasAccess (predicates)
  /^can[A-Z]/,    // canEdit, canDelete (predicates)
  /^should[A-Z]/, // shouldUpdate, shouldRender (predicates)
  /^will[A-Z]/,   // willChange, willUpdate
  /^did[A-Z]/,    // didMount, didUpdate
  /^on[A-Z]/,     // onClick, onSubmit (event handlers)
];

function isFunctionPropertyName(name: string): boolean {
  return FUNCTION_PROPERTY_PATTERNS.some(pattern => pattern.test(name));
}

function hasKeyOption(node: CallExpression): boolean {
  // Look for options object with 'key' property
  for (const arg of node.arguments) {
    if (arg.type === 'ObjectExpression') {
      const obj = arg as ObjectExpression;
      for (const prop of obj.properties) {
        if (prop.type === 'Property') {
          const property = prop as Property;
          if (
            property.key.type === 'Identifier' &&
            property.key.name === 'key'
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require thunk when using step() with a key option. Without a thunk, the function executes immediately before the cache can be checked, defeating the purpose of caching.',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      requireThunkForKey:
        "When using step() with a 'key' option, wrap the operation in a thunk: step(() => fn(), { key }). Without a thunk, the function executes immediately before step() checks the cache. The cache will still be populated and step_complete events will fire, but the operation runs regardless of cache state.",
    },
  },

  create(context) {
    // Track definition nodes that are initialized with CallExpressions
    const preComputedDefs = new WeakSet<Node>();

    // Helper to find a variable by walking up the scope chain
    function findVariable(name: string, startScope: ReturnType<typeof context.sourceCode.getScope>) {
      let scope: typeof startScope | null = startScope;
      while (scope) {
        const variable = scope.set.get(name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return null;
    }

    // Helper to check if an identifier references a precomputed definition
    function isPrecomputedReference(identifierNode: Identifier): boolean {
      const scope = context.sourceCode.getScope(identifierNode);
      const variable = findVariable(identifierNode.name, scope);
      if (!variable) return false;

      for (const def of variable.defs) {
        if (def.node && preComputedDefs.has(def.node)) {
          return true;
        }
      }
      return false;
    }

    // Helper to check if a pattern contains any identifiers (for destructuring)
    function hasIdentifiersInPattern(pattern: Pattern): boolean {
      if (pattern.type === 'Identifier') return true;
      if (pattern.type === 'ObjectPattern') {
        return pattern.properties.some(prop => {
          if (prop.type === 'RestElement') return hasIdentifiersInPattern(prop.argument);
          return hasIdentifiersInPattern(prop.value);
        });
      }
      if (pattern.type === 'ArrayPattern') {
        return pattern.elements.some(el => el !== null && hasIdentifiersInPattern(el));
      }
      if (pattern.type === 'AssignmentPattern') {
        return hasIdentifiersInPattern(pattern.left);
      }
      if (pattern.type === 'RestElement') {
        return hasIdentifiersInPattern(pattern.argument);
      }
      return false;
    }

    return {
      VariableDeclarator(node: VariableDeclarator) {
        // Track variables initialized with CallExpressions (pre-computed values)
        // This includes both direct assignment and destructuring
        if (node.init && node.init.type === 'CallExpression') {
          if (hasIdentifiersInPattern(node.id)) {
            preComputedDefs.add(node);
          }
        }
      },

      AssignmentExpression(node: AssignmentExpression) {
        if (node.left.type !== 'Identifier') return;

        const scope = context.sourceCode.getScope(node);
        const variable = findVariable(node.left.name, scope);
        if (!variable) return;

        // If reassigned to a CallExpression, mark as precomputed
        // If reassigned to something else (function ref, literal, etc.), remove from precomputed
        if (node.right.type === 'CallExpression') {
          for (const def of variable.defs) {
            if (def.node) {
              preComputedDefs.add(def.node);
            }
          }
        } else {
          // Reassigned to non-call value - no longer precomputed
          for (const def of variable.defs) {
            if (def.node) {
              preComputedDefs.delete(def.node);
            }
          }
        }
      },

      CallExpression(node: CallExpression) {
        if (!isStepCall(node)) return;
        if (!hasKeyOption(node)) return;

        // Determine which argument is the executor based on API pattern
        // New API: step('name', executor, options) - first arg is string literal
        // Old API: step(executor, options) - first arg is the executor
        let executorArg = node.arguments[0];
        if (!executorArg) return;

        // If first argument is a string literal, the executor is the second argument
        if (executorArg.type === 'Literal' && typeof (executorArg as { value: unknown }).value === 'string') {
          executorArg = node.arguments[1];
          if (!executorArg) return;
        }

        // If executor is already a thunk (arrow/function expression), it's fine
        if (isThunk(executorArg)) return;

        // Use executorArg instead of firstArg for all subsequent checks
        const firstArg = executorArg;

        // If first argument is a CallExpression, it's an immediate call (bad)
        if (firstArg.type === 'CallExpression') {
          context.report({
            node: firstArg,
            messageId: 'requireThunkForKey',
            fix(fixer) {
              const sourceCode = context.sourceCode;
              const argText = sourceCode.getText(firstArg);
              return fixer.replaceText(firstArg, `() => ${argText}`);
            },
          });
          return;
        }

        // If first argument is an Identifier, check if it references a pre-computed value
        if (firstArg.type === 'Identifier') {
          const ident = firstArg as Identifier;
          if (isPrecomputedReference(ident)) {
            // Even if precomputed, allow if the identifier name looks like a function
            // This handles destructured function references: const { fetchUser } = getDeps();
            if (!isFunctionPropertyName(ident.name)) {
              context.report({
                node: firstArg,
                messageId: 'requireThunkForKey',
                fix(fixer) {
                  const sourceCode = context.sourceCode;
                  const argText = sourceCode.getText(firstArg);
                  return fixer.replaceText(firstArg, `() => ${argText}`);
                },
              });
            }
          }
          // If not precomputed, assume it's a function reference (valid thunk)
          return;
        }

        // For MemberExpression, check several cases:
        // 1. Computed access (result[0], result[key]) is NEVER a function reference - always flag
        // 2. Root was precomputed from a call WITH arguments (likely returns data)
        // 3. Dot notation on utility objects (deps.fetchUser) is allowed
        if (firstArg.type === 'MemberExpression') {
          const memberExpr = firstArg as MemberExpression;

          // Computed access is never a function reference pattern
          if (memberExpr.computed) {
            context.report({
              node: firstArg,
              messageId: 'requireThunkForKey',
              fix(fixer) {
                const sourceCode = context.sourceCode;
                const argText = sourceCode.getText(firstArg);
                return fixer.replaceText(firstArg, `() => ${argText}`);
              },
            });
            return;
          }

          // For dot notation, check if root was precomputed
          // If precomputed, only allow if property looks like a function (fetchUser, getData, etc.)
          // The utility object name heuristic only applies to non-precomputed objects
          const rootIdent = getRootIdentifier(memberExpr);
          if (rootIdent && isPrecomputedReference(rootIdent)) {
            // Root is precomputed - it's data, not a utility container
            // Only allow if property name looks like a function reference
            const propertyName = memberExpr.property.type === 'Identifier'
              ? memberExpr.property.name
              : null;
            const isFunctionRef = propertyName && isFunctionPropertyName(propertyName);

            // Flag unless property looks like a function
            if (!isFunctionRef) {
              context.report({
                node: firstArg,
                messageId: 'requireThunkForKey',
                fix(fixer) {
                  const sourceCode = context.sourceCode;
                  const argText = sourceCode.getText(firstArg);
                  return fixer.replaceText(firstArg, `() => ${argText}`);
                },
              });
            }
          }
          return;
        }

        // For other expression types, report as potentially problematic
        context.report({
          node: firstArg,
          messageId: 'requireThunkForKey',
          fix(fixer) {
            const sourceCode = context.sourceCode;
            const argText = sourceCode.getText(firstArg);
            return fixer.replaceText(firstArg, `() => ${argText}`);
          },
        });
      },
    };
  },
};

export default rule;
