/**
 * Tree-sitter WASM Loader (Browser)
 *
 * Browser-compatible loader that uses fetch() to load WASM files.
 * web-tree-sitter v0.26+ bundles its own core WASM runtime and uses named exports.
 */

// Re-export types from the Node.js loader
export type {
  SyntaxTree,
  SyntaxNode,
  Language,
  TreeSitterParser,
} from "./tree-sitter-loader";

// Import types from web-tree-sitter (these are the actual runtime types)
import type {
  Parser as WebTreeSitterParser,
  Language as WebTreeSitterLanguage,
} from "web-tree-sitter";

// Configurable WASM base path (default: /wasm/)
let wasmBasePath = "/wasm/";

/**
 * Set the base path for loading WASM files.
 * Call this before loadTreeSitterBrowser() if WASM files are served from a different location.
 *
 * @example
 * ```ts
 * setWasmBasePath('/awaitly/wasm/');
 * ```
 */
export function setWasmBasePath(path: string): void {
  // Ensure path ends with /
  wasmBasePath = path.endsWith("/") ? path : `${path}/`;
}

/**
 * Get the current WASM base path.
 */
export function getWasmBasePath(): string {
  return wasmBasePath;
}

// Singleton cache for parser and language
let cached: { parser: WebTreeSitterParser; language: WebTreeSitterLanguage } | null = null;

/**
 * Load TypeScript grammar WASM from configured path using fetch.
 */
async function loadTypescriptGrammar(): Promise<Uint8Array> {
  const wasmUrl = `${wasmBasePath}tree-sitter-typescript.wasm`;

  const response = await fetch(wasmUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to load TypeScript grammar WASM from: ${wasmUrl}\n` +
        `HTTP ${response.status}: ${response.statusText}\n\n` +
        "Make sure the WASM file is available at this path. " +
        "You can configure the path using setWasmBasePath()."
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Load and initialize tree-sitter with the TypeScript grammar.
 *
 * Uses fetch to load WASM files from the configured base path.
 * Subsequent calls return the cached parser instance.
 *
 * @returns Parser instance with TypeScript language loaded
 */
export async function loadTreeSitterBrowser(): Promise<{
  parser: WebTreeSitterParser;
  language: WebTreeSitterLanguage;
}> {
  if (cached) return cached;

  // Dynamic import web-tree-sitter (v0.26+ uses named exports)
  const { Parser, Language } = await import("web-tree-sitter");

  // Initialize the Parser with locateFile to find web-tree-sitter.wasm
  // The WASM file should be placed alongside tree-sitter-typescript.wasm
  await Parser.init({
    locateFile: (scriptName: string) => {
      // web-tree-sitter looks for web-tree-sitter.wasm
      return `${wasmBasePath}${scriptName}`;
    },
  });

  // Load TypeScript grammar from configured WASM path
  const typescriptWasm = await loadTypescriptGrammar();
  const language = await Language.load(typescriptWasm);

  // Create and configure parser
  const parser = new Parser();
  parser.setLanguage(language);

  cached = { parser, language };
  return cached;
}

/**
 * Clear the cached parser instance.
 * Useful for testing or forcing re-initialization.
 */
export function clearTreeSitterBrowserCache(): void {
  cached = null;
}
