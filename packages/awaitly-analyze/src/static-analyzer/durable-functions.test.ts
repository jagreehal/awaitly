/**
 * AWS Lambda durable functions written with the native SDK are diagrammed like
 * awaitly workflows: withDurableExecution(handler) is discovered, and calls on
 * its DurableContext become steps, waits, callbacks, invokes, parallel
 * branches, map loops, and child contexts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import { renderStaticMermaid } from "../output/mermaid";
import type {
  StaticFlowNode,
  StaticLoopNode,
  StaticParallelNode,
  StaticSequenceNode,
  StaticStepNode,
  StaticWorkflowIR,
} from "../types";

const ORDER_SOURCE = `
import { withDurableExecution, type DurableContext } from "@aws/durable-execution-sdk-js";

declare function getUser(id: string): Promise<{ id: string; vip: boolean }>;
declare function charge(id: string): Promise<{ receipt: string }>;
declare function notify(id: string): Promise<void>;
declare function createPreferences(id: string): Promise<void>;
declare function createWelcome(id: string): Promise<void>;
declare function processItem(item: string): Promise<void>;

export const orderHandler = withDurableExecution(async (event: { userId: string; items: string[] }, context: DurableContext) => {
  const user = await context.step("getUser", async () => getUser(event.userId));
  context.logger.info("loaded user");
  if (user.vip) {
    await context.step("charge", async () => charge(user.id));
  } else {
    await context.wait("coolingOff", { days: 1, hours: 2 });
  }
  const approval = await context.waitForCallback(
    "approve",
    async (callbackId) => notify(callbackId),
    { timeout: { hours: 24 } }
  );
  await context.invoke("ship", "arn:aws:lambda:eu-north-1:123:function:ship:live", { id: user.id });
  await context.parallel("profile", [
    async (ctx) => ctx.step("prefs", async () => createPreferences(user.id)),
    { name: "welcome", func: async (ctx) => ctx.step("welcome", async () => createWelcome(user.id)) },
  ]);
  await context.map("items", event.items, async (ctx, item) => ctx.step("process", async () => processItem(item)));
  await context.runInChildContext("audit", async (child) => {
    await child.step("record", async () => "ok");
    await child.wait({ seconds: 5 });
  });
  return approval;
});
`;

const flatten = (nodes: StaticFlowNode[]): StaticFlowNode[] =>
  nodes.flatMap((node) => [
    node,
    ...flatten(
      "children" in node && Array.isArray(node.children)
        ? node.children
        : node.type === "loop"
          ? node.body
          : node.type === "conditional"
            ? [...node.consequent, ...(node.alternate ?? [])]
            : []
    ),
  ]);

const nodesOf = (ir: StaticWorkflowIR) => flatten(ir.root.children);
const stepNamed = (ir: StaticWorkflowIR, name: string) =>
  nodesOf(ir).find((n): n is StaticStepNode => n.type === "step" && n.name === name);

describe("withDurableExecution discovery", () => {
  beforeEach(() => resetIdCounter());

  it("discovers a handler named after its binding", () => {
    const [ir, ...rest] = analyzeWorkflowSource(ORDER_SOURCE, undefined, { assumeImported: false });

    expect(rest).toHaveLength(0);
    expect(ir?.root.workflowName).toBe("orderHandler");
    expect(ir?.root.source).toBe("withDurableExecution");
  });

  it("discovers the awaitly-durable-lambda drop-in, aliases, and namespace imports", () => {
    const source = `
      import { withDurableExecution as durable } from "awaitly-durable-lambda";
      import * as sdk from "@aws/durable-execution-sdk-js";
      export const a = durable(async (event, context) => context.step("one", async () => 1));
      export const b = sdk.withDurableExecution(async (event, context) => context.step("two", async () => 2));
    `;
    const names = analyzeWorkflowSource(source, undefined, { assumeImported: false }).map((ir) => ir.root.workflowName);

    expect(names).toEqual(["a", "b"]);
  });

  it("ignores a local function that happens to be called withDurableExecution", () => {
    const source = `
      function withDurableExecution(fn: unknown) { return fn; }
      export const h = withDurableExecution(async (event: unknown, context: { step: Function }) => context.step("x"));
    `;
    expect(analyzeWorkflowSource(source, undefined, { assumeImported: false })).toHaveLength(0);
  });
});

describe("durable operations", () => {
  beforeEach(() => resetIdCounter());

  const analyze = () => analyzeWorkflowSource(ORDER_SOURCE, undefined, { assumeImported: false })[0]!;

  it("maps steps to their function, waits to durations, callbacks to timeouts, and invokes to targets", () => {
    const ir = analyze();

    expect(stepNamed(ir, "getUser")).toMatchObject({ stepId: "getUser", callee: "context.step", depSource: "getUser" });
    expect(stepNamed(ir, "coolingOff")).toMatchObject({ callee: "context.wait", sleepDuration: "1d2h" });
    expect(stepNamed(ir, "approve")).toMatchObject({ callee: "context.waitForCallback", timeout: { ms: 86_400_000 } });
    expect(stepNamed(ir, "ship")).toMatchObject({
      callee: "context.invoke",
      depSource: "arn:aws:lambda:eu-north-1:123:function:ship:live",
    });
  });

  it("keeps control flow around operations", () => {
    const conditional = nodesOf(analyze()).find((n) => n.type === "conditional");

    expect(conditional).toBeDefined();
  });

  it("maps parallel to branches, map to a loop, and runInChildContext to a named group", () => {
    const nodes = nodesOf(analyze());

    const parallel = nodes.find((n): n is StaticParallelNode => n.type === "parallel");
    expect(parallel).toMatchObject({ name: "profile", callee: "context.parallel" });
    expect(parallel?.children.map((c) => c.name)).toEqual(["prefs", "welcome"]);

    const loop = nodes.find((n): n is StaticLoopNode => n.type === "loop");
    expect(loop).toMatchObject({ name: "items", loopType: "map", iterSource: "event.items" });
    expect(loop?.body.map((n) => n.name)).toEqual(["process"]);

    const audit = nodes.find((n): n is StaticSequenceNode => n.type === "sequence" && n.name === "audit");
    expect(audit?.children.map((n) => n.name)).toEqual(["record", "wait"]);
  });

  it("maps context.promise combinators", () => {
    const source = `
      import { withDurableExecution } from "@aws/durable-execution-sdk-js";
      export const h = withDurableExecution(async (event, context) => {
        await context.promise.all("both", [context.wait({ seconds: 1 }), context.step("x", async () => 1)]);
        await context.promise.race([context.wait({ minutes: 5 }), context.step("y", async () => 2)]);
      });
    `;
    const nodes = nodesOf(analyzeWorkflowSource(source, undefined, { assumeImported: false })[0]!);

    expect(nodes.find((n) => n.type === "parallel")).toMatchObject({ name: "both", callee: "context.promise.all" });
    expect(nodes.find((n) => n.type === "race")).toMatchObject({ callee: "context.promise.race" });
  });

  it("leaves nothing unanalysed and is not confused by non-operation calls", () => {
    const nodes = nodesOf(analyze());

    expect(nodes.filter((n) => n.type === "unknown")).toEqual([]);
    expect(nodes.some((n) => n.name === "info")).toBe(false);
  });

  it("renders a Mermaid diagram that labels each operation", () => {
    const mermaid = renderStaticMermaid(analyze());

    expect(mermaid).toContain("coolingOff (Wait: 1d2h)");
    expect(mermaid).toContain("approve (Callback, timeout 1d)");
    expect(mermaid).toContain("ship (Invoke: arn:aws:lambda:eu-north-1:123:function:ship:live)");
  });
});

describe("early exits", () => {
  beforeEach(() => resetIdCounter());

  const SOURCE = `
    import { withDurableExecution } from "awaitly-durable-lambda";
    declare function createAccount(email: string): Promise<{ ok: boolean }>;
    declare function remind(email: string): Promise<void>;
    export const signup = withDurableExecution(async (event: { email: string }, context) => {
      const account = await context.step("createAccount", async () => createAccount(event.email));
      if (!account.ok) return account;
      const verified = await context.waitForCallback("verify", async () => {}, { timeout: { days: 2 } });
      if (!verified) {
        await context.step("remind", async () => remind(event.email));
        return "unverified";
      }
      await context.wait("trial", { days: 14 });
      return "active";
    });
  `;

  it("marks branches that return as exits, even with no operation in them", () => {
    const ir = analyzeWorkflowSource(SOURCE, undefined, { assumeImported: false })[0]!;
    const conditionals = nodesOf(ir).filter((n) => n.type === "conditional");

    expect(conditionals.map((c) => [c.condition, c.consequentExits, c.consequent.length])).toEqual([
      ["!account.ok", true, 0],
      ["!verified", true, 1],
    ]);
  });

  it("draws exiting branches to End instead of the next operation", () => {
    const mermaid = renderStaticMermaid(analyzeWorkflowSource(SOURCE, undefined, { assumeImported: false })[0]!);
    const lines = mermaid.split("\n").map((l) => l.trim());

    // Anchor the generated ids to their labels before asserting on edges.
    expect(lines).toEqual(
      expect.arrayContaining(['decision_2{"!account.ok"}', 'step_5["remind"]', 'step_6["trial (Wait: 14d)"]'])
    );
    expect(lines).toContain("decision_2 -->|true| end_node");
    expect(lines).toContain("step_5 --> end_node");
    expect(lines).not.toContain("step_5 --> step_6");
  });
});

describe("invoke targets", () => {
  beforeEach(() => resetIdCounter());

  const invokes = (body: string) => {
    const source = `
      import { withDurableExecution, durableFunction } from "awaitly-durable-lambda";
      declare const paymentHandler: any;
      const payments = durableFunction<typeof paymentHandler>("payments:live");
      const target: string = "audit:live";
      export const h = withDurableExecution(async (event: { id: string }, context) => {
        ${body}
      });
    `;
    const ir = analyzeWorkflowSource(source, undefined, { assumeImported: false })[0]!;
    return nodesOf(ir)
      .filter((n): n is StaticStepNode => n.type === "step" && n.callee === "context.invoke")
      .map((n) => [n.name, n.depSource]);
  };

  it.each([
    ['context.invoke("pay", payments, event)', ["pay", "payments"]],
    ['context.invoke("pay", payments)', ["pay", "payments"]],
    ["context.invoke(payments, event)", ["invoke", "payments"]],
    ['context.invoke("audit", target, event)', ["audit", "target"]],
    ['context.invoke("arn:aws:lambda:eu-north-1:1:function:f:live", event)', ["invoke", "arn:aws:lambda:eu-north-1:1:function:f:live"]],
    ['context.invoke("arn:aws:lambda:eu-north-1:1:function:f:live", { id: event.id })', ["invoke", "arn:aws:lambda:eu-north-1:1:function:f:live"]],
    ['context.invoke("ship", process.env.SHIP_ARN!, event)', ["ship", "process.env.SHIP_ARN"]],
  ])("%s", (call, expected) => {
    expect(invokes(`await ${call};`)).toEqual([expected]);
  });
});

describe("handlers wrapped in validateEvent", () => {
  beforeEach(() => resetIdCounter());

  it.each([
    ["named", `import { validateEvent, withDurableExecution } from "awaitly-durable-lambda";`, "withDurableExecution(validateEvent"],
    ["aliased", `import { validateEvent as validated, withDurableExecution } from "awaitly-durable-lambda";`, "withDurableExecution(validated"],
    ["namespaced", `import * as durable from "awaitly-durable-lambda";`, "durable.withDurableExecution(durable.validateEvent"],
  ])("discovers and analyses a %s wrapper", (_case, imports, call) => {
    const source = `
      ${imports}
      declare const Order: any;
      export const order = ${call}(Order, async (event, context) => {
        await context.step("charge", async () => event.amount);
        await context.wait("cooldown", { minutes: 1 });
      }));
    `;
    const [ir, ...rest] = analyzeWorkflowSource(source, undefined, { assumeImported: false });

    expect(rest).toHaveLength(0);
    expect(ir?.root.workflowName).toBe("order");
    expect(nodesOf(ir!).filter((n) => n.type === "step").map((n) => n.name)).toEqual(["charge", "cooldown"]);
  });

  it.each([
    [
      "a parameter shadows the named import",
      `import { validateEvent, withDurableExecution } from "awaitly-durable-lambda";
       export function make(validateEvent: (s: unknown, h: unknown) => any) {
         return withDurableExecution(validateEvent(Order, async (event, context) => context.step("x", async () => 1)));
       }`,
    ],
    [
      "a local declaration shadows the namespace",
      `import * as durable from "awaitly-durable-lambda";
       import { withDurableExecution } from "@aws/durable-execution-sdk-js";
       export function make() {
         const durable = { validateEvent: (s: unknown, h: unknown) => async () => null };
         return withDurableExecution(durable.validateEvent(Order, async (event, context) => context.step("x", async () => 1)));
       }`,
    ],
  ])("does not unwrap when %s", (_case, source) => {
    expect(analyzeWorkflowSource(`declare const Order: any;\n${source}`, undefined, { assumeImported: false })).toHaveLength(0);
  });

  it("does not unwrap a validateEvent from another module", () => {
    const source = `
      import { withDurableExecution } from "awaitly-durable-lambda";
      import { validateEvent } from "./elsewhere";
      export const order = withDurableExecution(validateEvent(Order, async (event, context) => context.step("x", async () => 1)));
    `;
    expect(analyzeWorkflowSource(source, undefined, { assumeImported: false })).toHaveLength(0);
  });
});

