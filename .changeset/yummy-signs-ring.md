---
'awaitly': minor
---

Moved `run()` function from `awaitly/workflow` to main `awaitly` entry point for better ergonomics. The `run()` function provides clean do-notation style composition for Result-returning operations, making it a core feature alongside `ok`, `err`, and other Result primitives.

**What changed:**
- `run()` is now available directly from `awaitly` (no need to import from `awaitly/workflow`)
- Related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) are also exported from main entry
- Documentation updated to reflect new import paths

**Migration:**
```typescript
// Before
import { run } from 'awaitly/workflow';

// After (recommended)
import { run } from 'awaitly';

// Still works (backward compatible)
import { run } from 'awaitly/workflow';
```

This change makes the most common composition pattern more discoverable and reduces import complexity for users who primarily use `run()` for composing Result-returning operations.
