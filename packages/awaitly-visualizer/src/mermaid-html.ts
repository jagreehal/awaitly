/**
 * Interactive Mermaid CDN HTML Generator
 *
 * Generates a self-contained HTML file that uses Mermaid CDN to render
 * workflow diagrams with click-to-inspect interactivity, 6 themes,
 * and a theme picker.
 *
 * Moved from awaitly-analyze so the template is reusable across packages.
 *
 * Pipeline:
 *   mermaidText + WorkflowMetadata → generateInteractiveHTML() → .html file
 */

// =============================================================================
// Types
// =============================================================================

/** Source location for a node in the analyzed source. */
export interface MermaidHTMLSourceLocation {
  filePath: string;
  line: number;
  column: number;
}

/** Retry configuration for display in the inspector panel. */
export interface MermaidHTMLRetryConfig {
  attempts?: number | string;
  backoff?: string;
  baseDelay?: number | string;
  retryOn?: string;
}

/** Timeout configuration for display in the inspector panel. */
export interface MermaidHTMLTimeoutConfig {
  ms?: number | string;
}

export interface NodeMetadata {
  /** Mermaid node ID (matches the ID in the rendered diagram) */
  mermaidId: string;
  /** Node type from the IR */
  type: string;
  /** Human-readable name */
  name: string;
  /** Step ID (for step nodes) */
  stepId?: string;
  /** Function callee */
  callee?: string;
  /** Description */
  description?: string;
  /** Source location */
  location?: MermaidHTMLSourceLocation;
  /** Retry configuration */
  retry?: MermaidHTMLRetryConfig;
  /** Timeout configuration */
  timeout?: MermaidHTMLTimeoutConfig;
  /** Condition expression (for decisions/conditionals) */
  condition?: string;
  /** Helper used (when/unless) */
  helper?: string;
  /** Error tags */
  errors?: string[];
  /** Input type */
  inputType?: string;
  /** Output type */
  outputType?: string;
  /** Output key */
  out?: string;
  /** Keys this step reads */
  reads?: string[];
  /** Parallel mode */
  mode?: string;
  /** Children count */
  childCount?: number;
  /** Loop type */
  loopType?: string;
  /** Iteration source */
  iterSource?: string;
  /** Bound count for loops */
  boundCount?: number;
  /** Stream type */
  streamType?: string;
  /** Stream namespace */
  namespace?: string;
  /** Referenced workflow name */
  workflowName?: string;
  /** Whether reference is resolved */
  resolved?: boolean;
  /** Has compensation (saga steps) */
  hasCompensation?: boolean;
  /** Compensation callee */
  compensationCallee?: string;
  /** Switch expression */
  expression?: string;
  /** Switch cases */
  cases?: Array<{ value?: string; isDefault: boolean }>;
  /** Connected incoming edges */
  incomingFrom?: string[];
  /** Connected outgoing edges */
  outgoingTo?: string[];
}

export interface WorkflowMetadata {
  /** Workflow name */
  workflowName: string;
  /** Workflow description */
  description?: string;
  /** Source file */
  filePath: string;
  /** Analysis stats */
  stats: {
    totalSteps: number;
    conditionalCount: number;
    parallelCount: number;
    raceCount: number;
    loopCount: number;
  };
  /** Node metadata keyed by Mermaid node ID */
  nodes: Record<string, NodeMetadata>;
}

export interface InteractiveHTMLOptions {
  /** Page title (defaults to workflow name) */
  title?: string;
  /** Initial theme name (defaults to system preference auto-detection) */
  theme?: string;
  /** Mermaid CDN URL (defaults to latest) */
  mermaidCdnUrl?: string;
  /** Diagram direction for display */
  direction?: "TB" | "LR" | "BT" | "RL";
}

// =============================================================================
// HTML Generation
// =============================================================================

/**
 * Generate a self-contained interactive HTML file.
 *
 * @param mermaidText - Mermaid flowchart text from renderStaticMermaid()
 * @param metadata - Workflow metadata from extractNodeMetadata()
 * @param options - HTML generation options
 */
export function generateInteractiveHTML(
  mermaidText: string,
  metadata: WorkflowMetadata,
  options: InteractiveHTMLOptions = {},
): string {
  const {
    title = metadata.workflowName,
    theme,
    mermaidCdnUrl = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
  } = options;

  const metadataJson = JSON.stringify(metadata, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Workflow Diagram</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="${mermaidCdnUrl}"></script>
  <style>
${generateCSS()}
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>${escapeHtml(title)}</h1>
      ${metadata.description ? `<p class="description">${escapeHtml(metadata.description)}</p>` : ""}
    </div>
    <div class="header-right">
      <span class="badge">${metadata.stats.totalSteps} steps</span>
      ${metadata.stats.conditionalCount > 0 ? `<span class="badge">${metadata.stats.conditionalCount} conditions</span>` : ""}
      ${metadata.stats.parallelCount > 0 ? `<span class="badge">${metadata.stats.parallelCount} parallel</span>` : ""}
      <span class="badge file">${escapeHtml(metadata.filePath)}</span>
      <div class="theme-picker">
        <button id="theme-btn" aria-label="Change theme" title="Change theme">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 1 0 12V2z" fill="currentColor"/></svg>
        </button>
        <div id="theme-menu" class="theme-menu" hidden>
          <div class="theme-menu-section">
            <span class="theme-menu-label">Dark</span>
            <button data-theme="midnight" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#0f1117,#1a1d2e)"></span>Midnight</button>
            <button data-theme="ocean" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#0a1628,#0f2847)"></span>Ocean</button>
            <button data-theme="ember" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#1a0f0f,#2a1515)"></span>Ember</button>
            <button data-theme="forest" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#0c1a0f,#132a18)"></span>Forest</button>
          </div>
          <div class="theme-menu-section">
            <span class="theme-menu-label">Light</span>
            <button data-theme="daylight" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#f8f9fb,#eef1f6)"></span>Daylight</button>
            <button data-theme="paper" class="theme-swatch"><span class="swatch" style="background:linear-gradient(135deg,#faf8f5,#f0ebe4)"></span>Paper</button>
          </div>
        </div>
      </div>
    </div>
  </header>
  <main>
    <div id="diagram">
      <pre class="mermaid">
${mermaidText}
      </pre>
    </div>
    <aside id="inspector">
      <div class="inspector-placeholder">
        <p>Click a node to inspect</p>
        <p class="hint">Hover over nodes to highlight</p>
      </div>
    </aside>
  </main>
  <script>
    const WORKFLOW_DATA = ${metadataJson};
    const INITIAL_THEME = ${theme ? `"${theme}"` : "null"};
${generateClientJS()}
  </script>
</body>
</html>`;
}

// =============================================================================
// CSS
// =============================================================================

function generateCSS(): string {
  return `
    /* ================================================================
       Theme Definitions — CSS custom properties per theme
       ================================================================ */

    /* Midnight — default dark */
    [data-theme="midnight"] {
      --bg: #0f1117; --bg-secondary: #161921; --bg-elevated: #1c1f2b;
      --fg: #d4d7e0; --fg-muted: #6b7084; --fg-dim: #464b5e;
      --border: #262a3a; --border-subtle: #1e2230;
      --accent: #7b9dea; --accent-dim: rgba(123,157,234,0.12); --accent-glow: rgba(123,157,234,0.25);
      --node-bg: #1e2235; --node-border: #363d55; --node-text: #c8ccda;
      --node-step-bg: #1c2640; --node-step-border: #2e4470; --node-step-text: #8ab4f8;
      --node-decision-bg: #2a1c3d; --node-decision-border: #4a3068; --node-decision-text: #c4a5e8;
      --node-start-bg: #152e1f; --node-start-border: #245a38; --node-start-text: #6fcf97;
      --node-end-bg: #2e1520; --node-end-border: #5a2438; --node-end-text: #ef8fa8;
      --node-parallel-bg: #1a2e2a; --node-parallel-border: #2a5a4a; --node-parallel-text: #6fd4b0;
      --node-saga-bg: #1e1a2e; --node-saga-border: #3a2e5a; --node-saga-text: #a8a0d4;
      --edge-color: #3d4460; --edge-label-bg: #1a1d2e; --edge-label-text: #8890a8;
      --scrollbar-track: #161921; --scrollbar-thumb: #2e3348;
      --mermaid-theme: dark;
    }

    /* Ocean — deep blue dark */
    [data-theme="ocean"] {
      --bg: #0a1628; --bg-secondary: #0f1e35; --bg-elevated: #142742;
      --fg: #c8d8ee; --fg-muted: #5a7a9e; --fg-dim: #3d5a7a;
      --border: #1a3452; --border-subtle: #152a42;
      --accent: #4da6e8; --accent-dim: rgba(77,166,232,0.12); --accent-glow: rgba(77,166,232,0.25);
      --node-bg: #122240; --node-border: #1e3a60; --node-text: #a8c8e8;
      --node-step-bg: #0f2848; --node-step-border: #1a4070; --node-step-text: #6abaef;
      --node-decision-bg: #1a1840; --node-decision-border: #2e2a68; --node-decision-text: #9a8ae8;
      --node-start-bg: #0a2a20; --node-start-border: #1a5040; --node-start-text: #4ad4a0;
      --node-end-bg: #2a1020; --node-end-border: #4a1a38; --node-end-text: #e86a90;
      --node-parallel-bg: #0a2830; --node-parallel-border: #1a4a58; --node-parallel-text: #4ad4cc;
      --node-saga-bg: #141030; --node-saga-border: #282060; --node-saga-text: #8a80d4;
      --edge-color: #2a4a6a; --edge-label-bg: #0f1e35; --edge-label-text: #6a8aaa;
      --scrollbar-track: #0f1e35; --scrollbar-thumb: #1a3a5a;
      --mermaid-theme: dark;
    }

    /* Ember — warm dark */
    [data-theme="ember"] {
      --bg: #1a0f0f; --bg-secondary: #221414; --bg-elevated: #2e1a1a;
      --fg: #e0d0c8; --fg-muted: #8a6a5e; --fg-dim: #5e4238;
      --border: #3a2222; --border-subtle: #2e1a1a;
      --accent: #e8845a; --accent-dim: rgba(232,132,90,0.12); --accent-glow: rgba(232,132,90,0.25);
      --node-bg: #2a1818; --node-border: #4a2828; --node-text: #d4b8a8;
      --node-step-bg: #2e1a12; --node-step-border: #5a3020; --node-step-text: #e8a878;
      --node-decision-bg: #2a1a28; --node-decision-border: #4a2848; --node-decision-text: #d0a0cc;
      --node-start-bg: #1a2a14; --node-start-border: #2a4a20; --node-start-text: #88c870;
      --node-end-bg: #2e1218; --node-end-border: #5a1a28; --node-end-text: #e8687a;
      --node-parallel-bg: #221a10; --node-parallel-border: #4a3818; --node-parallel-text: #d4b468;
      --node-saga-bg: #221218; --node-saga-border: #3a1a28; --node-saga-text: #c0808a;
      --edge-color: #4a3030; --edge-label-bg: #221414; --edge-label-text: #9a7868;
      --scrollbar-track: #221414; --scrollbar-thumb: #3a2828;
      --mermaid-theme: dark;
    }

    /* Forest — earthy dark */
    [data-theme="forest"] {
      --bg: #0c1a0f; --bg-secondary: #111f14; --bg-elevated: #18281a;
      --fg: #c8d8c8; --fg-muted: #5e7a5e; --fg-dim: #3e5a3e;
      --border: #1e3a20; --border-subtle: #182e1a;
      --accent: #5ac87a; --accent-dim: rgba(90,200,122,0.12); --accent-glow: rgba(90,200,122,0.25);
      --node-bg: #142818; --node-border: #204a28; --node-text: #a8c8a8;
      --node-step-bg: #122a18; --node-step-border: #1a4a28; --node-step-text: #68c888;
      --node-decision-bg: #1a1a28; --node-decision-border: #2a2a48; --node-decision-text: #a0a0d8;
      --node-start-bg: #102a18; --node-start-border: #185a30; --node-start-text: #58d890;
      --node-end-bg: #2a1418; --node-end-border: #4a2028; --node-end-text: #d87080;
      --node-parallel-bg: #0e2820; --node-parallel-border: #1a4a38; --node-parallel-text: #58c8a8;
      --node-saga-bg: #181828; --node-saga-border: #282848; --node-saga-text: #9898c0;
      --edge-color: #2a4a30; --edge-label-bg: #111f14; --edge-label-text: #6a8a6a;
      --scrollbar-track: #111f14; --scrollbar-thumb: #204a28;
      --mermaid-theme: dark;
    }

    /* Daylight — clean light */
    [data-theme="daylight"] {
      --bg: #f8f9fb; --bg-secondary: #ffffff; --bg-elevated: #ffffff;
      --fg: #1a2030; --fg-muted: #6a7488; --fg-dim: #9aa4b4;
      --border: #dde1ea; --border-subtle: #e8ecf2;
      --accent: #3a6fd8; --accent-dim: rgba(58,111,216,0.08); --accent-glow: rgba(58,111,216,0.15);
      --node-bg: #ffffff; --node-border: #c8d0e0; --node-text: #2a3448;
      --node-step-bg: #eaf2ff; --node-step-border: #a0c0ea; --node-step-text: #1a4080;
      --node-decision-bg: #f4eaff; --node-decision-border: #c0a0e0; --node-decision-text: #4a1a80;
      --node-start-bg: #e8f8ee; --node-start-border: #80c898; --node-start-text: #1a5030;
      --node-end-bg: #ffeaee; --node-end-border: #e098a8; --node-end-text: #801a30;
      --node-parallel-bg: #eaf8f4; --node-parallel-border: #80c8b0; --node-parallel-text: #1a5040;
      --node-saga-bg: #eeeaff; --node-saga-border: #a898d8; --node-saga-text: #30184a;
      --edge-color: #b0b8c8; --edge-label-bg: #f0f2f5; --edge-label-text: #5a6478;
      --scrollbar-track: #f0f2f5; --scrollbar-thumb: #c8cdd8;
      --mermaid-theme: default;
    }

    /* Paper — warm light */
    [data-theme="paper"] {
      --bg: #faf8f5; --bg-secondary: #fffefa; --bg-elevated: #fffefa;
      --fg: #2a2218; --fg-muted: #7a6e5e; --fg-dim: #a89a88;
      --border: #e0d8cc; --border-subtle: #e8e2d8;
      --accent: #b07830; --accent-dim: rgba(176,120,48,0.08); --accent-glow: rgba(176,120,48,0.15);
      --node-bg: #fffefa; --node-border: #d8ceb8; --node-text: #3a3020;
      --node-step-bg: #faf4e8; --node-step-border: #d0b880; --node-step-text: #5a4010;
      --node-decision-bg: #f8eefa; --node-decision-border: #c8a0d0; --node-decision-text: #5a1868;
      --node-start-bg: #f0f8ea; --node-start-border: #98c880; --node-start-text: #2a5018;
      --node-end-bg: #faf0e8; --node-end-border: #d8a880; --node-end-text: #6a3010;
      --node-parallel-bg: #eaf8f0; --node-parallel-border: #88c8a0; --node-parallel-text: #1a4830;
      --node-saga-bg: #f0eaf8; --node-saga-border: #a888c8; --node-saga-text: #381850;
      --edge-color: #c0b4a0; --edge-label-bg: #f4f0e8; --edge-label-text: #6a5e48;
      --scrollbar-track: #f0ebe0; --scrollbar-thumb: #c8bea8;
      --mermaid-theme: default;
    }

    /* ================================================================
       Base Layout & Typography
       ================================================================ */

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--fg);
      height: 100vh;
      overflow: hidden;
      transition: background 0.3s ease, color 0.3s ease;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      min-height: 44px;
      transition: background 0.3s ease, border-color 0.3s ease;
    }

    .header-left h1 {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--fg);
    }
    .header-left .description {
      font-size: 12px;
      color: var(--fg-muted);
      margin-top: 2px;
    }

    .header-right {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--accent-dim);
      color: var(--accent);
      letter-spacing: 0.01em;
      transition: background 0.3s ease, color 0.3s ease;
    }
    .badge.file {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg-muted);
      background: transparent;
      border: 1px solid var(--border);
    }

    /* ================================================================
       Theme Picker
       ================================================================ */

    .theme-picker {
      position: relative;
    }

    #theme-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      color: var(--fg-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    #theme-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-dim);
    }

    .theme-menu {
      position: absolute;
      top: 38px;
      right: 0;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px;
      min-width: 160px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      z-index: 1000;
      animation: menuIn 0.15s ease;
    }
    .theme-menu[hidden] { display: none; }

    @keyframes menuIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .theme-menu-section { padding: 4px 0; }
    .theme-menu-section + .theme-menu-section { border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 8px; }

    .theme-menu-label {
      display: block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-dim);
      padding: 2px 8px 4px;
    }

    .theme-swatch {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 5px 8px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--fg);
      font-family: 'DM Sans', sans-serif;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    .theme-swatch:hover { background: var(--accent-dim); }
    .theme-swatch.active { background: var(--accent-dim); color: var(--accent); font-weight: 600; }

    .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }

    /* ================================================================
       Main Layout
       ================================================================ */

    main {
      display: flex;
      height: calc(100vh - 44px);
    }

    #diagram {
      flex: 1;
      overflow: auto;
      padding: 32px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: var(--bg);
      transition: background 0.3s ease;
    }

    #diagram svg {
      max-width: 100%;
      height: auto;
    }

    /* ================================================================
       Mermaid SVG Overrides — force node colors per theme
       ================================================================ */

    /* All node shapes: override Mermaid's embedded pastel classDef fills */
    #diagram .node rect,
    #diagram .node polygon,
    #diagram .node circle,
    #diagram .node .basic {
      fill: var(--node-bg) !important;
      stroke: var(--node-border) !important;
      stroke-width: 1.5px !important;
      transition: fill 0.3s ease, stroke 0.3s ease;
    }

    /* Node text */
    #diagram .node .nodeLabel,
    #diagram .node .label {
      color: var(--node-text) !important;
      fill: var(--node-text) !important;
      font-family: 'JetBrains Mono', monospace !important;
      font-size: 12px !important;
      font-weight: 500 !important;
    }

    /* Step nodes (rectangles) — match by Mermaid ID pattern */
    #diagram [id*="flowchart-step_"] rect,
    #diagram .node.stepStyle rect {
      fill: var(--node-step-bg) !important;
      stroke: var(--node-step-border) !important;
    }
    #diagram [id*="flowchart-step_"] .nodeLabel,
    #diagram .node.stepStyle .nodeLabel {
      color: var(--node-step-text) !important;
      fill: var(--node-step-text) !important;
    }

    /* Saga step nodes */
    #diagram [id*="flowchart-saga_step_"] rect,
    #diagram .node.sagaStepStyle rect {
      fill: var(--node-saga-bg) !important;
      stroke: var(--node-saga-border) !important;
    }
    #diagram [id*="flowchart-saga_step_"] .nodeLabel,
    #diagram .node.sagaStepStyle .nodeLabel {
      color: var(--node-saga-text) !important;
      fill: var(--node-saga-text) !important;
    }

    /* Decision/conditional nodes (diamonds) */
    #diagram [id*="flowchart-decision_"] polygon,
    #diagram .node.conditionalStyle polygon {
      fill: var(--node-decision-bg) !important;
      stroke: var(--node-decision-border) !important;
    }
    #diagram [id*="flowchart-decision_"] .nodeLabel,
    #diagram .node.conditionalStyle .nodeLabel {
      color: var(--node-decision-text) !important;
      fill: var(--node-decision-text) !important;
    }

    /* Start node (circle) */
    #diagram [id*="flowchart-start"] circle,
    #diagram .node.startStyle circle {
      fill: var(--node-start-bg) !important;
      stroke: var(--node-start-border) !important;
    }
    #diagram [id*="flowchart-start"] .nodeLabel,
    #diagram .node.startStyle .nodeLabel {
      color: var(--node-start-text) !important;
      fill: var(--node-start-text) !important;
    }

    /* End node (circle) */
    #diagram [id*="flowchart-end_node"] circle,
    #diagram .node.endStyle circle {
      fill: var(--node-end-bg) !important;
      stroke: var(--node-end-border) !important;
    }
    #diagram [id*="flowchart-end_node"] .nodeLabel,
    #diagram .node.endStyle .nodeLabel {
      color: var(--node-end-text) !important;
      fill: var(--node-end-text) !important;
    }

    /* Parallel fork/join */
    #diagram [id*="flowchart-parallel_fork_"] rect,
    #diagram [id*="flowchart-parallel_join_"] rect,
    #diagram .node.parallelStyle rect {
      fill: var(--node-parallel-bg) !important;
      stroke: var(--node-parallel-border) !important;
    }
    #diagram [id*="flowchart-parallel_fork_"] .nodeLabel,
    #diagram [id*="flowchart-parallel_join_"] .nodeLabel,
    #diagram .node.parallelStyle .nodeLabel {
      color: var(--node-parallel-text) !important;
      fill: var(--node-parallel-text) !important;
    }

    /* Edges */
    #diagram .edge-pattern-solid,
    #diagram .flowchart-link {
      stroke: var(--edge-color) !important;
    }
    #diagram .edgeLabel {
      background: var(--edge-label-bg) !important;
      color: var(--edge-label-text) !important;
    }
    #diagram .edgeLabel .edgeLabel {
      background: transparent !important;
      color: var(--edge-label-text) !important;
      fill: var(--edge-label-text) !important;
      font-family: 'JetBrains Mono', monospace !important;
      font-size: 10px !important;
      font-weight: 500 !important;
    }
    #diagram .edgeLabel rect {
      fill: var(--edge-label-bg) !important;
      stroke: none !important;
    }
    /* Arrow markers */
    #diagram marker path {
      fill: var(--edge-color) !important;
      stroke: var(--edge-color) !important;
    }

    /* ================================================================
       Node Interaction States
       ================================================================ */

    #diagram .node { cursor: pointer; }

    #diagram .node:hover rect,
    #diagram .node:hover polygon,
    #diagram .node:hover circle {
      filter: brightness(1.3) !important;
      stroke-width: 2px !important;
    }

    #diagram .node.selected rect,
    #diagram .node.selected polygon,
    #diagram .node.selected circle {
      stroke: var(--accent) !important;
      stroke-width: 2.5px !important;
      filter: drop-shadow(0 0 8px var(--accent-glow)) !important;
    }

    /* ================================================================
       Inspector Panel
       ================================================================ */

    #inspector {
      width: 320px;
      min-width: 320px;
      border-left: 1px solid var(--border);
      background: var(--bg-secondary);
      overflow-y: auto;
      font-size: 13px;
      transition: background 0.3s ease, border-color 0.3s ease;
    }
    #inspector::-webkit-scrollbar { width: 5px; }
    #inspector::-webkit-scrollbar-track { background: var(--scrollbar-track); }
    #inspector::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }

    .inspector-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: var(--fg-dim);
      text-align: center;
    }
    .inspector-placeholder p { margin: 4px 0; font-size: 13px; }
    .inspector-placeholder .hint { font-size: 11px; color: var(--fg-dim); }

    .inspector-content { padding: 16px; }

    .inspector-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }
    .inspector-type {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--accent-dim);
      color: var(--accent);
    }
    .inspector-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 600;
    }

    .inspector-section { margin-bottom: 14px; }
    .inspector-section h3 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-dim);
      margin-bottom: 6px;
    }

    .inspector-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .inspector-row .label {
      color: var(--fg-muted);
      font-size: 12px;
    }
    .inspector-row .value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      text-align: right;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg);
    }

    .inspector-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      padding: 8px 10px;
      border-radius: 5px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--accent);
    }

    .inspector-tag {
      display: inline-block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--accent-dim);
      color: var(--accent);
      margin: 2px 2px 2px 0;
    }

    /* ================================================================
       Responsive
       ================================================================ */

    @media (max-width: 768px) {
      main { flex-direction: column; }
      #inspector { width: 100%; min-width: 100%; max-height: 40vh; border-left: none; border-top: 1px solid var(--border); }
    }
  `;
}

// =============================================================================
// Client-side JavaScript
// =============================================================================

function generateClientJS(): string {
  return `
    (function() {
      'use strict';

      // ================================================================
      // Theme System
      // ================================================================

      const DARK_THEMES = ['midnight', 'ocean', 'ember', 'forest'];
      const LIGHT_THEMES = ['daylight', 'paper'];
      const STORAGE_KEY = 'awaitly-viz-theme';

      function getSystemPreference() {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'midnight';
      }

      function resolveTheme() {
        if (INITIAL_THEME) return INITIAL_THEME;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
        return getSystemPreference();
      }

      function applyTheme(name) {
        document.documentElement.setAttribute('data-theme', name);
        localStorage.setItem(STORAGE_KEY, name);

        // Update theme menu active state
        document.querySelectorAll('.theme-swatch').forEach(function(btn) {
          btn.classList.toggle('active', btn.dataset.theme === name);
        });

        // Re-render Mermaid with matching theme
        rerenderMermaid(DARK_THEMES.includes(name) ? 'dark' : 'default');
      }

      var currentMermaidTheme = null;
      var mermaidSource = document.querySelector('.mermaid').textContent;

      function rerenderMermaid(mermaidThemeName) {
        if (mermaidThemeName === currentMermaidTheme) return;
        currentMermaidTheme = mermaidThemeName;

        var diagramEl = document.getElementById('diagram');
        // Clear existing
        diagramEl.innerHTML = '<pre class="mermaid">' + mermaidSource + '</pre>';

        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidThemeName,
          themeVariables: mermaidThemeName === 'dark' ? {
            darkMode: true,
            background: 'transparent',
            primaryColor: '#1e2235',
            primaryTextColor: '#c8ccda',
            primaryBorderColor: '#363d55',
            lineColor: '#3d4460',
            secondaryColor: '#2a1c3d',
            tertiaryColor: '#152e1f',
          } : {
            darkMode: false,
            background: 'transparent',
            primaryColor: '#ffffff',
            primaryTextColor: '#2a3448',
            primaryBorderColor: '#c8d0e0',
            lineColor: '#b0b8c8',
            secondaryColor: '#f4eaff',
            tertiaryColor: '#e8f8ee',
          },
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
          securityLevel: 'loose',
        });

        mermaid.run({ querySelector: '.mermaid' }).then(function() {
          setTimeout(function() {
            stripMermaidInlineStyles();
            attachHandlers();
          }, 50);
        });
      }

      // Listen for system theme changes
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(e) {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(e.matches ? 'daylight' : 'midnight');
        }
      });

      // ================================================================
      // Theme Picker UI
      // ================================================================

      var themeBtn = document.getElementById('theme-btn');
      var themeMenu = document.getElementById('theme-menu');

      themeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        themeMenu.hidden = !themeMenu.hidden;
      });

      document.addEventListener('click', function() {
        themeMenu.hidden = true;
      });

      themeMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        var btn = e.target.closest('[data-theme]');
        if (btn) {
          applyTheme(btn.dataset.theme);
          themeMenu.hidden = true;
        }
      });

      // ================================================================
      // Mermaid Init & Click Handlers
      // ================================================================

      // Strip Mermaid's inline style="fill:... !important" so CSS custom properties win
      function stripMermaidInlineStyles() {
        var svg = document.querySelector('#diagram svg');
        if (!svg) return;

        // Remove inline fill/stroke from shape elements inside nodes
        svg.querySelectorAll('.node rect, .node polygon, .node circle, .node .basic').forEach(function(el) {
          el.removeAttribute('style');
        });

        // Also strip inline styles from edge labels and edges
        svg.querySelectorAll('.edgeLabel, .edgeLabel rect, .edgeLabel .edgeLabel').forEach(function(el) {
          el.removeAttribute('style');
        });

        // Strip marker styles
        svg.querySelectorAll('marker path').forEach(function(el) {
          el.removeAttribute('style');
        });

        // Strip edge line styles
        svg.querySelectorAll('.edge-pattern-solid, .flowchart-link').forEach(function(el) {
          el.removeAttribute('style');
        });
      }

      var selectedNodeId = null;

      function attachHandlers() {
        var svg = document.querySelector('#diagram svg');
        if (!svg) return;

        svg.querySelectorAll('.node').forEach(function(node) {
          node.style.cursor = 'pointer';
          node.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodeId = extractNodeId(node);
            if (nodeId) selectNode(nodeId, node);
          });
        });

        svg.addEventListener('click', function(e) {
          if (e.target === svg || e.target.closest('.node') === null) {
            deselectAll();
          }
        });
      }

      function extractNodeId(nodeEl) {
        var id = nodeEl.id || '';
        var match = id.match(/^flowchart-(.+?)-\\d+$/);
        if (match) return match[1];
        return nodeEl.getAttribute('data-id') || null;
      }

      function selectNode(mermaidId, nodeEl) {
        document.querySelectorAll('.node.selected').forEach(function(n) {
          n.classList.remove('selected');
        });
        nodeEl.classList.add('selected');
        selectedNodeId = mermaidId;

        var meta = WORKFLOW_DATA.nodes[mermaidId];
        if (meta) {
          renderInspector(meta);
        } else {
          renderInspectorFallback(mermaidId);
        }
      }

      function deselectAll() {
        document.querySelectorAll('.node.selected').forEach(function(n) {
          n.classList.remove('selected');
        });
        selectedNodeId = null;
        document.getElementById('inspector').innerHTML =
          '<div class="inspector-placeholder"><p>Click a node to inspect</p><p class="hint">Hover over nodes to highlight</p></div>';
      }

      function renderInspector(meta) {
        var inspector = document.getElementById('inspector');
        var html = '<div class="inspector-content">';

        html += '<div class="inspector-header">';
        html += '<span class="inspector-type">' + esc(meta.type) + '</span>';
        html += '<span class="inspector-name">' + esc(meta.name) + '</span>';
        html += '</div>';

        if (meta.stepId || meta.callee) {
          html += '<div class="inspector-section"><h3>Identity</h3>';
          if (meta.stepId) html += row('Step ID', meta.stepId);
          if (meta.callee) html += row('Callee', meta.callee);
          if (meta.mermaidId) html += row('Node ID', meta.mermaidId);
          html += '</div>';
        }

        if (meta.description) {
          html += '<div class="inspector-section"><h3>Description</h3>';
          html += '<div class="inspector-code">' + esc(meta.description) + '</div></div>';
        }

        if (meta.inputType || meta.outputType) {
          html += '<div class="inspector-section"><h3>Types</h3>';
          if (meta.inputType) html += row('Input', meta.inputType);
          if (meta.outputType) html += row('Output', meta.outputType);
          html += '</div>';
        }

        if (meta.out || (meta.reads && meta.reads.length > 0)) {
          html += '<div class="inspector-section"><h3>Data Flow</h3>';
          if (meta.out) html += row('Writes to', 'ctx.' + meta.out);
          if (meta.reads && meta.reads.length > 0) {
            html += row('Reads', meta.reads.map(function(r) { return 'ctx.' + r; }).join(', '));
          }
          html += '</div>';
        }

        if (meta.retry || meta.timeout) {
          html += '<div class="inspector-section"><h3>Resilience</h3>';
          if (meta.retry) {
            html += row('Retry attempts', String(meta.retry.attempts || '?'));
            if (meta.retry.backoff) html += row('Backoff', String(meta.retry.backoff));
            if (meta.retry.baseDelay) html += row('Base delay', meta.retry.baseDelay + 'ms');
          }
          if (meta.timeout) html += row('Timeout', (meta.timeout.ms || '?') + 'ms');
          html += '</div>';
        }

        if (meta.condition) {
          html += '<div class="inspector-section"><h3>Condition</h3>';
          html += '<div class="inspector-code">' + esc(meta.condition) + '</div>';
          if (meta.helper) html += row('Helper', meta.helper);
          html += '</div>';
        }

        if (meta.expression) {
          html += '<div class="inspector-section"><h3>Switch Expression</h3>';
          html += '<div class="inspector-code">' + esc(meta.expression) + '</div>';
          if (meta.cases) {
            html += '<div style="margin-top:6px">';
            meta.cases.forEach(function(c) {
              html += '<span class="inspector-tag">' + (c.isDefault ? 'default' : esc(c.value || '?')) + '</span>';
            });
            html += '</div>';
          }
          html += '</div>';
        }

        if (meta.loopType) {
          html += '<div class="inspector-section"><h3>Loop</h3>';
          html += row('Type', meta.loopType);
          if (meta.iterSource) html += row('Source', meta.iterSource);
          if (meta.boundCount !== undefined) html += row('Iterations', String(meta.boundCount));
          html += '</div>';
        }

        if (meta.mode || meta.childCount !== undefined) {
          html += '<div class="inspector-section"><h3>Execution</h3>';
          if (meta.mode) html += row('Mode', meta.mode);
          if (meta.childCount !== undefined) html += row('Branches', String(meta.childCount));
          html += '</div>';
        }

        if (meta.hasCompensation !== undefined) {
          html += '<div class="inspector-section"><h3>Saga</h3>';
          html += row('Compensation', meta.hasCompensation ? 'Yes' : 'No');
          if (meta.compensationCallee) html += row('Compensation fn', meta.compensationCallee);
          html += '</div>';
        }

        if (meta.workflowName && meta.type === 'workflow-ref') {
          html += '<div class="inspector-section"><h3>Reference</h3>';
          html += row('Workflow', meta.workflowName);
          html += row('Resolved', meta.resolved ? 'Yes' : 'No');
          html += '</div>';
        }

        if (meta.errors && meta.errors.length > 0) {
          html += '<div class="inspector-section"><h3>Error Tags</h3><div>';
          meta.errors.forEach(function(err) {
            html += '<span class="inspector-tag">' + esc(err) + '</span>';
          });
          html += '</div></div>';
        }

        if (meta.location) {
          html += '<div class="inspector-section"><h3>Source</h3>';
          html += row('File', meta.location.filePath);
          html += row('Line', String(meta.location.line));
          html += '</div>';
        }

        html += '</div>';
        inspector.innerHTML = html;
      }

      function renderInspectorFallback(mermaidId) {
        var inspector = document.getElementById('inspector');
        var name = mermaidId;
        if (mermaidId === 'start') name = 'Start';
        else if (mermaidId === 'end_node') name = 'End';
        inspector.innerHTML = '<div class="inspector-content">' +
          '<div class="inspector-header">' +
          '<span class="inspector-type">node</span>' +
          '<span class="inspector-name">' + esc(name) + '</span>' +
          '</div>' +
          '<div class="inspector-section"><p style="color:var(--fg-dim)">No additional metadata for this node.</p></div>' +
          '</div>';
      }

      function row(label, value) {
        return '<div class="inspector-row"><span class="label">' + esc(label) + '</span><span class="value" title="' + esc(value) + '">' + esc(value) + '</span></div>';
      }

      function esc(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      // ================================================================
      // Boot
      // ================================================================

      var initialTheme = resolveTheme();
      applyTheme(initialTheme);
    })();
  `;
}

// =============================================================================
// Utilities
// =============================================================================

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
