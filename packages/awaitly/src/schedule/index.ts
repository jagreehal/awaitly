/**
 * awaitly/schedule
 *
 * Composable scheduling primitives inspired by Effect's Schedule module.
 * Build complex retry and polling strategies by composing simple building blocks.
 *
 * @example
 * ```typescript
 * // "Exponential backoff with jitter, max 5 attempts, then poll every minute"
 * const schedule = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.jittered(0.2))
 *   .pipe(Schedule.upTo(5))
 *   .pipe(Schedule.andThen(Schedule.spaced(Duration.minutes(1))))
 *
 * // Use with workflows
 * const result = await step('fetchData', () => fetchData(), { schedule })
 * ```
 */

import { Duration, millis, toMillis, multiply, add, type Duration as DurationType } from "../duration";

// =============================================================================
// Types
// =============================================================================

/**
 * The state maintained by a schedule during execution.
 */
export interface ScheduleState {
  /** Number of iterations completed */
  readonly iterations: number;
  /** Total elapsed time since schedule started */
  readonly elapsed: DurationType;
  /** The last input received (if any) */
  readonly lastInput?: unknown;
  /** The last output produced (if any) */
  readonly lastOutput?: unknown;
  /** Combinator-specific metadata (used by andThen, union, intersect, etc.) */
  readonly meta?: unknown;
}

/**
 * Decision returned by a schedule step.
 * Combinators can optionally provide `nextState` to thread custom state through execution.
 */
export type ScheduleDecision<Out> =
  | { readonly _tag: "Continue"; readonly delay: DurationType; readonly output: Out; readonly nextState?: ScheduleState }
  | { readonly _tag: "Done" };

/**
 * A Schedule defines a recurring pattern with delays and outputs.
 *
 * @typeParam In - The input type (from retry attempts, etc.)
 * @typeParam Out - The output type (often the delay or iteration count)
 */
export interface Schedule<In = unknown, Out = unknown> {
  readonly _tag: "Schedule";
  /** Compute the next step given input and current state */
  readonly step: (input: In, state: ScheduleState) => ScheduleDecision<Out>;
  /** Initial state for this schedule */
  readonly initial: ScheduleState;
}

// =============================================================================
// Internal Helpers
// =============================================================================

const initialState: ScheduleState = {
  iterations: 0,
  elapsed: Duration.zero,
  lastInput: undefined,
  lastOutput: undefined,
};

function continueWith<Out>(delay: DurationType, output: Out): ScheduleDecision<Out> {
  return { _tag: "Continue", delay, output };
}

function done<Out>(): ScheduleDecision<Out> {
  return { _tag: "Done" };
}

function updateState(state: ScheduleState, delay: DurationType, input: unknown, output: unknown): ScheduleState {
  return {
    iterations: state.iterations + 1,
    elapsed: add(state.elapsed, delay),
    lastInput: input,
    lastOutput: output,
  };
}

// =============================================================================
// Base Schedules
// =============================================================================

/**
 * A schedule that repeats forever with no delay.
 */
export function forever<In = unknown>(): Schedule<In, number> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) => continueWith(Duration.zero, state.iterations),
  };
}

/**
 * A schedule that repeats exactly n times.
 *
 * @example
 * ```typescript
 * const thrice = Schedule.recurs(3)
 * ```
 */
export function recurs<In = unknown>(n: number): Schedule<In, number> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) =>
      state.iterations < n ? continueWith(Duration.zero, state.iterations) : done(),
  };
}

/**
 * A schedule that repeats once.
 */
export function once<In = unknown>(): Schedule<In, void> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) =>
      state.iterations === 0 ? continueWith(Duration.zero, undefined) : done(),
  };
}

/**
 * A schedule that always stops immediately.
 */
export function stop<In = unknown>(): Schedule<In, never> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: () => done(),
  };
}

// =============================================================================
// Delay-Based Schedules
// =============================================================================

/**
 * A schedule that waits a fixed duration between each iteration.
 *
 * @example
 * ```typescript
 * const pollEvery5s = Schedule.spaced(Duration.seconds(5))
 * ```
 */
export function spaced<In = unknown>(delay: DurationType): Schedule<In, number> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) => continueWith(delay, state.iterations),
  };
}

/**
 * Alias for spaced - a fixed interval schedule.
 */
export const fixed = spaced;

/**
 * A schedule with exponentially increasing delays.
 * delay(n) = base * factor^n
 *
 * @example
 * ```typescript
 * // 100ms, 200ms, 400ms, 800ms, ...
 * const exponential = Schedule.exponential(Duration.millis(100))
 *
 * // With custom factor: 100ms, 300ms, 900ms, ...
 * const triple = Schedule.exponential(Duration.millis(100), 3)
 * ```
 */
export function exponential<In = unknown>(
  base: DurationType,
  factor: number = 2
): Schedule<In, DurationType> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) => {
      const delay = multiply(base, Math.pow(factor, state.iterations));
      return continueWith(delay, delay);
    },
  };
}

/**
 * A schedule with linearly increasing delays.
 * delay(n) = base * (n + 1)
 *
 * @example
 * ```typescript
 * // 100ms, 200ms, 300ms, 400ms, ...
 * const linear = Schedule.linear(Duration.millis(100))
 * ```
 */
export function linear<In = unknown>(base: DurationType): Schedule<In, DurationType> {
  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) => {
      const delay = multiply(base, state.iterations + 1);
      return continueWith(delay, delay);
    },
  };
}

/**
 * A schedule with fibonacci-sequence delays.
 * delay(n) follows fibonacci: base, base, 2*base, 3*base, 5*base, ...
 *
 * @example
 * ```typescript
 * // 100ms, 100ms, 200ms, 300ms, 500ms, 800ms, ...
 * const fib = Schedule.fibonacci(Duration.millis(100))
 * ```
 */
export function fibonacci<In = unknown>(base: DurationType): Schedule<In, DurationType> {
  // Precompute fibonacci numbers for reasonable iteration counts
  const fibNumbers: number[] = [1, 1];
  for (let i = 2; i < 50; i++) {
    fibNumbers[i] = fibNumbers[i - 1] + fibNumbers[i - 2];
  }

  return {
    _tag: "Schedule",
    initial: initialState,
    step: (_input, state) => {
      const fibIndex = Math.min(state.iterations, fibNumbers.length - 1);
      const delay = multiply(base, fibNumbers[fibIndex]);
      return continueWith(delay, delay);
    },
  };
}

// =============================================================================
// Combinators: Limits
// =============================================================================

/**
 * Limit a schedule to at most n iterations.
 *
 * @example
 * ```typescript
 * // Exponential backoff, max 5 attempts
 * const limited = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.upTo(5))
 * ```
 */
export function upTo<In, Out>(
  n: number
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      if (state.iterations >= n) return done();
      return schedule.step(input, state);
    },
  });
}

/**
 * Limit a schedule by total elapsed time.
 *
 * @example
 * ```typescript
 * // Retry for at most 30 seconds
 * const timeLimited = Schedule.spaced(Duration.seconds(1))
 *   .pipe(Schedule.upToElapsed(Duration.seconds(30)))
 * ```
 */
export function upToElapsed<In, Out>(
  maxElapsed: DurationType
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      if (toMillis(state.elapsed) >= toMillis(maxElapsed)) return done();
      return schedule.step(input, state);
    },
  });
}

/**
 * Cap the maximum delay of a schedule.
 *
 * @example
 * ```typescript
 * // Exponential, but never more than 30 seconds
 * const capped = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.maxDelay(Duration.seconds(30)))
 * ```
 */
export function maxDelay<In, Out>(
  max: DurationType
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;
      const capped = toMillis(decision.delay) > toMillis(max) ? max : decision.delay;
      return continueWith(capped, decision.output);
    },
  });
}

/**
 * Set a minimum delay for a schedule.
 *
 * @example
 * ```typescript
 * const atLeast1s = schedule.pipe(Schedule.minDelay(Duration.seconds(1)))
 * ```
 */
export function minDelay<In, Out>(
  min: DurationType
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;
      const floored = toMillis(decision.delay) < toMillis(min) ? min : decision.delay;
      return continueWith(floored, decision.output);
    },
  });
}

// =============================================================================
// Combinators: Conditions
// =============================================================================

/**
 * Continue while a predicate on the input returns true.
 *
 * @example
 * ```typescript
 * // Retry while the error is transient
 * const retryTransient = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.whileInput((err: Error) => err.message.includes("ECONNRESET")))
 * ```
 */
export function whileInput<In, Out>(
  predicate: (input: In) => boolean
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      if (!predicate(input)) return done();
      return schedule.step(input, state);
    },
  });
}

/**
 * Continue while a predicate on the output returns true.
 *
 * @example
 * ```typescript
 * // Poll until status is "ready"
 * const untilReady = Schedule.spaced(Duration.seconds(1))
 *   .pipe(Schedule.whileOutput((status: string) => status !== "ready"))
 * ```
 */
export function whileOutput<In, Out>(
  predicate: (output: Out) => boolean
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;
      if (!predicate(decision.output)) return done();
      return decision;
    },
  });
}

/**
 * Continue until a predicate on the input returns true.
 * Opposite of whileInput.
 */
export function untilInput<In, Out>(
  predicate: (input: In) => boolean
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return whileInput((input: In) => !predicate(input));
}

/**
 * Continue until a predicate on the output returns true.
 * Opposite of whileOutput.
 */
export function untilOutput<In, Out>(
  predicate: (output: Out) => boolean
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return whileOutput((output: Out) => !predicate(output));
}

// =============================================================================
// Combinators: Jitter
// =============================================================================

/**
 * Add random jitter to delays to prevent thundering herd.
 *
 * @param factor - Jitter factor (0.0 to 1.0). Delay will be multiplied by (1 - factor) to (1 + factor).
 *
 * @example
 * ```typescript
 * // ±20% jitter
 * const jittered = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.jittered(0.2))
 * ```
 */
export function jittered<In, Out>(
  factor: number = 0.2
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;

      // Random factor between (1 - factor) and (1 + factor)
      const jitterMultiplier = 1 - factor + Math.random() * factor * 2;
      const jitteredDelay = millis(toMillis(decision.delay) * jitterMultiplier);

      return continueWith(jitteredDelay, decision.output);
    },
  });
}

/**
 * Add a fixed random delay to each iteration.
 *
 * @example
 * ```typescript
 * // Add 0-500ms random delay
 * const randomized = schedule.pipe(Schedule.addDelay(Duration.millis(500)))
 * ```
 */
export function addDelay<In, Out>(
  maxExtra: DurationType
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;

      const extra = millis(Math.random() * toMillis(maxExtra));
      const newDelay = add(decision.delay, extra);

      return continueWith(newDelay, decision.output);
    },
  });
}

// =============================================================================
// Combinators: Composition
// =============================================================================

/** Internal metadata for andThen combinator */
interface AndThenMeta {
  readonly inSecondPhase: boolean;
  readonly firstState: ScheduleState;  // Preserves first schedule's state (including its meta)
  readonly secondState: ScheduleState;
}

/**
 * Chain two schedules: run the first until done, then run the second.
 * The second schedule starts with fresh state when it begins.
 *
 * @example
 * ```typescript
 * // 5 exponential retries, then poll every minute
 * const strategy = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.upTo(5))
 *   .pipe(Schedule.andThen(Schedule.spaced(Duration.minutes(1))))
 * ```
 */
export function andThen<In, Out1, Out2>(
  second: Schedule<In, Out2>
): (first: Schedule<In, Out1>) => Schedule<In, Out1 | Out2> {
  return (first) => {
    const initialMeta: AndThenMeta = {
      inSecondPhase: false,
      firstState: first.initial,   // Preserve first's initial state (including its meta)
      secondState: second.initial,
    };

    return {
      _tag: "Schedule",
      initial: { ...initialState, meta: initialMeta },
      step: (input, state) => {
        const meta = (state.meta as AndThenMeta) ?? initialMeta;

        if (!meta.inSecondPhase) {
          // Pass first's isolated state (not outer state) to preserve its meta
          const decision = first.step(input, meta.firstState);
          if (decision._tag === "Continue") {
            // Update first's state - use nextState if provided, otherwise compute it
            const nextFirstState = decision.nextState ?? updateState(meta.firstState, decision.delay, input, decision.output);
            const nextState: ScheduleState = {
              ...updateState(state, decision.delay, input, decision.output),
              meta: { ...meta, firstState: nextFirstState },
            };
            return { _tag: "Continue", delay: decision.delay, output: decision.output as Out1 | Out2, nextState };
          }
          // First schedule done, switch to second with fresh state
          const secondDecision = second.step(input, second.initial);
          if (secondDecision._tag === "Done") return done();

          const nextSecondState = secondDecision.nextState ?? updateState(second.initial, secondDecision.delay, input, secondDecision.output);
          const nextState: ScheduleState = {
            ...updateState(state, secondDecision.delay, input, secondDecision.output),
            meta: { inSecondPhase: true, firstState: meta.firstState, secondState: nextSecondState },
          };
          return { _tag: "Continue", delay: secondDecision.delay, output: secondDecision.output as Out1 | Out2, nextState };
        }

        // In second phase - use secondState from meta
        const decision = second.step(input, meta.secondState);
        if (decision._tag === "Done") return done();

        // Update second's state
        const nextSecondState = decision.nextState ?? updateState(meta.secondState, decision.delay, input, decision.output);
        const nextState: ScheduleState = {
          ...updateState(state, decision.delay, input, decision.output),
          meta: { ...meta, secondState: nextSecondState },
        };

        return { _tag: "Continue", delay: decision.delay, output: decision.output as Out1 | Out2, nextState };
      },
    };
  };
}

/** Internal metadata for union/intersect combinators */
interface ParallelMeta {
  readonly firstState: ScheduleState;
  readonly secondState: ScheduleState;
}

/**
 * Run two schedules in parallel, using the shorter delay.
 * Both schedules advance their state independently.
 *
 * @example
 * ```typescript
 * // Use whichever delay is shorter
 * const union = Schedule.union(
 *   Schedule.exponential(Duration.millis(100)),
 *   Schedule.spaced(Duration.seconds(1))
 * )
 * ```
 */
export function union<In, Out1, Out2>(
  first: Schedule<In, Out1>,
  second: Schedule<In, Out2>
): Schedule<In, [Out1, Out2]> {
  const initialMeta: ParallelMeta = {
    firstState: first.initial,
    secondState: second.initial,
  };

  return {
    _tag: "Schedule",
    initial: { ...initialState, meta: initialMeta },
    step: (input, state) => {
      const meta = (state.meta as ParallelMeta) ?? initialMeta;

      const firstDecision = first.step(input, meta.firstState);
      const secondDecision = second.step(input, meta.secondState);

      if (firstDecision._tag === "Done" && secondDecision._tag === "Done") {
        return done();
      }

      // Compute next child states - respect nextState if child provides custom state threading
      const nextFirstState = firstDecision._tag === "Continue"
        ? (firstDecision.nextState ?? updateState(meta.firstState, firstDecision.delay, input, firstDecision.output))
        : meta.firstState;
      const nextSecondState = secondDecision._tag === "Continue"
        ? (secondDecision.nextState ?? updateState(meta.secondState, secondDecision.delay, input, secondDecision.output))
        : meta.secondState;

      // Take the shorter delay
      const firstDelay = firstDecision._tag === "Continue" ? toMillis(firstDecision.delay) : Infinity;
      const secondDelay = secondDecision._tag === "Continue" ? toMillis(secondDecision.delay) : Infinity;

      const delay = millis(Math.min(firstDelay, secondDelay));
      const output: [Out1, Out2] = [
        firstDecision._tag === "Continue" ? firstDecision.output : (undefined as Out1),
        secondDecision._tag === "Continue" ? secondDecision.output : (undefined as Out2),
      ];

      const nextState: ScheduleState = {
        ...updateState(state, delay, input, output),
        meta: { firstState: nextFirstState, secondState: nextSecondState },
      };

      return { _tag: "Continue", delay, output, nextState };
    },
  };
}

/**
 * Run two schedules in parallel, using the longer delay.
 * Both schedules advance their state independently. Stops when either schedule stops.
 *
 * @example
 * ```typescript
 * // Use whichever delay is longer
 * const intersect = Schedule.intersect(
 *   Schedule.exponential(Duration.millis(100)),
 *   Schedule.spaced(Duration.seconds(1))
 * )
 * ```
 */
export function intersect<In, Out1, Out2>(
  first: Schedule<In, Out1>,
  second: Schedule<In, Out2>
): Schedule<In, [Out1, Out2]> {
  const initialMeta: ParallelMeta = {
    firstState: first.initial,
    secondState: second.initial,
  };

  return {
    _tag: "Schedule",
    initial: { ...initialState, meta: initialMeta },
    step: (input, state) => {
      const meta = (state.meta as ParallelMeta) ?? initialMeta;

      const firstDecision = first.step(input, meta.firstState);
      const secondDecision = second.step(input, meta.secondState);

      // Both must continue
      if (firstDecision._tag === "Done" || secondDecision._tag === "Done") {
        return done();
      }

      // Compute next child states - respect nextState if child provides custom state threading
      const nextFirstState = firstDecision.nextState ?? updateState(meta.firstState, firstDecision.delay, input, firstDecision.output);
      const nextSecondState = secondDecision.nextState ?? updateState(meta.secondState, secondDecision.delay, input, secondDecision.output);

      // Take the longer delay
      const delay = millis(Math.max(toMillis(firstDecision.delay), toMillis(secondDecision.delay)));
      const output: [Out1, Out2] = [firstDecision.output, secondDecision.output];

      const nextState: ScheduleState = {
        ...updateState(state, delay, input, output),
        meta: { firstState: nextFirstState, secondState: nextSecondState },
      };

      return { _tag: "Continue", delay, output, nextState };
    },
  };
}

// =============================================================================
// Combinators: Transformations
// =============================================================================

/**
 * Transform the output of a schedule.
 *
 * @example
 * ```typescript
 * const withIteration = Schedule.spaced(Duration.seconds(1))
 *   .pipe(Schedule.map((n) => ({ attempt: n + 1 })))
 * ```
 */
export function map<In, Out, NewOut>(
  fn: (output: Out) => NewOut
): (schedule: Schedule<In, Out>) => Schedule<In, NewOut> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return done();
      return continueWith(decision.delay, fn(decision.output));
    },
  });
}

/**
 * Perform a side effect on each iteration.
 *
 * @example
 * ```typescript
 * const logged = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.tap((delay) => console.log(`Waiting ${delay}ms`)))
 * ```
 */
export function tap<In, Out>(
  fn: (output: Out, state: ScheduleState) => void
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Continue") {
        fn(decision.output, state);
      }
      return decision;
    },
  });
}

/**
 * Modify the delay of a schedule.
 *
 * @example
 * ```typescript
 * const doubled = schedule.pipe(Schedule.modifyDelay(d => Duration.multiply(d, 2)))
 * ```
 */
export function modifyDelay<In, Out>(
  fn: (delay: DurationType, output: Out) => DurationType
): (schedule: Schedule<In, Out>) => Schedule<In, Out> {
  return (schedule) => ({
    _tag: "Schedule",
    initial: schedule.initial,
    step: (input, state) => {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") return decision;
      return continueWith(fn(decision.delay, decision.output), decision.output);
    },
  });
}

// =============================================================================
// Running Schedules
// =============================================================================

/**
 * Create an iterator for running a schedule step-by-step.
 *
 * @example
 * ```typescript
 * const runner = Schedule.run(mySchedule)
 *
 * while (true) {
 *   const next = runner.next(lastResult)
 *   if (next.done) break
 *   await sleep(next.value.delay)
 * }
 * ```
 */
export function run<In, Out>(
  schedule: Schedule<In, Out>
): { next: (input: In) => { done: false; value: { delay: DurationType; output: Out } } | { done: true } } {
  let state = schedule.initial;

  return {
    next(input: In) {
      const decision = schedule.step(input, state);
      if (decision._tag === "Done") {
        return { done: true as const };
      }

      // Use combinator-provided nextState if available, otherwise compute standard update
      state = decision.nextState ?? updateState(state, decision.delay, input, decision.output);
      return {
        done: false as const,
        value: { delay: decision.delay, output: decision.output },
      };
    },
  };
}

/**
 * Get all delays from a schedule (for testing/visualization).
 * Runs the schedule with undefined input until it completes or reaches maxIterations.
 */
export function delays<Out>(
  schedule: Schedule<undefined, Out>,
  maxIterations: number = 100
): DurationType[] {
  const result: DurationType[] = [];
  const runner = run(schedule);

  for (let i = 0; i < maxIterations; i++) {
    const next = runner.next(undefined);
    if (next.done) break;
    result.push(next.value.delay);
  }

  return result;
}

// =============================================================================
// Pipe Support
// =============================================================================

/**
 * Type guard to check if a value is a Schedule.
 */
function isSchedule(value: unknown): value is Schedule<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { _tag: unknown })._tag === "Schedule"
  );
}

/**
 * A schedule with pipe support for method chaining.
 */
type PipedSchedule<In, Out> = Schedule<In, Out> & {
  pipe: <NewOut>(fn: (s: Schedule<In, Out>) => Schedule<In, NewOut>) => PipedSchedule<In, NewOut>;
} & {
  pipe: <R>(fn: (s: Schedule<In, Out>) => R) => R;
};

/**
 * Create a schedule with pipe support for method chaining.
 */
function withPipe<In, Out>(schedule: Schedule<In, Out>): PipedSchedule<In, Out> {
  return {
    ...schedule,
    pipe(fn: (s: Schedule<In, Out>) => unknown): unknown {
      const result = fn(schedule);
      if (isSchedule(result)) {
        return withPipe(result as Schedule<unknown, unknown>);
      }
      return result;
    },
  } as PipedSchedule<In, Out>;
}

// Wrapped versions with pipe support
const spacedWithPipe = <In = unknown>(delay: DurationType) => withPipe(spaced<In>(delay));
const exponentialWithPipe = <In = unknown>(base: DurationType, factor?: number) => withPipe(exponential<In>(base, factor));
const linearWithPipe = <In = unknown>(base: DurationType) => withPipe(linear<In>(base));
const fibonacciWithPipe = <In = unknown>(base: DurationType) => withPipe(fibonacci<In>(base));
const recursWithPipe = <In = unknown>(n: number) => withPipe(recurs<In>(n));
const foreverWithPipe = <In = unknown>() => withPipe(forever<In>());
const onceWithPipe = <In = unknown>() => withPipe(once<In>());
const unionWithPipe = <In, Out1, Out2>(first: Schedule<In, Out1>, second: Schedule<In, Out2>) => withPipe(union(first, second));
const intersectWithPipe = <In, Out1, Out2>(first: Schedule<In, Out1>, second: Schedule<In, Out2>) => withPipe(intersect(first, second));

// =============================================================================
// Namespace Export
// =============================================================================

/**
 * Schedule namespace for composable scheduling.
 *
 * @example
 * ```typescript
 * import { Schedule, Duration } from "awaitly";
 *
 * // Exponential backoff with jitter, max 5 attempts
 * const retry = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.jittered(0.2))
 *   .pipe(Schedule.upTo(5))
 *   .pipe(Schedule.maxDelay(Duration.seconds(30)))
 *
 * // Then poll every minute forever
 * const poll = Schedule.spaced(Duration.minutes(1))
 *
 * // Chain them
 * const strategy = retry.pipe(Schedule.andThen(poll))
 * ```
 */
export const Schedule = {
  // Base schedules
  forever: foreverWithPipe,
  once: onceWithPipe,
  recurs: recursWithPipe,
  stop,

  // Delay-based
  spaced: spacedWithPipe,
  fixed: spacedWithPipe,
  exponential: exponentialWithPipe,
  linear: linearWithPipe,
  fibonacci: fibonacciWithPipe,

  // Limits
  upTo,
  upToElapsed,
  maxDelay,
  minDelay,

  // Conditions
  whileInput,
  whileOutput,
  untilInput,
  untilOutput,

  // Jitter
  jittered,
  addDelay,

  // Composition
  andThen,
  union: unionWithPipe,
  intersect: intersectWithPipe,

  // Transformations
  map,
  tap,
  modifyDelay,

  // Running
  run,
  delays,
} as const;

export type { Schedule as ScheduleType };
