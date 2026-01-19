/**
 * awaitly/testing
 *
 * Deterministic workflow testing: mock steps, control timing, and
 * snapshot workflow execution for reproducible tests.
 *
 * @example
 * ```typescript
 * import { createWorkflowHarness, createMockFn, okOutcome } from 'awaitly/testing';
 *
 * const mockFetchUser = createMockFn<typeof fetchUser>();
 * mockFetchUser.mockResolvedValue(okOutcome({ id: '1', name: 'Test' }));
 *
 * const harness = createWorkflowHarness({ fetchUser: mockFetchUser });
 *
 * const result = await harness.run(async (step) => {
 *   const user = await step(mockFetchUser('1'));
 *   return user;
 * });
 *
 * expect(mockFetchUser).toHaveBeenCalledWith('1');
 * ```
 */

export {
  // Types
  type ScriptedOutcome,
  type StepInvocation,
  type AssertionResult,
  type TestHarnessOptions,
  type MockStep,
  type WorkflowHarness,
  type MockFunction,
  type WorkflowSnapshot,
  type CompensationInvocation,
  type SagaHarness,
  type MockSagaContext,
  type SagaStepOptions,
  type EventAssertionOptions,

  // Test Harness
  createWorkflowHarness,
  createSagaHarness,

  // Mock Factories
  createMockFn,

  // Snapshot Testing
  createSnapshot,
  compareSnapshots,

  // Test Utilities
  createTestClock,
  okOutcome,
  errOutcome,
  throwOutcome,

  // Event Assertion Helpers
  assertEventSequence,
  assertEventEmitted,
  assertEventNotEmitted,

  // Error Matcher Utilities
  expectError,
  expectErrorWithCause,
  expectUnexpectedError,
  expectOk,

  // Debug Helpers
  formatResult,
  formatEvent,
  formatEvents,
} from "./testing";
