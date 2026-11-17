/**
 * Assert on the spans awaitly records, with no tracing SDK dependency here:
 * pass whatever your in-memory exporter collected
 * (`InMemorySpanExporter#getFinishedSpans()` from `@opentelemetry/sdk-trace-base`).
 */

/** The parts of an SDK `ReadableSpan` these helpers read. */
export interface RecordedSpan {
  name: string;
  attributes: Readonly<Record<string, unknown>>;
  events?: ReadonlyArray<{ name: string; attributes?: Readonly<Record<string, unknown>> | undefined }>;
  status?: { code: number };
  startTime?: readonly [number, number];
  spanContext(): { spanId: string };
  /** SDK 2.x. */
  parentSpanContext?: { spanId: string } | undefined;
  /** SDK 1.x. */
  parentSpanId?: string | undefined;
}

export interface SpanNode {
  name: string;
  attributes: Readonly<Record<string, unknown>>;
  events: ReadonlyArray<{ name: string; attributes: Readonly<Record<string, unknown>> }>;
  /** OpenTelemetry status: awaitly leaves success `unset`. */
  status: "unset" | "ok" | "error";
  children: SpanNode[];
}

const STATUS = ["unset", "ok", "error"] as const;

const startOf = (span: RecordedSpan) => (span.startTime ? span.startTime[0] * 1e9 + span.startTime[1] : 0);

/**
 * Nest finished spans by parent, children in start order. Spans whose parent
 * isn't in the list (your HTTP span, say) become roots.
 */
export function spanTree(spans: readonly RecordedSpan[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  const sorted = [...spans].sort((a, b) => startOf(a) - startOf(b));
  for (const span of sorted) {
    nodes.set(span.spanContext().spanId, {
      name: span.name,
      attributes: span.attributes,
      events: (span.events ?? []).map((e) => ({ name: e.name, attributes: e.attributes ?? {} })),
      status: STATUS[span.status?.code ?? 0] ?? "unset",
      children: [],
    });
  }
  const roots: SpanNode[] = [];
  for (const span of sorted) {
    const node = nodes.get(span.spanContext().spanId)!;
    const parentId = span.parentSpanContext?.spanId ?? span.parentSpanId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/**
 * The span tree as indented text, for `toMatchInlineSnapshot`. Errors show
 * their `error.type`, span events show as `· name`.
 *
 * @example
 * expect(formatSpanTree(exporter.getFinishedSpans())).toMatchInlineSnapshot(`
 *   "run checkout
 *     step load-user
 *     step charge ✗ CARD_DECLINED"
 * `);
 */
export function formatSpanTree(spans: readonly RecordedSpan[]): string {
  const lines: string[] = [];
  const visit = (node: SpanNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const errorType = node.attributes["error.type"];
    lines.push(`${pad}${node.name}${node.status === "error" ? ` ✗ ${String(errorType ?? "error")}` : ""}`);
    for (const event of node.events) {
      if (event.name !== "exception") lines.push(`${pad}  · ${event.name}`);
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of spanTree(spans)) visit(root, 0);
  return lines.join("\n");
}
