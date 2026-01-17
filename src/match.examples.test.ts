/**
 * Test file to verify all code examples in match.md actually work
 * This file should compile and run without errors
 */

import { describe, it, expect } from "vitest";
import { Match } from "./match";

// ============================================================================
// Test Types
// ============================================================================

type Status =
  | { _tag: "Pending" }
  | { _tag: "Running"; progress: number }
  | { _tag: "Completed"; result: string }
  | { _tag: "Failed"; error: string };

type Event =
  | { _tag: "UserCreated"; userId: string; name: string }
  | { _tag: "UserUpdated"; userId: string }
  | { _tag: "UserDeleted"; userId: string };

type DomainEvent =
  | { _tag: "OrderPlaced"; orderId: string; items: string[] }
  | { _tag: "OrderShipped"; orderId: string; trackingNumber: string }
  | { _tag: "OrderDelivered"; orderId: string }
  | { _tag: "OrderCancelled"; orderId: string; reason: string };

type ApiResult =
  | { _tag: "Success"; data: unknown }
  | { _tag: "NotFound"; resource: string }
  | { _tag: "Unauthorized" }
  | { _tag: "RateLimited"; retryAfter: number };

type ConnectionState =
  | { _tag: "Disconnected" }
  | { _tag: "Connecting"; attempt: number }
  | { _tag: "Connected"; sessionId: string }
  | { _tag: "Reconnecting"; attempt: number; lastError: string };

// ============================================================================
// Core API Tests
// ============================================================================

describe("Match Documentation Examples", () => {
  describe("Match.value and Match.tag", () => {
    it("handles all cases of a union exhaustively", () => {
      function getMessage(status: Status): string {
        return Match.value(status)
          .pipe(Match.tag("Pending", () => "Waiting..."))
          .pipe(Match.tag("Running", (s) => `${s.progress}%`))
          .pipe(Match.tag("Completed", (s) => s.result))
          .pipe(Match.tag("Failed", (s) => `Error: ${s.error}`))
          .pipe(Match.exhaustive);
      }

      expect(getMessage({ _tag: "Pending" })).toBe("Waiting...");
      expect(getMessage({ _tag: "Running", progress: 50 })).toBe("50%");
      expect(getMessage({ _tag: "Completed", result: "success" })).toBe("success");
      expect(getMessage({ _tag: "Failed", error: "timeout" })).toBe("Error: timeout");
    });

    it("works with Event union from docs", () => {
      function handleEvent(event: Event): string {
        return Match.value(event)
          .pipe(Match.tag("UserCreated", (e) => `Created: ${e.name}`))
          .pipe(Match.tag("UserUpdated", (e) => `Updated: ${e.userId}`))
          .pipe(Match.tag("UserDeleted", (e) => `Deleted: ${e.userId}`))
          .pipe(Match.exhaustive);
      }

      expect(handleEvent({ _tag: "UserCreated", userId: "1", name: "Alice" })).toBe(
        "Created: Alice"
      );
      expect(handleEvent({ _tag: "UserUpdated", userId: "1" })).toBe("Updated: 1");
      expect(handleEvent({ _tag: "UserDeleted", userId: "1" })).toBe("Deleted: 1");
    });
  });

  describe("Match.tags - batch handling", () => {
    it("handles multiple cases at once", () => {
      function handleEvent(event: Event): string {
        return Match.value(event)
          .pipe(
            Match.tags({
              UserCreated: (e) => `Created: ${e.name}`,
              UserUpdated: (e) => `Updated: ${e.userId}`,
              UserDeleted: (e) => `Deleted: ${e.userId}`,
            })
          )
          .pipe(Match.exhaustive);
      }

      expect(handleEvent({ _tag: "UserCreated", userId: "1", name: "Alice" })).toBe(
        "Created: Alice"
      );
    });
  });

  describe("Match.orElse - default handler", () => {
    it("uses default handler for unmatched cases", () => {
      function getMessage(status: Status): string {
        return Match.value(status)
          .pipe(Match.tag("Completed", (s) => `Done: ${s.result}`))
          .pipe(Match.orElse((s) => `Status: ${s._tag}`));
      }

      expect(getMessage({ _tag: "Completed", result: "success" })).toBe("Done: success");
      expect(getMessage({ _tag: "Pending" })).toBe("Status: Pending");
      expect(getMessage({ _tag: "Running", progress: 50 })).toBe("Status: Running");
      expect(getMessage({ _tag: "Failed", error: "oops" })).toBe("Status: Failed");
    });
  });

  describe("Match.orElseValue - default value", () => {
    it("returns constant for unhandled cases", () => {
      function getResult(status: Status): string {
        return Match.value(status)
          .pipe(Match.tag("Completed", (s) => s.result))
          .pipe(Match.orElseValue("not completed"));
      }

      expect(getResult({ _tag: "Completed", result: "success" })).toBe("success");
      expect(getResult({ _tag: "Pending" })).toBe("not completed");
      expect(getResult({ _tag: "Running", progress: 50 })).toBe("not completed");
    });
  });

  describe("Match.when - conditional matching", () => {
    it("applies predicate when there is a fallback handler", () => {
      type User = { _tag: "User"; name: string; isAdmin: boolean };

      function greet(user: User): string {
        return Match.value(user)
          .pipe(Match.tag("User", (u) => `Hello ${u.name}`))
          .pipe(
            Match.when(
              "User",
              (u) => u.isAdmin,
              (u) => `Hello Admin ${u.name}!`
            )
          )
          .pipe(Match.exhaustive);
      }

      expect(greet({ _tag: "User", name: "Alice", isAdmin: true })).toBe(
        "Hello Admin Alice!"
      );
      expect(greet({ _tag: "User", name: "Bob", isAdmin: false })).toBe("Hello Bob");
    });
  });

  describe("Match.is - type guard", () => {
    it("narrows type correctly", () => {
      const event: Event = { _tag: "UserCreated", userId: "1", name: "Alice" };

      if (Match.is<Event, "UserCreated">("UserCreated")(event)) {
        expect(event.name).toBe("Alice");
      } else {
        throw new Error("Should have matched");
      }
    });

    it("returns false for non-matching tags", () => {
      const event: Event = { _tag: "UserDeleted", userId: "1" };
      expect(Match.is<Event, "UserCreated">("UserCreated")(event)).toBe(false);
    });
  });

  describe("Match.isOneOf - multiple tag check", () => {
    it("matches any of the specified tags", () => {
      const isModification = Match.isOneOf<Event, ("UserCreated" | "UserUpdated")[]>(
        "UserCreated",
        "UserUpdated"
      );

      expect(isModification({ _tag: "UserCreated", userId: "1", name: "Alice" })).toBe(
        true
      );
      expect(isModification({ _tag: "UserUpdated", userId: "1" })).toBe(true);
      expect(isModification({ _tag: "UserDeleted", userId: "1" })).toBe(false);
    });
  });

  // ============================================================================
  // Real-World Examples from Docs
  // ============================================================================

  describe("real-world examples", () => {
    it("event handler example", () => {
      function handleEvent(event: DomainEvent): string {
        return Match.value(event)
          .pipe(
            Match.tag(
              "OrderPlaced",
              (e) => `Order ${e.orderId} placed with ${e.items.length} items`
            )
          )
          .pipe(
            Match.tag(
              "OrderShipped",
              (e) => `Order ${e.orderId} shipped: ${e.trackingNumber}`
            )
          )
          .pipe(Match.tag("OrderDelivered", (e) => `Order ${e.orderId} delivered`))
          .pipe(
            Match.tag(
              "OrderCancelled",
              (e) => `Order ${e.orderId} cancelled: ${e.reason}`
            )
          )
          .pipe(Match.exhaustive);
      }

      expect(
        handleEvent({ _tag: "OrderPlaced", orderId: "123", items: ["a", "b"] })
      ).toBe("Order 123 placed with 2 items");

      expect(
        handleEvent({ _tag: "OrderShipped", orderId: "123", trackingNumber: "TRACK-456" })
      ).toBe("Order 123 shipped: TRACK-456");

      expect(handleEvent({ _tag: "OrderDelivered", orderId: "123" })).toBe(
        "Order 123 delivered"
      );

      expect(
        handleEvent({
          _tag: "OrderCancelled",
          orderId: "123",
          reason: "out of stock",
        })
      ).toBe("Order 123 cancelled: out of stock");
    });

    it("API result handling example", () => {
      function formatError(result: ApiResult): string | null {
        return Match.value(result)
          .pipe(Match.tag("Success", () => null))
          .pipe(Match.tag("NotFound", (r) => `Resource not found: ${r.resource}`))
          .pipe(Match.tag("Unauthorized", () => "Please log in"))
          .pipe(
            Match.tag("RateLimited", (r) => `Too many requests. Retry in ${r.retryAfter}s`)
          )
          .pipe(Match.exhaustive);
      }

      expect(formatError({ _tag: "Success", data: {} })).toBe(null);
      expect(formatError({ _tag: "NotFound", resource: "user:123" })).toBe(
        "Resource not found: user:123"
      );
      expect(formatError({ _tag: "Unauthorized" })).toBe("Please log in");
      expect(formatError({ _tag: "RateLimited", retryAfter: 30 })).toBe(
        "Too many requests. Retry in 30s"
      );
    });

    it("state machine example", () => {
      function getStatusIcon(state: ConnectionState): string {
        return Match.value(state)
          .pipe(Match.tag("Disconnected", () => "⚫"))
          .pipe(Match.tag("Connecting", () => "🟡"))
          .pipe(Match.tag("Connected", () => "🟢"))
          .pipe(Match.tag("Reconnecting", () => "🟠"))
          .pipe(Match.exhaustive);
      }

      expect(getStatusIcon({ _tag: "Disconnected" })).toBe("⚫");
      expect(getStatusIcon({ _tag: "Connecting", attempt: 1 })).toBe("🟡");
      expect(getStatusIcon({ _tag: "Connected", sessionId: "abc" })).toBe("🟢");
      expect(
        getStatusIcon({ _tag: "Reconnecting", attempt: 2, lastError: "timeout" })
      ).toBe("🟠");
    });

    it("partial handling with defaults example", () => {
      function isActive(state: ConnectionState): boolean {
        return Match.value(state)
          .pipe(Match.tag("Connected", () => true))
          .pipe(Match.tag("Reconnecting", () => true))
          .pipe(Match.orElseValue(false));
      }

      expect(isActive({ _tag: "Connected", sessionId: "abc" })).toBe(true);
      expect(isActive({ _tag: "Reconnecting", attempt: 1, lastError: "err" })).toBe(true);
      expect(isActive({ _tag: "Disconnected" })).toBe(false);
      expect(isActive({ _tag: "Connecting", attempt: 1 })).toBe(false);
    });
  });

  // ============================================================================
  // Real-World Scenarios (from match.md)
  // ============================================================================

  describe("real-world scenarios", () => {
    describe("payment processing", () => {
      type PaymentResult =
        | { _tag: "Success"; transactionId: string; amount: number }
        | { _tag: "Declined"; reason: string; canRetry: boolean }
        | { _tag: "Fraud"; riskScore: number }
        | { _tag: "NetworkError"; provider: string };

      function handlePayment(result: PaymentResult): { action: string; notify: boolean } {
        return Match.value(result)
          .pipe(
            Match.tag("Success", (r) => ({
              action: `Charge ${r.transactionId} complete`,
              notify: false,
            }))
          )
          .pipe(
            Match.tag("Declined", (r) => ({
              action: r.canRetry ? "Show retry prompt" : "Show alternative payment",
              notify: false,
            }))
          )
          .pipe(
            Match.tag("Fraud", (r) => ({
              action: `Flag order for review (score: ${r.riskScore})`,
              notify: true,
            }))
          )
          .pipe(
            Match.tag("NetworkError", (r) => ({
              action: `Retry with fallback provider (${r.provider} down)`,
              notify: true,
            }))
          )
          .pipe(Match.exhaustive);
      }

      it("handles successful payment", () => {
        const result = handlePayment({
          _tag: "Success",
          transactionId: "tx_123",
          amount: 99.99,
        });
        expect(result).toEqual({ action: "Charge tx_123 complete", notify: false });
      });

      it("handles declined payment with retry", () => {
        const result = handlePayment({
          _tag: "Declined",
          reason: "insufficient funds",
          canRetry: true,
        });
        expect(result).toEqual({ action: "Show retry prompt", notify: false });
      });

      it("handles declined payment without retry", () => {
        const result = handlePayment({
          _tag: "Declined",
          reason: "card expired",
          canRetry: false,
        });
        expect(result).toEqual({ action: "Show alternative payment", notify: false });
      });

      it("handles fraud detection", () => {
        const result = handlePayment({ _tag: "Fraud", riskScore: 85 });
        expect(result).toEqual({
          action: "Flag order for review (score: 85)",
          notify: true,
        });
      });

      it("handles network error", () => {
        const result = handlePayment({ _tag: "NetworkError", provider: "Stripe" });
        expect(result).toEqual({
          action: "Retry with fallback provider (Stripe down)",
          notify: true,
        });
      });
    });

    describe("subscription billing", () => {
      type Subscription =
        | { _tag: "Free"; userId: string }
        | { _tag: "Pro"; userId: string; monthlyRate: number }
        | { _tag: "Enterprise"; userId: string; contractValue: number; billingContact: string };

      function calculateInvoice(sub: Subscription): number {
        return Match.value(sub)
          .pipe(Match.tag("Free", () => 0))
          .pipe(Match.tag("Pro", (s) => s.monthlyRate))
          .pipe(Match.tag("Enterprise", (s) => s.contractValue / 12))
          .pipe(Match.exhaustive);
      }

      function getBillingEmail(sub: Subscription): string {
        return Match.value(sub)
          .pipe(Match.tag("Enterprise", (s) => s.billingContact))
          .pipe(Match.orElse((s) => `user-${s.userId}@example.com`));
      }

      it("calculates invoice for free tier", () => {
        expect(calculateInvoice({ _tag: "Free", userId: "u1" })).toBe(0);
      });

      it("calculates invoice for pro tier", () => {
        expect(calculateInvoice({ _tag: "Pro", userId: "u2", monthlyRate: 29 })).toBe(29);
      });

      it("calculates invoice for enterprise tier", () => {
        expect(
          calculateInvoice({
            _tag: "Enterprise",
            userId: "u3",
            contractValue: 12000,
            billingContact: "billing@corp.com",
          })
        ).toBe(1000);
      });

      it("gets billing email for enterprise", () => {
        expect(
          getBillingEmail({
            _tag: "Enterprise",
            userId: "u3",
            contractValue: 12000,
            billingContact: "billing@corp.com",
          })
        ).toBe("billing@corp.com");
      });

      it("gets billing email for non-enterprise", () => {
        expect(getBillingEmail({ _tag: "Free", userId: "u1" })).toBe("user-u1@example.com");
        expect(getBillingEmail({ _tag: "Pro", userId: "u2", monthlyRate: 29 })).toBe(
          "user-u2@example.com"
        );
      });
    });

    describe("notification routing", () => {
      type NotificationEvent =
        | { _tag: "OrderShipped"; orderId: string; trackingUrl: string }
        | { _tag: "PaymentFailed"; amount: number; retryUrl: string }
        | { _tag: "AccountLocked"; reason: string }
        | { _tag: "PasswordChanged" };

      type Channel = "email" | "sms" | "push" | "slack";

      function routeNotification(event: NotificationEvent): { channel: Channel; urgent: boolean } {
        return Match.value(event)
          .pipe(Match.tag("OrderShipped", () => ({ channel: "push" as const, urgent: false })))
          .pipe(Match.tag("PaymentFailed", () => ({ channel: "email" as const, urgent: true })))
          .pipe(Match.tag("AccountLocked", () => ({ channel: "sms" as const, urgent: true })))
          .pipe(Match.tag("PasswordChanged", () => ({ channel: "email" as const, urgent: false })))
          .pipe(Match.exhaustive);
      }

      it("routes order shipped to push", () => {
        expect(
          routeNotification({ _tag: "OrderShipped", orderId: "123", trackingUrl: "http://..." })
        ).toEqual({ channel: "push", urgent: false });
      });

      it("routes payment failed to email urgently", () => {
        expect(
          routeNotification({ _tag: "PaymentFailed", amount: 99, retryUrl: "http://..." })
        ).toEqual({ channel: "email", urgent: true });
      });

      it("routes account locked to sms urgently", () => {
        expect(routeNotification({ _tag: "AccountLocked", reason: "suspicious activity" })).toEqual({
          channel: "sms",
          urgent: true,
        });
      });

      it("routes password changed to email", () => {
        expect(routeNotification({ _tag: "PasswordChanged" })).toEqual({
          channel: "email",
          urgent: false,
        });
      });
    });

    describe("form validation", () => {
      type ValidationError =
        | { _tag: "Required"; field: string }
        | { _tag: "TooShort"; field: string; min: number; actual: number }
        | { _tag: "InvalidFormat"; field: string; expected: string }
        | { _tag: "AlreadyExists"; field: string; value: string };

      function formatValidationError(error: ValidationError): string {
        return Match.value(error)
          .pipe(Match.tag("Required", (e) => `${e.field} is required`))
          .pipe(
            Match.tag(
              "TooShort",
              (e) => `${e.field} must be at least ${e.min} characters (got ${e.actual})`
            )
          )
          .pipe(Match.tag("InvalidFormat", (e) => `${e.field} must be a valid ${e.expected}`))
          .pipe(Match.tag("AlreadyExists", (e) => `${e.field} "${e.value}" is already taken`))
          .pipe(Match.exhaustive);
      }

      it("formats required error", () => {
        expect(formatValidationError({ _tag: "Required", field: "email" })).toBe(
          "email is required"
        );
      });

      it("formats too short error", () => {
        expect(
          formatValidationError({ _tag: "TooShort", field: "password", min: 8, actual: 4 })
        ).toBe("password must be at least 8 characters (got 4)");
      });

      it("formats invalid format error", () => {
        expect(
          formatValidationError({ _tag: "InvalidFormat", field: "email", expected: "email address" })
        ).toBe("email must be a valid email address");
      });

      it("formats already exists error", () => {
        expect(
          formatValidationError({ _tag: "AlreadyExists", field: "username", value: "john_doe" })
        ).toBe('username "john_doe" is already taken');
      });
    });
  });

  // ============================================================================
  // Best Practices Examples
  // ============================================================================

  describe("best practices", () => {
    it("extracted handlers for complex logic", () => {
      const handleCreated = (e: Extract<Event, { _tag: "UserCreated" }>) => {
        return `Created: ${e.name}`;
      };

      const handleUpdated = (e: Extract<Event, { _tag: "UserUpdated" }>) => {
        return `Updated: ${e.userId}`;
      };

      const handleDeleted = (e: Extract<Event, { _tag: "UserDeleted" }>) => {
        return `Deleted: ${e.userId}`;
      };

      function handleEvent(event: Event): string {
        return Match.value(event)
          .pipe(Match.tag("UserCreated", handleCreated))
          .pipe(Match.tag("UserUpdated", handleUpdated))
          .pipe(Match.tag("UserDeleted", handleDeleted))
          .pipe(Match.exhaustive);
      }

      expect(handleEvent({ _tag: "UserCreated", userId: "1", name: "Alice" })).toBe(
        "Created: Alice"
      );
    });
  });
});
