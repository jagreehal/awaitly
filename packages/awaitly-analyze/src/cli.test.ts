/**
 * CLI tests for awaitly-analyze
 *
 * Tests for CLI argument parsing and file output functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import { parseArgs } from "./cli";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const CLI_PATH = join(__dirname, "..", "dist", "cli.js");
const FIXTURES_DIR = join(__dirname, "__fixtures__");
const testFilePath = join(FIXTURES_DIR, "cli-test-workflow.ts");
const multiWorkflowFilePath = join(FIXTURES_DIR, "cli-test-multi-workflow.ts");
const conditionalWorkflowFilePath = join(FIXTURES_DIR, "cli-test-conditional-workflow.ts");
const outputMdPath = join(FIXTURES_DIR, "cli-test-workflow.workflow.md");
const outputJsonPath = join(FIXTURES_DIR, "cli-test-workflow.analysis.json");
const customSuffixPath = join(FIXTURES_DIR, "cli-test-workflow.diagram.md");
const htmlOutputPath = join(FIXTURES_DIR, "cli-test-workflow.html");
const conditionalHtmlOutputPath = join(FIXTURES_DIR, "cli-test-conditional-workflow.html");
const noWorkflowFilePath = join(FIXTURES_DIR, "cli-test-no-workflow.ts");

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

export const testWorkflow = createWorkflow('testWorkflow', { fetchUser });

export async function run(userId: string) {
  return await testWorkflow(async ({ step, deps }) => {
    const user = await step(() => deps.fetchUser(userId), { key: 'user' });
    return user;
  });
}
`;

const MULTI_WORKFLOW = `
import { createWorkflow } from 'awaitly';

const deps = {
  a: async () => ({ ok: true }),
  b: async () => ({ ok: true }),
};

export const workflowA = createWorkflow('workflowA', deps);
export const workflowB = createWorkflow('workflowB', deps);

export async function runA() {
  return workflowA(async ({ step, deps: d }) => {
    await step('a', () => d.a());
    return {};
  });
}

export async function runB() {
  return workflowB(async ({ step, deps: d }) => {
    await step('b', () => d.b());
    return {};
  });
}
`;

const CONDITIONAL_WORKFLOW = `
import { createWorkflow } from 'awaitly';

const deps = {
  first: async () => ({ ok: true }),
  branch: async () => ({ ok: true }),
  last: async () => ({ ok: true }),
};

export const conditionalWorkflow = createWorkflow('conditionalWorkflow', deps);

export async function run(flag: boolean) {
  return conditionalWorkflow(async ({ step, deps: d }) => {
    await step('first', () => d.first());

    if (flag) {
      await step('branch', () => d.branch());
    }

    await step('last', () => d.last());
    return {};
  });
}
`;

const NO_WORKFLOW = `
export const value = 42;
`;

describe("CLI", () => {
  beforeEach(() => {
    // Create test workflow file
    writeFileSync(testFilePath, TEST_WORKFLOW);
    writeFileSync(multiWorkflowFilePath, MULTI_WORKFLOW);
    writeFileSync(conditionalWorkflowFilePath, CONDITIONAL_WORKFLOW);
    writeFileSync(noWorkflowFilePath, NO_WORKFLOW);
  });

  afterEach(() => {
    // Clean up test files
    for (const file of [
      testFilePath,
      multiWorkflowFilePath,
      conditionalWorkflowFilePath,
      noWorkflowFilePath,
      outputMdPath,
      outputJsonPath,
      customSuffixPath,
      htmlOutputPath,
      conditionalHtmlOutputPath,
    ]) {
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

    it("should document TD as a supported direction", () => {
      const { stdout, exitCode } = runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("TB (default), TD, LR, BT, RL");
    });

    it("should document TD as a supported railway direction", () => {
      const { stdout, exitCode } = runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("--railway             Generate railway-style flow diagram (LR or TD");
    });

    it("should document that --no-stdout also works with --html", () => {
      const { stdout, exitCode } = runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("--no-stdout           Suppress stdout when writing to file (requires -o or --html)");
    });
  });

  describe("--output-adjacent", () => {
    it(
      "should write mermaid output to adjacent file",
      () => {
        const { stderr, exitCode } = runCli([testFilePath, "--output-adjacent"]);
        expect(exitCode).toBe(0);
        expect(stderr).toContain("Wrote");
        expect(stderr).toContain("cli-test-workflow.workflow.md");
        expect(existsSync(outputMdPath)).toBe(true);

        const content = readFileSync(outputMdPath, "utf-8");
        expect(content).toContain("flowchart");
      },
      30_000,
    );

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

    it("should allow --no-stdout with railway HTML output even without --output-adjacent", () => {
      const { stdout, stderr, exitCode } = runCli([
        testFilePath,
        "--html",
        "--railway",
        "--no-stdout",
        `--html-output=${htmlOutputPath}`,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote HTML");
      expect(existsSync(htmlOutputPath)).toBe(true);
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

  describe("--format=markdown", () => {
    it("should reject markdown format outside diff mode", () => {
      const { stderr, stdout, exitCode } = runCli([testFilePath, "--format=markdown"]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("markdown format is only supported with --diff");
    });
  });

  describe("--html-output validation", () => {
    it("should reject empty html-output value", () => {
      const { stderr, exitCode } = runCli([testFilePath, "--html", "--html-output="]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--html-output requires a non-empty path");
    });

    it("should fail when html-output is a single file path but the source has multiple workflows", () => {
      const { stderr, exitCode } = runCli([
        multiWorkflowFilePath,
        "--html",
        `--html-output=${htmlOutputPath}`,
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("cannot use --html-output with multiple workflows");
    });

    it("should render railway Mermaid in HTML output when --html and --railway are combined", () => {
      const { stderr, exitCode } = runCli([
        testFilePath,
        "--html",
        "--railway",
        `--html-output=${htmlOutputPath}`,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote HTML");
      expect(existsSync(htmlOutputPath)).toBe(true);

      const content = readFileSync(htmlOutputPath, "utf-8");
      expect(content).toContain("flowchart LR");
      expect(content).toContain("-->|ok|");
    });

    it("should keep railway HTML metadata IDs aligned with Mermaid node IDs", () => {
      const { stderr, exitCode } = runCli([
        testFilePath,
        "--html",
        "--railway",
        `--html-output=${htmlOutputPath}`,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote HTML");

      const content = readFileSync(htmlOutputPath, "utf-8");
      expect(content).toContain("\"step_1\"");
      expect(content).toContain("step_1[");
    });

    it("should honor --keys in railway HTML output", () => {
      const { stderr, exitCode } = runCli([
        testFilePath,
        "--html",
        "--railway",
        "--keys",
        `--html-output=${htmlOutputPath}`,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote HTML");

      const content = readFileSync(htmlOutputPath, "utf-8");
      expect(content).toContain("user");
    });

    it("should keep railway HTML metadata IDs aligned when the workflow includes structural nodes", () => {
      const { stderr, exitCode } = runCli([
        conditionalWorkflowFilePath,
        "--html",
        "--railway",
        `--html-output=${conditionalHtmlOutputPath}`,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Wrote HTML");

      const content = readFileSync(conditionalHtmlOutputPath, "utf-8");
      expect(content).toContain("step_2[");
      expect(content).toContain("\"step_2\"");
      expect(content).toContain("step_3[");
      expect(content).toContain("\"step_3\"");
    });
  });

  describe("--watch", () => {
    it("does not exit when the watched file temporarily contains no workflows", async () => {
      const child = spawn("node", [CLI_PATH, noWorkflowFilePath, "--watch"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(child.exitCode).toBe(null);
      } finally {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
          });
        }
      }
    }, 10_000);
  });
});

describe("diff source argument parsing", () => {
  it("collects single file in diff mode", () => {
    const options = parseArgs(["--diff", "src/wf.ts"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["src/wf.ts"]);
  });

  it("collects two local files in diff mode", () => {
    const options = parseArgs(["--diff", "v1.ts", "v2.ts"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["v1.ts", "v2.ts"]);
  });

  it("collects two git ref sources", () => {
    const options = parseArgs(["--diff", "main:src/wf.ts", "feature:src/wf.ts"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["main:src/wf.ts", "feature:src/wf.ts"]);
  });

  it("collects gh:#N source", () => {
    const options = parseArgs(["--diff", "gh:#42"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["gh:#42"]);
  });

  it("collects gh:#N with specific file", () => {
    const options = parseArgs(["--diff", "gh:#42", "src/wf.ts"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["gh:#42", "src/wf.ts"]);
  });

  it("collects git ref and local file mix", () => {
    const options = parseArgs(["--diff", "HEAD~3:src/wf.ts", "src/wf.ts"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["HEAD~3:src/wf.ts", "src/wf.ts"]);
  });

  it("preserves other flags with diff sources", () => {
    const options = parseArgs(["--diff", "v1.ts", "v2.ts", "--regression", "--format=json"]);
    expect(options.diff).toBe(true);
    expect(options.diffSources).toEqual(["v1.ts", "v2.ts"]);
    expect(options.regressionMode).toBe(true);
    expect(options.format).toBe("json");
  });

  it("rejects --railway in diff mode", () => {
    writeFileSync(testFilePath, TEST_WORKFLOW);

    try {
      const { stdout, stderr, exitCode } = runCli([
        "--diff",
        testFilePath,
        testFilePath,
        "--railway",
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("--railway is not supported with --diff");
    } finally {
      if (existsSync(testFilePath)) unlinkSync(testFilePath);
    }
  });

  it("rejects --watch in diff mode", () => {
    writeFileSync(testFilePath, TEST_WORKFLOW);

    try {
      const { stdout, stderr, exitCode } = runCli([
        "--diff",
        testFilePath,
        testFilePath,
        "--watch",
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("--watch is not supported with --diff");
    } finally {
      if (existsSync(testFilePath)) unlinkSync(testFilePath);
    }
  });
});

describe("--railway", () => {
  beforeEach(() => {
    writeFileSync(testFilePath, TEST_WORKFLOW);
  });

  afterEach(() => {
    if (existsSync(testFilePath)) unlinkSync(testFilePath);
  });

  it("accepts TD as a valid direction for railway diagrams", () => {
    const { stdout, stderr, exitCode } = runCli([
      testFilePath,
      "--railway",
      "--direction=TD",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("flowchart TD");
    expect(stdout).toContain("-->|ok|");
  });

  it("honors --keys in railway output", () => {
    const { stdout, stderr, exitCode } = runCli([
      testFilePath,
      "--railway",
      "--keys",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("user");
  });

  it("rejects incompatible --railway and --format=json combination", () => {
    const { stdout, stderr, exitCode } = runCli([
      testFilePath,
      "--railway",
      "--format=json",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--railway cannot be used with --format=json");
  });

  it("rejects directions that railway mode cannot actually render", () => {
    const { stdout, stderr, exitCode } = runCli([
      testFilePath,
      "--railway",
      "--direction=BT",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--railway only supports LR or TD");
  });

  it("rejects TB because railway mode only supports LR or TD", () => {
    const { stdout, stderr, exitCode } = runCli([
      testFilePath,
      "--railway",
      "--direction=TB",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--railway only supports LR or TD");
  });
});

describe("auto-detection mode", () => {
  it("defaults to auto when no explicit format or railway flag", () => {
    const options = parseArgs(["file.ts"]);
    expect(options.auto).toBe(true);
    expect(options.railway).toBe(false);
    expect(options.watch).toBe(false);
  });

  it("disables auto when --railway is explicit", () => {
    const options = parseArgs(["file.ts", "--railway"]);
    expect(options.auto).toBe(false);
    expect(options.railway).toBe(true);
  });

  it("disables auto when --format=mermaid is explicit", () => {
    const options = parseArgs(["file.ts", "--format=mermaid"]);
    expect(options.auto).toBe(false);
    expect(options.formatExplicit).toBe(true);
  });

  it("disables auto when --format=json is explicit", () => {
    const options = parseArgs(["file.ts", "--format=json"]);
    expect(options.auto).toBe(false);
    expect(options.formatExplicit).toBe(true);
  });
});

describe("--watch flag parsing", () => {
  it("parses --watch flag", () => {
    const options = parseArgs(["file.ts", "--watch"]);
    expect(options.watch).toBe(true);
    expect(options.filePath).toBe("file.ts");
  });

  it("combines --watch with other flags", () => {
    const options = parseArgs(["file.ts", "--watch", "--keys", "--direction=LR"]);
    expect(options.watch).toBe(true);
    expect(options.showKeys).toBe(true);
    expect(options.direction).toBe("LR");
  });
});
