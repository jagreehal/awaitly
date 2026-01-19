---
'awaitly': minor
---

Enhanced HITL orchestrator with production-ready approval workflows. Added `execute()` and `resume()` methods for workflow orchestration, `grantApproval()`, `rejectApproval()`, and `editApproval()` for approval management, and improved workflow state persistence. Enhanced testing harness with expanded mocking capabilities. Added workflow hooks (`shouldRun`, `onBeforeStart`, `onAfterStep`) for distributed locking, rate limiting, and checkpointing. Improved core workflow engine with better HITL collector support and event tracking.
