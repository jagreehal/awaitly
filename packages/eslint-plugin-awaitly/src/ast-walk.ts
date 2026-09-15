import type { Node } from 'estree';

/**
 * Walks the AST under `root` looking for any node that satisfies `predicate`.
 * Stops on first match.
 */
export function anyDescendant(root: Node, predicate: (n: Node) => boolean): boolean {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop() as Node;
    if (predicate(n)) return true;
    for (const key of Object.keys(n)) {
      // ESLint augments the AST with a `parent` back-reference at runtime;
      // skip it to avoid infinite loops. The estree types don't declare it,
      // so this comparison is intentionally loose.
      if ((key as string) === 'parent') continue;
      const v = (n as unknown as Record<string, unknown>)[key];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'type' in item) {
            stack.push(item as Node);
          }
        }
      } else if ('type' in (v as object)) {
        stack.push(v as Node);
      }
    }
  }
  return false;
}
