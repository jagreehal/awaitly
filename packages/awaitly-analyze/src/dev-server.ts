/**
 * awaitly dev server — the live workflow inspector.
 *
 * Serves the static workflow diagram for a file, watches it for changes, and
 * accepts runtime event streams from running workflows (via POST /events).
 * Each run's trace is overlaid on the static graph — the XState-inspect
 * experience: the whole shape is always visible, live runs paint their path.
 *
 * Zero dependencies beyond node:http — live updates use Server-Sent Events,
 * so there is no WebSocket server to bring your own.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { watch, type FSWatcher } from "node:fs";

import type { WorkflowEvent } from "awaitly/workflow";

import { analyzeWorkflowFile } from "./static-analyzer";
import { renderStaticMermaid, renderStaticMermaidWithTrace } from "./output/mermaid";
import { traceFromEvents } from "./trace";
import type { StaticWorkflowIR } from "./types";

type AnyEvent = WorkflowEvent<unknown, unknown> & { workflowId: string };

export interface DevServerOptions {
  /** Workflow .ts file to analyze and watch */
  file: string;
  /** Port to listen on (default 4747) */
  port?: number;
  /** Called after each (re)analysis with the number of workflows found */
  onAnalyze?: (workflowCount: number) => void;
}

export interface DevServer {
  /** The underlying HTTP server (already listening) */
  server: Server;
  /** Resolved port */
  port: number;
  /** Stop watching and close the server */
  close: () => Promise<void>;
}

interface RunRecord {
  workflowId: string;
  workflowName?: string;
  events: AnyEvent[];
  startedAt: number;
}

/** Serialize current state for the page: diagrams per workflow, runs, traces. */
function buildState(irs: StaticWorkflowIR[], runs: Map<string, RunRecord>) {
  const workflows = irs.map((ir) => ({
    name: ir.root.workflowName,
    mermaid: renderStaticMermaid(ir),
    warnings: ir.metadata.warnings,
  }));

  const runList = [...runs.values()].map((run) => {
    const trace = traceFromEvents(run.events);
    const ir =
      irs.find((candidate) => candidate.root.workflowName === run.workflowName) ?? irs[0];
    const overlay = ir ? renderStaticMermaidWithTrace(ir, trace) : undefined;
    return {
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      startedAt: run.startedAt,
      eventCount: run.events.length,
      trace,
      mermaid: overlay?.mermaid,
      unmatched: overlay?.unmatched ?? [],
    };
  });

  return { workflows, runs: runList };
}

/** Max accepted request body (1 MiB) — event batches are small. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Max retained runs — oldest evicted beyond this. */
const MAX_RUNS = 50;

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new BodyTooLargeError("request body exceeds 1 MiB"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const port = options.port ?? 4747;
  let irs: StaticWorkflowIR[] = [];
  const runs = new Map<string, RunRecord>();
  const sseClients = new Set<ServerResponse>();

  const analyzeNow = () => {
    try {
      irs = analyzeWorkflowFile(options.file);
      options.onAnalyze?.(irs.length);
    } catch (error) {
      // Keep serving the last good analysis; surface the error to clients.
      broadcast({ type: "analyze_error", message: String(error) });
      return;
    }
    broadcast({ type: "state", state: buildState(irs, runs) });
  };

  const broadcast = (payload: unknown) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) client.write(frame);
  };

  analyzeNow();

  // ponytail: fs.watch on one file; a globbing multi-file watcher when needed
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(options.file, () => analyzeNow());
  } catch {
    // File watching is best-effort (e.g. networked filesystems).
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  // The server binds loopback only, but browsers can still be tricked into
  // reaching it (DNS rebinding: a hostile page's domain resolving to
  // 127.0.0.1; CSRF: cross-origin form posts). Host allowlisting closes
  // rebinding for every endpoint; Origin + Content-Type checks close CSRF
  // on the mutating one.
  const isLocalHostHeader = (host: string | undefined, boundPort: number): boolean => {
    if (!host) return false;
    return (
      host === `localhost:${boundPort}` ||
      host === `127.0.0.1:${boundPort}` ||
      host === `[::1]:${boundPort}`
    );
  };

  const isLocalOrigin = (origin: string | undefined, boundPort: number): boolean => {
    // Non-browser clients (devEvents via Node fetch) send no Origin — allowed.
    if (origin === undefined) return true;
    return (
      origin === `http://localhost:${boundPort}` ||
      origin === `http://127.0.0.1:${boundPort}` ||
      origin === `http://[::1]:${boundPort}`
    );
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const boundPort = (() => {
      const address = server.address();
      return typeof address === "object" && address ? address.port : port;
    })();

    if (!isLocalHostHeader(req.headers.host, boundPort)) {
      res.writeHead(421);
      res.end("misdirected request");
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${boundPort}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DEV_PAGE);
      return;
    }

    if (req.method === "GET" && url.pathname === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildState(irs, runs)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "state", state: buildState(irs, runs) })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/events") {
      if (!isLocalOrigin(req.headers.origin, boundPort)) {
        res.writeHead(403);
        res.end("cross-origin posts are not accepted");
        return;
      }
      if (!req.headers["content-type"]?.includes("application/json")) {
        res.writeHead(415);
        res.end("content-type must be application/json");
        return;
      }
      try {
        const body = await readBody(req);
        const incoming = JSON.parse(body) as AnyEvent | AnyEvent[];
        const events = Array.isArray(incoming) ? incoming : [incoming];
        for (const event of events) {
          if (!event || typeof event.workflowId !== "string") continue;
          let run = runs.get(event.workflowId);
          if (!run) {
            run = {
              workflowId: event.workflowId,
              workflowName: (event as { workflowName?: string }).workflowName,
              events: [],
              startedAt: Date.now(),
            };
            runs.set(event.workflowId, run);
            // Evict oldest runs so an event flood can't exhaust memory.
            while (runs.size > MAX_RUNS) {
              const oldest = runs.keys().next().value;
              if (oldest === undefined) break;
              runs.delete(oldest);
            }
          }
          run.workflowName ??= (event as { workflowName?: string }).workflowName;
          run.events.push(event);
        }
        broadcast({ type: "state", state: buildState(irs, runs) });
        res.writeHead(204);
        res.end();
      } catch (error) {
        const status = error instanceof BodyTooLargeError ? 413 : 400;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    res.writeHead(404);
    res.end("not found");
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: the inspector serves workflow source structure and
    // accepts event posts — it must never be reachable from the network.
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        watcher?.close();
        for (const client of sseClients) client.end();
        sseClients.clear();
        server.close(() => resolve());
      }),
  };
}

/**
 * The inspector page. Self-contained except the Mermaid CDN script; renders
 * the static graph per workflow, a run list, and repaints on SSE updates.
 */
const DEV_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>awaitly dev</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: "dark" });

  let state = { workflows: [], runs: [] };
  let selectedRun = null;

  const $ = (id) => document.getElementById(id);

  async function render() {
    const runBar = $("runs");
    runBar.innerHTML = "";
    const liveBtn = document.createElement("button");
    liveBtn.textContent = "Static graph";
    liveBtn.className = selectedRun === null ? "active" : "";
    liveBtn.onclick = () => { selectedRun = null; render(); };
    runBar.appendChild(liveBtn);
    for (const run of state.runs) {
      const b = document.createElement("button");
      const label = (run.workflowName ?? run.workflowId).slice(0, 24);
      b.textContent = label + " (" + run.eventCount + " ev)";
      b.className = selectedRun === run.workflowId ? "active" : "";
      b.onclick = () => { selectedRun = run.workflowId; render(); };
      runBar.appendChild(b);
    }

    const container = $("diagrams");
    container.innerHTML = "";
    const run = state.runs.find((r) => r.workflowId === selectedRun);
    const sources = run && run.mermaid
      ? [{ name: (run.workflowName ?? run.workflowId) + " — run", mermaid: run.mermaid }]
      : state.workflows;

    for (const wf of sources) {
      const section = document.createElement("section");
      const h = document.createElement("h2");
      h.textContent = wf.name;
      section.appendChild(h);
      if (wf.warnings && wf.warnings.length > 0) {
        const warn = document.createElement("div");
        warn.className = "warnings";
        warn.textContent = wf.warnings.map((w) => w.code + ": " + w.message).join("\\n");
        section.appendChild(warn);
      }
      const div = document.createElement("div");
      div.className = "diagram";
      section.appendChild(div);
      container.appendChild(section);
      try {
        const { svg } = await mermaid.render("m" + Math.random().toString(36).slice(2), wf.mermaid);
        div.innerHTML = svg;
      } catch (e) {
        div.textContent = "mermaid render error: " + e;
      }
    }

    if (run) {
      const detail = document.createElement("pre");
      detail.className = "trace";
      detail.textContent = JSON.stringify(run.trace, null, 2);
      container.appendChild(detail);
      if (run.unmatched.length > 0) {
        const um = document.createElement("div");
        um.className = "warnings";
        um.textContent = "Unmatched runtime ids (not in static graph): " + run.unmatched.join(", ");
        container.appendChild(um);
      }
    }
  }

  const sse = new EventSource("/sse");
  sse.onmessage = (msg) => {
    const payload = JSON.parse(msg.data);
    if (payload.type === "state") { state = payload.state; render(); }
    if (payload.type === "analyze_error") {
      const pre = document.createElement("pre");
      pre.className = "warnings";
      pre.textContent = payload.message;
      $("diagrams").replaceChildren(pre);
    }
  };
</script>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #e2e8f0; }
  header { padding: 12px 20px; border-bottom: 1px solid #1e293b; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; }
  header span { color: #64748b; font-size: 12px; }
  #runs { padding: 10px 20px; display: flex; gap: 8px; flex-wrap: wrap; }
  #runs button { background: #111a2e; color: #cbd5e1; border: 1px solid #1e293b; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
  #runs button.active { border-color: #38bdf8; color: #e0f2fe; }
  #diagrams { padding: 10px 20px 40px; }
  section h2 { font-size: 14px; color: #94a3b8; }
  .diagram { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; overflow-x: auto; }
  .warnings { color: #fbbf24; font-size: 12px; white-space: pre-wrap; margin: 8px 0; }
  .trace { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-size: 11px; overflow-x: auto; }
</style>
</head>
<body>
<header><h1>awaitly dev</h1><span>static graph + live run traces</span></header>
<div id="runs"></div>
<div id="diagrams"></div>
</body>
</html>
`;
