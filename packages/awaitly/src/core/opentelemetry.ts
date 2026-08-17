import {
  context as otelContext,
  SpanStatusCode,
  trace,
  type Attributes,
  type Link,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

/**
 * Tracing is on by default and costs well under a microsecond per step when no
 * SDK is registered. Two escape hatches exist for when that is still the wrong
 * trade:
 *
 * - `AWAITLY_TELEMETRY=0` turns it off for a process with no code change, which
 *   is what you want mid-incident.
 * - `setTelemetryEnabled(false)` turns it off programmatically, which is what
 *   you want in a test.
 *
 * A per-run `telemetry` option overrides both, in either direction.
 */
function envDisablesTelemetry(): boolean {
  // Edge runtimes and browsers have no `process`.
  if (typeof process === 'undefined') return false;
  const flag = process.env?.AWAITLY_TELEMETRY;
  return flag === '0' || flag === 'false';
}

let telemetryEnabled = !envDisablesTelemetry();

/** Turn automatic OpenTelemetry spans on or off for the whole process. */
export function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled;
}

/** Whether automatic spans are on for this process. */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

/**
 * Resolve a per-run `telemetry` option against the process-wide setting.
 * An explicit `true` or `false` at the call site wins.
 */
export function resolveTelemetry(option: boolean | undefined): boolean {
  return option ?? telemetryEnabled;
}

/**
 * `ProxyTracerProvider.getTracer()` allocates a new `ProxyTracer` on every
 * call, so resolving per span would allocate once per step. Cache instead.
 *
 * The cache is dropped whenever the global provider changes, because an SDK
 * registered after import (or a test swapping providers between cases) must not
 * keep writing into the provider it replaced.
 */
let cachedTracer: Tracer | undefined;
let cachedProvider: unknown;

function getTracer(): Tracer {
  const provider = trace.getTracerProvider();
  if (cachedTracer === undefined || provider !== cachedProvider) {
    cachedProvider = provider;
    cachedTracer = trace.getTracer('awaitly');
  }
  return cachedTracer;
}

type ResultLike =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

function isResultLike(value: unknown): value is ResultLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * Name the error for `error.type`. Unwrapping nested `.error` is bounded: this
 * runs on the failure path, where a self-referencing error object must not turn
 * one failure into a stack overflow.
 */
function errorType(error: unknown, depth = 0): string {
  if (error instanceof Error) return error.name;
  if (typeof error === 'object' && error !== null) {
    const value = error as Record<string, unknown>;
    for (const key of ['type', '_tag', 'tag', 'code'] as const) {
      const tag = value[key];
      if (typeof tag === 'string' && tag.length > 0) return tag;
    }
    if (depth < 4 && 'error' in value) return errorType(value.error, depth + 1);
  }
  return typeof error;
}

function markError(span: Span, error: unknown): void {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    ...(error instanceof Error && error.message
      ? { message: error.message }
      : {}),
  });
  span.setAttribute('error.type', errorType(error));
  if (error instanceof Error) span.recordException(error);
}

/**
 * Record how the operation ended.
 *
 * Success leaves the span status UNSET. The OpenTelemetry spec reserves OK for
 * an explicit application-level assertion, and a status set here cannot be
 * overridden by the caller afterwards. `awaitly.outcome` carries the detail.
 */
function markOutcome(
  span: Span,
  signal: AbortSignal | undefined,
  outcome: 'success' | 'error',
  error?: unknown,
): void {
  if (signal?.aborted) {
    span.setAttribute('awaitly.outcome', 'cancelled');
    return;
  }

  span.setAttribute('awaitly.outcome', outcome);
  if (outcome === 'error') markError(span, error);
}

type SpanDetails = {
  /** When false, the operation runs untraced. */
  enabled: boolean;
  signal?: AbortSignal | undefined;
};

/**
 * Wrap `operation` in an active span. Every exported helper routes through
 * here, so the disabled path stays one call with no wrapper allocated and no
 * ternary at the call site.
 */
function withSpan<T>(
  details: SpanDetails,
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
  outcomeOf?: (value: T) => { ok: boolean; error?: unknown },
): Promise<T> {
  if (!details.enabled) return operation();

  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const value = await operation();
      const outcome = outcomeOf?.(value);
      markOutcome(
        span,
        details.signal,
        outcome === undefined || outcome.ok ? 'success' : 'error',
        outcome?.error,
      );
      return value;
    } catch (error) {
      markOutcome(span, details.signal, 'error', error);
      throw error;
    } finally {
      span.end();
    }
  });
}

const resultOutcome = (value: ResultLike) =>
  value.ok ? { ok: true } : { ok: false, error: value.error };

export function withRunSpan<T extends ResultLike>(
  details: SpanDetails & {
    workflowId: string;
    workflowName?: string | undefined;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `run ${details.workflowName ?? 'anonymous'}`,
    {
      'awaitly.workflow.id': details.workflowId,
      ...(details.workflowName
        ? { 'awaitly.workflow.name': details.workflowName }
        : {}),
    },
    operation,
    resultOutcome,
  );
}

export function withStepSpan<T>(
  details: SpanDetails & {
    workflowId: string;
    stepId: string;
    stepKey?: string | undefined;
    stepName: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `step ${details.stepName}`,
    {
      'awaitly.workflow.id': details.workflowId,
      'awaitly.step.id': details.stepId,
      'awaitly.step.name': details.stepName,
      ...(details.stepKey ? { 'awaitly.step.key': details.stepKey } : {}),
    },
    operation,
  );
}

export function withAttemptSpan<T extends ResultLike>(
  details: SpanDetails & {
    workflowId: string;
    stepId: string;
    stepName: string;
    attempt: number;
    maxAttempts: number;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `attempt ${details.stepName}`,
    {
      'awaitly.workflow.id': details.workflowId,
      'awaitly.step.id': details.stepId,
      'awaitly.step.name': details.stepName,
      'awaitly.step.attempt': details.attempt,
      'awaitly.step.max_attempts': details.maxAttempts,
    },
    operation,
    resultOutcome,
  );
}

export function withScopeSpan<T>(
  details: SpanDetails & {
    workflowId: string;
    scopeId: string;
    scopeName: string;
    scopeType: 'parallel' | 'race' | 'allSettled';
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `${details.scopeType} ${details.scopeName}`,
    {
      'awaitly.workflow.id': details.workflowId,
      'awaitly.scope.id': details.scopeId,
      'awaitly.scope.name': details.scopeName,
      'awaitly.scope.type': details.scopeType,
    },
    operation,
  );
}

export function withSagaSpan<T extends ResultLike>(
  details: SpanDetails & { sagaId: string },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    'saga',
    { 'awaitly.saga.id': details.sagaId },
    operation,
    resultOutcome,
  );
}

export function withSagaStepSpan<T>(
  details: SpanDetails & { sagaId: string; stepName: string },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `saga step ${details.stepName}`,
    {
      'awaitly.saga.id': details.sagaId,
      'awaitly.step.name': details.stepName,
    },
    operation,
  );
}

/**
 * Span for one queued workflow the engine picks up.
 *
 * A queued job can sit in the store for hours and survive a process restart, so
 * this starts a new trace and records the enqueuing span as a link rather than
 * a parent. Parenting would hold the enqueuing request's trace open until the
 * job drains, and most backends drop or mis-render spans that arrive that late.
 * Links are how the OpenTelemetry messaging conventions express the same
 * causality without that cost.
 *
 * The enqueue-time context stays active around this call, so baggage and any
 * other context values still reach the workflow.
 */
export function withEngineJobSpan<T>(
  details: SpanDetails & { workflowName: string; workflowId: string },
  operation: () => Promise<T>,
): Promise<T> {
  if (!details.enabled) return operation();

  const enqueued = trace.getSpan(otelContext.active())?.spanContext();
  const links: Link[] = enqueued ? [{ context: enqueued }] : [];

  return getTracer().startActiveSpan(
    `engine process ${details.workflowName}`,
    {
      root: true,
      links,
      attributes: {
        'awaitly.workflow.name': details.workflowName,
        'awaitly.workflow.id': details.workflowId,
      },
    },
    async (span) => {
      try {
        const value = await operation();
        markOutcome(span, details.signal, 'success');
        return value;
      } catch (error) {
        markOutcome(span, details.signal, 'error', error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * A compensation that returns `err()` failed as surely as one that threw, so
 * both land on `awaitly.outcome`. Non-Result returns (including `void`) count
 * as success.
 */
export function withCompensationSpan<T>(
  details: SpanDetails & { sagaId?: string | undefined; stepName: string },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    `compensate ${details.stepName}`,
    {
      ...(details.sagaId ? { 'awaitly.saga.id': details.sagaId } : {}),
      'awaitly.step.name': details.stepName,
    },
    operation,
    (value) =>
      isResultLike(value) && !value.ok
        ? { ok: false, error: value.error }
        : { ok: true },
  );
}
