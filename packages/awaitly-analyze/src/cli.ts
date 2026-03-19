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
import { extractNodeMetadata, extractRailwayNodeMetadata, generateInteractiveHTML } from "./output/html";
import { writeDSLToAwaitlyDirSync, DEFAULT_DSL_OUTPUT_FOLDER } from "./awaitly-dir";
import { diffWorkflows } from "./diff/diff-engine";
import { renderDiffMarkdown } from "./diff/render-markdown";
import { renderDiffJSON } from "./diff/render-json";
import { renderDiffMermaid } from "./diff/render-mermaid";
import { parseSourceArg, resolveGitSource, resolveGitHubPR } from "./resolve-source";
import { renderRailwayMermaid } from "./output/railway";
import { analyzeWorkflowSource } from "./static-analyzer";

type Direction = "TB" | "TD" | "LR" | "BT" | "RL";
type Format = "mermaid" | "json" | "markdown";

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
  diff: boolean;
  diffSources: string[];
  regressionMode: boolean;
  formatExplicit: boolean;
  directionExplicit: boolean;
  railway: boolean;
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
  --direction=<dir>     Diagram direction: TB (default), TD, LR, BT, RL
  --output-adjacent, -o Write output file next to source file
  --suffix=<value>      Configurable suffix for output file (default: workflow)
  --no-stdout           Suppress stdout when writing to file (requires -o or --html)
  --dsl-output=<value>  Write DSL: off (default), .awaitly, or custom path
  --write-dsl           Shorthand for --dsl-output=.awaitly
  --diff                Compare workflows:
                          --diff v1.ts v2.ts              (two local files)
                          --diff src/wf.ts                (HEAD vs working copy)
                          --diff main:src/wf.ts src/wf.ts (git ref vs local)
                          --diff gh:#123                  (GitHub PR auto-discover)
                          --diff gh:#123 src/wf.ts        (GitHub PR specific file)
  --regression          Flag removed steps as regressions (use with --diff)
  --railway             Generate railway-style flow diagram (LR or TD with ok/err branches)
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
  awaitly-analyze --diff v1.ts v2.ts
  awaitly-analyze --diff v1.ts v2.ts --format=json
  awaitly-analyze --diff v1.ts v2.ts --format=mermaid --regression
`);
}

export function parseArgs(args: string[]): CliOptions {
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
    diff: false,
    diffSources: [],
    regressionMode: false,
    formatExplicit: false,
    directionExplicit: false,
    railway: false,
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
      if (format === "json" || format === "mermaid" || format === "markdown") {
        options.format = format;
        options.formatExplicit = true;
      } else {
        console.error(`Unknown format: ${format}. Use 'mermaid', 'json', or 'markdown'.`);
        process.exit(1);
      }
    } else if (arg.startsWith("--direction=")) {
      const dir = arg.slice("--direction=".length).toUpperCase() as Direction;
      if (["TB", "TD", "LR", "BT", "RL"].includes(dir)) {
        options.direction = dir;
        options.directionExplicit = true;
      } else {
        console.error(`Unknown direction: ${dir}. Use TB, TD, LR, BT, or RL.`);
        process.exit(1);
      }
    } else if (arg.startsWith("--suffix=")) {
      const suffix = arg.slice("--suffix=".length);
      if (suffix.includes("/") || suffix.includes("\\")) {
        console.error("Error: suffix cannot contain path separators.");
        process.exit(1);
      }
      options.suffix = suffix;
    } else if (arg === "--diff") {
      options.diff = true;
    } else if (arg === "--railway") {
      options.railway = true;
    } else if (arg === "--regression") {
      options.regressionMode = true;
    } else if (!arg.startsWith("-")) {
      if (options.diff) {
        options.diffSources.push(arg);
      } else if (!options.filePath) {
        options.filePath = arg;
      }
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

  // Diff mode — check before filePath validation since diff doesn't use filePath
  if (options.diff) {
    if (options.railway) {
      console.error("Error: --railway is not supported with --diff.");
      process.exit(1);
    }

    const sources = options.diffSources;

    if (options.outputAdjacent && sources.some((s) => s.startsWith("gh:#"))) {
      console.error("Error: --output-adjacent is not supported with GitHub PR sources.");
      process.exit(1);
    }

    const diffFormat = options.formatExplicit ? options.format : "markdown";

    // GitHub PR mode
    const ghSource = sources.find((s) => s.startsWith("gh:#"));
    if (ghSource) {
      const parsed = parseSourceArg(ghSource);
      if (parsed.type !== "github") {
        console.error("Error: invalid GitHub PR syntax. Use gh:#<number>.");
        process.exit(1);
      }
      const specificFile = sources.find((s) => !s.startsWith("gh:#"));

      let pairs;
      try {
        pairs = resolveGitHubPR(parsed.prNumber, specificFile);
      } catch (err: unknown) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      if (pairs.length === 0) {
        console.error(`No awaitly workflow files found in PR #${parsed.prNumber}.`);
        process.exit(1);
      }

      const outputs: string[] = [];
      for (const pair of pairs) {
        const beforeResults = analyzeWorkflowSource(pair.before);
        const afterResults = analyzeWorkflowSource(pair.after);
        const beforeIR = beforeResults[0] ?? null;
        const afterIR = afterResults[0] ?? null;
        if (!beforeIR && !afterIR) continue;
        if (!beforeIR || !afterIR) continue;

        const diff = diffWorkflows(beforeIR, afterIR, {
          regressionMode: options.regressionMode,
        });
        if (diffFormat === "json") {
          outputs.push(renderDiffJSON(diff));
        } else if (diffFormat === "mermaid") {
          outputs.push(renderDiffMermaid(afterIR, diff, { direction: options.direction }));
        } else {
          outputs.push(renderDiffMarkdown(diff, { showUnchanged: true }));
        }
      }

      if (outputs.length === 0) {
        console.error(`No awaitly workflow files found in PR #${parsed.prNumber}.`);
        process.exit(1);
      }

      console.log(outputs.join("\n\n---\n\n"));
      return;
    }

    // Single file shorthand: --diff src/wf.ts → HEAD vs working copy
    if (sources.length === 1) {
      const parsed = parseSourceArg(sources[0]);
      if (parsed.type === "local") {
        sources.unshift(`HEAD:${parsed.path}`);
      } else {
        console.error("Error: --diff with a single argument requires a local file path.");
        process.exit(1);
      }
    }

    if (sources.length !== 2) {
      console.error("Error: --diff requires one file (HEAD vs working copy), two sources, or gh:#<number>.");
      process.exit(1);
    }

    // Resolve both sources to IR
    function getIR(sourceStr: string) {
      const parsed = parseSourceArg(sourceStr);
      if (parsed.type === "local") {
        return analyze(resolve(parsed.path)).firstOrNull();
      } else if (parsed.type === "git") {
        const content = resolveGitSource(parsed.ref, parsed.path);
        const results = analyzeWorkflowSource(content);
        return results[0] ?? null;
      }
      return null;
    }

    let beforeIR, afterIR;
    try {
      beforeIR = getIR(sources[0]);
      afterIR = getIR(sources[1]);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (!beforeIR || !afterIR) {
      console.error("Error: Both sources must contain at least one workflow.");
      process.exit(1);
    }

    const diff = diffWorkflows(beforeIR, afterIR, {
      regressionMode: options.regressionMode,
    });

    let output: string;
    if (diffFormat === "json") {
      output = renderDiffJSON(diff);
    } else if (diffFormat === "mermaid") {
      output = renderDiffMermaid(afterIR, diff, { direction: options.direction });
    } else {
      output = renderDiffMarkdown(diff, { showUnchanged: true });
    }

    console.log(output);
    return;
  }

  if (!options.filePath) {
    console.error("Error: No file path provided.\n");
    printHelp();
    process.exit(1);
  }

  // Validate: --no-stdout requires --output-adjacent or --html
  if (options.noStdout && !options.outputAdjacent && !options.html) {
    console.error("Error: --no-stdout requires --output-adjacent (-o) or --html.");
    process.exit(1);
  }

  if (options.format === "markdown" && !options.diff) {
    console.error("Error: markdown format is only supported with --diff. Use 'mermaid' or 'json'.");
    process.exit(1);
  }

  if (options.railway && options.format === "json") {
    console.error("Error: --railway cannot be used with --format=json. Railway output is always Mermaid.");
    process.exit(1);
  }

  if (options.railway && options.direction !== "LR" && options.direction !== "TD") {
    if (options.direction === "TB" && !options.directionExplicit) {
      // No explicit --direction flag; default to LR for railway
      options.direction = "LR";
    } else {
      console.error(`Error: --railway only supports LR or TD directions, got ${options.direction}.`);
      process.exit(1);
    }
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
        const mermaidText = options.railway
          ? renderRailwayMermaid(ir, {
              direction: options.direction === "LR" ? "LR" : "TD",
              showKeys: options.showKeys,
              useNodeIds: true,
            })
          : renderStaticMermaid(ir, {
              direction: options.direction,
              showKeys: options.showKeys,
            });
        const metadata = options.railway
          ? extractRailwayNodeMetadata(ir)
          : extractNodeMetadata(ir);
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
    } else if (options.railway) {
      // Railway diagram output
      const railwayOpts = {
        direction: (options.direction === "LR" ? "LR" : "TD") as "LR" | "TD",
        showKeys: options.showKeys,
      };
      if (workflows.length === 1) {
        output = renderRailwayMermaid(workflows[0], railwayOpts);
      } else {
        const parts: string[] = [];
        for (const ir of workflows) {
          parts.push(`## Workflow: ${ir.root.workflowName}\n`);
          parts.push(renderRailwayMermaid(ir, railwayOpts));
          parts.push("");
        }
        output = parts.join("\n");
      }
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

// Only run main when this file is executed directly (not imported as a module)
const isMain =
  process.argv[1] &&
  (process.argv[1] === __filename ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.ts"));

if (isMain) {
  main();
}
