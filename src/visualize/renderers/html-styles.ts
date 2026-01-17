/**
 * HTML Visualizer Styles
 *
 * CSS styles for the interactive HTML workflow visualizer.
 * Supports light, dark, and auto (system preference) themes.
 */

/**
 * Generate CSS styles for the HTML visualizer.
 */
export function generateStyles(theme: "light" | "dark" | "auto"): string {
  const lightColors = {
    bg: "#ffffff",
    bgSecondary: "#f8f9fa",
    text: "#212529",
    textMuted: "#6c757d",
    border: "#dee2e6",
    primary: "#0d6efd",
    success: "#198754",
    error: "#dc3545",
    warning: "#ffc107",
    info: "#0dcaf0",
    muted: "#6c757d",
    // Node colors
    nodePending: "#e9ecef",
    nodeRunning: "#fff3cd",
    nodeSuccess: "#d1e7dd",
    nodeError: "#f8d7da",
    nodeAborted: "#e9ecef",
    nodeCached: "#cfe2ff",
    nodeSkipped: "#f8f9fa",
    // Heatmap colors
    heatCold: "#0d6efd",
    heatCool: "#0dcaf0",
    heatNeutral: "#6c757d",
    heatWarm: "#ffc107",
    heatHot: "#fd7e14",
    heatCritical: "#dc3545",
  };

  const darkColors = {
    bg: "#212529",
    bgSecondary: "#343a40",
    text: "#f8f9fa",
    textMuted: "#adb5bd",
    border: "#495057",
    primary: "#0d6efd",
    success: "#198754",
    error: "#dc3545",
    warning: "#ffc107",
    info: "#0dcaf0",
    muted: "#6c757d",
    // Node colors
    nodePending: "#495057",
    nodeRunning: "#664d03",
    nodeSuccess: "#0f5132",
    nodeError: "#842029",
    nodeAborted: "#495057",
    nodeCached: "#084298",
    nodeSkipped: "#343a40",
    // Heatmap colors
    heatCold: "#0d6efd",
    heatCool: "#0dcaf0",
    heatNeutral: "#6c757d",
    heatWarm: "#ffc107",
    heatHot: "#fd7e14",
    heatCritical: "#dc3545",
  };

  const generateThemeVars = (colors: typeof lightColors) => `
    --bg: ${colors.bg};
    --bg-secondary: ${colors.bgSecondary};
    --text: ${colors.text};
    --text-muted: ${colors.textMuted};
    --border: ${colors.border};
    --primary: ${colors.primary};
    --success: ${colors.success};
    --error: ${colors.error};
    --warning: ${colors.warning};
    --info: ${colors.info};
    --muted: ${colors.muted};
    --node-pending: ${colors.nodePending};
    --node-running: ${colors.nodeRunning};
    --node-success: ${colors.nodeSuccess};
    --node-error: ${colors.nodeError};
    --node-aborted: ${colors.nodeAborted};
    --node-cached: ${colors.nodeCached};
    --node-skipped: ${colors.nodeSkipped};
    --heat-cold: ${colors.heatCold};
    --heat-cool: ${colors.heatCool};
    --heat-neutral: ${colors.heatNeutral};
    --heat-warm: ${colors.heatWarm};
    --heat-hot: ${colors.heatHot};
    --heat-critical: ${colors.heatCritical};
  `;

  let themeCSS: string;

  if (theme === "auto") {
    themeCSS = `
      :root {
        ${generateThemeVars(lightColors)}
      }
      @media (prefers-color-scheme: dark) {
        :root {
          ${generateThemeVars(darkColors)}
        }
      }
    `;
  } else if (theme === "dark") {
    themeCSS = `
      :root {
        ${generateThemeVars(darkColors)}
      }
    `;
  } else {
    themeCSS = `
      :root {
        ${generateThemeVars(lightColors)}
      }
    `;
  }

  return `
${themeCSS}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

.workflow-visualizer {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Header */
.wv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.wv-header h1 {
  font-size: 1.25rem;
  font-weight: 600;
}

.wv-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.wv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid var(--border);
  border-radius: 6px;
  background-color: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
}

.wv-btn:hover {
  background-color: var(--bg-secondary);
}

.wv-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: var(--bg-secondary);
  color: var(--text-muted);
}

.wv-btn--primary {
  background-color: var(--primary);
  border-color: var(--primary);
  color: white;
}

.wv-btn--primary:hover {
  opacity: 0.9;
}

.wv-btn--icon {
  padding: 6px;
  min-width: 32px;
}

/* Main content area */
.wv-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Diagram container */
.wv-diagram {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: var(--bg);
  background-image:
    radial-gradient(circle, var(--border) 1px, transparent 1px);
  background-size: 20px 20px;
}

.wv-diagram svg {
  width: 100%;
  height: 100%;
}

/* SVG Node styles */
.wv-node {
  cursor: pointer;
  transition: filter 0.15s ease;
}

.wv-node:hover {
  filter: brightness(1.1) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
}

.wv-node rect,
.wv-node circle {
  stroke: var(--border);
  stroke-width: 2;
  transition: all 0.2s ease;
}

.wv-node:hover rect,
.wv-node:hover circle {
  stroke-width: 3;
}

.wv-node--pending rect { fill: var(--node-pending); }
.wv-node--running rect { fill: var(--node-running); stroke: var(--warning); }
.wv-node--success rect { fill: var(--node-success); stroke: var(--success); }
.wv-node--error rect { fill: var(--node-error); stroke: var(--error); }
.wv-node--aborted rect { fill: var(--node-aborted); }
.wv-node--cached rect { fill: var(--node-cached); stroke: var(--info); }
.wv-node--skipped rect { fill: var(--node-skipped); opacity: 0.6; }

.wv-node--selected rect {
  stroke: var(--primary);
  stroke-width: 3;
}

.wv-node text {
  fill: var(--text);
  font-size: 12px;
  font-weight: 500;
  dominant-baseline: middle;
  text-anchor: middle;
}

.wv-node .wv-node-timing {
  fill: var(--text-muted);
  font-size: 10px;
}

/* Edge styles */
.wv-edge {
  fill: none;
  stroke: var(--border);
  stroke-width: 2;
}

.wv-edge--active {
  stroke: var(--success);
  stroke-width: 2.5;
}

.wv-edge-arrow {
  fill: var(--border);
}

/* Parallel/Race container */
.wv-container {
  fill: transparent;
  stroke: var(--border);
  stroke-dasharray: 5 3;
}

.wv-container--parallel { stroke: var(--info); }
.wv-container--race { stroke: var(--warning); }

.wv-container-label {
  fill: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Heatmap overlay */
.wv-node--heat-cold rect { fill: var(--heat-cold) !important; opacity: 0.7; }
.wv-node--heat-cool rect { fill: var(--heat-cool) !important; opacity: 0.7; }
.wv-node--heat-neutral rect { fill: var(--heat-neutral) !important; opacity: 0.7; }
.wv-node--heat-warm rect { fill: var(--heat-warm) !important; opacity: 0.7; }
.wv-node--heat-hot rect { fill: var(--heat-hot) !important; opacity: 0.7; }
.wv-node--heat-critical rect { fill: var(--heat-critical) !important; opacity: 0.85; }

/* Timeline scrubber */
.wv-timeline {
  height: 80px;
  padding: 12px 20px;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

.wv-timeline-track {
  position: relative;
  height: 24px;
  background-color: var(--bg);
  border-radius: 4px;
  overflow: hidden;
}

.wv-timeline-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background-color: var(--primary);
  opacity: 0.3;
  transition: width 0.1s ease;
}

.wv-timeline-marker {
  position: absolute;
  top: 0;
  width: 3px;
  height: 100%;
  background-color: var(--primary);
  cursor: ew-resize;
}

.wv-timeline-events {
  display: flex;
  gap: 2px;
  height: 100%;
  align-items: center;
  padding: 4px;
}

.wv-timeline-event {
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background-color: var(--muted);
}

.wv-timeline-event--success { background-color: var(--success); }
.wv-timeline-event--error { background-color: var(--error); }
.wv-timeline-event--running { background-color: var(--warning); }

.wv-timeline-controls {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

.wv-timeline-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: monospace;
}

/* Inspector panel */
.wv-inspector {
  width: 320px;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  transition: width 0.2s ease;
}

.wv-inspector--collapsed {
  width: 0;
}

.wv-inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.wv-inspector-header h2 {
  font-size: 0.875rem;
  font-weight: 600;
}

.wv-inspector-content {
  padding: 16px;
}

.wv-inspector-section {
  margin-bottom: 20px;
}

.wv-inspector-section h3 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.wv-inspector-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.875rem;
}

.wv-inspector-label {
  color: var(--text-muted);
}

.wv-inspector-value {
  font-weight: 500;
  font-family: monospace;
}

.wv-inspector-value--success { color: var(--success); }
.wv-inspector-value--error { color: var(--error); }
.wv-inspector-value--running { color: var(--warning); }

/* Status badge */
.wv-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 4px;
  text-transform: capitalize;
}

.wv-badge--pending { background-color: var(--node-pending); }
.wv-badge--running { background-color: var(--node-running); color: #664d03; }
.wv-badge--success { background-color: var(--node-success); color: #0f5132; }
.wv-badge--error { background-color: var(--node-error); color: #842029; }
.wv-badge--cached { background-color: var(--node-cached); color: #084298; }

/* Live indicator */
.wv-live {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: var(--error);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 4px;
}

.wv-live-dot {
  width: 8px;
  height: 8px;
  background-color: white;
  border-radius: 50%;
  animation: wv-pulse 1.5s infinite;
}

@keyframes wv-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Performance stats */
.wv-perf-bar {
  height: 8px;
  background-color: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}

.wv-perf-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.wv-perf-bar-fill--cold { background-color: var(--heat-cold); }
.wv-perf-bar-fill--cool { background-color: var(--heat-cool); }
.wv-perf-bar-fill--neutral { background-color: var(--heat-neutral); }
.wv-perf-bar-fill--warm { background-color: var(--heat-warm); }
.wv-perf-bar-fill--hot { background-color: var(--heat-hot); }
.wv-perf-bar-fill--critical { background-color: var(--heat-critical); }

/* Tooltip */
.wv-tooltip {
  position: fixed;
  padding: 8px 12px;
  background-color: var(--text);
  color: var(--bg);
  font-size: 0.75rem;
  border-radius: 4px;
  pointer-events: none;
  z-index: 1000;
  max-width: 300px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Loading state */
.wv-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.wv-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: wv-spin 1s linear infinite;
  margin-right: 8px;
}

@keyframes wv-spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.wv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  text-align: center;
  padding: 40px;
}

.wv-empty svg {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* Modal */
.wv-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.wv-modal-content {
  background-color: var(--bg);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.wv-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.wv-modal-header h2 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.wv-modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.wv-modal-body p {
  margin: 0 0 12px 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.wv-modal-body code {
  background-color: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-family: monospace;
}

.wv-textarea {
  width: 100%;
  padding: 12px;
  font-family: monospace;
  font-size: 0.875rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background-color: var(--bg);
  color: var(--text);
  resize: vertical;
  box-sizing: border-box;
}

.wv-textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.wv-error {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--node-error);
  color: #842029;
  border-radius: 6px;
  font-size: 0.875rem;
}

.wv-modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

/* Responsive */
@media (max-width: 768px) {
  .wv-inspector {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
  }

  .wv-timeline {
    height: auto;
  }

  .wv-modal-content {
    width: 95%;
    max-height: 95vh;
  }
}
`;
}
