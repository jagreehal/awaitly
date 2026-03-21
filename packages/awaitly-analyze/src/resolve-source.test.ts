import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseSourceArg, resolveGitSource, resolveGitHubPR } from "./resolve-source";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe("parseSourceArg", () => {
  it("parses a bare local path", () => {
    expect(parseSourceArg("src/workflow.ts")).toEqual({
      type: "local",
      path: "src/workflow.ts",
    });
  });

  it("parses a git ref:path", () => {
    expect(parseSourceArg("HEAD:src/workflow.ts")).toEqual({
      type: "git",
      ref: "HEAD",
      path: "src/workflow.ts",
    });
  });

  it("parses a branch ref:path", () => {
    expect(parseSourceArg("main:src/workflow.ts")).toEqual({
      type: "git",
      ref: "main",
      path: "src/workflow.ts",
    });
  });

  it("parses a commit hash ref:path", () => {
    expect(parseSourceArg("abc123:src/workflow.ts")).toEqual({
      type: "git",
      ref: "abc123",
      path: "src/workflow.ts",
    });
  });

  it("parses HEAD~3:path", () => {
    expect(parseSourceArg("HEAD~3:src/workflow.ts")).toEqual({
      type: "git",
      ref: "HEAD~3",
      path: "src/workflow.ts",
    });
  });

  it("parses gh:#123", () => {
    expect(parseSourceArg("gh:#123")).toEqual({
      type: "github",
      prNumber: 123,
    });
  });

  it("parses gh:#1", () => {
    expect(parseSourceArg("gh:#1")).toEqual({
      type: "github",
      prNumber: 1,
    });
  });
});

describe("resolveGitSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls git show with correct ref and path", () => {
    mockedExecSync.mockReturnValue("const x = 1;");
    const result = resolveGitSource("main", "src/wf.ts");
    expect(mockedExecSync).toHaveBeenCalledWith("git show main:src/wf.ts", { encoding: "utf-8" });
    expect(result).toBe("const x = 1;");
  });

  it("throws with clear message when file not found at ref", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("fatal: path 'src/wf.ts' does not exist in 'main'");
    });
    expect(() => resolveGitSource("main", "src/wf.ts")).toThrow(
      "File 'src/wf.ts' not found at ref 'main'."
    );
  });

  it("throws with clear message when ref is invalid", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("fatal: invalid object name 'nonexistent'");
    });
    expect(() => resolveGitSource("nonexistent", "src/wf.ts")).toThrow(
      "Git ref 'nonexistent' not found."
    );
  });

  it("throws when not in a git repo", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });
    expect(() => resolveGitSource("HEAD", "src/wf.ts")).toThrow(
      "Git ref diff requires a git repository. Run from within a repo."
    );
  });
});

describe("resolveGitHubPR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches PR metadata and resolves file pairs", () => {
    mockedExecSync.mockReturnValueOnce(JSON.stringify({
      baseRefName: "main",
      headRefName: "feature",
      files: [
        { path: "src/workflow.ts", additions: 10, deletions: 2 },
        { path: "src/utils.ts", additions: 5, deletions: 0 },
      ],
    }));
    mockedExecSync.mockReturnValueOnce("const before1 = 1;");
    mockedExecSync.mockReturnValueOnce("const after1 = 2;");
    mockedExecSync.mockReturnValueOnce("const before2 = 1;");
    mockedExecSync.mockReturnValueOnce("const after2 = 2;");

    const result = resolveGitHubPR(123);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "src/workflow.ts", before: "const before1 = 1;", after: "const after1 = 2;" });
    expect(mockedExecSync).toHaveBeenCalledWith(
      "gh pr view 123 --json baseRefName,headRefName,files",
      { encoding: "utf-8" }
    );
  });

  it("fetches only the specified file when filePath is given", () => {
    mockedExecSync.mockReturnValueOnce(JSON.stringify({
      baseRefName: "main",
      headRefName: "feature",
      files: [
        { path: "src/workflow.ts", additions: 10, deletions: 2 },
        { path: "src/other.ts", additions: 5, deletions: 0 },
      ],
    }));
    mockedExecSync.mockReturnValueOnce("before");
    mockedExecSync.mockReturnValueOnce("after");

    const result = resolveGitHubPR(123, "src/workflow.ts");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/workflow.ts");
  });

  it("skips non-ts files in auto-discover", () => {
    mockedExecSync.mockReturnValueOnce(JSON.stringify({
      baseRefName: "main",
      headRefName: "feature",
      files: [
        { path: "README.md", additions: 1, deletions: 0 },
        { path: "src/wf.ts", additions: 3, deletions: 1 },
      ],
    }));
    mockedExecSync.mockReturnValueOnce("b");
    mockedExecSync.mockReturnValueOnce("a");

    const result = resolveGitHubPR(123);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/wf.ts");
  });

  it("skips files added in the PR (no base version)", () => {
    mockedExecSync.mockReturnValueOnce(JSON.stringify({
      baseRefName: "main",
      headRefName: "feature",
      files: [{ path: "src/new.ts", additions: 10, deletions: 0 }],
    }));
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("fatal: path does not exist");
    });

    const result = resolveGitHubPR(123);
    expect(result).toHaveLength(0);
  });

  it("throws when gh is not installed", () => {
    mockedExecSync.mockImplementation(() => {
      const err = new Error("command not found: gh");
      (err as unknown as Record<string, unknown>).status = 127;
      throw err;
    });
    expect(() => resolveGitHubPR(123)).toThrow(
      "GitHub PR diff requires the GitHub CLI (gh). Install: https://cli.github.com"
    );
  });

  it("throws when PR not found", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("Could not resolve to a pull request");
    });
    expect(() => resolveGitHubPR(999)).toThrow(
      "PR #999 not found. Check the number and repo."
    );
  });
});
