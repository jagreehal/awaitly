# Error Patterns Documentation Page — Design Spec

## Summary

Add a new documentation page to the awaitly docs site that educates users and AI coding agents on when to use Result types and when not to. The page blends philosophy, comparison, and practical good/bad code patterns, grounded in the principle that Result types are for expected domain errors — not a replacement for all exception handling.

## Location

- **File:** `apps/docs-site/src/content/docs/foundations/error-patterns.md`
- **Sidebar:** After "Tagged Errors" in the Foundations section
- **Slug:** `foundations/error-patterns`
- **Label:** `Error Patterns`

## Page Structure

### 1. Frontmatter

```yaml
---
title: "Error Patterns: When (and When Not) to Use Result"
description: Good and bad patterns for error handling with awaitly — when to use Result types, when to let exceptions throw, and how awaitly keeps you safe either way
---
```

### 2. Intro (~3 sentences)

Result types are a powerful tool for modeling expected outcomes, but using them everywhere creates noise without benefit. awaitly is designed so you only model expected domain errors as typed Results; unexpected exceptions are caught automatically and wrapped as `UnexpectedError` with the original exception preserved in `cause`. This page shows patterns to follow and patterns to avoid.

### 3. The Three Classes of Errors (~1 paragraph)

Concise table or list with three categories:

| Class | What it is | How awaitly handles it |
|-------|-----------|----------------------|
| **Domain errors** | Expected business failures (validation, not-found, insufficient funds) | You model these as typed errors with `err()`. Result is the right tool. |
| **Panics** | Programmer errors, out-of-memory, null references | Let them throw. awaitly wraps as `UnexpectedError` with full `cause` chain. |
| **Infrastructure errors** | Network timeouts, auth failures, disk I/O | Case-by-case. Model the ones your domain cares about; let the rest become `UnexpectedError`. |

### 4. Bad Patterns (4 patterns)

Each pattern follows the format:
- Heading: imperative "Don't X"
- 1-2 sentence *why*
- Bad code example (❌)
- Good code example (✅)
- Code examples are short (5-12 lines each)

#### Pattern 1: Don't wrap every exception in Result

**Why:** awaitly already catches unexpected throws in `run`, `createWorkflow`, and `saga`. Wrapping them yourself adds noise and hides the real exception.

**Bad:** Manually try/catching inside a step and returning `err('UNEXPECTED')`.

**Good:** Just let it throw. awaitly wraps it as `UnexpectedError` with the original exception in `cause`.

#### Pattern 2: Don't use Result when you should fail fast

**Why:** If your app can't continue without a config file or database connection, don't return a Result — throw immediately at startup. Returning `err()` delays the inevitable and obscures the failure.

**Bad:** `loadConfig` returning `err('CONFIG_MISSING')` deep in a workflow.

**Good:** Throwing at startup before any workflow runs. Config validation happens outside awaitly.

#### Pattern 3: Don't model every possible I/O error

**Why:** Modeling every file-system or network error as a union type creates busywork. Only model the errors your domain logic actually branches on.

**Bad:** A union type with `FILE_NOT_FOUND | DIRECTORY_NOT_FOUND | FILE_NOT_ACCESSIBLE | PATH_TOO_LONG | OTHER_IO_ERROR`.

**Good:** Model only what matters (e.g., `'NOT_FOUND'`); let the rest become `UnexpectedError` with the real exception in `cause`.

#### Pattern 4: Don't use Result if no one checks the error cases

**Why:** If every consumer just checks `result.ok` and doesn't branch on specific error types, you don't need a rich error union. Keep it simple.

**Bad:** Returning `err(new DetailedError({ code, reason, context }))` when callers only check `!result.ok`.

**Good:** Return a simple string literal or even use `step.try` which gives you a boolean-like result.

### 5. Good Patterns (3 patterns)

#### Pattern 5: Use Result for expected domain errors

**Why:** Validation failures, business rule violations, and not-found are expected outcomes that callers need to branch on. This is exactly what Result is for.

**Good:** Workflow steps returning `err('INSUFFICIENT_FUNDS')` or `err('CART_EMPTY')` — typed, exhaustive, no stack trace needed.

#### Pattern 6: Use `step.try` to convert throwing code at boundaries

**Why:** Third-party libraries throw. Wrap them at the boundary with `step.try` so the exception becomes a typed error inside your workflow.

**Good:** Using `step.try('parseInput', () => JSON.parse(raw), { error: () => 'INVALID_JSON' as const })`.

#### Pattern 7: Let `UnexpectedError` preserve diagnostics

**Why:** `UnexpectedError` keeps the original exception in `cause`. You get full stack traces for debugging without cluttering your domain model with infrastructure concerns.

**Good:** Checking `result.error._tag === 'UnexpectedError'` and accessing `result.error.cause` for logging. Show that the original Error with stack trace is intact.

### 6. How awaitly Helps (~short paragraph)

Short summary: `run()`, `createWorkflow()`, and `saga()` all catch thrown exceptions automatically and wrap them as `UnexpectedError` with the original exception in `cause`. You never lose stack traces. You never need to model every possible failure. Your typed error union stays clean — only the domain errors you actually care about.

### 7. Further Reading

- Internal links to: Foundations > Error Handling, Foundations > Tagged Errors, Comparison > awaitly vs try/catch
- External links:
  - Scott Wlaschin, "Against Railway-Oriented Programming" (fsharpforfunandprofit.com)
  - Eirik Tsarpalis, "You're better off using Exceptions" (eiriktsarpalis.wordpress.com)

## Format

- Plain `.md` (no MDX components needed — this is a patterns/philosophy page, not a visual walkthrough)
- Uses `##` for main sections, `###` for individual patterns
- Code blocks use TypeScript with `// ❌` and `// ✅` markers matching existing docs style
- No emojis beyond the ❌/✅ markers already used in the codebase

## Sidebar Change

In `astro.config.mjs`, add after the Tagged Errors entry:

```javascript
{ label: 'Error Patterns', slug: 'foundations/error-patterns' },
```

## Out of Scope

- No changes to awaitly library code (verified correct in review)
- No changes to existing docs pages
- No new components
