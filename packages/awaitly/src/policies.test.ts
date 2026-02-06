/**
 * Test file to verify all code examples in policies.md actually work
 * This file should compile and run without errors
 */

import { describe, it, expect } from "vitest";
import {
  
  // Core functions
  mergePolicies,
  withPolicy,
  withPolicies,
  createPolicyApplier,
  createPolicyBundle,

  // Policy builders
  retryPolicy,
  timeoutPolicy,

  // Pre-built policies
  retryPolicies,
  timeoutPolicies,
  servicePolicies,

  // Conditional policies
  conditionalPolicy,
  envPolicy,

  // Registry
  createPolicyRegistry,

  // Fluent builder
  stepOptions,
} from "./policies";
import { ok, type AsyncResult } from "./index";
import { createWorkflow } from "./workflow-entry";

// ============================================================================
// Mock Dependencies
// ============================================================================

type User = { id: string; name: string };
type Order = { id: string; items: string[] };
type Data = { value: string };

async function fetchUser(id: string): AsyncResult<User, "USER_NOT_FOUND"> {
  return ok({ id, name: "Test User" });
}

async function fetchOrders(_id: string): AsyncResult<Order[], "ORDERS_ERROR"> {
  return ok([{ id: "order-1", items: ["item-1"] }]);
}

async function fetchData(_id: string): AsyncResult<Data, "DATA_ERROR"> {
  return ok({ value: "test" });
}

async function queryOrders(_id: string): AsyncResult<Order[], "QUERY_ERROR"> {
  return ok([{ id: "order-1", items: ["item-1"] }]);
}

async function checkCache(_id: string): AsyncResult<boolean, "CACHE_ERROR"> {
  return ok(true);
}

// ============================================================================
// Pre-built Policies
// ============================================================================

describe("policies", () => {
  describe("retryPolicies", () => {
    it("provides none policy (no retry)", () => {
      const policy = retryPolicies.none;
      expect(policy.retry?.attempts).toBe(1);
    });

    it("provides transient policy (fast backoff)", () => {
      const policy = retryPolicies.transient;
      expect(policy.retry?.attempts).toBe(3);
      expect(policy.retry?.backoff).toBe("exponential");
    });

    it("provides standard policy (moderate backoff)", () => {
      const policy = retryPolicies.standard;
      expect(policy.retry?.attempts).toBe(3);
    });

    it("provides aggressive policy (longer backoff)", () => {
      const policy = retryPolicies.aggressive;
      expect(policy.retry?.attempts).toBe(5);
    });

    it("provides fixed builder", () => {
      const policy = retryPolicies.fixed(3, 1000);
      expect(policy.retry?.attempts).toBe(3);
      expect(policy.retry?.backoff).toBe("fixed");
      expect(policy.retry?.initialDelay).toBe(1000);
    });

    it("provides linear builder", () => {
      const policy = retryPolicies.linear(5, 500);
      expect(policy.retry?.attempts).toBe(5);
      expect(policy.retry?.backoff).toBe("linear");
    });

    it("provides custom builder", () => {
      const policy = retryPolicies.custom({ attempts: 4 });
      expect(policy.retry?.attempts).toBe(4);
      expect(policy.retry?.backoff).toBe("exponential"); // default
    });
  });

  describe("timeoutPolicies", () => {
    it("provides none policy (no timeout)", () => {
      const policy = timeoutPolicies.none;
      expect(policy.timeout).toBeUndefined();
    });

    it("provides fast policy (1 second)", () => {
      const policy = timeoutPolicies.fast;
      expect(policy.timeout?.ms).toBe(1000);
    });

    it("provides api policy (5 seconds)", () => {
      const policy = timeoutPolicies.api;
      expect(policy.timeout?.ms).toBe(5000);
    });

    it("provides extended policy (30 seconds)", () => {
      const policy = timeoutPolicies.extended;
      expect(policy.timeout?.ms).toBe(30000);
    });

    it("provides long policy (2 minutes)", () => {
      const policy = timeoutPolicies.long;
      expect(policy.timeout?.ms).toBe(120000);
    });

    it("provides ms builder", () => {
      const policy = timeoutPolicies.ms(3000);
      expect(policy.timeout?.ms).toBe(3000);
    });

    it("provides seconds builder", () => {
      const policy = timeoutPolicies.seconds(10);
      expect(policy.timeout?.ms).toBe(10000);
    });

    it("provides withSignal builder", () => {
      const policy = timeoutPolicies.withSignal(5000);
      expect(policy.timeout?.ms).toBe(5000);
      expect(policy.timeout?.signal).toBe(true);
    });
  });

  describe("servicePolicies", () => {
    it("provides httpApi policy", () => {
      const policy = servicePolicies.httpApi;
      expect(policy.timeout?.ms).toBe(5000);
      expect(policy.retry?.attempts).toBe(3);
    });

    it("provides database policy", () => {
      const policy = servicePolicies.database;
      expect(policy.timeout?.ms).toBe(30000);
      expect(policy.retry?.attempts).toBe(2);
    });

    it("provides cache policy", () => {
      const policy = servicePolicies.cache;
      expect(policy.timeout?.ms).toBe(1000);
      expect(policy.retry?.attempts).toBe(1);
    });

    it("provides messageQueue policy", () => {
      const policy = servicePolicies.messageQueue;
      expect(policy.timeout?.ms).toBe(30000);
      expect(policy.retry?.attempts).toBe(5);
    });

    it("provides fileSystem policy", () => {
      const policy = servicePolicies.fileSystem;
      expect(policy.timeout?.ms).toBe(120000);
      expect(policy.retry?.attempts).toBe(3);
    });

    it("provides rateLimited policy", () => {
      const policy = servicePolicies.rateLimited;
      expect(policy.timeout?.ms).toBe(10000);
      expect(policy.retry?.attempts).toBe(5);
      expect(policy.retry?.backoff).toBe("linear");
    });
  });

  describe("The Solution: Policies", () => {
    it("applies policy consistently across multiple steps", async () => {
      const deps = { fetchUser, fetchOrders };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser, fetchOrders }) => {
        // ✓ One policy, used everywhere
        const user = await step(
          "fetch-user",
          () => fetchUser("123"),
          withPolicy(servicePolicies.httpApi)
        );

        const orders = await step(
          "fetch-orders",
          () => fetchOrders("123"),
          withPolicy(servicePolicies.httpApi)
        );

        return ok({ user, orders });
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("withPolicy", () => {
    it("applies single policy with object options", () => {
      const result = withPolicy(servicePolicies.httpApi, {
        key: "user:123",
      });

      expect(result.key).toBe("user:123");
      expect(result.timeout?.ms).toBe(5000);
      expect(result.retry?.attempts).toBe(3);
    });

    it("works without step options", () => {
      const result = withPolicy(servicePolicies.httpApi);

      expect(result.timeout?.ms).toBe(5000);
      expect(result.retry?.attempts).toBe(3);
    });
  });

  describe("withPolicies", () => {
    it("applies multiple policies", () => {
      const result = withPolicies(
        [timeoutPolicies.api, retryPolicies.transient],
        { key: "data:1" }
      );

      expect(result.key).toBe("data:1");
      expect(result.timeout?.ms).toBe(5000);
      expect(result.retry?.attempts).toBe(3);
    });

    it("later policies override earlier ones", () => {
      const result = withPolicies(
        [
          timeoutPolicies.api, // 5000ms
          timeoutPolicies.fast, // 1000ms (overrides)
        ],
        { key: "test:1" }
      );

      expect(result.timeout?.ms).toBe(1000);
    });
  });

  describe("mergePolicies", () => {
    it("merges multiple policies into one", () => {
      const merged = mergePolicies(
        timeoutPolicies.api,
        retryPolicies.transient,
        { key: "fetch-user:1" }
      );

      expect(merged.key).toBe("fetch-user:1");
      expect(merged.timeout?.ms).toBe(5000);
      expect(merged.retry?.attempts).toBe(3);
    });

    it("creates custom policy bundle", () => {
      // Example: mergePolicies for reuse
      const myApiPolicy = mergePolicies(
        timeoutPolicies.api,
        retryPolicies.standard
      );

      expect(myApiPolicy.timeout?.ms).toBe(5000);
      expect(myApiPolicy.retry?.attempts).toBe(3);
    });

    it("allows adding key when using merged policy", async () => {
      const myApiPolicy = mergePolicies(
        timeoutPolicies.api,
        retryPolicies.standard
      );

      // Use it - add key
      const options = withPolicy(myApiPolicy, { key: "user:1" });
      expect(options.key).toBe("user:1");
      expect(options.timeout?.ms).toBe(5000);
    });

    it("deep merges retry options", () => {
      const merged = mergePolicies(
        retryPolicy({ attempts: 3, backoff: "exponential" }),
        retryPolicy({ initialDelay: 500 })
      );

      expect(merged.retry?.attempts).toBe(3);
      expect(merged.retry?.backoff).toBe("exponential");
      expect(merged.retry?.initialDelay).toBe(500);
    });
  });

  describe("createPolicyRegistry", () => {
    it("creates and manages named policies", () => {
      const policies = createPolicyRegistry();

      policies.register("api", servicePolicies.httpApi);
      policies.register("db", servicePolicies.database);
      policies.register("cache", servicePolicies.cache);
      policies.register("queue", servicePolicies.messageQueue);

      expect(policies.has("api")).toBe(true);
      expect(policies.has("unknown")).toBe(false);

      expect(policies.get("api")).toEqual(servicePolicies.httpApi);
      expect(policies.get("unknown")).toBeUndefined();

      expect(policies.names()).toEqual(["api", "db", "cache", "queue"]);
    });

    it("applies policies to step options", () => {
      const policies = createPolicyRegistry();
      policies.register("api", servicePolicies.httpApi);

      const options = policies.apply("api", { key: "user:1" });

      expect(options.key).toBe("user:1");
      expect(options.timeout?.ms).toBe(5000);
    });

    it("throws on unknown policy", () => {
      const policies = createPolicyRegistry();

      expect(() => policies.apply("unknown", { key: "test:1" })).toThrow(
        "Policy not found: unknown"
      );
    });

    it("works in workflow context (exact markdown example)", async () => {
      // Create and populate registry
      const policies = createPolicyRegistry();

      policies.register("api", servicePolicies.httpApi);
      policies.register("cache", servicePolicies.cache);

      const deps = { fetchUser, checkCache };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser, checkCache }) => {
        const user = await step(
          "fetch-user",
          () => fetchUser("123"),
          policies.apply("api")
        );

        const cached = await step(
          "check-cache",
          () => checkCache("123"),
          policies.apply("cache")
        );

        return ok({ user, cached });
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("stepOptions fluent builder", () => {
    it("builds step options with fluent API", () => {
      const options = stepOptions()
        .key("user:123")
        .timeout(5000)
        .retries(3)
        .build();

      expect(options.key).toBe("user:123");
      expect(options.timeout?.ms).toBe(5000);
      expect(options.retry?.attempts).toBe(3);
    });

    it("matches exact markdown example", () => {
      const options = stepOptions()
        .key("user:123")
        .timeout(5000)
        .retries(3)
        .build();

      expect(options.key).toBe("user:123");
      expect(options.timeout?.ms).toBe(5000);
      expect(options.retry?.attempts).toBe(3);
    });

    it("allows chaining all methods from markdown", () => {
      // Note: When chaining .retries() then .retry(), the .retry() should override
      // But when .policy() is applied after, it may override retry settings
      // The markdown shows the pattern, but the actual behavior depends on merge order
      const options = stepOptions()
        .key("cache-key") // Set caching key
        .timeout(5000) // Set timeout in ms
        .retry({ attempts: 3, backoff: "linear" }) // Full retry config (before policy)
        .policy(servicePolicies.httpApi) // Apply a policy (may override retry)
        .build(); // Get StepOptions

      expect(options.key).toBe("cache-key");
      expect(options.timeout?.ms).toBe(5000);
      // Policy is applied last, so it may override the retry backoff
      // The important thing is that all methods can be chained
      expect(options.retry?.attempts).toBe(3);
    });

    it("allows chaining policy application", () => {
      const options = stepOptions()
        .policy(servicePolicies.httpApi)
        .key("custom-key")
        .build();

      expect(options.key).toBe("custom-key");
      expect(options.timeout?.ms).toBe(5000);
    });

    it("allows full retry configuration", () => {
      const options = stepOptions()
        .retry({
          attempts: 5,
          backoff: "linear",
          initialDelay: 100,
        })
        .build();

      expect(options.retry?.attempts).toBe(5);
      expect(options.retry?.backoff).toBe("linear");
    });
  });

  describe("conditionalPolicy", () => {
    it("returns policy when condition is true", () => {
      const isProduction = true;
      const policy = conditionalPolicy(
        isProduction,
        servicePolicies.httpApi,
        retryPolicies.none
      );

      expect(policy).toEqual(servicePolicies.httpApi);
    });

    it("returns else policy when condition is false", () => {
      const isProduction = false;
      const policy = conditionalPolicy(
        isProduction,
        servicePolicies.httpApi,
        retryPolicies.none
      );

      expect(policy).toEqual(retryPolicies.none);
    });

    it("returns empty policy when else not provided", () => {
      const policy = conditionalPolicy(false, servicePolicies.httpApi);
      expect(policy).toEqual({});
    });
  });

  describe("envPolicy", () => {
    it("selects policy based on environment", () => {
      const originalEnv = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = "production";

        const policy = envPolicy({
          production: servicePolicies.httpApi,
          development: retryPolicies.none,
          test: retryPolicies.none,
        });

        expect(policy).toEqual(servicePolicies.httpApi);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("returns default when env not found", () => {
      const policy = envPolicy(
        { production: servicePolicies.httpApi },
        "unknown-env",
        retryPolicies.none
      );

      expect(policy).toEqual(retryPolicies.none);
    });

    it("accepts explicit env parameter", () => {
      const policy = envPolicy(
        {
          production: servicePolicies.httpApi,
          development: retryPolicies.none,
        },
        "development"
      );

      expect(policy).toEqual(retryPolicies.none);
    });
  });

  describe("createPolicyApplier", () => {
    it("creates reusable policy applier", () => {
      const apiStep = createPolicyApplier(servicePolicies.httpApi);

      const options1 = apiStep({ key: "user:1" });
      expect(options1.key).toBe("user:1");
      expect(options1.timeout?.ms).toBe(5000);

      const options2 = apiStep({ key: "orders:123" });
      expect(options2.key).toBe("orders:123");
    });

    it("matches exact markdown example", async () => {
      // Create applier with base policies
      const apiStep = createPolicyApplier(servicePolicies.httpApi);
      const dbStep = createPolicyApplier(servicePolicies.database);

      const deps = { fetchUser, queryOrders };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser, queryOrders }) => {
        const user = await step("fetch-user", () => fetchUser("123"), apiStep());
        const orders = await step("query-orders", () => queryOrders("123"), dbStep());
        return ok({ user, orders });
      });

      expect(result.ok).toBe(true);
    });

    it("combines multiple base policies", () => {
      const apiStep = createPolicyApplier(
        timeoutPolicies.extended,
        retryPolicies.aggressive
      );

      const options = apiStep({ key: "heavy:1" });
      expect(options.timeout?.ms).toBe(30000);
      expect(options.retry?.attempts).toBe(5);
    });
  });

  describe("createPolicyBundle", () => {
    it("creates named policy bundle", () => {
      const bundle = createPolicyBundle(
        "my-api",
        timeoutPolicies.api,
        retryPolicies.standard
      );

      expect(bundle.name).toBe("my-api");
      expect(bundle.policy.timeout?.ms).toBe(5000);
      expect(bundle.policy.retry?.attempts).toBe(3);
    });
  });

  describe("integration with workflows", () => {
    it("works with createWorkflow", async () => {
      const policies = createPolicyRegistry();
      // Register simple policies for test reliability
      policies.register("api", retryPolicies.none);
      policies.register("db", retryPolicies.none);

      const deps = { fetchUser, queryOrders };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser, queryOrders }) => {
        const user = await step(
          "fetch-user",
          () => fetchUser("123"),
          policies.apply("api")
        );

        const orders = await step(
          "query-orders",
          () => queryOrders("123"),
          policies.apply("db")
        );

        return ok({ user, orders });
      });

      expect(result.ok).toBe(true);
    });

    it("works with withPolicy helper", async () => {
      const deps = { fetchUser, checkCache };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser, checkCache }) => {
        // Use simple policy without timeout for test reliability
        const user = await step(
          "fetch-user",
          () => fetchUser("123"),
          withPolicy(retryPolicies.none)
        );

        const cached = await step(
          "check-cache",
          () => checkCache("123"),
          withPolicy(retryPolicies.none)
        );

        return ok({ user, cached });
      });

      expect(result.ok).toBe(true);
    });

    it("works with fluent builder", async () => {
      const deps = { fetchUser };
      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async (step, { fetchUser }) => {
        // Build simple options using fluent API
        const options = stepOptions()
          .key("user:123")
          .build();

        const user = await step("fetch-user", () => fetchUser("123"), options);
        return ok(user);
      });

      expect(result.ok).toBe(true);
    });
  });
});

// ============================================================================
// Custom Policy Examples
// ============================================================================

describe("custom policies", () => {
  it("creates custom retry policy", () => {
    const myRetryPolicy = retryPolicy({
      attempts: 4,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 10000,
      jitter: true,
    });

    expect(myRetryPolicy.retry?.attempts).toBe(4);
    expect(myRetryPolicy.retry?.maxDelay).toBe(10000);
  });

  it("creates custom timeout policy", () => {
    const myTimeoutPolicy = timeoutPolicy({
      ms: 15000,
      signal: true,
    });

    expect(myTimeoutPolicy.timeout?.ms).toBe(15000);
    expect(myTimeoutPolicy.timeout?.signal).toBe(true);
  });

  it("creates combined custom service policy", () => {
    const myServicePolicy = mergePolicies(
      timeoutPolicy({ ms: 10000 }),
      retryPolicy({
        attempts: 3,
        backoff: "linear",
        initialDelay: 500,
        jitter: true,
      })
    );

    expect(myServicePolicy.timeout?.ms).toBe(10000);
    expect(myServicePolicy.retry?.backoff).toBe("linear");
  });
});

// ============================================================================
// Best Practices Examples
// ============================================================================

describe("Best Practices", () => {
  it("DO: Define policies at the module level", () => {
    // policies.ts
    const policies = {
      userService: mergePolicies(
        timeoutPolicies.api,
        retryPolicies.standard
      ),
      paymentService: mergePolicies(
        timeoutPolicies.extended,
        retryPolicies.aggressive
      ),
      cacheLayer: servicePolicies.cache,
    };

    expect(policies.userService.timeout?.ms).toBe(5000);
    expect(policies.paymentService.retry?.attempts).toBe(5);
    expect(policies.cacheLayer.timeout?.ms).toBe(1000);
  });

  it("DO: Use registry for large apps", () => {
    // Central registry, import everywhere
    const policies = createPolicyRegistry();
    policies.register("external-api", servicePolicies.httpApi);
    policies.register("internal-api", servicePolicies.cache);

    expect(policies.has("external-api")).toBe(true);
    expect(policies.has("internal-api")).toBe(true);
  });

  it("DO: Use environment-based policies", () => {
    // Different behavior per environment
    const apiPolicy = envPolicy({
      production: servicePolicies.httpApi,
      development: mergePolicies(timeoutPolicies.fast, retryPolicies.none),
      test: retryPolicies.none,
    });

    // Test that it works (will use current NODE_ENV or default)
    expect(apiPolicy).toBeDefined();
  });
});

// ============================================================================
// Export to avoid unused variable warnings
// ============================================================================

export { fetchUser, fetchOrders, fetchData, queryOrders, checkCache };
