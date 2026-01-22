/**
 * Flowchart ASCII Renderer
 *
 * Renders workflow IR as a proper flowchart with boxes and arrows.
 * Uses a 2D canvas approach for spatial layout with proper fork/join patterns.
 */

import type {
  FlowNode,
  ParallelNode,
  RaceNode,
  DecisionNode,
  Renderer,
  RenderOptions,
  StepNode,
  WorkflowIR,
  FlowchartRenderOptions,
  EnhancedRenderOptions,
  HeatLevel,
} from "../types";
import { isParallelNode, isRaceNode, isStepNode, isDecisionNode } from "../types";
import { formatDuration } from "../utils/timing";
import {
  defaultColorScheme,
  stripAnsi,
} from "./colors";
import { renderSparkline } from "./ascii";
import { getHeatLevel } from "../performance-analyzer";

// =============================================================================
// Box Drawing Characters
// =============================================================================

const CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeDown: "┬",
  teeUp: "┴",
  teeRight: "├",
  teeLeft: "┤",
  cross: "┼",
  arrowDown: "▼",
  arrowUp: "▲",
} as const;

// =============================================================================
// Heatmap Colors
// =============================================================================

const HEAT_COLORS: Record<HeatLevel, string> = {
  cold: "\x1b[34m",
  cool: "\x1b[36m",
  neutral: "",
  warm: "\x1b[33m",
  hot: "\x1b[31m",
  critical: "\x1b[41m",
};

const RESET = "\x1b[0m";

// =============================================================================
// Canvas Module
// =============================================================================

interface Canvas {
  cells: string[][];
  colors: (string | undefined)[][];
  width: number;
  height: number;
}

function createCanvas(width: number, height: number): Canvas {
  const cells: string[][] = [];
  const colors: (string | undefined)[][] = [];
  for (let y = 0; y < height; y++) {
    cells.push(Array(width).fill(" "));
    colors.push(Array(width).fill(undefined));
  }
  return { cells, colors, width, height };
}

function setChar(canvas: Canvas, x: number, y: number, char: string, color?: string): void {
  if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
    canvas.cells[y][x] = char;
    if (color) canvas.colors[y][x] = color;
  }
}

function getChar(canvas: Canvas, x: number, y: number): string {
  if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
    return canvas.cells[y][x];
  }
  return " ";
}

function drawBox(canvas: Canvas, x: number, y: number, width: number, height: number): void {
  setChar(canvas, x, y, CHARS.topLeft);
  for (let i = 1; i < width - 1; i++) setChar(canvas, x + i, y, CHARS.horizontal);
  setChar(canvas, x + width - 1, y, CHARS.topRight);

  for (let j = 1; j < height - 1; j++) {
    setChar(canvas, x, y + j, CHARS.vertical);
    setChar(canvas, x + width - 1, y + j, CHARS.vertical);
  }

  setChar(canvas, x, y + height - 1, CHARS.bottomLeft);
  for (let i = 1; i < width - 1; i++) setChar(canvas, x + i, y + height - 1, CHARS.horizontal);
  setChar(canvas, x + width - 1, y + height - 1, CHARS.bottomRight);
}

function drawText(canvas: Canvas, x: number, y: number, text: string, color?: string): void {
  const chars = stripAnsi(text).split("");
  for (let i = 0; i < chars.length; i++) {
    setChar(canvas, x + i, y, chars[i], color);
  }
}

function drawVerticalLine(canvas: Canvas, x: number, startY: number, endY: number): void {
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  for (let y = minY; y <= maxY; y++) {
    const existing = getChar(canvas, x, y);
    if (existing === CHARS.horizontal) {
      setChar(canvas, x, y, CHARS.cross);
    } else if (existing === " " || existing === CHARS.vertical) {
      setChar(canvas, x, y, CHARS.vertical);
    }
  }
}

function drawHorizontalLine(canvas: Canvas, y: number, startX: number, endX: number): void {
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  for (let x = minX; x <= maxX; x++) {
    const existing = getChar(canvas, x, y);
    if (existing === CHARS.vertical) {
      setChar(canvas, x, y, CHARS.cross);
    } else if (existing === " " || existing === CHARS.horizontal) {
      setChar(canvas, x, y, CHARS.horizontal);
    }
  }
}

function drawArrow(canvas: Canvas, x: number, y: number): void {
  setChar(canvas, x, y, CHARS.arrowDown);
}

function canvasToString(canvas: Canvas): string {
  const lines: string[] = [];
  for (let y = 0; y < canvas.height; y++) {
    let line = "";
    for (let x = 0; x < canvas.width; x++) {
      const color = canvas.colors[y][x];
      const char = canvas.cells[y][x];
      if (color) {
        line += color + char + RESET;
      } else {
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// =============================================================================
// Layout Types
// =============================================================================

interface LayoutNode {
  id: string;
  type: "step" | "parallel" | "race" | "decision" | "start" | "end";
  label: string[];
  state: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number; // Center X for connections
  bottomY: number; // Bottom Y for outgoing connections
  children?: LayoutNode[];
  metadata?: {
    isWinner?: boolean;
    heat?: number;
    verticalLayout?: boolean;
  };
}

// =============================================================================
// Text Wrapping & Measurement
// =============================================================================

const MIN_BOX_WIDTH = 11;
const BOX_PADDING = 2;
const VERTICAL_GAP = 2;
const HORIZONTAL_GAP = 3;

function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) {
    for (let i = 0; i < text.length; i += maxWidth) {
      lines.push(text.slice(i, i + maxWidth));
    }
  }
  return lines;
}

function getSymbol(state: string): string {
  switch (state) {
    case "success": return "✓";
    case "error": return "✗";
    case "running": return "⟳";
    case "pending": return "○";
    case "aborted":
    case "skipped": return "⊘";
    case "cached": return "↺";
    default: return "○";
  }
}

// =============================================================================
// Layout Algorithm
// =============================================================================

function layoutWorkflow(
  ir: WorkflowIR,
  options: RenderOptions,
  canvasWidth: number
): { nodes: LayoutNode[]; totalHeight: number } {
  const showStartEnd = (options as FlowchartRenderOptions).showStartEnd ?? true;
  const enhanced = options as EnhancedRenderOptions;
  const centerX = Math.floor(canvasWidth / 2);
  const nodes: LayoutNode[] = [];
  let currentY = 0;

  // Start node
  if (showStartEnd) {
    const startNode = createSimpleNode("start", "start", ["▶ Start"], "success", centerX, currentY);
    nodes.push(startNode);
    currentY = startNode.bottomY + VERTICAL_GAP;
  }

  // Layout workflow children sequentially
  for (const child of ir.root.children) {
    const layoutResult = layoutFlowNode(child, centerX, currentY, canvasWidth - 4, options, enhanced);
    nodes.push(layoutResult.node);
    currentY = layoutResult.bottomY + VERTICAL_GAP;
  }

  // End node
  if (showStartEnd && (ir.root.state === "success" || ir.root.state === "error")) {
    const endLabel = ir.root.state === "success" ? "✓ Done" : "✗ Failed";
    const endNode = createSimpleNode("end", "end", [endLabel], ir.root.state, centerX, currentY);
    nodes.push(endNode);
    currentY = endNode.bottomY;
  }

  return { nodes, totalHeight: currentY + 2 };
}

function createSimpleNode(
  id: string,
  type: LayoutNode["type"],
  label: string[],
  state: string,
  centerX: number,
  y: number
): LayoutNode {
  const maxLabelLen = Math.max(...label.map(l => stripAnsi(l).length));
  const width = Math.max(MIN_BOX_WIDTH, maxLabelLen + BOX_PADDING * 2);
  const height = label.length + 2;
  const x = centerX - Math.floor(width / 2);
  return {
    id,
    type,
    label,
    state,
    x,
    y,
    width,
    height,
    centerX,
    bottomY: y + height - 1,
  };
}

interface LayoutFlowResult {
  node: LayoutNode;
  bottomY: number;
}

function layoutFlowNode(
  node: FlowNode,
  centerX: number,
  startY: number,
  maxWidth: number,
  options: RenderOptions,
  enhanced?: EnhancedRenderOptions
): LayoutFlowResult {
  if (isStepNode(node)) {
    return layoutStepNode(node, centerX, startY, maxWidth, options, enhanced);
  }
  if (isParallelNode(node) || isRaceNode(node)) {
    return layoutBranchingNode(node, centerX, startY, maxWidth, options, enhanced);
  }
  if (isDecisionNode(node)) {
    return layoutDecisionNode(node, centerX, startY, maxWidth, options, enhanced);
  }
  // Fallback
  const fallback = createSimpleNode(node.id, "step", ["?"], node.state, centerX, startY);
  return { node: fallback, bottomY: fallback.bottomY };
}

function layoutStepNode(
  node: StepNode,
  centerX: number,
  startY: number,
  maxWidth: number,
  options: RenderOptions,
  enhanced?: EnhancedRenderOptions
): LayoutFlowResult {
  const name = node.name ?? node.key ?? "step";
  const symbol = getSymbol(node.state);
  const lines: string[] = [];

  // Main label
  const mainLabel = `${symbol} ${name}`;
  const innerWidth = Math.min(maxWidth - BOX_PADDING * 2, 40);
  lines.push(...wrapText(mainLabel, innerWidth));

  // Timing
  if (options.showTimings && node.durationMs !== undefined) {
    lines.push(`[${formatDuration(node.durationMs)}]`);
  }

  // Retry/timeout
  if (node.retryCount && node.retryCount > 0) {
    lines.push(`${node.retryCount}x retry`);
  }
  if (node.timedOut) {
    lines.push("timeout");
  }

  // Sparkline
  if (enhanced?.showSparklines && enhanced.timingHistory) {
    const nodeId = node.name ?? node.id;
    const history = enhanced.timingHistory.get(nodeId);
    if (history && history.length > 1) {
      lines.push(renderSparkline(history, 8));
    }
  }

  const labelWidth = Math.max(...lines.map(l => stripAnsi(l).length));
  const width = Math.max(MIN_BOX_WIDTH, labelWidth + BOX_PADDING * 2);
  const height = lines.length + 2;
  const x = centerX - Math.floor(width / 2);

  // Heat
  let heat: number | undefined;
  if (enhanced?.showHeatmap && enhanced.heatmapData) {
    const nodeId = node.name ?? node.id;
    heat = enhanced.heatmapData.heat.get(node.id) ?? enhanced.heatmapData.heat.get(nodeId);
  }

  const layoutNode: LayoutNode = {
    id: node.id,
    type: "step",
    label: lines,
    state: node.state,
    x,
    y: startY,
    width,
    height,
    centerX,
    bottomY: startY + height - 1,
    metadata: heat !== undefined ? { heat } : undefined,
  };

  return { node: layoutNode, bottomY: layoutNode.bottomY };
}

function layoutBranchingNode(
  node: ParallelNode | RaceNode,
  centerX: number,
  startY: number,
  maxWidth: number,
  options: RenderOptions,
  enhanced?: EnhancedRenderOptions
): LayoutFlowResult {
  const isRace = isRaceNode(node);
  const name = node.name ?? (isRace ? "race" : "parallel");
  const symbol = isRace ? "⚡" : "⫘";
  const headerLabel = `${symbol} ${name}`;

  // No children - simple box
  if (node.children.length === 0) {
    const lines = [headerLabel, "(not tracked)"];
    const result = createSimpleNode(node.id, isRace ? "race" : "parallel", lines, node.state, centerX, startY);
    return { node: result, bottomY: result.bottomY };
  }

  // Calculate child widths first
  const childMaxWidth = Math.floor((maxWidth - HORIZONTAL_GAP * (node.children.length - 1)) / node.children.length);
  const childWidths: number[] = [];

  for (const child of node.children) {
    const measured = measureFlowNode(child, Math.max(childMaxWidth, MIN_BOX_WIDTH), options, enhanced);
    childWidths.push(measured.width);
  }

  const totalChildWidth = childWidths.reduce((a, b) => a + b, 0) + HORIZONTAL_GAP * (node.children.length - 1);

  // Check if horizontal layout would overflow - fall back to vertical
  const useVerticalLayout = totalChildWidth > maxWidth && node.children.length > 1;

  // Header
  const headerWidth = Math.max(MIN_BOX_WIDTH, headerLabel.length + BOX_PADDING * 2);
  const headerHeight = 3;
  const headerX = centerX - Math.floor(headerWidth / 2);

  let currentY = startY;

  // Header node (we won't add it as separate node, integrate into parent)
  currentY += headerHeight;
  currentY += 1; // Fork line row
  currentY += 1; // Arrow row

  // Position children
  const children: LayoutNode[] = [];

  if (useVerticalLayout) {
    // Vertical layout - stack children sequentially
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const result = layoutFlowNode(child, centerX, currentY, maxWidth, options, enhanced);

      // Mark winner
      if (isRace && isRaceNode(node) && node.winnerId === child.id) {
        result.node.metadata = { ...result.node.metadata, isWinner: true };
      }

      children.push(result.node);
      currentY = result.bottomY + VERTICAL_GAP;
    }
  } else {
    // Horizontal layout - spread children side by side
    let childX = centerX - Math.floor(totalChildWidth / 2);

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childCenterX = childX + Math.floor(childWidths[i] / 2);
      const result = layoutFlowNode(child, childCenterX, currentY, childWidths[i], options, enhanced);

      // Mark winner
      if (isRace && isRaceNode(node) && node.winnerId === child.id) {
        result.node.metadata = { ...result.node.metadata, isWinner: true };
      }

      children.push(result.node);
      childX += childWidths[i] + HORIZONTAL_GAP;
    }
  }

  // Calculate bottom after all children
  const childrenBottomY = Math.max(...children.map(c => c.bottomY));

  // For single child or vertical layout, no join line needed
  // For multiple children in horizontal layout, we have: child bottom -> join line -> vertical segment
  const needsJoinLine = !useVerticalLayout && children.length > 1;
  const totalBottomY = needsJoinLine
    ? childrenBottomY + 2 // Horizontal multi-child: join line + one row below
    : childrenBottomY;    // Single child or vertical: no join line

  // Create parent node with children
  const parentNode: LayoutNode = {
    id: node.id,
    type: isRace ? "race" : "parallel",
    label: [headerLabel],
    state: node.state,
    x: headerX,
    y: startY,
    width: headerWidth,
    height: headerHeight,
    centerX,
    bottomY: totalBottomY,
    children,
    metadata: { verticalLayout: useVerticalLayout },
  };

  return { node: parentNode, bottomY: totalBottomY };
}

function layoutDecisionNode(
  node: DecisionNode,
  centerX: number,
  startY: number,
  maxWidth: number,
  options: RenderOptions,
  enhanced?: EnhancedRenderOptions
): LayoutFlowResult {
  const name = node.name ?? "decision";
  const condition = node.condition ? ` (${node.condition.slice(0, 20)})` : "";
  const headerLabel = `◇ ${name}${condition}`;

  // Wrap header label properly
  const innerWidth = Math.min(maxWidth - BOX_PADDING * 2, 40);
  const labelLines = wrapText(headerLabel, innerWidth);
  const labelWidth = Math.max(...labelLines.map(l => stripAnsi(l).length));
  const headerWidth = Math.max(MIN_BOX_WIDTH, labelWidth + BOX_PADDING * 2);
  const headerHeight = labelLines.length + 2; // Dynamic height based on wrapped lines
  const headerX = centerX - Math.floor(headerWidth / 2);

  // Find taken branch
  const takenBranch = node.branches.find(b => b.taken);

  if (!takenBranch || takenBranch.children.length === 0) {
    // No children - just show header
    const result: LayoutNode = {
      id: node.id,
      type: "decision",
      label: labelLines,
      state: node.state,
      x: headerX,
      y: startY,
      width: headerWidth,
      height: headerHeight,
      centerX,
      bottomY: startY + headerHeight - 1,
    };
    return { node: result, bottomY: result.bottomY };
  }

  // Layout children of taken branch
  let currentY = startY + headerHeight + VERTICAL_GAP;
  const children: LayoutNode[] = [];

  for (const child of takenBranch.children) {
    const result = layoutFlowNode(child, centerX, currentY, maxWidth, options, enhanced);
    children.push(result.node);
    currentY = result.bottomY + VERTICAL_GAP;
  }

  const bottomY = children.length > 0 ? children[children.length - 1].bottomY : startY + headerHeight - 1;

  const parentNode: LayoutNode = {
    id: node.id,
    type: "decision",
    label: labelLines,
    state: node.state,
    x: headerX,
    y: startY,
    width: headerWidth,
    height: headerHeight,
    centerX,
    bottomY,
    children,
  };

  return { node: parentNode, bottomY };
}

function measureFlowNode(
  node: FlowNode,
  maxWidth: number,
  options: RenderOptions,
  enhanced?: EnhancedRenderOptions
): { width: number; height: number } {
  if (isStepNode(node)) {
    const name = node.name ?? node.key ?? "step";
    const symbol = getSymbol(node.state);
    let lineCount = 1;
    if (options.showTimings && node.durationMs !== undefined) lineCount++;
    if (node.retryCount && node.retryCount > 0) lineCount++;
    if (node.timedOut) lineCount++;
    if (enhanced?.showSparklines && enhanced.timingHistory?.has(node.name ?? node.id)) lineCount++;

    const width = Math.min(maxWidth, Math.max(MIN_BOX_WIDTH, (`${symbol} ${name}`).length + BOX_PADDING * 2));
    const height = lineCount + 2;
    return { width, height };
  }

  if (isParallelNode(node) || isRaceNode(node)) {
    if (node.children.length === 0) {
      return { width: MIN_BOX_WIDTH + 4, height: 4 };
    }
    const childMaxWidth = Math.floor(maxWidth / node.children.length);
    let totalWidth = 0;
    let maxHeight = 0;
    for (const child of node.children) {
      const m = measureFlowNode(child, childMaxWidth, options, enhanced);
      totalWidth += m.width;
      maxHeight = Math.max(maxHeight, m.height);
    }
    totalWidth += HORIZONTAL_GAP * (node.children.length - 1);
    return { width: Math.max(totalWidth, MIN_BOX_WIDTH), height: 3 + 2 + maxHeight + 2 };
  }

  if (isDecisionNode(node)) {
    const takenBranch = node.branches.find(b => b.taken);
    let childHeight = 0;
    if (takenBranch) {
      for (const child of takenBranch.children) {
        const m = measureFlowNode(child, maxWidth, options, enhanced);
        childHeight += m.height + VERTICAL_GAP;
      }
    }
    return { width: Math.min(maxWidth, 30), height: 3 + childHeight };
  }

  return { width: MIN_BOX_WIDTH, height: 3 };
}

// =============================================================================
// Rendering - Hierarchical with proper connections
// =============================================================================

function renderNodes(
  canvas: Canvas,
  nodes: LayoutNode[],
  options: RenderOptions
): void {
  const colors = { ...defaultColorScheme, ...options.colors };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;

    // Render this node and its children
    renderNode(canvas, node, colors);

    // Draw connection to next sibling node
    if (!isLast) {
      const nextNode = nodes[i + 1];
      const fromX = node.centerX;
      const fromY = node.bottomY + 1;
      const toX = nextNode.centerX;
      const toY = nextNode.y - 1;

      // Vertical line
      drawVerticalLine(canvas, fromX, fromY, toY - 1);
      // Arrow
      drawArrow(canvas, toX, toY);
    }
  }
}

function renderNode(
  canvas: Canvas,
  node: LayoutNode,
  colors: Record<string, string>
): void {
  // Draw the box
  const hasTopConnector = node.type !== "start";
  const hasBottomConnector = node.type !== "end" && (!node.children || node.children.length === 0);

  drawBox(canvas, node.x, node.y, node.width, node.height);

  // Add connector points
  if (hasTopConnector) {
    setChar(canvas, node.centerX, node.y, CHARS.teeUp);
  }
  if (hasBottomConnector || (node.children && node.children.length > 0)) {
    setChar(canvas, node.centerX, node.y + node.height - 1, CHARS.teeDown);
  }

  // Draw label
  const innerWidth = node.width - BOX_PADDING * 2;
  const color = getNodeColor(node, colors);

  for (let j = 0; j < node.label.length; j++) {
    const line = node.label[j];
    const lineX = node.x + 1 + Math.floor((innerWidth - stripAnsi(line).length) / 2);
    const lineY = node.y + 1 + j;
    drawText(canvas, lineX, lineY, line, color);
  }

  // Winner indicator
  if (node.metadata?.isWinner) {
    drawText(canvas, node.x + node.width - 2, node.y, "🏆");
  }

  // Render children with proper fork/join connections
  if (node.children && node.children.length > 0) {
    if (node.type === "parallel" || node.type === "race") {
      renderBranchingChildren(canvas, node, colors);
    } else {
      // Sequential children (e.g., decision taken branch)
      renderSequentialChildren(canvas, node, colors);
    }
  }
}

function renderBranchingChildren(
  canvas: Canvas,
  parent: LayoutNode,
  colors: Record<string, string>
): void {
  const children = parent.children!;
  if (children.length === 0) return;

  const forkY = parent.y + parent.height;
  const forkX = parent.centerX;

  // Check if using vertical layout (fallback for overflow)
  const useVerticalLayout = parent.metadata?.verticalLayout === true;

  if (useVerticalLayout) {
    // Vertical layout - render as sequential children
    // Draw connection from parent header to first child
    const firstChild = children[0];
    drawVerticalLine(canvas, forkX, forkY, firstChild.y - 2);
    drawArrow(canvas, firstChild.centerX, firstChild.y - 1);

    // Render children and connections between them
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      renderNode(canvas, child, colors);

      if (i < children.length - 1) {
        const nextChild = children[i + 1];
        drawVerticalLine(canvas, child.centerX, child.bottomY + 1, nextChild.y - 2);
        drawArrow(canvas, nextChild.centerX, nextChild.y - 1);
      }
    }
    return;
  }

  // Horizontal layout - draw fork/join pattern
  if (children.length === 1) {
    // Single child - just vertical line
    drawVerticalLine(canvas, forkX, forkY, children[0].y - 2);
    drawArrow(canvas, children[0].centerX, children[0].y - 1);
  } else {
    // Multiple children - fork pattern
    const childCenters = children.map(c => c.centerX);
    const minX = Math.min(...childCenters);
    const maxX = Math.max(...childCenters);

    // Vertical line down from parent
    drawVerticalLine(canvas, forkX, forkY, forkY + 1);

    // Horizontal fork line
    drawHorizontalLine(canvas, forkY + 1, minX, maxX);

    // Set proper junction at center
    setChar(canvas, forkX, forkY + 1, CHARS.teeUp);

    // Vertical lines down to each child and arrows
    for (const child of children) {
      const cx = child.centerX;
      if (cx === minX) {
        setChar(canvas, cx, forkY + 1, CHARS.topLeft);
      } else if (cx === maxX) {
        setChar(canvas, cx, forkY + 1, CHARS.topRight);
      } else if (cx !== forkX) {
        setChar(canvas, cx, forkY + 1, CHARS.teeDown);
      }
      drawVerticalLine(canvas, cx, forkY + 2, child.y - 2);
      drawArrow(canvas, cx, child.y - 1);
    }
  }

  // Render each child
  for (const child of children) {
    renderNode(canvas, child, colors);
  }

  // Draw join - gather all children back together (only for horizontal multi-child)
  if (children.length > 1) {
    const childBottoms = children.map(c => c.bottomY);
    const maxChildBottom = Math.max(...childBottoms);
    const joinY = maxChildBottom + 1;

    const childCenters = children.map(c => c.centerX);
    const minX = Math.min(...childCenters);
    const maxX = Math.max(...childCenters);

    // Vertical lines up from each child bottom to join line
    for (const child of children) {
      if (child.bottomY < maxChildBottom) {
        drawVerticalLine(canvas, child.centerX, child.bottomY + 1, joinY - 1);
      }
    }

    // Horizontal join line
    drawHorizontalLine(canvas, joinY, minX, maxX);

    // Set proper junction characters
    for (const child of children) {
      const cx = child.centerX;
      if (cx === minX) {
        setChar(canvas, cx, joinY, CHARS.bottomLeft);
      } else if (cx === maxX) {
        setChar(canvas, cx, joinY, CHARS.bottomRight);
      } else {
        setChar(canvas, cx, joinY, CHARS.teeUp);
      }
    }

    // Tee down at join center and vertical segment below
    setChar(canvas, parent.centerX, joinY, CHARS.teeDown);
    // Draw vertical line from join to parent's bottomY for next sibling connection
    setChar(canvas, parent.centerX, joinY + 1, CHARS.vertical);
  }
}

function renderSequentialChildren(
  canvas: Canvas,
  parent: LayoutNode,
  colors: Record<string, string>
): void {
  const children = parent.children!;
  if (children.length === 0) return;

  // Draw connection from parent to first child
  const fromY = parent.y + parent.height;
  const firstChild = children[0];
  drawVerticalLine(canvas, parent.centerX, fromY, firstChild.y - 2);
  drawArrow(canvas, firstChild.centerX, firstChild.y - 1);

  // Render children and connections between them
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    renderNode(canvas, child, colors);

    if (i < children.length - 1) {
      const nextChild = children[i + 1];
      drawVerticalLine(canvas, child.centerX, child.bottomY + 1, nextChild.y - 2);
      drawArrow(canvas, nextChild.centerX, nextChild.y - 1);
    }
  }
}

function getNodeColor(node: LayoutNode, colors: Record<string, string>): string | undefined {
  if (node.metadata?.heat !== undefined) {
    const level = getHeatLevel(node.metadata.heat);
    return HEAT_COLORS[level] || undefined;
  }
  return colors[node.state] || undefined;
}

// =============================================================================
// Main Renderer
// =============================================================================

export function flowchartRenderer(): Renderer {
  return {
    name: "flowchart",
    supportsLive: false,

    render(ir: WorkflowIR, options: RenderOptions): string {
      const width = options.terminalWidth ?? 80;
      const { nodes, totalHeight } = layoutWorkflow(ir, options, width);
      const canvas = createCanvas(width, totalHeight);
      renderNodes(canvas, nodes, options);
      return canvasToString(canvas);
    },
  };
}
