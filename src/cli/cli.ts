/**
 * CLI Implementation for Static Workflow Analyzer
 */

import { existsSync } from "fs";
import { resolve } from "path";
import {
  analyzeWorkflow,
  renderStaticMermaid,
  renderMultipleStaticJSON,
  type MermaidOptions,
} from "../analyze";

// =============================================================================
// Types
// =============================================================================

interface CLIOptions {
  filePath: string | undefined;
  format: "mermaid" | "json";
  showKeys: boolean;
  direction: "TB" | "LR" | "BT" | "RL";
  showConditions: boolean;
  help: boolean;
}

// =============================================================================
// Main CLI Function
// =============================================================================

export async function cli(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // Handle help
  if (options.help) {
    printUsage();
    return;
  }

  // Validate input file
  if (!options.filePath) {
    console.error("Error: No file specified\n");
    printUsage();
    process.exit(1);
  }

  const filePath = resolve(options.filePath);
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    // Run analysis
    const results = await analyzeWorkflow(filePath);

    if (results.length === 0) {
      console.error("Warning: No workflows found in file.");
      console.error(
        "Ensure the file contains createWorkflow() definitions with invocations."
      );
      process.exit(0);
    }

    // Print any warnings to stderr
    for (const ir of results) {
      for (const warning of ir.metadata.warnings) {
        console.error(`Warning [${warning.code}]: ${warning.message}`);
      }
    }

    // Render output
    const output = renderOutput(results, filePath, options);

    // Write to stdout (enables piping)
    process.stdout.write(output);
    process.stdout.write("\n");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("WASM")) {
      console.error(
        "Error: Failed to load tree-sitter. Try reinstalling awaitly."
      );
    } else {
      console.error(`Parse error: ${errorMessage}`);
    }
    process.exit(1);
  }
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    filePath: undefined,
    format: "mermaid",
    showKeys: false,
    direction: "TB",
    showConditions: true,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--format=")) {
      const format = arg.slice("--format=".length);
      if (format === "mermaid" || format === "json") {
        options.format = format;
      } else {
        console.error(`Warning: Unknown format '${format}', using 'mermaid'`);
      }
    } else if (arg === "--keys") {
      options.showKeys = true;
    } else if (arg.startsWith("--direction=")) {
      const dir = arg.slice("--direction=".length).toUpperCase();
      if (dir === "TB" || dir === "LR" || dir === "BT" || dir === "RL") {
        options.direction = dir;
      } else {
        console.error(`Warning: Unknown direction '${dir}', using 'TB'`);
      }
    } else if (arg === "--no-conditions") {
      options.showConditions = false;
    } else if (!arg.startsWith("-")) {
      // Positional argument - treat as file path
      options.filePath = arg;
    } else {
      console.error(`Warning: Unknown option '${arg}'`);
    }
  }

  return options;
}

// =============================================================================
// Output Rendering
// =============================================================================

function renderOutput(
  results: Awaited<ReturnType<typeof analyzeWorkflow>>,
  filePath: string,
  options: CLIOptions
): string {
  if (options.format === "json") {
    return renderMultipleStaticJSON(results, filePath, { pretty: true });
  }

  // Mermaid format - render each workflow with a header
  const mermaidOptions: MermaidOptions = {
    direction: options.direction,
    showKeys: options.showKeys,
    showConditions: options.showConditions,
  };

  const sections: string[] = [];

  for (const ir of results) {
    const header = `## Workflow: ${ir.root.workflowName}`;
    const diagram = renderStaticMermaid(ir, mermaidOptions);

    sections.push(`${header}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``);
  }

  return sections.join("\n\n");
}

// =============================================================================
// Help Text
// =============================================================================

function printUsage(): void {
  console.log(`
awaitly-analyze - Static Workflow Analyzer

Analyzes TypeScript workflow files and outputs Mermaid diagrams or JSON.

USAGE:
  awaitly-analyze <file.ts> [options]

ARGUMENTS:
  <file.ts>              TypeScript file containing workflow definitions

OPTIONS:
  --format=<format>      Output format: mermaid (default), json
  --keys                 Show step cache keys in diagram
  --direction=<dir>      Diagram direction: TB, LR, BT, RL (default: TB)
  --no-conditions        Hide condition labels on edges
  -h, --help             Show this help message

EXAMPLES:
  # Generate Mermaid diagram
  awaitly-analyze ./src/workflows/checkout.ts

  # Output as JSON
  awaitly-analyze ./src/workflows/checkout.ts --format=json

  # Save to file
  awaitly-analyze ./src/workflows/checkout.ts > workflow.md

  # Horizontal layout with cache keys
  awaitly-analyze ./src/workflows/checkout.ts --direction=LR --keys

OUTPUT:
  For Mermaid format, outputs markdown with mermaid code blocks.
  For JSON format, outputs the full StaticWorkflowIR structure.
  Multiple workflows in a file are output with headers.
`);
}
