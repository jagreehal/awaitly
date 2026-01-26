/**
 * Tree-sitter WASM Loader
 *
 * Loads tree-sitter TypeScript grammar from bundled WASM files.
 * web-tree-sitter v0.26+ bundles its own core WASM runtime.
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// Minimal types for tree-sitter (avoids dependency on web-tree-sitter types)
/** A tree-sitter syntax tree */
export interface SyntaxTree {
  rootNode: SyntaxNode;
  delete(): void;
}

/** A node in the syntax tree */
export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  parent: SyntaxNode | null;
  childCount: number;
  namedChildCount: number;
  firstChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

/** A tree-sitter language grammar */
export interface Language {
  readonly version: number;
  readonly fieldCount: number;
}

/** A tree-sitter parser instance */
export interface TreeSitterParser {
  parse(input: string, oldTree?: SyntaxTree): SyntaxTree;
  setLanguage(language: Language): void;
  getLanguage(): Language | null;
  delete(): void;
}

/** Parser class from web-tree-sitter v0.26+ */
interface ParserClass {
  init(options?: { wasmBinary?: ArrayBuffer | Buffer }): Promise<void>;
  new (): TreeSitterParser;
}

/** The tree-sitter module (v0.26+ API) */
interface TreeSitterModule {
  Parser: ParserClass;
  Language: {
    load(wasmOrPath: Buffer | string): Promise<Language>;
  };
}

/**
 * Load web-tree-sitter module.
 * Works in both ESM and CJS contexts.
 */
function loadWebTreeSitter(): TreeSitterModule {
  // ESM: use import.meta.url with createRequire
  // CJS: use __filename (tsup defines this for CJS builds)
  let requireFn: NodeRequire;

  try {
    if (typeof import.meta?.url === "string" && import.meta.url) {
      requireFn = createRequire(import.meta.url);
    } else {
      // CJS fallback - __filename is available in CJS context
      requireFn = createRequire(__filename);
    }
  } catch {
    // Final fallback for CJS
    requireFn = createRequire(__filename);
  }

  return requireFn("web-tree-sitter") as unknown as TreeSitterModule;
}

/**
 * Get the directory containing bundled WASM files.
 * Works correctly for both main entry (dist/index.js) and CLI (dist/cli/index.js).
 */
function getBundledWasmDir(): string {
  let baseDir: string;

  try {
    if (typeof import.meta?.url === "string") {
      baseDir = dirname(fileURLToPath(import.meta.url));
    } else if (typeof __dirname === "string") {
      baseDir = __dirname;
    } else {
      baseDir = dirname(__filename);
    }
  } catch {
    baseDir = __dirname ?? dirname(__filename);
  }

  // Try current directory first (for dist/index.js)
  let wasmDir = join(baseDir, "wasm");
  if (existsSync(join(wasmDir, "tree-sitter-typescript.wasm"))) {
    return wasmDir;
  }

  // Try parent directory (for dist/cli/index.js -> dist/wasm/)
  wasmDir = join(baseDir, "..", "wasm");
  if (existsSync(join(wasmDir, "tree-sitter-typescript.wasm"))) {
    return wasmDir;
  }

  // Fallback: search up the directory tree for dist/wasm
  let searchDir = baseDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(searchDir, "dist", "wasm");
    if (existsSync(join(candidate, "tree-sitter-typescript.wasm"))) {
      return candidate;
    }
    const parent = dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  // Return the original expected path for better error messages
  return join(baseDir, "wasm");
}

/**
 * Load TypeScript grammar WASM from bundled files.
 */
function loadTypescriptGrammar(): Buffer {
  const wasmDir = getBundledWasmDir();
  const wasmPath = join(wasmDir, "tree-sitter-typescript.wasm");

  if (!existsSync(wasmPath)) {
    throw new Error(
      `TypeScript grammar WASM not found at: ${wasmPath}\n\n` +
        "This file should be bundled with awaitly-analyze. " +
        "If you're developing locally, run 'pnpm build' first."
    );
  }

  return readFileSync(wasmPath);
}

// Singleton cache for parser and language
let cached: { parser: TreeSitterParser; language: Language } | null = null;

/**
 * Load and initialize tree-sitter with the TypeScript grammar.
 *
 * Uses bundled WASM files - no network requests required.
 * Subsequent calls return the cached parser instance.
 *
 * @returns Parser instance with TypeScript language loaded
 */
export async function loadTreeSitter(): Promise<{
  parser: TreeSitterParser;
  language: Language;
}> {
  if (cached) return cached;

  // Initialize web-tree-sitter (v0.26+ uses built-in WASM)
  const TreeSitter = loadWebTreeSitter();
  await TreeSitter.Parser.init();

  // Load TypeScript grammar from bundled WASM
  const typescriptWasm = loadTypescriptGrammar();
  const language = await TreeSitter.Language.load(typescriptWasm);

  // Create and configure parser
  const parser = new TreeSitter.Parser();
  parser.setLanguage(language);

  cached = { parser, language };
  return cached;
}

/**
 * Clear the cached parser instance.
 * Useful for testing or forcing re-initialization.
 */
export function clearTreeSitterCache(): void {
  cached = null;
}
