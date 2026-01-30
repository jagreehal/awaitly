---
"awaitly-postgres": minor
"awaitly-analyze": minor
"awaitly-libsql": minor
"awaitly-mongo": minor
"awaitly-visualizer": minor
"browser-test": minor
"awaitly": minor
"awaitly-docs": minor
---

Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.
