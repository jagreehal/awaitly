/**
 * Browser Test for Awaitly
 *
 * This tests that:
 * 1. Browser-safe modules import correctly
 * 2. createVisualizer works in browser (from awaitly-visualizer)
 * 3. createLiveVisualizer throws helpful error
 * 4. No node: imports are pulled in
 */

import {
  createVisualizer,
  createLiveVisualizer,
  asciiRenderer,
  mermaidRenderer,
  createIRBuilder,
  trackIf,
} from 'awaitly-visualizer';

import { ok, err, isOk } from 'awaitly/core';

const app = document.getElementById('app')!;

function log(message: string, isError = false) {
  const p = document.createElement('p');
  p.className = isError ? 'error' : 'success';
  p.textContent = message;
  app.appendChild(p);
}

function logCode(title: string, code: string) {
  const h2 = document.createElement('h2');
  h2.textContent = title;
  app.appendChild(h2);

  const pre = document.createElement('pre');
  pre.textContent = code;
  app.appendChild(pre);
}

async function runTests() {
  log('Starting browser tests...');

  // Test 1: Core imports work
  try {
    const result = ok(42);
    if (isOk(result) && result.value === 42) {
      log('✓ Core imports work (ok, isOk)');
    }
  } catch (e) {
    log(`✗ Core imports failed: ${e}`, true);
  }

  // Test 2: createVisualizer works
  try {
    const viz = createVisualizer({ workflowName: 'browser-test' });

    // Simulate workflow events
    viz.handleEvent({
      type: 'workflow_start',
      workflowId: 'test-1',
      ts: Date.now(),
    });

    viz.handleEvent({
      type: 'step_start',
      workflowId: 'test-1',
      stepKey: 'step-1',
      name: 'Fetch data',
      ts: Date.now(),
    });

    viz.handleEvent({
      type: 'step_success',
      workflowId: 'test-1',
      stepKey: 'step-1',
      name: 'Fetch data',
      result: { data: 'test' },
      ts: Date.now(),
      durationMs: 100,
    });

    viz.handleEvent({
      type: 'workflow_success',
      workflowId: 'test-1',
      result: { data: 'test' },
      ts: Date.now(),
      durationMs: 100,
    });

    const output = viz.render();
    log('✓ createVisualizer works in browser');
    logCode('ASCII Output', output);

    // Test mermaid output
    const mermaidOutput = viz.renderAs('mermaid');
    logCode('Mermaid Output', mermaidOutput);
  } catch (e) {
    log(`✗ createVisualizer failed: ${e}`, true);
  }

  // Test 3: createLiveVisualizer throws helpful error
  try {
    createLiveVisualizer();
    log('✗ createLiveVisualizer should have thrown', true);
  } catch (e) {
    if (e instanceof Error && e.message.includes('not available in browser')) {
      log('✓ createLiveVisualizer throws helpful browser error');
    } else {
      log(`✗ createLiveVisualizer threw wrong error: ${e}`, true);
    }
  }

  // Test 4: Other browser-safe exports work
  try {
    const ascii = asciiRenderer();
    const mermaid = mermaidRenderer();
    const builder = createIRBuilder();
    log('✓ Renderers and IR builder work');
  } catch (e) {
    log(`✗ Renderers failed: ${e}`, true);
  }

  // Test 5: Decision tracking works
  try {
    const decision = trackIf('role-check', true, {
      condition: 'user.role === "admin"',
    });
    decision.then();
    decision.end();
    log('✓ Decision tracking works');
  } catch (e) {
    log(`✗ Decision tracking failed: ${e}`, true);
  }

  log('');
  log('All browser tests completed!');
}

runTests();
