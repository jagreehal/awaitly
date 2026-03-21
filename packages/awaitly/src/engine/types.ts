import type { SnapshotStore } from "../persistence";
import type { AnyResultFn, WorkflowContext } from "../workflow/types";
import type { RunStep } from "../core";
import type { DurableOptions } from "../durable";

/** A registered workflow definition */
export interface WorkflowRegistration<
  Deps extends Readonly<Record<string, AnyResultFn>> = Readonly<Record<string, AnyResultFn>>
> {
  /** Workflow dependencies (Result-returning functions) */
  deps: Deps;
  /** Workflow function */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (context: { step: RunStep<any>; deps: Deps; ctx: WorkflowContext }) => any;
  /** Default durable options (version, lockTtlMs, etc.) */
  durableDefaults?: Partial<Pick<DurableOptions, 'version' | 'lockTtlMs' | 'heartbeatIntervalMs'>>;
}

export interface EnqueueOptions {
  /** Custom workflow execution ID (default: auto-generated UUID) */
  id?: string;
  /** Idempotency key for deduplication */
  idempotencyKey?: string;
  /** Workflow input for idempotency conflict detection */
  input?: unknown;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface ScheduleOptions {
  /** Repeat interval in milliseconds */
  intervalMs: number;
  /** Run immediately on schedule creation */
  immediate?: boolean;
}

export interface EngineOptions {
  /** Snapshot store for workflow persistence */
  store: SnapshotStore;
  /** Registered workflows keyed by name */
  workflows: Record<string, WorkflowRegistration>;
  /** Max parallel workflow runs per tick (default: 5) */
  concurrency?: number;
  /** Event handler */
  onEvent?: (event: EngineEvent) => void;
  /** Error handler for background operations */
  onError?: (error: unknown) => void;
}

export type EngineEvent =
  | { type: "engine_start"; ts: number }
  | { type: "engine_stop"; ts: number }
  | { type: "engine_tick"; ts: number; processed: number }
  | { type: "workflow_enqueued"; workflowName: string; id: string; ts: number }
  | { type: "workflow_started"; workflowName: string; id: string; ts: number }
  | { type: "workflow_completed"; workflowName: string; id: string; ts: number }
  | { type: "workflow_failed"; workflowName: string; id: string; error: unknown; ts: number }
  | { type: "schedule_created"; workflowName: string; scheduleId: string; intervalMs: number; ts: number }
  | { type: "schedule_removed"; scheduleId: string; ts: number };

export interface Engine {
  /** Enqueue a workflow for execution. Returns the workflow execution ID. */
  enqueue(name: string, options?: EnqueueOptions): Promise<string>;
  /** Schedule recurring workflow execution. Returns the schedule ID. */
  schedule(name: string, options: ScheduleOptions & EnqueueOptions): string;
  /** Remove a schedule */
  unschedule(scheduleId: string): boolean;
  /** Start the polling loop */
  start(pollIntervalMs?: number): void;
  /** Stop the polling loop gracefully */
  stop(): Promise<void>;
  /** Execute a single tick manually (process pending workflows). Returns number processed. */
  tick(): Promise<number>;
  /** Get engine status */
  status(): { running: boolean; pendingSchedules: number };
}
