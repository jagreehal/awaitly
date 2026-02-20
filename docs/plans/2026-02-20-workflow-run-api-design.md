# workflow.run() API Design

Breaking change to `createWorkflow`. Replaces direct callable `workflow(fn)` with `workflow.run(name?, fn, config?)`. Removes `.with()`, `.snapshot`, `.getSnapshot()`, `.subscribe()`, and introspection properties.

## New API

```typescript
// Create — deps define the contract, types inferred
const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => { ... };
const fetchPosts = async (uid: string): AsyncResult<Post[], "FETCH_ERR"> => { ... };

const workflow = createWorkflow("onboard", { fetchUser, fetchPosts }, options?);

// Run — anonymous
await workflow.run(async ({ step, deps }) => {
  const user = await step("fetchUser", () => deps.fetchUser("1"));
  const posts = await step("fetchPosts", () => deps.fetchPosts(user.id));
  return { user, posts };
});

// Run — named (for logging, tracing, resume)
await workflow.run("onboard-user-1", async ({ step, deps }) => {
  const user = await step("fetchUser", () => deps.fetchUser("1"));
  return user;
});

// Run — with config override
await workflow.run("onboard-user-1", fn, {
  deps: { fetchUser: mockFn },
  signal: ctrl.signal,
  onEvent: logger,
});
```

## Overloads

```typescript
workflow.run(fn): AsyncResult<T, E | U>
workflow.run(fn, config): AsyncResult<T, E | U>
workflow.run(name, fn): AsyncResult<T, E | U>
workflow.run(name, fn, config): AsyncResult<T, E | U>
```

## What changes from v1

| v1 | New |
|---|---|
| `workflow(fn)` | `workflow.run(fn)` |
| `workflow(args, fn)` | Removed — use closure |
| `workflow.run(fn, exec)` | `workflow.run(fn, config)` |
| `workflow.with(exec)` | Removed — pass config to `.run()` |
| `config.deps` | New — override deps at call time |
| Run name | New — optional first string arg to `.run()` |
| `.name`, `.deps`, `.options` | Removed |
| `.snapshot`, `.getSnapshot()`, `.subscribe()` | Removed — use `createResumeStateCollector` + `onEvent` |

## What stays the same

- `createWorkflow("name", deps, options?)` creation signature
- `({ step, deps, ctx })` callback shape
- All step methods (`.try`, `.parallel`, `.retry`, `.sleep`, `.withTimeout`, `.race`, `.allSettled`, `.branch`, `.forEach`, etc.)
- All options (cache, resumeState, onEvent, onError, signal, catchUnexpected, hooks)
- Result types, error inference from deps (`ErrorsOfDeps`)
- Snapshot/resume via `createResumeStateCollector` + `onEvent`

## Config type

```typescript
type RunConfig<E, U, C, Deps> = {
  deps?: Partial<Deps>;           // Override creation-time deps
  onEvent?: (event, ctx) => void;
  onError?: (error, stepName?, ctx?) => void;
  signal?: AbortSignal;
  createContext?: () => C | Promise<C>;
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  shouldRun?: (workflowId, context) => boolean | Promise<boolean>;
  onBeforeStart?: (workflowId, context) => boolean | Promise<boolean>;
  onAfterStep?: (stepKey, result, workflowId, context) => void | Promise<void>;
  cache?: StepCache;
  snapshot?: WorkflowSnapshot | null;
  strict?: boolean;
  devWarnings?: boolean;
  streamStore?: StreamStore;
};
```

## Dep override semantics

Config `deps` is a partial override merged with creation-time deps:

```typescript
const workflow = createWorkflow("w", { fetchUser, fetchPosts });

// Only fetchUser overridden; fetchPosts uses creation-time default
await workflow.run(fn, { deps: { fetchUser: mockFetchUser } });
```

TypeScript enforces that overridden deps match the original contract.

## Analyzer changes

The `awaitly-analyze` static analyzer needs to detect `workflow.run(name?, fn, config?)` property access calls instead of `workflow(fn)` / `workflow(args, fn)` direct calls. Step detection, dep extraction, and all other analysis stays identical.

## Workflow object shape

After creation, the workflow object has a single method:

```typescript
interface Workflow<E, U, Deps, C> {
  run<T>(fn: WorkflowFn<T, E, Deps, C>): AsyncResult<T, E | U>;
  run<T>(fn: WorkflowFn<T, E, Deps, C>, config: RunConfig<E, U, C, Deps>): AsyncResult<T, E | U>;
  run<T>(name: string, fn: WorkflowFn<T, E, Deps, C>): AsyncResult<T, E | U>;
  run<T>(name: string, fn: WorkflowFn<T, E, Deps, C>, config: RunConfig<E, U, C, Deps>): AsyncResult<T, E | U>;
}
```
