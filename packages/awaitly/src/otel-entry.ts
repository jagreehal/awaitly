/**
 * awaitly/otel
 *
 * OpenTelemetry integration: automatic tracing, metrics, and spans
 * for workflow execution with zero configuration.
 *
 * @example
 * ```typescript
 * import { createAutotelAdapter, withAutotelTracing } from 'awaitly/otel';
 * import { trace } from '@opentelemetry/api';
 *
 * const tracer = trace.getTracer('my-service');
 * const adapter = createAutotelAdapter({ tracer });
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: adapter.handleEvent,
 * });
 *
 * // Or wrap individual operations
 * const tracedFetch = withAutotelTracing(fetchUser, { tracer, name: 'fetchUser' });
 * ```
 */

export {
  // Types
  type AutotelAdapterConfig,
  type AutotelMetrics,
  type AutotelAdapter,
  type AutotelTraceFn,

  // Functions
  createAutotelAdapter,
  createAutotelEventHandler,
  withAutotelTracing,
} from "./autotel";
