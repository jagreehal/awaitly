import { randomUUID } from "node:crypto";
import type { WorkflowSnapshot } from "../persistence";
import { durable } from "../durable";
import type {
  Engine,
  EngineOptions,
  EngineEvent,
  EnqueueOptions,
  ScheduleOptions,
} from "./types";

export type { Engine, EngineOptions, EngineEvent, EnqueueOptions, ScheduleOptions, WorkflowRegistration } from "./types";

export function createEngine(options: EngineOptions): Engine {
  const {
    store,
    workflows,
    concurrency = 5,
    onEvent,
    onError,
  } = options;

  const schedules = new Map<string, ReturnType<typeof setInterval>>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickInFlight = false;

  function emit(event: EngineEvent): void {
    try {
      onEvent?.(event);
    } catch {
      // Don't let event handlers break the engine
    }
  }

  async function enqueue(name: string, opts?: EnqueueOptions): Promise<string> {
    const wf = workflows[name];
    if (!wf) {
      throw new Error(`Unknown workflow: '${name}'. Registered: ${Object.keys(workflows).join(", ")}`);
    }

    const id = opts?.id ?? `${name}:${randomUUID()}`;

    // Save a "queued" snapshot that tick() will pick up
    const snapshot: WorkflowSnapshot = {
      formatVersion: 1,
      workflowName: name,
      steps: {},
      execution: {
        status: "running",  // "running" so durable.run can resume it
        lastUpdated: new Date().toISOString(),
      },
      metadata: {
        engineState: "queued",
        workflowName: name,
        input: (opts?.input ?? null) as string | number | boolean | null,
        idempotencyKey: opts?.idempotencyKey,
        enqueuedAt: new Date().toISOString(),
        ...opts?.metadata,
      },
    };

    await store.save(id, snapshot);

    emit({ type: "workflow_enqueued", workflowName: name, id, ts: Date.now() });
    return id;
  }

  async function tick(): Promise<number> {
    if (tickInFlight) return 0;
    tickInFlight = true;

    try {
      // List pending workflows from store
      const entries = await store.list({ limit: concurrency * 2 });
      let processed = 0;

      // Filter to queued engine workflows
      const queued: Array<{ id: string; workflowName: string; snapshot: WorkflowSnapshot }> = [];
      for (const entry of entries) {
        if (queued.length >= concurrency) break;
        const snapshot = await store.load(entry.id);
        if (
          snapshot &&
          snapshot.metadata?.engineState === "queued" &&
          typeof snapshot.metadata?.workflowName === "string"
        ) {
          queued.push({ id: entry.id, workflowName: snapshot.metadata.workflowName as string, snapshot });
        }
      }

      // Execute in parallel
      const results = await Promise.allSettled(
        queued.map(async ({ id, workflowName, snapshot }) => {
          const wf = workflows[workflowName];
          if (!wf) return;

          // Mark as processing (remove "queued" flag)
          const processingSnapshot: WorkflowSnapshot = {
            ...snapshot,
            metadata: {
              ...snapshot.metadata,
              engineState: "processing",
            },
          };
          await store.save(id, processingSnapshot);

          emit({ type: "workflow_started", workflowName, id, ts: Date.now() });

          const result = await durable.run(wf.deps, wf.fn, {
            id,
            store,
            idempotencyKey: snapshot.metadata?.idempotencyKey as string | undefined,
            input: snapshot.metadata?.input,
            ...wf.durableDefaults,
          });

          if (result.ok) {
            emit({ type: "workflow_completed", workflowName, id, ts: Date.now() });
          } else {
            emit({ type: "workflow_failed", workflowName, id, error: result.error, ts: Date.now() });
          }

          processed++;
        })
      );

      // Report errors from settled promises
      for (const r of results) {
        if (r.status === "rejected") {
          try { onError?.(r.reason); } catch { /* ignore */ }
        }
      }

      emit({ type: "engine_tick", ts: Date.now(), processed });
      return processed;
    } finally {
      tickInFlight = false;
    }
  }

  function schedule(name: string, opts: ScheduleOptions & EnqueueOptions): string {
    const scheduleId = opts?.id ? `schedule:${opts.id}` : `schedule:${randomUUID()}`;

    if (opts.immediate) {
      void enqueue(name, opts).catch(e => {
        try { onError?.(e); } catch { /* ignore */ }
      });
    }

    const interval = setInterval(() => {
      void enqueue(name, opts).catch(e => {
        try { onError?.(e); } catch { /* ignore */ }
      });
    }, opts.intervalMs);

    schedules.set(scheduleId, interval);
    emit({ type: "schedule_created", workflowName: name, scheduleId, intervalMs: opts.intervalMs, ts: Date.now() });
    return scheduleId;
  }

  function unschedule(scheduleId: string): boolean {
    const interval = schedules.get(scheduleId);
    if (!interval) return false;
    clearInterval(interval);
    schedules.delete(scheduleId);
    emit({ type: "schedule_removed", scheduleId, ts: Date.now() });
    return true;
  }

  function start(pollIntervalMs = 1000): void {
    if (running) return;
    running = true;
    emit({ type: "engine_start", ts: Date.now() });

    // Run first tick immediately
    void tick().catch(e => {
      try { onError?.(e); } catch { /* ignore */ }
    });

    pollTimer = setInterval(() => {
      void tick().catch(e => {
        try { onError?.(e); } catch { /* ignore */ }
      });
    }, pollIntervalMs);
  }

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;

    // Clear poll timer
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }

    // Clear all schedules
    for (const [id, interval] of schedules) {
      clearInterval(interval);
      schedules.delete(id);
    }

    // Wait for in-flight tick to complete
    while (tickInFlight) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    emit({ type: "engine_stop", ts: Date.now() });
  }

  return {
    enqueue,
    schedule,
    unschedule,
    start,
    stop,
    tick,
    status: () => ({ running, pendingSchedules: schedules.size }),
  };
}
