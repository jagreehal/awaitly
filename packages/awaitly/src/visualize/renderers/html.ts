/**
 * HTML Renderer
 *
 * Renders the workflow IR as an interactive HTML page with:
 * - SVG-based workflow diagram
 * - Zoom and pan
 * - Node inspection
 * - Time-travel controls
 * - Performance heatmap overlay
 */

import type {
  FlowNode,
  HTMLRenderOptions,
  Renderer,
  WorkflowIR,
  StepState,
  RenderOptions,
  LayoutDirection,
} from "../types";
import {
  isStepNode,
  isParallelNode,
  isRaceNode,
  isDecisionNode,
} from "../types";
import { generateStyles } from "./html-styles";
import { generateClientScript } from "./html-client";
import { formatDuration } from "../utils/timing";

// =============================================================================
// Constants
// =============================================================================

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const NODE_SPACING_H = 40;
const NODE_SPACING_V = 30;
const CONTAINER_PADDING = 20;

// =============================================================================
// Layout Types
// =============================================================================

interface LayoutNode {
  id: string;
  name: string;
  type: string;
  state: StepState;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs?: number;
  children?: LayoutNode[];
  containerType?: "parallel" | "race" | "decision";
  containerLabel?: string;
}

interface LayoutResult {
  nodes: LayoutNode[];
  width: number;
  height: number;
}

// =============================================================================
// Layout Functions
// =============================================================================

/**
 * Layout workflow nodes for SVG rendering.
 * Uses a simple top-to-bottom layout algorithm.
 */
function layoutWorkflow(
  nodes: FlowNode[],
  direction: LayoutDirection = "TB"
): LayoutResult {
  const isVertical = direction === "TB" || direction === "BT";
  const layoutNodes: LayoutNode[] = [];
  let currentX = CONTAINER_PADDING;
  let currentY = CONTAINER_PADDING;
  let maxWidth = 0;
  let maxHeight = 0;

  for (const node of nodes) {
    const result = layoutFlowNode(node, currentX, currentY, isVertical);
    layoutNodes.push(result.node);

    if (isVertical) {
      currentY += result.height + NODE_SPACING_V;
      maxWidth = Math.max(maxWidth, result.width);
      maxHeight = currentY;
    } else {
      currentX += result.width + NODE_SPACING_H;
      maxHeight = Math.max(maxHeight, result.height);
      maxWidth = currentX;
    }
  }

  return {
    nodes: layoutNodes,
    width: maxWidth + CONTAINER_PADDING,
    height: maxHeight + CONTAINER_PADDING,
  };
}

/**
 * Layout a single flow node.
 */
function layoutFlowNode(
  node: FlowNode,
  x: number,
  y: number,
  _isVertical: boolean
): { node: LayoutNode; width: number; height: number } {
  if (isStepNode(node)) {
    return {
      node: {
        id: node.id,
        name: node.name ?? node.key ?? "step",
        type: "step",
        state: node.state,
        x,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        durationMs: node.durationMs,
      },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  }

  if (isParallelNode(node) || isRaceNode(node)) {
    const containerType = isParallelNode(node) ? "parallel" : "race";
    const label = node.name ?? containerType;
    const children: LayoutNode[] = [];

    let innerX = x + CONTAINER_PADDING;
    const innerY = y + CONTAINER_PADDING + 20; // Extra space for label
    let innerMaxWidth = 0;
    let innerMaxHeight = 0;

    // Layout children horizontally in parallel
    for (const child of node.children) {
      const result = layoutFlowNode(child, innerX, innerY, true);
      children.push(result.node);
      innerX += result.width + NODE_SPACING_H;
      innerMaxHeight = Math.max(innerMaxHeight, result.height);
    }

    innerMaxWidth = innerX - x - CONTAINER_PADDING;
    const containerWidth = Math.max(
      innerMaxWidth + CONTAINER_PADDING,
      NODE_WIDTH + CONTAINER_PADDING * 2
    );
    const containerHeight =
      innerMaxHeight + CONTAINER_PADDING * 2 + 20; // Extra for label

    return {
      node: {
        id: node.id,
        name: label,
        type: containerType,
        state: node.state,
        x,
        y,
        width: containerWidth,
        height: containerHeight,
        durationMs: node.durationMs,
        children,
        containerType,
        containerLabel: containerType === "parallel" ? "PARALLEL" : "RACE",
      },
      width: containerWidth,
      height: containerHeight,
    };
  }

  if (isDecisionNode(node)) {
    const label = node.name ?? "decision";
    const children: LayoutNode[] = [];

    let innerX = x + CONTAINER_PADDING;
    const innerY = y + CONTAINER_PADDING + 20;
    let innerMaxHeight = 0;

    // Layout branches horizontally
    for (const branch of node.branches) {
      for (const child of branch.children) {
        const result = layoutFlowNode(child, innerX, innerY, true);
        children.push(result.node);
        innerX += result.width + NODE_SPACING_H;
        innerMaxHeight = Math.max(innerMaxHeight, result.height);
      }
    }

    const containerWidth = Math.max(
      innerX - x,
      NODE_WIDTH + CONTAINER_PADDING * 2
    );
    const containerHeight = innerMaxHeight + CONTAINER_PADDING * 2 + 20;

    return {
      node: {
        id: node.id,
        name: label,
        type: "decision",
        state: node.state,
        x,
        y,
        width: containerWidth,
        height: containerHeight,
        durationMs: node.durationMs,
        children,
        containerType: "decision",
        containerLabel: "DECISION",
      },
      width: containerWidth,
      height: containerHeight,
    };
  }

  // Default fallback
  return {
    node: {
      id: node.id,
      name: node.name ?? "unknown",
      type: node.type,
      state: node.state,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
}

// =============================================================================
// SVG Rendering
// =============================================================================

/**
 * Render a layout node to SVG.
 */
function renderLayoutNodeSVG(node: LayoutNode, showTimings: boolean): string {
  if (node.containerType) {
    return renderContainerSVG(node, showTimings);
  }
  return renderStepSVG(node, showTimings);
}

/**
 * Render a step node as SVG.
 */
function renderStepSVG(node: LayoutNode, showTimings: boolean): string {
  const rx = 8; // Border radius
  const timing =
    showTimings && node.durationMs !== undefined
      ? formatDuration(node.durationMs)
      : "";

  return `
    <g class="wv-node wv-node--${node.state}" data-node-id="${escapeAttr(node.id)}" transform="translate(${node.x}, ${node.y})">
      <rect width="${node.width}" height="${node.height}" rx="${rx}" ry="${rx}" />
      <text x="${node.width / 2}" y="${node.height / 2 - (timing ? 4 : 0)}">${escapeXml(truncate(node.name, 20))}</text>
      ${timing ? `<text class="wv-node-timing" x="${node.width / 2}" y="${node.height / 2 + 12}">${timing}</text>` : ""}
    </g>
  `;
}

/**
 * Render a container (parallel/race/decision) as SVG.
 */
function renderContainerSVG(node: LayoutNode, showTimings: boolean): string {
  const rx = 12;
  const childrenSVG =
    node.children?.map((c) => renderLayoutNodeSVG(c, showTimings)).join("\n") ??
    "";

  return `
    <g class="wv-container wv-container--${node.containerType}" data-node-id="${escapeAttr(node.id)}" transform="translate(${node.x}, ${node.y})">
      <rect width="${node.width}" height="${node.height}" rx="${rx}" ry="${rx}" />
      <text class="wv-container-label" x="${CONTAINER_PADDING}" y="16">${node.containerLabel}</text>
      <g transform="translate(${-node.x}, ${-node.y})">
        ${childrenSVG}
      </g>
    </g>
  `;
}

/**
 * Render edges between sequential nodes.
 */
function renderEdgesSVG(nodes: LayoutNode[]): string {
  const edges: string[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];

    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;

    // Simple straight line with arrow
    edges.push(`
      <path class="wv-edge" d="M ${x1} ${y1} L ${x2} ${y2 - 8}" />
      <polygon class="wv-edge-arrow" points="${x2 - 4},${y2 - 8} ${x2 + 4},${y2 - 8} ${x2},${y2}" />
    `);
  }

  return edges.join("\n");
}

// =============================================================================
// HTML Generation
// =============================================================================

/**
 * Generate complete HTML page.
 */
function generateHTML(
  ir: WorkflowIR,
  options: HTMLRenderOptions
): string {
  const layout = layoutWorkflow(ir.root.children, options.layout);
  const svgWidth = Math.max(layout.width, 400);
  const svgHeight = Math.max(layout.height, 300);

  const nodesSVG = layout.nodes
    .map((n) => renderLayoutNodeSVG(n, options.showTimings))
    .join("\n");
  const edgesSVG = renderEdgesSVG(layout.nodes);

  const workflowName = ir.root.name ?? "Workflow";
  const css = generateStyles(options.theme);
  const js = generateClientScript({
    wsUrl: options.wsUrl,
    interactive: options.interactive,
    timeTravel: options.timeTravel,
    heatmap: options.heatmap,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(workflowName)} - Workflow Visualizer</title>
  <style>${css}</style>
</head>
<body>
  <div class="workflow-visualizer">
    <header class="wv-header">
      <h1>${escapeXml(workflowName)}</h1>
      <div class="wv-controls">
        ${options.interactive ? `
          <button id="load-json-btn" class="wv-btn" title="Load workflow state from JSON">Load JSON</button>
        ` : ""}
        ${options.wsUrl ? `<div id="live-indicator" class="wv-live" style="display:none"><span class="wv-live-dot"></span>LIVE</div>` : ""}
        ${options.heatmap && options.wsUrl ? `
          <button id="heatmap-toggle" class="wv-btn">Heatmap</button>
          <select id="heatmap-metric" class="wv-btn">
            <option value="duration">Duration</option>
            <option value="retryRate">Retry Rate</option>
            <option value="errorRate">Error Rate</option>
          </select>
        ` : ""}
        ${options.interactive ? `
          <button id="zoom-out" class="wv-btn wv-btn--icon" title="Zoom out (-)">−</button>
          <button id="zoom-reset" class="wv-btn wv-btn--icon" title="Reset zoom (0)">⟲</button>
          <button id="zoom-in" class="wv-btn wv-btn--icon" title="Zoom in (+)">+</button>
        ` : ""}
      </div>
    </header>

    <div class="wv-main">
      <div id="diagram" class="wv-diagram">
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet">
          <g class="wv-root">
            ${edgesSVG}
            ${nodesSVG}
          </g>
        </svg>
      </div>

      ${options.interactive ? `
        <aside id="inspector" class="wv-inspector">
          <div class="wv-inspector-header">
            <h2>Inspector</h2>
          </div>
          <div id="inspector-content" class="wv-inspector-content">
            <p class="wv-empty">Select a node to inspect</p>
          </div>
        </aside>
      ` : ""}
    </div>

    ${options.timeTravel ? `
      <div id="timeline" class="wv-timeline">
        <div class="wv-timeline-track">
          <input type="range" id="tt-slider" min="0" max="0" value="0" style="width:100%">
        </div>
        <div class="wv-timeline-controls">
          <button id="tt-prev" class="wv-btn wv-btn--icon" title="Step backward (←)">⏮</button>
          <button id="tt-play" class="wv-btn wv-btn--icon" title="Play (Space)">▶</button>
          <button id="tt-pause" class="wv-btn wv-btn--icon" style="display:none" title="Pause (Space)">⏸</button>
          <button id="tt-next" class="wv-btn wv-btn--icon" title="Step forward (→)">⏭</button>
          <select id="tt-speed" class="wv-btn">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
            <option value="10">10x</option>
          </select>
          <span id="tt-time" class="wv-timeline-time">0 / 0</span>
        </div>
      </div>
    ` : ""}
  </div>

  ${options.interactive ? `
    <div id="load-json-modal" class="wv-modal" style="display:none">
      <div class="wv-modal-content">
        <div class="wv-modal-header">
          <h2>Load Workflow State</h2>
          <button id="load-json-close" class="wv-btn wv-btn--icon" title="Close">×</button>
        </div>
        <div class="wv-modal-body">
          <p>Paste the workflow IR JSON (from <code>viz.getIR()</code> or <code>viz.renderAs('json')</code>):</p>
          <textarea id="load-json-input" class="wv-textarea" rows="15" placeholder='{"root":{"type":"workflow","id":"...","children":[...]}}'></textarea>
          <div id="load-json-error" class="wv-error" style="display:none"></div>
        </div>
        <div class="wv-modal-footer">
          <button id="load-json-submit" class="wv-btn wv-btn--primary">Load</button>
          <button id="load-json-cancel" class="wv-btn">Cancel</button>
        </div>
      </div>
    </div>
  ` : ""}

  <script>
    // Check if we have a saved IR in sessionStorage (from Load JSON)
    (function() {
      let initialIR = ${JSON.stringify(ir).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};
      try {
        const savedIR = sessionStorage.getItem('workflow_ir');
        if (savedIR) {
          initialIR = JSON.parse(savedIR);
          sessionStorage.removeItem('workflow_ir'); // Clear after use
        }
      } catch (e) {
        console.warn('Failed to load saved IR:', e);
      }
      
      window.__WORKFLOW_IR__ = initialIR;
      
      // Build workflow data from IR
      function buildWorkflowDataFromIR(ir) {
        const nodes = {};
        function collectNodes(flowNodes) {
          for (const node of flowNodes || []) {
            nodes[node.id] = {
              id: node.id,
              name: node.name,
              type: node.type,
              state: node.state,
              key: node.key,
              durationMs: node.durationMs,
              startTs: node.startTs,
              error: node.error ? String(node.error) : undefined,
              retryCount: node.retryCount,
            };
            if (node.children) collectNodes(node.children);
            if (node.branches) {
              for (const branch of node.branches) {
                collectNodes(branch.children);
              }
            }
          }
        }
        collectNodes(ir.root.children);
        return { nodes };
      }
      
      window.__WORKFLOW_DATA__ = buildWorkflowDataFromIR(initialIR);
    })();
  </script>
  <script>${js}</script>
</body>
</html>`;
}

// =============================================================================
// Utility Functions
// =============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

// =============================================================================
// Renderer Export
// =============================================================================

/**
 * Default HTML render options.
 */
const defaultHTMLOptions: Omit<HTMLRenderOptions, keyof RenderOptions> = {
  interactive: true,
  timeTravel: true,
  heatmap: true,
  animationDuration: 200,
  theme: "auto",
  layout: "TB",
};

/**
 * Create the HTML renderer.
 */
export function htmlRenderer(): Renderer {
  return {
    name: "html",
    supportsLive: true,

    render(ir: WorkflowIR, options: RenderOptions): string {
      const htmlOptions: HTMLRenderOptions = {
        ...options,
        ...defaultHTMLOptions,
        ...(options as Partial<HTMLRenderOptions>),
      };

      return generateHTML(ir, htmlOptions);
    },
  };
}

/**
 * Render workflow IR to HTML with custom options.
 */
export function renderToHTML(
  ir: WorkflowIR,
  options: Partial<HTMLRenderOptions> = {}
): string {
  const fullOptions: HTMLRenderOptions = {
    showTimings: true,
    showKeys: false,
    colors: {
      pending: "#6c757d",
      running: "#ffc107",
      success: "#198754",
      error: "#dc3545",
      aborted: "#6c757d",
      cached: "#0dcaf0",
      skipped: "#adb5bd",
    },
    ...defaultHTMLOptions,
    ...options,
  };

  return generateHTML(ir, fullOptions);
}
