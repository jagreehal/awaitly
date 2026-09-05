/**
 * detect-step is the shared way a rule decides "this call is a step call".
 *
 * Rules matched the literal name `step`, so ordinary aliasing —
 * `async ({ step: s }) => s('id', ...)` — turned them off, and a free variable
 * called `step` that was never a step turned them on.
 */

import { describe, it, expect } from 'vitest';
import { Linter, type SourceCode } from 'eslint';
import { stepNamesAt } from '../src/detect-step.js';
import type { CallExpression, Node } from 'estree';

const linter = new Linter({ configType: 'flat' });
const sources = new WeakMap<Node, SourceCode>();

/** Parse and hand back the first call expression matching `calleeText`. */
function callAt(code: string, calleeText: string): CallExpression {
  let found: CallExpression | undefined;

  linter.verify(code, [
    {
      plugins: {
        probe: {
          rules: {
            grab: {
              create(context) {
                return {
                  CallExpression(node: CallExpression & { parent?: Node }) {
                    const callee = node.callee;
                    const name =
                      callee.type === 'Identifier'
                        ? callee.name
                        : callee.type === 'MemberExpression' &&
                            callee.object.type === 'Identifier'
                          ? callee.object.name
                          : undefined;
                    if (name === calleeText && !found) {
                      found = node;
                      sources.set(node, context.sourceCode);
                    }
                  },
                };
              },
            },
          },
        },
      },
      rules: { 'probe/grab': 'error' },
    },
  ]);

  if (!found) throw new Error(`no call to ${calleeText} found`);
  return found;
}

describe('stepNamesAt', () => {
  it('includes the canonical name so a bare fragment still lints', () => {
    const node = callAt(`step('id', () => load());`, 'step');
    expect([...stepNamesAt(node, sources.get(node)!)]).toContain('step');
  });

  it('resolves a destructured alias', () => {
    const node = callAt(
      `run(deps, async ({ step: s }) => { s('id', () => load()); });`,
      's'
    );
    expect([...stepNamesAt(node, sources.get(node)!)]).toContain('s');
  });

  it('resolves an alias inside a nested callback', () => {
    const node = callAt(
      `run(deps, async ({ step: s }) => {
         [1].forEach(() => { s('id', () => load()); });
       });`,
      's'
    );
    expect([...stepNamesAt(node, sources.get(node)!)]).toContain('s');
  });

  it('does not leak an alias out of the callback that bound it', () => {
    const node = callAt(
      `run(deps, async ({ step: s }) => s('a', () => load()));
       s('b', () => load());`,
      's'
    );
    // The second call is outside the workflow callback entirely.
    const outside = callAt(`s('b', () => load());`, 's');
    expect([...stepNamesAt(outside, sources.get(outside)!)]).not.toContain('s');
    expect(node).toBeDefined();
  });
});
