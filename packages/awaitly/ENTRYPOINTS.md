# Public entry points

awaitly exposes task-shaped modules so consumers pay for—and navigate to—the capability they use.

| Entry | Responsibility |
|-------|----------------|
| `awaitly` | The front door: Result, `run()`, `createWorkflow`, steps, resources, batching, and the reliability APIs (policies, circuit breakers, rate limiting, caching, singleflight). |
| `awaitly/result` | Minimal Result-only size guarantee. |
| `awaitly/durable` | Deployment concerns: durable execution, persistence contracts, sagas, human-in-the-loop, streaming, webhooks, and the queue-backed engine. |
| `awaitly/testing` | Workflow test harnesses and assertions. |

`awaitly` intentionally does not re-export anything from `awaitly/durable`. This keeps those deployment concerns independently removable and prevents CommonJS or non-tree-shaking consumers from loading the full production graph.

The package does not expose one path per internal source file. Small helpers stay grouped by the job they perform; for example, circuit breakers, rate limiting, cache, and singleflight are reachable from `awaitly` rather than a `reliability` path of their own.
