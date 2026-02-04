/**
 * awaitly/workflow
 *
 * Workflow orchestration with createWorkflow.
 * Use this for typed async workflows with automatic error inference.
 */

// Re-export types and constants that workflow users commonly need
export { UNEXPECTED_ERROR } from "../core";
export type {
  Result,
  AsyncResult,
  UnexpectedError,
  RunStep,
  WorkflowEvent,
  StepOptions,
} from "../core";

// Re-export streaming types for workflow users
export type { StreamStore } from "../streaming/types";

// Re-export workflow types from types.ts
export type {
  StepCache,
  ResumeStateEntry,
  ResumeState,
  AnyResultFn,
  ErrorsOfDeps,
  CausesOfDeps,
  ExecutionOptions,
  WorkflowOptions,
  WorkflowContext,
  WorkflowFn,
  WorkflowFnWithArgs,
  GetSnapshotOptions,
  SubscribeEvent,
  SubscribeOptions,
  Workflow,
  WorkflowCancelledError,
  PendingApproval,
  ApprovalRejected,
  ApprovalStepOptions,
  GatedStepOptions,
} from "./types";

export { isStepComplete, isWorkflowCancelled, isPendingApproval, isApprovalRejected } from "./guards";
export {
  createResumeStateCollector,
  injectApproval,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  createApprovalStateCollector,
} from "./resume-state";
export { pendingApproval, createApprovalStep, gatedStep } from "./hitl";

// Re-export snapshot types and utilities for convenience
export type {
  JSONValue,
  WorkflowSnapshot,
  StepResult,
  SerializedCause,
  SnapshotWarning,
} from "../persistence";

export {
  looksLikeWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
  mergeSnapshots,
  SnapshotFormatError,
  SnapshotMismatchError,
  SnapshotDecodeError,
} from "../persistence";

export { createWorkflow } from "./execute";
