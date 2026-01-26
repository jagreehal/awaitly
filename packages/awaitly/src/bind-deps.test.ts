/**
 * Tests for bind-deps.ts - Partial application utility for fn(args, deps) pattern
 */
import { describe, it, expect } from "vitest";
import { bindDeps } from "./bind-deps";
import { ok, err, type AsyncResult } from "./core";

describe("bindDeps()", () => {
  describe("basic functionality", () => {
    it("binds deps first, then accepts args", () => {
      const greet = (args: { name: string }, deps: { prefix: string }) =>
        `${deps.prefix} ${args.name}`;

      const greetWithHello = bindDeps(greet)({ prefix: "Hello" });

      expect(greetWithHello({ name: "Alice" })).toBe("Hello Alice");
      expect(greetWithHello({ name: "Bob" })).toBe("Hello Bob");
    });

    it("allows binding same function with different deps", () => {
      const greet = (args: { name: string }, deps: { prefix: string }) =>
        `${deps.prefix} ${args.name}`;

      const greetHello = bindDeps(greet)({ prefix: "Hello" });
      const greetHi = bindDeps(greet)({ prefix: "Hi" });

      expect(greetHello({ name: "Alice" })).toBe("Hello Alice");
      expect(greetHi({ name: "Alice" })).toBe("Hi Alice");
    });
  });

  describe("type inference preservation", () => {
    it("infers Args type without annotations", () => {
      const fn = (args: { id: number; name: string }, _deps: { log: boolean }) =>
        args.name;

      const bound = bindDeps(fn)({ log: true });

      // TypeScript ensures args must match { id: number; name: string }
      const result = bound({ id: 1, name: "test" });
      expect(result).toBe("test");
    });

    it("infers Deps type without annotations", () => {
      const fn = (
        args: { value: number },
        deps: { multiplier: number; offset: number }
      ) => args.value * deps.multiplier + deps.offset;

      // TypeScript ensures deps must match { multiplier: number; offset: number }
      const bound = bindDeps(fn)({ multiplier: 2, offset: 10 });

      expect(bound({ value: 5 })).toBe(20);
    });

    it("infers Out type without annotations", () => {
      const fn = (args: { items: string[] }, deps: { separator: string }) =>
        args.items.join(deps.separator);

      const bound = bindDeps(fn)({ separator: ", " });

      // TypeScript infers return type as string
      const result: string = bound({ items: ["a", "b", "c"] });
      expect(result).toBe("a, b, c");
    });
  });

  describe("sync functions", () => {
    it("handles sync functions returning primitives", () => {
      const add = (args: { a: number; b: number }, deps: { base: number }) =>
        deps.base + args.a + args.b;

      const addWithBase = bindDeps(add)({ base: 100 });

      expect(addWithBase({ a: 1, b: 2 })).toBe(103);
    });

    it("handles sync functions returning objects", () => {
      const createUser = (
        args: { name: string },
        deps: { idGenerator: () => string }
      ) => ({
        id: deps.idGenerator(),
        name: args.name,
      });

      let counter = 0;
      const bound = bindDeps(createUser)({ idGenerator: () => `id-${++counter}` });

      expect(bound({ name: "Alice" })).toEqual({ id: "id-1", name: "Alice" });
      expect(bound({ name: "Bob" })).toEqual({ id: "id-2", name: "Bob" });
    });
  });

  describe("async functions", () => {
    it("handles async functions", async () => {
      const fetchUser = async (
        args: { id: string },
        deps: { db: { find: (id: string) => Promise<{ name: string }> } }
      ) => {
        return deps.db.find(args.id);
      };

      const mockDb = {
        find: async (id: string) => ({ name: `User ${id}` }),
      };

      const bound = bindDeps(fetchUser)({ db: mockDb });

      const user = await bound({ id: "123" });
      expect(user).toEqual({ name: "User 123" });
    });

    it("handles async functions with delays", async () => {
      const delayedGreet = async (
        args: { name: string },
        deps: { delay: number }
      ) => {
        await new Promise((resolve) => setTimeout(resolve, deps.delay));
        return `Hello ${args.name}`;
      };

      const bound = bindDeps(delayedGreet)({ delay: 10 });

      const result = await bound({ name: "World" });
      expect(result).toBe("Hello World");
    });
  });

  describe("Result-returning functions", () => {
    it("handles functions returning Result", () => {
      const parseNumber = (
        args: { input: string },
        deps: { strict: boolean }
      ): { ok: true; value: number } | { ok: false; error: "PARSE_ERROR" } => {
        const num = Number(args.input);
        if (deps.strict && isNaN(num)) {
          return { ok: false, error: "PARSE_ERROR" };
        }
        return { ok: true, value: isNaN(num) ? 0 : num };
      };

      const strictParse = bindDeps(parseNumber)({ strict: true });
      const looseParse = bindDeps(parseNumber)({ strict: false });

      expect(strictParse({ input: "42" })).toEqual({ ok: true, value: 42 });
      expect(strictParse({ input: "abc" })).toEqual({
        ok: false,
        error: "PARSE_ERROR",
      });
      expect(looseParse({ input: "abc" })).toEqual({ ok: true, value: 0 });
    });

    it("handles functions returning AsyncResult", async () => {
      const getUser = async (
        args: { id: string },
        deps: { db: Map<string, { name: string }> }
      ): AsyncResult<{ name: string }, "NOT_FOUND"> => {
        const user = deps.db.get(args.id);
        return user ? ok(user) : err("NOT_FOUND");
      };

      const db = new Map([["1", { name: "Alice" }]]);
      const bound = bindDeps(getUser)({ db });

      const found = await bound({ id: "1" });
      expect(found).toEqual({ ok: true, value: { name: "Alice" } });

      const notFound = await bound({ id: "999" });
      expect(notFound).toEqual({ ok: false, error: "NOT_FOUND" });
    });
  });

  describe("complex object types", () => {
    it("handles complex args objects", () => {
      type ComplexArgs = {
        user: { id: string; profile: { name: string; age: number } };
        options: { verbose: boolean; format: "json" | "xml" };
      };

      const serialize = (args: ComplexArgs, deps: { pretty: boolean }) =>
        deps.pretty
          ? JSON.stringify(args.user, null, 2)
          : JSON.stringify(args.user);

      const prettySerialize = bindDeps(serialize)({ pretty: true });

      const result = prettySerialize({
        user: { id: "1", profile: { name: "Alice", age: 30 } },
        options: { verbose: true, format: "json" },
      });

      expect(result).toContain("\n"); // Pretty printed has newlines
    });

    it("handles complex deps objects", () => {
      type ComplexDeps = {
        logger: { info: (msg: string) => void; error: (msg: string) => void };
        config: { timeout: number; retries: number };
        cache: Map<string, unknown>;
      };

      const messages: string[] = [];

      const process = (args: { data: string }, deps: ComplexDeps) => {
        deps.logger.info(`Processing: ${args.data}`);
        deps.cache.set("last", args.data);
        return `Done: ${args.data}`;
      };

      const cache = new Map();
      const bound = bindDeps(process)({
        logger: {
          info: (msg) => messages.push(`INFO: ${msg}`),
          error: (msg) => messages.push(`ERROR: ${msg}`),
        },
        config: { timeout: 5000, retries: 3 },
        cache,
      });

      const result = bound({ data: "test-data" });

      expect(result).toBe("Done: test-data");
      expect(messages).toEqual(["INFO: Processing: test-data"]);
      expect(cache.get("last")).toBe("test-data");
    });
  });

  describe("empty args object", () => {
    it("handles empty args object", () => {
      const getTimestamp = (_: Record<string, never>, deps: { now: () => number }) => deps.now();

      let time = 1000;
      const bound = bindDeps(getTimestamp)({ now: () => time++ });

      expect(bound({})).toBe(1000);
      expect(bound({})).toBe(1001);
    });

    it("handles Record<string, never> style empty args", () => {
      const healthCheck = (
        args: Record<string, never>,
        deps: { status: string }
      ) => deps.status;

      const bound = bindDeps(healthCheck)({ status: "healthy" });

      expect(bound({} as Record<string, never>)).toBe("healthy");
    });
  });

  describe("composition patterns", () => {
    it("supports creating multiple bound functions from same base", () => {
      type SendFn = (to: string, msg: string) => Promise<void>;

      const notify = async (
        args: { userId: string; message: string },
        deps: { send: SendFn; channel: string }
      ) => {
        await deps.send(`${deps.channel}:${args.userId}`, args.message);
        return { sent: true, channel: deps.channel };
      };

      const sends: Array<{ to: string; msg: string }> = [];
      const mockSend: SendFn = async (to, msg) => {
        sends.push({ to, msg });
      };

      const notifySlack = bindDeps(notify)({ send: mockSend, channel: "slack" });
      const notifyEmail = bindDeps(notify)({ send: mockSend, channel: "email" });
      const notifySms = bindDeps(notify)({ send: mockSend, channel: "sms" });

      // All three are independent bound functions
      expect(typeof notifySlack).toBe("function");
      expect(typeof notifyEmail).toBe("function");
      expect(typeof notifySms).toBe("function");
    });

    it("bound functions are independent", async () => {
      const counter = (args: { add: number }, deps: { multiplier: number }) =>
        args.add * deps.multiplier;

      const double = bindDeps(counter)({ multiplier: 2 });
      const triple = bindDeps(counter)({ multiplier: 3 });

      // Interleaved calls don't affect each other
      expect(double({ add: 5 })).toBe(10);
      expect(triple({ add: 5 })).toBe(15);
      expect(double({ add: 3 })).toBe(6);
      expect(triple({ add: 3 })).toBe(9);
    });
  });
});
