/**
 * Decision Tracker - Helper for tracking conditional logic in workflows.
 *
 * This module provides utilities to track decision points (if/switch statements)
 * so they can be visualized in workflow diagrams.
 *
 * @example
 * ```typescript
 * import { trackDecision } from 'awaitly-visualizer';
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: (event) => {
 *     // Pass events to visualizer
 *     viz.handleEvent(event);
 *   }
 * });
 *
 * await workflow.run(async ({ step }) => {
 *   const user = await step(fetchUser(id));
 *
 *   // Track a decision point
 *   const decision = trackDecision('user-role-check', {
 *     condition: 'user.role === "admin"',
 *     value: user.role
 *   });
 *
 *   if (user.role === 'admin') {
 *     decision.takeBranch('admin', true);
 *     await step(processAdminAction(user));
 *   } else {
 *     decision.takeBranch('user', false);
 *     await step(processUserAction(user));
 *   }
 *
 *   decision.end();
 * });
 * ```
 */

import type {
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
} from "./types";

// =============================================================================
// Decision Tracker
// =============================================================================

/**
 * Options for creating a decision tracker.
 */
export interface DecisionTrackerOptions {
  /** Condition being evaluated (e.g., "user.role === 'admin'") */
  condition?: string;
  /** Value being evaluated */
  value?: unknown;
  /** Name/label for this decision point */
  name?: string;
  /** Workflow ID (auto-generated if not provided) */
  workflowId?: string;
  /** Event emitter function */
  emit?: (event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent) => void;
}

/**
 * Track a decision point in your workflow.
 *
 * Use this to annotate conditional logic (if/switch) so it appears
 * in workflow visualizations.
 *
 * @param decisionId - Unique identifier for this decision
 * @param options - Decision tracking options
 * @returns A tracker object with methods to track branches
 *
 * @example
 * ```typescript
 * const decision = trackDecision('check-role', {
 *   condition: 'user.role === "admin"',
 *   value: user.role,
 *   emit: (event) => viz.handleDecisionEvent(event)
 * });
 *
 * if (user.role === 'admin') {
 *   decision.takeBranch('admin', true);
 *   // ... admin logic
 * } else {
 *   decision.takeBranch('user', false);
 *   // ... user logic
 * }
 *
 * decision.end();
 * ```
 */
export function trackDecision(
  decisionId: string,
  options: DecisionTrackerOptions = {}
): DecisionTracker {
  const {
    condition,
    value,
    name,
    workflowId = crypto.randomUUID(),
    emit,
  } = options;

  const startTs = Date.now();
  let branchTaken: string | boolean | undefined;
  const branches: Array<{ label: string; condition?: string; taken: boolean }> = [];

  function takeBranch(
    label: string,
    taken: boolean,
    branchCondition?: string
  ): void {
    branches.push({ label, condition: branchCondition, taken });
    if (taken) {
      branchTaken = label;
    }

    emit?.({
      type: "decision_branch",
      workflowId,
      decisionId,
      branchLabel: label,
      condition: branchCondition,
      taken,
      ts: Date.now(),
    });
  }

  function end(): void {
    const durationMs = Date.now() - startTs;
    emit?.({
      type: "decision_end",
      workflowId,
      decisionId,
      branchTaken,
      ts: Date.now(),
      durationMs,
    });
  }

  // Emit start event immediately
  emit?.({
    type: "decision_start",
    workflowId,
    decisionId,
    condition,
    decisionValue: value,
    name,
    ts: startTs,
  });

  return {
    takeBranch,
    end,
    getBranchTaken: () => branchTaken,
    getBranches: () => [...branches],
  };
}

/**
 * Decision tracker instance.
 */
export interface DecisionTracker {
  /**
   * Mark that a branch was taken or skipped.
   * @param label - Label for this branch (e.g., "if", "else", "case 'admin'")
   * @param taken - Whether this branch was executed
   * @param branchCondition - Optional condition for this specific branch
   */
  takeBranch(label: string, taken: boolean, branchCondition?: string): void;

  /**
   * End the decision tracking.
   * Call this after all branches have been evaluated.
   */
  end(): void;

  /**
   * Get which branch was taken.
   */
  getBranchTaken(): string | boolean | undefined;

  /**
   * Get all branches (taken and skipped).
   */
  getBranches(): Array<{ label: string; condition?: string; taken: boolean }>;
}

// =============================================================================
// Convenience Helpers
// =============================================================================

/**
 * Track a simple if/else decision.
 *
 * @example
 * ```typescript
 * const decision = trackIf('check-admin', user.role === 'admin', {
 *   condition: 'user.role === "admin"',
 *   value: user.role,
 *   emit: (e) => viz.handleDecisionEvent(e)
 * });
 *
 * if (decision.condition) {
 *   decision.then();
 *   // admin logic
 * } else {
 *   decision.else();
 *   // user logic
 * }
 *
 * decision.end();
 * ```
 */
export function trackIf(
  decisionId: string,
  condition: boolean,
  options: Omit<DecisionTrackerOptions, "value"> & { value?: unknown } = {}
): IfTracker {
  const tracker = trackDecision(decisionId, {
    ...options,
    condition: options.condition ?? String(condition),
    value: options.value ?? condition,
  });

  // Track if branches have been emitted to avoid re-emitting
  let branchesEmitted = false;

  return {
    ...tracker,
    condition,
    then: () => {
      if (branchesEmitted) return;
      branchesEmitted = true;
      // Emit both branches so the skipped "else" is visible in diagrams
      tracker.takeBranch("if", true);
      tracker.takeBranch("else", false);
    },
    else: () => {
      if (branchesEmitted) return;
      branchesEmitted = true;
      // Emit both branches so the skipped "if" is visible in diagrams
      tracker.takeBranch("if", false);
      tracker.takeBranch("else", true);
    },
  };
}

/**
 * If tracker with convenience methods.
 */
export interface IfTracker extends DecisionTracker {
  /** The condition value */
  condition: boolean;
  /** Mark the "if" branch as taken */
  then(): void;
  /** Mark the "else" branch as taken */
  else(): void;
}

/**
 * Track a switch statement decision.
 *
 * @example
 * ```typescript
 * const decision = trackSwitch('process-type', user.type, {
 *   emit: (e) => viz.handleDecisionEvent(e)
 * });
 *
 * switch (user.type) {
 *   case 'admin':
 *     decision.case('admin', true);
 *     // admin logic
 *     break;
 *   case 'user':
 *     decision.case('user', true);
 *     // user logic
 *     break;
 *   default:
 *     decision.default(true);
 *     // default logic
 * }
 *
 * decision.end();
 * ```
 */
export function trackSwitch(
  decisionId: string,
  value: unknown,
  options: Omit<DecisionTrackerOptions, "value"> = {}
): SwitchTracker {
  const tracker = trackDecision(decisionId, {
    ...options,
    condition: options.condition ?? `switch(${String(value)})`,
    value,
  });

  return {
    ...tracker,
    value,
    case: (caseValue: string | number, taken: boolean) => {
      tracker.takeBranch(`case '${caseValue}'`, taken, `value === '${caseValue}'`);
    },
    default: (taken: boolean) => {
      tracker.takeBranch("default", taken);
    },
  };
}

/**
 * Switch tracker with convenience methods.
 */
export interface SwitchTracker extends DecisionTracker {
  /** The value being switched on */
  value: unknown;
  /** Mark a case branch */
  case(caseValue: string | number, taken: boolean): void;
  /** Mark the default branch */
  default(taken: boolean): void;
}
