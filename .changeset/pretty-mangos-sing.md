---
'awaitly-analyze': minor
---

**Static analysis: type extraction, test harness, data flow**

- **Type extraction**: Result-like type extraction with `TypeInfo` (display, canonical, kind, confidence, source). Extracts `AsyncResult<T, E, C>`, `Result<T, E>`, `Promise<Result<T, E>>`; confidence levels `exact` / `inferred` / `fallback`. Step nodes include `outputTypeInfo`, `errorTypeInfo`, `causeTypeInfo`; dependency signatures include typed params and result-like return types.
- **Test harness**: `normalizeAnalysisOutput()`, `loadFixture()`, support for generating and comparing expected outputs; ID, path, timestamp, and TypeScript version normalization for deterministic tests.
- **Data flow**: Typed data flow propagation (`writeType`, `readTypes` on nodes), `TypeMismatch` detection, `keyTypes` map for data keys.
- **Tests**: All tests updated to use `workflow.run()` API.
