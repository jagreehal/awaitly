/**
 * Lazy loader for ts-morph with helpful error message.
 * ts-morph is a peerDependency - users must install it to use this package.
 *
 * Uses createRequire for ESM compatibility while keeping synchronous loading.
 */

import { createRequire } from "module";

export type TsMorphModule = typeof import("ts-morph");
export type TypeScriptModule = typeof import("typescript");

let cached: TsMorphModule | null = null;
let cachedTs: TypeScriptModule | null = null;

export function loadTsMorph(): TsMorphModule {
  if (cached) return cached;

  try {
    // Use createRequire for ESM compatibility (optional peer dependency - cannot static import)
    // In CJS builds, tsup handles import.meta.url → __filename conversion
    const require = createRequire(import.meta.url);
    cached = require("ts-morph") as TsMorphModule;
    return cached;
  } catch {
    throw new Error(
      `awaitly-analyze-ts-morph requires ts-morph as a peer dependency.\n\n` +
        `Install it with:\n` +
        `  npm install ts-morph\n` +
        `  # or\n` +
        `  pnpm add ts-morph`
    );
  }
}

/** Load TypeScript compiler module (used for SyntaxKind and type-checker APIs). */
export function loadTypescript(): TypeScriptModule {
  if (cachedTs) return cachedTs;
  try {
    const require = createRequire(import.meta.url);
    cachedTs = require("typescript") as TypeScriptModule;
    return cachedTs;
  } catch {
    throw new Error(
      `awaitly-analyze requires typescript as a peer dependency.\n\n` +
        `Install it with:\n` +
        `  npm install typescript\n` +
        `  # or\n` +
        `  pnpm add typescript`
    );
  }
}
