/**
 * Test Utilities for Deterministic Type Extraction Testing
 *
 * Provides normalization helpers and fixture loaders for stable,
 * reproducible test outputs across machines and CI environments.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { StaticWorkflowIR, StaticAnalysisMetadata, SourceLocation } from "./types";
import { analyzeWorkflowSource, resetIdCounter } from "./static-analyzer";

export interface NormalizationOptions {
  normalizeIds?: boolean;
  normalizePaths?: boolean;
  normalizeTimestamps?: boolean;
  normalizeTsVersion?: boolean;
  sortArrays?: boolean;
  idPrefix?: string;
}

const DEFAULT_NORMALIZATION: NormalizationOptions = {
  normalizeIds: true,
  normalizePaths: true,
  normalizeTimestamps: true,
  normalizeTsVersion: true,
  sortArrays: true,
  idPrefix: "id_",
};

export interface NormalizedAnalysisOutput {
  root: unknown;
  metadata: Partial<StaticAnalysisMetadata>;
}

export function normalizeAnalysisOutput(
  ir: StaticWorkflowIR,
  options: NormalizationOptions = {}
): NormalizedAnalysisOutput {
  const opts = { ...DEFAULT_NORMALIZATION, ...options };
  const idMap = new Map<string, string>();
  let idCounter = 0;

  const generateStableId = (originalId: string): string => {
    if (!idMap.has(originalId)) {
      idMap.set(originalId, `${opts.idPrefix}${idCounter++}`);
    }
    return idMap.get(originalId)!;
  };

  const normalizeId = (id: string | undefined): string | undefined => {
    if (!id || !opts.normalizeIds) return id;
    return generateStableId(id);
  };

  const normalizePath = (path: string | undefined): string | undefined => {
    if (!path || !opts.normalizePaths) return path;
    return path.replace(/\/.*\/(packages|src)/, "<root>/$1");
  };

  const normalizeLocation = (loc: SourceLocation | undefined): SourceLocation | undefined => {
    if (!loc) return loc;
    return {
      ...loc,
      filePath: normalizePath(loc.filePath) ?? loc.filePath,
    };
  };

  const normalizeNode = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;

    if (Array.isArray(node)) {
      const normalized = node.map(normalizeNode);
      return opts.sortArrays ? stableSort(normalized) : normalized;
    }

    const result: Record<string, unknown> = {};
    const entries = Object.entries(node as Record<string, unknown>);

    for (const [key, value] of entries) {
      if (key === "id") {
        result[key] = normalizeId(value as string);
      } else if (key === "stepId") {
        result[key] = value;
      } else if (key === "location" || key === "depLocation" || key === "definitionLocation") {
        result[key] = normalizeLocation(value as SourceLocation);
      } else if (key === "filePath") {
        result[key] = normalizePath(value as string);
      } else if (typeof value === "object" && value !== null) {
        result[key] = normalizeNode(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  };

  const normalizedRoot = normalizeNode(ir.root) as StaticWorkflowIR["root"];

  const normalizedMetadata: Partial<StaticAnalysisMetadata> = {
    ...ir.metadata,
    analyzedAt: opts.normalizeTimestamps ? 0 : ir.metadata.analyzedAt,
    tsVersion: opts.normalizeTsVersion ? "<ts-version>" : ir.metadata.tsVersion,
    filePath: normalizePath(ir.metadata.filePath) ?? ir.metadata.filePath,
  };

  return {
    root: normalizedRoot,
    metadata: normalizedMetadata,
  };
}

function stableSort(arr: unknown[]): unknown[] {
  if (arr.length === 0) return arr;

  const first = arr[0];
  if (typeof first !== "object" || first === null) {
    if (typeof first === "string") {
      return [...arr].sort();
    }
    return arr;
  }

  if (Array.isArray(first)) {
    return arr;
  }

  if ("stepId" in (first as Record<string, unknown>)) {
    return [...arr].sort((a, b) => {
      const aId = (a as Record<string, unknown>).stepId as string;
      const bId = (b as Record<string, unknown>).stepId as string;
      return (aId || "").localeCompare(bId || "");
    });
  }

  if ("id" in (first as Record<string, unknown>)) {
    return [...arr].sort((a, b) => {
      const aId = (a as Record<string, unknown>).id as string;
      const bId = (b as Record<string, unknown>).id as string;
      return (aId || "").localeCompare(bId || "");
    });
  }

  return arr;
}

export interface FixtureLoadResult {
  source: string;
  ir: StaticWorkflowIR;
  normalized: NormalizedAnalysisOutput;
}

const FIXTURES_DIR = join(__dirname, "__fixtures__", "typed");

export function loadFixture(
  fixtureName: string,
  options: { resetIdCounter?: boolean } = {}
): FixtureLoadResult {
  const { resetIdCounter: shouldReset = true } = options;

  if (shouldReset) {
    resetIdCounter();
  }

  const fixturePath = join(FIXTURES_DIR, `${fixtureName}.ts`);
  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const source = readFileSync(fixturePath, "utf-8");
  const results = analyzeWorkflowSource(source);

  if (results.length === 0) {
    throw new Error(`No workflow found in fixture: ${fixtureName}`);
  }

  return {
    source,
    ir: results[0],
    normalized: normalizeAnalysisOutput(results[0]),
  };
}

export function loadExpectedOutput(
  fixtureName: string,
  suffix: string = "types"
): NormalizedAnalysisOutput | null {
  const expectedPath = join(FIXTURES_DIR, `${fixtureName}.expected.${suffix}.json`);
  if (!existsSync(expectedPath)) {
    return null;
  }

  const content = readFileSync(expectedPath, "utf-8");
  return JSON.parse(content) as NormalizedAnalysisOutput;
}

export function writeExpectedOutput(
  fixtureName: string,
  output: NormalizedAnalysisOutput,
  suffix: string = "types"
): void {
  const expectedPath = join(FIXTURES_DIR, `${fixtureName}.expected.${suffix}.json`);
  writeFileSync(expectedPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
}

export function expectNormalizedMatch(
  actual: NormalizedAnalysisOutput,
  expected: NormalizedAnalysisOutput
): void {
  const actualJson = JSON.stringify(actual, Object.keys(actual).sort(), 2);
  const expectedJson = JSON.stringify(expected, Object.keys(expected).sort(), 2);

  if (actualJson !== expectedJson) {
    throw new Error(
      `Normalized output does not match expected.\n\n` +
      `Actual:\n${actualJson}\n\n` +
      `Expected:\n${expectedJson}`
    );
  }
}

export type TypeInfoMatcher = {
  display?: string | RegExp;
  canonical?: string | RegExp;
  kind?: "asyncResult" | "result" | "promiseResult" | "plain" | "unknown";
  confidence?: "exact" | "inferred" | "fallback";
  source?: "checker" | "annotation" | "fallback";
};

export function matchTypeInfo(
  actual: unknown,
  matcher: TypeInfoMatcher
): boolean {
  if (!actual || typeof actual !== "object") return false;

  const typeInfo = actual as Record<string, unknown>;

  if (matcher.display !== undefined) {
    if (typeof matcher.display === "string") {
      if (typeInfo.display !== matcher.display) return false;
    } else {
      if (!matcher.display.test(typeInfo.display as string)) return false;
    }
  }

  if (matcher.canonical !== undefined) {
    if (typeof matcher.canonical === "string") {
      if (typeInfo.canonical !== matcher.canonical) return false;
    } else {
      if (!matcher.canonical.test(typeInfo.canonical as string)) return false;
    }
  }

  if (matcher.kind !== undefined && typeInfo.kind !== matcher.kind) {
    return false;
  }

  if (matcher.confidence !== undefined && typeInfo.confidence !== matcher.confidence) {
    return false;
  }

  if (matcher.source !== undefined && typeInfo.source !== matcher.source) {
    return false;
  }

  return true;
}

export function extractStepType(
  normalized: NormalizedAnalysisOutput,
  stepId: string
): { outputType?: unknown; errorType?: unknown; causeType?: unknown } | null {
  const root = normalized.root as Record<string, unknown>;
  const children = root.children as Array<Record<string, unknown>> | undefined;
  if (!children) return null;

  const step = children.find(
    (c) => c.stepId === stepId || c.type === "step"
  );

  if (!step) return null;

  return {
    outputType: step.outputType,
    errorType: step.errorType,
    causeType: step.causeType,
  };
}

export function analyzeFixtureSource(
  source: string,
  options: { resetIdCounter?: boolean } = {}
): NormalizedAnalysisOutput {
  const { resetIdCounter: shouldReset = true } = options;

  if (shouldReset) {
    resetIdCounter();
  }

  const results = analyzeWorkflowSource(source);

  if (results.length === 0) {
    throw new Error("No workflow found in source");
  }

  return normalizeAnalysisOutput(results[0]);
}
