---
'awaitly': minor
---

Rename state collection APIs for clarity: `createStepCollector` → `createResumeStateCollector`, `getState()` → `getResumeState()`, and `createHITLCollector` → `createApprovalStateCollector`. These names better reflect that the collectors are specifically for building resume state for workflow persistence and replay.
