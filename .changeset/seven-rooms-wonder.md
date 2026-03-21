---
'awaitly-analyze': patch
'awaitly': patch
---

Improve durable workflow idempotency and concurrent execution handling.

- Add in-process idempotency deduplication so concurrent runs with the same idempotency key share a single execution instead of racing.
- Persist idempotency run markers/results to strengthen cross-process safety and reuse completed results by key.
- Extend durable concurrency errors with a `reason` field (`in-process` or `cross-process`) for clearer diagnostics.
