import type { Attributes } from '@opentelemetry/api';

/**
 * Call site: which line of *your* code started a run or a step, as OpenTelemetry
 * `code.*` attributes. Kept apart from the span code: it only parses stacks.
 */

/** awaitly's own source or build directory, read off this module's stack frame. */
let ownDir: string | undefined;
let ownDirRead = false;
function ownDirectory(): string | undefined {
  if (!ownDirRead) {
    ownDirRead = true;
    ownDir = /^(.*?[\\/](?:src|dist)[\\/])/.exec(
      framePath(new Error().stack?.split('\n')[1] ?? '') ?? '',
    )?.[1]?.replace(/^file:\/\//, '');
  }
  return ownDir;
}

function framePath(frame: string): string | undefined {
  return /\(?((?:file:\/\/)?[^\s()]+?):\d+:\d+\)?$/.exec(frame.trim())?.[1];
}

/** Stack frames are V8 (`at fn (file:1:2)`) or JSC/SpiderMonkey (`fn@file:1:2`). */
const FRAME = /^(?:at\s+(?:async\s+)?(?:(.+?)\s+\()?|(.*?)@)((?:file:\/\/)?[^\s()]+?):(\d+):(\d+)\)?$/;

function isOwnFrame(path: string): boolean {
  // Test files sit inside awaitly's own src/ but are callers, not awaitly.
  const own = ownDirectory();
  return (
    path.startsWith('node:') ||
    path.includes('/@opentelemetry/') ||
    (own !== undefined &&
      path.replace(/^file:\/\//, '').startsWith(own) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path))
  );
}

/**
 * `code.*` attributes for the first frame outside awaitly. Only called once a
 * span is known to be recording, so an untraced app never pays for the stack.
 */
export function callSite(): Attributes {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;

  for (const line of stack.split('\n').slice(1)) {
    const match = FRAME.exec(line.trim());
    if (!match) continue;
    const [, v8Name, jscName, path, lineNo, column] = match;
    if (!path || isOwnFrame(path)) continue;
    const fn = (v8Name ?? jscName)?.replace(/^async\s+/, '');
    return {
      'code.file.path': path.replace(/^file:\/\//, ''),
      'code.line.number': Number(lineNo),
      'code.column.number': Number(column),
      ...(fn ? { 'code.function.name': fn } : {}),
    };
  }
  return {};
}

