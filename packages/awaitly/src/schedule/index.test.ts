import { describe, it, expect } from "vitest";
import { Schedule, delays, type ScheduleState } from ".";
import { Duration } from "../duration";

describe("Schedule", () => {
  describe("base schedules", () => {
    it("forever repeats indefinitely", () => {
      const schedule = Schedule.forever();
      const d = delays(schedule, 5);
      expect(d.length).toBe(5);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(0));
    });

    it("recurs limits iterations", () => {
      const schedule = Schedule.recurs(3);
      const d = delays(schedule, 10);
      expect(d.length).toBe(3);
    });

    it("once runs exactly once", () => {
      const schedule = Schedule.once();
      const d = delays(schedule, 10);
      expect(d.length).toBe(1);
    });

    it("stop never runs", () => {
      const schedule = Schedule.stop();
      const d = delays(schedule, 10);
      expect(d.length).toBe(0);
    });
  });

  describe("delay-based schedules", () => {
    it("spaced has fixed delay", () => {
      const schedule = Schedule.spaced(Duration.millis(100));
      const d = delays(schedule, 5);
      expect(d.length).toBe(5);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(100));
    });

    it("exponential increases delay exponentially", () => {
      const schedule = Schedule.exponential(Duration.millis(100));
      const d = delays(schedule, 4);

      expect(Duration.toMillis(d[0])).toBe(100); // 100 * 2^0
      expect(Duration.toMillis(d[1])).toBe(200); // 100 * 2^1
      expect(Duration.toMillis(d[2])).toBe(400); // 100 * 2^2
      expect(Duration.toMillis(d[3])).toBe(800); // 100 * 2^3
    });

    it("exponential with custom factor", () => {
      const schedule = Schedule.exponential(Duration.millis(100), 3);
      const d = delays(schedule, 3);

      expect(Duration.toMillis(d[0])).toBe(100); // 100 * 3^0
      expect(Duration.toMillis(d[1])).toBe(300); // 100 * 3^1
      expect(Duration.toMillis(d[2])).toBe(900); // 100 * 3^2
    });

    it("linear increases delay linearly", () => {
      const schedule = Schedule.linear(Duration.millis(100));
      const d = delays(schedule, 4);

      expect(Duration.toMillis(d[0])).toBe(100); // 100 * 1
      expect(Duration.toMillis(d[1])).toBe(200); // 100 * 2
      expect(Duration.toMillis(d[2])).toBe(300); // 100 * 3
      expect(Duration.toMillis(d[3])).toBe(400); // 100 * 4
    });

    it("fibonacci follows fibonacci sequence", () => {
      const schedule = Schedule.fibonacci(Duration.millis(100));
      const d = delays(schedule, 6);

      // Fibonacci: 1, 1, 2, 3, 5, 8
      expect(Duration.toMillis(d[0])).toBe(100); // 100 * 1
      expect(Duration.toMillis(d[1])).toBe(100); // 100 * 1
      expect(Duration.toMillis(d[2])).toBe(200); // 100 * 2
      expect(Duration.toMillis(d[3])).toBe(300); // 100 * 3
      expect(Duration.toMillis(d[4])).toBe(500); // 100 * 5
      expect(Duration.toMillis(d[5])).toBe(800); // 100 * 8
    });
  });

  describe("limit combinators", () => {
    it("upTo limits iterations", () => {
      const schedule = Schedule.spaced(Duration.millis(100)).pipe(Schedule.upTo(3));

      const d = delays(schedule, 10);
      expect(d.length).toBe(3);
    });

    it("maxDelay caps the delay", () => {
      const schedule = Schedule.exponential(Duration.millis(100)).pipe(
        Schedule.maxDelay(Duration.millis(500))
      );

      const d = delays(schedule, 5);

      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(200);
      expect(Duration.toMillis(d[2])).toBe(400);
      expect(Duration.toMillis(d[3])).toBe(500); // capped
      expect(Duration.toMillis(d[4])).toBe(500); // capped
    });

    it("minDelay sets a floor", () => {
      const schedule = Schedule.spaced(Duration.millis(50)).pipe(
        Schedule.minDelay(Duration.millis(100))
      );

      const d = delays(schedule, 3);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(100));
    });
  });

  describe("jitter", () => {
    it("jittered adds randomness to delays", () => {
      const schedule = Schedule.spaced(Duration.millis(1000)).pipe(Schedule.jittered(0.2));

      const d = delays(schedule, 10);

      // All delays should be within ±20% of 1000
      d.forEach((delay) => {
        const ms = Duration.toMillis(delay);
        expect(ms).toBeGreaterThanOrEqual(800);
        expect(ms).toBeLessThanOrEqual(1200);
      });

      // At least some variation should exist (statistical, but very likely)
      const uniqueDelays = new Set(d.map((delay) => Duration.toMillis(delay)));
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  describe("composition", () => {
    it("andThen chains schedules", () => {
      // 3 fast retries, then switch to slow polling
      const schedule = Schedule.spaced(Duration.millis(100))
        .pipe(Schedule.upTo(3))
        .pipe(Schedule.andThen(Schedule.spaced(Duration.millis(1000))));

      const d = delays(schedule, 6);

      // First 3 should be 100ms
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(100);
      expect(Duration.toMillis(d[2])).toBe(100);

      // Next ones should be 1000ms
      expect(Duration.toMillis(d[3])).toBe(1000);
      expect(Duration.toMillis(d[4])).toBe(1000);
      expect(Duration.toMillis(d[5])).toBe(1000);
    });

    it("andThen preserves outputs without mutation", () => {
      const schedule = Schedule.recurs(1)
        .pipe(Schedule.map((n) => n + 1))
        .pipe(Schedule.andThen(Schedule.recurs(1).pipe(Schedule.map((n) => n + 10))));

      const runner = Schedule.run(schedule);
      const first = runner.next(undefined);
      const second = runner.next(undefined);

      expect(first.done).toBe(false);
      expect(first.value.output).toBe(1);

      expect(second.done).toBe(false);
      expect(second.value.output).toBe(10);
    });

    it("union advances internal schedule state across iterations", () => {
      const schedule = Schedule.union(
        Schedule.exponential(Duration.millis(100)),
        Schedule.exponential(Duration.millis(200))
      );

      const d = delays(schedule, 3);

      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(200);
      expect(Duration.toMillis(d[2])).toBe(400);
    });

    it("intersect advances internal schedule state across iterations", () => {
      const schedule = Schedule.intersect(
        Schedule.exponential(Duration.millis(100)),
        Schedule.exponential(Duration.millis(200))
      );

      const d = delays(schedule, 3);

      expect(Duration.toMillis(d[0])).toBe(200);
      expect(Duration.toMillis(d[1])).toBe(400);
      expect(Duration.toMillis(d[2])).toBe(800);
    });

    it("andThen composes with schedules that use internal meta", () => {
      const first = Schedule.union(Schedule.recurs(2), Schedule.recurs(2));
      const schedule = Schedule.andThen(Schedule.recurs(1))(first);

      expect(() => delays(schedule, 10)).not.toThrow();
      expect(delays(schedule, 10).length).toBe(3);
    });

    it("union respects child nextState from andThen", () => {
      const child: Schedule<undefined, number> = {
        _tag: "Schedule",
        initial: {
          iterations: 0,
          elapsed: Duration.zero,
          lastInput: undefined,
          lastOutput: undefined,
          meta: { count: 0 },
        },
        step: (_input, state) => {
          const count = (state.meta as { count: number } | undefined)?.count ?? 0;
          if (count >= 2) return { _tag: "Done" };
          const nextState: ScheduleState = { ...state, meta: { count: count + 1 } };
          return { _tag: "Continue", delay: Duration.zero, output: count, nextState };
        },
      };
      const schedule = Schedule.union(child, Schedule.recurs(1));
      const runner = Schedule.run(schedule);

      const step1 = runner.next(undefined);
      const step2 = runner.next(undefined);

      expect(step1.done).toBe(false);
      expect(step2.done).toBe(false);
      expect(step1.value.output[0]).toBe(0);
      expect(step2.value.output[0]).toBe(1);
    });
  });

  describe("schedule reusability", () => {
    it("andThen is reusable across multiple runs", () => {
      const schedule = Schedule.recurs(2)
        .pipe(Schedule.andThen(Schedule.recurs(2)));

      // First run
      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(4); // 2 from first + 2 from second

      // Second run on SAME schedule instance - should produce identical results
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(4);
    });

    it("union is reusable across multiple runs", () => {
      const schedule = Schedule.union(
        Schedule.recurs(2),
        Schedule.recurs(3)
      );

      // First run
      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(3); // max(2, 3) = 3

      // Second run on SAME instance
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(3);
    });

    it("intersect is reusable across multiple runs", () => {
      const schedule = Schedule.intersect(
        Schedule.recurs(2),
        Schedule.recurs(3)
      );

      // First run
      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(2); // min(2, 3) = 2

      // Second run on SAME instance
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(2);
    });
  });

  describe("real-world patterns", () => {
    it("exponential backoff with jitter and max", () => {
      const schedule = Schedule.exponential(Duration.millis(100))
        .pipe(Schedule.jittered(0.1))
        .pipe(Schedule.maxDelay(Duration.seconds(30)))
        .pipe(Schedule.upTo(5));

      const d = delays(schedule, 10);
      expect(d.length).toBe(5);

      // Delays should generally increase (accounting for jitter)
      const avgFirst = Duration.toMillis(d[0]);
      const avgLast = Duration.toMillis(d[4]);
      expect(avgLast).toBeGreaterThan(avgFirst);
    });

    it("poll until condition (simulated)", () => {
      // Poll every second, but stop after 5 iterations
      const schedule = Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(5));

      const d = delays(schedule, 10);
      expect(d.length).toBe(5);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(1000));
    });
  });

  describe("run iterator", () => {
    it("iterates through schedule steps", () => {
      const schedule = Schedule.recurs<undefined>(3);
      const runner = Schedule.run(schedule);

      const step1 = runner.next(undefined);
      expect(step1.done).toBe(false);

      const step2 = runner.next(undefined);
      expect(step2.done).toBe(false);

      const step3 = runner.next(undefined);
      expect(step3.done).toBe(false);

      const step4 = runner.next(undefined);
      expect(step4.done).toBe(true);
    });
  });

  describe("transformations", () => {
    it("map transforms output", () => {
      const schedule = Schedule.recurs(3).pipe(Schedule.map((n) => n * 10));

      const runner = Schedule.run(schedule);
      const step1 = runner.next(undefined);

      if (!step1.done) {
        expect(step1.value.output).toBe(0); // First iteration (0 * 10)
      }
    });

    it("tap performs side effects", () => {
      const outputs: number[] = [];
      const schedule = Schedule.recurs(3).pipe(Schedule.tap((n) => outputs.push(n)));

      delays(schedule, 5);
      expect(outputs).toEqual([0, 1, 2]);
    });
  });
});
