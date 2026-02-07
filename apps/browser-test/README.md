# browser-test

Browser compatibility test harness for `awaitly` and `awaitly-visualizer`. Catches accidental `node:` imports and verifies that browser entry points work correctly.

## What it tests

| Test | Verifies |
|------|----------|
| Core imports | `ok`, `isOk` from `awaitly/core` load in the browser |
| createVisualizer | Workflow event simulation renders ASCII and Mermaid output |
| createLiveVisualizer error | Node-only API throws a helpful "not available in browser" error |
| Renderer exports | `asciiRenderer`, `mermaidRenderer`, `createIRBuilder` export correctly |
| Decision tracking | `trackIf` works in a browser context |

## Usage

```bash
pnpm dev      # Start Vite dev server (http://localhost:5173)
pnpm build    # Production build
pnpm preview  # Preview production build
```

Open the page in a browser — tests run automatically and display pass/fail results.
