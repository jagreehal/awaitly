/**
 * Live Session Base
 *
 * Base class for live workflow update sessions with debouncing.
 * Handles timing logic for batching rapid updates while ensuring
 * periodic updates during constant churn.
 */

import { ok, err, type Result } from "awaitly";
import type { WorkflowEvent } from "awaitly/workflow";
import type {
  WorkflowIR,
  ScopeStartEvent,
  ScopeEndEvent,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
} from "../types";
import type { LiveSession, LiveSessionOptions, WorkflowStatus } from "../notifiers/types";
import { createIRBuilder } from "../ir-builder";

/**
 * Extended event types that the live session can handle.
 * Includes both core WorkflowEvent and visualizer-specific events.
 */
type ExtendedEvent =
  | WorkflowEvent<unknown>
  | ScopeStartEvent
  | ScopeEndEvent
  | DecisionStartEvent
  | DecisionBranchEvent
  | DecisionEndEvent;

/**
 * Error types for live session flush operations.
 */
export type FlushError = "CALLBACK_ERROR";

/**
 * Default debounce interval (ms).
 */
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Default max wait between posts (ms).
 */
const DEFAULT_MAX_WAIT_MS = 5000;

/**
 * Callbacks for concrete notifier implementations.
 */
export interface LiveSessionCallbacks {
  /** Called to post a new message, returns message ID */
  postNew(ir: WorkflowIR, title: string): Promise<string | undefined>;

  /** Called to update an existing message */
  updateExisting(
    messageId: string,
    ir: WorkflowIR,
    title: string
  ): Promise<void>;

  /** Called to finalize the message with status */
  finalize(
    messageId: string | undefined,
    ir: WorkflowIR,
    title: string,
    status: WorkflowStatus
  ): Promise<void>;

  /** Called to cancel/delete the message (optional) */
  cancel?(messageId: string): Promise<void>;
}

/**
 * Create a live session with debouncing.
 *
 * @param options - Session options
 * @param callbacks - Platform-specific callbacks
 * @returns A LiveSession instance
 */
export function createLiveSession(
  options: LiveSessionOptions,
  callbacks: LiveSessionCallbacks
): LiveSession {
  const {
    title,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = options;

  // State
  let messageId: string | undefined;
  let active = true;
  let pendingIR: WorkflowIR | undefined;
  /** Last IR we had (pending or flushed) so finalize() can use it after a flush */
  let lastIR: WorkflowIR | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPostTime: number | undefined;
  let firstUpdateTime: number | undefined;
  /** Track last flush result for error reporting */
  let lastFlushResult: Result<void, FlushError> = ok(undefined);

  // IR builder for accumulating events
  const irBuilder = createIRBuilder({ detectParallel: true });

  function clearTimers(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = undefined;
    }
  }

  async function flush(): Promise<Result<void, FlushError>> {
    if (!pendingIR || !active) return ok(undefined);

    const irToPost = pendingIR;
    lastIR = irToPost;
    pendingIR = undefined;
    clearTimers();

    try {
      if (!messageId) {
        // First post - create new message
        messageId = await callbacks.postNew(irToPost, title);
      } else {
        // Update existing message
        await callbacks.updateExisting(messageId, irToPost, title);
      }
      lastPostTime = Date.now();
      lastFlushResult = ok(undefined);
      return lastFlushResult;
    } catch {
      // Capture errors instead of silently swallowing
      lastFlushResult = err("CALLBACK_ERROR");
      return lastFlushResult;
    }
  }

  function scheduleFlush(): void {
    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounce timer
    debounceTimer = setTimeout(() => {
      void flush();
    }, debounceMs);

    // Set max wait timer if not already set
    // Use lastPostTime if we've posted, otherwise use firstUpdateTime
    const referenceTime = lastPostTime ?? firstUpdateTime;
    if (!maxWaitTimer && referenceTime !== undefined) {
      const timeSinceReference = Date.now() - referenceTime;
      const remainingMaxWait = Math.max(0, maxWaitMs - timeSinceReference);

      maxWaitTimer = setTimeout(() => {
        maxWaitTimer = undefined;
        void flush();
      }, remainingMaxWait);
    }
  }

  function update(eventOrIr: ExtendedEvent | WorkflowIR): void {
    if (!active) return;

    // Track first update time for max-wait before first post
    if (firstUpdateTime === undefined) {
      firstUpdateTime = Date.now();
    }

    // Handle event or IR
    if ("root" in eventOrIr) {
      // It's an IR
      pendingIR = eventOrIr;
      lastIR = eventOrIr;
    } else {
      // It's an event - route to correct handler based on type
      const event = eventOrIr;
      if (event.type === "scope_start" || event.type === "scope_end") {
        irBuilder.handleScopeEvent(event as ScopeStartEvent | ScopeEndEvent);
      } else if (
        event.type === "decision_start" ||
        event.type === "decision_branch" ||
        event.type === "decision_end"
      ) {
        irBuilder.handleDecisionEvent(event as DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent);
      } else {
        irBuilder.handleEvent(event as WorkflowEvent<unknown>);
      }
      pendingIR = irBuilder.getIR();
      lastIR = pendingIR;
    }

    scheduleFlush();
  }

  async function finalize(status: WorkflowStatus = "completed"): Promise<void> {
    if (!active) return;

    active = false;
    clearTimers();

    // Get final IR (pending, or last flushed/direct, or builder snapshot)
    const finalIR = pendingIR ?? lastIR ?? irBuilder.getIR();

    await callbacks.finalize(messageId, finalIR, title, status);
  }

  function cancel(): void {
    if (!active) return;

    active = false;
    clearTimers();

    if (messageId && callbacks.cancel) {
      void callbacks.cancel(messageId);
    }
  }

  function getSessionId(): string | undefined {
    return messageId;
  }

  function isActive(): boolean {
    return active;
  }

  return {
    update,
    finalize,
    cancel,
    getSessionId,
    isActive,
  };
}
