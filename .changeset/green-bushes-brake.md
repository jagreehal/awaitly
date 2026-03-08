---
'awaitly-visualizer': patch
'awaitly-analyze': patch
'awaitly': patch
'awaitly-docs': patch
---

Add optional step metadata to StepOptions for static analysis and observability.

- **awaitly**: StepOptions now supports optional fields — Architecture & intent (`intent`, `domain`, `owner`, `tags`), Effects & dependencies (`stateChanges`, `emits`, `calls`), and Error classification (`errorMeta`). Metadata flows into step events, diagnostics, and OpenTelemetry spans.
- **awaitly-analyze**: Static workflow IR and schema include step metadata; analyzer extracts these fields when present for diagrams and tooling.
- **awaitly-visualizer**: IR builder and renderers consume and display step metadata from the analyzer output.
- **awaitly-docs**: Document StepOptions metadata in foundations/step.mdx, reference/api.md, and guides/static-analysis.mdx; add AI SDK + awaitly workflows guide.
