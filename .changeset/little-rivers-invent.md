---
"awaitly": minor
"awaitly-docs": minor
---

Add browser support for workflow visualization module. The `awaitly/visualize` export now includes a browser-safe version that excludes Node.js-specific features (`createDevServer`, `createLiveVisualizer`) and provides all visualization capabilities (ASCII, Mermaid, HTML rendering, decision tracking, performance analysis) for browser environments. Node.js-specific features throw helpful errors when called in the browser.
