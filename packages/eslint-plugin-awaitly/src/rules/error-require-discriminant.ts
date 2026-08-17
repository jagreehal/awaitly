import type { Rule } from 'eslint';
import type { Class, ClassBody, Node } from 'estree';

/**
 * Rule: error-require-discriminant
 *
 * TypeScript compares types by structure, so two error classes that add
 * nothing to `Error` are one type. `ErrorA | ErrorB` collapses to a single
 * member, an error vanishes from the inferred union, and nothing fails to
 * compile. The code looks handled and is not.
 *
 * A literal-valued `type` gives each class a shape of its own, and doubles as
 * the key `match` and `matchError` switch on.
 *
 * BAD:  class NotFoundError extends Error {}
 * GOOD: class NotFoundError extends Error { readonly type = 'NotFoundError' }
 * GOOD: class NotFoundError extends TaggedError('NotFoundError')<{ id: string }> {}
 */

const DISCRIMINANT_KEYS = new Set(['type', '_tag']);

type TypeAnnotation = {
  type: string;
  literal?: { type: string; value?: unknown };
};

function isStringLiteralType(annotation: TypeAnnotation | undefined): boolean {
  return (
    annotation?.type === 'TSLiteralType' &&
    annotation.literal?.type === 'Literal' &&
    typeof annotation.literal.value === 'string'
  );
}

/**
 * Does this class extend `Error` directly?
 *
 * Deliberately narrow. A class extending a project base class may inherit a
 * discriminant this rule cannot see, and guessing there costs more in false
 * reports than it earns.
 */
function extendsErrorDirectly(node: Class): boolean {
  const parent = node.superClass;
  return parent?.type === 'Identifier' && parent.name === 'Error';
}

/**
 * Does the class body declare a string-literal `type` or `_tag`?
 */
function declaresDiscriminant(body: ClassBody): boolean {
  return body.body.some((member) => {
    const kind = (member as { type: string }).type;
    const property = member as unknown as {
      key: { type: string; name?: string; value?: unknown };
      static?: boolean;
      readonly?: boolean;
      value?: Node | null;
      typeAnnotation?: { typeAnnotation?: Node };
    };
    const { key } = property;

    const isDiscriminant =
      key.type === 'Identifier'
        ? DISCRIMINANT_KEYS.has(key.name ?? '')
        : key.type === 'Literal' && DISCRIMINANT_KEYS.has(String(key.value));
    if (!isDiscriminant || property.static) return false;

    if (kind === 'MethodDefinition') {
      const getter = member as unknown as {
        kind: string;
        value: { returnType?: { typeAnnotation?: TypeAnnotation } };
      };
      return (
        getter.kind === 'get' &&
        isStringLiteralType(getter.value.returnType?.typeAnnotation)
      );
    }

    if (kind !== 'PropertyDefinition' && kind !== 'TSAbstractPropertyDefinition') {
      return false;
    }

    const annotation = property.typeAnnotation?.typeAnnotation as TypeAnnotation | undefined;
    if (isStringLiteralType(annotation)) return true;
    if (annotation !== undefined) return false;

    if (
      property.readonly &&
      property.value?.type === 'Literal' &&
      typeof property.value.value === 'string'
    ) {
      return true;
    }

    const value = property.value as unknown as
      | {
          type: string;
          expression?: { type: string; value?: unknown };
          typeAnnotation?: { type: string; typeName?: { type: string; name?: string } };
        }
      | null
      | undefined;
    return (
      value?.type === 'TSAsExpression' &&
      value.expression?.type === 'Literal' &&
      typeof value.expression.value === 'string' &&
      value.typeAnnotation?.type === 'TSTypeReference' &&
      value.typeAnnotation.typeName?.type === 'Identifier' &&
      value.typeAnnotation.typeName.name === 'const'
    );
  });
}

/** The name to show, for a declaration or for a class expression given one. */
function readName(node: Class): string {
  if (node.id?.name) return node.id.name;

  const parent = (node as unknown as { parent?: Node }).parent;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }

  return 'ErrorClass';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require error classes extending Error to declare a literal discriminant, so a union of them survives TypeScript structural comparison.',
      recommended: true,
    },
    schema: [],
    messages: {
      requireDiscriminant:
        '{{name}} adds nothing to Error, so TypeScript treats it as the same type as every other bare error class and collapses them in a union. Add `readonly type = \'{{name}}\'`, or declare it with TaggedError.',
    },
  },
  create(context) {
    function check(node: Class): void {
      if (!extendsErrorDirectly(node)) return;
      if (declaresDiscriminant(node.body)) return;

      context.report({
        node: (node.id ?? node) as Node,
        messageId: 'requireDiscriminant',
        data: { name: readName(node) },
      });
    }

    return {
      ClassDeclaration: check,
      ClassExpression: check,
    };
  },
};

export default rule;
