import {
  context as otelContext,
  createContextKey,
  createNoopMeter,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Link,
  type Span,
  type TextMapGetter,
  type Tracer,
} from '@opentelemetry/api';
import { wrapsThrown } from '../tagged-error';
import { callSite } from './call-site';
import { errorOf, explain, type FailedResult, type Failure } from './failure-origin';
import type { WorkflowEvent } from './index';

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

/**
 * Same caching as the tracer. Unlike traces, the metrics API has no proxy
 * provider, so a provider registered after import is picked up here.
 */
let cachedMeterProvider: unknown;
let cachedInstruments:
  | {
      workflowDuration: Histogram;
      stepDuration: Histogram;
      stepRetries: Counter;
    }
  | undefined;

let NoopMeter: unknown;

/** Undefined while no MeterProvider is registered, so untraced apps skip the clock reads. */
function getInstruments() {
  const provider = metrics.getMeterProvider();
  if (cachedMeterProvider !== provider) {
    cachedMeterProvider = provider;
    const meter = provider.getMeter('awaitly');
    NoopMeter ??= createNoopMeter().constructor;
    cachedInstruments = meter.constructor === NoopMeter ? undefined : {
      workflowDuration: meter.createHistogram('awaitly.workflow.duration', {
        unit: 's',
        description: 'Duration of a workflow run.',
      }),
      stepDuration: meter.createHistogram('awaitly.step.duration', {
        unit: 's',
        description: 'Duration of a step, across all its attempts.',
      }),
      stepRetries: meter.createCounter('awaitly.step.retries', {
        unit: '{retry}',
        description: 'Step attempts retried after a failure.',
      }),
    };
  }
  return cachedInstruments;
}

/**
 * What a run hands down to everything traced inside it: its name (for step
 * metrics) and the attributes every span in the run carries. Riding on the
 * OpenTelemetry context means nested runs inherit their parent's attributes
 * with no plumbing through the engine.
 */
type RunScope = { name?: string | undefined; attributes?: Attributes | undefined };
const RUN_SCOPE = /* @__PURE__ */ createContextKey('awaitly.run');

function runScope(): RunScope | undefined {
  return otelContext.active().getValue(RUN_SCOPE) as RunScope | undefined;
}

/**
 * Set attributes on the span awaitly is running right now: the step span
 * inside a step, else the run span. A no-op when nothing is recording.
 *
 * @example
 * await step('charge', () => {
 *   annotateSpan({ 'payment.provider': 'stripe' });
 *   return deps.charge(order);
 * });
 */
export function annotateSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

type ResultLike =
  | { readonly ok: true; readonly value: unknown }
  | FailedResult;

function isResultLike(value: unknown): value is ResultLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * Name the error for `error.type`. Total, like everything below that reads a
 * user's error: a getter or Proxy that throws must not change the outcome.
 */
function errorType(error: unknown): string {
  const failure = errorOf({ threw: error });
  try {
    const name = failure instanceof Error ? failure.name : tagOf(failure);
    return typeof name === 'string' ? name : typeof failure;
  } catch {
    return typeof failure;
  }
}

function tagOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as Record<string, unknown>;
  for (const key of ['type', '_tag', 'tag', 'code'] as const) {
    const tag = value[key];
    if (typeof tag === 'string' && tag.length > 0) return tag;
  }
  return undefined;
}

/** Mark the span failed and return its `error.type`. */
function markError(span: Span, failure: Failure): string {
  const error = errorOf(failure);
  const type = errorType(error);
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttribute('error.type', type);
  try {
    const { source, exception, thrown } = explain(failure);
    const message = source?.message;
    const stack = source?.stack;
    if (message) span.setStatus({ code: SpanStatusCode.ERROR, message });
    // A typed error with no thrown cause is an outcome your code planned for: an
    // exception event would open an issue in the backend's error tracking.
    if (exception) {
      span.addEvent('exception', {
        'exception.type': thrown && wrapsThrown(error) ? errorType(thrown) : type,
        ...(message ? { 'exception.message': message } : {}),
        ...(stack ? { 'exception.stacktrace': stack } : {}),
      });
    }
  } catch {
    // The error can't be read: the span keeps its status and type.
  }
  return type;
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
  failure?: Failure,
): Attributes {
  if (signal?.aborted) {
    span.setAttribute('awaitly.outcome', 'cancelled');
    return { 'awaitly.outcome': 'cancelled' };
  }

  span.setAttribute('awaitly.outcome', failure ? 'error' : 'success');
  if (!failure) return { 'awaitly.outcome': 'success' };
  return { 'awaitly.outcome': 'error', 'error.type': markError(span, failure) };
}

type SpanDetails = {
  /** When false, the operation runs untraced. */
  enabled: boolean;
  signal?: AbortSignal | undefined;
};

function failureIn<T>(value: T, outcomeOf: (value: T) => ResultLike | undefined): Failure | undefined {
  try {
    const result = outcomeOf(value);
    return result && !result.ok ? { returned: result } : undefined;
  } catch {
    // Not readable as a Result, so not known to have failed.
    return undefined;
  }
}

type SpanOptions<T> = {
  /** Read a returned value as success or failure; without it, returning is success. */
  outcomeOf?: (value: T) => ResultLike | undefined;
  /** Record the caller's file and line as `code.*` attributes. */
  recordCallSite?: boolean;
  /** Record the duration in this histogram, with these attributes plus the outcome. */
  duration?: { histogram: Histogram | undefined; attributes: () => Attributes };
};

/**
 * Wrap `operation` in an active span. Every exported helper routes through
 * here, so the disabled path stays one call with no wrapper allocated and no
 * ternary at the call site. Spans inside a run also get the run's attributes.
 */
function withSpan<T>(
  details: SpanDetails,
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
  options: SpanOptions<T> = {},
): Promise<T> {
  if (!details.enabled) return operation();

  const { outcomeOf, recordCallSite, duration } = options;
  const inherited = runScope()?.attributes;
  const histogram = duration?.histogram;
  const start = histogram ? performance.now() : 0;
  return getTracer().startActiveSpan(
    name,
    { attributes: inherited ? { ...inherited, ...attributes } : attributes },
    async (span) => {
      // Synchronous with the caller, so their frame is still on the stack.
      if (recordCallSite && span.isRecording()) span.setAttributes(callSite());
      let outcome: Attributes = {};
      try {
        const value = await operation();
        outcome = markOutcome(span, details.signal, outcomeOf && failureIn(value, outcomeOf));
        return value;
      } catch (error) {
        outcome = markOutcome(span, details.signal, { threw: error });
        throw error;
      } finally {
        span.end();
        if (histogram) {
          histogram.record((performance.now() - start) / 1000, {
            ...duration?.attributes(),
            ...outcome,
          });
        }
      }
    },
  );
}

const RESULT_OUTCOME: SpanOptions<ResultLike> = {
  outcomeOf: (value) => value,
};

/**
 * A run with no `workflowName` takes its callback's name, so
 * `run(async function checkout() {...})` traces as `run checkout`. Minifiers
 * rename functions, so minified builds should pass `workflowName`.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function inferRunName(fn: Function): string | undefined {
  return fn.name || undefined;
}

let warnedUnnamedRun = false;

/** @internal Lets tests see the one-time warning again. */
export function resetUnnamedRunWarning(): void {
  warnedUnnamedRun = false;
}

function warnUnnamedRun(): void {
  // Only when an SDK is recording: with no SDK the span goes nowhere anyway.
  if (warnedUnnamedRun || !trace.getActiveSpan()?.isRecording()) return;
  warnedUnnamedRun = true;
  console.warn(
    "[awaitly] A run was traced without a name, so its span is just 'run'. " +
      "Name it: run(fn, { workflowName: 'checkout' }), " +
      "run(deps, fn, { workflowName: 'checkout' }), " +
      "createWorkflow('checkout', deps), or pass a named function.",
  );
}

export function withRunSpan<T extends ResultLike>(
  details: SpanDetails & {
    workflowId: string;
    workflowName?: string | undefined;
    /** Set on this run's span and on every span inside it, nested runs included. */
    attributes?: Attributes | undefined;
  },
  operation: () => Promise<T>,
): Promise<T> {
  if (!details.enabled) return operation();

  const { workflowName, attributes } = details;
  return withSpan(
    details,
    // awaitly-analyze's tracesFromSpans reads runs by this "run" prefix.
    workflowName ? `run ${workflowName}` : 'run',
    {
      ...attributes,
      'awaitly.workflow.id': details.workflowId,
      ...(workflowName ? { 'awaitly.workflow.name': workflowName } : {}),
    },
    () => {
      if (!workflowName) warnUnnamedRun();
      // Still the parent run's scope here: children get its attributes plus ours.
      const inherited = runScope()?.attributes;
      const scope: RunScope = {
        name: workflowName,
        attributes: inherited || attributes ? { ...inherited, ...attributes } : undefined,
      };
      return otelContext.with(otelContext.active().setValue(RUN_SCOPE, scope), operation);
    },
    {
      ...RESULT_OUTCOME,
      recordCallSite: true,
      duration: {
        histogram: getInstruments()?.workflowDuration,
        attributes: () => (workflowName ? { 'awaitly.workflow.name': workflowName } : {}),
      },
    },
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
    // awaitly-analyze's tracesFromSpans reads steps by this "step " prefix.
    `step ${details.stepName}`,
    {
      'awaitly.workflow.id': details.workflowId,
      'awaitly.step.id': details.stepId,
      'awaitly.step.name': details.stepName,
      ...(details.stepKey ? { 'awaitly.step.key': details.stepKey } : {}),
    },
    operation,
    stepOptions(details),
  );
}

const CALL_SITE_ONLY = { recordCallSite: true } as const;

/** Steps are the hot path: allocate nothing extra unless metrics are on. */
function stepOptions<T>(details: SpanDetails & { stepName: string }): SpanOptions<T> {
  const histogram = details.enabled ? getInstruments()?.stepDuration : undefined;
  if (!histogram) return CALL_SITE_ONLY;
  return {
    recordCallSite: true,
    duration: { histogram, attributes: () => stepMetricAttributes(details.stepName) },
  };
}

/**
 * Labels shared by every step metric, so they join in a dashboard. Step names
 * are literal ids, so this stays low-cardinality; step keys would not.
 */
function stepMetricAttributes(stepName: string | undefined): Attributes {
  const workflowName = runScope()?.name;
  return {
    ...(workflowName ? { 'awaitly.workflow.name': workflowName } : {}),
    ...(stepName ? { 'awaitly.step.name': stepName } : {}),
  };
}

/**
 * Mirror the workflow events a trace can't show on its own (retries, timeouts,
 * cache hits, decisions) as events on the active span. Payloads stay out:
 * only ids, counts and error types are recorded.
 */
const MIRRORED = /* @__PURE__ */ new Set<string>([
  'step_retry',
  'step_retries_exhausted',
  'step_timeout',
  'step_cache_hit',
  'step_skipped',
  'decision',
]);

const stepName = (name: string | undefined): Attributes =>
  name ? { 'awaitly.step.name': name } : {};

export function recordWorkflowEvent(
  enabled: boolean,
  event: WorkflowEvent<unknown, unknown>,
): void {
  if (!enabled || !MIRRORED.has(event.type)) return;
  if (event.type === 'step_retry') {
    // No outcome yet: the step is still running. The failed attempt's type is known.
    getInstruments()?.stepRetries.add(1, {
      ...stepMetricAttributes(event.name),
      'error.type': errorType(event.error),
    });
  }
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return;

  switch (event.type) {
    case 'step_retry':
      span.addEvent('awaitly.step.retry', {
        ...stepName(event.name),
        'awaitly.step.attempt': event.attempt,
        'awaitly.step.max_attempts': event.maxAttempts,
        'awaitly.retry.delay_ms': event.delayMs,
        'error.type': errorType(event.error),
      });
      return;
    case 'step_retries_exhausted':
      span.addEvent('awaitly.step.retries_exhausted', {
        ...stepName(event.name),
        'awaitly.step.attempt': event.attempts,
        'error.type': errorType(event.lastError),
      });
      return;
    case 'step_timeout':
      span.addEvent('awaitly.step.timeout', {
        ...stepName(event.name),
        'awaitly.step.timeout_ms': event.timeoutMs,
        ...(event.attempt !== undefined ? { 'awaitly.step.attempt': event.attempt } : {}),
      });
      return;
    case 'step_cache_hit':
      span.addEvent('awaitly.step.cache_hit', {
        ...stepName(event.name),
        'awaitly.step.key': event.stepKey,
      });
      return;
    case 'step_skipped':
      span.addEvent('awaitly.step.skipped', {
        ...stepName(event.name),
        ...(event.decisionId ? { 'awaitly.decision.id': event.decisionId } : {}),
      });
      return;
    case 'decision':
      // step.branch sends start and end; one event per decision is enough.
      if (event.phase === 'end') return;
      span.addEvent('awaitly.decision', {
        'awaitly.decision.id': event.decisionId,
        'awaitly.decision.branch': event.branch,
        ...(event.label !== undefined ? { 'awaitly.decision.label': event.label } : {}),
      });
      return;
  }
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
    RESULT_OUTCOME,
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
    RESULT_OUTCOME,
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
        markOutcome(span, details.signal);
        return value;
      } catch (error) {
        markOutcome(span, details.signal, { threw: error });
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
  details: SpanDetails & {
    sagaId?: string | undefined;
    workflowId?: string | undefined;
    stepName: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(
    details,
    // awaitly-analyze's tracesFromSpans reads rollbacks by this "compensate " prefix.
    `compensate ${details.stepName}`,
    {
      ...(details.sagaId ? { 'awaitly.saga.id': details.sagaId } : {}),
      ...(details.workflowId ? { 'awaitly.workflow.id': details.workflowId } : {}),
      'awaitly.step.name': details.stepName,
    },
    operation,
    {
      outcomeOf: (value) => (isResultLike(value) ? value : undefined),
    },
  );
}

type Carrier = Record<string, unknown>;

/** Header names arrive in any case depending on the framework. */
const carrierGetter: TextMapGetter<Carrier> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => {
    const value =
      carrier[key] ??
      Object.entries(carrier).find(([name]) => name.toLowerCase() === key)?.[1];
    return typeof value === 'string' || Array.isArray(value)
      ? (value as string | string[])
      : undefined;
  },
};

/**
 * Run `fn` as part of the caller's trace, read from `traceparent` (and any
 * other registered propagator) in `carrier`. When HTTP instrumentation has
 * already opened a server span it has done this, so that span stays the parent.
 */
export function withIncomingContext<T>(
  carrier: Carrier | undefined,
  fn: () => T,
): T {
  if (!carrier || !telemetryEnabled || trace.getActiveSpan()) return fn();
  return otelContext.with(
    propagation.extract(otelContext.active(), carrier, carrierGetter),
    fn,
  );
}
