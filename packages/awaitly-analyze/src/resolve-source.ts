import { execSync } from "node:child_process";

export type SourceArg =
  | { type: "local"; path: string }
  | { type: "git"; ref: string; path: string }
  | { type: "github"; prNumber: number };

/**
 * Parse a CLI source argument into a typed descriptor.
 * - `gh:#123` → github PR
 * - `ref:path` (any colon) → git ref (macOS forbids : in filenames)
 * - bare path → local file
 */
export function parseSourceArg(arg: string): SourceArg {
  const ghMatch = arg.match(/^gh:#(\d+)$/);
  if (ghMatch) {
    return { type: "github", prNumber: parseInt(ghMatch[1], 10) };
  }

  const colonIndex = arg.indexOf(":");
  if (colonIndex > 0) {
    return {
      type: "git",
      ref: arg.slice(0, colonIndex),
      path: arg.slice(colonIndex + 1),
    };
  }

  return { type: "local", path: arg };
}

export interface PRFilePair {
  path: string;
  before: string;
  after: string;
}

export function resolveGitHubPR(prNumber: number, filePath?: string): PRFilePair[] {
  let prJson: string;
  try {
    prJson = execSync(
      `gh pr view ${prNumber} --json baseRefName,headRefName,files`,
      { encoding: "utf-8" }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("command not found") || msg.includes("ENOENT")) {
      throw new Error(
        "GitHub PR diff requires the GitHub CLI (gh). Install: https://cli.github.com",
        { cause: err }
      );
    }
    if (msg.includes("authentication") || msg.includes("auth login")) {
      throw new Error("GitHub CLI not authenticated. Run: gh auth login", { cause: err });
    }
    if (msg.includes("Could not resolve") || msg.includes("not found")) {
      throw new Error(`PR #${prNumber} not found. Check the number and repo.`, { cause: err });
    }
    throw new Error(`Failed to fetch PR #${prNumber}: ${msg}`, { cause: err });
  }

  const pr = JSON.parse(prJson) as {
    baseRefName: string;
    headRefName: string;
    files: Array<{ path: string; additions: number; deletions: number }>;
  };

  let files = pr.files;

  if (filePath) {
    files = files.filter((f) => f.path === filePath);
    if (files.length === 0) {
      throw new Error(`File '${filePath}' not found in PR #${prNumber}.`);
    }
  }

  files = files.filter((f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx"));

  const pairs: PRFilePair[] = [];

  for (const file of files) {
    try {
      const before = execSync(`git show ${pr.baseRefName}:${file.path}`, { encoding: "utf-8" });
      const after = execSync(`git show ${pr.headRefName}:${file.path}`, { encoding: "utf-8" });
      pairs.push({ path: file.path, before, after });
    } catch {
      continue;
    }
  }

  return pairs;
}

export function resolveGitSource(ref: string, path: string): string {
  try {
    return execSync(`git show ${ref}:${path}`, { encoding: "utf-8" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist")) {
      throw new Error(`File '${path}' not found at ref '${ref}'.`, { cause: err });
    }
    if (msg.includes("invalid object name") || msg.includes("unknown revision")) {
      throw new Error(`Git ref '${ref}' not found.`, { cause: err });
    }
    if (msg.includes("not a git repository")) {
      throw new Error("Git ref diff requires a git repository. Run from within a repo.", { cause: err });
    }
    throw new Error(`Failed to read '${ref}:${path}': ${msg}`, { cause: err });
  }
}
