/**
 * Development Server
 *
 * Provides a local HTTP server with WebSocket support for:
 * - Serving the HTML visualizer
 * - Live streaming workflow events
 * - Time-travel control from the browser
 * - Performance data broadcasting
 *
 * The `ws` package is an optional peer dependency.
 * Install it with: npm install ws
 */

import type { Server as HTTPServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import type { WorkflowEvent } from "../core";
import type { WorkflowIR, ServerMessage, WebVisualizerMessage, HeatmapData } from "./types";
import { createTimeTravelController, type TimeTravelController } from "./time-travel";
import { createPerformanceAnalyzer, type PerformanceAnalyzer } from "./performance-analyzer";
import { renderToHTML } from "./renderers/html";

// =============================================================================
// Types
// =============================================================================

/**
 * WebSocket interface (matches `ws` package).
 */
interface WebSocketLike {
  send(data: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  readyState: number;
  OPEN: number;
}

/**
 * WebSocket server interface (matches `ws` package).
 */
interface WebSocketServerLike {
  clients: Set<WebSocketLike>;
  on(event: "connection", listener: (ws: WebSocketLike, req: IncomingMessage) => void): void;
  close(): void;
}

/**
 * Options for the dev server.
 */
export interface DevServerOptions {
  /** Port to listen on (default: 3377) */
  port?: number;
  /** Hostname to bind to (default: localhost) */
  host?: string;
  /** Auto-open browser when starting (default: true) */
  autoOpen?: boolean;
  /** Workflow name for the visualizer title */
  workflowName?: string;
  /** Enable time-travel debugging (default: true) */
  timeTravel?: boolean;
  /** Enable performance heatmap (default: true) */
  heatmap?: boolean;
  /** Max snapshots for time-travel (default: 1000) */
  maxSnapshots?: number;
}

/**
 * Dev server interface.
 */
export interface DevServer {
  /** Start the server */
  start(): Promise<{ port: number; url: string }>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Handle a workflow event (forwards to time-travel and broadcasts) */
  handleEvent(event: WorkflowEvent<unknown>): void;
  /** Push an IR update to all clients */
  pushUpdate(ir: WorkflowIR): void;
  /** Push heatmap data to all clients */
  pushHeatmap(data: HeatmapData): void;
  /** Mark workflow as complete */
  complete(): void;
  /** Get the time-travel controller */
  getTimeTravel(): TimeTravelController;
  /** Get the performance analyzer */
  getAnalyzer(): PerformanceAnalyzer;
  /** Get current IR */
  getCurrentIR(): WorkflowIR;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a development server for the workflow visualizer.
 *
 * @example
 * ```typescript
 * const server = createDevServer({ port: 3377 });
 * await server.start();
 *
 * // Forward events from workflow execution
 * workflow.onEvent(event => server.handleEvent(event));
 *
 * // When done
 * server.complete();
 * await server.stop();
 * ```
 */
export async function createDevServer(
  options: DevServerOptions = {}
): Promise<DevServer> {
  const {
    port = 3377,
    host = "localhost",
    autoOpen = true,
    workflowName = "Workflow",
    timeTravel = true,
    heatmap = true,
    maxSnapshots = 1000,
  } = options;

  // Suppress unused variable warning - workflowName reserved for future use
  void workflowName;

  // Create time-travel controller and performance analyzer
  const ttController = createTimeTravelController({ maxSnapshots });
  const analyzer = createPerformanceAnalyzer();

  // Server state
  let httpServer: HTTPServer | null = null;
  let wsServer: WebSocketServerLike | null = null;
  let actualPort = port;
  let isRunning = false;

  /**
   * Broadcast a message to all connected WebSocket clients.
   */
  function broadcast(message: ServerMessage): void {
    if (!wsServer) return;
    const data = JSON.stringify(message);
    for (const client of wsServer.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  function handleClientMessage(ws: WebSocketLike, raw: Buffer | string): void {
    try {
      const msg = JSON.parse(
        typeof raw === "string" ? raw : raw.toString()
      ) as WebVisualizerMessage;

      switch (msg.type) {
        case "time_travel_seek": {
          const payload = msg.payload as { index: number };
          const ir = ttController.seek(payload.index);
          if (ir) {
            ws.send(JSON.stringify({ type: "ir_update", payload: ir }));
          }
          break;
        }
        case "time_travel_play": {
          const payload = msg.payload as { speed?: number } | undefined;
          ttController.play(payload?.speed);
          break;
        }
        case "time_travel_pause":
          ttController.pause();
          break;
        case "time_travel_step_forward": {
          const ir = ttController.stepForward();
          if (ir) {
            ws.send(JSON.stringify({ type: "ir_update", payload: ir }));
          }
          break;
        }
        case "time_travel_step_backward": {
          const ir = ttController.stepBackward();
          if (ir) {
            ws.send(JSON.stringify({ type: "ir_update", payload: ir }));
          }
          break;
        }
        case "request_snapshots": {
          const snapshots = ttController.getSnapshots().map((s) => ({
            id: s.id,
            eventIndex: s.eventIndex,
            timestamp: s.timestamp,
          }));
          ws.send(JSON.stringify({ type: "snapshots_list", payload: snapshots }));
          break;
        }
        case "toggle_heatmap":
        case "set_heatmap_metric": {
          // Client handles these locally, but we can use to sync state
          break;
        }
      }
    } catch (e) {
      console.error("[DevServer] Failed to handle message:", e);
    }
  }

  /**
   * Generate HTML for the current state.
   */
  function generatePage(): string {
    const ir = ttController.getCurrentIR();
    const wsUrl = `ws://${host}:${actualPort}`;

    return renderToHTML(ir, {
      interactive: true,
      timeTravel,
      heatmap,
      theme: "auto",
      layout: "TB",
      wsUrl,
    });
  }

  /**
   * Handle HTTP requests.
   */
  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(generatePage());
      return;
    }

    if (url === "/api/snapshots") {
      const snapshots = ttController.getSnapshots().map((s) => ({
        id: s.id,
        eventIndex: s.eventIndex,
        timestamp: s.timestamp,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshots));
      return;
    }

    if (url === "/api/performance") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(analyzer.exportData());
      return;
    }

    if (url === "/api/ir") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ttController.getCurrentIR()));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }

  /**
   * Try to dynamically import `ws` package.
   */
  async function loadWebSocketServer(): Promise<WebSocketServerLike | null> {
    try {
      // Dynamic import of optional peer dependency (ws is optional)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - ws is an optional peer dependency
      const wsModule = await import("ws");
      const ws = wsModule as {
        WebSocketServer?: new (options: { noServer: boolean }) => WebSocketServerLike;
        default?: {
          WebSocketServer?: new (options: { noServer: boolean }) => WebSocketServerLike;
        };
      };
      const WebSocketServer = ws.WebSocketServer ?? ws.default?.WebSocketServer;
      if (!WebSocketServer) {
        console.warn("[DevServer] WebSocket server class not found in ws module");
        return null;
      }
      return new WebSocketServer({ noServer: true });
    } catch {
      console.warn(
        "[DevServer] ws package not installed. Live updates disabled.\n" +
          "Install with: npm install ws"
      );
      return null;
    }
  }

  /**
   * Open URL in browser using platform-specific command.
   * Uses execFile for safety (no shell injection possible).
   */
  function openBrowser(url: string): void {
    const platform = process.platform;

    // Validate URL format to ensure it's a localhost URL
    if (!url.startsWith("http://localhost:") && !url.startsWith("http://127.0.0.1:")) {
      console.warn("[DevServer] Refusing to open non-localhost URL");
      return;
    }

    if (platform === "darwin") {
      execFile("open", [url], (err) => {
        if (err) console.warn("[DevServer] Failed to open browser:", err.message);
      });
    } else if (platform === "win32") {
      // On Windows, use cmd.exe with /c start to handle URLs properly
      execFile("cmd.exe", ["/c", "start", "", url], (err) => {
        if (err) console.warn("[DevServer] Failed to open browser:", err.message);
      });
    } else {
      // Linux and other Unix-like systems
      execFile("xdg-open", [url], (err) => {
        if (err) console.warn("[DevServer] Failed to open browser:", err.message);
      });
    }
  }

  // =============================================================================
  // Public Interface
  // =============================================================================

  async function start(): Promise<{ port: number; url: string }> {
    if (isRunning) {
      return { port: actualPort, url: `http://${host}:${actualPort}` };
    }

    // Create HTTP server
    httpServer = createServer(handleRequest);

    // Try to load WebSocket server
    wsServer = await loadWebSocketServer();

    if (wsServer) {
      // Handle WebSocket upgrade
      httpServer.on("upgrade", (request, socket, head) => {
        if (!wsServer) return;

        // Manual WebSocket handshake
        const ws = wsServer as unknown as {
          handleUpgrade: (
            req: IncomingMessage,
            socket: unknown,
            head: Buffer,
            callback: (ws: WebSocketLike) => void
          ) => void;
        };

        ws.handleUpgrade(request, socket, head, (client) => {
          // Send initial state
          client.send(
            JSON.stringify({
              type: "ir_update",
              payload: ttController.getCurrentIR(),
            })
          );

          // Handle messages
          client.on("message", (data) => handleClientMessage(client, data));
          client.on("error", (err) => console.error("[DevServer] WS error:", err));
        });
      });

      // Subscribe to time-travel state changes
      ttController.onStateChange((state) => {
        broadcast({ type: "time_travel_state", payload: state });
      });
    }

    // Start listening
    return new Promise((resolve, reject) => {
      if (!httpServer) {
        reject(new Error("HTTP server not initialized"));
        return;
      }

      httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          // Try next port
          actualPort++;
          httpServer?.listen(actualPort, host);
        } else {
          reject(err);
        }
      });

      httpServer.on("listening", () => {
        isRunning = true;
        const url = `http://${host}:${actualPort}`;
        console.log(`[DevServer] Visualizer running at ${url}`);

        if (autoOpen) {
          openBrowser(url);
        }

        resolve({ port: actualPort, url });
      });

      httpServer.listen(actualPort, host);
    });
  }

  async function stop(): Promise<void> {
    if (!isRunning) return;

    return new Promise((resolve) => {
      if (wsServer) {
        wsServer.close();
        wsServer = null;
      }

      if (httpServer) {
        httpServer.close(() => {
          httpServer = null;
          isRunning = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  function handleEvent(event: WorkflowEvent<unknown>): void {
    // Forward to time-travel controller
    ttController.handleEvent(event);

    // Forward to performance analyzer
    analyzer.addEvent(event);

    // Broadcast IR update
    broadcast({ type: "ir_update", payload: ttController.getCurrentIR() });
  }

  function pushUpdate(ir: WorkflowIR): void {
    broadcast({ type: "ir_update", payload: ir });
  }

  function pushHeatmap(data: HeatmapData): void {
    // Convert Map to object for JSON serialization
    const heat: Record<string, number> = {};
    for (const [k, v] of data.heat) {
      heat[k] = v;
    }
    broadcast({
      type: "performance_data",
      payload: { ...data, heat },
    });
  }

  function complete(): void {
    // Finalize analyzer run
    analyzer.finalizeRun("current");
    broadcast({ type: "workflow_complete", payload: null });
  }

  function getTimeTravel(): TimeTravelController {
    return ttController;
  }

  function getAnalyzer(): PerformanceAnalyzer {
    return analyzer;
  }

  function getCurrentIR(): WorkflowIR {
    return ttController.getCurrentIR();
  }

  return {
    start,
    stop,
    handleEvent,
    pushUpdate,
    pushHeatmap,
    complete,
    getTimeTravel,
    getAnalyzer,
    getCurrentIR,
  };
}
