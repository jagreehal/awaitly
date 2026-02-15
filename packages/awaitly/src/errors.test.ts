/**
 * Tests for errors.ts - Pre-built error types
 */
import { describe, it, expect } from "vitest";
import { TaggedError } from "./tagged-error";
import {
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  NetworkError,
  CompensationError,
  isTimeoutError,
  isRetryExhaustedError,
  isRateLimitError,
  isCircuitBreakerOpenError,
  isValidationError,
  isNotFoundError,
  isUnauthorizedError,
  isNetworkError,
  isCompensationError,
  isAwaitlyError,
  type AwaitlyError,
} from "./errors";

describe("Pre-built Errors", () => {
  describe("TimeoutError", () => {
    it("creates error with operation and ms", () => {
      const error = new TimeoutError({ operation: "fetchUser", ms: 5000 });
      expect(error._tag).toBe("TimeoutError");
      expect(error.operation).toBe("fetchUser");
      expect(error.ms).toBe(5000);
      expect(error.message).toBe(
        "TimeoutError: fetchUser timed out after 5000ms"
      );
    });

    it("creates error without operation", () => {
      const error = new TimeoutError({ ms: 3000 });
      expect(error.message).toBe(
        "TimeoutError: Operation timed out after 3000ms"
      );
    });

    it("is instance of TaggedError", () => {
      const error = new TimeoutError({ ms: 1000 });
      expect(error instanceof TaggedError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("RetryExhaustedError", () => {
    it("creates error with operation and attempts", () => {
      const error = new RetryExhaustedError({
        operation: "sendEmail",
        attempts: 3,
      });
      expect(error._tag).toBe("RetryExhaustedError");
      expect(error.operation).toBe("sendEmail");
      expect(error.attempts).toBe(3);
      expect(error.message).toBe(
        "RetryExhaustedError: sendEmail failed after 3 attempts"
      );
    });

    it("includes lastError when provided", () => {
      const lastError = new Error("SMTP connection failed");
      const error = new RetryExhaustedError({
        operation: "sendEmail",
        attempts: 3,
        lastError,
      });
      expect(error.lastError).toBe(lastError);
    });
  });

  describe("RateLimitError", () => {
    it("creates error with limiter name and retry info", () => {
      const error = new RateLimitError({
        limiterName: "api-calls",
        retryAfterMs: 1000,
      });
      expect(error._tag).toBe("RateLimitError");
      expect(error.limiterName).toBe("api-calls");
      expect(error.retryAfterMs).toBe(1000);
      expect(error.message).toBe(
        "RateLimitError: Rate limit exceeded for api-calls, retry after 1000ms"
      );
    });

    it("creates error without retry info", () => {
      const error = new RateLimitError({ limiterName: "api" });
      expect(error.message).toBe("RateLimitError: Rate limit exceeded for api");
    });
  });

  describe("CircuitBreakerOpenError", () => {
    it("creates error with circuit info", () => {
      const error = new CircuitBreakerOpenError({
        circuitName: "payment-api",
        state: "OPEN",
        retryAfterMs: 30000,
      });
      expect(error._tag).toBe("CircuitBreakerOpenError");
      expect(error.circuitName).toBe("payment-api");
      expect(error.state).toBe("OPEN");
      expect(error.message).toBe(
        "CircuitBreakerOpenError: Circuit payment-api is OPEN, retry after 30s"
      );
    });
  });

  describe("ValidationError", () => {
    it("creates error with field and reason", () => {
      const error = new ValidationError({
        field: "email",
        reason: "Invalid format",
      });
      expect(error._tag).toBe("ValidationError");
      expect(error.field).toBe("email");
      expect(error.reason).toBe("Invalid format");
      expect(error.message).toBe(
        "ValidationError: Invalid email - Invalid format"
      );
    });

    it("includes value when provided", () => {
      const error = new ValidationError({
        field: "age",
        reason: "Must be positive",
        value: -5,
      });
      expect(error.value).toBe(-5);
    });
  });

  describe("NotFoundError", () => {
    it("creates error with resource and id", () => {
      const error = new NotFoundError({ resource: "User", id: "123" });
      expect(error._tag).toBe("NotFoundError");
      expect(error.resource).toBe("User");
      expect(error.id).toBe("123");
      expect(error.message).toBe(
        "NotFoundError: User with id 123 not found"
      );
    });

    it("creates error without id", () => {
      const error = new NotFoundError({ resource: "Configuration" });
      expect(error.message).toBe("NotFoundError: Configuration not found");
    });
  });

  describe("UnauthorizedError", () => {
    it("creates error with action and resource", () => {
      const error = new UnauthorizedError({
        action: "delete",
        resource: "User",
      });
      expect(error._tag).toBe("UnauthorizedError");
      expect(error.message).toBe(
        "UnauthorizedError: Not authorized to delete User"
      );
    });

    it("creates error with reason", () => {
      const error = new UnauthorizedError({ reason: "Token expired" });
      expect(error.message).toBe("UnauthorizedError: Token expired");
    });

    it("creates error without details", () => {
      const error = new UnauthorizedError({});
      expect(error.message).toBe("UnauthorizedError: Access denied");
    });
  });

  describe("NetworkError", () => {
    it("creates error with url and reason", () => {
      const error = new NetworkError({
        url: "https://api.example.com",
        reason: "Connection refused",
        retryable: true,
      });
      expect(error._tag).toBe("NetworkError");
      expect(error.url).toBe("https://api.example.com");
      expect(error.reason).toBe("Connection refused");
      expect(error.retryable).toBe(true);
      expect(error.message).toBe(
        "NetworkError: Connection refused (https://api.example.com)"
      );
    });
  });

  describe("CompensationError", () => {
    it("creates error with step info", () => {
      const originalError = new Error("Payment failed");
      const compensationError = new Error("Refund failed");
      const error = new CompensationError({
        step: "chargeCard",
        originalError,
        compensationError,
      });
      expect(error._tag).toBe("CompensationError");
      expect(error.step).toBe("chargeCard");
      expect(error.originalError).toBe(originalError);
      expect(error.compensationError).toBe(compensationError);
      expect(error.message).toBe(
        "CompensationError: Failed to compensate step chargeCard"
      );
    });
  });
});

describe("Type Guards", () => {
  const errors = {
    timeout: new TimeoutError({ ms: 1000 }),
    retry: new RetryExhaustedError({ attempts: 3 }),
    rateLimit: new RateLimitError({}),
    circuitBreaker: new CircuitBreakerOpenError({ circuitName: "test" }),
    validation: new ValidationError({ field: "test", reason: "test" }),
    notFound: new NotFoundError({ resource: "Test" }),
    unauthorized: new UnauthorizedError({}),
    network: new NetworkError({ reason: "test" }),
    compensation: new CompensationError({ step: "test" }),
  };

  it("isTimeoutError correctly identifies TimeoutError", () => {
    expect(isTimeoutError(errors.timeout)).toBe(true);
    expect(isTimeoutError(errors.retry)).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError({ _tag: "TimeoutError" })).toBe(false); // not a TaggedError
  });

  it("isRetryExhaustedError correctly identifies RetryExhaustedError", () => {
    expect(isRetryExhaustedError(errors.retry)).toBe(true);
    expect(isRetryExhaustedError(errors.timeout)).toBe(false);
  });

  it("isRateLimitError correctly identifies RateLimitError", () => {
    expect(isRateLimitError(errors.rateLimit)).toBe(true);
    expect(isRateLimitError(errors.timeout)).toBe(false);
  });

  it("isCircuitBreakerOpenError correctly identifies CircuitBreakerOpenError", () => {
    expect(isCircuitBreakerOpenError(errors.circuitBreaker)).toBe(true);
    expect(isCircuitBreakerOpenError(errors.timeout)).toBe(false);
  });

  it("isValidationError correctly identifies ValidationError", () => {
    expect(isValidationError(errors.validation)).toBe(true);
    expect(isValidationError(errors.timeout)).toBe(false);
  });

  it("isNotFoundError correctly identifies NotFoundError", () => {
    expect(isNotFoundError(errors.notFound)).toBe(true);
    expect(isNotFoundError(errors.timeout)).toBe(false);
  });

  it("isUnauthorizedError correctly identifies UnauthorizedError", () => {
    expect(isUnauthorizedError(errors.unauthorized)).toBe(true);
    expect(isUnauthorizedError(errors.timeout)).toBe(false);
  });

  it("isNetworkError correctly identifies NetworkError", () => {
    expect(isNetworkError(errors.network)).toBe(true);
    expect(isNetworkError(errors.timeout)).toBe(false);
  });

  it("isCompensationError correctly identifies CompensationError", () => {
    expect(isCompensationError(errors.compensation)).toBe(true);
    expect(isCompensationError(errors.timeout)).toBe(false);
  });

  it("isAwaitlyError identifies any AwaitlyError", () => {
    Object.values(errors).forEach((error) => {
      expect(isAwaitlyError(error)).toBe(true);
    });
    expect(isAwaitlyError(new Error("plain error"))).toBe(false);
    expect(isAwaitlyError(null)).toBe(false);
  });
});

describe("Pattern Matching", () => {
  it("matches exhaustively on AwaitlyError", () => {
    const error: AwaitlyError = new TimeoutError({ ms: 5000 });

    const result = TaggedError.match(error, {
      TimeoutError: (e: TimeoutError) => `timeout:${e.ms}`,
      RetryExhaustedError: (e: RetryExhaustedError) => `retry:${e.attempts}`,
      RateLimitError: () => "rate",
      CircuitBreakerOpenError: (e: CircuitBreakerOpenError) => `circuit:${e.circuitName}`,
      ValidationError: (e: ValidationError) => `validation:${e.field}`,
      NotFoundError: (e: NotFoundError) => `notfound:${e.resource}`,
      UnauthorizedError: () => "unauthorized",
      NetworkError: (e: NetworkError) => `network:${e.reason}`,
      CompensationError: (e: CompensationError) => `compensation:${e.step}`,
    });

    expect(result).toBe("timeout:5000");
  });

  it("matches partially with fallback", () => {
    const error: AwaitlyError = new NetworkError({ reason: "DNS error" });

    const result = TaggedError.matchPartial<AwaitlyError, { TimeoutError: (e: TimeoutError) => string }, string>(
      error,
      {
        TimeoutError: (e: TimeoutError) => `timeout:${e.ms}`,
      },
      (e) => `other:${e._tag}`
    );

    expect(result).toBe("other:NetworkError");
  });
});
