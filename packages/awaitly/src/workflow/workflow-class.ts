/**
 * Class-based Workflow API.
 *
 * Extend this class to define workflows with a single `run(event, step)` entrypoint.
 * The same step API as the core run() function: step('id', fn), step.try, step.sleep, etc.
 * Execution is via instance.execute(payload).
 *
 * @example
 * ```typescript
 * import { WorkflowClass, type WorkflowRunEvent } from 'awaitly/workflow';
 * class ImageWorkflow extends WorkflowClass<typeof deps> {
 *   async run(event: WorkflowRunEvent<{ key: string }>, step) {
 *     const data = await step('fetch image', () => this.deps.fetchImage(event.payload.key));
 *     return await step('process', () => this.deps.processImage(data));
 *   }
 * }
 * const deps = { fetchImage, processImage };
 * const w = new ImageWorkflow('image', deps, options);
 * const result = await w.execute({ key: 'x' });
 * ```
 */

import { createWorkflow } from "./execute";
import type {
  Workflow as WorkflowCallable,
  WorkflowOptions,
  WorkflowFn,
  GetSnapshotOptions,
  SubscribeEvent,
  SubscribeOptions,
} from "./types";
import type { WorkflowSnapshot } from "../persistence";
import type { RunStep } from "../core";
import type { Result } from "../core";
import type { AnyResultFn, ErrorsOfDeps } from "./types";
import type { UnexpectedError } from "../core";
import type { WorkflowRunEvent } from "./workflow-event";

/**
 * Base class for class-based workflows.
 * Subclasses override run(event, step) with the workflow body.
 * Uses the same step API as the core run() function: step('id', fn), step.try, step.sleep, etc.
 *
 * @template Deps - Dependencies object (Record of Result-returning functions)
 * @template E - Error union from deps (defaults to ErrorsOfDeps<Deps> when Deps is constrained)
 * @template U - Unexpected/caught error type (default UnexpectedError)
 * @template Env - Optional env/bindings (e.g. runtime bindings); stored as this.env
 */
export abstract class Workflow<
  Deps extends Record<string, AnyResultFn> = Record<string, AnyResultFn>,
  E = ErrorsOfDeps<Deps>,
  U = UnexpectedError,
  Env = unknown
> {
  /** Workflow name (from constructor). */
  readonly name: string;
  /** Dependencies passed to constructor. */
  readonly deps: Deps;
  /** Options passed to constructor. */
  readonly options?: WorkflowOptions<E, U, void>;
  /** Optional env/bindings for subclasses (e.g. this.env.BUCKET). */
  readonly env?: Env;

  private readonly _workflow: WorkflowCallable<E, U, Deps, void>;

  constructor(
    name: string,
    deps?: Deps,
    options?: WorkflowOptions<E, U, void>,
    env?: Env
  ) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(
        "Workflow constructor: name must be a non-empty string. Example: new MyWorkflow('my-workflow', deps, options)"
      );
    }
    this.name = name;
    this.deps = (deps ?? {}) as Deps;
    this.options = options;
    this.env = env;
    this._workflow = createWorkflow(name, this.deps, options as WorkflowOptions<ErrorsOfDeps<Deps>, U, void>) as WorkflowCallable<E, U, Deps, void>;
  }

  /**
   * Workflow body. Subclasses override this with event-driven signature.
   * Access input via event.payload, dependencies via this.deps.
   */
  abstract run<Payload = unknown>(
    event: WorkflowRunEvent<Payload>,
    step: RunStep<E>
  ): Promise<unknown>;

  /**
   * Execute the workflow with a payload.
   * Creates WorkflowRunEvent internally and invokes run().
   *
   * @param payload - Input data for the workflow
   * @param options - Optional execution options (signal, instanceId override)
   * @returns Promise<Result<T, E | U, unknown>>
   */
  execute<T, Payload = unknown>(
    payload: Payload,
    options?: { signal?: AbortSignal; instanceId?: string }
  ): Promise<Result<T, E | U, unknown>> {
    // Generate unique ID if not provided
    const instanceId = options?.instanceId ?? crypto.randomUUID();

    // Determine effective signal (execution-time takes precedence)
    const effectiveSignal = options?.signal ?? this.options?.signal;

    // Create event object with effective signal
    const event: WorkflowRunEvent<Payload> = {
      payload,
      instanceId,
      timestamp: Date.now(),
      signal: effectiveSignal,
    };

    // Wrap user's run() method for internal execution
    const workflowFn: WorkflowFn<T, E, Deps, void> = (step, _deps, _ctx) => {
      // Call user's run() with event and step
      return this.run(event, step) as T | Promise<T>;
    };

    // Execute using internal _workflow with effective signal
    return this._workflow.run(workflowFn, {
      ...this.options,
      signal: effectiveSignal,
    }) as Promise<Result<T, E | U, unknown>>;
  }

  /**
   * Get a JSON-serializable snapshot of the workflow state (from the last run).
   */
  getSnapshot(options?: GetSnapshotOptions): WorkflowSnapshot {
    return this._workflow.getSnapshot(options);
  }

  /**
   * Get the current workflow snapshot (read-only state).
   * Alias for getSnapshot() that provides property-style access.
   *
   * @example
   * ```typescript
   * const w = new MyWorkflow('my-wf', deps);
   * await w.execute(payload);
   * const state = w.snapshot; // Get current state
   * ```
   */
  get snapshot(): WorkflowSnapshot {
    return this.getSnapshot();
  }

  /**
   * Subscribe to workflow events for auto-persistence.
   * Returns an unsubscribe function.
   */
  subscribe(
    listener: (event: SubscribeEvent) => void,
    options?: SubscribeOptions
  ): () => void {
    return this._workflow.subscribe(listener, options);
  }
}
