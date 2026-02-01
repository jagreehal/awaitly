/**
 * Lazy loader for ts-morph with helpful error message.
 * ts-morph is a peerDependency - users must install it to use this package.
 *
 * Uses createRequire for ESM compatibility while keeping synchronous loading.
 */

import { createRequire } from "module";

export type TsMorphModule = typeof import("ts-morph");

let cached: TsMorphModule | null = null;

export function loadTsMorph(): TsMorphModule {
  if (cached) return cached;

  try {
    // Use createRequire for ESM compatibility
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
