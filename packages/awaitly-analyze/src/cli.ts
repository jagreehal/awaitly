/**
 * CLI for awaitly-analyze
 *
 * Analyzes TypeScript workflow files and outputs Mermaid diagrams or JSON.
 *
 * Usage:
 *   npx awaitly-analyze ./src/workflows/checkout.ts
 *   npx awaitly-analyze ./src/workflows/checkout.ts --format=json
 *   npx awaitly-analyze ./src/workflows/checkout.ts --keys
 *   npx awaitly-analyze ./src/workflows/checkout.ts --direction=LR
 */

import { resolve } from "path";
import { analyze } from "./analyze";
import { renderStaticMermaid } from "./output/mermaid";
import { renderMultipleStaticJSON } from "./output/json";

type Direction = "TB" | "LR" | "BT" | "RL";
type Format = "mermaid" | "json";

interface CliOptions {
  filePath: string;
  format: Format;
  showKeys: boolean;
  direction: Direction;
  help: boolean;
}

function printHelp(): void {
  console.log(`
awaitly-analyze - Static workflow analysis tool

Usage:
  awaitly-analyze <file> [options]

Arguments:
  <file>                Path to TypeScript file containing workflow(s)

Options:
  --format=<format>     Output format: mermaid (default) or json
  --keys                Show step cache keys in diagram
  --direction=<dir>     Diagram direction: TB (default), LR, BT, RL
  --help, -h            Show this help message

Examples:
  awaitly-analyze ./src/workflows/checkout.ts
  awaitly-analyze ./src/workflows/checkout.ts --format=json
  awaitly-analyze ./src/workflows/checkout.ts --keys --direction=LR
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    filePath: "",
    format: "mermaid",
    showKeys: false,
    direction: "TB",
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--keys") {
      options.showKeys = true;
    } else if (arg.startsWith("--format=")) {
      const format = arg.slice("--format=".length).toLowerCase();
      if (format === "json" || format === "mermaid") {
        options.format = format;
      } else {
        console.error(`Unknown format: ${format}. Use 'mermaid' or 'json'.`);
        process.exit(1);
      }
    } else if (arg.startsWith("--direction=")) {
      const dir = arg.slice("--direction=".length).toUpperCase() as Direction;
      if (["TB", "LR", "BT", "RL"].includes(dir)) {
        options.direction = dir;
      } else {
        console.error(`Unknown direction: ${dir}. Use TB, LR, BT, or RL.`);
        process.exit(1);
      }
    } else if (!arg.startsWith("-")) {
      options.filePath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.filePath) {
    console.error("Error: No file path provided.\n");
    printHelp();
    process.exit(1);
  }

  const filePath = resolve(options.filePath);

  try {
    const workflows = analyze(filePath).all();

    if (workflows.length === 0) {
      console.error(`No workflows found in ${options.filePath}`);
      process.exit(1);
    }

    if (options.format === "json") {
      // JSON output
      const json = renderMultipleStaticJSON(workflows, filePath, {
        pretty: true,
      });
      console.log(json);
    } else {
      // Mermaid output
      if (workflows.length === 1) {
        // Single workflow - just output the diagram
        const mermaid = renderStaticMermaid(workflows[0], {
          direction: options.direction,
          showKeys: options.showKeys,
        });
        console.log(mermaid);
      } else {
        // Multiple workflows - output each with a header
        for (const ir of workflows) {
          console.log(`## Workflow: ${ir.root.workflowName}\n`);
          const mermaid = renderStaticMermaid(ir, {
            direction: options.direction,
            showKeys: options.showKeys,
          });
          console.log(mermaid);
          console.log();
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("An unknown error occurred");
    }
    process.exit(1);
  }
}

main();
