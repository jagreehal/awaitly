/**
 * Explanations for replay violations, with the fix. The SDK detects a
 * violation, fails the execution, and reports what diverged. These
 * diagnostics add the cause and the change to make, and leave the native
 * error as it is.
 */
import type { DurableInstrumentationPlugin } from "@aws/durable-execution-sdk-js";

export type ReplayViolationKind = "name-mismatch" | "type-mismatch" | "subtype-mismatch" | "context-scope";

export type ReplayDiagnostic = {
  readonly kind: ReplayViolationKind;
  /** The operation name or position the SDK reported. */
  readonly operation?: string;
  /** What the checkpoint recorded on the first run. */
  readonly expected?: string;
  /** What the replay produced instead. */
  readonly actual?: string;
  /** Why it happened and what to change. */
  readonly explanation: string;
};

const DEPLOY_HINT =
  "If you deployed new code, executions that started on the old code replay against the new one: invoke durable functions through a published version or alias so each execution keeps the code it started with.";

const LINT_HINT = "eslint-plugin-awaitly's durable-* rules catch most of these before deploy.";

const MISMATCH = /Operation (name|type|subtype) mismatch for step "([^"]*)"\. Expected (?:name|type|subtype) "([^"]*)", but got "([^"]*)"/;
const CONTEXT_SCOPE = /Context usage error in "([^"]*)"/;

/**
 * Explain a replay violation raised by the SDK (a NonDeterministicExecutionError
 * or a context usage error), or return undefined for any other error.
 */
export function explainReplayViolation(error: unknown): ReplayDiagnostic | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  const scope = CONTEXT_SCOPE.exec(message);
  if (scope) {
    return {
      kind: "context-scope",
      operation: scope[1],
      explanation:
        `"${scope[1]}" was called on an enclosing context from inside a child context (runInChildContext, map, or parallel). ` +
        `Call it on the callback's own context parameter instead. ${LINT_HINT}`,
    };
  }

  const mismatch = MISMATCH.exec(message);
  if (!mismatch) return undefined;
  const [, what, operation, expected, actual] = mismatch;

  if (what === "name") {
    return {
      kind: "name-mismatch",
      operation,
      expected,
      actual,
      explanation:
        `Operation ${operation} was named "${expected}" when it first ran but "${actual}" on replay. ` +
        `Operation names must come out the same on every replay: don't build them from Date.now(), random values, ` +
        `or data read outside a step, and don't reorder operations behind a condition that can change. ${DEPLOY_HINT} ${LINT_HINT}`,
    };
  }
  return {
    kind: what === "type" ? "type-mismatch" : "subtype-mismatch",
    operation,
    expected,
    actual,
    explanation:
      `Replay reached a ${actual} where the first run had a ${expected}: control flow took a different path. ` +
      `A condition depends on something that changes between invocations, such as the time, a random value, ` +
      `configuration or an API read outside a step, or a variable a step mutated. Compute it inside ` +
      `context.step(...) so every replay reuses the checkpointed value. ${DEPLOY_HINT} ${LINT_HINT}`,
  };
}

export type ReplayDiagnosticsOptions = {
  /**
   * Where diagnostics go. Defaults to one JSON line on stderr, which Lambda
   * sends to CloudWatch Logs.
   */
  readonly log?: (diagnostic: ReplayDiagnostic & { readonly executionArn: string }) => void;
};

/**
 * A durable instrumentation plugin that explains replay violations when they
 * fail an execution. It works alongside AWS's OpenTelemetry plugin in the same
 * `plugins` list:
 *
 * ```typescript
 * export const handler = withDurableExecution(myHandler, {
 *   plugins: [new ExecutionOtelPlugin(), replayDiagnostics()],
 * });
 * ```
 */
export function replayDiagnostics(options: ReplayDiagnosticsOptions = {}): DurableInstrumentationPlugin {
  const log =
    options.log ??
    ((diagnostic) => {
      console.error(JSON.stringify({ level: "ERROR", source: "awaitly-durable-lambda", ...diagnostic }));
    });
  return {
    async onInvocationEnd(info) {
      const diagnostic = explainReplayViolation(info.executionError);
      if (diagnostic) log({ ...diagnostic, executionArn: info.executionArn });
    },
  };
}
