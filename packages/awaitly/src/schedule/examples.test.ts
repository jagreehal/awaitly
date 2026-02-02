/**
 * Test file to verify all code examples in schedule.md actually work
 * This file should compile and run without errors
 */

import { describe, it, expect } from "vitest";
import { Schedule, delays } from ".";
import { Duration } from "../duration";

// ============================================================================
// Base Schedules
// ============================================================================

describe("Schedule", () => {
  describe("base schedules", () => {
    it("forever repeats indefinitely", () => {
      const schedule = Schedule.forever();
      const d = delays(schedule, 5);
      expect(d.length).toBe(5);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(0));
    });

    it("recurs repeats exactly n times", () => {
      const schedule = Schedule.recurs(5);
      const d = delays(schedule, 10);
      expect(d.length).toBe(5);
    });

    it("once repeats exactly once", () => {
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
    it("spaced provides fixed interval", () => {
      const schedule = Schedule.spaced(Duration.seconds(1));
      const d = delays(schedule, 3);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(1000));
    });

    it("exponential doubles each time", () => {
      const schedule = Schedule.exponential(Duration.millis(100));
      const d = delays(schedule, 4);
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(200);
      expect(Duration.toMillis(d[2])).toBe(400);
      expect(Duration.toMillis(d[3])).toBe(800);
    });

    it("exponential with custom factor", () => {
      const schedule = Schedule.exponential(Duration.millis(100), 3);
      const d = delays(schedule, 3);
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(300);
      expect(Duration.toMillis(d[2])).toBe(900);
    });

    it("linear increases by base each time", () => {
      const schedule = Schedule.linear(Duration.millis(100));
      const d = delays(schedule, 4);
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(200);
      expect(Duration.toMillis(d[2])).toBe(300);
      expect(Duration.toMillis(d[3])).toBe(400);
    });

    it("fibonacci follows fibonacci sequence", () => {
      const schedule = Schedule.fibonacci(Duration.millis(100));
      const d = delays(schedule, 5);
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(100);
      expect(Duration.toMillis(d[2])).toBe(200);
      expect(Duration.toMillis(d[3])).toBe(300);
      expect(Duration.toMillis(d[4])).toBe(500);
    });
  });

  // ============================================================================
  // Combinators
  // ============================================================================

  describe("limit combinators", () => {
    it("upTo limits iterations", () => {
      const schedule = Schedule.exponential(Duration.millis(100)).pipe(
        Schedule.upTo(5)
      );
      const d = delays(schedule, 10);
      expect(d.length).toBe(5);
    });

    it("maxDelay caps delays", () => {
      const schedule = Schedule.exponential(Duration.millis(100))
        .pipe(Schedule.maxDelay(Duration.millis(500)))
        .pipe(Schedule.upTo(10));

      const d = delays(schedule);
      d.forEach((delay) => {
        expect(Duration.toMillis(delay)).toBeLessThanOrEqual(500);
      });
    });

    it("minDelay sets floor", () => {
      const schedule = Schedule.spaced(Duration.millis(10))
        .pipe(Schedule.minDelay(Duration.millis(50)))
        .pipe(Schedule.upTo(3));

      const d = delays(schedule);
      d.forEach((delay) => {
        expect(Duration.toMillis(delay)).toBeGreaterThanOrEqual(50);
      });
    });
  });

  describe("jitter", () => {
    it("jittered adds randomness", () => {
      const schedule = Schedule.spaced(Duration.millis(100))
        .pipe(Schedule.jittered(0.2))
        .pipe(Schedule.upTo(10));

      const d = delays(schedule);
      // At least some delays should differ from 100ms
      const allSame = d.every((delay) => Duration.toMillis(delay) === 100);
      expect(allSame).toBe(false);

      // All should be within ±20% of 100ms
      d.forEach((delay) => {
        const ms = Duration.toMillis(delay);
        expect(ms).toBeGreaterThanOrEqual(80);
        expect(ms).toBeLessThanOrEqual(120);
      });
    });
  });

  // ============================================================================
  // Composition Combinators (andThen, union, intersect)
  // ============================================================================

  describe("andThen - sequential composition", () => {
    it("chains two schedules sequentially", () => {
      // 5 fast retries, then switch to slow polling
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

    it("is reusable across multiple runs", () => {
      const schedule = Schedule.recurs(2).pipe(
        Schedule.andThen(Schedule.recurs(2))
      );

      // First run
      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(4);

      // Second run on SAME instance - should produce identical results
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(4);
    });

    it("composes with nested schedules (union → andThen)", () => {
      const schedule = Schedule.union(
        Schedule.recurs(2),
        Schedule.recurs(2)
      ).pipe(Schedule.andThen(Schedule.recurs(1)));

      const d = delays(schedule, 10);
      expect(d.length).toBe(3); // 2 from union + 1 from andThen
    });

    it("supports triple chaining (andThen → andThen)", () => {
      const schedule = Schedule.recurs(1)
        .pipe(Schedule.andThen(Schedule.recurs(1)))
        .pipe(Schedule.andThen(Schedule.recurs(1)));

      const d = delays(schedule, 10);
      expect(d.length).toBe(3);

      // Verify reusability
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(3);
    });
  });

  describe("union - parallel with shorter delay", () => {
    it("takes the shorter delay at each step", () => {
      const schedule = Schedule.union(
        Schedule.exponential(Duration.millis(100)),
        Schedule.spaced(Duration.millis(500))
      );

      const d = delays(schedule, 4);

      // Exponential: 100, 200, 400, 800
      // Spaced: 500, 500, 500, 500
      // Union (min): 100, 200, 400, 500
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(200);
      expect(Duration.toMillis(d[2])).toBe(400);
      expect(Duration.toMillis(d[3])).toBe(500); // spaced wins
    });

    it("continues while either schedule continues", () => {
      const schedule = Schedule.union(
        Schedule.recurs(2), // stops after 2
        Schedule.recurs(3) // stops after 3
      );

      const d = delays(schedule, 10);
      expect(d.length).toBe(3); // max(2, 3) = 3
    });

    it("is reusable across multiple runs", () => {
      const schedule = Schedule.union(Schedule.recurs(2), Schedule.recurs(3));

      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(3);

      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(3);
    });

    it("composes with andThen children", () => {
      const schedule = Schedule.union(
        Schedule.recurs(1).pipe(Schedule.andThen(Schedule.recurs(1))), // 2 total
        Schedule.recurs(2).pipe(Schedule.andThen(Schedule.recurs(1))) // 3 total
      );

      const d = delays(schedule, 10);
      expect(d.length).toBe(3); // max(2, 3) = 3

      // Verify reusability
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(3);
    });
  });

  describe("intersect - parallel with longer delay", () => {
    it("takes the longer delay at each step", () => {
      const schedule = Schedule.intersect(
        Schedule.exponential(Duration.millis(100)),
        Schedule.spaced(Duration.millis(500))
      ).pipe(Schedule.upTo(4));

      const d = delays(schedule, 10);

      // Exponential: 100, 200, 400, 800
      // Spaced: 500, 500, 500, 500
      // Intersect (max): 500, 500, 500, 800
      expect(Duration.toMillis(d[0])).toBe(500);
      expect(Duration.toMillis(d[1])).toBe(500);
      expect(Duration.toMillis(d[2])).toBe(500);
      expect(Duration.toMillis(d[3])).toBe(800); // exponential wins
    });

    it("stops when either schedule stops", () => {
      const schedule = Schedule.intersect(
        Schedule.recurs(2), // stops after 2
        Schedule.recurs(3) // stops after 3
      );

      const d = delays(schedule, 10);
      expect(d.length).toBe(2); // min(2, 3) = 2
    });

    it("is reusable across multiple runs", () => {
      const schedule = Schedule.intersect(Schedule.recurs(2), Schedule.recurs(3));

      const firstRun = delays(schedule, 10);
      expect(firstRun.length).toBe(2);

      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(2);
    });

    it("composes with andThen children", () => {
      const schedule = Schedule.intersect(
        Schedule.recurs(1).pipe(Schedule.andThen(Schedule.recurs(1))), // 2 total
        Schedule.recurs(2).pipe(Schedule.andThen(Schedule.recurs(1))) // 3 total
      );

      const d = delays(schedule, 10);
      expect(d.length).toBe(2); // min(2, 3) = 2

      // Verify reusability
      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(2);
    });
  });

  describe("deeply nested composition", () => {
    it("intersect → andThen", () => {
      const schedule = Schedule.intersect(
        Schedule.recurs(2),
        Schedule.recurs(3)
      ).pipe(Schedule.andThen(Schedule.recurs(2)));

      const d = delays(schedule, 10);
      expect(d.length).toBe(4); // min(2, 3) + 2 = 4

      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(4);
    });

    it("union(intersect(...), andThen(...))", () => {
      const schedule = Schedule.union(
        Schedule.intersect(
          Schedule.recurs(1).pipe(Schedule.andThen(Schedule.recurs(1))),
          Schedule.recurs(3)
        ),
        Schedule.recurs(1).pipe(Schedule.andThen(Schedule.recurs(1)))
      );

      const d = delays(schedule, 10);
      const secondRun = delays(schedule, 10);

      // Should be reusable
      expect(d.length).toBe(secondRun.length);
      expect(d.length).toBeGreaterThan(0);
    });

    it("andThen(union(...), union(...))", () => {
      const schedule = Schedule.union(Schedule.recurs(1), Schedule.recurs(1))
        .pipe(
          Schedule.andThen(
            Schedule.union(Schedule.recurs(1), Schedule.recurs(1))
          )
        );

      const d = delays(schedule, 10);
      expect(d.length).toBe(2); // 1 from first union + 1 from second union

      const secondRun = delays(schedule, 10);
      expect(secondRun.length).toBe(2);
    });
  });

  // ============================================================================
  // Running Schedules
  // ============================================================================

  describe("Schedule.run", () => {
    it("provides step-by-step iteration", () => {
      const schedule = Schedule.recurs<undefined>(3);

      const runner = Schedule.run(schedule);

      const step1 = runner.next(undefined);
      expect(step1.done).toBe(false);
      if (!step1.done) {
        expect(step1.value.output).toBe(0);
      }

      const step2 = runner.next(undefined);
      expect(step2.done).toBe(false);
      if (!step2.done) {
        expect(step2.value.output).toBe(1);
      }

      const step3 = runner.next(undefined);
      expect(step3.done).toBe(false);
      if (!step3.done) {
        expect(step3.value.output).toBe(2);
      }

      const step4 = runner.next(undefined);
      expect(step4.done).toBe(true);
    });
  });

  describe("Schedule.delays", () => {
    it("returns all delays for testing", () => {
      const schedule = Schedule.fibonacci(Duration.millis(100)).pipe(
        Schedule.upTo(5)
      );

      const d = Schedule.delays(schedule);

      expect(d.length).toBe(5);
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(100);
      expect(Duration.toMillis(d[2])).toBe(200);
      expect(Duration.toMillis(d[3])).toBe(300);
      expect(Duration.toMillis(d[4])).toBe(500);
    });
  });

  // ============================================================================
  // Real-world scenarios
  // ============================================================================

  describe("real-world scenarios", () => {
    it("payment retry: fast attempts then slower follow-ups", () => {
      const paymentRetry = Schedule.exponential(Duration.millis(200))
        .pipe(Schedule.upTo(4))
        .pipe(
          Schedule.andThen(
            Schedule.spaced(Duration.seconds(30)).pipe(Schedule.upTo(6))
          )
        );

      const d = delays(paymentRetry, 6);

      expect(Duration.toMillis(d[0])).toBe(200);
      expect(Duration.toMillis(d[1])).toBe(400);
      expect(Duration.toMillis(d[2])).toBe(800);
      expect(Duration.toMillis(d[3])).toBe(1600);
      expect(Duration.toMillis(d[4])).toBe(30000);
      expect(Duration.toMillis(d[5])).toBe(30000);
    });

    it("shipment tracking: poll every 5 minutes", () => {
      const trackShipment = Schedule.spaced(Duration.minutes(5))
        .pipe(Schedule.upToElapsed(Duration.hours(24)));

      const d = delays(trackShipment, 3);
      d.forEach((delay) => expect(Duration.toMillis(delay)).toBe(5 * 60 * 1000));
    });

    it("safe API calls: rate limit plus backoff", () => {
      const safeApiCalls = Schedule.intersect(
        Schedule.spaced(Duration.seconds(1)),
        Schedule.exponential(Duration.millis(200)).pipe(
          Schedule.maxDelay(Duration.seconds(30))
        )
      );

      const d = delays(safeApiCalls, 5);

      expect(Duration.toMillis(d[0])).toBe(1000); // max(1000, 200)
      expect(Duration.toMillis(d[1])).toBe(1000); // max(1000, 400)
      expect(Duration.toMillis(d[2])).toBe(1000); // max(1000, 800)
      expect(Duration.toMillis(d[3])).toBe(1600); // max(1000, 1600)
      expect(Duration.toMillis(d[4])).toBe(3200); // max(1000, 3200)
    });
  });

  // ============================================================================
  // Transformations
  // ============================================================================

  describe("transformations", () => {
    it("map transforms output", () => {
      const schedule = Schedule.recurs<undefined>(3).pipe(
        Schedule.map((n) => ({ attempt: n + 1 }))
      );

      const runner = Schedule.run(schedule);
      const step1 = runner.next(undefined);
      const step2 = runner.next(undefined);

      expect(step1.done).toBe(false);
      if (!step1.done) {
        expect(step1.value.output).toEqual({ attempt: 1 });
      }

      expect(step2.done).toBe(false);
      if (!step2.done) {
        expect(step2.value.output).toEqual({ attempt: 2 });
      }
    });

    it("tap performs side effects", () => {
      const logged: number[] = [];
      const schedule = Schedule.recurs<undefined>(3).pipe(
        Schedule.tap((n) => logged.push(n))
      );

      delays(schedule);

      expect(logged).toEqual([0, 1, 2]);
    });
  });

  // ============================================================================
  // Real-World Scenarios (business-focused)
  // ============================================================================

  describe("real-world scenarios (business-focused)", () => {
    describe("database connection pool", () => {
      it("uses aggressive retries then slower checks", () => {
        const dbReconnect = Schedule.exponential(Duration.millis(100))
          .pipe(Schedule.upTo(5))
          .pipe(
            Schedule.andThen(
              Schedule.spaced(Duration.seconds(10)).pipe(Schedule.upTo(3))
            )
          );

        const d = delays(dbReconnect, 10);

        // First 5 are exponential: 100, 200, 400, 800, 1600
        expect(Duration.toMillis(d[0])).toBe(100);
        expect(Duration.toMillis(d[1])).toBe(200);
        expect(Duration.toMillis(d[2])).toBe(400);
        expect(Duration.toMillis(d[3])).toBe(800);
        expect(Duration.toMillis(d[4])).toBe(1600);

        // Then spaced at 10s
        expect(Duration.toMillis(d[5])).toBe(10000);
        expect(Duration.toMillis(d[6])).toBe(10000);
        expect(Duration.toMillis(d[7])).toBe(10000);

        // Total: 5 + 3 = 8
        expect(d.length).toBe(8);
      });

      it("is reusable for multiple connection attempts", () => {
        const dbReconnect = Schedule.exponential(Duration.millis(100))
          .pipe(Schedule.upTo(3))
          .pipe(Schedule.andThen(Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(2))));

        const firstAttempt = delays(dbReconnect);
        const secondAttempt = delays(dbReconnect);

        expect(firstAttempt.length).toBe(5);
        expect(secondAttempt.length).toBe(5);
      });
    });

    describe("email service", () => {
      it("respects rate limits while backing off", () => {
        const emailRetry = Schedule.intersect(
          Schedule.spaced(Duration.millis(200)), // Rate limit: 5/second
          Schedule.exponential(Duration.millis(100))
            .pipe(Schedule.maxDelay(Duration.seconds(60)))
        ).pipe(Schedule.upTo(5));

        const d = delays(emailRetry);

        // intersect takes max(200, exponential)
        // exponential: 100, 200, 400, 800, 1600
        // spaced: 200, 200, 200, 200, 200
        // max: 200, 200, 400, 800, 1600
        expect(Duration.toMillis(d[0])).toBe(200);
        expect(Duration.toMillis(d[1])).toBe(200);
        expect(Duration.toMillis(d[2])).toBe(400);
        expect(Duration.toMillis(d[3])).toBe(800);
        expect(Duration.toMillis(d[4])).toBe(1600);
      });

      it("caps delay at maxDelay", () => {
        const emailRetry = Schedule.intersect(
          Schedule.spaced(Duration.millis(200)),
          Schedule.exponential(Duration.millis(1000))
            .pipe(Schedule.maxDelay(Duration.millis(5000)))
        ).pipe(Schedule.upTo(10));

        const d = delays(emailRetry);

        // All delays should be capped at 5000ms
        d.forEach((delay) => {
          expect(Duration.toMillis(delay)).toBeLessThanOrEqual(5000);
        });
      });
    });

    describe("webhook delivery", () => {
      it("uses three-phase escalating retry", () => {
        const webhookDelivery = Schedule.exponential(Duration.millis(100))
          .pipe(Schedule.upTo(3)) // Phase 1
          .pipe(
            Schedule.andThen(
              Schedule.spaced(Duration.millis(500)).pipe(Schedule.upTo(2)) // Phase 2
            )
          )
          .pipe(
            Schedule.andThen(
              Schedule.spaced(Duration.millis(1000)).pipe(Schedule.upTo(2)) // Phase 3
            )
          );

        const d = delays(webhookDelivery);

        // Phase 1: 100, 200, 400
        expect(Duration.toMillis(d[0])).toBe(100);
        expect(Duration.toMillis(d[1])).toBe(200);
        expect(Duration.toMillis(d[2])).toBe(400);

        // Phase 2: 500, 500
        expect(Duration.toMillis(d[3])).toBe(500);
        expect(Duration.toMillis(d[4])).toBe(500);

        // Phase 3: 1000, 1000
        expect(Duration.toMillis(d[5])).toBe(1000);
        expect(Duration.toMillis(d[6])).toBe(1000);

        expect(d.length).toBe(7);
      });

      it("is reusable across multiple webhook deliveries", () => {
        const webhookDelivery = Schedule.exponential(Duration.millis(100))
          .pipe(Schedule.upTo(2))
          .pipe(Schedule.andThen(Schedule.spaced(Duration.millis(500)).pipe(Schedule.upTo(2))));

        const first = delays(webhookDelivery);
        const second = delays(webhookDelivery);

        expect(first.length).toBe(4);
        expect(second.length).toBe(4);
        expect(Duration.toMillis(first[0])).toBe(Duration.toMillis(second[0]));
      });
    });

    describe("background job processing", () => {
      it("uses union for steady pace with backoff ceiling", () => {
        const jobProcessing = Schedule.union(
          Schedule.spaced(Duration.millis(100)), // Normal: 10 jobs/second
          Schedule.exponential(Duration.millis(50))
            .pipe(Schedule.maxDelay(Duration.millis(500)))
        ).pipe(Schedule.upTo(6));

        const d = delays(jobProcessing);

        // union takes min(100, exponential)
        // exponential: 50, 100, 200, 400, 500 (capped), 500
        // spaced: 100, 100, 100, 100, 100, 100
        // min: 50, 100, 100, 100, 100, 100
        expect(Duration.toMillis(d[0])).toBe(50);
        expect(Duration.toMillis(d[1])).toBe(100);
        expect(Duration.toMillis(d[2])).toBe(100);
        expect(Duration.toMillis(d[3])).toBe(100);
      });

      it("with jitter adds variation", () => {
        const jobProcessing = Schedule.union(
          Schedule.spaced(Duration.millis(100)),
          Schedule.exponential(Duration.millis(50))
        )
          .pipe(Schedule.jittered(0.1))
          .pipe(Schedule.upTo(10));

        const d = delays(jobProcessing);

        // With jitter, not all delays should be exactly the same
        const allSame = d.every(
          (delay) => Duration.toMillis(delay) === Duration.toMillis(d[0])
        );
        expect(allSame).toBe(false);
      });
    });
  });

  // ============================================================================
  // Real-World Patterns
  // ============================================================================

  describe("real-world patterns", () => {
    it("exponential backoff with jitter and cap", () => {
      const httpRetry = Schedule.exponential(Duration.millis(100))
        .pipe(Schedule.jittered(0.2))
        .pipe(Schedule.maxDelay(Duration.seconds(30)))
        .pipe(Schedule.upTo(5));

      const d = delays(httpRetry);

      expect(d.length).toBe(5);
      // All delays should be capped at 30s
      d.forEach((delay) => {
        expect(Duration.toMillis(delay)).toBeLessThanOrEqual(30000);
      });
    });

    it("two-phase retry strategy", () => {
      const twoPhase = Schedule.exponential(Duration.millis(50))
        .pipe(Schedule.upTo(3))
        .pipe(
          Schedule.andThen(
            Schedule.spaced(Duration.millis(1000)).pipe(Schedule.upTo(2))
          )
        );

      const d = delays(twoPhase);

      // 3 exponential + 2 spaced = 5
      expect(d.length).toBe(5);

      // First 3 are exponential
      expect(Duration.toMillis(d[0])).toBe(50);
      expect(Duration.toMillis(d[1])).toBe(100);
      expect(Duration.toMillis(d[2])).toBe(200);

      // Last 2 are spaced
      expect(Duration.toMillis(d[3])).toBe(1000);
      expect(Duration.toMillis(d[4])).toBe(1000);
    });

    it("adaptive rate limiting with intersect", () => {
      const adaptive = Schedule.intersect(
        Schedule.spaced(Duration.millis(100)), // Rate limit: 10 req/s
        Schedule.exponential(Duration.millis(50)) // Back off on failures
      ).pipe(Schedule.upTo(5));

      const d = delays(adaptive);

      expect(d.length).toBe(5);
      // First delays should be 100ms (spaced wins over small exponential)
      expect(Duration.toMillis(d[0])).toBe(100);
      expect(Duration.toMillis(d[1])).toBe(100);
    });

    it("aggressive retry with union fallback", () => {
      const aggressive = Schedule.union(
        Schedule.exponential(Duration.millis(100)),
        Schedule.spaced(Duration.millis(500)) // Never wait more than 500ms
      ).pipe(Schedule.upTo(5));

      const d = delays(aggressive);

      expect(d.length).toBe(5);
      // All delays should be at most 500ms (union takes min)
      d.forEach((delay) => {
        expect(Duration.toMillis(delay)).toBeLessThanOrEqual(500);
      });
    });
  });
});
