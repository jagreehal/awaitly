/**
 * Stable ids derived from source expressions.
 *
 * A raw `if (user.isPremium)` or `for (const item of order.items)` carries no
 * author-supplied id, which is why the analyzer used to refuse to label them
 * and push callers onto `step.if` / `step.forEach`. But the expression itself
 * IS a stable identifier: it only changes when the author changes the
 * condition, which is exactly when the branch identity *should* change.
 *
 * Two properties matter, and the second is easy to get wrong:
 *
 * 1. **Stable** — the same expression always derives the same id.
 * 2. **Injective** — two expressions that differ semantically must never
 *    derive the same id. These ids identify branches in diagrams and in graph
 *    validation, so a collision silently merges distinct branches.
 *
 * Property 2 is why every operator is encoded as a distinct word and why
 * anything not explicitly encoded makes the expression *unreadable* rather
 * than being quietly dropped into a separator. Derivation is deliberately
 * conservative: an expression it cannot represent losslessly yields
 * `undefined`, and the caller keeps treating that node as unlabelled.
 */

/**
 * Operators rendered as distinct words so ids stay filename-safe without
 * collapsing distinct operators onto one another. Order matters: longer
 * operators are consumed first so `!==` never matches as `!` + `==`.
 *
 * Every entry must be a DISTINCT word — mapping `||` and `??` both to `-or-`
 * would make `a || b` and `a ?? b` the same branch.
 */
const OPERATOR_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["===", "eq"],
  ["!==", "ne"],
  ["==", "looseeq"],
  ["!=", "loosene"],
  [">=", "gte"],
  ["<=", "lte"],
  ["&&", "and"],
  ["||", "or"],
  ["??", "nullish"],
  [">", "gt"],
  ["<", "lt"],
  // Must come last: the compound operators above consume their own `!`.
  // Encoded in every position, not just leading, so `a && !b` cannot collide
  // with `a && b`.
  ["!", "not"],
];

/**
 * Placeholder wrapped around each encoded operator. A NUL cannot appear in
 * source, which lets the readability check below tell a separator the encoding
 * introduced from punctuation the author actually wrote — the distinction that
 * keeps `a - b` from colliding with `a.b`, since both would otherwise sanitize
 * to `a-b`.
 */
const SEP = "\u0000";

/**
 * Anything that makes an expression's identity unreadable from its text.
 * Calls are excluded because `if (isPremium(user))` would produce the same id
 * as `if (isPremium(other))` once arguments are stripped, and keeping the
 * arguments would make the id churn on every refactor.
 */
const UNREADABLE = /[(){}[\]`]/;

/**
 * What may remain once operators have been encoded and their `SEP` markers
 * stripped: identifier characters, property access, quotes, and whitespace.
 * Anything else — arithmetic (`+`, `*`), bitwise (`&`, `|`), `?:`, `,`, etc. —
 * would be flattened into a separator and could collide, so its presence makes
 * the expression unreadable instead.
 */
const ENCODABLE = /^[A-Za-z0-9_$.\s'"]*$/;

const MAX_LENGTH = 60;

/**
 * Convert a source expression to a stable, readable, kebab-case id.
 *
 * @returns the derived id, or `undefined` when the expression is not
 * statically readable and should stay unlabelled.
 *
 * @example
 * deriveIdFromExpression("user.isPremium")      // "user-is-premium"
 * deriveIdFromExpression("order.total > 100")   // "order-total-gt-100"
 * deriveIdFromExpression("!user.verified")      // "not-user-verified"
 * deriveIdFromExpression("a && !b")             // "a-and-not-b"
 * deriveIdFromExpression("lookup(id)")          // undefined
 * deriveIdFromExpression("count + 1 > 2")       // undefined (arithmetic)
 * deriveIdFromExpression("a - b")               // undefined (would collide with `a.b`)
 */
export function deriveIdFromExpression(source: string): string | undefined {
  const trimmed = source.trim();
  if (trimmed.length === 0) return undefined;
  if (UNREADABLE.test(trimmed)) return undefined;

  // An expression made only of operators (`!!!`) has no identity to derive.
  if (!/[A-Za-z0-9_$]/.test(trimmed)) return undefined;

  let out = trimmed;
  for (const [op, word] of OPERATOR_WORDS) {
    out = out.split(op).join(`${SEP}${word}${SEP}`);
  }

  // Reject before sanitizing: once `[^a-z0-9]+` runs, an unencoded operator is
  // indistinguishable from a separator and the collision is already baked in.
  if (!ENCODABLE.test(out.split(SEP).join(""))) return undefined;

  out = out.split(SEP).join("-");

  // camelCase / PascalCase -> kebab, before lowercasing loses the boundary.
  out = out.replace(/([a-z0-9])([A-Z])/g, "$1-$2");

  out = out
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (out.length === 0) return undefined;

  return out.length > MAX_LENGTH ? out.slice(0, MAX_LENGTH).replace(/-$/, "") : out;
}
