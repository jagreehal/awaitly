/**
 * Event object passed to Workflow.run() method.
 * Contains workflow input and execution metadata.
 *
 * This is different from the WorkflowEvent type in core/types.ts, which is for
 * internal event emissions (step_start, step_complete, etc.). This type represents
 * the event passed to the user's run() method.
 *
 * @template Payload - Type of the workflow input data
 */
export interface WorkflowRunEvent<Payload = unknown> {
  /** User-provided input/payload for the workflow */
  payload: Payload;

  /** Unique identifier for this workflow execution instance */
  instanceId: string;

  /** Timestamp (milliseconds since epoch) when workflow was triggered */
  timestamp: number;

  /** Optional AbortSignal for cancellation support */
  signal?: AbortSignal;
}
