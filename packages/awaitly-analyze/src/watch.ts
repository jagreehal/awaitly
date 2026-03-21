/**
 * File watcher for live diagram updates.
 *
 * Uses Node.js built-in fs.watch() with debouncing to avoid
 * redundant rebuilds from editor multi-write save operations.
 */

import { watch, type FSWatcher } from "fs";

export interface WatchOptions {
  /** Absolute path to the file to watch */
  filePath: string;
  /** Debounce interval in milliseconds (default: 300) */
  debounceMs?: number;
  /** Called when the file changes (after debounce) */
  onRebuild: () => void;
  /** Called when an error occurs during rebuild */
  onError: (err: Error) => void;
}

export interface WatchHandle {
  /** Stop watching and clean up */
  stop: () => void;
}

export function startWatch(opts: WatchOptions): WatchHandle {
  const { filePath, debounceMs = 300, onRebuild, onError } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  watcher = watch(filePath, (eventType) => {
    if (eventType !== "change" && eventType !== "rename") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onRebuild();
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }, debounceMs);
  });

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  function onSignal() {
    stop();
    process.exit(0);
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return { stop };
}
