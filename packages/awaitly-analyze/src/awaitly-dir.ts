/**
 * Write Workflow Diagram DSL to the .awaitly folder or a custom directory.
 *
 * Enables UI/tools to read DSL without re-running analyze. Path convention:
 * - Default: <rootDir>/.awaitly/dsl/<workflowName>.dsl.json
 * - Custom: set outputDir to override the folder (relative to rootDir or absolute).
 */

import { mkdir, writeFile } from "fs/promises";
import { mkdirSync, writeFileSync } from "fs";
import { join, isAbsolute } from "path";
import type { WorkflowDiagramDSL } from "awaitly/workflow";

export const AWAITLY_DIR_NAME = ".awaitly";
export const AWAITLY_DSL_SUBDIR = "dsl";

/** Default DSL output folder name (under rootDir). Use with --dsl-output=.awaitly */
export const DEFAULT_DSL_OUTPUT_FOLDER = ".awaitly";

export interface WriteDSLToAwaitlyDirOptions {
  /**
   * Root directory under which to create .awaitly (default: process.cwd()).
   */
  rootDir?: string;
  /**
   * Override output directory. If set, files are written here instead of rootDir/.awaitly/dsl.
   * Can be absolute or relative to rootDir.
   */
  outputDir?: string;
  /**
   * Filename for the DSL JSON file (default: <workflowName>.dsl.json).
   */
  filename?: string;
  /**
   * Whether to pretty-print JSON (default: true).
   */
  pretty?: boolean;
}

/**
 * Write a Workflow Diagram DSL to the .awaitly folder.
 * Creates .awaitly/dsl/ if it does not exist.
 *
 * @param dsl - The DSL from renderWorkflowDSL()
 * @param options - Optional rootDir, filename, pretty
 * @returns The absolute path of the written file
 */
function resolveOutputDir(options: WriteDSLToAwaitlyDirOptions): string {
  const rootDir = options.rootDir ?? process.cwd();
  if (options.outputDir) {
    return isAbsolute(options.outputDir) ? options.outputDir : join(rootDir, options.outputDir);
  }
  return join(rootDir, AWAITLY_DIR_NAME, AWAITLY_DSL_SUBDIR);
}

export async function writeDSLToAwaitlyDir(
  dsl: WorkflowDiagramDSL,
  options: WriteDSLToAwaitlyDirOptions = {}
): Promise<string> {
  const { filename, pretty = true } = options;
  const safeName = sanitizeFilename(dsl.workflowName);
  const baseName = filename ?? `${safeName}.dsl.json`;
  const dir = resolveOutputDir(options);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, baseName);
  const content = pretty ? JSON.stringify(dsl, null, 2) : JSON.stringify(dsl);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Synchronous version for CLI. Creates the output directory and writes the DSL file.
 */
export function writeDSLToAwaitlyDirSync(
  dsl: WorkflowDiagramDSL,
  options: WriteDSLToAwaitlyDirOptions = {}
): string {
  const { filename, pretty = true } = options;
  const safeName = sanitizeFilename(dsl.workflowName);
  const baseName = filename ?? `${safeName}.dsl.json`;
  const dir = resolveOutputDir(options);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, baseName);
  const content = pretty ? JSON.stringify(dsl, null, 2) : JSON.stringify(dsl);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}
