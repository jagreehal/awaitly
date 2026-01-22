#!/usr/bin/env node
/**
 * Awaitly Static Workflow Analyzer CLI
 *
 * Analyzes TypeScript workflow files and outputs Mermaid diagrams or JSON.
 *
 * Usage:
 *   awaitly-analyze <file.ts> [options]
 *
 * Examples:
 *   awaitly-analyze ./src/workflows/checkout.ts
 *   awaitly-analyze ./src/workflows/checkout.ts --format=json
 *   awaitly-analyze ./src/workflows/checkout.ts > workflow.md
 */

import { cli } from "./cli";

cli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});
