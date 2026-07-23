# Public entry points

awaitly exposes task-shaped modules so consumers pay for—and navigate to—the capability they use.

| Entry | Responsibility |
|-------|----------------|
| `awaitly` | Convenient front door for Result, `run()`, and reliability APIs. |
| `awaitly/result` | Minimal Result-only size guarantee. |
| `awaitly/run` | Lightweight async step composition. |
| `awaitly/workflow` | Workflow composition, resources, and batching. |
| `awaitly/reliability` | Policies, circuit breakers, rate limiting, caching, and singleflight. |
| `awaitly/durable` | Durable workflow execution; also re-exports persistence contracts for convenience. |
| `awaitly/persistence` | Adapter-facing store contracts, snapshots, serialization, and migrations. |
| `awaitly/saga` | Compensating workflows. |
| `awaitly/hitl` | Human approval and orchestration. |
| `awaitly/streaming` | Stream stores and transforms. |
| `awaitly/webhook` | HTTP webhook adapters and Result mapping. |
| `awaitly/engine` | Queue-backed workflow runtime. |
| `awaitly/testing` | Workflow test harnesses and assertions. |

`awaitly/workflow` intentionally does not re-export durable execution, persistence, sagas, HITL, streaming, webhooks, or the engine. This keeps those deployment concerns independently removable and prevents CommonJS or non-tree-shaking consumers from loading the full production graph.

The package does not expose one path per internal source file. Small helpers stay grouped by the job they perform; for example, circuit breakers, rate limiting, cache, and singleflight belong to `awaitly/reliability`.
