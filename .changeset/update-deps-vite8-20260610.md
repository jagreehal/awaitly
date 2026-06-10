---
"awaitly-postgres": patch
"awaitly-visualizer": patch
"eslint-plugin-awaitly": patch
---

chore: update dependencies + migrate to vite 8

Minor/patch dependency refresh via npm-check-updates (`--target minor`, 3-day publish cooldown) — no major version bumps. Forced `vite ^8` across the workspace via a pnpm override (vitest already supports it). TypeScript stays on 5.x and eslint on 9.x (their majors are deliberately deferred).
