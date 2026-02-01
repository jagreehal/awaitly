/**
 * CLI tests for awaitly-analyze
 *
 * Tests for CLI argument parsing and file output functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const CLI_PATH = join(__dirname, "..", "dist", "cli.js");
const FIXTURES_DIR = join(__dirname, "__fixtures__");

// Helper to run CLI and capture output
function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

// Test workflow content
const TEST_WORKFLOW = `
import { createWorkflow } from 'awaitly';

const fetchUser = async (id: string) => ({ id, name: 'Alice' });

export const testWorkflow = createWorkflow({ fetchUser });

export async function run(userId: string) {
  return await testWorkflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(userId), { key: 'user' });
    return user;
  });
}
`;

describe("CLI", () => {
  const testFilePath = join(FIXTURES_DIR, "cli-test-workflow.ts");
  const outputMdPath = join(FIXTURES_DIR, "cli-test-workflow.workflow.md");
  const outputJsonPath = join(FIXTURES_DIR, "cli-test-workflow.analysis.json");
  const customSuffixPath = join(FIXTURES_DIR, "cli-test-workflow.diagram.md");

  beforeEach(() => {
    // Create test workflow file
    writeFileSync(testFilePath, TEST_WORKFLOW);
  });

  afterEach(() => {
    // Clean up test files
    for (const file of [testFilePath, outputMdPath, outputJsonPath, customSuffixPath]) {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    }
  });

  describe("--help", () => {
    it("should display help message", () => {
      const { stdout, exitCode } = runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("awaitly-analyze - Static workflow analysis tool");
      expect(stdout).toContain("--output-adjacent");
      expect(stdout).toContain("--suffix");
      expect(stdout).toContain("--no-stdout");
    });
  });

  describe("--output-adjacent", () => {
    it("should write mermaid output to adjacent file", () => {
      const { stderr, exitCode } = runCli([testFilePath, "--output-adjacent"]);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote");
      expect(stderr).toContain("cli-test-workflow.workflow.md");
      expect(existsSync(outputMdPath)).toBe(true);

      const content = readFileSync(outputMdPath, "utf-8");
      expect(content).toContain("flowchart");
    });

    it("should write JSON output to adjacent file with --format=json", () => {
      const { stderr, exitCode } = runCli([
        testFilePath,
        "--output-adjacent",
        "--suffix=analysis",
        "--format=json",
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote");
      expect(existsSync(outputJsonPath)).toBe(true);

      const content = readFileSync(outputJsonPath, "utf-8");
      const json = JSON.parse(content);
      expect(json.workflowCount).toBe(1);
    });

    it("should use custom suffix", () => {
      const { stderr, exitCode } = runCli([testFilePath, "-o", "--suffix=diagram"]);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("cli-test-workflow.diagram.md");
      expect(existsSync(customSuffixPath)).toBe(true);
    });

    it("should output to both stdout and file by default", () => {
      const { stdout, stderr, exitCode } = runCli([testFilePath, "-o"]);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote");
      expect(stdout).toContain("flowchart");
    });
  });

  describe("--no-stdout", () => {
    it("should suppress stdout when used with --output-adjacent", () => {
      const { stdout, stderr, exitCode } = runCli([testFilePath, "-o", "--no-stdout"]);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote");
      expect(stdout).toBe("");
    });

    it("should fail when used without --output-adjacent", () => {
      const { stderr, exitCode } = runCli([testFilePath, "--no-stdout"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--no-stdout requires --output-adjacent");
    });
  });

  describe("--suffix validation", () => {
    it("should reject suffix containing forward slash", () => {
      const { stderr, exitCode } = runCli([testFilePath, "--suffix=foo/bar"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("suffix cannot contain path separators");
    });

    it("should reject suffix containing backslash", () => {
      const { stderr, exitCode } = runCli([testFilePath, "--suffix=foo\\bar"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("suffix cannot contain path separators");
    });
  });
});
