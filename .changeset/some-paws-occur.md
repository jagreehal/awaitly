---
"eslint-plugin-awaitly": minor
"awaitly-analyze": minor
"awaitly": minor
"awaitly-docs": minor
---

### New Features

- **Persistence Adapters**: Added `awaitly-mongo` and `awaitly-postgres` packages for MongoDB and PostgreSQL persistence with automatic schema creation, TTL support, and connection pooling
- **Functional Utilities**: New `awaitly/functional` entry point with Effect-inspired utilities including `pipe`, `map`, `flatMap`, `match`, and collection combinators for Result type composition
- **ESLint Rule**: Added `no-double-wrap-result` rule to detect and prevent double-wrapping Result types in workflow executors

### Improvements

- Enhanced static analyzer with improved workflow detection and analysis
- Expanded documentation with guides for MongoDB/PostgreSQL persistence, functional utilities, and AI integration patterns
