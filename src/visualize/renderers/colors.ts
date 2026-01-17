/**
 * ANSI color utilities for terminal output.
 */

import type { ColorScheme, StepState } from "../types";

// =============================================================================
// ANSI Escape Codes
// =============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// Foreground colors
const FG_RED = "\x1b[31m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_BLUE = "\x1b[34m";
const FG_GRAY = "\x1b[90m";
const FG_WHITE = "\x1b[37m";

// =============================================================================
// Color Functions
// =============================================================================

/**
 * Apply ANSI color to text.
 */
export function colorize(text: string, color: string): string {
  if (!color) return text;
  return `${color}${text}${RESET}`;
}

/**
 * Make text bold.
 */
export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

/**
 * Make text dim.
 */
export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

// =============================================================================
// Default Color Scheme
// =============================================================================

/**
 * Default ANSI color scheme for step states.
 */
export const defaultColorScheme: ColorScheme = {
  pending: FG_WHITE,
  running: FG_YELLOW,
  success: FG_GREEN,
  error: FG_RED,
  aborted: FG_GRAY,
  cached: FG_BLUE,
  skipped: DIM + FG_GRAY, // Dim gray for skipped steps
};

// =============================================================================
// State Symbols
// =============================================================================

/**
 * Get the symbol for a step state.
 */
export function getStateSymbol(state: StepState): string {
  switch (state) {
    case "pending":
      return "○"; // Empty circle
    case "running":
      return "⟳"; // Rotating arrows
    case "success":
      return "✓"; // Check mark
    case "error":
      return "✗"; // X mark
    case "aborted":
      return "⊘"; // Circled slash
    case "cached":
      return "↺"; // Cached/replay
    case "skipped":
      return "⊘"; // Circled slash (same as aborted, but different color)
  }
}

/**
 * Get the colored symbol for a step state.
 */
export function getColoredSymbol(state: StepState, colors: ColorScheme): string {
  const symbol = getStateSymbol(state);
  return colorize(symbol, colors[state]);
}

/**
 * Get colored text based on step state.
 */
export function colorByState(
  text: string,
  state: StepState,
  colors: ColorScheme
): string {
  return colorize(text, colors[state]);
}

// =============================================================================
// Strip ANSI
// =============================================================================

/**
 * Strip ANSI escape codes from a string.
 * Useful for calculating visible string length.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get the visible length of a string (without ANSI codes).
 */
export function visibleLength(str: string): string {
  return stripAnsi(str);
}
