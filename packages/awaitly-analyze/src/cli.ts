/**
 * CLI for awaitly-analyze
 *
 * Analyzes TypeScript workflow files and outputs Mermaid diagrams, JSON, or interactive HTML.
 *
 * Usage:
 *   npx awaitly-analyze ./src/workflows/checkout.ts
 *   npx awaitly-analyze ./src/workflows/checkout.ts --format=json
 *   npx awaitly-analyze ./src/workflows/checkout.ts --html -o
 *   npx awaitly-analyze ./src/workflows/checkout.ts --keys --direction=LR
 */

import { resolve, dirname, basename, extname, join } from "path";
import { writeFileSync } from "fs";
import { analyze } from "./analyze";
import { renderStaticMermaid } from "./output/mermaid";
import { renderMultipleStaticJSON } from "./output/json";
import { renderWorkflowDSL } from "./output/dsl";
import { extractNodeMetadata, generateInteractiveHTML } from "./output/html";
import { writeDSLToAwaitlyDirSync, DEFAULT_DSL_OUTPUT_FOLDER } from "./awaitly-dir";

type Direction = "TB" | "LR" | "BT" | "RL";
type Format = "mermaid" | "json";

/** "off" = don't write; ".awaitly" = write to .awaitly/dsl/; or custom path */
type DslOutputOption = "off" | ".awaitly" | string;

interface CliOptions {
  filePath: string;
  format: Format;
  showKeys: boolean;
  direction: Direction;
  help: boolean;
  outputAdjacent: boolean;
  suffix: string;
  noStdout: boolean;
  dslOutput: DslOutputOption;
  html: boolean;
  htmlOutput: string;
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
  --html                Generate interactive HTML file (Mermaid CDN + click-to-inspect)
  --html-output=<path>  Output path for HTML file (default: <basename>.html)
  --keys                Show step cache keys in diagram
  --direction=<dir>     Diagram direction: TB (default), LR, BT, RL
  --output-adjacent, -o Write output file next to source file
  --suffix=<value>      Configurable suffix for output file (default: workflow)
  --no-stdout           Suppress stdout when writing to file (requires -o)
  --dsl-output=<value>  Write DSL: off (default), .awaitly, or custom path
  --write-dsl           Shorthand for --dsl-output=.awaitly
  --help, -h             Show this help message

Examples:
  awaitly-analyze ./src/workflows/checkout.ts
  awaitly-analyze ./src/workflows/checkout.ts --format=json
  awaitly-analyze ./src/workflows/checkout.ts --html
  awaitly-analyze ./src/workflows/checkout.ts --html --html-output=docs/checkout.html
  awaitly-analyze ./src/workflows/checkout.ts --keys --direction=LR
  awaitly-analyze ./src/workflows/checkout.ts --output-adjacent
  awaitly-analyze ./src/workflows/checkout.ts -o --suffix=diagram
  awaitly-analyze ./src/workflows/checkout.ts -o --suffix=analysis --format=json
  awaitly-analyze ./src/workflows/checkout.ts -o --no-stdout
  awaitly-analyze ./src/workflows/checkout.ts --dsl-output=.awaitly
  awaitly-analyze ./src/workflows/checkout.ts --dsl-output=dist/dsl
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    filePath: "",
    format: "mermaid",
    showKeys: false,
    direction: "TB",
    help: false,
    outputAdjacent: false,
    suffix: "workflow",
    noStdout: false,
    dslOutput: "off",
    html: false,
    htmlOutput: "",
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--html") {
      options.html = true;
    } else if (arg.startsWith("--html-output=")) {
      const value = arg.slice("--html-output=".length).trim();
      if (value.length === 0) {
        console.error("Error: --html-output requires a non-empty path.");
        process.exit(1);
      }
      options.htmlOutput = value;
      options.html = true;
    } else if (arg === "--keys") {
      options.showKeys = true;
    } else if (arg === "--output-adjacent" || arg === "-o") {
      options.outputAdjacent = true;
    } else if (arg === "--no-stdout") {
      options.noStdout = true;
    } else if (arg === "--write-dsl") {
      options.dslOutput = DEFAULT_DSL_OUTPUT_FOLDER;
    } else if (arg.startsWith("--dsl-output=")) {
      const value = arg.slice("--dsl-output=".length).trim();
      if (value === "off" || value === ".awaitly" || value.length > 0) {
        options.dslOutput = value;
      } else {
        console.error("Error: --dsl-output requires a value (off, .awaitly, or a path).");
        process.exit(1);
      }
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
    } else if (arg.startsWith("--suffix=")) {
      const suffix = arg.slice("--suffix=".length);
      if (suffix.includes("/") || suffix.includes("\\")) {
        console.error("Error: suffix cannot contain path separators.");
        process.exit(1);
      }
      options.suffix = suffix;
    } else if (!arg.startsWith("-")) {
      options.filePath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function getOutputFilePath(
  inputPath: string,
  suffix: string,
  format: Format
): string {
  const dir = dirname(inputPath);
  const ext = extname(inputPath);
  const base = basename(inputPath, ext);
  const outputExt = format === "json" ? ".json" : ".md";
  return join(dir, `${base}.${suffix}${outputExt}`);
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

  // Validate: --no-stdout requires --output-adjacent
  if (options.noStdout && !options.outputAdjacent) {
    console.error("Error: --no-stdout requires --output-adjacent (-o).");
    process.exit(1);
  }

  const filePath = resolve(options.filePath);

  try {
    const workflows = analyze(filePath).all();

    if (workflows.length === 0) {
      console.error(`No workflows found in ${options.filePath}`);
      process.exit(1);
    }

    // Generate interactive HTML if --html
    if (options.html) {
      if (options.htmlOutput && workflows.length > 1) {
        console.error("Error: cannot use --html-output with multiple workflows; each workflow needs its own file.");
        process.exit(1);
      }
      for (const ir of workflows) {
        const mermaidText = renderStaticMermaid(ir, {
          direction: options.direction,
          showKeys: options.showKeys,
        });
        const metadata = extractNodeMetadata(ir);
        const htmlContent = generateInteractiveHTML(mermaidText, metadata, {
          direction: options.direction,
        });

        // Determine output path
        let htmlPath: string;
        if (options.htmlOutput) {
          htmlPath = resolve(options.htmlOutput);
        } else {
          const dir = dirname(filePath);
          const ext = extname(filePath);
          const base = basename(filePath, ext);
          const suffix = workflows.length > 1 ? `.${ir.root.workflowName}` : "";
          htmlPath = join(dir, `${base}${suffix}.html`);
        }

        writeFileSync(htmlPath, htmlContent, "utf-8");
        console.error(`Wrote HTML: ${htmlPath}`);
      }
    }

    let output: string;

    if (options.format === "json") {
      // JSON output
      output = renderMultipleStaticJSON(workflows, filePath, {
        pretty: true,
      });
    } else {
      // Mermaid output
      if (workflows.length === 1) {
        // Single workflow - just output the diagram
        output = renderStaticMermaid(workflows[0], {
          direction: options.direction,
          showKeys: options.showKeys,
        });
      } else {
        // Multiple workflows - output each with a header
        const parts: string[] = [];
        for (const ir of workflows) {
          parts.push(`## Workflow: ${ir.root.workflowName}\n`);
          const mermaid = renderStaticMermaid(ir, {
            direction: options.direction,
            showKeys: options.showKeys,
          });
          parts.push(mermaid);
          parts.push("");
        }
        output = parts.join("\n");
      }
    }

    // Write DSL if --dsl-output is not off
    if (options.dslOutput !== "off") {
      const rootDir = process.cwd();
      const writeOpts =
        options.dslOutput === ".awaitly"
          ? { rootDir }
          : { rootDir, outputDir: options.dslOutput };
      for (const ir of workflows) {
        const dsl = renderWorkflowDSL(ir);
        const written = writeDSLToAwaitlyDirSync(dsl, writeOpts);
        console.error(`Wrote DSL: ${written}`);
      }
    }

    // Write to adjacent file if requested
    if (options.outputAdjacent) {
      const outputPath = getOutputFilePath(
        filePath,
        options.suffix,
        options.format
      );
      writeFileSync(outputPath, output, "utf-8");
      console.error(`Wrote ${outputPath}`);
    }

    // Output to stdout unless suppressed
    if (!options.noStdout) {
      console.log(output);
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
