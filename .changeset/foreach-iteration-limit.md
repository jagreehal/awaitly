---
"awaitly": major
---

`step.forEach` raises `IterationLimitError` when a collection is longer than `maxIterations`.

`maxIterations` bounds the loop for the analyzer and for execution. Reaching the
bound with items remaining now reports, so the caller learns the collection
outgrew its bound rather than reading a success:

```typescript
await step.forEach('submitAll', payments, {
  stepIdPattern: 'submit-{i}',
  maxIterations: 500,
  run: async (payment) => step('submit', () => deps.submit(payment)),
});
// 501 payments -> IterationLimitError
```

Truncation stays available, spelled out at the call site:

```typescript
await step.forEach('firstPage', items, {
  maxIterations: 100,
  onMaxIterations: 'stop',
  run: async (item) => step('handle', () => deps.handle(item)),
});
```

`IterationLimitError` and `isIterationLimitError` are exported from the root and
carry the `runtime-iteration-limit` slug, naming the step and the bound:
`IterationLimitError: submitAll reached its limit of 500 iterations with items
remaining`.

Breaking: pass `onMaxIterations: 'stop'` to keep the previous truncating
behaviour. The skill and the batch examples drop their manual size checks, which
the error now covers.
