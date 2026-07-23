# Domain language

awaitly models expected async failure as typed data and separates orchestration capabilities by deployment concern.

| Term | Meaning |
|------|---------|
| Result | A success value or expected failure value; it does not throw for expected outcomes. |
| Run | Lightweight composition of Result-returning dependencies with inferred failures. |
| Workflow | Named, observable step orchestration with caching and resume state. |
| Reliability | Retry, timeout, fallback, circuit breaking, rate limiting, caching, and duplicate-request suppression. |
| Persistence | Store contracts, snapshots, resume-state serialization, and state migrations. |
| Durable | Workflow execution that persists progress and coordinates concurrent workers. |
| Saga | A workflow whose completed side effects can be compensated in reverse order. |
| HITL | Human-in-the-loop approval, notification, suspension, and resumption. |
| Streaming | Persistent stream stores, readers, writers, backpressure, and transforms. |
| Webhook | Framework-neutral HTTP request validation and Result-to-response mapping. |
| Engine | The queue-backed runtime that polls, schedules, and executes registered workflows. |

## Public module rule

A public entry point should represent a task or deployment boundary. It should hide related implementation modules and pass the deletion test: removing an unrelated capability must not require changing consumers of the entry point. Do not add leaf entry points merely to mirror source filenames.
