---
'eslint-plugin-awaitly': minor
'awaitly-analyze': minor
'awaitly': minor
'awaitly-docs': minor
---

- **awaitly**: Improved fetch helpers with typed errors (FetchNetworkError, FetchHttpError, FetchParseError, FetchDecodeError, FetchAbortError, FetchTimeoutError), options for timeout, custom error body/error mapping, retry, and for `fetchJson` optional decode and strict Content-Type; added `fetchResponse` export.
- **eslint-plugin-awaitly**: New rule `no-dynamic-import` to disallow dynamic import() and require(); rule and test updates for no-immediate-execution, require-result-handling, require-thunk-for-key, and stable-cache-keys.
- **awaitly-analyze**: Updates to ts-morph loader.
- **awaitly-docs**: Extending Awaitly guide updated to reflect fetch helper patterns.
