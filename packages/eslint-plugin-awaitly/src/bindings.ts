import type { Scope, SourceCode } from 'eslint';
import type { Identifier, Node } from 'estree';

export function findVariable(sourceCode: SourceCode, node: Identifier): Scope.Variable | undefined {
  let scope: Scope.Scope | null = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return undefined;
}

/** Whether `callee` is the export `name`, imported (named or via namespace) from one of `modules`. */
export function isImportOf(callee: Node, name: string, modules: ReadonlySet<string>, sourceCode: SourceCode): boolean {
  if (callee.type === 'Identifier') {
    const def = findVariable(sourceCode, callee)?.defs[0];
    return (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportSpecifier' &&
      def.node.imported.type === 'Identifier' &&
      def.node.imported.name === name &&
      def.parent.type === 'ImportDeclaration' &&
      modules.has(String(def.parent.source.value))
    );
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === name &&
    callee.object.type === 'Identifier'
  ) {
    const def = findVariable(sourceCode, callee.object)?.defs[0];
    return (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportNamespaceSpecifier' &&
      def.parent.type === 'ImportDeclaration' &&
      modules.has(String(def.parent.source.value))
    );
  }
  return false;
}
