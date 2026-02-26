---
'awaitly-visualizer': minor
'awaitly-postgres': minor
'awaitly-analyze': minor
'awaitly-libsql': minor
'awaitly-mongo': minor
'awaitly-docs': minor
---

- **awaitly-analyze**: Fix Mermaid diagram labels: normalize literal `\n` in `escapeLabel` so saga steps (e.g. "Notify (try)") and step annotations render on one line instead of showing backslash-n. Update tests to expect current dep-step label output (no "(dep: ...)" in diagram labels).
