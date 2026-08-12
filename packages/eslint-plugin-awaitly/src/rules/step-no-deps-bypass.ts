import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionExpression,
  Node,
  ObjectExpression,
  ObjectPattern,
  Pattern,
} from 'estree';

type WorkflowCallback = FunctionExpression | ArrowFunctionExpression;

/**
 * Names declared in a deps object literal: `{ validateCart, chargeCard }` or
 * `{ validateCart: impl }`. Spread elements are unknowable statically, so a
 * deps object containing one is treated as "cannot enumerate" and skipped
 * entirely rather than half-checked.
 */
function collectDepNames(obj: ObjectExpression): Set<string> | null {
  const names = new Set<string>();
  for (const prop of obj.properties) {
    if (prop.type === 'SpreadElement') return null;
    if (prop.key.type === 'Identifier') {
      names.add(prop.key.name);
    } else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
      names.add(prop.key.value);
    }
  }
  return names.size > 0 ? names : null;
}

function findCallback(node: CallExpression): WorkflowCallback | null {
  for (const arg of node.arguments) {
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
      return arg;
    }
  }
  return null;
}

function findObjectArg(node: CallExpression): ObjectExpression | null {
  for (const arg of node.arguments) {
    if (arg.type === 'ObjectExpression') return arg;
  }
  return null;
}

function isCalleeNamed(node: CallExpression, name: string): boolean {
  return node.callee.type === 'Identifier' && node.callee.name === name;
}

function isMethodNamed(node: CallExpression, name: string): boolean {
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === name
  );
}

/** Names bound by the callback's own parameters, which shadow any dep. */
function paramNames(fn: WorkflowCallback): Set<string> {
  const names = new Set<string>();
  const visitPattern = (p: Pattern | null): void => {
    if (!p) return;
    if (p.type === 'Identifier') {
      names.add(p.name);
      return;
    }
    if (p.type === 'ObjectPattern') {
      for (const prop of (p as ObjectPattern).properties) {
        if (prop.type === 'Property') visitPattern(prop.value as Pattern);
        else visitPattern(prop.argument as Pattern);
      }
      return;
    }
    if (p.type === 'ArrayPattern') {
      for (const el of p.elements) visitPattern(el as Pattern | null);
      return;
    }
    if (p.type === 'AssignmentPattern') visitPattern(p.left as Pattern);
    if (p.type === 'RestElement') visitPattern(p.argument as Pattern);
  };
  for (const param of fn.params) visitPattern(param as Pattern);
  return names;
}

/** Depth-first walk over an estree node's child nodes. */
function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
          walk(child as Node, visit);
        }
      }
    } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') {
      walk(value as Node, visit);
    }
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling a registered dependency directly inside a workflow callback. Call it through `deps.fn()` or the bound steps parameter so the injected implementation is the one that runs.',
      recommended: true,
    },
    schema: [],
    messages: {
      depsBypass:
        "'{{name}}' is registered as a workflow dependency but called directly, so the injected implementation is ignored and tests cannot substitute it. Use deps.{{name}}(...) instead.",
    },
  },
  create(context) {
    // callback node -> dep names registered for that workflow
    const depsByCallback = new Map<WorkflowCallback, Set<string>>();

    function register(callback: WorkflowCallback | null, deps: Set<string> | null): void {
      if (!callback || !deps) return;
      const existing = depsByCallback.get(callback);
      if (existing) {
        for (const name of deps) existing.add(name);
      } else {
        depsByCallback.set(callback, new Set(deps));
      }
    }

    return {
      Program(program) {
        // Variable name -> deps, for `const wf = createWorkflow('n', {...})`
        const depsByWorkflowVar = new Map<string, Set<string>>();

        // Pass 1: record every createWorkflow/createSagaWorkflow deps object.
        walk(program as Node, (node) => {
          if (node.type !== 'CallExpression') return;
          const call = node as CallExpression;
          if (
            !isCalleeNamed(call, 'createWorkflow') &&
            !isCalleeNamed(call, 'createSagaWorkflow')
          ) {
            return;
          }
          const obj = findObjectArg(call);
          if (!obj) return;
          const deps = collectDepNames(obj);
          if (!deps) return;

          const parent = (call as Node & { parent?: Node }).parent;
          if (
            parent?.type === 'VariableDeclarator' &&
            parent.id.type === 'Identifier'
          ) {
            depsByWorkflowVar.set(parent.id.name, deps);
          }
          // Chained: createWorkflow('n', {...}).run(cb)
          if (
            parent?.type === 'MemberExpression' &&
            parent.property.type === 'Identifier' &&
            parent.property.name === 'run'
          ) {
            const grandparent = (parent as Node & { parent?: Node }).parent;
            if (grandparent?.type === 'CallExpression') {
              register(findCallback(grandparent as CallExpression), deps);
            }
          }
        });

        // Pass 2: attach deps to each workflow callback.
        walk(program as Node, (node) => {
          if (node.type !== 'CallExpression') return;
          const call = node as CallExpression;

          // `run(deps, fn)` — deps object and callback in the same call.
          if (isCalleeNamed(call, 'run')) {
            const obj = findObjectArg(call);
            if (obj) register(findCallback(call), collectDepNames(obj));
            return;
          }

          // `wf.run(cb)` / `wf.run('id', cb)` / `durable.run(deps, fn, opts)`
          if (isMethodNamed(call, 'run')) {
            const callee = call.callee;
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier'
            ) {
              const deps = depsByWorkflowVar.get(callee.object.name);
              if (deps) {
                register(findCallback(call), deps);
                return;
              }
            }
            const obj = findObjectArg(call);
            if (obj) register(findCallback(call), collectDepNames(obj));
          }
        });
      },

      CallExpression(node: CallExpression) {
        // Only bare `fn(...)` calls can bypass deps; `deps.fn()` and `s.fn()` are fine.
        if (node.callee.type !== 'Identifier') return;
        const name = node.callee.name;

        const ancestors = context.sourceCode.getAncestors(node);
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const ancestor = ancestors[i] as Node;
          if (
            ancestor.type !== 'ArrowFunctionExpression' &&
            ancestor.type !== 'FunctionExpression'
          ) {
            continue;
          }
          const deps = depsByCallback.get(ancestor as WorkflowCallback);
          if (!deps) continue;
          if (!deps.has(name)) return;
          // A parameter of the callback with the same name shadows the dep.
          if (paramNames(ancestor as WorkflowCallback).has(name)) return;
          context.report({ node: node.callee, messageId: 'depsBypass', data: { name } });
          return;
        }
      },
    };
  },
};

export default rule;
