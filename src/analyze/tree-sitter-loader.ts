/**
 * Tree-sitter WASM Loader
 *
 * Loads tree-sitter WASM files with multiple strategies:
 * 1. Bundled in dist/wasm/ (preferred for npm package)
 * 2. Cached in ~/.cache/awaitly/wasm/ (development)
 * 3. Downloaded from CDN (fallback)
 *
 * - Core parser: tree-sitter.wasm (~200KB)
 * - TypeScript grammar: tree-sitter-typescript.wasm (~1.4MB)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { homedir } from "os";
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
 * Load web-tree-sitter with CJS-first strategy for best compatibility.
 * Falls back to dynamic import() for ESM-only versions.
 */
async function loadWebTreeSitter(): Promise<TreeSitterModule> {
  const require = createRequire(import.meta.url);

  try {
    // CJS-style load works in both ESM and CJS contexts
    return require("web-tree-sitter") as unknown as TreeSitterModule;
  } catch (err) {
    const e = err as { code?: string; message?: string };

    // ESM-only package - fall back to dynamic import
    if (e?.code === "ERR_REQUIRE_ESM") {
      return (await import("web-tree-sitter"))
        .default as unknown as TreeSitterModule;
    }

    // Package not installed - provide helpful error
    if (
      e?.code === "MODULE_NOT_FOUND" ||
      /Cannot find module/.test(String(e?.message))
    ) {
      const out = Object.assign(
        new Error(
          "Optional dependency missing: web-tree-sitter\n\n" +
            "To enable awaitly/analyze, install it:\n" +
            "  npm install web-tree-sitter\n" +
            "  # or: pnpm add web-tree-sitter\n" +
            "  # or: yarn add web-tree-sitter"
        ),
        { cause: err }
      );
      throw out;
    }

    throw err;
  }
}

// WASM file URLs (fallback for development/missing bundles)
const WASM_URLS = {
  treeSitter: "https://unpkg.com/web-tree-sitter@0.24.3/tree-sitter.wasm",
  typescript: "https://tree-sitter.github.io/tree-sitter-typescript.wasm",
} as const;

/**
 * Get the directory containing bundled WASM files.
 * Works in both ESM and CJS contexts.
 */
function getBundledWasmDir(): string {
  try {
    // ESM: use import.meta.url
    if (typeof import.meta?.url === "string") {
      const thisFile = fileURLToPath(import.meta.url);
      return join(dirname(thisFile), "wasm");
    }
  } catch {
    // Fall through to CJS approach
  }

  // CJS: use __dirname
  if (typeof __dirname === "string") {
    return join(__dirname, "wasm");
  }

  // Source development: relative to this file
  return join(dirname(__filename), "wasm");
}

/**
 * Get the directory for caching WASM files.
 * Creates the directory if it doesn't exist.
 */
function getWasmCacheDir(): string {
  const cacheDir = join(homedir(), ".cache", "awaitly", "wasm");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Load a WASM file, trying multiple sources in order:
 * 1. Bundled in dist/wasm/ (npm package)
 * 2. Cached in ~/.cache/awaitly/wasm/
 * 3. Downloaded from CDN
 */
async function loadWasm(name: keyof typeof WASM_URLS): Promise<Buffer> {
  const filename =
    name === "treeSitter" ? "tree-sitter.wasm" : "tree-sitter-typescript.wasm";

  // 1. Try bundled WASM (in dist/wasm/)
  const bundledDir = getBundledWasmDir();
  const bundledPath = join(bundledDir, filename);
  if (existsSync(bundledPath)) {
    return readFileSync(bundledPath);
  }

  // 2. Try cached WASM (in ~/.cache/awaitly/wasm/)
  const cacheDir = getWasmCacheDir();
  const cachedPath = join(cacheDir, filename);
  if (existsSync(cachedPath)) {
    return readFileSync(cachedPath);
  }

  // 3. Download from CDN and cache
  const url = WASM_URLS[name];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${filename}: ${response.statusText}\n\n` +
        `awaitly/analyze-tree-sitter requires internet access on first use to download WASM files.\n` +
        `Files are cached in ${cacheDir} for offline use after initial download.\n\n` +
        `URL: ${url}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(cachedPath, buffer);
  return buffer;
}

// Singleton cache for parser and language
let cached: { parser: TreeSitterParser; language: Language } | null = null;

/**
 * Load and initialize tree-sitter with the TypeScript grammar.
 *
 * WASM files are loaded from:
 * 1. Bundled in dist/wasm/ (npm package)
 * 2. Cached in ~/.cache/awaitly/wasm/
 * 3. Downloaded from CDN (first use)
 *
 * Subsequent calls return the cached parser instance.
 *
 * @returns Parser instance with TypeScript language loaded
 */
export async function loadTreeSitter(): Promise<{
  parser: TreeSitterParser;
  language: Language;
}> {
  if (cached) return cached;

  // Load WASM files (tries bundled → cached → download)
  const [treeSitterWasm, typescriptWasm] = await Promise.all([
    loadWasm("treeSitter"),
    loadWasm("typescript"),
  ]);

  // Initialize web-tree-sitter with explicit WASM binary (v0.26+ API)
  const TreeSitter = await loadWebTreeSitter();
  await TreeSitter.Parser.init({ wasmBinary: treeSitterWasm });

  // Load TypeScript grammar
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

/**
 * Get the path to the WASM cache directory.
 * Useful for debugging or manual cache management.
 */
export function getWasmCachePath(): string {
  return getWasmCacheDir();
}
