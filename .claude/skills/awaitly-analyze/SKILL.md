---
name: awaitly-analyze
description: "Static analysis for awaitly workflows - complexity, paths, visualization. Optimized for coding agents."
user-invocable: true
---

# Awaitly Static Analysis (Agent-Optimized)

Use awaitly-analyze to understand workflow structure **without execution**. Entrypoint: `analyze(path)` then `.single()`, `.named(name)`, or `.all()` to get IR; then use render/generate APIs.

---

## Agent Contract (MUST follow)

### Entrypoints
- **MUST** start with `analyze(filePath)` (string path to a .ts file). Returns a selection API; **MUST** call one of `.single()`, `.named('workflowName')`, `.singleOrNull()`, `.firstOrNull()`, or `.all()` to obtain IR (or null).
- **MUST NOT** assume `analyze()` returns IR directly. It returns `AnalyzeResult` with `.single()`, `.named()`, `.all()`, `.singleOrNull()`, `.firstOrNull()`.

### API surface constraint
- **MUST NOT** invent new exports or function names. Use only the APIs listed in this skill or in package types.
- **MUST NOT** assume undocumented options or overloads. For options (e.g. `MermaidOptions`, `PathGeneratorOptions`), consult package types.
- If an API is not listed here, consult `awaitly-analyze` package types or README before using it.

### IR usage
- **MUST** use the IR value (from `.single()` etc.) as the first argument to functions like `renderStaticMermaid(ir)`, `generatePaths(ir)`, `calculateComplexity(ir)`, `validateStrict(ir)`.
- **MUST NOT** pass a file path to render/generate functions; they expect IR.

### Cross-workflow vs IR APIs
- `analyzeWorkflowGraph([...paths])` takes **file paths** (strings), not IR.
- All `renderStatic*`, `generate*`, `calculate*`, `validate*` functions take **IR**, not paths.
- **MUST NOT** pass IR to `analyzeWorkflowGraph`. **MUST NOT** pass file paths to IR functions (e.g. `renderStaticMermaid`, `generatePaths`).

### Strict mode and step IDs
- In strict mode, agents **MUST** ensure every step call uses a **static string literal** as the first argument (ID or name). See awaitly-patterns skill.
- Agents **MUST NOT** emit legacy step forms (e.g. `step(fn, opts)` without id); they produce `stepId: "<missing>"` and strict validation diagnostics.

---

## Do / Don't — Canonical Snippets

### Analyze and get IR (required first step)
```typescript
import { analyze } from 'awaitly-analyze';

// Single workflow in file (throws if not exactly 1)
const ir = analyze('./workflow.ts').single();

// Named workflow (when file has multiple)
const ir = analyze('./file.ts').named('checkoutWorkflow');

// All workflows in file
const workflows = analyze('./file.ts').all();

// Safe: null if none or multiple
const ir = analyze('./file.ts').singleOrNull();
const ir = analyze('./file.ts').firstOrNull();
```

### Diagram from IR (do not pass path)
```typescript
import { renderStaticMermaid, renderEnhancedMermaid } from 'awaitly-analyze';

const diagram = renderStaticMermaid(ir, { direction: 'LR' });
const enhanced = renderEnhancedMermaid(ir, { showDataFlow: true, showErrors: true });
```

### Paths and complexity from IR
```typescript
import { generatePaths, calculateComplexity, assessComplexity, formatComplexitySummary } from 'awaitly-analyze';

const paths = generatePaths(ir);
const metrics = calculateComplexity(ir);
const assessment = assessComplexity(metrics);
console.log(formatComplexitySummary(metrics, assessment));
```

### Selection handling: null check before using IR
```typescript
const ir = analyze('./workflow.ts').singleOrNull();
if (!ir) {
  console.error('No single workflow found');
  process.exit(1);
}
const paths = generatePaths(ir);
```

### Diagnostics first (validate before generating)
Run strict validation before generating diagrams or paths; fail fast if the workflow has step-ID or other strict violations.
```typescript
import { analyze, validateStrict, formatDiagnostics } from 'awaitly-analyze';

const ir = analyze('./workflow.ts').singleOrNull();
if (!ir) throw new Error('No single workflow found');

const strict = validateStrict(ir);
if (!strict.valid) {
  console.error(formatDiagnostics(strict));
  process.exit(1);
}
// Now safe to generatePaths(ir), renderStaticMermaid(ir), etc.
```

---

## Autofix Rules (deterministic)

| See | Do instead |
|-----|------------|
| Passing a file path to `renderStaticMermaid` or `generatePaths` | Get IR first: `const ir = analyze(path).single();` then `renderStaticMermaid(ir)`, `generatePaths(ir)`. |
| Assuming `analyze(path)` returns IR | Call `.single()` or `.named(name)` or `.all()` on the result. |
| Inventing an export (e.g. `renderWorkflow`) | Use only exports listed here or in package types: `renderStaticMermaid`, `renderEnhancedMermaid`, `renderStaticJSON`, etc. |

---

## Workflow selection (invariants)

- `analyze(filePath)` — path is a string to a .ts file.
- `.single()` — returns IR; throws if not exactly one workflow.
- `.named('name')` — returns IR for that workflow name; throws if not found.
- `.all()` — returns array of IR.
- `.singleOrNull()` / `.firstOrNull()` — returns IR or null; use when you want safe access.

**Prefer `.singleOrNull()` or `.firstOrNull()` in tooling/scripts**; use `.single()` only when you *expect exactly one* workflow and want a hard failure on mismatch.

For options (e.g. TS config, globs), consult package types (`AnalyzeResult`, `analyze`).

---

## Output formats (canonical)

| Need | Use | Notes |
|------|-----|-------|
| Mermaid diagram | `renderStaticMermaid(ir)` or `renderEnhancedMermaid(ir, options)` | First arg is IR. |
| JSON | `renderStaticJSON(ir, { pretty: true })` | For machine consumption. |
| Test matrix | `generateTestMatrix(paths)` then `formatTestMatrixMarkdown(matrix)` | Paths from `generatePaths(ir)`. |
| Path stats | `calculatePathStatistics(paths)` | Paths from `generatePaths(ir)`. |

For options (direction, showDataFlow, etc.), consult package types (`MermaidOptions`, `EnhancedMermaidOptions`, `JSONRenderOptions`).

---

## Path generation

- **MUST** call `generatePaths(ir)` with IR (not file path).
- Filter paths with `filterPaths(paths, { mustIncludeStep, noLoops, maxLength })` when needed.
- Use `calculatePathStatistics(paths)` for counts and stats.

---

## Complexity

- `calculateComplexity(ir)` returns metrics (cyclomatic, cognitive, path count, max depth).
- `assessComplexity(metrics)` returns assessment; `formatComplexitySummary(metrics, assessment)` for human-readable output.

---

## Strict mode validation

- `validateStrict(ir, options)` returns a validation result; use `formatDiagnostics(result)` for human-readable output.
- **Invariant:** Strict mode expects step calls to use a **string as the first argument** (ID or name). Legacy `step(fn, opts)` or missing step IDs trigger diagnostics. For full rule list and options, consult package types (`StrictValidationResult`, `StrictRule`).

---

## Data flow and error flow

- `buildDataFlowGraph(ir)` → graph; `validateDataFlow(graph)` for validation.
- `analyzeErrorFlow(ir)` → error flow; `formatErrorSummary(errorFlow)` for readable output.

For types and options, consult package types (`DataFlowGraph`, `ErrorFlowAnalysis`).

---

## Cross-workflow analysis

- `analyzeWorkflowGraph([path1, path2, ...])` — array of file paths (not IR).
- `renderGraphMermaid(graph)` for diagram.

---

## CLI (deterministic)

```bash
npx awaitly-analyze ./workflow.ts
npx awaitly-analyze ./workflow.ts --format json
npx awaitly-analyze ./workflow.ts -o
```

Do not invent CLI flags; consult package CLI help or README for supported options.

---

## IR node types (reference)

The analyzer produces a static IR tree. **Common** node types include: `workflow`, `step`, `saga-step`, `sequence`, `parallel`, `race`, `conditional`, `decision`, `switch`, `loop`, `stream`, `workflow-ref` (non-exhaustive; consult package types). Step nodes have a string step ID (or `<missing>` if legacy form). **MUST NOT** assume presence or shape of a `.type` string at runtime; consult types for the current schema.
