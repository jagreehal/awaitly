---
"awaitly": minor
"eslint-plugin-awaitly": minor
---

`match` arms may return different shapes. `match(result, { ok: (v) => ({ status: 200, body: v }), NOT_FOUND: () => ({ status: 404 }) })` now types as the union of every arm's return type (`MatchResult<H>`). Missing arms and arms that name no member of the union remain compile errors. `MatchTypeHandlers` drops its `R` parameter; `MatchHandlers` and `MatchResult` are exported from `awaitly/result`.

New lint rule `awaitly/error-prefer-match` (warn in `recommended`, error in `recommended-strict`). It flags `typeof result.error === 'string'` normalisation and `switch (true)` fan-outs over `result.error` and points at `match(result, { ... })`, which keys strings, `{ type }` objects and `TaggedError` classes on one key. Registers the `error-prefer-match` slug.
