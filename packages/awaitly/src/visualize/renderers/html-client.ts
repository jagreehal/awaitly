/**
 * HTML Visualizer Client-Side JavaScript
 *
 * Handles interactivity in the browser:
 * - Zoom and pan
 * - Node selection and inspection
 * - Time-travel controls
 * - WebSocket live updates
 * - Heatmap toggle
 */

/**
 * Generate client-side JavaScript for the HTML visualizer.
 */
export function generateClientScript(options: {
  wsUrl?: string;
  interactive: boolean;
  timeTravel: boolean;
  heatmap: boolean;
}): string {
  return `
(function() {
  'use strict';

  // State
  let selectedNodeId = null;
  let transform = { x: 0, y: 0, scale: 1 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let ws = null;
  let snapshots = [];
  let currentSnapshotIndex = -1;
  let isPlaying = false;
  let playbackSpeed = 1;
  let heatmapEnabled = false;
  let heatmapMetric = 'duration';

  // DOM elements
  const diagram = document.getElementById('diagram');
  const svg = diagram?.querySelector('svg');
  const inspector = document.getElementById('inspector');
  const timeline = document.getElementById('timeline');

  // Initialize
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    ${options.interactive ? "setupInteractivity(); setupLoadJSON();" : ""}
    // WebSocket must be initialized before time-travel and heatmap checks
    ${options.wsUrl ? `setupWebSocket('${options.wsUrl}');` : ""}
    ${options.timeTravel ? "setupTimeTravel(); initializeTimeTravelFromData();" : ""}
    ${options.heatmap ? "setupHeatmap();" : ""}
    setupKeyboardShortcuts();
  }

  // Load JSON functionality
  function setupLoadJSON() {
    const loadBtn = document.getElementById('load-json-btn');
    const modal = document.getElementById('load-json-modal');
    const closeBtn = document.getElementById('load-json-close');
    const cancelBtn = document.getElementById('load-json-cancel');
    const submitBtn = document.getElementById('load-json-submit');
    const input = document.getElementById('load-json-input');
    const errorDiv = document.getElementById('load-json-error');

    if (!loadBtn || !modal) return;

    loadBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      if (input) {
        input.value = '';
        input.focus();
      }
      if (errorDiv) errorDiv.style.display = 'none';
    });

    const closeModal = () => {
      modal.style.display = 'none';
      if (errorDiv) errorDiv.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    submitBtn?.addEventListener('click', () => {
      if (!input) return;
      
      try {
        const jsonText = input.value.trim();
        if (!jsonText) {
          showError('Please paste JSON data');
          return;
        }

        const ir = JSON.parse(jsonText);
        
        // Validate IR structure
        if (!ir || !ir.root || !ir.root.type || ir.root.type !== 'workflow') {
          showError('Invalid workflow IR. Expected object with root.type === "workflow"');
          return;
        }

        // Update global data
        window.__WORKFLOW_IR__ = ir;
        const newData = buildWorkflowDataFromIR(ir);
        window.__WORKFLOW_DATA__ = newData;

        // Save to sessionStorage for full rebuild on reload
        try {
          sessionStorage.setItem('workflow_ir', JSON.stringify(ir));
        } catch (storageErr) {
          console.warn('Failed to save IR to sessionStorage:', storageErr);
        }

        // Rebuild the diagram (updates node states in-place)
        rebuildDiagram(ir);

        // Update inspector if node is selected
        if (selectedNodeId) {
          updateInspector(selectedNodeId);
        }

        closeModal();

        // Offer full rebuild via reload if structure changed significantly
        console.log('IR loaded. Node states updated. Reload page for full layout rebuild with new structure.');
      } catch (e) {
        showError('Invalid JSON: ' + e.message);
      }
    });

    function showError(message) {
      if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
      }
    }
  }

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

        if (node.children) {
          collectNodes(node.children);
        }
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

  function rebuildDiagram(ir) {
    // Update workflow data and node states
    const newData = buildWorkflowDataFromIR(ir);
    window.__WORKFLOW_DATA__ = newData;
    window.__WORKFLOW_IR__ = ir;
    
    // Update existing node states in SVG
    renderIR(ir);
    
    // Note: Full diagram rebuild (new nodes, layout changes) requires regenerating the HTML
    // For now, we update node states. Users can save the IR and regenerate HTML for full rebuild.
    console.log('Workflow IR loaded. Node states updated. For full diagram rebuild, regenerate HTML with the new IR.');
  }

  function initializeTimeTravelFromData() {
    // For static HTML (no WebSocket), time travel doesn't work since we only have one state
    // Initialize with empty snapshots and disable controls
    if (!ws) {
      snapshots = [];
      currentSnapshotIndex = -1;
      updateTimelineUI();
      
      // Disable time travel controls for static HTML
      const playBtn = document.getElementById('tt-play');
      const pauseBtn = document.getElementById('tt-pause');
      const prevBtn = document.getElementById('tt-prev');
      const nextBtn = document.getElementById('tt-next');
      const slider = document.getElementById('tt-slider');
      
      [playBtn, pauseBtn, prevBtn, nextBtn, slider].forEach(btn => {
        if (btn) {
          btn.disabled = true;
          btn.title = 'Time travel requires a live WebSocket connection';
        }
      });
    }
  }

  // Interactivity
  function setupInteractivity() {
    if (!diagram || !svg) return;

    // Zoom with mouse wheel
    diagram.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = diagram.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Zoom towards cursor position
      transform.scale *= delta;
      transform.scale = Math.max(0.1, Math.min(5, transform.scale));
      transform.x = x - (x - transform.x) * delta;
      transform.y = y - (y - transform.y) * delta;

      applyTransform();
    });

    // Pan with drag
    diagram.addEventListener('mousedown', (e) => {
      if (e.target === diagram || e.target === svg) {
        isDragging = true;
        dragStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
        diagram.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      transform.x = e.clientX - dragStart.x;
      transform.y = e.clientY - dragStart.y;
      applyTransform();
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      if (diagram) diagram.style.cursor = 'grab';
    });

    // Node selection - handle clicks on nodes and their children (rect, text, etc.)
    document.querySelectorAll('.wv-node').forEach((node) => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = node.dataset.nodeId;
        if (nodeId) {
          selectNode(nodeId);
        }
      });
    });

    // Also handle clicks directly on child elements (rect, text) that bubble up
    if (svg) {
      svg.addEventListener('click', (e) => {
        // Find the closest .wv-node parent
        let target = e.target;
        while (target && target !== svg) {
          if (target.classList && target.classList.contains('wv-node')) {
            const nodeId = target.dataset?.nodeId;
            if (nodeId) {
              e.stopPropagation();
              selectNode(nodeId);
              return;
            }
          }
          target = target.parentElement;
        }
      });
    }

    // Deselect on background click
    diagram.addEventListener('click', (e) => {
      if (e.target === diagram || e.target === svg) {
        selectNode(null);
      }
    });

    // Zoom buttons
    document.getElementById('zoom-in')?.addEventListener('click', () => zoom(1.2));
    document.getElementById('zoom-out')?.addEventListener('click', () => zoom(0.8));
    document.getElementById('zoom-reset')?.addEventListener('click', resetZoom);

    // Set initial cursor
    diagram.style.cursor = 'grab';
  }

  function applyTransform() {
    if (!svg) return;
    const g = svg.querySelector('g.wv-root');
    if (g) {
      g.setAttribute('transform', 'translate(' + transform.x + ',' + transform.y + ') scale(' + transform.scale + ')');
    }
  }

  function zoom(factor) {
    if (!diagram) return;
    const rect = diagram.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    transform.scale *= factor;
    transform.scale = Math.max(0.1, Math.min(5, transform.scale));
    transform.x = centerX - (centerX - transform.x) * factor;
    transform.y = centerY - (centerY - transform.y) * factor;

    applyTransform();
  }

  function resetZoom() {
    transform = { x: 0, y: 0, scale: 1 };
    applyTransform();
  }

  function selectNode(nodeId) {
    // Remove previous selection
    document.querySelectorAll('.wv-node--selected').forEach((n) => {
      n.classList.remove('wv-node--selected');
    });

    selectedNodeId = nodeId;

    if (nodeId) {
      const node = document.querySelector('[data-node-id="' + nodeId + '"]');
      if (node) {
        node.classList.add('wv-node--selected');
        updateInspector(nodeId);
      }
    } else {
      clearInspector();
    }
  }

  function updateInspector(nodeId) {
    const content = document.getElementById('inspector-content');
    if (!content) return;

    const nodeData = window.__WORKFLOW_DATA__?.nodes?.[nodeId];
    if (!nodeData) {
      // Clear and add empty message using safe DOM methods
      while (content.firstChild) content.removeChild(content.firstChild);
      const p = document.createElement('p');
      p.className = 'wv-empty';
      p.textContent = 'No data available';
      content.appendChild(p);
      return;
    }

    renderInspectorContent(content, nodeData);
  }

  function renderInspectorContent(container, node) {
    // Clear container using safe DOM method
    while (container.firstChild) container.removeChild(container.firstChild);

    // Node Info section
    const infoSection = createSection('Node Info');
    infoSection.appendChild(createRow('Name', node.name || node.id));
    infoSection.appendChild(createRow('Type', node.type));

    // State badge
    const stateRow = document.createElement('div');
    stateRow.className = 'wv-inspector-row';
    const stateLabel = document.createElement('span');
    stateLabel.className = 'wv-inspector-label';
    stateLabel.textContent = 'State';
    const stateBadge = document.createElement('span');
    stateBadge.className = 'wv-badge wv-badge--' + node.state;
    stateBadge.textContent = node.state;
    stateRow.appendChild(stateLabel);
    stateRow.appendChild(stateBadge);
    infoSection.appendChild(stateRow);

    if (node.key) {
      infoSection.appendChild(createRow('Key', node.key));
    }
    container.appendChild(infoSection);

    // Timing section
    if (node.durationMs !== undefined) {
      const timingSection = createSection('Timing');
      timingSection.appendChild(createRow('Duration', formatDuration(node.durationMs)));
      if (node.startTs) {
        timingSection.appendChild(createRow('Started', new Date(node.startTs).toLocaleTimeString()));
      }
      container.appendChild(timingSection);
    }

    // Retries section
    if (node.retryCount !== undefined && node.retryCount > 0) {
      const retrySection = createSection('Retries');
      retrySection.appendChild(createRow('Retry Count', String(node.retryCount)));
      container.appendChild(retrySection);
    }

    // Error section
    if (node.error) {
      const errorSection = createSection('Error');
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:11px;overflow:auto;max-height:150px;background:var(--bg);padding:8px;border-radius:4px;';
      pre.textContent = String(node.error);
      errorSection.appendChild(pre);
      container.appendChild(errorSection);
    }
  }

  function createSection(title) {
    const section = document.createElement('div');
    section.className = 'wv-inspector-section';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    section.appendChild(h3);
    return section;
  }

  function createRow(label, value) {
    const row = document.createElement('div');
    row.className = 'wv-inspector-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'wv-inspector-label';
    labelSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'wv-inspector-value';
    valueSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    return row;
  }

  function clearInspector() {
    const content = document.getElementById('inspector-content');
    if (content) {
      while (content.firstChild) content.removeChild(content.firstChild);
      const p = document.createElement('p');
      p.className = 'wv-empty';
      p.textContent = 'Select a node to inspect';
      content.appendChild(p);
    }
  }

  // Time Travel
  function setupTimeTravel() {
    const playBtn = document.getElementById('tt-play');
    const pauseBtn = document.getElementById('tt-pause');
    const prevBtn = document.getElementById('tt-prev');
    const nextBtn = document.getElementById('tt-next');
    const speedSelect = document.getElementById('tt-speed');
    const slider = document.getElementById('tt-slider');

    playBtn?.addEventListener('click', play);
    pauseBtn?.addEventListener('click', pause);
    prevBtn?.addEventListener('click', stepBackward);
    nextBtn?.addEventListener('click', stepForward);
    speedSelect?.addEventListener('change', (e) => {
      playbackSpeed = parseFloat(e.target.value);
    });
    slider?.addEventListener('input', (e) => {
      seek(parseInt(e.target.value, 10));
    });
  }

  function play() {
    if (snapshots.length === 0) {
      console.warn('[Visualizer] No snapshots available for time travel. Time travel requires a live WebSocket connection.');
      return;
    }
    isPlaying = true;
    updatePlaybackUI();
    playNext();
  }

  function pause() {
    isPlaying = false;
    updatePlaybackUI();
  }

  function playNext() {
    if (!isPlaying) return;
    if (currentSnapshotIndex < snapshots.length - 1) {
      const current = snapshots[currentSnapshotIndex];
      const next = snapshots[currentSnapshotIndex + 1];
      const delay = (next.timestamp - current.timestamp) / playbackSpeed;

      setTimeout(() => {
        stepForward();
        playNext();
      }, Math.max(16, delay));
    } else {
      pause();
    }
  }

  function stepForward() {
    if (snapshots.length === 0) {
      console.warn('[Visualizer] No snapshots available for time travel.');
      return;
    }
    if (currentSnapshotIndex < snapshots.length - 1) {
      seek(currentSnapshotIndex + 1);
    }
  }

  function stepBackward() {
    if (snapshots.length === 0) {
      console.warn('[Visualizer] No snapshots available for time travel.');
      return;
    }
    if (currentSnapshotIndex > 0) {
      seek(currentSnapshotIndex - 1);
    }
  }

  function seek(index) {
    if (index < 0 || index >= snapshots.length) return;
    currentSnapshotIndex = index;
    updateTimelineUI();

    // Request IR update from server or use cached
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'time_travel_seek', payload: { index } }));
    } else if (snapshots[index]?.ir) {
      renderIR(snapshots[index].ir);
    }
  }

  function updatePlaybackUI() {
    const playBtn = document.getElementById('tt-play');
    const pauseBtn = document.getElementById('tt-pause');

    if (playBtn) playBtn.style.display = isPlaying ? 'none' : 'inline-flex';
    if (pauseBtn) pauseBtn.style.display = isPlaying ? 'inline-flex' : 'none';
  }

  function updateTimelineUI() {
    const slider = document.getElementById('tt-slider');
    const timeDisplay = document.getElementById('tt-time');

    if (slider) {
      slider.max = String(Math.max(0, snapshots.length - 1));
      slider.value = String(currentSnapshotIndex);
    }

    if (timeDisplay) {
      timeDisplay.textContent = (currentSnapshotIndex + 1) + ' / ' + snapshots.length;
    }
  }

  // WebSocket
  function setupWebSocket(url) {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[Visualizer] Connected to server');
      showLiveIndicator(true);
    };

    ws.onclose = () => {
      console.log('[Visualizer] Disconnected from server');
      showLiveIndicator(false);
      // Attempt reconnect after 2 seconds
      setTimeout(() => setupWebSocket(url), 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('[Visualizer] Failed to parse message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[Visualizer] WebSocket error:', error);
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'ir_update':
        renderIR(msg.payload);
        break;
      case 'snapshot':
        snapshots.push(msg.payload);
        currentSnapshotIndex = snapshots.length - 1;
        updateTimelineUI();
        break;
      case 'snapshots_list':
        snapshots = msg.payload;
        currentSnapshotIndex = snapshots.length - 1;
        updateTimelineUI();
        break;
      case 'performance_data':
        window.__PERFORMANCE_DATA__ = msg.payload;
        if (heatmapEnabled) applyHeatmap();
        break;
      case 'workflow_complete':
        showLiveIndicator(false);
        break;
      case 'time_travel_state':
        currentSnapshotIndex = msg.payload.currentIndex;
        isPlaying = msg.payload.isPlaying;
        playbackSpeed = msg.payload.playbackSpeed;
        updateTimelineUI();
        updatePlaybackUI();
        break;
    }
  }

  function showLiveIndicator(show) {
    const indicator = document.getElementById('live-indicator');
    if (indicator) {
      indicator.style.display = show ? 'flex' : 'none';
    }
  }

  // Heatmap
  function setupHeatmap() {
    const toggle = document.getElementById('heatmap-toggle');
    const metricSelect = document.getElementById('heatmap-metric');

    // For static HTML (no WebSocket), disable heatmap controls
    if (!ws) {
      if (toggle) {
        toggle.disabled = true;
        toggle.title = 'Heatmap requires a live WebSocket connection with performance data';
      }
      if (metricSelect) {
        metricSelect.disabled = true;
        metricSelect.title = 'Heatmap requires a live WebSocket connection with performance data';
      }
      return;
    }

    toggle?.addEventListener('click', () => {
      heatmapEnabled = !heatmapEnabled;
      toggle.classList.toggle('wv-btn--primary', heatmapEnabled);
      if (heatmapEnabled) {
        applyHeatmap();
      } else {
        removeHeatmap();
      }
    });

    metricSelect?.addEventListener('change', (e) => {
      heatmapMetric = e.target.value;
      if (heatmapEnabled) applyHeatmap();
    });
  }

  function applyHeatmap() {
    const perfData = window.__PERFORMANCE_DATA__;
    if (!perfData) return;

    document.querySelectorAll('.wv-node').forEach((node) => {
      const nodeId = node.dataset.nodeId;
      const heat = perfData.heat?.[nodeId];

      // Remove existing heat classes
      node.classList.remove(
        'wv-node--heat-cold',
        'wv-node--heat-cool',
        'wv-node--heat-neutral',
        'wv-node--heat-warm',
        'wv-node--heat-hot',
        'wv-node--heat-critical'
      );

      if (heat !== undefined) {
        const level = getHeatLevel(heat);
        node.classList.add('wv-node--heat-' + level);
      }
    });
  }

  function removeHeatmap() {
    document.querySelectorAll('.wv-node').forEach((node) => {
      node.classList.remove(
        'wv-node--heat-cold',
        'wv-node--heat-cool',
        'wv-node--heat-neutral',
        'wv-node--heat-warm',
        'wv-node--heat-hot',
        'wv-node--heat-critical'
      );
    });
  }

  function getHeatLevel(heat) {
    if (heat < 0.2) return 'cold';
    if (heat < 0.4) return 'cool';
    if (heat < 0.6) return 'neutral';
    if (heat < 0.8) return 'warm';
    if (heat < 0.95) return 'hot';
    return 'critical';
  }

  // Keyboard shortcuts
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          isPlaying ? pause() : play();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepForward();
          break;
        case '0':
          resetZoom();
          break;
        case '+':
        case '=':
          zoom(1.2);
          break;
        case '-':
          zoom(0.8);
          break;
        case 'h':
          ${options.heatmap ? "document.getElementById('heatmap-toggle')?.click();" : ""}
          break;
        case 'Escape':
          selectNode(null);
          break;
      }
    });
  }

  // Render functions
  function renderIR(ir) {
    // Store node data for inspector
    window.__WORKFLOW_DATA__ = {
      nodes: flattenNodes(ir.root.children).reduce((acc, n) => {
        acc[n.id] = n;
        return acc;
      }, {})
    };

    // Update SVG node states
    document.querySelectorAll('.wv-node').forEach((node) => {
      const nodeId = node.dataset.nodeId;
      const nodeData = window.__WORKFLOW_DATA__.nodes[nodeId];
      if (nodeData) {
        // Update state class
        node.className = node.className.replace(/wv-node--\\w+/g, '');
        node.classList.add('wv-node', 'wv-node--' + nodeData.state);

        // Update timing text if present
        const timing = node.querySelector('.wv-node-timing');
        if (timing && nodeData.durationMs !== undefined) {
          timing.textContent = formatDuration(nodeData.durationMs);
        }
      }
    });

    // Update selected node inspector
    if (selectedNodeId) {
      updateInspector(selectedNodeId);
    }
  }

  function flattenNodes(nodes) {
    const result = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children) {
        result.push(...flattenNodes(node.children));
      }
      if (node.branches) {
        for (const branch of node.branches) {
          result.push(...flattenNodes(branch.children));
        }
      }
    }
    return result;
  }

  // Utilities
  function formatDuration(ms) {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
    return (ms / 60000).toFixed(1) + 'm';
  }
})();
`;
}
