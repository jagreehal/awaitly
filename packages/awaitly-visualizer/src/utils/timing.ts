/**
 * Timing utilities for workflow visualization.
 */

/**
 * Format duration in milliseconds to a human-readable string.
 *
 * @example
 * formatDuration(23) // "23ms"
 * formatDuration(1500) // "1.5s"
 * formatDuration(65000) // "1m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    const seconds = ms / 1000;
    // Show one decimal for seconds
    return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  }

  let minutes = Math.floor(ms / 60000);
  let seconds = Math.round((ms % 60000) / 1000);
  if (seconds >= 60) {
    minutes += 1;
    seconds = 0;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Generate a unique ID for nodes.
 */
export function generateId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
