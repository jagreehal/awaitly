import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildReview, renderReviewMarkdown, REVIEW_COMMENT_MARKER } from "./review";
import { parseReviewArgs } from "./cli";

const workflow = (steps: string[]) => `
import { createWorkflow, ok, type AsyncResult } from 'awaitly';

const load = async (): AsyncResult<number, 'NOT_FOUND'> => ok(1);
const save = async (): AsyncResult<number, 'SAVE_FAILED'> => ok(2);
const notify = async (): AsyncResult<number, 'NOTIFY_FAILED'> => ok(3);
const audit = async (): AsyncResult<number, 'AUDIT_FAILED'> => ok(4);

const checkout = createWorkflow('checkout', { load, save, notify, audit });

export async function runCheckout() {
  return checkout.run(async ({ step, deps }) => {
${steps.map((s) => `    await step('${s}', () => deps.${s}());`).join("\n")}
  });
}
`;

describe("review", () => {
  let cwd: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const write = (path: string, content: string) => {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => {
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c");
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "awaitly-review-"));
    git("init", "-q");
    write("src/checkout.ts", workflow(["load", "save", "notify"]));
    write("src/util.ts", "export const run = (f: () => void) => f();\nrun(() => {});\n");
    commit();
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("reports nothing when no workflow changed", () => {
    write("src/util.ts", "export const run = (f: () => void) => f();\n");
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.files).toEqual([]);
    expect(report.risk).toBe("low");
    expect(renderReviewMarkdown(report)).toContain("No awaitly workflows changed.");
  });

  it("flags a removed step as a high-risk regression", () => {
    write("src/checkout.ts", workflow(["load", "notify"]));
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.workflows[0]?.kind).toBe("changed");
    expect(report.regressions).toEqual([
      expect.objectContaining({ file: "src/checkout.ts", description: expect.stringContaining("save") }),
    ]);
    expect(report.risk).toBe("high");

    const markdown = renderReviewMarkdown(report);
    expect(markdown.startsWith(REVIEW_COMMENT_MARKER)).toBe(true);
    expect(markdown).toContain("🔴 High");
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("- save");
  });

  it("treats an added step as low risk", () => {
    write("src/checkout.ts", workflow(["load", "save", "notify", "audit"]));
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.regressions).toEqual([]);
    expect(report.files[0]?.workflows[0]?.diff?.summary.stepsAdded).toBeGreaterThan(0);
    expect(report.risk).toBe("low");
  });

  it("compares two refs and reports a deleted file as a removed workflow", () => {
    git("rm", "-q", "src/checkout.ts");
    commit();
    const report = buildReview({ base: "HEAD~1", head: "HEAD", cwd });
    expect(report.files[0]?.status).toBe("removed");
    expect(report.regressions[0]?.description).toBe("workflow removed");
  });

  it("follows a renamed file instead of reporting a removal", () => {
    git("mv", "src/checkout.ts", "src/orders.ts");
    commit();
    const report = buildReview({ base: "HEAD~1", head: "HEAD", cwd });
    expect(report.files[0]).toMatchObject({ status: "renamed", previousPath: "src/checkout.ts", path: "src/orders.ts" });
    expect(report.regressions).toEqual([]);
  });

  it("restricts the change set to the given pathspecs and includes untracked files", () => {
    write("lib/new.ts", workflow(["load"]));
    expect(buildReview({ base: "HEAD", paths: ["src"], cwd }).files).toEqual([]);
    expect(buildReview({ base: "HEAD", cwd }).files[0]).toMatchObject({ path: "lib/new.ts", status: "added" });
  });

  it("flags a removed parallel block as a regression even when its steps remain", () => {
    const parallel = workflow(["load"]).replace(
      "    await step('load', () => deps.load());",
      "    await step.parallel('fanout', { save: () => deps.save(), notify: () => deps.notify() });"
    );
    write("src/checkout.ts", parallel);
    commit();
    write("src/checkout.ts", workflow(["save", "notify"]));
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.regressions[0]?.description).toContain("parallel");
    expect(report.risk).toBe("high");
  });

  it("reads files from the repository root when run in a subdirectory", () => {
    write("src/checkout.ts", workflow(["load", "notify"]));
    const report = buildReview({ base: "HEAD", paths: ["."], cwd: join(cwd, "src") });
    expect(report.files[0]).toMatchObject({ path: "src/checkout.ts", status: "modified" });
    expect(report.files[0]?.workflows[0]?.kind).toBe("changed");
    expect(report.regressions[0]?.description).toContain("save");
  });

  it("reviews files with non-ASCII names", () => {
    write("src/café.ts", workflow(["load", "save"]));
    commit();
    write("src/café.ts", workflow(["load"]));
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.files[0]?.path).toBe("src/café.ts");
    expect(report.risk).toBe("high");
  });

  it("reports a change to a workflow's error types", () => {
    write("src/checkout.ts", workflow(["load", "save", "notify"]).replaceAll("SAVE_FAILED", "SAVE_REJECTED"));
    const report = buildReview({ base: "HEAD", cwd });
    expect(report.files[0]?.workflows[0]?.kind).toBe("changed");
    const markdown = renderReviewMarkdown(report);
    expect(markdown).toContain("errors +SAVE_REJECTED −SAVE_FAILED");
    expect(markdown).toContain("`checkout`: SAVE_REJECTED");
  });

  it("names the fetch to run when a ref cannot be resolved", () => {
    expect(() => buildReview({ base: "origin/nope", cwd })).toThrow(/git fetch origin nope/);
  });
});

describe("parseReviewArgs", () => {
  it("reads flags in both forms, and paths", () => {
    expect(
      parseReviewArgs(["--base", "main", "--head=HEAD", "src", "-f", "json", "--diagrams=collapsed", "--fail-on-regression"])
    ).toMatchObject({
      base: "main",
      head: "HEAD",
      paths: ["src"],
      format: "json",
      diagrams: "collapsed",
      failOnRegression: true,
      errors: [],
    });
  });

  it("collects invalid values and unknown flags", () => {
    expect(parseReviewArgs(["--format=xml", "--nope", "--base"]).errors).toEqual([
      "Invalid value for --format: xml (expected markdown or json)",
      "Unknown option: --nope",
      "--base requires a value",
    ]);
  });
});
