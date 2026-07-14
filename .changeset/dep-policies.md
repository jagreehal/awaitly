---
"awaitly": minor
"awaitly-analyze": minor
---

Per-dependency policies: `retry`, `timeout`, `fallback`.

**awaitly**

- Policies are value-level function wrappers declared in the deps object — call sites stay pristine: `charge: retry(timeout(charge, 5000), { attempts: 3 })`.
- Exact error-union math: `retry` preserves the union (the last failure propagates), `timeout` adds `TimeoutError`, `fallback` consumes the base union leaving only the handler's errors.
- Plain (non-Result) functions are valid inputs: values normalize to `ok()`, throws keep throwing and surface as `UnexpectedError` at the run/workflow layer.
- Wrappers preserve the base function's name, so workflow events and diagrams keep showing the dep name.
- Exported from `awaitly` and `awaitly/run`: `retry`, `timeout`, `fallback`, plus `RetryPolicyOptions`, `PolicyFn`, `PolicyDelay` types.

**awaitly-analyze**

- Policy chains are read structurally from the deps literal: the analyzer unwraps to the base function for type extraction (error inference no longer depends on resolving wrapper generics), records the chain on `DependencyInfo.policies` (innermost first), and applies the same error-union math — diagrams can state "this edge retries 3× with a 5s timeout" as fact.
